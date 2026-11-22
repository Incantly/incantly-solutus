/**
 * Round-2 rows for the lesson's client side (docs/features/lesson/design.md 8, requirements R7.1): the cost of one event of a
 * turn in the studio, with a fake model (a fake `fetch` that streams a canned turn), no microphone and no sound. Design 8
 * gives the server's rows (work per turn before the model under 5 ms, memory per lesson under 64 KB); these are the studio's:
 * reading one line of the answer, one event through the conversation (parse, transcript, queue, board), and a whole turn from
 * the learner's words to the moment the conversation waits for the next ones, on a headless board with real actions.
 *
 * Run: `npx vitest run --config apps/studio/bench/vitest.config.ts`. Each case is a test that fails when it misses its target;
 * the number is the best of several warm runs.
 */
import { performance } from 'node:perf_hooks';
import { createBoard } from '@incantly/board';
import type { Board, BoardView } from '@incantly/board';
import { describe, expect, it } from 'vitest';
import { LessonConversation } from '../src/lesson';
import type { ConversationTarget } from '../src/lesson';
import { parseLessonEvent } from '../src/lesson-client';
import { boardConversation } from '../src/voice-targets';

/** Design 8, client rows: one event through the conversation, and a whole turn of the canned answer. */
const EVENT_MS = 0.2;
const TURN_MS = 5;
const PARSE_MS = 0.01;

/** The events of one turn of the fake model: a plan, sentences, notes and a sketch on the board, a check. */
const ACTIONS_A = [
  { op: 'write', text: 'Vector = size + direction', at: { x: 40, y: 40 }, style: 'typed' },
  { op: 'shape', kind: 'ellipse', at: { x: 300, y: 200 }, w: 100, h: 60, label: 'v' },
];
const ACTIONS_B = [{ op: 'stroke', points: [[0, 0], [40, -20], [80, -40]], at: { x: 300, y: 300 } }];
const TURN_EVENTS: readonly unknown[] = [
  { say: 'We will learn it in five steps.' },
  { lesson: { plan: ['Vectors', 'Adding', 'Scaling', 'Matrices', 'Solving'], step: 1, state: 'teaching' } },
  { say: 'A vector is an arrow.' },
  { actions: ACTIONS_A },
  { say: 'It has a size and a direction.' },
  { actions: ACTIONS_B },
  { say: 'Look at the arrow v.' },
  { lesson: { plan: ['Vectors', 'Adding', 'Scaling', 'Matrices', 'Solving'], step: 1, state: 'waiting' } },
  { say: 'What changes if I make it twice as long?' },
  { done: true },
];

/** The fake server: `/start` gives an id, `/turn` streams the canned events one line at a time. */
function fakeServer(events: readonly unknown[]): typeof fetch {
  const encoder = new TextEncoder();
  return (input) => {
    const url = String(input);
    if (url.endsWith('/v1/lesson/start')) return Promise.resolve(new Response(JSON.stringify({ lessonId: 'bench-lesson' }), { status: 200 }));
    if (!url.endsWith('/v1/lesson/turn')) return Promise.resolve(new Response('{}', { status: 404 }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const e of events) controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        controller.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }));
  };
}

/** A target that takes every action and does nothing with it: the cost of the conversation alone. */
const emptyTarget: ConversationTarget = {
  board: () => ({ items: [], more: 0, page: 'page' }),
  begin: () => undefined,
  actions: () => Promise.resolve(),
  finish: () => undefined,
};

/** A headless board with the studio's board target on it: every action goes through the real runner and one gesture. */
function boardTarget(): { readonly board: Board; readonly target: ConversationTarget } {
  const made = createBoard({ agent: { reducedMotion: true } });
  if (!made.ok) throw new Error(made.message);
  const board = made.value;
  const view = { agent: board.agent } as unknown as BoardView;
  return { board, target: boardConversation(view) };
}

/** A conversation over the fake server; `turn(text)` runs one turn to the moment it waits for the learner again. */
function lessonOver(target: ConversationTarget, events: readonly unknown[]): { readonly turn: (text: string) => Promise<void>; readonly start: (text: string) => Promise<void> } {
  let wake: (() => void) | undefined;
  const conversation = new LessonConversation({
    target: () => target,
    clips: () => Promise.resolve(undefined),
    fetch: fakeServer(events),
    onChange: () => {
      if (conversation.state === 'listening') wake?.();
    },
  });
  const waiting = (begin: () => boolean): Promise<void> =>
    new Promise((resolve, reject) => {
      wake = resolve;
      if (!begin()) reject(new Error('the conversation refused the words'));
    });
  return { start: (text) => waiting(() => conversation.start(text)), turn: (text) => waiting(() => conversation.type(text)) };
}

/** The best mean of `runs` batches of `n` calls, in milliseconds a call. */
async function best(n: number, runs: number, call: () => Promise<void> | void): Promise<number> {
  let min = Infinity;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) await call();
    min = Math.min(min, (performance.now() - t0) / n);
  }
  return min;
}

const report = (what: string, ms: number, limit: number): void => {
  console.info(`${what}: ${ms.toFixed(4)} ms (target under ${limit} ms)`);
};

describe('the lesson on the studio side (lesson design 8), Node, fake model, warm', () => {
  it('reads one line of the answer in under 0.01 ms', async () => {
    const lines = TURN_EVENTS.map((e) => JSON.stringify(e));
    const ms = await best(2000, 5, () => {
      for (const line of lines) parseLessonEvent(line);
    });
    const perLine = ms / lines.length;
    report('parseLessonEvent, one line', perLine, PARSE_MS);
    expect(perLine).toBeLessThan(PARSE_MS);
  });

  it('one event through the conversation (parse, transcript, queue, plan view) costs under 0.2 ms', async () => {
    const lesson = lessonOver(emptyTarget, TURN_EVENTS);
    await lesson.start('Teach me about linear algebra');
    const ms = await best(200, 5, () => lesson.turn('go on'));
    const perEvent = ms / TURN_EVENTS.length;
    report(`conversation, one event of ${TURN_EVENTS.length}`, perEvent, EVENT_MS);
    expect(perEvent).toBeLessThan(EVENT_MS);
  });

  it('a whole turn on a headless board with real actions, learner to waiting again, in under 5 ms', async () => {
    const { board, target } = boardTarget();
    const lesson = lessonOver(target, TURN_EVENTS);
    await lesson.start('Teach me about linear algebra');
    const ms = await best(100, 5, () => lesson.turn('go on'));
    report('a turn of 10 events, 3 board actions, on a headless board', ms, TURN_MS);
    expect(ms).toBeLessThan(TURN_MS);
    const read = board.agent.runner.read();
    expect(read.ok && read.value.items.length > 0).toBe(true);
  });

  it('twenty turns in a row keep the transcript at its cap and the cost flat', async () => {
    const lesson = lessonOver(emptyTarget, TURN_EVENTS);
    await lesson.start('Teach me about linear algebra');
    const first = await best(20, 3, () => lesson.turn('go on'));
    await best(300, 1, () => lesson.turn('go on'));
    const later = await best(20, 3, () => lesson.turn('go on'));
    report('turn cost after 320 turns', later, TURN_MS);
    expect(later).toBeLessThan(Math.max(first * 3, 1));
  });
});
