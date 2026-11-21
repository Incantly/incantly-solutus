/**
 * The figure's lifecycle table (docs/state-machines.md T1): every row, and every move the table does not list.
 */
import { describe, expect, it } from 'vitest';
import { StateMachine, transition } from '@incantly/kernel';
import { FIGURE_MACHINE } from '../../src/node-view';
import type { FigureLife, FigureLifeEvent } from '../../src/node-view';

const STATES: readonly FigureLife[] = ['idle', 'mounting', 'live', 'saving', 'lost', 'dead', 'destroyed'];
const EVENTS: readonly FigureLifeEvent[] = ['claim', 'release', 'mounted', 'unmounted', 'lose', 'regain', 'giveUp', 'revive', 'destroy'];
const claimed = new Set<FigureLife>(['mounting', 'live', 'lost']);

describe('FIGURE_MACHINE', () => {
  it('has a row for every state, and only moves to known states', () => {
    expect(Object.keys(FIGURE_MACHINE).sort()).toEqual([...STATES].sort());
    for (const s of STATES) for (const e of EVENTS) {
      const to = transition(FIGURE_MACHINE, s, e);
      if (to !== undefined) expect(STATES).toContain(to);
    }
  });

  it('can destroy from every state, and nothing leaves destroyed', () => {
    for (const s of STATES) if (s !== 'destroyed') expect(transition(FIGURE_MACHINE, s, 'destroy')).toBe('destroyed');
    for (const e of EVENTS) expect(transition(FIGURE_MACHINE, 'destroyed', e)).toBeUndefined();
  });

  it('releasing a claim never leaves a claimed state', () => {
    for (const s of STATES) {
      const to = transition(FIGURE_MACHINE, s, 'release');
      if (to !== undefined) expect(claimed.has(to)).toBe(false);
    }
  });

  it('a dead figure takes no claim and only comes back by revive', () => {
    expect(transition(FIGURE_MACHINE, 'dead', 'claim')).toBeUndefined();
    expect(transition(FIGURE_MACHINE, 'dead', 'revive')).toBe('idle');
    expect(transition(FIGURE_MACHINE, 'live', 'giveUp')).toBeUndefined();
  });

  it('only a live figure loses its context, and only a lost one gets it back', () => {
    for (const s of STATES) {
      expect(transition(FIGURE_MACHINE, s, 'lose') !== undefined).toBe(s === 'live');
      expect(transition(FIGURE_MACHINE, s, 'regain') !== undefined).toBe(s === 'lost');
    }
  });

  it('a refused move changes nothing and is reported', () => {
    const refused: string[] = [];
    const m = new StateMachine(FIGURE_MACHINE, 'idle', (from, e) => refused.push(`${from}:${e}`));
    expect(m.send('mounted')).toBe(false);
    expect(m.state).toBe('idle');
    expect(refused).toEqual(['idle:mounted']);
    expect(m.send('claim')).toBe(true);
    expect(m.is('mounting')).toBe(true);
  });
});
