/**
 * The agent's words (agent.md 3, review TR-28; state-machines B32 and B35): `{ "say": "…" }` is an event of the NDJSON
 * answer. The parser accepts it, the service joins the pieces of one answer into one `agent` line of the conversation
 * (after the lines that say what the actions did), a words-only answer is `done` and not "made nothing", and the panel
 * shows the words.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOARD_STRINGS, createBoard, httpAgentTransport, parseAgentEvent } from '../../src/index';
import type { Board, BoardAgentEvent } from '../../src/index';
import { gate, makeAgentRig, must, scripted } from './agent-helpers';
import { installCanvas2d } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';
import { stubSize } from './round4-helpers';

const rect = (x: number): unknown => ({ op: 'shape', kind: 'rect', at: { x, y: 20 }, w: 80, h: 40 });

describe('parseAgentEvent reads say (TR-28)', () => {
  it('a say line is a say event, with any text, even empty', () => {
    expect(parseAgentEvent('{"say":"The slope is 2."}')).toEqual({ say: 'The slope is 2.' });
    expect(parseAgentEvent('{"say":""}')).toEqual({ say: '' });
  });

  it.each(['{"say":1}', '{"say":null}', '{"say":["a"]}'])('%j is not an event', (line) => {
    expect(parseAgentEvent(line)).toBeUndefined();
  });

  it('the HTTP client gives say events in order with the actions and done', async () => {
    const body = [{ say: 'Here ' }, { say: 'it is.' }, { actions: [rect(10)] }, { done: true }].map((e) => JSON.stringify(e)).join('\n');
    const fetchImpl = (() => Promise.resolve(new Response(`${body}\n`, { status: 200 }))) as unknown as typeof fetch;
    const out: BoardAgentEvent[] = [];
    const request = { kind: 'talk', text: 'hi', items: [], more: 0, page: 'page:1', allowEdit: false } as const;
    for await (const e of httpAgentTransport('http://s', fetchImpl)(request, new AbortController().signal)) out.push(e);
    expect(out).toEqual([{ say: 'Here ' }, { say: 'it is.' }, { actions: [rect(10)] }, { done: true }]);
  });
});

describe('the service shows the words (B32)', () => {
  const lines = (rig: ReturnType<typeof makeAgentRig>): { who: string; text: string }[] => rig.board.agent.service.entries.map((e) => ({ who: e.who, text: e.text }));

  it('the pieces of one answer are one agent line, after the lines of what the actions did', async () => {
    const rig = makeAgentRig({ transport: scripted([[{ say: 'Here is ' }, { actions: [rect(10)] }, { say: 'your box.' }, { done: true }]]).transport, reducedMotion: true });
    must(await rig.board.agent.service.talk('draw a box'));
    const entries = lines(rig);
    expect(entries.map((e) => e.who)).toEqual(['you', 'agent', 'agent']);
    expect(entries[2]).toEqual({ who: 'agent', text: 'Here is your box.' });
    expect(entries[1]?.text).toBe('Drew a rect');
  });

  it('a words-only answer is done and ok: the words are shown, and "The agent made nothing." is not', async () => {
    const rig = makeAgentRig({ transport: scripted([[{ say: 'The slope is 2.' }, { done: true }]]).transport, reducedMotion: true });
    const out = must(await rig.board.agent.service.talk('what is the slope?'));
    expect(out.made).toEqual([]);
    expect(lines(rig)).toEqual([
      { who: 'you', text: 'what is the slope?' },
      { who: 'agent', text: 'The slope is 2.' },
    ]);
    expect(rig.errors).toEqual([]);
  });

  it('an answer with no words and no action is still "The agent made nothing."', async () => {
    const rig = makeAgentRig({ transport: scripted([[{ say: '  ' }, { done: true }]]).transport, reducedMotion: true });
    must(await rig.board.agent.service.talk('hm'));
    expect(lines(rig).map((e) => e.who)).toEqual(['you', 'notice']);
    expect(lines(rig)[1]?.text).toBe('The agent made nothing.');
  });

  it('the words of an answer that failed part of the way are shown, before the failure notice', async () => {
    const rig = makeAgentRig({ transport: scripted([[{ say: 'Trying. ' }, { actions: [rect(10)] }, { error: { kind: 'model_busy', message: 'busy' } }]]).transport, reducedMotion: true });
    const r = await rig.board.agent.service.talk('draw');
    expect(r.ok).toBe(false);
    const entries = lines(rig);
    expect(entries.find((e) => e.text === 'Trying.')?.who).toBe('agent');
    expect(entries[entries.length - 1]?.who).toBe('notice');
  });

  it('a say that is not text fails the job as bad_stream', async () => {
    const rig = makeAgentRig({ transport: scripted([[{ say: 5 as unknown as string }, { done: true }]]).transport, reducedMotion: true });
    const r = await rig.board.agent.service.talk('hi');
    expect(r.ok).toBe(false);
    expect(rig.board.agent.service.job?.reason.kind).toBe('bad_stream');
  });

  it('the words of a replaced answer are not shown', async () => {
    const hold = gate();
    let n = 0;
    const transport = async function* (): AsyncGenerator<BoardAgentEvent> {
      n += 1;
      if (n === 1) {
        yield { say: 'OLD WORDS' };
        await hold.wait;
        yield { done: true };
        return;
      }
      yield { say: 'new words' };
      yield { done: true };
    };
    const rig = makeAgentRig({ transport, reducedMotion: true });
    const first = rig.board.agent.service.talk('first');
    await Promise.resolve();
    must(await rig.board.agent.service.talk('second'));
    hold.open();
    await first;
    const texts = lines(rig).map((e) => e.text);
    expect(texts).toContain('new words');
    expect(texts).not.toContain('OLD WORDS');
  });
});

describe('the panel shows the words', () => {
  let fake: FakeCanvas;
  let unsize: () => void;
  let container: HTMLElement;
  let board: Board | undefined;

  beforeEach(() => {
    fake = installCanvas2d();
    unsize = stubSize();
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    board?.dispose();
    container.remove();
    unsize();
    fake.restore();
  });

  it('a talk answered in words puts them in the conversation as the agent\'s line', async () => {
    board = must(createBoard({ container, canvas2dOnly: true, agent: { transport: scripted([[{ say: 'A parabola opens ' }, { say: 'upward.' }, { done: true }]]).transport, reducedMotion: true } }));
    must(await board.agent.service.talk('what is this?'));
    const panel = (board.element as HTMLElement).querySelector(`aside[aria-label="${BOARD_STRINGS['agent.label'] as string}"]`) as HTMLElement;
    const agentLines = [...panel.querySelectorAll('[data-who="agent"]')].map((n) => n.textContent);
    expect(agentLines).toEqual(['A parabola opens upward.']);
  });
});
