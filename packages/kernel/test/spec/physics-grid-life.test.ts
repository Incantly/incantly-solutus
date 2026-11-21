/**
 * The life of a smoke or fire grid (docs/state-machines.md, "Explicit since the lint rules"): `GRID_MACHINE` writes
 * only the moves that may happen, and a checkpoint load puts the life in the state the checkpoint saved.
 */
import { describe, expect, it } from 'vitest';
import { StateMachine } from '../../src/contracts/state-machine';
import { GRID_MACHINE, restoreLife } from '../../src/physics/grid-life';

describe('GRID_MACHINE', () => {
  it('has a row for each state, and the rows differ', () => {
    expect(Object.keys(GRID_MACHINE).sort()).toEqual(['running', 'unstable']);
    expect(GRID_MACHINE.running).toEqual({ blowUp: 'unstable' });
    expect(GRID_MACHINE.unstable).toEqual({ reset: 'running' });
  });

  it('refuses reset while running and blowUp while unstable, and changes nothing', () => {
    const life = new StateMachine(GRID_MACHINE, 'running');
    expect(life.send('reset')).toBe(false);
    expect(life.state).toBe('running');
    expect(life.send('blowUp')).toBe(true);
    expect(life.send('blowUp')).toBe(false);
    expect(life.state).toBe('unstable');
    expect(life.send('reset')).toBe(true);
    expect(life.state).toBe('running');
  });
});

describe('restoreLife (a checkpoint load)', () => {
  it('gives the saved state from either state, with no move the table refuses', () => {
    for (const from of ['running', 'unstable'] as const) {
      for (const saved of [false, true]) {
        const refused: string[] = [];
        const life = new StateMachine(GRID_MACHINE, from, (s, e) => refused.push(`${s}|${e}`));
        restoreLife(life, saved);
        expect(life.state, `${from} then a checkpoint that was ${saved ? 'unstable' : 'running'}`).toBe(saved ? 'unstable' : 'running');
        expect(refused).toEqual([]);
      }
    }
  });
});
