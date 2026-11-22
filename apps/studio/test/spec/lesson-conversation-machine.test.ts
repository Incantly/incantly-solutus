/**
 * Lesson round 2, the studio's conversation machine (lesson design 6 `CONVERSATION_MACHINE`, docs/state-machines.md LE2,
 * requirements R6). The rows are read from the LE2 table in the doc, not copied: the exported table must hold exactly the
 * rows the doc lists, every other pair of state and move is refused and reported, and the public calls of the conversation
 * do what the table says in every state and never make a refused move (no fault is reported). The conversation is the one of
 * `lesson.ts`, with a fake server, fake recogniser, fake clips and a fake timer.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StateMachine } from '@incantly/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { CONVERSATION_MACHINE } from '../../src/lesson';
import type { ConversationMove, ConversationState } from '../../src/lesson';
import { endRigs, reach, rig, toListening, toSpeaking, turnOf } from './lesson-helpers';
import type { Rig } from './lesson-helpers';

afterEach(endRigs);

const doc = readFileSync(resolve(process.cwd(), 'docs/state-machines.md'), 'utf8');

/** The LE2 section of the doc: from its heading to the next heading of the same level. */
function le2(): string {
  const from = doc.indexOf('### LE2. Conversation (studio)');
  expect(from).toBeGreaterThan(0);
  const next = doc.indexOf('\n### ', from + 10);
  return doc.slice(from, next === -1 ? undefined : next);
}

const ticks = (cell: string): string[] => [...cell.matchAll(/`([a-z]+)`/g)].map((m) => m[1] as string);

/** The rows of the LE2 transitions table, one entry for each (from, move) pair. */
function docRows(): [ConversationState, ConversationMove, ConversationState][] {
  const section = le2();
  const start = section.indexOf('- **Transitions:**');
  const stop = section.indexOf('- **Reachable invalid');
  expect(start).toBeGreaterThan(0);
  expect(stop).toBeGreaterThan(start);
  const rows: [ConversationState, ConversationMove, ConversationState][] = [];
  for (const line of section.slice(start, stop).split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const froms = ticks(cells[1] ?? '');
    const moves = ticks(cells[2] ?? '');
    const to = ticks(cells[4] ?? '')[0];
    expect(to, line).toBeDefined();
    for (const f of froms) for (const m of moves) rows.push([f as ConversationState, m as ConversationMove, to as ConversationState]);
  }
  return rows;
}

const STATES: ConversationState[] = ['off', 'listening', 'thinking', 'speaking', 'paused'];
const MOVES: ConversationMove[] = ['start', 'listen', 'heard', 'type', 'play', 'wait', 'drained', 'pause', 'end'];

describe('LE2: the table of the doc is the table of the code', () => {
  const rows = docRows();

  it('the doc lists 22 rows, with the five states and nine moves the doc names', () => {
    expect(rows).toHaveLength(22);
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(STATES));
    expect(new Set(rows.map((r) => r[1]))).toEqual(new Set(MOVES));
  });

  it.each(rows)('%s --%s--> %s', (from, move, to) => {
    const faults: string[] = [];
    const m = new StateMachine(CONVERSATION_MACHINE, from, (f, e) => faults.push(`${f}/${e}`));
    expect(m.send(move)).toBe(true);
    expect(m.state).toBe(to);
    expect(faults).toEqual([]);
  });

  it('every other pair of state and move is refused, reported once, and leaves the state where it was', () => {
    const allowed = new Set(rows.map(([f, m]) => `${f}/${m}`));
    let refused = 0;
    for (const from of STATES) {
      for (const move of MOVES) {
        if (allowed.has(`${from}/${move}`)) continue;
        const faults: string[] = [];
        const m = new StateMachine(CONVERSATION_MACHINE, from, (f, e) => faults.push(`${f}/${e}`));
        expect(m.send(move), `${from}/${move}`).toBe(false);
        expect(m.state, `${from}/${move}`).toBe(from);
        expect(faults, `${from}/${move}`).toEqual([`${from}/${move}`]);
        refused += 1;
      }
    }
    expect(refused).toBe(STATES.length * MOVES.length - rows.length);
  });

  it('the table has no row the doc does not list (22 pairs in all)', () => {
    const inCode = STATES.flatMap((s) => Object.keys(CONVERSATION_MACHINE[s]).map((m) => `${s}/${m}`)).sort();
    expect(inCode).toEqual(rows.map(([f, m]) => `${f}/${m}`).sort());
  });

  it('the doc names the invalid pairs that are reachable, and the table has no row for them', () => {
    const invalid: [ConversationState, ConversationMove][] = [
      ['listening', 'play'],
      ['listening', 'wait'],
      ['paused', 'play'],
      ['paused', 'wait'],
      ['off', 'play'],
      ['off', 'wait'],
      ['thinking', 'heard'],
      ['speaking', 'heard'],
      ['paused', 'heard'],
      ['off', 'heard'],
      ['listening', 'listen'],
      ['paused', 'pause'],
      ['off', 'pause'],
      ['thinking', 'start'],
      ['listening', 'start'],
      ['speaking', 'start'],
      ['paused', 'start'],
      ['off', 'end'],
    ];
    for (const [from, move] of invalid) expect(CONVERSATION_MACHINE[from][move], `${from}/${move}`).toBeUndefined();
  });
});

// ---- the public calls in every state ------------------------------------------------------------------------------------

type Call = 'start' | 'listen' | 'tap' | 'interrupt' | 'type' | 'pause' | 'end';

/** What each public call gives in each state, by the doc (design 6 and LE2): the answer and the state after. */
const EXPECT: Record<ConversationState, Partial<Record<Call, [boolean, ConversationState]>>> = {
  off: {
    start: [true, 'thinking'],
    listen: [true, 'listening'],
    tap: [true, 'listening'],
    type: [false, 'off'],
    pause: [false, 'off'],
    end: [false, 'off'],
  },
  listening: {
    start: [false, 'listening'],
    listen: [false, 'listening'],
    tap: [true, 'paused'],
    type: [true, 'thinking'],
    pause: [true, 'paused'],
    end: [true, 'off'],
  },
  thinking: {
    start: [false, 'thinking'],
    listen: [true, 'listening'],
    tap: [true, 'listening'],
    interrupt: [true, 'listening'],
    type: [true, 'thinking'],
    pause: [true, 'paused'],
    end: [true, 'off'],
  },
  speaking: {
    start: [false, 'speaking'],
    listen: [true, 'listening'],
    tap: [true, 'listening'],
    interrupt: [true, 'listening'],
    type: [true, 'thinking'],
    pause: [true, 'paused'],
    end: [true, 'off'],
  },
  paused: {
    start: [false, 'paused'],
    listen: [true, 'listening'],
    tap: [true, 'listening'],
    interrupt: [true, 'listening'],
    type: [true, 'thinking'],
    pause: [false, 'paused'],
    end: [true, 'off'],
  },
};

async function inState(state: ConversationState): Promise<Rig> {
  const r = rig();
  if (state === 'off') return r;
  if (state === 'speaking') await toSpeaking(r);
  else if (state === 'listening') await toListening(r);
  else if (state === 'paused') {
    await toListening(r);
    expect(r.conversation.pause()).toBe(true);
  } else {
    expect(r.conversation.start('Teach me about vectors')).toBe(true);
    await turnOf(r);
  }
  expect(r.conversation.state).toBe(state);
  return r;
}

function call(r: Rig, what: Call): boolean {
  switch (what) {
    case 'start':
      return r.conversation.start('Teach me about vectors');
    case 'listen':
      return r.conversation.listen();
    case 'tap':
      return r.conversation.tap();
    case 'interrupt':
      return r.conversation.interrupt();
    case 'type':
      return r.conversation.type('an answer');
    case 'pause':
      return r.conversation.pause();
    case 'end':
      return r.conversation.end();
  }
}

describe('the conversation\'s calls in each state (LE2 rows, and a refused move reported as a bug)', () => {
  const cases = STATES.flatMap((state) => (Object.entries(EXPECT[state]) as [Call, [boolean, ConversationState]][]).map(([what, [result, to]]) => [state, what, result, to] as const));

  it.each(cases)('in %s, %s() gives %s and the state is %s', async (state, what, result, to) => {
    const r = await inState(state);
    expect(call(r, what)).toBe(result);
    expect(r.conversation.state).toBe(to);
    // a call the table refuses is asked of the machine first (`can`), so no refused move is ever reported
    expect(r.faults).toEqual([]);
  });

  it('a call with nothing to send changes nothing in any state: start(""), type("   ")', async () => {
    for (const state of STATES) {
      const r = await inState(state);
      expect(r.conversation.start('')).toBe(false);
      expect(r.conversation.type('   ')).toBe(false);
      expect(r.conversation.state).toBe(state);
      expect(r.faults).toEqual([]);
    }
  });

  it('the conversation begins off, with an empty transcript and no microphone', () => {
    const r = rig();
    expect(r.conversation.state).toBe('off');
    expect(r.conversation.transcript).toEqual([]);
    expect(r.conversation.micOpen).toBe(false);
    expect(r.conversation.view.plan).toEqual([]);
  });

  it('walking the whole machine by the public calls reports no fault: off, thinking, speaking, listening, paused, listening, thinking, off', async () => {
    const r = rig();
    await toSpeaking(r);
    r.audio.clip('S1').end();
    await reach(r, 'speaking');
    expect(r.conversation.tap()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(r.conversation.tap()).toBe(true);
    expect(r.conversation.state).toBe('paused');
    expect(r.conversation.tap()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(r.conversation.type('go on')).toBe(true);
    expect(r.conversation.state).toBe('thinking');
    expect(r.conversation.end()).toBe(true);
    expect(r.conversation.state).toBe('off');
    expect(r.faults).toEqual([]);
  });
});
