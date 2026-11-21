// @vitest-environment node
/**
 * The shape kinds of round 3 (docs/features/board/design.md 7.1, 7.2, 9 item 6, 12; requirements R5.1; errors.md
 * `record_invalid`, `asset_invalid`): every kind has its defaults, refuses bad props, knows its box and its hit test,
 * and draws less at a small size. Text typesets `$…$` maths, a frame clips what it holds, and an image is told by its
 * magic number, never by a name. Only the public API is used.
 */
import { describe, expect, it } from 'vitest';
import {
  ASSET_BYTES_MAX, BUILT_IN_KINDS, BoardCore, KindRegistry, addImage, builtInKind, imageProblem, imageSize, pickShape, shapeGeometry, sniffImage,
} from '../../src/index';
import type { KindDef, ShapeRecord } from '../../src/index';
import { add, get, jpegBytes, ofKind, pageOf, plain, pngBytes, shapeRig, shapesOf, svgBytes, webpBytes } from './shape-helpers';

const BOX_KINDS = ['rect', 'ellipse', 'triangle', 'diamond', 'star'] as const;
const ALL_KINDS = ['ink', ...BOX_KINDS, 'line', 'arrow', 'text', 'sticky', 'frame', 'image', 'figure'] as const;

/** A shape record that is not in any store: the kind's props are filled by the kind's own check. */
function rec(kind: string, props: Record<string, unknown> = {}, over: Partial<ShapeRecord> = {}): ShapeRecord {
  const def = builtInKind(kind);
  if (def === undefined) throw new Error(`no kind ${kind}`);
  const checked = def.check(props);
  if (!checked.ok) throw new Error(`${kind}: ${checked.message}`);
  return { id: 'shape:t', page: 'page:t', kind, x: 0, y: 0, rotation: 0, parent: null, index: 'a0', locked: false, opacity: 1, props: checked.value, meta: {}, ...over };
}

const hit = (s: ShapeRecord, x: number, y: number, tol = 1): boolean => shapeGeometry(s)?.hit(x, y, tol) ?? false;

describe('every kind of design 7.1 is registered through KindDef, as a host would (R5.1)', () => {
  it('a board registers ink, the five box shapes, line, arrow, text, sticky, frame, image and figure', () => {
    const core = BoardCore.create({});
    if (!core.ok) throw new Error(core.message);
    const names = core.value.store.kinds.kinds();
    for (const k of ALL_KINDS) expect(names, k).toContain(k);
  });

  it('every built-in definition registers into a fresh registry like a host kind, and its defaults pass its own check', () => {
    const kinds = new KindRegistry();
    for (const def of BUILT_IN_KINDS) {
      expect(kinds.register(def).ok, def.kind).toBe(true);
      const checked = def.check(def.defaults);
      expect(checked.ok, `${def.kind} defaults`).toBe(true);
    }
  });

  it('a host kind with geometry and drawing is drawn, hit and selected like a built-in one', () => {
    const stamp: KindDef<{ r: number }> = {
      kind: 'stamp',
      defaults: { r: 20 },
      check: (props) => {
        const r = (props as { r?: unknown } | null)?.r ?? 20;
        return typeof r === 'number' && r > 0 ? { ok: true, value: { r }, notices: [] } : { ok: false, kind: 'record_invalid', message: 'r must be above 0', detail: { field: 'props.r' } };
      },
      geometry: (s) => ({ box: { minX: 0, minY: 0, maxX: s.props.r * 2, maxY: s.props.r * 2 }, pad: 1, hit: (x, y, tol) => Math.hypot(x - s.props.r, y - s.props.r) <= s.props.r + tol }),
      draw: (s) => [{ k: 'path', d: [0, 0, 0, s.props.r * 2, 0, 0], fill: '#000000', stroke: null, width: 0, dash: [], cap: 'butt' }],
    };
    const kinds = new KindRegistry();
    expect(kinds.register(stamp).ok).toBe(true);
    const rig = shapeRig('select', { kinds });
    const s = add(rig, 'stamp', 100, 100, { r: 30 });
    expect(rig.core.drawList.itemsIn({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, 1).map((i) => i.id)).toContain(s.id);
    expect(pickShape(rig.core, 130, 130, 1)?.id).toBe(s.id);
    expect(pickShape(rig.core, 100, 100, 1)).toBeUndefined();
    expect(add(rig, 'stamp', 0, 0, { r: 5 }).kind).toBe('stamp');
  });
});

describe('defaults (design 7.1)', () => {
  const field = (kind: string): Record<string, unknown> => builtInKind(kind)?.defaults as Record<string, unknown>;

  it.each(BOX_KINDS)('%s has w, h, fill, stroke, dash, size and label', (kind) => {
    const d = field(kind);
    for (const k of ['w', 'h', 'fill', 'stroke', 'dash', 'size', 'label']) expect(d, `${kind}.${k}`).toHaveProperty(k);
    expect(d['w']).toBeGreaterThan(0);
    expect(d['h']).toBeGreaterThan(0);
    expect(d['label']).toBe('');
  });

  it('line has two or more points, and a stroke and a dash', () => {
    const d = field('line');
    expect((d['points'] as number[]).length).toBeGreaterThanOrEqual(4);
    expect((d['points'] as number[]).length % 2).toBe(0);
    expect(d).toHaveProperty('stroke');
    expect(d).toHaveProperty('dash');
  });

  it('arrow has start, end, bend and heads; the default is straight with a head at the end', () => {
    const d = field('arrow');
    expect(d['start']).toHaveLength(2);
    expect(d['end']).toHaveLength(2);
    expect(d['bend']).toBe(0);
    expect(d['endHead']).not.toBe('none');
    expect(d).toHaveProperty('startHead');
  });

  it('text has text, font, size, align and a width that is auto (null) by default', () => {
    const d = field('text');
    expect(d['text']).toBe('');
    for (const k of ['font', 'size', 'align']) expect(d).toHaveProperty(k);
    expect(d['w']).toBeNull();
  });

  it('sticky has text and a colour; frame has w, h and a name; image has asset, w, h and crop; figure has script, mode, w, h and picture', () => {
    expect(field('sticky')).toMatchObject({ text: '' });
    expect(field('sticky')).toHaveProperty('color');
    expect(field('frame')).toHaveProperty('name');
    expect(field('frame')['w']).toBeGreaterThan(0);
    for (const k of ['asset', 'w', 'h', 'crop']) expect(field('image')).toHaveProperty(k);
    for (const k of ['script', 'mode', 'w', 'h', 'picture']) expect(field('figure')).toHaveProperty(k);
    expect(field('figure')['picture']).toBeNull();
  });

  it('the figure card default script starts with the Incantly header (design 8, requirement R6.1)', () => {
    expect(String(field('figure')['script']).startsWith('# incantly 1')).toBe(true);
  });

  it('a check with no props fills the defaults for the kinds that have a default for everything', () => {
    for (const kind of [...BOX_KINDS, 'line', 'arrow', 'text', 'sticky', 'frame', 'figure']) {
      const checked = builtInKind(kind)?.check({});
      expect(checked?.ok, kind).toBe(true);
      if (checked?.ok === true) expect(plain(checked.value), kind).toBe(plain(builtInKind(kind)?.defaults));
    }
  });

  it('a new shape written with only a kind and a place takes the defaults (the shape of a click)', () => {
    const rig = shapeRig();
    const r = add(rig, 'ellipse', 5, 6);
    expect(r.props).toMatchObject({ w: field('ellipse')['w'], h: field('ellipse')['h'], fill: 'none' });
    expect(r).toMatchObject({ x: 5, y: 6, rotation: 0, parent: null, locked: false, opacity: 1 });
  });
});

describe('check refuses bad props with record_invalid, and a refused write changes nothing (errors.md, R2.1)', () => {
  const bad: readonly (readonly [string, string, unknown])[] = [
    ['rect', 'w', { w: -5 }],
    ['rect', 'w', { w: '10' }],
    ['rect', 'h', { h: Number.NaN }],
    ['rect', 'h', { h: Number.POSITIVE_INFINITY }],
    ['rect', 'fill', { fill: 'red' }],
    ['rect', 'stroke', { stroke: 12 }],
    ['rect', 'dash', { dash: 'wavy' }],
    ['rect', 'size', { size: 0 }],
    ['rect', 'label', { label: 7 }],
    ['ellipse', 'w', { w: 0 }],
    ['triangle', 'h', { h: -1 }],
    ['diamond', 'fill', { fill: '#12' }],
    ['star', 'dash', { dash: 3 }],
    ['line', 'points', { points: [0, 0] }],
    ['line', 'points', { points: [0, 0, 5] }],
    ['line', 'points', { points: [0, 0, Number.NaN, 4] }],
    ['line', 'points', { points: 'abc' }],
    ['line', 'closed', { closed: 'yes' }],
    ['arrow', 'start', { start: [1] }],
    ['arrow', 'end', { end: ['a', 'b'] }],
    ['arrow', 'bend', { bend: Number.NaN }],
    ['arrow', 'endHead', { endHead: 'star' }],
    ['text', 'text', { text: 5 }],
    ['text', 'size', { size: 1 }],
    ['text', 'align', { align: 'left' }],
    ['text', 'color', { color: 'blue' }],
    ['text', 'w', { w: 'wide' }],
    ['sticky', 'color', { color: 'yellow' }],
    ['sticky', 'text', { text: {} }],
    ['frame', 'w', { w: 0 }],
    ['frame', 'name', { name: 3 }],
    ['image', 'asset', { asset: 'picture.png' }],
    ['image', 'w', { w: -1 }],
    ['image', 'crop', { crop: { x: 0.8, y: 0, w: 0.5, h: 1 } }],
    ['figure', 'mode', { mode: '' }],
    ['figure', 'script', { script: 12 }],
    ['figure', 'w', { w: 0 }],
  ];

  it.each(bad)('%s refuses a bad %s', (kind, name, props) => {
    const checked = builtInKind(kind)?.check(props);
    expect(checked?.ok).toBe(false);
    if (checked !== undefined && !checked.ok) {
      expect(checked.kind).toBe('record_invalid');
      expect(String((checked.detail as { field?: unknown } | undefined)?.field ?? '')).toContain(name);
      expect(checked.message.length).toBeGreaterThan(0);
    }
  });

  it.each(ALL_KINDS.filter((k) => k !== 'ink'))('%s refuses props that are not an object', (kind) => {
    for (const props of [null, 5, 'text', [1, 2, 3]]) {
      const checked = builtInKind(kind)?.check(props);
      expect(checked?.ok, `${kind} ${String(props)}`).toBe(false);
      if (checked !== undefined && !checked.ok) expect(checked.kind).toBe('record_invalid');
    }
  });

  it('a transaction that writes a shape with bad props is refused, nothing is stored and no undo step is made', () => {
    const rig = shapeRig();
    const before = rig.core.store.size;
    const steps = rig.core.history.undoSteps;
    const refused = rig.core.store.change('user', (tx) => {
      tx.put({ id: 'shape:bad', page: pageOf(rig), kind: 'rect', x: 0, y: 0, rotation: 0, parent: null, index: 'a0', locked: false, opacity: 1, props: { w: -1, h: 5 }, meta: {} });
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.kind).toBe('record_invalid');
    expect(rig.core.store.size).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('a second shape in the same transaction does not rescue a bad one: all or nothing', () => {
    const rig = shapeRig();
    const refused = rig.core.store.change('user', (tx) => {
      tx.put({ id: 'shape:good', page: pageOf(rig), kind: 'rect', x: 0, y: 0, rotation: 0, parent: null, index: 'a0', locked: false, opacity: 1, props: { w: 5, h: 5 }, meta: {} });
      tx.put({ id: 'shape:worse', page: pageOf(rig), kind: 'text', x: 0, y: 0, rotation: 0, parent: null, index: 'a1', locked: false, opacity: 1, props: { align: 'left' }, meta: {} });
    });
    expect(refused.ok).toBe(false);
    expect(shapesOf(rig)).toHaveLength(0);
  });

  it('a good write keeps the values it was given and fills the rest', () => {
    const rig = shapeRig();
    const s = add(rig, 'rect', 0, 0, { w: 33, fill: '#ff0000' });
    expect(s.props).toMatchObject({ w: 33, fill: '#ff0000' });
    expect((s.props as { h: number }).h).toBeGreaterThan(0);
  });

  it('a stored shape props are frozen: writing in place fails (design 4)', () => {
    const rig = shapeRig();
    const s = add(rig, 'rect', 0, 0, { w: 10, h: 10 });
    expect(() => {
      (s.props as { w: number }).w = 99;
    }).toThrow();
    expect((get(rig, s.id).props as { w: number }).w).toBe(10);
  });
});

describe('geometry and hit tests (design 7.2)', () => {
  it.each(BOX_KINDS)('%s: the box is w by h from its own origin, and the page bounds hold it', (kind) => {
    const s = rec(kind, { w: 100, h: 60 }, { x: 10, y: 20 });
    const g = shapeGeometry(s);
    expect(g?.box).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 60 });
    expect(g?.pageCx).toBeCloseTo(60, 6);
    expect(g?.pageCy).toBeCloseTo(50, 6);
    expect(g?.bounds.minX).toBeLessThanOrEqual(10);
    expect(g?.bounds.maxX).toBeGreaterThanOrEqual(110);
    expect(g?.bounds.minY).toBeLessThanOrEqual(20);
    expect(g?.bounds.maxY).toBeGreaterThanOrEqual(80);
  });

  it.each(BOX_KINDS)('%s: a point on the line hits, a point far away does not', (kind) => {
    const s = rec(kind, { w: 100, h: 100 }, { x: 0, y: 0 });
    const g = shapeGeometry(s);
    // the first corner of the outline is on the line whatever the shape is
    const ox = g?.outline[0] ?? Number.NaN;
    const oy = g?.outline[1] ?? Number.NaN;
    expect(hit(s, ox, oy)).toBe(true);
    expect(hit(s, 500, 500)).toBe(false);
    expect(hit(s, -50, 50)).toBe(false);
  });

  it('a filled rect is hit anywhere inside, and an outside point is not', () => {
    const s = rec('rect', { w: 100, h: 60, fill: '#ffcc00' }, { x: 10, y: 20 });
    expect(hit(s, 60, 50)).toBe(true);
    expect(hit(s, 12, 22)).toBe(true);
    expect(hit(s, 5, 50)).toBe(false);
    expect(hit(s, 60, 90)).toBe(false);
  });

  it('a hit grows with the tolerance: a point 5 units outside misses at 1 and hits at 6', () => {
    const s = rec('rect', { w: 100, h: 60, fill: '#ffcc00' });
    expect(hit(s, 105, 30, 1)).toBe(false);
    expect(hit(s, 105, 30, 6)).toBe(true);
  });

  it('a hollow rect is hit on its edge', () => {
    const s = rec('rect', { w: 100, h: 60, size: 4 }, { x: 0, y: 0 });
    expect(hit(s, 50, 0)).toBe(true);
    expect(hit(s, 100, 30)).toBe(true);
  });

  it('a filled ellipse is hit at its middle and not in the corner of its box', () => {
    const s = rec('ellipse', { w: 100, h: 100, fill: '#ccddff' });
    expect(hit(s, 50, 50)).toBe(true);
    expect(hit(s, 3, 3)).toBe(false);
    expect(hit(s, 50, 1)).toBe(true);
  });

  it('a filled triangle is hit near its base and under the apex, not in the top corners', () => {
    const s = rec('triangle', { w: 100, h: 100, fill: '#ccddff' });
    expect(hit(s, 50, 20)).toBe(true);
    expect(hit(s, 10, 95)).toBe(true);
    expect(hit(s, 5, 5)).toBe(false);
    expect(hit(s, 95, 5)).toBe(false);
  });

  it('a filled diamond is hit at its middle and not in the corners of its box', () => {
    const s = rec('diamond', { w: 100, h: 100, fill: '#ccddff' });
    expect(hit(s, 50, 50)).toBe(true);
    expect(hit(s, 8, 8)).toBe(false);
    expect(hit(s, 92, 92)).toBe(false);
    expect(hit(s, 50, 2)).toBe(true);
  });

  it('a filled star is hit at its middle and not in the top corners of its box', () => {
    const s = rec('star', { w: 100, h: 100, fill: '#ccddff' });
    expect(hit(s, 50, 55)).toBe(true);
    expect(hit(s, 3, 3)).toBe(false);
    expect(hit(s, 97, 3)).toBe(false);
  });

  it('a box shape with a label is hit inside, where its text is', () => {
    const s = rec('rect', { w: 100, h: 60, label: 'hello' });
    expect(hit(s, 50, 30)).toBe(true);
  });

  it('a turned shape is hit where it is drawn: a thin filled rect turned a quarter turn covers a tall strip', () => {
    const s = rec('rect', { w: 100, h: 10, fill: '#000000' }, { x: 0, y: 0, rotation: Math.PI / 2 });
    // the middle is (50, 5); turned, the strip runs from y = -45 to y = 55 at x near 50
    expect(hit(s, 50, -30)).toBe(true);
    expect(hit(s, 50, 45)).toBe(true);
    expect(hit(s, 10, 5)).toBe(false);
    const g = shapeGeometry(s);
    expect(g?.pageCx).toBeCloseTo(50, 6);
    expect(g?.pageCy).toBeCloseTo(5, 6);
    expect((g?.bounds.maxY ?? 0) - (g?.bounds.minY ?? 0)).toBeGreaterThan(95);
  });

  it('toLocal and toPage are inverses of each other, for a turned shape', () => {
    const s = rec('rect', { w: 80, h: 40 }, { x: 30, y: 40, rotation: 0.7 });
    const g = shapeGeometry(s);
    const p = g?.toPage(12, 9) ?? { x: Number.NaN, y: Number.NaN };
    const l = g?.toLocal(p.x, p.y) ?? { x: Number.NaN, y: Number.NaN };
    expect(l.x).toBeCloseTo(12, 6);
    expect(l.y).toBeCloseTo(9, 6);
  });

  it('a line has the box of its points, is hit within half its width, and misses further away', () => {
    const s = rec('line', { points: [0, 0, 100, 0, 100, 50], size: 4 }, { x: 10, y: 10 });
    const g = shapeGeometry(s);
    expect(g?.box).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    expect(hit(s, 60, 11, 0)).toBe(true);
    expect(hit(s, 110, 40, 0)).toBe(true);
    expect(hit(s, 60, 30, 0)).toBe(false);
  });

  it('a closed line with a fill is hit inside; without a fill it is hit on its edge only', () => {
    const points = [0, 0, 100, 0, 100, 100, 0, 100];
    const filled = rec('line', { points, closed: true, fill: '#ffcc00' });
    const hollow = rec('line', { points, closed: true });
    expect(hit(filled, 50, 50)).toBe(true);
    expect(hit(hollow, 50, 50)).toBe(false);
    expect(hit(hollow, 50, 0)).toBe(true);
  });

  it('a straight arrow is hit along its line; a bent arrow is hit on its curve and not on the chord', () => {
    const straight = rec('arrow', { start: [0, 0], end: [200, 0] });
    expect(hit(straight, 100, 0)).toBe(true);
    expect(hit(straight, 100, 30)).toBe(false);
    // `bend` is the distance of the curve's middle from the chord: a quadratic curve reaches half of its control offset
    const bent = rec('arrow', { start: [0, 0], end: [200, 0], bend: 60 });
    const g = shapeGeometry(bent);
    expect(Math.abs(g?.bounds.minY ?? 0) + Math.abs(g?.bounds.maxY ?? 0)).toBeGreaterThan(50);
    const side = (g?.bounds.minY ?? 0) < -30 ? -60 : 60;
    expect(hit(bent, 100, side, 1)).toBe(true);
    expect(hit(bent, 100, 0, 1)).toBe(false);
  });

  it('an arrow bound box holds its ends', () => {
    const s = rec('arrow', { start: [10, 20], end: [110, 70] });
    const b = shapeGeometry(s)?.box;
    expect(b).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });

  it('text has the box of its laid out text and is hit inside it; a fixed width sets the width of the box', () => {
    const free = rec('text', { text: 'Hello world', size: 24 });
    const gf = shapeGeometry(free);
    expect(gf?.box.maxX).toBeGreaterThan(20);
    expect(gf?.box.maxY).toBeGreaterThan(20);
    expect(hit(free, 5, 5, 0)).toBe(true);
    expect(hit(free, 900, 5, 0)).toBe(false);
    const fixed = rec('text', { text: 'Hello world, a long line that must wrap inside the box', size: 24, w: 200 });
    const gx = shapeGeometry(fixed);
    expect((gx?.box.maxX ?? 0) - (gx?.box.minX ?? 0)).toBeCloseTo(200, 6);
    expect(gx?.box.maxY ?? 0).toBeGreaterThan(gf?.box.maxY ?? 0);
  });

  it('an empty text still has a box to click', () => {
    const g = shapeGeometry(rec('text', { text: '' }));
    expect((g?.box.maxX ?? 0) - (g?.box.minX ?? 0)).toBeGreaterThan(0);
    expect((g?.box.maxY ?? 0) - (g?.box.minY ?? 0)).toBeGreaterThan(0);
  });

  it('a sticky note has a fixed width, and grows taller with a long text (design 7.1)', () => {
    const short = shapeGeometry(rec('sticky', { text: 'hi' }));
    const long = shapeGeometry(rec('sticky', { text: Array.from({ length: 40 }, (_v, i) => `line ${i}`).join('\n') }));
    const w = (short?.box.maxX ?? 0) - (short?.box.minX ?? 0);
    expect(w).toBeGreaterThan(50);
    expect((long?.box.maxX ?? 0) - (long?.box.minX ?? 0)).toBe(w);
    expect((long?.box.maxY ?? 0) - (long?.box.minY ?? 0)).toBeGreaterThan((short?.box.maxY ?? 0) - (short?.box.minY ?? 0));
    expect(hit(rec('sticky', { text: 'hi' }), w / 2, 20, 0)).toBe(true);
  });

  it('a frame has the box w by h; its edge and its name pick it, and a click inside goes through to what is under it', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 100, 100, { w: 300, h: 200, name: 'Slide 1' });
    const inner = add(rig, 'rect', 150, 150, { w: 80, h: 60, fill: '#ffcc00' }, { parent: f.id });
    expect(shapeGeometry(f, rig.core.store.kinds)?.box).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 200 });
    expect(pickShape(rig.core, 100, 200, 2)?.id).toBe(f.id);
    expect(pickShape(rig.core, 190, 180, 2)?.id).toBe(inner.id);
    expect(pickShape(rig.core, 350, 270, 2)).toBeUndefined();
  });

  it('an image and a figure card have the box w by h and are hit anywhere inside', () => {
    const img = rec('image', { asset: 'asset:1', w: 160, h: 90 });
    const fig = rec('figure', { w: 360, h: 260 });
    expect(shapeGeometry(img)?.box).toEqual({ minX: 0, minY: 0, maxX: 160, maxY: 90 });
    expect(shapeGeometry(fig)?.box).toEqual({ minX: 0, minY: 0, maxX: 360, maxY: 260 });
    expect(hit(img, 80, 45, 0)).toBe(true);
    expect(hit(fig, 180, 130, 0)).toBe(true);
    expect(hit(img, 200, 45, 0)).toBe(false);
  });

  it('a shape of a kind with no geometry has none: it is not drawn, indexed or selected', () => {
    const odd: KindDef<Record<string, never>> = { kind: 'ghost', defaults: {}, check: () => ({ ok: true, value: {}, notices: [] }) };
    const kinds = new KindRegistry();
    kinds.register(odd);
    const rig = shapeRig('select', { kinds });
    const s = add(rig, 'ghost', 10, 10);
    expect(shapeGeometry(s, rig.core.store.kinds)).toBeUndefined();
    expect(pickShape(rig.core, 10, 10, 5)).toBeUndefined();
    expect(rig.core.drawList.itemsIn({ minX: -100, minY: -100, maxX: 100, maxY: 100 }, 1)).toHaveLength(0);
  });
});

describe('level of detail (design 9 item 6)', () => {
  const rig = shapeRig();
  const item = (s: ShapeRecord, scale: number): ReturnType<typeof rig.core.drawList.itemOf> => rig.core.drawList.itemOf(s, scale);
  const parts = (s: ShapeRecord, scale: number): readonly { readonly k: string; readonly dash?: readonly number[] }[] => {
    const i = item(s, scale);
    return i !== undefined && i.k === 'shape' ? i.parts : [];
  };

  it('a shape too small to see is not drawn', () => {
    expect(item(rec('rect', { w: 100, h: 60 }), 0.001)).toBeUndefined();
    expect(item(rec('ellipse', { w: 100, h: 60 }), 0.001)).toBeUndefined();
    expect(item(rec('rect', { w: 100, h: 60 }), 1)).toBeDefined();
  });

  it('a sticky note has no shadow when it is small on screen', () => {
    const s = rec('sticky', { text: 'note' });
    expect(parts(s, 1).length).toBeGreaterThan(parts(s, 0.05).length);
    expect(parts(s, 0.05).length).toBeGreaterThan(0);
  });

  it.each(['rect', 'line', 'arrow'] as const)('a dashed %s is dashed up close and solid when small', (kind) => {
    const props = kind === 'rect' ? { w: 100, h: 60, dash: 'dashed' } : kind === 'line' ? { points: [0, 0, 100, 0], dash: 'dashed' } : { start: [0, 0], end: [100, 0], dash: 'dashed' };
    const s = rec(kind, props);
    const near = parts(s, 1).find((p) => p.k === 'path');
    const far = parts(s, 0.15).find((p) => p.k === 'path');
    expect(near?.dash?.length ?? 0).toBeGreaterThan(0);
    expect(far).toBeDefined();
    expect(far?.dash?.length ?? 0).toBe(0);
  });

  it('text under 4 px on screen is a grey bar, not letters; at size it is letters', () => {
    const s = rec('text', { text: 'Hello board', size: 24 });
    expect(parts(s, 1).some((p) => p.k === 'glyph')).toBe(true);
    // 24 units at 0.1 is 2.4 px
    const far = parts(s, 0.1);
    expect(far.length).toBeGreaterThan(0);
    expect(far.some((p) => p.k === 'glyph')).toBe(false);
    expect(far.every((p) => p.k === 'path')).toBe(true);
    // under half a pixel it is not drawn at all
    expect(item(s, 0.005)).toBeUndefined();
  });

  it('a figure card draws only its frame when it is small, and its script text up close', () => {
    const s = rec('figure', { script: '# incantly 1\nf(x) = x^2\n', mode: 'graph', w: 360, h: 260 });
    expect(parts(s, 1).length).toBeGreaterThan(parts(s, 0.05).length);
    expect(parts(s, 0.05).length).toBeGreaterThan(0);
  });

  it('an image is one image part at every size that is drawn, with its asset and its crop', () => {
    const s = rec('image', { asset: 'asset:7', w: 100, h: 50, crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    for (const scale of [2, 1, 0.1]) {
      const ps = parts(s, scale) as readonly { k: string; asset?: string; crop?: unknown }[];
      expect(ps, String(scale)).toHaveLength(1);
      expect(ps[0]).toMatchObject({ k: 'image', asset: 'asset:7', crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    }
  });

  it('the draw item keeps the shape place, turn and opacity', () => {
    const s = rec('rect', { w: 100, h: 60 }, { x: 12, y: 34, rotation: 0.5, opacity: 0.4 });
    const i = item(s, 1);
    expect(i).toMatchObject({ k: 'shape', id: 'shape:t', x: 12, y: 34, rotation: 0.5, a: 0.4 });
  });
});

describe('text with $…$ maths (design 7.1)', () => {
  const glyphs = (s: ShapeRecord): readonly { readonly s: string; readonly px: number; readonly y: number }[] => {
    const i = BoardCore.create({});
    if (!i.ok) throw new Error(i.message);
    const drawn = i.value.drawList.itemOf(s, 1);
    if (drawn === undefined || drawn.k !== 'shape') return [];
    return drawn.parts.filter((p) => p.k === 'glyph').map((p) => p as { s: string; px: number; y: number });
  };

  it('plain text is one run of letters', () => {
    const g = glyphs(rec('text', { text: 'x squared', size: 24 }));
    expect(g.map((p) => p.s).join('')).toBe('x squared');
  });

  it('a superscript between dollars is typeset: the exponent is a smaller glyph and sits higher', () => {
    const g = glyphs(rec('text', { text: '$x^2$', size: 24 }));
    expect(g.length).toBeGreaterThanOrEqual(2);
    const base = g.find((p) => p.s === 'x');
    const exp = g.find((p) => p.s === '2');
    expect(base).toBeDefined();
    expect(exp).toBeDefined();
    expect(exp?.px ?? 99).toBeLessThan(base?.px ?? 0);
    expect(exp?.y ?? 99).toBeLessThan(base?.y ?? 0);
  });

  it('the same letters without dollars are not typeset: the caret stays in the text', () => {
    const g = glyphs(rec('text', { text: 'x^2', size: 24 }));
    expect(g.map((p) => p.s).join('')).toBe('x^2');
  });

  it('a fraction has a bar: a filled part besides the glyphs', () => {
    const i = BoardCore.create({});
    if (!i.ok) throw new Error(i.message);
    const drawn = i.value.drawList.itemOf(rec('text', { text: '$\\frac{1}{2}$', size: 24 }), 1);
    expect(drawn?.k).toBe('shape');
    if (drawn?.k === 'shape') {
      expect(drawn.parts.some((p) => p.k === 'path')).toBe(true);
      expect(drawn.parts.filter((p) => p.k === 'glyph').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('text around the maths stays plain: words, then the formula, then words', () => {
    const g = glyphs(rec('text', { text: 'area is $\\pi r^2$ here', size: 24 }));
    const joined = g.map((p) => p.s).join('');
    expect(joined.startsWith('area is')).toBe(true);
    expect(joined.endsWith('here')).toBe(true);
  });

  it('maths makes the box taller than the same size of plain text', () => {
    const plainBox = shapeGeometry(rec('text', { text: 'x', size: 24 }))?.box;
    const mathBox = shapeGeometry(rec('text', { text: '$\\frac{x^2}{y^2}$', size: 24 }))?.box;
    expect((mathBox?.maxY ?? 0) - (mathBox?.minY ?? 0)).toBeGreaterThan((plainBox?.maxY ?? 0) - (plainBox?.minY ?? 0));
  });

  it('the label of a box shape is typeset too', () => {
    const i = BoardCore.create({});
    if (!i.ok) throw new Error(i.message);
    const drawn = i.value.drawList.itemOf(rec('rect', { w: 200, h: 100, label: '$x^2$' }), 1);
    expect(drawn?.k === 'shape' && drawn.parts.filter((p) => p.k === 'glyph').length).toBeGreaterThanOrEqual(2);
  });
});

describe('a frame clips what it holds (design 7.1)', () => {
  it('a child of a frame is drawn with the frame box as its clip; a shape outside any frame has none', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 100, 50, { w: 300, h: 200 });
    const child = add(rig, 'rect', 150, 80, { w: 500, h: 40 }, { parent: f.id });
    const free = add(rig, 'rect', 150, 400, { w: 50, h: 40 });
    const clipped = rig.core.drawList.itemOf(child, 1);
    const unclipped = rig.core.drawList.itemOf(free, 1);
    expect(clipped?.k).toBe('shape');
    if (clipped?.k === 'shape') expect(clipped.clip).toMatchObject({ x: 100, y: 50, rotation: 0, w: 300, h: 200 });
    if (unclipped?.k === 'shape') expect(unclipped.clip).toBeNull();
  });

  it('a frame itself is not clipped by its own box', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 0, 0, { w: 100, h: 100 });
    const i = rig.core.drawList.itemOf(f, 1);
    expect(i?.k === 'shape' && i.clip).toBeNull();
  });

  it('a shape in a group in a frame is clipped by the frame', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 0, 0, { w: 200, h: 200 });
    const g = add(rig, 'group', 0, 0, {}, { parent: f.id });
    const a = add(rig, 'rect', 10, 10, { w: 400, h: 20 }, { parent: g.id });
    const i = rig.core.drawList.itemOf(a, 1);
    expect(i?.k === 'shape' && i.clip).toMatchObject({ w: 200, h: 200 });
  });

  it('a turned frame clips with its turn', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 0, 0, { w: 200, h: 100 }, { rotation: 0.4 });
    const a = add(rig, 'rect', 10, 10, { w: 20, h: 20 }, { parent: f.id });
    const i = rig.core.drawList.itemOf(a, 1);
    expect(i?.k === 'shape' && i.clip?.rotation).toBeCloseTo(0.4, 9);
  });

  it('a shape dropped from a frame no longer has the clip after it leaves (parent null)', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 0, 0, { w: 200, h: 100 });
    const a = add(rig, 'rect', 10, 10, { w: 20, h: 20 }, { parent: f.id });
    rig.core.store.change('user', (tx) => void tx.update(a.id, { parent: null }));
    const i = rig.core.drawList.itemOf(get(rig, a.id), 1);
    expect(i?.k === 'shape' && i.clip).toBeNull();
  });
});

describe('images are told by their magic number (design 12; errors.md asset_invalid)', () => {
  it('sniffImage reads PNG, JPEG, WebP and SVG from the first bytes', () => {
    expect(sniffImage(pngBytes(4, 3))).toBe('image/png');
    expect(sniffImage(jpegBytes(4, 3))).toBe('image/jpeg');
    expect(sniffImage(webpBytes(4, 3))).toBe('image/webp');
    expect(sniffImage(svgBytes('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"></svg>'))).toBe('image/svg+xml');
  });

  it('bytes that are no image give nothing, whatever a caller calls them', () => {
    expect(sniffImage(svgBytes('hello world'))).toBeUndefined();
    expect(sniffImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeUndefined();
    expect(sniffImage(new Uint8Array(0))).toBeUndefined();
    // a PNG signature that stops one byte early is not a PNG
    expect(sniffImage(pngBytes(4, 3).subarray(0, 7))).toBeUndefined();
    // a GIF is not on the list
    expect(sniffImage(svgBytes('GIF89a\u0001\u0000\u0001\u0000'))).toBeUndefined();
  });

  it('the size is read from the bytes', () => {
    expect(imageSize(pngBytes(640, 480), 'image/png')).toEqual({ w: 640, h: 480 });
    expect(imageSize(jpegBytes(300, 200), 'image/jpeg')).toEqual({ w: 300, h: 200 });
    expect(imageSize(webpBytes(321, 123), 'image/webp')).toEqual({ w: 321, h: 123 });
    expect(imageSize(svgBytes('<svg viewBox="0 0 50 25" xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml')).toEqual({ w: 50, h: 25 });
  });

  it.each([
    ['png', pngBytes(40, 30), 'image/png'],
    ['jpeg', jpegBytes(40, 30), 'image/jpeg'],
    ['webp', webpBytes(40, 30), 'image/webp'],
    ['svg', svgBytes('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#f00"/></svg>'), 'image/svg+xml'],
  ] as const)('adding a %s makes an asset and an image shape in one undo step', (_name, bytes, mime) => {
    const rig = shapeRig();
    const steps = rig.core.history.undoSteps;
    const added = addImage(rig.core, bytes, { at: { x: 200, y: 150 } });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.kind).toBe('image');
    const assets = rig.core.store.all('asset');
    expect(assets).toHaveLength(1);
    expect((assets[0] as { mime: string }).mime).toBe(mime);
    expect((added.value.props as { asset: string }).asset).toBe(assets[0]?.id);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(ofKind(rig, 'image')).toHaveLength(0);
    expect(rig.core.store.all('asset')).toHaveLength(0);
  });

  it('a new image has the proportions of the picture and its middle at the place given', () => {
    const rig = shapeRig();
    const added = addImage(rig.core, pngBytes(1600, 800), { at: { x: 300, y: 200 } });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const { w, h } = added.value.props as { w: number; h: number };
    expect(w / h).toBeCloseTo(2, 2);
    const g = shapeGeometry(get(rig, added.value.id), rig.core.store.kinds);
    expect(g?.pageCx).toBeCloseTo(300, 6);
    expect(g?.pageCy).toBeCloseTo(200, 6);
  });

  const unsafe: readonly (readonly [string, string])[] = [
    ['a script element', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['an event attribute', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>'],
    ['a javascript link', '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="9" height="9"/></a></svg>'],
    ['a link to another site', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="https://example.com/a.png" width="9" height="9"/></svg>'],
    ['a foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="9" height="9"><div>hi</div></foreignObject></svg>'],
  ];

  it.each(unsafe)('an SVG with %s is refused as asset_invalid and nothing is added', (_why, text) => {
    const rig = shapeRig();
    const steps = rig.core.history.undoSteps;
    const size = rig.core.store.size;
    expect(imageProblem(svgBytes(text))).toBeDefined();
    const added = addImage(rig.core, svgBytes(text), { at: { x: 0, y: 0 } });
    expect(added.ok).toBe(false);
    if (!added.ok) {
      expect(added.kind).toBe('asset_invalid');
      expect(added.message.length).toBeGreaterThan(0);
    }
    expect(rig.core.store.size).toBe(size);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('an SVG that only points at a part of itself (#id) or holds a data: picture is allowed', () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="9" height="9"><defs><rect id="a" width="9" height="9"/></defs><use href="#a"/></svg>';
    expect(imageProblem(svgBytes(text))).toBeUndefined();
  });

  it.each([
    ['text that is not an image', svgBytes('just some text, not a picture')],
    ['an empty file', new Uint8Array(0)],
    ['random bytes', Uint8Array.from({ length: 64 }, (_v, i) => (i * 37 + 11) & 255).map((v) => (v === 0x89 ? 0 : v))],
  ] as const)('%s is refused as asset_invalid', (_name, bytes) => {
    const rig = shapeRig();
    const added = addImage(rig.core, bytes, { at: { x: 0, y: 0 } });
    expect(added.ok).toBe(false);
    if (!added.ok) expect(added.kind).toBe('asset_invalid');
    expect(rig.core.store.all('asset')).toHaveLength(0);
  });

  it('an image over 10 MB is refused as asset_invalid', () => {
    expect(ASSET_BYTES_MAX).toBe(10 * 1024 * 1024);
    const big = new Uint8Array(ASSET_BYTES_MAX + 1);
    big.set(pngBytes(10, 10));
    const rig = shapeRig();
    const added = addImage(rig.core, big, { at: { x: 0, y: 0 } });
    expect(added.ok).toBe(false);
    if (!added.ok) expect(added.kind).toBe('asset_invalid');
    expect(imageProblem(big)).toBeDefined();
  });

  it('an image of exactly 10 MB is allowed', () => {
    const edge = new Uint8Array(ASSET_BYTES_MAX);
    edge.set(pngBytes(10, 10));
    expect(imageProblem(edge)).toBeUndefined();
  });
});
