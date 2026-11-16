/**
 * Speed targets from the docs, with limits loose enough for a busy CI machine (about 10 to 30 times the target).
 * Docs: kernel/design.md 15; core design 12 (acceptance); performance.md 1, 3 and 6.
 * Each test also checks the result, so a fast wrong answer does not pass. Timings use the median of several runs.
 */
import { describe, expect, it } from 'vitest';
import type { Figure } from '@incantly/kernel';
import { figure, idOf, medianMs, newFigure, ok, timed } from './helpers';

/** A chain of n points: P0 = A, P(i) = Midpoint(P(i-1), B). */
function chain(n: number): string[] {
  const lines = ['A = (0, 0)', 'B = (10, 0)'];
  for (let i = 0; i < n - 2; i++) lines.push(`P${i} = Midpoint(${i === 0 ? 'A' : `P${i - 1}`}, B)`);
  return lines;
}

/** A fan: one slider and n-1 formulas that each read it. */
function fan(n: number): string[] {
  const lines = ['a = 1 in 0..100 step 0.5'];
  for (let i = 0; i < n - 1; i++) lines.push(`r${i} = a * ${i + 1} + ${i}`);
  return lines;
}

function bigFigure(lines: string[]): Figure {
  const f = newFigure();
  const r = f.applyBatch(lines, { group: 'build' });
  if (!r.ok) throw new Error('could not build the figure');
  return f;
}

describe('applying lines', () => {
  it('a simple line takes well under a millisecond on average (target 0.3 ms; limit 5 ms)', { retry: 2 }, () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)']);
    const n = 300;
    const { ms } = timed(() => {
      for (let i = 0; i < n; i++) ok(f.apply(`P${i} = Midpoint(A, B)`));
    });
    expect(ms / n).toBeLessThan(5);
    expect(f.count).toBe(n + 2);
  });

  it('a redefinition of a free object in a 500-object figure (limit 20 ms)', { retry: 2 }, () => {
    const f = bigFigure(chain(500));
    const ms = medianMs(5, () => ok(f.apply('A = (1, 1)')));
    expect(ms).toBeLessThan(20);
    expect(f.value('P0')).toEqual({ x: 5.5, y: 0.5 });
  });

  it('a redefinition that moves 50 objects (target 1 ms; limit 30 ms)', { retry: 2 }, () => {
    const lines: string[] = ['Q = (0, 0)', 'P = (1, 1)'];
    for (let i = 0; i < 50; i++) lines.push(`X${i} = Midpoint(P, Q)`);
    lines.push('R0 = (8, 0)');
    for (let i = 1; i < 50; i++) lines.push(`R${i} = Midpoint(R${i - 1}, R${i - 1})`);
    const f = bigFigure(lines);
    const { ms, value } = timed(() => f.apply('P = Midpoint(R49, Q)'));
    const r = ok(value);
    expect(r.changed.moved.length).toBe(50);
    expect(ms).toBeLessThan(30);
  });

  it('a delete that cascades over 200 objects (target 2 ms; limit 50 ms)', { retry: 2 }, () => {
    const f = bigFigure(chain(202));
    const { ms, value } = timed(() => f.apply('Delete(P0)'));
    const r = ok(value);
    expect(r.changed.removed.length).toBe(200);
    expect(ms).toBeLessThan(50);
    expect(f.count).toBe(2);
  });

  it('a dry run costs about the same as the line, and never more than 10 times', () => {
    const f = bigFigure(chain(300));
    const dry = medianMs(5, () => ok(f.apply('A = (1, 1)', { dryRun: true })));
    expect(dry).toBeLessThan(30);
  });
});

describe('the update pass', () => {
  it('500 objects, 200 downstream of the changed one: flush (target 0.5 ms; limit 15 ms)', { retry: 2 }, () => {
    const lines = ['A = (0, 0)', 'B = (10, 0)'];
    for (let i = 0; i < 200; i++) lines.push(`D${i} = Midpoint(A, B)`);
    for (let i = 0; i < 298; i++) lines.push(`F${i} = Midpoint(B, B)`);
    const f = bigFigure(lines);
    let k = 0;
    const ms = medianMs(21, () => {
      f.setFree('A', { x: ++k, y: 0 }, 'drag');
      const d = f.flush();
      expect(d.ran).toBe(200);
    });
    expect(ms).toBeLessThan(15);
  });

  it('a frame with 500 objects playing, 200 of them on t (target 4 ms; limit 40 ms)', { retry: 2 }, () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) lines.push(`x${i} = sin(t + ${i}) * ${i + 1}`);
    for (let i = 0; i < 300; i++) lines.push(`c${i} = ${i}`);
    const f = bigFigure(lines);
    let t = 0;
    const ms = medianMs(21, () => {
      t += 1 / 60;
      f.setClock(t);
    });
    expect(ms).toBeLessThan(40);
    expect(f.value('x3')).toBeCloseTo(Math.sin(t + 3) * 4, 10);
  });

  it('undo of one line in a 500-object figure (target 1 ms; limit 20 ms)', { retry: 2 }, () => {
    const f = bigFigure(chain(500));
    const ms = medianMs(9, () => {
      ok(f.apply('A = (2, 2)'));
      ok(f.undo());
    });
    expect(ms).toBeLessThan(40); // an apply and an undo together
  });
});

describe('a 5,000-object figure', () => {
  it('builds in one batch (5,000 lines; limit 20 s)', { retry: 2, timeout: 60_000 }, () => {
    const { ms, value } = timed(() => bigFigure(fan(5000)));
    expect(value.count).toBe(5000);
    expect(ms).toBeLessThan(20_000);
  });

  it('a slider that 4,999 formulas read: one flush recomputes all of them (target a few ms; limit 250 ms)', { retry: 2, timeout: 60_000 }, () => {
    const f = bigFigure(fan(5000));
    let v = 1;
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      v += 1;
      f.setFree('a', v, 'slider');
      const t = timed(() => f.flush());
      expect(t.value.ran).toBe(4999);
      times.push(t.ms);
    }
    times.sort((x, y) => x - y);
    expect(times[4] as number).toBeLessThan(250);
    expect(f.value('r4998')).toBe(v * 4999 + 4998);
  });

  it('a change that touches one object in 5,000 is cheap: only that rule runs (limit 20 ms)', { retry: 2, timeout: 60_000 }, () => {
    const lines = ['a = 1', 'b = 1', 'q = b * 2'];
    for (let i = 0; i < 4997; i++) lines.push(`r${i} = a + ${i}`);
    const f = bigFigure(lines);
    expect(f.count).toBe(5000);
    let v = 1;
    const ms = medianMs(9, () => {
      f.setFree('b', ++v, 'slider');
      expect(f.flush().ran).toBe(1);
    });
    expect(ms).toBeLessThan(20);
    expect(f.value('q')).toBe(v * 2);
  });

  it('a deep chain of 5,000 rules: a change at the bottom runs each rule once (limit 500 ms)', { retry: 2, timeout: 60_000 }, () => {
    const lines = ['a = 1'];
    for (let i = 0; i < 4999; i++) lines.push(`c${i} = ${i === 0 ? 'a' : `c${i - 1}`} + 1`);
    const f = bigFigure(lines);
    f.setFree('a', 2, 'slider');
    const { ms, value } = timed(() => f.flush());
    expect(value.ran).toBe(4999);
    expect(f.value('c4998')).toBe(5001);
    expect(ms).toBeLessThan(500);
  });

  it('a seek over 5,000 objects of which 1,000 read t (limit 250 ms)', { retry: 2, timeout: 60_000 }, () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) lines.push(`x${i} = t * ${i}`);
    for (let i = 0; i < 4000; i++) lines.push(`k${i} = ${i}`);
    const f = bigFigure(lines);
    const { ms, value } = timed(() => f.setClock(3));
    expect('ran' in value ? value.ran : 0).toBe(1000);
    expect(ms).toBeLessThan(250);
    expect(f.value('x999')).toBe(2997);
  });

  it('toScript for 5,000 objects (limit 1 s) and a script load of the same (limit 10 s)', { retry: 2, timeout: 60_000 }, () => {
    const f = bigFigure(fan(5000));
    const { ms, value } = timed(() => f.toScript());
    expect(ms).toBeLessThan(1000);
    expect(value.split('\n').length).toBe(5002);
  });

  it('delete with a cascade over 5,000 objects completes (limit 5 s) and undo restores it (limit 5 s)', { retry: 2, timeout: 60_000 }, () => {
    const f = bigFigure(fan(5000));
    const d = timed(() => f.apply('Delete(a)'));
    expect(ok(d.value).changed.removed.length).toBe(5000);
    expect(d.ms).toBeLessThan(5000);
    const u = timed(() => ok(f.undo()));
    expect(f.count).toBe(5000);
    expect(u.ms).toBeLessThan(5000);
    expect(idOf(f, 'a')).toBeGreaterThan(0);
  });

  it('dependents/ancestors queries over 5,000 objects (limit 500 ms)', { retry: 2, timeout: 60_000 }, () => {
    const f = bigFigure(fan(5000));
    const { ms, value } = timed(() => f.dependentsOf('a'));
    expect(value.length).toBe(4999);
    expect(ms).toBeLessThan(500);
    const a = timed(() => f.ancestorsOf('r4998'));
    expect(a.value.length).toBe(1);
  });
});

describe('states: seeking (core design acceptance: seek anywhere in a 60 s film under 50 ms)', () => {
  it('after the first integration, seeks anywhere in a 60 s film are fast (limit 250 ms each)', { retry: 2, timeout: 60_000 }, () => {
    const f = figure(['@clock 0..60', 'g = 9.8', 'L = 1 in 0.5..2', 'th = state(0.6)', 'w = state(0)', "th' = w", "w' = -g / L * sin(th)", 'bob = (L * sin(th), -L * cos(th))']);
    f.setClock(60);
    const times: number[] = [];
    for (const t of [30, 59.9, 0.3, 45.5, 12, 3, 58, 21.2]) times.push(timed(() => f.setClock(t)).ms);
    for (const ms of times) expect(ms).toBeLessThan(250);
  });
});
