/**
 * `FIGURE_STREAM_MACHINE` against docs/state-machines.md TE3 (the figure stream of prompt to figure): every row of the
 * table is in it, nothing else is, and every move with no row is refused and reported.
 */
import { describe, expect, it } from 'vitest';
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { FIGURE_STREAM_MACHINE } from '../../src/index';
import type { FigureStreamMove, FigureStreamState } from '../../src/index';

const STATES: readonly FigureStreamState[] = ['idle', 'planning', 'scripting', 'repairing', 'done', 'limited', 'stopped', 'failed'];
const MOVES: readonly FigureStreamMove[] = ['plan', 'script', 'planned', 'repair', 'finish', 'cut', 'unusable', 'limit', 'abort', 'modelError'];

/** The transition table of TE3, row by row (a row with several `From` states is written once for each). */
const TE3_ROWS: readonly (readonly [FigureStreamState, FigureStreamMove, FigureStreamState])[] = [
  ['idle', 'plan', 'planning'],
  ['idle', 'script', 'scripting'],
  ['planning', 'planned', 'scripting'],
  ['scripting', 'repair', 'repairing'],
  ['scripting', 'finish', 'done'],
  ['scripting', 'cut', 'done'],
  ['repairing', 'finish', 'done'],
  ['planning', 'limit', 'limited'],
  ['scripting', 'limit', 'limited'],
  ['repairing', 'limit', 'limited'],
  ['planning', 'abort', 'stopped'],
  ['scripting', 'abort', 'stopped'],
  ['repairing', 'abort', 'stopped'],
  ['planning', 'modelError', 'failed'],
  ['scripting', 'modelError', 'failed'],
  ['scripting', 'unusable', 'failed'],
  ['repairing', 'unusable', 'failed'],
  ['repairing', 'cut', 'done'],
];

const rowsOf = <S extends string, E extends string>(table: MachineTable<S, E>): string[] =>
  Object.entries(table).flatMap(([from, moves]) => Object.entries(moves as Record<string, string>).map(([event, to]) => `${from} -${event}-> ${to}`)).sort();

describe('FIGURE_STREAM_MACHINE (TE3)', () => {
  it('every row of TE3 is in the table', () => {
    for (const [from, event, to] of TE3_ROWS) expect(FIGURE_STREAM_MACHINE[from][event], `${from} ${event}`).toBe(to);
  });

  it('the table is exactly the rows of TE3, nothing else', () => {
    expect(rowsOf(FIGURE_STREAM_MACHINE)).toEqual(TE3_ROWS.map(([f, e, t]) => `${f} -${e}-> ${t}`).sort());
  });

  it('done, limited, stopped and failed are final: they take no event', () => {
    for (const s of ['done', 'limited', 'stopped', 'failed'] as const) expect(FIGURE_STREAM_MACHINE[s]).toEqual({});
  });

  it('the states are the eight of TE3', () => {
    expect(Object.keys(FIGURE_STREAM_MACHINE).sort()).toEqual([...STATES].sort());
  });

  it('the "reachable invalid" notes of TE3 hold: plan and script only from idle; repair not from planning; modelError not from repairing', () => {
    for (const s of STATES) {
      if (s !== 'idle') {
        expect(FIGURE_STREAM_MACHINE[s]['plan'], `${s} plan`).toBeUndefined();
        expect(FIGURE_STREAM_MACHINE[s]['script'], `${s} script`).toBeUndefined();
      }
    }
    expect(FIGURE_STREAM_MACHINE.planning['repair']).toBeUndefined();
    expect(FIGURE_STREAM_MACHINE.repairing['modelError']).toBeUndefined();
  });

  it('the plan call never writes lines: planning has no finish or cut', () => {
    expect(FIGURE_STREAM_MACHINE.planning['finish']).toBeUndefined();
    expect(FIGURE_STREAM_MACHINE.planning['cut']).toBeUndefined();
  });

  it('no state loops back to an earlier one (the repair call runs at most once)', () => {
    const order: Record<string, number> = { idle: 0, planning: 1, scripting: 2, repairing: 3, done: 4, limited: 4, stopped: 4, failed: 4 };
    for (const [from, event, to] of TE3_ROWS) expect(order[to] ?? -1, `${from} ${event}`).toBeGreaterThan(order[from] ?? 99);
  });

  for (const from of STATES) {
    for (const event of MOVES) {
      const to = FIGURE_STREAM_MACHINE[from][event];
      if (to !== undefined) {
        it(`${from} on ${event} goes to ${to}`, () => {
          const refused: string[] = [];
          const m = new StateMachine(FIGURE_STREAM_MACHINE, from, (f, e) => refused.push(`${f}/${e}`));
          expect(m.can(event)).toBe(true);
          expect(m.send(event)).toBe(true);
          expect(m.state).toBe(to);
          expect(refused).toEqual([]);
        });
      } else {
        it(`${from} on ${event} is refused and reported, and the state does not change`, () => {
          const refused: [string, string][] = [];
          const m = new StateMachine(FIGURE_STREAM_MACHINE, from, (f, e) => refused.push([f, e]));
          expect(m.can(event)).toBe(false);
          expect(m.send(event)).toBe(false);
          expect(m.state).toBe(from);
          expect(refused).toEqual([[from, event]]);
        });
      }
    }
  }
});
