/**
 * graphics-view/design.md 6 (drawables, the surface), 7 (painting) and
 * 8 (layers and draw order). Draw list, phases, splits, quality control.
 */
import { describe, expect, it } from 'vitest';
import {
  DrawList,
  GeometryDrawable,
  LIGHT_THEME,
  RecordSurface,
  ResolutionController,
  TYPE_RANK,
  VIEWPORT_DEPENDENT,
  affineApply,
  affineMul,
  affineScale,
  affineTranslate,
  compareSortKey,
  expandRect,
  geometryCacheKey,
  isCulled,
  paintDrawables,
  pathBounds,
  px,
  rectsOverlap,
  snapDevice,
  splitForActive,
  unionRect,
  updateDrawables,
  zoomClass,
} from '@incantly/view';
import type { PaintContext, SortKey } from '@incantly/view';
import { head, oid, stubDrawable, stubKernel, stubStyles, testStyle, testViewport } from './helpers';

function paintContext(): PaintContext {
  return {
    view: testViewport(), theme: LIGHT_THEME, selected: new Set(), hovered: null, focused: null,
    reducedMotion: false, t: 0,
  };
}

const measure = (_text: string, sizePx: number): { width: number; height: number } => ({
  width: _text.length * sizePx * 0.6,
  height: sizePx * 1.2,
});

describe('design 6 one surface interface', () => {
  it('6 RecordSurface records every call in order for golden checks', () => {
    const s = new RecordSurface();
    const r = { x0: px(0), x1: px(10), y0: px(0), y1: px(10) };
    s.save();
    s.clipRect(r);
    s.path(new Float32Array([0, 0, 10, 10]));
    s.stroke({ color: { r: 1, g: 0, b: 0, a: 1 }, width: 2, dash: [], dashPhase: 0, cap: 'butt', join: 'miter', miterLimit: 4, opacity: 1 });
    s.restore();
    expect(s.calls.map((c) => c.k)).toEqual(['save', 'clipRect', 'path', 'stroke', 'restore']);
    const path = s.calls[2];
    expect(path?.k).toBe('path');
    if (path?.k === 'path') expect(path.n).toBe(2);
  });

  it('6 RecordSurface measure is deterministic (0.6 em per char, no fonts)', () => {
    const s = new RecordSurface();
    const st = { size: 14, bold: false, italic: false, family: 'x', align: 'left', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, background: 'none' } as const;
    expect(s.measure({ text: 'hello', math: false }, st)).toEqual({ width: 42, height: 16.8, ascent: 12.6 });
    expect(s.measure({ text: 'hello', math: false }, st)).toEqual(s.measure({ text: 'hello', math: false }, st));
  });

  it('6 RecordSurface text/image/clipPath record their payloads; clear() empties', () => {
    const s = new RecordSurface();
    const st = { size: 14, bold: false, italic: false, family: 'x', align: 'left', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, background: 'none' } as const;
    s.text({ text: 'A', math: false }, { x: px(5), y: px(6) }, st);
    s.image({ key: 'k', widthPx: 4, heightPx: 4 }, { x0: px(0), x1: px(4), y0: px(0), y1: px(4) }, 0.5);
    s.clipPath(new Float32Array([0, 0, 4, 4]));
    expect(s.calls.map((c) => c.k)).toEqual(['text', 'image', 'clipPath']);
    s.clear();
    expect(s.calls).toEqual([]);
  });

  it('6 affine helpers compose and apply 2D transforms', () => {
    expect(affineApply(affineTranslate(10, 20), 1, 2)).toEqual({ x: 11, y: 22 });
    expect(affineApply(affineScale(2, 3), 4, 5)).toEqual({ x: 8, y: 15 });
    const both = affineMul(affineTranslate(10, 0), affineScale(2, 2));
    expect(affineApply(both, 1, 1)).toEqual({ x: 12, y: 2 });
  });

  it('6 pathBounds covers typed arrays and command paths, null when empty', () => {
    expect(pathBounds(new Float32Array([0, 0, 10, 20]))).toEqual({ x0: 0, x1: 10, y0: 0, y1: 20 });
    expect(pathBounds(new Float32Array([]))).toBeNull();
    const cmds = [{ k: 'M', x: 1, y: 2 }, { k: 'L', x: 5, y: 6 }] as const;
    expect(pathBounds(cmds)).toEqual({ x0: 1, x1: 5, y0: 2, y1: 6 });
  });

  it('6 rect helpers expand, union and overlap (edges count)', () => {
    const r = { x0: px(0), x1: px(10), y0: px(0), y1: px(10) };
    expect(expandRect(r, 2)).toEqual({ x0: -2, x1: 12, y0: -2, y1: 12 });
    expect(unionRect(null, r)).toEqual(r);
    expect(unionRect(r, null)).toEqual(r);
    expect(unionRect(null, null)).toBeNull();
    expect(rectsOverlap(r, { x0: px(5), x1: px(15), y0: px(5), y1: px(15) })).toBe(true);
    expect(rectsOverlap(r, { x0: px(10), x1: px(20), y0: px(0), y1: px(10) })).toBe(true);
    expect(rectsOverlap(r, { x0: px(11), x1: px(20), y0: px(0), y1: px(10) })).toBe(false);
  });

  it('7.6 axis-aligned 1px lines snap to half device pixels', () => {
    for (const [x, dpr] of [[10, 2], [10, 1], [7.3, 3], [0, 2]] as const) {
      const s = snapDevice(x, dpr);
      expect(Number.isInteger(s * dpr - 0.5)).toBe(true);
      expect(Math.abs(s - x)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
    }
  });
});

describe('design 8 layers and draw order', () => {
  it('8 type ranks follow the documented table', () => {
    expect(TYPE_RANK['image']).toBe(0);
    expect(TYPE_RANK['region']).toBe(1);
    expect(TYPE_RANK['curve']).toBe(2);
    expect(TYPE_RANK['arc']).toBe(2);
    expect(TYPE_RANK['line']).toBe(3);
    expect(TYPE_RANK['segment']).toBe(3);
    expect(TYPE_RANK['vector']).toBe(3);
    expect(TYPE_RANK['point']).toBe(5);
    expect(TYPE_RANK['particles']).toBe(5);
    expect(TYPE_RANK['text']).toBe(6);
    expect(TYPE_RANK['widget']).toBe(7);
  });

  it('8 angle rank is a documented angle rank (fill 1 or stroke 4)', () => {
    expect([1, 4]).toContain(TYPE_RANK['angle']);
  });

  it('8 sort keys order by layer, then rank, then creation order', () => {
    const k = (layer: number, rank: number, order: number): SortKey => ({ layer, rank, order });
    expect(compareSortKey(k(0, 5, 0), k(1, 0, 0))).toBeLessThan(0);
    expect(compareSortKey(k(0, 3, 0), k(0, 5, 0))).toBeLessThan(0);
    expect(compareSortKey(k(0, 5, 1), k(0, 5, 2))).toBeLessThan(0);
    expect(compareSortKey(k(1, 2, 3), k(1, 2, 3))).toBe(0);
  });

  it('7.2 viewport-dependent kinds rebuild on zoom; anchored ones do not', () => {
    for (const k of ['line', 'curve', 'arc', 'text'] as const) expect(VIEWPORT_DEPENDENT.has(k)).toBe(true);
    for (const k of ['point', 'segment', 'vector', 'region', 'widget', 'image'] as const) {
      expect(VIEWPORT_DEPENDENT.has(k)).toBe(false);
    }
  });
});

describe('design 7.1 draw list and kernel events', () => {
  it('7.1 add inserts at the sort position, not at the end', () => {
    const list = new DrawList();
    list.add(stubDrawable({ id: 1, kind: 'point', rank: 5, layer: 1, order: 0 }));
    list.add(stubDrawable({ id: 2, kind: 'point', rank: 5, layer: 0, order: 1 }));
    list.add(stubDrawable({ id: 3, kind: 'line', rank: 3, layer: 0, order: 2 }));
    expect(list.ids().map(Number)).toEqual([3, 2, 1]);
    expect(list.size).toBe(3);
  });

  it('7.1 remove drops drawables and reports their last bbox as damaged', () => {
    const list = new DrawList();
    list.add(stubDrawable({ id: 1, kind: 'point', rank: 5, bbox: { x0: 1, x1: 5, y0: 1, y1: 5 } }));
    list.add(stubDrawable({ id: 2, kind: 'point', rank: 5, bbox: null }));
    const damaged = list.remove([oid(1), oid(2)]);
    expect(damaged).toEqual([{ x0: 1, x1: 5, y0: 1, y1: 5 }]);
    expect(list.size).toBe(0);
  });

  it('7.1 a layer or order move reinserts the drawable (resort)', () => {
    const list = new DrawList();
    const d = stubDrawable({ id: 1, kind: 'point', rank: 5, layer: 0, order: 0 });
    list.add(d);
    list.add(stubDrawable({ id: 2, kind: 'point', rank: 5, layer: 0, order: 1 }));
    (d as unknown as { sortKey: SortKey }).sortKey = { layer: 3, rank: 5, order: 0 };
    list.resort(oid(1));
    expect(list.ids().map(Number)).toEqual([2, 1]);
  });

  it('7.1 applyEvent add/update/remove/restyle', () => {
    const list = new DrawList();
    list.applyEvent({ kind: 'add', ids: [oid(7)] }, (id) =>
      stubDrawable({ id: id as number, kind: 'point', rank: 5 }));
    expect(list.size).toBe(1);
    list.applyEvent({ kind: 'update', ids: [oid(7)] }, () => null);
    expect(list.get(oid(7))?.valueDirty).toBe(true);
    list.applyEvent({ kind: 'restyle', ids: [oid(7)] }, () => null);
    const e = list.get(oid(7));
    expect(e?.valueDirty === true || e?.viewDirty === true).toBe(true);
    const damaged = list.applyEvent({ kind: 'remove', ids: [oid(7)] }, () => null);
    expect(list.size).toBe(0);
    expect(damaged).toHaveLength(1);
  });

  it('7.1 add with a null factory result skips the id', () => {
    const list = new DrawList();
    list.applyEvent({ kind: 'add', ids: [oid(9)] }, () => null);
    expect(list.size).toBe(0);
  });

  it('7.2 markViewDirtyAll flags every drawable; pan shifts shiftable ones', () => {
    const list = new DrawList();
    const plain = stubDrawable({ id: 1, kind: 'point', rank: 5 });
    const shiftable = stubDrawable({ id: 2, kind: 'point', rank: 5 });
    (shiftable as unknown as Record<string, unknown>)['shiftPixels'] = () => true;
    list.add(plain);
    list.add(shiftable);
    list.markViewDirtyAll();
    expect(list.get(oid(1))?.viewDirty).toBe(true);
    expect(list.get(oid(2))?.viewDirty).toBe(true);
    const l2 = new DrawList();
    l2.add(plain);
    l2.add(shiftable);
    l2.markPanDirty(10, 0);
    expect(l2.get(oid(1))?.viewDirty).toBe(true);
    expect(l2.get(oid(2))?.viewDirty).toBe(false);
  });

  it('7.1 activeIds lists the drawables dirty this frame', () => {
    const list = new DrawList();
    list.add(stubDrawable({ id: 1, kind: 'point', rank: 5 }));
    list.add(stubDrawable({ id: 2, kind: 'point', rank: 5 }));
    for (const id of [oid(1), oid(2)]) {
      const e = list.get(id);
      if (e !== undefined) {
        e.valueDirty = false;
        e.viewDirty = false;
      }
    }
    list.applyEvent({ kind: 'update', ids: [oid(2)] }, () => null);
    expect(list.activeIds().map(Number)).toEqual([2]);
  });
});

describe('design 7.3 update phase', () => {
  function wired(): { list: DrawList; bbox: Map<number, unknown> } {
    const list = new DrawList();
    const g = new GeometryDrawable({ id: oid(1), name: 'A', kind: 'point', order: 0, layer: 0, free: true, onPath: false, measure });
    list.add(g);
    return { list, bbox: new Map() };
  }

  it('7.3 update rebuilds dirty drawables in draw order', () => {
    const { list, bbox } = wired();
    const objs = [{ head: head(1, 'A'), value: { k: 'point', x: 1, y: 2 }, kind: 'point' as const }];
    const kernel = stubKernel(objs);
    list.applyEvent({ kind: 'update', ids: [oid(1)] }, () => null);
    const rep = updateDrawables(list, { kernel, styles: stubStyles(objs) }, testViewport(), (id, b) => {
      bbox.set(id as number, b);
    });
    expect(rep.rebuilt).toBe(1);
    expect(rep.hidden).toBe(0);
    expect(bbox.get(1)).not.toBeNull();
    expect(list.get(oid(1))?.valueDirty).toBe(false);
  });

  it('6 undefined values keep their slot with bbox null (instant return)', () => {
    const { list } = wired();
    const kernel = stubKernel([]);
    list.applyEvent({ kind: 'update', ids: [oid(1)] }, () => null);
    const rep = updateDrawables(list, { kernel, styles: stubStyles([]) }, testViewport(), () => undefined);
    expect(rep.hidden).toBe(1);
    expect(list.get(oid(1))?.drawable.bbox).toBeNull();
    expect(list.get(oid(1))).not.toBeUndefined();
  });

  it('6 show-if false and visible false hide the drawable but keep the slot', () => {
    const { list } = wired();
    const kernel = stubKernel([{ head: head(1, 'A'), value: { k: 'point', x: 1, y: 2 }, kind: 'point', style: { show: false } }]);
    const styles = stubStyles([{ head: head(1, 'A'), value: { k: 'point', x: 1, y: 2 }, kind: 'point', style: { show: false } }]);
    list.applyEvent({ kind: 'update', ids: [oid(1)] }, () => null);
    const rep = updateDrawables(list, { kernel, styles }, testViewport(), () => undefined);
    expect(rep.hidden).toBe(1);
    expect(list.size).toBe(1);
  });
});

describe('design 7.4/7.5 paint, split, culling, quality', () => {
  it('7.5 culled drawables are the ones missing the viewport (or null)', () => {
    const view = { x0: px(0), x1: px(800), y0: px(0), y1: px(600) };
    expect(isCulled(null, view)).toBe(true);
    expect(isCulled({ x0: px(10), x1: px(20), y0: px(10), y1: px(20) }, view)).toBe(false);
    expect(isCulled({ x0: px(900), x1: px(910), y0: px(10), y1: px(20) }, view)).toBe(true);
    expect(isCulled({ x0: px(790), x1: px(810), y0: px(10), y1: px(20) }, view)).toBe(false);
  });

  it('8 labels paint in a per-layer text pass after their layer shapes', () => {
    const list = new DrawList();
    const a = stubDrawable({ id: 1, kind: 'line', rank: 3, layer: 0, order: 0 });
    const b = stubDrawable({ id: 2, kind: 'point', rank: 5, layer: 1, order: 1 });
    list.add(a);
    list.add(b);
    const order: string[] = [];
    const origA = a.paint;
    const origAL = a.paintLabel;
    a.paint = () => { order.push('A-shape'); origA.call(a); };
    a.paintLabel = () => { order.push('A-label'); origAL.call(a); };
    const origB = b.paint;
    const origBL = b.paintLabel;
    b.paint = () => { order.push('B-shape'); origB.call(b); };
    b.paintLabel = () => { order.push('B-label'); origBL.call(b); };
    const s = new RecordSurface();
    const view = { x0: px(0), x1: px(800), y0: px(0), y1: px(600) };
    const rep = paintDrawables(list, s, paintContext(), view);
    expect(order).toEqual(['A-shape', 'A-label', 'B-shape', 'B-label']);
    expect(rep.painted).toBe(2);
    expect(rep.labels).toBe(2);
  });

  it('7.5 paint skips culled drawables', () => {
    const list = new DrawList();
    const d = stubDrawable({ id: 1, kind: 'point', rank: 5, bbox: { x0: 900, x1: 910, y0: 10, y1: 20 } });
    list.add(d);
    const s = new RecordSurface();
    paintDrawables(list, s, paintContext(), { x0: px(0), x1: px(800), y0: px(0), y1: px(600) });
    expect(d.calls).not.toContain('paint');
  });

  it('6 drawables with no geometry are not painted', () => {
    const list = new DrawList();
    const d = stubDrawable({ id: 1, kind: 'point', rank: 5, bbox: null });
    list.add(d);
    const s = new RecordSurface();
    paintDrawables(list, s, paintContext(), { x0: px(0), x1: px(800), y0: px(0), y1: px(600) });
    expect(d.calls).not.toContain('paint');
  });

  it('7.4 partial split caches lower/upper and paints middle live', () => {
    const list = new DrawList();
    for (let i = 0; i < 10; i += 1) list.add(stubDrawable({ id: i, kind: 'point', rank: 5, order: i }));
    const split = splitForActive(list, new Set([oid(4)]));
    expect(split).not.toBeNull();
    if (split !== null) {
      expect(split.lower).toHaveLength(4);
      expect(split.middle.map((e) => e.drawable.id as number)).toEqual([4]);
      expect(split.upper).toHaveLength(5);
    }
  });

  it('7.4 the split is refused when middle holds more than half', () => {
    const list = new DrawList();
    for (let i = 0; i < 10; i += 1) list.add(stubDrawable({ id: i, kind: 'point', rank: 5, order: i }));
    expect(splitForActive(list, new Set([oid(0), oid(9)]))).toBeNull();
  });

  it('7.3 three overruns lower the curve detail one level, max two', () => {
    const c = new ResolutionController();
    expect(c.noteFrame(false)).toBe(0);
    expect(c.noteFrame(true)).toBe(0);
    expect(c.noteFrame(true)).toBe(0);
    expect(c.noteFrame(true)).toBe(1);
    c.noteFrame(true);
    c.noteFrame(true);
    expect(c.noteFrame(true)).toBe(2);
    c.noteFrame(true);
    c.noteFrame(true);
    expect(c.noteFrame(true)).toBe(2);
  });

  it('7.3 thirty good frames raise the detail again', () => {
    const c = new ResolutionController();
    c.noteFrame(true);
    c.noteFrame(true);
    c.noteFrame(true);
    expect(c.level).toBe(1);
    for (let i = 0; i < 29; i += 1) expect(c.noteFrame(false)).toBe(1);
    expect(c.noteFrame(false)).toBe(0);
  });

  it('7.3 a bad frame resets the good streak (consecutive good required)', () => {
    const c = new ResolutionController();
    c.noteFrame(true);
    c.noteFrame(true);
    c.noteFrame(true);
    for (let i = 0; i < 29; i += 1) c.noteFrame(false);
    c.noteFrame(true);
    for (let i = 0; i < 29; i += 1) expect(c.noteFrame(false)).toBe(1);
  });

  it('7.2 curve caches survive small zooms via the zoom class', () => {
    expect(zoomClass(100)).toBe(zoomClass(120));
    expect(zoomClass(50)).not.toBe(zoomClass(200));
    expect(zoomClass(80)).toBe(zoomClass(80));
  });

  it('7.2 geometry cache keys mix version, zoom and detail', () => {
    const a = geometryCacheKey(3, 80, 80, 0);
    expect(geometryCacheKey(3, 80, 80, 0)).toBe(a);
    expect(geometryCacheKey(4, 80, 80, 0)).not.toBe(a);
    expect(geometryCacheKey(3, 80, 80, 1)).not.toBe(a);
    expect(geometryCacheKey(3, 800, 800, 0)).not.toBe(a);
  });
});

describe('design 6 the concrete drawable', () => {
  function pointDrawable(): GeometryDrawable {
    return new GeometryDrawable({ id: oid(1), name: 'A', kind: 'point', order: 0, layer: 0, free: true, onPath: false, measure });
  }

  function pointInput(): { head: ReturnType<typeof head>; value: { defined: true; value: unknown } } {
    return { head: head(1, 'A'), value: { defined: true, value: { k: 'point', x: 1, y: 2 } } };
  }

  it('6 update is pure: same inputs paint identical calls', () => {
    const d = pointDrawable();
    const style = testStyle('point');
    expect(d.update(pointInput() as never, testViewport(), style)).toBe(true);
    const s1 = new RecordSurface();
    d.paint(s1, paintContext());
    const d2 = pointDrawable();
    d2.update(pointInput() as never, testViewport(), style);
    const s2 = new RecordSurface();
    d2.paint(s2, paintContext());
    expect(s2.calls).toEqual(s1.calls);
    expect(d2.bbox).toEqual(d.bbox);
  });

  it('6 undefined or hidden input draws nothing and reports bbox null', () => {
    const d = pointDrawable();
    const undef = { head: head(1, 'A'), value: { defined: false, undef: { reason: 'not_set' } } };
    expect(d.update(undef as never, testViewport(), testStyle('point'))).toBe(false);
    expect(d.bbox).toBeNull();
    expect(d.update(pointInput() as never, testViewport(), testStyle('point', { show: false }))).toBe(false);
    expect(d.bbox).toBeNull();
  });

  it('6 hit answers in view pixels with the point priority', () => {
    const d = pointDrawable();
    d.update(pointInput() as never, testViewport(), testStyle('point'));
    // A at maths (1,2) -> px (450,200).
    const hit = d.hit({ x: px(452), y: px(200) }, 7);
    expect(hit).not.toBeNull();
    expect(hit?.priority).toBe(1);
    expect(hit?.id).toBe(oid(1));
    expect(d.hit({ x: px(600), y: px(500) }, 7)).toBeNull();
  });

  it('6 outline paints hover/selected/focus/pulse halos without throwing', () => {
    const d = pointDrawable();
    d.update(pointInput() as never, testViewport(), testStyle('point'));
    for (const mode of ['hover', 'selected', 'focus', 'pulse'] as const) {
      const s = new RecordSurface();
      d.outline(s, mode);
      expect(s.calls.length).toBeGreaterThan(0);
    }
  });

  it('6 describe names the object for the screen reader', () => {
    const d = pointDrawable();
    d.update(pointInput() as never, testViewport(), testStyle('point'));
    expect(d.describe()).toContain('A');
  });

  it('6 labelRequest is null for label none, set for name', () => {
    const d = pointDrawable();
    d.update(pointInput() as never, testViewport(), testStyle('point', { label: 'none' }));
    expect(d.labelRequest()).toBeNull();
    d.update(pointInput() as never, testViewport(), testStyle('point', { label: 'name' }));
    const req = d.labelRequest();
    expect(req).not.toBeNull();
    expect(req?.text).toBe('A');
  });

  it('6 value labels use the kernel value text', () => {
    const d = pointDrawable();
    d.setValueText('(1, 2)');
    d.update(pointInput() as never, testViewport(), testStyle('point', { label: 'value' }));
    expect(d.labelRequest()?.text).toBe('(1, 2)');
  });

  it('6 anchor, rubberShape and widget rects expose cached geometry', () => {
    const d = pointDrawable();
    expect(d.anchor()).toBeNull();
    d.update(pointInput() as never, testViewport(), testStyle('point'));
    expect(d.anchor()).toEqual({ x: 450, y: 200 });
    expect(d.rubberShape()).not.toBeNull();
    d.setWidgetRect({ x0: px(0), x1: px(10), y0: px(0), y1: px(10) });
    d.setWidgetRect(null);
  });

  it('6 shiftPixels translates the cache after a pan', () => {
    const d = pointDrawable();
    d.update(pointInput() as never, testViewport(), testStyle('point'));
    const before = d.bbox;
    expect(d.shiftPixels(10, 5)).toBe(true);
    expect(d.bbox).not.toEqual(before);
    if (before !== null && d.bbox !== null) {
      expect(d.bbox.x0 - before.x0).toBe(10);
      expect(d.bbox.y0 - before.y0).toBe(5);
    }
  });

  it('6 setLayer moves the sort key; detail/join only affect later updates', () => {
    const d = pointDrawable();
    d.setLayer(4);
    expect(d.sortKey.layer).toBe(4);
    expect(d.rank).toBe(5);
    d.setDetail(2);
    d.setTraceJoin(true);
    d.setLabelOffset(6, -8);
    d.clearLabelOffset();
  });
});
