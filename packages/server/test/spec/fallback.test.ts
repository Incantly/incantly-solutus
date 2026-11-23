/**
 * The fallback across models (server design 4 "Fallback", requirements R3.2, R3.3, errors.md `model_busy`, `model_timeout`,
 * `model_unavailable`, docs/state-machines.md SV2): models in order; 429, 5xx, a network error or no first byte in 15 s
 * pass on; a model that gave 429 is skipped for 60 s; every model busy is `model_busy` with `retryAfterMs`; a model never
 * changes once its output reached the caller. The network is `FakeFetch`; the 15 s timer runs on fake timers and the
 * 60 s skip on a clock the test moves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import type { ChatEvent, ChatRequest } from '@incantly/teacher';
import { CALL_MACHINE, FIRST_BYTE_MS, SKIP_MS, openRouterClient } from '../../src/index';
import type { CallMove, CallState } from '../../src/index';
import { SECRET_KEY, makeClock } from './helpers';
import type { Answer } from './r2-helpers';
import { FakeFetch, chatRequest, collect, controlled, fixture, finishChunk, hang, lastOf, network, ok, sseOf, status, textChunk, textOf, textSse, wait } from './r2-helpers';

const A = 'alpha/one:free';
const B = 'beta/two:free';
const C = 'gamma/three:free';
const V1 = 'vis/one:free';
const V2 = 'vis/two:free';

afterEach(() => {
  vi.useRealTimers();
});

interface Rig {
  readonly fake: FakeFetch;
  readonly clock: ReturnType<typeof makeClock>;
  chat(request?: ChatRequest, signal?: AbortSignal): Promise<ChatEvent[]>;
  stream(request?: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>;
}

/** A client over a fake network that answers by model id. */
function rig(answers: Readonly<Record<string, Answer | ((n: number) => Answer)>>, options: { models?: string[]; vision?: string[] } = {}): Rig {
  const seen = new Map<string, number>();
  const fake = new FakeFetch((call) => {
    const n = seen.get(call.model) ?? 0;
    seen.set(call.model, n + 1);
    const a = answers[call.model];
    if (a === undefined) return status(500);
    return typeof a === 'function' ? a(n) : a;
  });
  const clock = makeClock();
  const client = openRouterClient({ apiKey: () => SECRET_KEY, fetch: fake.fetch }, { textModels: options.models ?? [A, B, C], visionModels: options.vision ?? [V1, V2], now: clock.now });
  return {
    fake,
    clock,
    chat: (request = chatRequest(), signal = new AbortController().signal) => collect(client.chat(request, signal)),
    stream: (request = chatRequest(), signal = new AbortController().signal) => client.chat(request, signal),
  };
}

const good = (text = 'a = 1\n', model = 'x/y:free'): Answer => ok(textSse([text], model));
const errorOf = (events: readonly ChatEvent[]): { kind: string; message: string; detail?: Record<string, unknown> } | undefined => {
  const last = lastOf(events);
  return last !== undefined && 'error' in last ? (last.error as { kind: string; message: string; detail?: Record<string, unknown> }) : undefined;
};

describe('models are tried in order (R3.2)', () => {
  it('the first model answers: no other is asked', async () => {
    const r = rig({ [A]: good('from A'), [B]: good('from B') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A]);
    expect(textOf(events)).toBe('from A');
  });

  it('a busy first model passes the call to the second', async () => {
    const r = rig({ [A]: status(429), [B]: good('from B') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A, B]);
    expect(textOf(events)).toBe('from B');
    expect(events.some((e) => 'error' in e)).toBe(false);
  });

  it('the models are asked in the order of the list, and each once', async () => {
    const r = rig({ [A]: status(429), [B]: status(503), [C]: good('from C') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A, B, C]);
    expect(textOf(events)).toBe('from C');
  });

  it('the list order is the order given, not alphabetical', async () => {
    const r = rig({ [A]: good('A'), [B]: good('B'), [C]: status(429) }, { models: [C, B, A] });
    await r.chat();
    expect(r.fake.models).toEqual([C, B]);
  });

  it('what reaches the caller is the second model\'s answer, whole: its text and its done', async () => {
    const r = rig({ [A]: status(500), [B]: ok(fixture('openrouter-text.sse')) });
    const events = await r.chat();
    expect(textOf(events)).toBe('A circle of radius 2 is every point two units from the centre.');
    expect(lastOf(events)).toHaveProperty('done');
  });
});

describe('what passes the call on (design 4: 429, 5xx, a network error, no first byte in 15 s)', () => {
  for (const code of [429, 500, 502, 503, 504]) {
    it(`HTTP ${code} on the first model passes on to the second`, async () => {
      const r = rig({ [A]: status(code), [B]: good('from B') });
      const events = await r.chat();
      expect(r.fake.models).toEqual([A, B]);
      expect(textOf(events)).toBe('from B');
    });
  }

  it('a network error on the first model passes on to the second', async () => {
    const r = rig({ [A]: network(), [B]: good('from B') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A, B]);
    expect(textOf(events)).toBe('from B');
  });

  it('an error chunk before any output passes on (SV2: an error event before output passes to the next model)', async () => {
    const r = rig({ [A]: ok(sseOf([{ error: { code: 502, message: 'upstream' } }])), [B]: good('from B') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A, B]);
    expect(textOf(events)).toBe('from B');
  });

  it('a call that fails passes on at once: the next model is asked without waiting 15 s', async () => {
    const r = rig({ [A]: status(503), [B]: good('from B') });
    const t0 = Date.now();
    await r.chat();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('the failed model\'s request is aborted when the call passes on', async () => {
    const r = rig({ [A]: status(503), [B]: good('from B') });
    await r.chat();
    expect(r.fake.calls[0]?.signal?.aborted).toBe(true);
  });
});

describe('no first byte in 15 s (R3.2)', () => {
  it('the constants are 15 s and 60 s', () => {
    expect(FIRST_BYTE_MS).toBe(15_000);
    expect(SKIP_MS).toBe(60_000);
  });

  it('a model that sends nothing for 15 s is passed on, not before', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = rig({ [A]: hang(), [B]: good('from B') });
    const pending = r.chat();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(r.fake.models, 'passed on before 15 s').toEqual([A]);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.fake.models).toEqual([A, B]);
    const events = await pending;
    expect(textOf(events)).toBe('from B');
  });

  it('the model that timed out has its request aborted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = rig({ [A]: hang(), [B]: good('from B') });
    const pending = r.chat();
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(r.fake.calls[0]?.signal?.aborted).toBe(true);
  });

  it('a first byte at 14 s keeps the model: the second is never asked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const c = controlled();
    const r = rig({ [A]: { kind: 'stream', body: c.body }, [B]: good('from B') });
    const pending = r.chat();
    await vi.advanceTimersByTimeAsync(14_000);
    c.push(`data: ${JSON.stringify(textChunk('slow but here'))}\n\n`);
    await vi.advanceTimersByTimeAsync(2_000);
    c.push(`data: ${JSON.stringify(finishChunk())}\n\ndata: [DONE]\n\n`);
    c.end();
    await vi.advanceTimersByTimeAsync(20_000);
    const events = await pending;
    expect(r.fake.models).toEqual([A]);
    expect(textOf(events)).toBe('slow but here');
  });

  it('the timer is for the first byte only: a model that is slow between pieces is not passed on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const c = controlled();
    const r = rig({ [A]: { kind: 'stream', body: c.body }, [B]: good('from B') });
    const pending = r.chat();
    c.push(`data: ${JSON.stringify(textChunk('one '))}\n\n`);
    await vi.advanceTimersByTimeAsync(40_000);
    c.push(`data: ${JSON.stringify(textChunk('two'))}\n\n${`data: ${JSON.stringify(finishChunk())}\n\n`}data: [DONE]\n\n`);
    c.end();
    const events = await pending;
    expect(r.fake.models).toEqual([A]);
    expect(textOf(events)).toBe('one two');
  });

  it('every model silent for 15 s ends the call as model_timeout "The AI took too long." (errors.md)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = rig({ [A]: hang(), [B]: hang(), [C]: hang() });
    const pending = r.chat();
    await vi.advanceTimersByTimeAsync(15_000 * 3 + 10);
    const events = await pending;
    expect(r.fake.models).toEqual([A, B, C]);
    expect(errorOf(events)?.kind).toBe('model_timeout');
    expect(errorOf(events)?.message).toBe('The AI took too long.');
  });
});

describe('a model that gave 429 is skipped for 60 s (R3.2)', () => {
  it('the next call within 60 s does not ask it', async () => {
    const r = rig({ [A]: status(429, { 'retry-after': '20' }), [B]: good('from B') });
    await r.chat();
    r.clock.advance(1_000);
    await r.chat();
    expect(r.fake.models).toEqual([A, B, B]);
  });

  it('it is still skipped at 59.999 s and asked again at 60 s', async () => {
    const r = rig({ [A]: (n) => (n === 0 ? status(429) : good('A is back')), [B]: good('from B') });
    await r.chat();
    r.clock.advance(59_999);
    await r.chat();
    expect(r.fake.models, 'asked at 59.999 s').toEqual([A, B, B]);
    r.clock.advance(1);
    const events = await r.chat();
    expect(r.fake.models, 'not asked again at 60 s').toEqual([A, B, B, A]);
    expect(textOf(events)).toBe('A is back');
  });

  it('a skip is the 60 s from the 429, whatever retry-after says', async () => {
    const r = rig({ [A]: (n) => (n === 0 ? status(429, { 'retry-after': '5' }) : good('A')), [B]: good('B') });
    await r.chat();
    r.clock.advance(30_000);
    await r.chat();
    expect(r.fake.models.filter((m) => m === A)).toHaveLength(1);
  });

  it('only a 429 starts a skip: a 500 does not, the next call asks the model again', async () => {
    const r = rig({ [A]: (n) => (n === 0 ? status(500) : good('A')), [B]: good('B') });
    await r.chat();
    r.clock.advance(1_000);
    const events = await r.chat();
    expect(r.fake.models).toEqual([A, B, A]);
    expect(textOf(events)).toBe('A');
  });

  it('a network error does not start a skip either', async () => {
    const r = rig({ [A]: (n) => (n === 0 ? network() : good('A')), [B]: good('B') });
    await r.chat();
    await r.chat();
    expect(r.fake.models).toEqual([A, B, A]);
  });

  it('the skip is per model: a 429 on B does not skip A', async () => {
    const r = rig({ [A]: status(500), [B]: status(429), [C]: good('C') });
    await r.chat();
    await r.chat();
    expect(r.fake.models).toEqual([A, B, C, A, C]);
  });

  it('a skipped model is not asked, and the models after it are, in order', async () => {
    const r = rig({ [A]: status(429), [B]: status(429), [C]: good('C') });
    await r.chat();
    await r.chat();
    expect(r.fake.models).toEqual([A, B, C, C]);
  });

  it('an error chunk that says 429 inside a stream before output also starts the skip', async () => {
    const r = rig({ [A]: (n) => (n === 0 ? ok(sseOf([{ error: { code: 429, message: 'slow down' } }])) : good('A')), [B]: good('B') });
    await r.chat();
    await r.chat();
    expect(r.fake.models).toEqual([A, B, B]);
  });
});

describe('every model busy: model_busy with retryAfterMs (design 4, errors.md)', () => {
  it('all models 429: one error, model_busy, with a retryAfterMs between 1 ms and 60 s', async () => {
    const r = rig({ [A]: status(429, { 'retry-after': '20' }), [B]: status(429, { 'retry-after': '30' }), [C]: status(429, { 'retry-after': '45' }) });
    const events = await r.chat();
    expect(events).toHaveLength(1);
    const e = errorOf(events);
    expect(e?.kind).toBe('model_busy');
    const wait = e?.detail?.['retryAfterMs'];
    expect(typeof wait).toBe('number');
    expect(Number(wait)).toBeGreaterThan(0);
    expect(Number(wait)).toBeLessThanOrEqual(60_000);
  });

  it('the message says the wait in whole seconds, as errors.md words it', async () => {
    const r = rig({ [A]: status(429), [B]: status(429), [C]: status(429) });
    const e = errorOf(await r.chat());
    const seconds = Math.ceil(Number(e?.detail?.['retryAfterMs']) / 1000);
    expect(e?.message).toBe(`The AI is busy; try again in ${seconds} s.`);
  });

  it('the recorded 429 of the fixtures on every model gives model_busy', async () => {
    const rec = JSON.parse(fixture('openrouter-429.json')) as { status: number; headers: Record<string, string>; body: unknown };
    const answer = status(rec.status, rec.headers, JSON.stringify(rec.body));
    const r = rig({ [A]: answer, [B]: answer, [C]: answer });
    const e = errorOf(await r.chat());
    expect(e?.kind).toBe('model_busy');
    expect(JSON.stringify(e)).not.toContain('rate-limited upstream');
  });

  it('a call that finds every model skipped answers model_busy at once, with no request, and a wait that shrinks', async () => {
    const r = rig({ [A]: status(429), [B]: status(429), [C]: status(429) });
    const first = errorOf(await r.chat());
    const asked = r.fake.calls.length;
    r.clock.advance(20_000);
    const second = errorOf(await r.chat());
    expect(r.fake.calls).toHaveLength(asked);
    expect(second?.kind).toBe('model_busy');
    expect(Number(second?.detail?.['retryAfterMs'])).toBeGreaterThan(0);
    expect(Number(second?.detail?.['retryAfterMs'])).toBeLessThan(Number(first?.detail?.['retryAfterMs']) + 1);
    expect(Number(second?.detail?.['retryAfterMs'])).toBeLessThanOrEqual(40_000);
  });

  it('waiting the retryAfterMs the error gave is enough for a model to be asked again', async () => {
    const r = rig({ [A]: (n) => (n === 0 ? status(429) : good('A again')), [B]: status(429), [C]: status(429) });
    await r.chat();
    r.clock.advance(20_000);
    const busy = errorOf(await r.chat());
    r.clock.advance(Number(busy?.detail?.['retryAfterMs']));
    const events = await r.chat();
    expect(textOf(events)).toBe('A again');
  });

  it('a mix of busy and 5xx is not model_busy: not every model was busy', async () => {
    const r = rig({ [A]: status(429), [B]: status(503), [C]: network() });
    const e = errorOf(await r.chat());
    expect(e).toBeDefined();
    expect(e?.kind).not.toBe('model_busy');
  });
});

describe('no model can be reached (errors.md model_unavailable)', () => {
  it('every model failing with 5xx gives model_unavailable "The AI is not available…"', async () => {
    const r = rig({ [A]: status(500), [B]: status(502), [C]: status(503) });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A, B, C]);
    expect(events).toHaveLength(1);
    expect(errorOf(events)?.kind).toBe('model_unavailable');
  });

  it('every model failing on the network gives model_unavailable', async () => {
    const r = rig({ [A]: network(), [B]: network(), [C]: network() });
    expect(errorOf(await r.chat())?.kind).toBe('model_unavailable');
  });

  it('an empty list of models gives model_unavailable and asks nothing', async () => {
    const r = rig({}, { models: [] });
    const events = await r.chat();
    expect(r.fake.calls).toHaveLength(0);
    expect(errorOf(events)?.kind).toBe('model_unavailable');
  });

  it('the error holds neither the key nor the provider\'s words', async () => {
    const r = rig({ [A]: status(500, {}, `RAWPROVIDERTEXT ${SECRET_KEY}`), [B]: network(`boom ${SECRET_KEY}`), [C]: status(502) });
    const text = JSON.stringify(await r.chat());
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain('RAWPROVIDERTEXT');
  });
});

describe('a model never changes after output started (design 4, SV2 invariants)', () => {
  it('text, then the body fails: the error is the last event and the next model is not asked', async () => {
    const c = controlled();
    c.push(`data: ${JSON.stringify(textChunk('a = 1\n'))}\n\n`);
    const r = rig({ [A]: { kind: 'stream', body: c.body }, [B]: good('from B') });
    const pending = r.chat();
    await wait(20);
    c.fail(new Error('reset'));
    const events = await pending;
    expect(r.fake.models).toEqual([A]);
    expect(textOf(events)).toBe('a = 1\n');
    expect(errorOf(events)).toBeDefined();
    expect(events.filter((e) => 'error' in e)).toHaveLength(1);
  });

  it('text, then the stream ends with no [DONE]: stream_cut, and the next model is not asked', async () => {
    const r = rig({ [A]: ok(sseOf([textChunk('a = 1\n')], 'none')), [B]: good('from B') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A]);
    expect(textOf(events)).toBe('a = 1\n');
    expect(errorOf(events)?.kind).toBe('stream_cut');
  });

  it('text, then an error chunk (even a 429): forwarded as the last event, no switch, and no 60 s skip is a reason to switch', async () => {
    const r = rig({ [A]: ok(sseOf([textChunk('a = 1\n'), { error: { code: 429, message: 'slow' } }])), [B]: good('from B') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A]);
    expect(textOf(events)).toBe('a = 1\n');
    expect(errorOf(events)).toBeDefined();
    expect(textOf(events)).not.toContain('from B');
  });

  it('a tool call as the first output also fixes the model', async () => {
    const r = rig({ [A]: ok(fixture('openrouter-tool-calls.sse').replace('Here is the circle.', '')), [B]: good('from B') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A]);
    expect(events.some((e) => 'toolCall' in e)).toBe(true);
  });

  it('an empty reply that is finished (only a done) is an answer: the next model is not asked', async () => {
    const r = rig({ [A]: ok(sseOf([finishChunk()])), [B]: good('from B') });
    const events = await r.chat();
    expect(r.fake.models).toEqual([A]);
    expect(lastOf(events)).toHaveProperty('done');
  });

  it('the events of the model that answered go out unchanged: no event of the passed models is among them', async () => {
    const r = rig({ [A]: status(429), [B]: ok(textSse(['x', 'y'], 'beta/two:free')), [C]: good('C') });
    const events = await r.chat();
    expect(events.filter((e) => 'text' in e)).toEqual([{ text: 'x' }, { text: 'y' }]);
    expect((lastOf(events) as { done: { model: string } }).done.model).toBe('beta/two:free');
  });
});

describe('a request with a picture uses the vision list (R3.3)', () => {
  const picture = (): ChatRequest => chatRequest({ vision: true, messages: [{ role: 'user', content: 'what is this', images: [{ mime: 'image/png', data: 'AAAA' }] }] });

  it('only the vision models are asked, in their order', async () => {
    const r = rig({ [V1]: status(429), [V2]: good('from V2'), [A]: good('from A') });
    const events = await r.chat(picture());
    expect(r.fake.models).toEqual([V1, V2]);
    expect(textOf(events)).toBe('from V2');
  });

  it('a request with no picture never uses a vision model', async () => {
    const r = rig({ [A]: good('from A'), [V1]: good('from V1') });
    await r.chat();
    expect(r.fake.models).toEqual([A]);
  });

  it('the vision list has its own skips: a 429 on a text model does not skip a vision model, and the other way round', async () => {
    const r = rig({ [A]: status(429), [B]: good('B'), [V1]: good('V1') });
    await r.chat();
    await r.chat(picture());
    expect(r.fake.models).toEqual([A, B, V1]);
  });

  it('every vision model busy is model_busy', async () => {
    const r = rig({ [V1]: status(429), [V2]: status(429) });
    expect(errorOf(await r.chat(picture()))?.kind).toBe('model_busy');
    expect(r.fake.models).toEqual([V1, V2]);
  });
});

describe('the caller stops the call (SV2 abort row, R2.5)', () => {
  it('while a model is silent: the stream ends, no second model is asked, and the request is aborted', async () => {
    const r = rig({ [A]: hang(), [B]: good('B') });
    const ctl = new AbortController();
    const pending = collect(r.stream(chatRequest(), ctl.signal));
    await wait(20);
    ctl.abort();
    const events = await Promise.race([pending, wait(1500).then(() => 'stuck' as const)]);
    expect(events).not.toBe('stuck');
    expect(r.fake.models).toEqual([A]);
    expect(r.fake.calls[0]?.signal?.aborted).toBe(true);
    expect((events as ChatEvent[]).some((e) => 'error' in e)).toBe(false);
  });

  it('after output: the stream ends, nothing more is sent, and the request is aborted', async () => {
    const c = controlled();
    c.push(`data: ${JSON.stringify(textChunk('a'))}\n\n`);
    const r = rig({ [A]: { kind: 'stream', body: c.body }, [B]: good('B') });
    const ctl = new AbortController();
    const out: ChatEvent[] = [];
    const reading = (async () => {
      for await (const e of r.stream(chatRequest(), ctl.signal)) out.push(e);
    })();
    await wait(20);
    ctl.abort();
    await Promise.race([reading, wait(1500)]);
    expect(out).toEqual([{ text: 'a' }]);
    expect(r.fake.models).toEqual([A]);
    expect(r.fake.calls[0]?.signal?.aborted).toBe(true);
  });

  it('a signal aborted before the call: nothing is asked', async () => {
    const r = rig({ [A]: good('A') });
    const ctl = new AbortController();
    ctl.abort();
    const events = await collect(r.stream(chatRequest(), ctl.signal));
    expect(r.fake.calls).toHaveLength(0);
    expect(events.some((e) => 'error' in e)).toBe(false);
  });

  it('a call that ends well has its request aborted at the end (SV2: aborted in any final state)', async () => {
    const r = rig({ [A]: good('A') });
    await r.chat();
    expect(r.fake.calls[0]?.signal?.aborted).toBe(true);
  });

  it('a call that fails has its request aborted at the end', async () => {
    const r = rig({ [A]: status(429), [B]: status(429), [C]: status(429) });
    await r.chat();
    for (const call of r.fake.calls) expect(call.signal?.aborted).toBe(true);
  });
});

/** The rows of the SV2 table in docs/state-machines.md. */
const SV2_ROWS: readonly (readonly [CallState, CallMove, CallState])[] = [
  ['trying', 'passOn', 'trying'],
  ['trying', 'output', 'streaming'],
  ['trying', 'finish', 'done'],
  ['trying', 'exhaust', 'failed'],
  ['streaming', 'finish', 'done'],
  ['streaming', 'fail', 'failed'],
  ['trying', 'abort', 'stopped'],
  ['streaming', 'abort', 'stopped'],
];
const STATES: readonly CallState[] = ['trying', 'streaming', 'done', 'failed', 'stopped'];
const MOVES: readonly CallMove[] = ['passOn', 'output', 'finish', 'exhaust', 'fail', 'abort'];
const rowsOf = <S extends string, E extends string>(table: MachineTable<S, E>): string[] =>
  Object.entries(table).flatMap(([from, moves]) => Object.entries(moves as Record<string, string>).map(([event, to]) => `${from} -${event}-> ${to}`)).sort();

describe('CALL_MACHINE (SV2)', () => {
  it('every row of SV2 is in the table, and nothing else is', () => {
    for (const [from, event, to] of SV2_ROWS) expect(CALL_MACHINE[from][event], `${from} ${event}`).toBe(to);
    expect(rowsOf(CALL_MACHINE)).toEqual(SV2_ROWS.map(([f, e, t]) => `${f} -${e}-> ${t}`).sort());
  });

  it('done, failed and stopped are final', () => {
    for (const s of ['done', 'failed', 'stopped'] as const) expect(CALL_MACHINE[s]).toEqual({});
  });

  it('a model never changes after output: streaming has no way back to trying', () => {
    expect(Object.values(CALL_MACHINE.streaming)).not.toContain('trying');
    expect(CALL_MACHINE.streaming['passOn']).toBeUndefined();
  });

  for (const from of STATES) {
    for (const move of MOVES) {
      const to = CALL_MACHINE[from][move];
      if (to !== undefined) {
        it(`${from} on ${move} goes to ${to}`, () => {
          const refused: string[] = [];
          const m = new StateMachine(CALL_MACHINE, from, (f, e) => refused.push(`${f}/${e}`));
          expect(m.send(move)).toBe(true);
          expect(m.state).toBe(to);
          expect(refused).toEqual([]);
        });
      } else {
        it(`${from} on ${move} is refused and reported`, () => {
          const refused: [string, string][] = [];
          const m = new StateMachine(CALL_MACHINE, from, (f, e) => refused.push([f, e]));
          expect(m.can(move)).toBe(false);
          expect(m.send(move)).toBe(false);
          expect(m.state).toBe(from);
          expect(refused).toEqual([[from, move]]);
        });
      }
    }
  }
});
