/**
 * The 2D tools (tools-2d design 4 to 6, errors.md 2; .kiro/specs/tools-2d R1 to R3): every tool runs through the real
 * kernel, no two variants of a tool accept the same picks, and the engine picks, narrows, cancels and commits as designed.
 */
import { describe, expect, it } from 'vitest';
import { Figure } from '@incantly/kernel';
import { TOOLS, ToolSession, accepts, allocate, definedName, toolById } from '@incantly/ui';
import type { Arg, Hit, Slot, ToolDone, ToolSpec } from '@incantly/ui';
import { studioRegistry } from '../src/registry';
import { figureHost } from '../src/tools-host';

const registry = studioRegistry();

/** A figure with an object of every type a tool may pick. */
const BASE = [
  'A = (0, 0)', 'B = (4, 0)', 'C = (1, 3)', 'D = (5, 2)', 'E = (-2, 1)', 'F = (2, -3)',
  's = Segment(A, B)', 'l = Line(A, C)', 'r = Ray(B, D)', 'v = Vector(A, D)', 'w = Vector(B, C)', 'c = Circle(A, 2)', 'k = Circle(B, 3)',
  'co = Ellipse(A, B, C)', 'poly = Polygon(A, B, C)', 'f(x) = x^2 / 4 - 1', 'sct = Sector(A, B, C)', 'arc = Arc(A, B, C)', 'pl = Polyline(E, A, F)',
  'P = PointOn(k, 0.3)', 'M = Midpoint(P, A)', 'm2 = Line(E, F)',
];

const fig = (): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of BASE) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};

/** An example object for each type a slot may accept. */
const EXAMPLE: Readonly<Record<string, string[]>> = {
  Point: ['D', 'E', 'F', 'B', 'C'], Segment: ['s'], Line: ['l', 'm2'], Ray: ['r'], Vector: ['v', 'w'], Circle: ['c', 'k'], Conic: ['co'], Polygon: ['poly'],
  Function: ['f'], Sector: ['sct'], Arc: ['arc'], Polyline: ['pl'], Any: ['A', 's', 'c'], Shape: ['poly'], Path: ['c', 'k'],
};

/** Example args for a variant: points A, B, C… in order, an object of the first accepted type, the default number. */
function exampleArgs(spec: ToolSpec, vi: number): Arg[] {
  const v = spec.variants[vi];
  if (!v) return [];
  const used = new Map<string, number>();
  const pick = (type: string): string => {
    const list = EXAMPLE[type] ?? [];
    const i = used.get(type) ?? 0;
    used.set(type, i + 1);
    return list[i % list.length] ?? 'A';
  };
  const arg = (s: Slot): Arg => {
    if (s.kind === 'point') return { text: pick('Point'), type: 'Point' };
    if (s.kind === 'number') return { text: String(s.def ?? 2), type: 'Number', value: s.def ?? 2 };
    if (s.kind === 'position') return { text: '(1, 1)', type: 'Position' };
    const t = s.accept[0] as string;
    // the locus tool needs the tracer built on the mover
    if (spec.id === 'locus') return { text: used.has('Point') ? 'P' : (used.set('Point', 1), 'M'), type: 'Point' };
    if (spec.id === 'create-list' || spec.id === 'check-box') return { text: pick('Point'), type: 'Point' };
    return { text: pick(t), type: t === 'Any' || t === 'Shape' || t === 'Path' ? 'Point' : t };
  };
  const args = v.slots.map(arg);
  if (v.tail) for (let i = 0; i < Math.max(v.tail.min, spec.id === 'check-box' ? 1 : 0, 3); i++) args.push(arg(v.tail.slot));
  return args;
}

describe('every tool runs through the real kernel (R1.3)', () => {
  const cases = TOOLS.flatMap((t) => t.variants.filter((v) => v.emit).map((v, i) => [`${t.id} / ${v.id}`, t, t.variants.indexOf(v), i] as const));
  it.each(cases)('%s', (_label, spec, vi) => {
    const f = fig();
    const host = figureHost(f, registry);
    const v = spec.variants[vi];
    const args = exampleArgs(spec, vi);
    const own = v?.emit?.(args, { view: { x0: -6, x1: 6, y0: -4, y1: 4 }, intersections: (a, b) => host.intersections(a, b) }) ?? [];
    if (spec.id === 'point' || spec.id === 'point-on-object') {
      expect(own).toEqual([]);
      return;
    }
    const { lines } = allocate(own, (n) => host.nameFree(n));
    const r = f.applyBatch(lines, { group: spec.id });
    expect(r.ok, `${lines.join(' | ')}: ${r.results.map((x) => (x.ok ? '' : x.message)).join(' ')}`).toBe(true);
    for (const n of lines.map(definedName)) {
      if (!n) continue;
      const cell = f.cellOf(n);
      expect(cell?.defined, `${n} in ${lines.join(' | ')}: ${cell && !cell.defined ? cell.reason : ''}`).toBe(true);
    }
  });

  it('the catalogue has the v1 tools, each with a description', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(55);
    for (const t of TOOLS) expect(t.description.length, t.id).toBeGreaterThan(10);
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
  });
});

/** Could one pick fill both slots? A point slot is taken to accept only an existing point here. */
function overlap(a: Slot, b: Slot): boolean {
  const types = (s: Slot): string[] => (s.kind === 'point' ? ['Point'] : s.kind === 'object' ? [...s.accept] : [s.kind]);
  if (a.kind === 'number' || b.kind === 'number' || a.kind === 'position' || b.kind === 'position') return a.kind === b.kind;
  const ta = types(a);
  const tb = types(b);
  return ta.some((x) => accepts(tb, x)) || tb.some((x) => accepts(ta, x));
}

describe('no tool has two variants that take the same picks (ambiguous_variants)', () => {
  it.each(TOOLS.map((t) => [t.id, t] as const))('%s', (_id, t) => {
    for (let i = 0; i < t.variants.length; i++) {
      for (let j = i + 1; j < t.variants.length; j++) {
        const a = t.variants[i];
        const b = t.variants[j];
        if (!a || !b || a.tail || b.tail || a.slots.length !== b.slots.length) continue;
        expect(a.slots.every((s, k) => overlap(s, b.slots[k] as Slot)), `${a.id} and ${b.id}`).toBe(false);
      }
    }
  });
});

describe('the engine (design 5, errors.md 2)', () => {
  const session = (id: string, f = fig()): { s: ToolSession; f: Figure } => {
    const s = new ToolSession(toolById(id) as ToolSpec, figureHost(f, registry));
    s.view = { x0: -6, x1: 6, y0: -4, y1: 4 };
    return { s, f };
  };
  const point = (name: string): Hit => ({ name, type: 'Point', dist: 0 });

  it('a circle through 3 points: existing and new points, one batch, one undo step', () => {
    const { s, f } = session('circle-three-points');
    expect(s.click({ x: 0, y: 0 }, [point('A')]).ok).toBe(true);
    expect(s.prompt()).toMatch(/second point/);
    expect(s.click({ x: -3.004, y: 2.0 }, []).ok).toBe(true);
    expect(s.pending().length).toBe(1);
    const done = s.click({ x: 2, y: 2 }, [point('C')]) as ToolDone;
    expect(done.ok && done.lines).toEqual(['G = (-3, 2)', 'd = Circle(A, G, C)']);
    expect(done.results).toEqual(['d']);
    expect(done.points).toEqual(['G']);
    const before = f.objects().length;
    expect(f.applyBatch(done.lines, { group: 'Circle through 3 points' }).ok).toBe(true);
    expect(f.objects().length).toBe(before + 2);
    f.undo();
    expect(f.objects().length).toBe(before);
  });

  it('cancelling leaves nothing, Backspace drops the last pick', () => {
    const { s } = session('segment');
    s.click({ x: 1, y: 1 }, []);
    expect(s.step).toBe(1);
    s.key('Backspace');
    expect(s.step).toBe(0);
    expect(s.pending()).toEqual([]);
    expect(s.key('Escape')).toEqual({ ok: true, cancel: true });
  });

  it('a click on a path makes a point on it; near a crossing an intersection', () => {
    const { s } = session('point');
    const on = s.click({ x: 2, y: 0.01 }, [{ name: 'c', type: 'Circle', dist: 2 }]) as ToolDone;
    expect(on.lines[0]).toMatch(/^G = PointOn\(c, 0\.\d+\)$/);
    const x = s.click({ x: 0.65, y: 1.9 }, [{ name: 'c', type: 'Circle', dist: 2 }, { name: 'l', type: 'Line', dist: 3 }]) as ToolDone;
    expect(x.lines[0]).toMatch(/^G = Intersect\(c, l, \d\)$/);
  });

  it('variants narrow: Angle takes three points, two segments or two vectors', () => {
    const { s } = session('angle');
    s.click({ x: 0, y: 0 }, [{ name: 's', type: 'Segment', dist: 1 }]);
    expect(s.alive).toEqual(['lines']);
    const d = s.click({ x: 0, y: 0 }, [{ name: 'l', type: 'Line', dist: 1 }]) as ToolDone;
    expect(d.lines).toEqual(['α = Angle(s, l)']);
  });

  it('a wrong click is refused with what to click instead', () => {
    const { s } = session('parabola');
    s.click({ x: 0, y: 0 }, [point('A')]);
    const r = s.click({ x: 0, y: 0 }, [{ name: 'c', type: 'Circle', dist: 1 }]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('wrong_type');
    expect(!r.ok && r.hint).toMatch(/line/);
    expect(s.step).toBe(1);
  });

  it('a polygon closes on its first point or with Enter, and needs three vertices', () => {
    const { s } = session('polygon');
    s.click({ x: 0, y: 0 }, [point('A')]);
    s.click({ x: 0, y: 0 }, [point('B')]);
    expect(s.key('Enter').ok).toBe(false);
    s.click({ x: 0, y: 0 }, [point('C')]);
    const d = s.click({ x: 0, y: 0 }, [point('A')]) as ToolDone;
    expect(d.lines).toEqual(['poly1 = Polygon(A, B, C)']);
  });

  it('numbers are typed, checked and may be formulas', () => {
    const { s } = session('regular-polygon');
    s.click({ x: 0, y: 0 }, [point('A')]);
    s.click({ x: 0, y: 0 }, [point('B')]);
    expect(s.awaitingNumber()?.prompt).toMatch(/sides/);
    const bad = s.entry('2');
    expect(!bad.ok && bad.code).toBe('number_out_of_range');
    const bad2 = s.entry('1 +');
    expect(!bad2.ok && bad2.code).toBe('bad_number');
    const d = s.entry('2 + 4') as ToolDone;
    expect(d.lines).toEqual(['poly1 = Polygon(A, B, 2 + 4)']);
    const r = session('rotate-angle');
    r.s.click({ x: 0, y: 0 }, [{ name: 'poly', type: 'Polygon', dist: 1 }]);
    r.s.click({ x: 0, y: 0 }, [point('A')]);
    expect((r.s.entry('40°') as ToolDone).lines).toEqual(['poly1 = Rotate(poly, 40deg, A)']);
  });

  it('preselected objects become picks in order', () => {
    const { s } = session('reflect-line');
    const d = s.preselect(['poly', 'l']) as ToolDone;
    expect(d.lines).toEqual(['poly1 = Reflect(poly, l)']);
  });

  it('a preview is the lines a click would write, and changes nothing', () => {
    const { s } = session('circle-center-point');
    s.click({ x: 0, y: 0 }, [point('A')]);
    const p = s.preview({ x: 1, y: 1 }, []);
    expect(p?.lines).toEqual(['G = (1, 1)', 'd = Circle(A, G)']);
    expect(s.step).toBe(1);
  });

  it('edit tools ask for an edit instead of a line', () => {
    const { s } = session('delete');
    const d = s.click({ x: 0, y: 0 }, [{ name: 'c', type: 'Circle', dist: 1 }]) as ToolDone;
    expect(d.action).toEqual({ op: 'delete', name: 'c' });
  });

  it('names follow the sequences and skip used and reserved names', () => {
    const used = new Set(['A', 'B', 'c', 'e']);
    expect(allocate(['{point} = (1, 2)', '{point} = (3, 4)', '{circle} = Circle({point#x}, 1)', '{point#x} = (0, 0)'], (n) => !used.has(n)).lines)
      .toEqual(['C = (1, 2)', 'D = (3, 4)', 'd = Circle(E, 1)', 'E = (0, 0)']);
  });
});

describe('the tool strip in the page (R5) and speed (R6)', () => {
  it('a tool picked from the strip builds a segment with two clicks and one undo step', async () => {
    const { mountStudio } = await import('../src/studio-page');
    const root = document.createElement('div');
    document.body.append(root);
    const m = mountStudio(root, { raf: () => 1, caf: () => undefined });
    m.tools.select('segment');
    expect(root.querySelector('.tool-hint')?.textContent).toMatch(/Segment: Click the first point/);
    const vp = m.graph.viewport;
    vp.resize(800, 600);
    vp.home();
    m.tools.graphTool.click(vp.px(1), vp.py(1), vp);
    m.tools.graphTool.click(vp.px(3), vp.py(2), vp);
    expect(m.session.figure.objects().map((o) => o.name)).toEqual(['A', 'B', 'l']);
    expect(m.session.figure.get('l')?.definition).toBe('l = Segment(A, B)');
    m.undo();
    expect(m.session.figure.objects().length).toBe(0);
    m.tools.select('move');
    m.dispose();
    root.remove();
  });

  it('a hit list over 1,000 objects takes under 0.3 ms', async () => {
    const { hitTest } = await import('../src/graph/hit');
    const { Viewport } = await import('../src/graph/viewport');
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.home();
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i, name: `P${i}`, type: i % 2 ? 'Point' : 'Segment', typeText: i % 2 ? 'Point' : 'Segment', color: '#000', free: false, label: false,
      value: i % 2 ? { x: (i % 40) - 20, y: Math.floor(i / 40) - 12 } : { a: { x: (i % 40) - 20, y: 0 }, b: { x: (i % 40) - 19, y: 1 } },
    }));
    hitTest(items, vp, 400, 300);
    // the best of several batches, so a busy machine does not decide the result
    let best = Infinity;
    for (let b = 0; b < 8; b++) {
      const t0 = performance.now();
      for (let k = 0; k < 20; k++) hitTest(items, vp, 400 + k, 300);
      best = Math.min(best, (performance.now() - t0) / 20);
    }
    expect(best).toBeLessThan(0.3 * (process.env['CI'] ? 3 : 1));
  });
});
