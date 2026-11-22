/**
 * `TURN_MACHINE` and `TOOL_MACHINE` against their tables in the docs: teacher design 6 (the table of the loop's states),
 * docs/state-machines.md TE1 and TE2. Every row is checked, and every move that has no row is refused and reported.
 */
import { describe, expect, it } from 'vitest';
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { TOOL_MACHINE, TURN_MACHINE } from '../../src/index';
import type { ToolMove, ToolState, TurnMove, TurnState } from '../../src/index';

const TURN_STATES: readonly TurnState[] = ['idle', 'calling', 'running_tool', 'done', 'limited', 'stopped', 'failed'];
const TURN_MOVES: readonly TurnMove[] = ['start', 'toolCall', 'replyEnd', 'cut', 'results', 'limit', 'abort', 'modelError'];

/** Rows of teacher design 6, with the event names of docs/state-machines.md TE1 (design 6 names them in words). */
const DESIGN_ROWS: readonly (readonly [TurnState, TurnMove, TurnState])[] = [
  ['idle', 'start', 'calling'],
  ['calling', 'toolCall', 'running_tool'],
  ['calling', 'replyEnd', 'done'],
  ['running_tool', 'toolCall', 'running_tool'],
  ['running_tool', 'results', 'calling'],
  ['calling', 'limit', 'limited'],
  ['running_tool', 'limit', 'limited'],
  ['calling', 'abort', 'stopped'],
  ['running_tool', 'abort', 'stopped'],
  ['calling', 'modelError', 'failed'],
];

/** Rows that docs/state-machines.md TE1 adds to design 6 (see the report: a contradiction between the two documents). */
const TE1_EXTRA_ROWS: readonly (readonly [TurnState, TurnMove, TurnState])[] = [
  ['calling', 'cut', 'done'],
  ['running_tool', 'cut', 'done'],
  ['running_tool', 'modelError', 'failed'],
];

const rowsOf = <S extends string, E extends string>(table: MachineTable<S, E>): string[] =>
  Object.entries(table).flatMap(([from, moves]) => Object.entries(moves as Record<string, string>).map(([event, to]) => `${from} -${event}-> ${to}`)).sort();

const asRows = (rows: readonly (readonly string[])[]): string[] => rows.map(([from, event, to]) => `${from} -${event}-> ${to}`).sort();

describe('TURN_MACHINE (design 6, TE1)', () => {
  it('every row of design 6 is in the table', () => {
    for (const [from, event, to] of DESIGN_ROWS) expect(TURN_MACHINE[from][event], `${from} ${event}`).toBe(to);
  });

  it('every row that TE1 adds is in the table', () => {
    for (const [from, event, to] of TE1_EXTRA_ROWS) expect(TURN_MACHINE[from][event], `${from} ${event}`).toBe(to);
  });

  it('the table is exactly the rows of TE1: design 6 and its additions, nothing else', () => {
    expect(rowsOf(TURN_MACHINE)).toEqual(asRows([...DESIGN_ROWS, ...TE1_EXTRA_ROWS]));
  });

  it('done, limited, stopped and failed are final: they take no event', () => {
    for (const s of ['done', 'limited', 'stopped', 'failed'] as const) expect(TURN_MACHINE[s]).toEqual({});
  });

  it('no state has a move to itself except running_tool on toolCall', () => {
    for (const s of TURN_STATES) for (const [event, to] of Object.entries(TURN_MACHINE[s])) if (to === s) expect([s, event]).toEqual(['running_tool', 'toolCall']);
  });

  for (const from of TURN_STATES) {
    for (const event of TURN_MOVES) {
      const to = TURN_MACHINE[from][event];
      if (to !== undefined) {
        it(`${from} on ${event} goes to ${to}`, () => {
          const refused: string[] = [];
          const m = new StateMachine(TURN_MACHINE, from, (f, e) => refused.push(`${f}/${e}`));
          expect(m.can(event)).toBe(true);
          expect(m.send(event)).toBe(true);
          expect(m.state).toBe(to);
          expect(refused).toEqual([]);
        });
      } else {
        it(`${from} on ${event} is refused and reported, and the state does not change`, () => {
          const refused: [string, string][] = [];
          const m = new StateMachine(TURN_MACHINE, from, (f, e) => refused.push([f, e]));
          expect(m.can(event)).toBe(false);
          expect(m.send(event)).toBe(false);
          expect(m.state).toBe(from);
          expect(refused).toEqual([[from, event]]);
        });
      }
    }
  }

  it('a whole turn walks the table: idle, calling, running_tool, calling, done', () => {
    const m = new StateMachine(TURN_MACHINE, 'idle', () => undefined);
    for (const event of ['start', 'toolCall', 'toolCall', 'results', 'replyEnd'] as const) expect(m.send(event), event).toBe(true);
    expect(m.state).toBe('done');
    expect(m.send('start')).toBe(false);
  });
});

describe('TOOL_MACHINE (TE2)', () => {
  const states: readonly ToolState[] = ['idle', 'running'];
  const moves: readonly ToolMove[] = ['begin', 'end'];
  const rows: readonly (readonly [ToolState, ToolMove, ToolState])[] = [
    ['idle', 'begin', 'running'],
    ['running', 'end', 'idle'],
  ];

  it('is exactly the two rows of TE2', () => {
    expect(rowsOf(TOOL_MACHINE)).toEqual(asRows(rows));
  });

  for (const from of states) {
    for (const event of moves) {
      const to = TOOL_MACHINE[from][event];
      it(`${from} on ${event}: ${to === undefined ? 'refused and reported' : `goes to ${to}`}`, () => {
        const refused: [string, string][] = [];
        const m = new StateMachine(TOOL_MACHINE, from, (f, e) => refused.push([f, e]));
        expect(m.send(event)).toBe(to !== undefined);
        expect(m.state).toBe(to ?? from);
        expect(refused).toEqual(to === undefined ? [[from, event]] : []);
      });
    }
  }
});
