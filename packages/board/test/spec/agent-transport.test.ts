/**
 * The agent transport and the job (agent.md 3; design 11.3; errors.md `agent_unavailable` and `agent_partial`;
 * requirements R8.4; state-machines B32): NDJSON parsing in the HTTP client (with a fake `fetch`), a newer request aborts the
 * older, no transport gives `agent_unavailable`, and a stop or an error partway gives `agent_partial` with what was made kept.
 */
import { describe, expect, it } from 'vitest';
import { createBoard, httpAgentTransport, parseAgentEvent } from '../../src/index';
import type { BoardAgentEvent, BoardAgentRequest, BoardError, TalkRequest } from '../../src/index';
import { gate, makeAgentRig, must, scripted, shapesOf, tick } from './agent-helpers';

const rectAction = (x: number): unknown => ({ op: 'shape', kind: 'rect', at: { x, y: 20 }, w: 80, h: 40 });
const REQUEST: BoardAgentRequest = { kind: 'talk', text: 'hello', items: [], more: 0, page: 'page:1', allowEdit: false };

/** A response whose body arrives in the given chunks. */
function streamOf(chunks: readonly string[], init: ResponseInit = { status: 200 }): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, init);
}

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function fetchOf(make: () => Response | Promise<Response>, seen: Seen[] = []): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(make());
  }) as unknown as typeof fetch;
}

async function collect(transport: ReturnType<typeof httpAgentTransport>, request: BoardAgentRequest = REQUEST): Promise<BoardAgentEvent[]> {
  const out: BoardAgentEvent[] = [];
  for await (const e of transport(request, new AbortController().signal)) out.push(e);
  return out;
}

describe('parseAgentEvent: one NDJSON line (agent.md 3)', () => {
  it('reads actions, done and error', () => {
    expect(parseAgentEvent('{"actions":[{"op":"point","target":"shape:1"}]}')).toEqual({ actions: [{ op: 'point', target: 'shape:1' }] });
    expect(parseAgentEvent('{"done":true}')).toEqual({ done: true });
    expect(parseAgentEvent('{"error":{"kind":"overloaded","message":"try later"}}')).toEqual({ error: { kind: 'overloaded', message: 'try later' } });
  });

  it.each(['', 'not json', '42', 'null', '[]', '{}', '{"actions":"x"}', '{"done":false}', '{"error":"x"}', '{"error":{"kind":"x"}}'])('%j is not an event', (line) => {
    expect(parseAgentEvent(line)).toBeUndefined();
  });
});

describe('httpAgentTransport: POST {server}/v1/board/ask, NDJSON answer (design 11.3)', () => {
  it('posts the request as JSON to /v1/board/ask, whatever slashes end the server address', async () => {
    const seen: Seen[] = [];
    const transport = httpAgentTransport('https://example.test/api/', fetchOf(() => streamOf(['{"done":true}\n']), seen));
    await collect(transport);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://example.test/api/v1/board/ask');
    expect(seen[0]?.init?.method).toBe('POST');
    const headers = new Headers(seen[0]?.init?.headers);
    expect(headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual(REQUEST);
    expect(seen[0]?.init?.signal).toBeDefined();
  });

  it('gives the events in order, one for each line', async () => {
    const lines = ['{"actions":[{"op":"point","target":"a"}]}', '{"actions":[{"op":"point","target":"b"}]}', '{"done":true}'];
    const events = await collect(httpAgentTransport('http://s', fetchOf(() => streamOf([`${lines.join('\n')}\n`]))));
    expect(events).toEqual([{ actions: [{ op: 'point', target: 'a' }] }, { actions: [{ op: 'point', target: 'b' }] }, { done: true }]);
  });

  it('joins a line that arrives in pieces, and reads a last line with no newline', async () => {
    const events = await collect(httpAgentTransport('http://s', fetchOf(() => streamOf(['{"actions":[{"op":"po', 'int","target":"a"}]}\n{"do', 'ne":true}']))));
    expect(events).toEqual([{ actions: [{ op: 'point', target: 'a' }] }, { done: true }]);
  });

  it('skips blank lines', async () => {
    const events = await collect(httpAgentTransport('http://s', fetchOf(() => streamOf(['\n\n{"done":true}\n\n']))));
    expect(events).toEqual([{ done: true }]);
  });

  it('a line that is not an event ends the answer with an error event', async () => {
    const events = await collect(httpAgentTransport('http://s', fetchOf(() => streamOf(['{"actions":[]}\nthis is not json\n{"done":true}\n']))));
    expect(events[0]).toEqual({ actions: [] });
    expect(events[1] && 'error' in events[1]).toBe(true);
    expect(events).toHaveLength(2);
  });

  it('a server that refuses (an HTTP error) gives an error event, not a throw', async () => {
    const events = await collect(httpAgentTransport('http://s', fetchOf(() => new Response('nope', { status: 503, statusText: 'Unavailable' }))));
    expect(events).toHaveLength(1);
    expect(events[0] && 'error' in events[0]).toBe(true);
  });
});

describe('the service over the HTTP client: failures become errors (errors.md; B32)', () => {
  const boardOver = (make: () => Response | Promise<Response>): { rig: ReturnType<typeof makeAgentRig>; errors: BoardError[] } => {
    const errors: BoardError[] = [];
    const board = must(createBoard({ agent: { server: 'http://s', fetch: fetchOf(make), reducedMotion: true }, onError: (e) => errors.push(e) }));
    return { rig: { board, errors, page: board.core.pages.current as string }, errors };
  };

  it('an answer of actions and done is applied: what the server drew is on the board', async () => {
    const body = `${JSON.stringify({ actions: [rectAction(10)] })}\n${JSON.stringify({ actions: [rectAction(300)] })}\n{"done":true}\n`;
    const { rig } = boardOver(() => streamOf([body]));
    const out = must(await rig.board.agent.service.talk('draw two boxes'));
    expect(out.made).toHaveLength(2);
    expect(shapesOf(rig).filter((s) => s.kind === 'rect')).toHaveLength(2);
  });

  it('a refusing server with nothing made is agent_unavailable', async () => {
    const { rig, errors } = boardOver(() => new Response('', { status: 500 }));
    const r = await rig.board.agent.service.talk('hi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_unavailable');
    expect(errors.map((e) => e.kind)).toContain('agent_unavailable');
  });

  it('a network failure with nothing made is agent_unavailable', async () => {
    const board = must(
      createBoard({
        agent: {
          server: 'http://s',
          fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
          reducedMotion: true,
        },
      }),
    );
    const r = await board.agent.service.talk('hi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_unavailable');
  });

  it('a bad line after some actions is agent_partial, and what was made stays', async () => {
    const { rig } = boardOver(() => streamOf([`${JSON.stringify({ actions: [rectAction(10)] })}\nnot json\n`]));
    const r = await rig.board.agent.service.talk('draw');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_partial');
    expect(shapesOf(rig).filter((s) => s.kind === 'rect')).toHaveLength(1);
  });

  it('an answer that ends without done, after some actions, is agent_partial', async () => {
    const { rig } = boardOver(() => streamOf([`${JSON.stringify({ actions: [rectAction(10)] })}\n`]));
    const r = await rig.board.agent.service.talk('draw');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_partial');
    expect(shapesOf(rig)).toHaveLength(1);
  });
});

describe('no transport: agent_unavailable (design 11.3; R8.4)', () => {
  it('ask and talk say so, make no job and change nothing', async () => {
    const errors: BoardError[] = [];
    const board = must(createBoard({ onError: (e) => errors.push(e) }));
    const service = board.agent.service;
    expect(service.available).toBe(false);
    const talk = await service.talk('draw a circle');
    const ask = await service.ask(REQUEST, 'hello');
    for (const r of [talk, ask]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('agent_unavailable');
        expect(r.message.length).toBeGreaterThan(0);
      }
    }
    expect(service.job).toBeUndefined();
    expect(board.core.store.shapesOn(board.core.pages.current as string)).toEqual([]);
    expect(errors.filter((e) => e.kind === 'agent_unavailable')).toHaveLength(2);
  });

  it('a transport set later makes the agent available', async () => {
    const board = must(createBoard());
    const fake = scripted([[{ actions: [rectAction(10)] }, { done: true }]]);
    board.agent.service.setTransport(fake.transport);
    expect(board.agent.service.available).toBe(true);
    const r = await board.agent.service.talk('go');
    expect(r.ok).toBe(true);
  });

  it('talk with no words is a bad_argument and sends nothing', async () => {
    const fake = scripted([[{ done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const r = await rig.board.agent.service.talk('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('bad_argument');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('talk: what the user says (agent.md 3)', () => {
  it('sends kind talk with the text, the board in view, more, the page and allowEdit false', async () => {
    const fake = scripted([[{ done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    await rig.board.agent.runner.run({ actions: [rectAction(10)] });
    must(await rig.board.agent.service.talk('what is here?'));
    const request = fake.requests[0];
    expect(request).toMatchObject({ kind: 'talk', text: 'what is here?', more: 0, page: rig.page });
    expect((request as TalkRequest).items).toHaveLength(1);
    expect(request).toHaveProperty('allowEdit', false);
  });

  it('allowEdit is true when the user lets the agent change their work', async () => {
    const fake = scripted([[{ done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    must(await rig.board.agent.service.talk('tidy up', true));
    expect(fake.requests[0]).toHaveProperty('allowEdit', true);
  });
});

describe('a streamed answer is one gesture: one undo (agent.md 3; B32)', () => {
  it('three events of actions are one undo step, and one undo takes all of them back', async () => {
    const fake = scripted([[{ actions: [rectAction(10), rectAction(200)] }, { actions: [rectAction(400)] }, { actions: [rectAction(600)] }, { done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const steps = rig.board.core.history.undoSteps;
    const out = must(await rig.board.agent.service.talk('draw four'));
    expect(out.made).toHaveLength(4);
    expect(shapesOf(rig)).toHaveLength(4);
    expect(rig.board.core.history.undoSteps).toBe(steps + 1);
    expect(rig.board.core.history.undo().ok).toBe(true);
    expect(shapesOf(rig)).toHaveLength(0);
  });

  it('$last carries over from one event of the answer to the next', async () => {
    const fake = scripted([[{ actions: [rectAction(100)] }, { actions: [{ op: 'write', text: 'next', at: { near: '$last', side: 'right' } }] }, { done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const out = must(await rig.board.agent.service.talk('draw'));
    expect(out.failed).toEqual([]);
    expect(out.made).toHaveLength(2);
  });

  it('what an event could not do is in the outcome and does not stop the next event', async () => {
    const fake = scripted([[{ actions: [{ op: 'delete', id: 'shape:gone' }] }, { actions: [rectAction(10)] }, { done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const out = must(await rig.board.agent.service.talk('go'));
    expect(out.made).toHaveLength(1);
    expect(out.failed.map((f) => f.kind)).toEqual(['agent_refused']);
  });

  it('an event whose actions are not a list fails the job', async () => {
    const answers = [[{ actions: [rectAction(10)] }, { actions: 'oops' as unknown as unknown[] }]];
    const fake = scripted(answers);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const r = await rig.board.agent.service.talk('go');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_partial');
    expect(shapesOf(rig)).toHaveLength(1);
  });
});

describe('an error or a stop partway: agent_partial, and what was made stays (errors.md; design 11.3)', () => {
  it("the server's error event after some actions is agent_partial with the server's message", async () => {
    const fake = scripted([[{ actions: [rectAction(10)] }, { error: { kind: 'overloaded', message: 'The model is busy' } }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const r = await rig.board.agent.service.talk('draw');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('agent_partial');
      expect(r.message).toContain('The model is busy');
    }
    expect(shapesOf(rig)).toHaveLength(1);
    expect(rig.errors.map((e) => e.kind)).toContain('agent_partial');
  });

  it("the server's error event with nothing made is agent_unavailable with the server's message", async () => {
    const fake = scripted([[{ error: { kind: 'overloaded', message: 'The model is busy' } }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const r = await rig.board.agent.service.talk('draw');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('agent_unavailable');
      expect(r.message).toContain('The model is busy');
    }
  });

  it('a transport that throws midway is agent_partial', async () => {
    const rig = makeAgentRig({
      reducedMotion: true,
      transport: async function* () {
        yield { actions: [rectAction(10)] };
        throw new Error('connection reset');
      },
    });
    const r = await rig.board.agent.service.talk('draw');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_partial');
    expect(shapesOf(rig)).toHaveLength(1);
  });

  it('the shapes of a partial answer are still one undo step', async () => {
    const fake = scripted([[{ actions: [rectAction(10)] }, { actions: [rectAction(200)] }, { error: { kind: 'x', message: 'boom' } }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const steps = rig.board.core.history.undoSteps;
    await rig.board.agent.service.talk('draw');
    expect(rig.board.core.history.undoSteps).toBe(steps + 1);
    rig.board.core.history.undo();
    expect(shapesOn(rig)).toBe(0);
  });

  it('Stop ends the job at once: agent_partial, what was drawn stays, and later events are not applied', async () => {
    const hold = gate();
    const rig = makeAgentRig({
      reducedMotion: true,
      transport: async function* () {
        yield { actions: [rectAction(10)] };
        await hold.wait;
        yield { actions: [rectAction(300)] };
        yield { done: true as const };
      },
    });
    const service = rig.board.agent.service;
    const pending = service.talk('draw');
    await tick(5);
    expect(service.busy).toBe(true);
    service.stop();
    expect(service.busy).toBe(false);
    expect(service.job?.state).toBe('stopped');
    hold.open();
    const r = await pending;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('agent_partial');
      expect((r.detail as { reason?: string }).reason).toBe('stopped');
    }
    expect(shapesOf(rig)).toHaveLength(1);
    expect(rig.board.core.history.undoSteps).toBe(1);
  });

  it('Stop aborts the request signal', async () => {
    const hold = gate();
    const signals: AbortSignal[] = [];
    const rig = makeAgentRig({
      reducedMotion: true,
      transport: async function* (_r, signal) {
        signals.push(signal);
        await hold.wait;
        yield { done: true as const };
      },
    });
    const pending = rig.board.agent.service.talk('draw');
    await tick(5);
    expect(signals[0]?.aborted).toBe(false);
    rig.board.agent.service.stop();
    expect(signals[0]?.aborted).toBe(true);
    hold.open();
    await pending;
  });

  it('Stop with no job running does nothing', () => {
    const rig = makeAgentRig({ reducedMotion: true, transport: scripted([[{ done: true }]]).transport });
    rig.board.agent.service.stop();
    expect(rig.board.agent.service.job).toBeUndefined();
    expect(rig.errors).toEqual([]);
  });
});

const shapesOn = (rig: ReturnType<typeof makeAgentRig>): number => shapesOf(rig).length;

describe('a newer request aborts the older (design 11.3; agent.md 3; B32)', () => {
  it("the older request's signal is aborted at once, the older answer is not applied any more, what it made stays", async () => {
    const hold = gate();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const rig = makeAgentRig({
      reducedMotion: true,
      transport: async function* (_request, signal) {
        calls++;
        signals.push(signal);
        if (calls === 1) {
          yield { actions: [rectAction(10)] };
          await hold.wait;
          yield { actions: [rectAction(500)] };
          yield { done: true as const };
        } else {
          yield { actions: [{ op: 'shape', kind: 'ellipse', at: { x: 800, y: 300 } }] };
          yield { done: true as const };
        }
      },
    });
    const service = rig.board.agent.service;
    const first = service.talk('first');
    await tick(5);
    expect(shapesOf(rig)).toHaveLength(1);
    const second = service.talk('second');
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    hold.open();
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.kind).toBe('agent_partial');
    expect(b.ok).toBe(true);
    // the first answer's rect stays; its late rect at x 500 was never applied; the second answer's ellipse is there
    expect(shapesOf(rig).map((s) => s.kind).sort()).toEqual(['ellipse', 'rect']);
  });

  it('each request is its own undo step', async () => {
    const fake = scripted([[{ actions: [rectAction(10)] }, { done: true }], [{ actions: [{ op: 'shape', kind: 'ellipse', at: { x: 400, y: 20 } }] }, { done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    must(await rig.board.agent.service.talk('one'));
    must(await rig.board.agent.service.talk('two'));
    expect(rig.board.core.history.undoSteps).toBe(2);
    rig.board.core.history.undo();
    expect(shapesOf(rig).map((s) => s.kind)).toEqual(['rect']);
  });
});
