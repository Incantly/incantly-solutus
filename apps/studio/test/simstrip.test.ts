/** The simulation strip (docs/features/probability/ui.md 6): its pure parts, and the strip in the mounted page. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Figure, dist } from '@incantly/kernel';
import { countSliders, dieFaces, hasRandom, helperLines, kolmogorov, samplesOf, seedOf, tallyOf } from '../src/simstrip';
import { studioRegistry } from '../src/registry';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

const registry = studioRegistry();
const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};

describe('reading the figure', () => {
  it('finds random objects, samples and their free counts', () => {
    const f = fig(['n = 20 in 1..500 step 1', 'xs = Sample(Normal(0, 1), n)', 'ys = Sample(Poisson(3), 5)', 'zs = Sample([1, 2, 3], 2)']);
    expect(hasRandom(f)).toBe(true);
    expect(hasRandom(fig(['a = 1']))).toBe(false);
    expect(samplesOf(f).map((s) => [s.name, s.dist, s.count])).toEqual([['xs', 'Normal(0, 1)', 'n'], ['ys', 'Poisson(3)', '5'], ['zs', '[1, 2, 3]', '2']]);
    expect(countSliders(f)).toEqual([{ name: 'n', samples: ['xs'], value: 20, min: 1, max: 500 }]);
  });
  it('reads the seed', () => {
    expect(seedOf('@seed 42\na = 1')).toBe(42);
    expect(seedOf('a = 1')).toBe(1);
  });
});

describe('the tally (empirical against theoretical)', () => {
  it('a discrete sample: one bar per value, with the largest gap', () => {
    const d = dist('Binomial', [4, 0.5]);
    const t = tallyOf([0, 1, 1, 2, 2, 2, 3, 4], d);
    expect(t.discrete).toBe(true);
    expect(t.bars.map((b) => (b.lo + b.hi) / 2)).toEqual([0, 1, 2, 3, 4]);
    expect(t.bars[2]?.seen).toBeCloseTo(3 / 8, 12);
    expect(t.bars[2]?.expected).toBeCloseTo(6 / 16, 12);
    const gap = Math.max(...t.bars.map((b) => Math.abs(b.seen - b.expected)));
    expect(t.distance).toBeCloseTo(gap, 12);
    expect(t.label).toMatch(/largest bar gap/);
  });
  it('a continuous sample: bins and the Kolmogorov distance', () => {
    const d = dist('Uniform', [0, 1]);
    const xs = Array.from({ length: 100 }, (_, i) => (i + 0.5) / 100);
    const t = tallyOf(xs, d);
    expect(t.discrete).toBe(false);
    expect(t.bars.reduce((a, b) => a + b.seen, 0)).toBeCloseTo(1, 12);
    expect(t.distance).toBeCloseTo(0.005, 12);
    expect(kolmogorov(xs, d)).toBeCloseTo(0.005, 12);
  });
  it('a large sample of the right distribution is close to it', () => {
    const f = fig(['xs = Sample(Normal(0, 1), 5000, seed = 3)']);
    const t = tallyOf(f.value('xs') as ArrayLike<number>, dist('Normal', [0, 1]));
    expect(t.distance).toBeLessThan(0.03);
  });
});

describe('the Simulate helpers', () => {
  it.each(['coin', 'die', 'dice', 'spinner'] as const)('%s writes lines that apply', (kind) => {
    const lines = helperLines(kind, { sample: 's', n: 'n' });
    expect(lines[0]).toBe('n = 10 in 1..1000 step 1');
    expect(lines[1]).toMatch(/^s = Sample\(Discrete\(/);
    const f = fig(lines);
    expect((f.value('s') as ArrayLike<number>).length).toBe(10);
  });
  it('two dice sum from 2 to 12 with the triangle of chances', () => {
    const f = fig([...helperLines('dice', { sample: 's', n: 'n' }), 'p = Pdf(Discrete([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1] / 36), 7)']);
    expect(f.value('p')).toBeCloseTo(6 / 36, 12);
    for (const v of Array.from(f.value('s') as ArrayLike<number>)) expect(v >= 2 && v <= 12).toBe(true);
  });
  it('die faces are shown for fewer than 12 rolls', () => {
    expect(dieFaces([1, 6, 3])).toBe('⚀ ⚅ ⚂');
    expect(dieFaces(new Array<number>(12).fill(1))).toBeUndefined();
    expect(dieFaces([0, 7])).toBeUndefined();
  });
});

describe('the strip in the page', () => {
  let root: HTMLElement;
  let m: Mounted;
  let tick: (() => void) | undefined;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    tick = undefined;
    m = mountStudio(root, {
      raf: () => 1,
      caf: () => undefined,
      every: (_ms, fn) => {
        tick = fn;
        return () => {
          tick = undefined;
        };
      },
    });
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });
  const strip = (): HTMLElement => root.querySelector('.sim-strip') as HTMLElement;

  it('is hidden until a random object exists, then shows under the graph', () => {
    expect(strip().hidden).toBe(true);
    m.session.applyLines(['n = 5 in 1..8 step 1', 'xs = Sample(Poisson(3), n)'], 'test');
    expect(strip().hidden).toBe(false);
    expect(root.querySelector('.graph')?.classList.contains('has-sim')).toBe(true);
    expect(strip().querySelector('input[aria-label="Samples n"]')).not.toBeNull();
    expect(strip().querySelectorAll('.sim-bar').length).toBeGreaterThan(0);
    expect(strip().querySelector('.sim-gap')?.textContent).toMatch(/5 draws · largest bar gap/);
  });

  it('opens from the probability panel with no random object', () => {
    m.calc.open();
    const btn = [...root.querySelectorAll<HTMLButtonElement>('.probcalc button')].find((b) => b.textContent === 'Simulation strip') as HTMLButtonElement;
    btn.click();
    expect(strip().hidden).toBe(false);
  });

  it('the seed field writes @seed and Reroll adds one', () => {
    m.session.applyLines(['xs = Sample(Normal(0, 1), 5)'], 'test');
    const before = Array.from(m.session.figure.value('xs') as ArrayLike<number>);
    const seed = strip().querySelector('input[aria-label="Seed"]') as HTMLInputElement;
    seed.value = '7';
    seed.dispatchEvent(new Event('change'));
    expect(m.session.save()).toMatch(/^@seed 7$/m);
    const reroll = [...strip().querySelectorAll('button')].find((b) => b.textContent === '↻ Reroll') as HTMLButtonElement;
    reroll.click();
    expect(m.session.save()).toMatch(/^@seed 8$/m);
    expect(Array.from(m.session.figure.value('xs') as ArrayLike<number>)).not.toEqual(before);
  });

  it('Run adds one draw per tick up to the slider max, and earlier draws stay', () => {
    m.session.applyLines(['n = 2 in 1..4 step 1', 'xs = Sample(Normal(0, 1), n)'], 'test');
    const first = Array.from(m.session.figure.value('xs') as ArrayLike<number>);
    const run = [...strip().querySelectorAll('button')].find((b) => b.textContent === '▶ Run') as HTMLButtonElement;
    run.click();
    expect(m.sim.running()).toBe(true);
    tick?.();
    expect(m.session.figure.value('n')).toBe(3);
    const after = Array.from(m.session.figure.value('xs') as ArrayLike<number>);
    expect(after.slice(0, 2)).toEqual(first);
    tick?.();
    tick?.();
    expect(m.session.figure.value('n')).toBe(4);
    expect(m.sim.running()).toBe(false);
  });

  it('the Simulate menu adds a die and shows its faces', () => {
    m.sim.open();
    const menu = strip().querySelector('select.sim-menu') as HTMLSelectElement;
    menu.value = 'die';
    menu.dispatchEvent(new Event('change'));
    expect(m.session.figure.get('rolls1')?.definition).toMatch(/Sample\(Discrete\(\[1, 2, 3, 4, 5, 6\]/);
    expect(strip().querySelector('.sim-faces')?.textContent).toMatch(/^[⚀-⚅]( [⚀-⚅]){9}$/);
  });
});
