import { describe, expect, it } from 'vitest';
import type { Chart, ChartOptions, Inc } from '../src/api/types';
import { kit } from '../src/kits/chart';
import { areaPath, linePath, slicePath } from '../src/kits/chart/chart';
import { binCounts, boxStats, niceRange, niceStep, quantile, regression, tickText, ticks, valueText } from '../src/kits/chart/scale';
import { isKitModule, KIT_GLOBAL, type KitModule } from '../src/runtime/kits';
import { SceneRuntime } from '../src/runtime/runtime';
import { KIT_SCRIPTS } from '../src/sandbox/generated/kit-scripts';
import { SHARED_GLOBAL, SHARED_MODULES } from '../src/sandbox/kit-shared';
import { pathPoints } from '../src/scene/bounds';
import type { VNode } from '../src/scene/graph';
import { validateSceneJs } from '../src/validation/js';

function run(scene: (inc: Inc) => void) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { chart: kit } });
  const mount = runtime.mount(scene);
  const first = runtime.tick(0);
  return { runtime, mount, first };
}

function chartScene(options: ChartOptions, build: (chart: Chart, inc: Inc) => void) {
  return run((inc) => build(inc.chart('#c', options), inc));
}

const nodes = (runtime: SceneRuntime) => [...runtime.graph.nodes.values()];
const num = (node: VNode, name: string) => Number(node.attrs.get(name));
/** The series groups, in the order the series were added. */
const seriesGroups = (runtime: SceneRuntime) => nodes(runtime).filter((n) => n.kind === 'g' && n.tone !== null);
const children = (runtime: SceneRuntime, group: VNode, kind: VNode['kind']) =>
  group.children.map((id) => runtime.graph.nodes.get(id)!).filter((n) => n.kind === kind);
const shown = (list: VNode[]) => list.filter((n) => !n.hidden);
const texts = (runtime: SceneRuntime) => nodes(runtime).filter((n) => n.kind === 'text' && !n.hidden).map((n) => n.text);

describe('chart arithmetic', () => {
  it('chooses nice ranges and ticks that cover the data', () => {
    expect(niceStep(10)).toBe(2);
    expect(niceStep(0.37)).toBe(0.1);
    expect(niceRange(3, 47, true)).toEqual({ lo: 0, hi: 50, step: 10 });
    expect(niceRange(-12, 31, true)).toEqual({ lo: -20, hi: 40, step: 10 });
    expect(niceRange(20.4, 24.9, false)).toEqual({ lo: 20, hi: 25, step: 1 });
    expect(niceRange(0, 0, true)).toEqual({ lo: 0, hi: 1, step: 0.2 });
    expect(niceRange(5, 5, false)).toEqual({ lo: 2, hi: 8, step: 1 });
    expect(ticks(0, 1, 0.2)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(tickText(0.30000000000000004, 0.1)).toBe('0.3');
    expect(valueText(12.5)).toBe('12.5');
    expect(valueText(3)).toBe('3');
    expect(valueText(0.12345)).toBe('0.123');
    expect(valueText(-0.0001)).toBe('0');
  });

  it('computes box plot statistics by linear interpolation, with 1.5 IQR whiskers', () => {
    const b = boxStats([9, 1, 2, 3, 4, 5, 6, 7, 8, 100])!;
    expect(b.q1).toBeCloseTo(3.25, 12);
    expect(b.median).toBeCloseTo(5.5, 12);
    expect(b.q3).toBeCloseTo(7.75, 12);
    expect([b.low, b.high]).toEqual([1, 9]);
    expect(b.outliers).toEqual([100]);
    expect(quantile([10], 0.75)).toBe(10);
    expect(boxStats([])).toBeNull();
  });

  it('bins samples, with the top edge in the last bin', () => {
    expect(binCounts([0, 0.5, 1, 1.5, 2, 9.99, 10, 11, -1], 0, 10, 5)).toEqual([4, 1, 0, 0, 2]);
    expect(binCounts([2, 4, 4, 6], 0, 8, 4)).toEqual([0, 1, 2, 1]);
  });

  it('fits a least-squares line', () => {
    const fit = regression([
      [0, 1],
      [1, 3],
      [2, 5],
      [3, 7],
    ])!;
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.r).toBeCloseTo(1, 12);
    expect(regression([[1, 1], [1, 2]])).toBeNull();
    const noisy = regression([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
    ])!;
    expect(noisy.slope).toBeCloseTo(0.6, 12);
    expect(noisy.intercept).toBeCloseTo(1, 12);
    expect(noisy.r).toBeCloseTo(0.6, 12);
  });

  it('draws lines broken at gaps, areas to their baseline and pie slices', () => {
    expect(linePath([[0, 0], [1, 1], null, [3, 3], [4, 4]])).toBe('M0 0L1 1M3 3L4 4');
    expect(areaPath([[0, 5], [10, 2]], 20)).toBe('M0 20L0 5L10 2L10 20Z');
    // A quarter from 12 o'clock to 3 o'clock.
    expect(slicePath(0, 0, 10, -Math.PI / 2, 0)).toBe('M0 0L0 -10A10 10 0 0 1 10 0Z');
    expect(slicePath(0, 0, 10, -Math.PI / 2, (3 * Math.PI) / 2)).toContain('A10 10 0 1 1 -10 0');
  });
});

describe('bar, stacked, line and area charts (DG-3)', () => {
  it('groups bars side by side in each category, from a zero baseline, with nice ticks', () => {
    const { runtime } = chartScene({ title: 'Sales', categories: ['Mon', 'Tue', 'Wed'] }, (chart) => {
      chart.series('Apples', [10, 20, 30]);
      chart.series('Pears', [5, 15, 25]);
    });
    expect(texts(runtime)).toEqual(expect.arrayContaining(['0', '10', '20', '30', 'Mon', 'Tue', 'Wed']));
    const [apples, pears] = seriesGroups(runtime);
    const a = shown(children(runtime, apples!, 'rect'));
    const p = shown(children(runtime, pears!, 'rect'));
    expect(a).toHaveLength(3);
    expect(p).toHaveLength(3);
    // Same baseline; heights in proportion to the values.
    const base = num(a[0]!, 'y') + num(a[0]!, 'height');
    for (const bar of [...a, ...p]) expect(num(bar, 'y') + num(bar, 'height')).toBeCloseTo(base, 1);
    expect(num(a[2]!, 'height') / num(a[0]!, 'height')).toBeCloseTo(3, 2);
    expect(num(p[1]!, 'height') / num(a[1]!, 'height')).toBeCloseTo(0.75, 2);
    // Side by side: the Pears bar starts after the Apples bar ends, within the same column.
    for (let i = 0; i < 3; i++) {
      expect(num(p[i]!, 'x')).toBeGreaterThanOrEqual(num(a[i]!, 'x') + num(a[i]!, 'width'));
      if (i > 0) expect(num(a[i]!, 'x')).toBeGreaterThan(num(p[i - 1]!, 'x') + num(p[i - 1]!, 'width'));
    }
  });

  it('draws negative bars below zero', () => {
    const { runtime } = chartScene({ title: 'Change', categories: ['A', 'B'] }, (chart) => void chart.series('Δ', [12, -8]));
    const [up, down] = shown(children(runtime, seriesGroups(runtime)[0]!, 'rect'));
    const zero = num(up!, 'y') + num(up!, 'height');
    expect(num(down!, 'y')).toBeCloseTo(zero, 1);
    expect(num(down!, 'height') / num(up!, 'height')).toBeCloseTo(8 / 12, 2);
    expect(texts(runtime)).toEqual(expect.arrayContaining(['-10', '0', '10']));
  });

  it('stacks series so each column is the sum of its parts', () => {
    const { runtime } = chartScene({ title: 'Energy', kind: 'stacked', categories: ['2010', '2020'] }, (chart) => {
      chart.series('Coal', [40, 20]);
      chart.series('Wind', [10, 30]);
      chart.series('Solar', [5, 25]);
    });
    const groups = seriesGroups(runtime);
    const columns = [0, 1].map((i) => groups.map((g) => shown(children(runtime, g, 'rect'))[i]!));
    const sums = [55, 75];
    const unit = (num(columns[0]![0]!, 'height') / 40) as number;
    columns.forEach((segments, i) => {
      const total = segments.reduce((h, s) => h + num(s, 'height'), 0);
      expect(total / unit).toBeCloseTo(sums[i]!, 1);
      // Each segment sits on the one below it.
      for (let k = 1; k < segments.length; k++) {
        expect(num(segments[k]!, 'y') + num(segments[k]!, 'height')).toBeCloseTo(num(segments[k - 1]!, 'y'), 1);
      }
    });
  });

  it('draws lines through the middle of each category, and areas down to zero', () => {
    const { runtime } = chartScene({ title: 'Temperature', kind: 'area', categories: ['Jan', 'Feb', 'Mar', 'Apr'] }, (chart) => {
      chart.series('Leeds', [4, 6, 9, 12]);
    });
    const group = seriesGroups(runtime)[0]!;
    const [line, area] = children(runtime, group, 'path');
    const linePoints = pathPoints(line!.attrs.get('d')!);
    expect(linePoints).toHaveLength(4);
    const dots = shown(children(runtime, group, 'circle'));
    expect(dots.map((d) => num(d, 'cx'))).toEqual(linePoints.map((p) => p[0]));
    // Equal spacing between category centres.
    expect(linePoints[2]![0] - linePoints[1]![0]).toBeCloseTo(linePoints[1]![0] - linePoints[0]![0], 6);
    expect(area!.attrs.get('d')).toMatch(/Z$/);
    expect(area!.classValue).toContain('inc-fill');
  });

  it('follows live data as parameters change', () => {
    let speed = 0;
    const { runtime } = run((inc) => {
      const k = inc.param('k', { min: 1, max: 4, step: 1, value: 1 });
      const chart = inc.chart('#c', { title: 'Live', categories: ['a', 'b'], range: [0, 10] });
      chart.series('values', () => [2 * k.value, k.value]);
      speed = 1;
    });
    expect(speed).toBe(1);
    const bars = () => shown(children(runtime, seriesGroups(runtime)[0]!, 'rect')).map((b) => num(b, 'height'));
    const before = bars();
    runtime.setParam('k', 3);
    runtime.tick(0);
    const after = bars();
    expect(after[0]! / before[0]!).toBeCloseTo(3, 2);
    expect(after[1]! / before[1]!).toBeCloseTo(3, 2);
  });

  it('lists two or more series in the legend, and hiding one rescales the rest', () => {
    const { runtime } = chartScene({ title: 'Sales', categories: ['Q1', 'Q2'] }, (chart) => {
      chart.series('Big', [100, 80]);
      chart.series('Small', [10, 8]);
    });
    const legend = runtime.uiState().legend;
    expect(legend.map((l) => [l.label, l.toggle, l.tone])).toEqual([
      ['Big', true, 'b'],
      ['Small', true, 'lit'],
    ]);
    expect(texts(runtime)).toContain('100');
    runtime.setLegend(legend[0]!.id, false);
    runtime.tick(0);
    const [big, small] = seriesGroups(runtime);
    expect(big!.hidden).toBe(true);
    // The axis now fits the small series alone.
    expect(texts(runtime)).not.toContain('100');
    expect(texts(runtime)).toContain('10');
    // The remaining series takes the whole width of each column.
    const smallBars = shown(children(runtime, small!, 'rect'));
    expect(num(smallBars[0]!, 'width')).toBeGreaterThan(60);
  });

  it('highlights one category and dims the others, and prints values on request', () => {
    let chart!: Chart;
    const { runtime } = run((inc) => {
      const pick = inc.choice('pick', { options: ['none', 'x', 'y', 'z'] });
      chart = inc.chart('#c', { title: 'Pick', categories: ['x', 'y', 'z'] });
      chart.series('s', [1, 2, 3], { values: true });
      inc.onParamChange(() => chart.highlight(pick.value === 0 ? null : pick.value - 1));
    });
    runtime.setParam('pick', 2);
    runtime.tick(0);
    const group = seriesGroups(runtime)[0]!;
    expect(shown(children(runtime, group, 'rect')).map((b) => b.attrs.get('opacity'))).toEqual(['0.3', '1', '0.3']);
    expect(shown(children(runtime, group, 'text')).map((t) => t.text)).toEqual(['1', '2', '3']);
    runtime.setParam('pick', 0);
    runtime.tick(0);
    expect(shown(children(runtime, group, 'rect')).map((b) => b.attrs.get('opacity'))).toEqual(['1', '1', '1']);
    expect(() => chart.highlight(-1)).toThrow('category index');
  });

  it('draws rules at a value and labels them', () => {
    const { runtime } = chartScene({ title: 'Mean', categories: ['a', 'b', 'c'], range: [0, 10] }, (chart) => {
      chart.series('s', [2, 4, 9]);
      chart.rule(5, { label: 'mean' });
    });
    expect(texts(runtime)).toContain('mean');
    const rule = nodes(runtime).find((n) => n.kind === 'line' && n.layer === 'front')!;
    expect(num(rule, 'y1')).toBe(num(rule, 'y2'));
    // Halfway up the 0 to 10 axis.
    const ticksY = nodes(runtime).filter((n) => n.kind === 'text' && (n.text === '0' || n.text === '10'));
    const mid = (ticksY.map((t) => num(t, 'y') - 4).reduce((a, b) => a + b, 0)) / 2;
    expect(num(rule, 'y1')).toBeCloseTo(mid, 1);
  });

  it('shows the value under the pointer', () => {
    const { runtime } = chartScene({ title: 'Hover', categories: ['a', 'b'], unit: 'kg' }, (chart) => void chart.series('Mass', [3, 7]));
    const bar = shown(children(runtime, seriesGroups(runtime)[0]!, 'rect'))[1]!;
    const stage = runtime.graph.stages[0]!.id;
    runtime.hover(stage, num(bar, 'x') + 2, num(bar, 'y') + 2);
    runtime.tick(0);
    expect(texts(runtime)).toContain('b: 7 kg');
    runtime.hover(stage, null, null);
    runtime.tick(0);
    expect(texts(runtime)).not.toContain('b: 7 kg');
  });

  it('names categories and series as parts for steps and descriptions', () => {
    const { runtime } = chartScene({ title: 'Parts', categories: ['North', 'South'] }, (chart) => void chart.series('Rain', [3, 4]));
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Rain', 'North', 'South']);
    const two = chartScene({ title: 'Two', categories: ['North', 'South'] }, (chart) => {
      chart.series('Rain', [3, 4]);
      chart.series('Snow', [1, 0]);
    });
    expect(two.runtime.uiState().parts.map((p) => p.name)).toEqual(['Rain', 'North', 'South', 'Snow']);
  });

  it('slants crowded category names', () => {
    const categories = Array.from({ length: 12 }, (_, i) => `Category number ${i + 1}`);
    const { runtime } = chartScene({ title: 'Crowded', categories }, (chart) => void chart.series('s', categories.map((_, i) => i)));
    const label = nodes(runtime).find((n) => n.kind === 'text' && n.text === 'Category number 1')!;
    expect(label.attrs.get('transform')).toMatch(/^rotate\(-35 /);
    expect(label.attrs.get('text-anchor')).toBe('end');
  });
});

describe('pie, histogram, box and scatter charts (DG-3)', () => {
  it('cuts pie slices in proportion and labels them with percentages', () => {
    const { runtime } = chartScene({ title: 'Diet', kind: 'pie', categories: ['Carbs', 'Fat', 'Protein'] }, (chart) => void chart.series('Share', [50, 30, 20]));
    const slices = nodes(runtime).filter((n) => n.kind === 'path' && n.fill);
    expect(slices).toHaveLength(3);
    expect(slices.map((s) => s.tone)).toEqual(['b', 'lit', 'c']);
    // The first slice is half the pie: from 12 o'clock, its arc ends at 6 o'clock.
    const arc = (d: string) => {
      const m = /^M(\S+) (\S+)L(\S+) (\S+)A(\S+) \S+ 0 (\d) 1 (\S+) (\S+)Z$/.exec(d)!;
      const [cx, cy, x0, y0, r, large, x1, y1] = m.slice(1).map(Number) as number[];
      const a0 = Math.atan2(y0! - cy!, x0! - cx!);
      let a1 = Math.atan2(y1! - cy!, x1! - cx!);
      while (a1 <= a0) a1 += Math.PI * 2;
      return { r: r!, large: large!, turn: (a1 - a0) / (Math.PI * 2) };
    };
    const turns = slices.map((s) => arc(s.attrs.get('d')!));
    expect(turns.map((t) => Math.round(t.turn * 1000) / 1000)).toEqual([0.5, 0.3, 0.2]);
    expect(turns.map((t) => t.large)).toEqual([0, 0, 0]);
    expect(texts(runtime)).toEqual(expect.arrayContaining(['50%', '30%', '20%', 'Carbs', 'Fat', 'Protein']));
    const legend = runtime.uiState().legend;
    expect(legend.map((l) => l.label)).toEqual(['Carbs', 'Fat', 'Protein']);
    // Hiding a slice shares the pie among the rest.
    runtime.setLegend(legend[0]!.id, false);
    runtime.tick(0);
    expect(texts(runtime)).toEqual(expect.arrayContaining(['60%', '40%']));
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Carbs', 'Fat', 'Protein']);
  });

  it('counts histogram samples into bins', () => {
    const samples = [1, 2, 2, 3, 3, 3, 4, 4, 5];
    const { runtime } = chartScene({ title: 'Rolls', kind: 'histogram', bins: 4, x: [1, 5] }, (chart) => void chart.series('Rolls', samples, { values: true }));
    const bars = shown(children(runtime, seriesGroups(runtime)[0]!, 'rect'));
    expect(bars).toHaveLength(4);
    const counts = binCounts(samples, 1, 5, 4);
    expect(counts).toEqual([1, 2, 3, 3]);
    const unit = num(bars[0]!, 'height');
    expect(bars.map((b) => Math.round(num(b, 'height') / unit))).toEqual(counts);
    // Bins sit edge to edge across the x range.
    expect(num(bars[1]!, 'x') - num(bars[0]!, 'x')).toBeCloseTo(num(bars[2]!, 'x') - num(bars[1]!, 'x'), 6);
  });

  it('draws box plots from raw samples, with outliers as dots', () => {
    const { runtime } = chartScene({ title: 'Heights', kind: 'box', range: [0, 100] }, (chart) => {
      chart.series('Class A', [9, 1, 2, 3, 4, 5, 6, 7, 8, 100]);
      chart.series('Class B', [20, 30, 40]);
    });
    const [a] = seriesGroups(runtime);
    const rect = children(runtime, a!, 'rect')[0]!;
    const median = children(runtime, a!, 'line')[0]!;
    const outliers = shown(children(runtime, a!, 'circle'));
    // On a 0 to 100 axis the box spans 3.25 to 7.75 and the median is 5.5.
    const y0 = (v: number) => num(rect, 'y') + num(rect, 'height') - ((v - 3.25) / (7.75 - 3.25)) * num(rect, 'height');
    expect(num(median, 'y1')).toBeCloseTo(y0(5.5), 1);
    expect(outliers).toHaveLength(1);
    expect(num(outliers[0]!, 'cy')).toBeCloseTo(y0(100), 0);
    expect(texts(runtime)).toEqual(expect.arrayContaining(['Class A', 'Class B']));
  });

  it('scatters points and fits a trend line through them', () => {
    const points: Array<[number, number]> = [
      [0, 1],
      [1, 3],
      [2, 5],
      [3, 7],
    ];
    const { runtime } = chartScene({ title: 'Fit', kind: 'scatter', x: [0, 3], range: [0, 8] }, (chart) => void chart.points('data', points, { trend: true }));
    const group = seriesGroups(runtime)[0]!;
    const dots = shown(children(runtime, group, 'circle'));
    expect(dots).toHaveLength(4);
    const trend = children(runtime, group, 'path')[0]!;
    const [from, to] = pathPoints(trend.attrs.get('d')!);
    // The trend runs through the first and last points exactly.
    expect(from![0]).toBeCloseTo(num(dots[0]!, 'cx'), 1);
    expect(from![1]).toBeCloseTo(num(dots[0]!, 'cy'), 1);
    expect(to![0]).toBeCloseTo(num(dots[3]!, 'cx'), 1);
    expect(to![1]).toBeCloseTo(num(dots[3]!, 'cy'), 1);
    const stage = runtime.graph.stages[0]!.id;
    runtime.hover(stage, num(dots[1]!, 'cx') + 1, num(dots[1]!, 'cy'));
    runtime.tick(0);
    expect(texts(runtime)).toContain('(1, 3)');
  });

  it('draws large scatter series on the canvas layer', () => {
    const many: Array<[number, number]> = Array.from({ length: 600 }, (_, i) => [i, (i * 7) % 13]);
    const { first } = chartScene({ title: 'Many', kind: 'scatter' }, (chart) => void chart.points('cloud', many));
    const dots = first.commands.filter((c) => c.op === 'dots');
    expect(dots.at(-1)).toMatchObject({ op: 'dots', layer: 'front' });
    expect((dots.at(-1) as { readonly points: readonly number[] }).points).toHaveLength(1200);
  });
});

describe('chart mistakes read plainly', () => {
  const error = (scene: (inc: Inc) => void) => run(scene).mount.ui.error?.message;

  it('names the problem', () => {
    expect(error((inc) => void inc.chart('#c', { title: 'x', kind: 'pies' as never }))).toBe(
      'Unknown chart kind "pies"; use bar, line, area, stacked, pie, histogram, box, scatter',
    );
    expect(error((inc) => void inc.chart('#c', { title: 'x', categories: ['a', 'b'] }).series('s', [1, 2, 3]))).toBe(
      'Chart series "s" has 3 values but the chart has 2 categories',
    );
    expect(error((inc) => void inc.chart('#c', { title: 'x' }).series('s', []))).toBe('Chart series "s" has no values');
    expect(error((inc) => void inc.chart('#c', { title: 'x' }).points('s', [[1, 2]]))).toContain('chart.points is for scatter charts');
    expect(error((inc) => void inc.chart('#c', { title: 'x', kind: 'scatter' }).series('s', [1]))).toContain('A scatter chart takes points');
    expect(
      error((inc) => {
        const pie = inc.chart('#c', { title: 'x', kind: 'pie' });
        pie.series('a', [1, 2]);
        pie.series('b', [1, 2]);
      }),
    ).toBe('A pie chart has one series; its categories are the slices');
    expect(error((inc) => void inc.chart('#c', { title: 'x', kind: 'pie' }).series('a', [1, -2]))).toBe('Pie slices cannot be negative (series "a")');
    expect(error((inc) => void inc.chart('#c', { title: 'x', range: [5, 1] }))).toBe('chart: range must be [low, high] with low below high');
    expect(error((inc) => void inc.chart('#c', { title: 'x', bins: 0 }))).toContain('bins must be a whole number');
    expect(
      error((inc) => {
        const c = inc.chart('#c', { title: 'x' });
        c.series('s', [1]);
        c.series('s', [2]);
      }),
    ).toBe('Chart series "s" is added twice');
    expect(error((inc) => void inc.chart('#c', { title: 'x' }).series('s', [1, 'two' as never]))).toBe('Chart series "s" must hold numbers only');
  });
});

describe('the chart kit script', () => {
  it('registers itself in the Worker and draws with the runtime’s own modules', async () => {
    const code = await KIT_SCRIPTS.chart!();
    const scope = globalThis as unknown as Record<string, unknown>;
    scope[SHARED_GLOBAL] = SHARED_MODULES;
    try {
      // The same way the sandbox runs it: after the base Worker, before the scene.
      new Function(code)();
      const registered = (scope[KIT_GLOBAL] as Record<string, unknown>).chart;
      expect(isKitModule(registered)).toBe(true);
      const runtime = new SceneRuntime({ autoplay: false, kits: { chart: registered as KitModule } });
      runtime.mount((inc) => {
        const c = inc.chart('#c', { title: 'Built', categories: ['a', 'b'] });
        c.series('s', [1, 2]);
        c.series('t', [2, 1]);
      });
      runtime.tick(0);
      // Legends and parts find the kit's elements only through the runtime's own handle table.
      expect(runtime.uiState().legend.map((l) => l.label)).toEqual(['s', 't']);
      expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['s', 'a', 'b', 't']);
      expect(runtime.uiState().error).toBeNull();
    } finally {
      delete scope[SHARED_GLOBAL];
      delete scope[KIT_GLOBAL];
    }
  });
});

describe('a chart scene passes the validator', () => {
  it('has no diagnostics', () => {
    const js = `
inc.idea('Changing the price moves demand along the curve.');
const price = inc.param('price', { min: 1, max: 10, value: 4, label: 'Price', unit: '£' });
const chart = inc.chart('#chart', { title: 'Demand by month', kind: 'bar', categories: ['Jan', 'Feb', 'Mar'], yLabel: 'Units', range: [0, 120] });
const sales = chart.series('Sales', () => [100 - 5 * price.value, 90 - 4 * price.value, 80 - 3 * price.value], { values: true });
chart.rule(() => 60, { label: 'target' });
inc.onParamChange(() => chart.highlight(price.value > 5 ? 0 : null));
sales.tone('b');
`;
    const { diagnostics, info } = validateSceneJs(js);
    expect(diagnostics).toEqual([]);
    expect(info.kits).toEqual(['chart']);
  });
});
