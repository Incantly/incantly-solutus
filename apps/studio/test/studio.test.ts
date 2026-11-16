/** The studio screen: examples, the data-analysis lines, the graph's camera and painter, and the mounted page. */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultState, labLines, parseLab } from '../src/datalab';
import type { LabNames } from '../src/datalab';
import { EXAMPLES } from '../src/examples';
import { drawsOnGraph, lineName } from '../src/expressions';
import { paintScene, sceneBounds } from '@incantly/sdk/screen';
import type { SceneItem } from '@incantly/sdk/screen';
import { Viewport, gridStep } from '@incantly/sdk/screen';
import { loadCasEngine } from '../src/registry';
import { KernelSession } from '../src/session';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

const NAMES: LabNames = { data: 'pts1', plot: 'chart1', stats: 'stats1', fit: 'fit1', extra: 'overlay1', band: 'band1', curve: 'nc1' };

// the Algebra example needs the CAS engine, which the studio loads on demand
beforeAll(async () => {
  await loadCasEngine();
});

describe('examples', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s applies every line and leaves nothing undefined', (_id, ex) => {
    const s = new KernelSession();
    const r = s.load(ex.lines.join('\n'));
    expect(r.errors.map((e) => e.message)).toEqual([]);
    expect(r.applied).toBe(ex.lines.length);
    const bad = s.figure.objects().filter((o) => !o.cell.defined).map((o) => o.name);
    expect(bad).toEqual([]);
  });
});

describe('data-analysis lines (statistics design 9)', () => {
  it('one variable: histogram with classes, overlays and the Describe record', () => {
    const s = { ...defaultState(), source: 'data', classes: 'width' as const, width: 5, start: '0', scale: 'density' as const, normal: true, polygon: true };
    expect(labLines(s, NAMES)).toEqual([
      '@datalab one data histogram',
      'chart1 = Histogram(ClassesByWidth(data, 5, 0), data, scale = "density")',
      'overlay1 = FrequencyPolygon(chart1)',
      'nc1(x) = Pdf(Normal(Mean(data), StdDev(data)), x)',
      'stats1 = Describe(data)',
    ]);
    expect(labLines({ ...defaultState(), source: 'data', plot: 'boxplot', whisker: 'tukey' }, NAMES)[1]).toBe('chart1 = BoxPlot(1, 0.5, data, whisker = "tukey")');
  });

  it('two variables: points from two lists, a model, residuals and a band', () => {
    const s = { ...defaultState(), mode: 'two' as const, source: 'xs', ySource: 'ys', model: 'exp' as const, space: 'log' as const, residuals: true, band: 'mean' as const };
    expect(labLines(s, NAMES)).toEqual([
      '@datalab two xs ys exp',
      'pts1 = Points(xs, ys)',
      'stats1 = Describe(pts1)',
      'fit1 = FitExp(pts1, space = "log")',
      'overlay1 = ResidualPlot(pts1, fit1.f)',
      'band1 = FitBand(fit1, 0.95, "mean")',
    ]);
  });

  it('several variables: stacked box plots and ANOVA', () => {
    expect(labLines({ ...defaultState(), mode: 'several', sources: ['a', 'b'] }, NAMES)).toEqual([
      '@datalab several a b',
      'chart1 = BoxPlots([a, b], ["a", "b"])',
      'stats1 = ANOVA([a, b])',
    ]);
  });

  it('the lines run in a figure, and the @datalab line reads back', () => {
    const s = new KernelSession();
    s.submit('data = [4, 7, 8, 8, 9, 10, 12, 15, 21]');
    const lines = labLines({ ...defaultState(), source: 'data', normal: true }, NAMES);
    const r = s.applyLines(lines, 'Data analysis');
    expect(r.ok).toBe(true);
    expect(s.figure.get('chart1')?.cell.defined).toBe(true);
    expect(s.save()).toContain('@datalab one data histogram');
    expect(parseLab('@datalab two xs ys exp')).toEqual({ mode: 'two', source: 'xs', ySource: 'ys', model: 'exp' });
    expect(parseLab('@datalab two P line')).toEqual({ mode: 'two', source: 'P', ySource: '', model: 'line' });
    expect(parseLab('@datalab several a b c')).toEqual({ mode: 'several', sources: ['a', 'b', 'c'] });
  });
});

describe('the graph camera', () => {
  it('maps maths to pixels and back, and zooms about a fixed point', () => {
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.home();
    expect(vp.x(vp.px(3.5))).toBeCloseTo(3.5, 12);
    expect(vp.y(vp.py(-2))).toBeCloseTo(-2, 12);
    const before = [vp.x(200), vp.y(150)];
    vp.zoomAt(200, 150, 2.5);
    expect([vp.x(200), vp.y(150)].map((v, i) => v - (before[i] as number)).every((d) => Math.abs(d) < 1e-9)).toBe(true);
  });

  it('fits a box, square or stretched', () => {
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.fit({ x0: 0, x1: 100, y0: 0, y1: 2 }, 0, false);
    expect(vp.ppu).toBe(vp.ppuY);
    vp.fit({ x0: 0, x1: 100, y0: 0, y1: 2 }, 0, true);
    expect(vp.ppu).toBeCloseTo(8, 9);
    expect(vp.ppuY).toBeCloseTo(300, 9);
  });

  it('grid steps are 1, 2 or 5 times a power of ten', () => {
    for (const ppu of [0.01, 3, 47, 1000, 123456]) {
      const { major } = gridStep(ppu);
      const m = major / 10 ** Math.floor(Math.log10(major));
      expect([1, 2, 5].some((k) => Math.abs(m - k) < 1e-9)).toBe(true);
    }
  });
});

/** A canvas context that records the drawing calls. */
function fakeCtx(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = [];
  return new Proxy({ calls } as Record<string, unknown>, {
    get(t, k) {
      if (k in t) return t[k as string];
      if (k === 'measureText') return () => ({ width: 40 });
      return (..._a: unknown[]) => calls.push(String(k));
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & { calls: string[] };
}

describe('the painter', () => {
  // the tests example shows result cards in the list and draws nothing on the graph
  // calculator and CAS-only examples have no graph
  // sheet-times holds a table and cells only: nothing to draw; the 3D examples draw in the Space view (space.test.ts)
  it.each(EXAMPLES.filter((e) => e.id !== 'tests' && !e.modes.includes('graphing3d') && !e.modes.includes('scientific') && !e.id.startsWith('cas-') && e.id !== 'sound-beats' && e.id !== 'sound-sonify' && e.id !== 'sheet-times').map((e) => [e.id, e] as const))('paints the %s example and finds its bounds', (_id, ex) => {
    const s = new KernelSession();
    s.load(ex.lines.join('\n'));
    const items: SceneItem[] = s.figure.objects()
      .filter((o) => o.cell.defined && drawsOnGraph(o.type, o.typeText, o.cell.value))
      .map((o) => ({ id: o.id, name: o.name, type: o.type, typeText: o.typeText, value: o.cell.value, color: '#2f6fdb', free: o.free, label: true }));
    expect(items.length).toBeGreaterThan(0);
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.home();
    const ctx = fakeCtx();
    paintScene(ctx, vp, items);
    // more than the grid's own strokes
    expect(ctx.calls.filter((c) => c === 'stroke' || c === 'fill' || c === 'fillRect').length).toBeGreaterThan(4);
    expect(sceneBounds(items)).toBeDefined();
  });

  it('collects hits for histogram bars and free points', () => {
    const s = new KernelSession();
    s.load('A = (1, 1)\nh = Histogram([0, 10, 20], [1, 2, 15])');
    const items = s.figure.objects().map((o) => ({ id: o.id, name: o.name, type: o.type, typeText: o.typeText, value: o.cell.value, color: '#2f6fdb', free: o.free, label: true }));
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.fit({ x0: -1, x1: 21, y0: 0, y1: 3 }, 20, true);
    const hits = paintScene(fakeCtx(), vp, items);
    expect(hits.some((h) => h.k === 'rect' && /Class \[0, 10\): 2 values, 67 %/.test(h.text))).toBe(true);
    expect(hits.some((h) => h.k === 'circle' && h.drag === 'A')).toBe(true);
  });
});

describe('expression helpers', () => {
  it('reads the name a line defines', () => {
    expect(lineName('a = 3')).toBe('a');
    expect(lineName('f(x) = x^2')).toBe('f');
    expect(lineName('Mean(data)')).toBeUndefined();
    expect(lineName('x == 2')).toBeUndefined();
  });
});

describe('the studio page', () => {
  let root: HTMLElement;
  let m: Mounted;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });

  const typeLine = (text: string): void => {
    const input = root.querySelector<HTMLInputElement>('.expr-new .expr-input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  it('adds a typed line as a row with its value', () => {
    typeLine('data = [4, 7, 8, 9]');
    typeLine('m = Mean(data)');
    const rows = [...root.querySelectorAll('.expr:not(.expr-new)')];
    expect(rows.map((r) => (r as HTMLElement).dataset['name'])).toEqual(['data', 'm']);
    expect(rows[1]?.querySelector('.value')?.textContent).toBe('= 7');
  });

  it('names a bare expression and shows the real error of a bad one', () => {
    typeLine('data = [1, 2, 3]');
    typeLine('Mean(data)');
    expect(m.session.figure.objects().length).toBe(2);
    typeLine('Mean((1, 2))');
    expect(root.querySelector('.expr-new .err-msg')?.textContent).toMatch(/Mean/);
    expect(root.querySelector('.expr-new')?.classList.contains('bad')).toBe(true);
  });

  it('shows a result card for a test and hides a chart with its swatch', () => {
    typeLine('s = [5.1, 4.9, 5.6, 5.8, 6.0, 5.4, 5.2, 5.9]');
    typeLine('r = TTest(s, 5, "right")');
    expect(root.querySelector('.card-title')?.textContent).toBe('TTest · right-tailed');
    typeLine('h = Histogram(s)');
    const sw = [...root.querySelectorAll<HTMLButtonElement>('.swatch')].find((b) => !b.hidden && b.closest('.expr')?.getAttribute('data-name') === 'h') as HTMLButtonElement;
    sw.click();
    const id = m.session.figure.get('h')?.id as number;
    expect(m.expressions.isHidden(id)).toBe(true);
  });

  it('loads an example and opens the data-analysis panel with its lines', () => {
    m.loadExample('one');
    expect(root.querySelectorAll('.expr:not(.expr-new)').length).toBe(6);
    m.lab.open();
    expect(root.querySelector('.lab-lines')?.textContent).toContain('Histogram(data)');
    expect(root.querySelector('.stats')?.textContent).toContain('mean');
  });

  it('undoes and redoes', () => {
    typeLine('a = 1');
    m.undo();
    expect(m.session.figure.objects().length).toBe(0);
    m.redo();
    expect(m.session.figure.objects().length).toBe(1);
  });
});
