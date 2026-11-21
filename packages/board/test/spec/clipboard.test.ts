// @vitest-environment node
/**
 * Copy and paste (docs/features/board/design.md 4 and 7.4; requirement R5.5): board JSON with a type tag inside one
 * board and between boards, plain text to a text shape, an Incantly script (header `# incantly 1`) to a figure card,
 * an image to an image shape, and a copy that shares nothing with its original. Only the public API is used.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIPBOARD_TYPE, PASTE_OFFSET, addImage, boundTarget, clipboardText, copySelection, groupShapes, isBoardClipboard, isScript, pasteAny, pasteData, pasteScript, pasteText,
  readClipboardText, translateShapes,
} from '../../src/index';
import type { ClipboardData, ShapeRecord } from '../../src/index';
import { dump } from './helpers';
import { add, boxOf, get, jpegBytes, ofKind, pageOf, plain, pngBytes, shapeRig, shapesOf, stick } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

const solid = (rig: BoardRig, x: number, y: number, w = 100, h = 60, over: Partial<ShapeRecord> = {}): ShapeRecord => add(rig, 'rect', x, y, { w, h, fill: '#ffcc00' }, over);

/** The text of a copy of these shapes. */
function copyText(rig: BoardRig, ids: readonly string[]): string {
  const data = copySelection(rig.core, ids);
  if (!data.ok) throw new Error(data.message);
  const text = clipboardText(rig.core, data.value);
  if (!text.ok) throw new Error(text.message);
  return text.value;
}

/** The new ids a paste made. */
function pasted(r: ReturnType<typeof pasteAny>): readonly string[] {
  if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
  return r.value;
}

/** A page-size box of a list of ids, as `[minX, minY, maxX, maxY]` of the box that holds them all. */
function hold(rig: BoardRig, ids: readonly string[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const boxes = ids.map((id) => boxOf(rig, id));
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

describe('a copy is board JSON with a type tag (design 7.4)', () => {
  it('the text of a copy is JSON with a type tag, and isBoardClipboard says so', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const text = copyText(rig, [a.id]);
    const parsed = JSON.parse(text) as { type?: unknown };
    expect(parsed.type).toBe(CLIPBOARD_TYPE);
    expect(typeof parsed.type).toBe('string');
    expect(isBoardClipboard(text)).toBe(true);
  });

  it('plain text, a script, JSON with no tag and broken JSON are not a board copy', () => {
    expect(isBoardClipboard('hello')).toBe(false);
    expect(isBoardClipboard('# incantly 1\nf(x) = x')).toBe(false);
    expect(isBoardClipboard('{"a":1}')).toBe(false);
    expect(isBoardClipboard('{"type":')).toBe(false);
    expect(isBoardClipboard('')).toBe(false);
    expect(isBoardClipboard('[1,2,3]')).toBe(false);
  });

  it('copying changes nothing in the board: no record, no undo step, selection as it was', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    copyText(rig, [a.id]);
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
    expect(rig.core.selection.ids).toEqual([a.id]);
  });

  it('copying nothing is bad_argument', () => {
    const rig = shapeRig();
    const r = copySelection(rig.core, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('bad_argument');
    const r2 = copySelection(rig.core, ['shape:nope']);
    expect(r2.ok).toBe(false);
  });

  it('the copy holds the shapes in stacking order, the bindings between them, and the assets they use', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const copied = copySelection(rig.core, [b.id, a.id]);
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.value.shapes.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(copied.value.bindings).toEqual([]);
    expect(copied.value.assets).toEqual([]);
  });
});

describe('paste inside one board', () => {
  it('puts new shapes on the current page, with new ids, in one undo step', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    const text = copyText(rig, [a.id, b.id]);
    const steps = rig.core.history.undoSteps;
    const ids = pasted(pasteAny(rig.core, text, { x: 500, y: 400 }));
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect([a.id, b.id]).not.toContain(id);
      expect(get(rig, id).page).toBe(pageOf(rig));
    }
    expect(shapesOf(rig)).toHaveLength(4);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(shapesOf(rig)).toHaveLength(2);
    rig.core.history.redo();
    expect(shapesOf(rig)).toHaveLength(4);
  });

  it('with a place given, the middle of the copies goes there; their layout between themselves is kept', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    const b = solid(rig, 300, 200, 100, 60);
    const ids = pasted(pasteAny(rig.core, copyText(rig, [a.id, b.id]), { x: 700, y: 500 }));
    const box = hold(rig, ids);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(700, 6);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(500, 6);
    const [pa, pb] = ids.map((id) => get(rig, id)) as [ShapeRecord, ShapeRecord];
    expect(pb.x - pa.x).toBeCloseTo(b.x - a.x, 6);
    expect(pb.y - pa.y).toBeCloseTo(b.y - a.y, 6);
  });

  it('without a place the copies sit a little to the side of the originals', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const data = copySelection(rig.core, [a.id]);
    if (!data.ok) throw new Error(data.message);
    const ids = pasted(pasteData(rig.core, data.value));
    expect(get(rig, ids[0] as string)).toMatchObject({ x: 100 + PASTE_OFFSET, y: 100 + PASTE_OFFSET });
  });

  it('the copies keep kind, props, turn and opacity, and go on top in the same order', () => {
    const rig = shapeRig();
    const a = add(rig, 'ellipse', 100, 100, { w: 77, h: 33, fill: '#112233', dash: 'dashed' }, { rotation: 0.6, opacity: 0.5 });
    const b = add(rig, 'star', 300, 100, { w: 90, h: 90 });
    const ids = pasted(pasteAny(rig.core, copyText(rig, [a.id, b.id]), { x: 0, y: 0 }));
    const [pa, pb] = ids.map((id) => get(rig, id)) as [ShapeRecord, ShapeRecord];
    expect(pa.kind).toBe('ellipse');
    expect(plain(pa.props)).toBe(plain(a.props));
    expect(pa.rotation).toBeCloseTo(0.6, 6);
    expect(pa.opacity).toBe(0.5);
    expect(pb.kind).toBe('star');
    expect(pa.index > b.index).toBe(true);
    expect(pb.index > pa.index).toBe(true);
  });

  it('the originals are not changed by a paste', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const before = plain(get(rig, a.id));
    pasted(pasteAny(rig.core, copyText(rig, [a.id]), { x: 0, y: 0 }));
    expect(plain(get(rig, a.id))).toBe(before);
  });

  it('pasting the same copy twice makes two separate sets of shapes', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const text = copyText(rig, [a.id]);
    const one = pasted(pasteAny(rig.core, text, { x: 400, y: 100 }));
    const two = pasted(pasteAny(rig.core, text, { x: 400, y: 300 }));
    expect(new Set([a.id, ...one, ...two]).size).toBe(3);
    expect(shapesOf(rig)).toHaveLength(3);
  });

  it('a pasted shape goes to the page that is current when it is pasted', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const text = copyText(rig, [a.id]);
    const second = rig.core.pages.addPage();
    if (!second.ok) throw new Error(second.message);
    rig.core.pages.goToPage(second.value.id);
    const ids = pasted(pasteAny(rig.core, text, { x: 50, y: 50 }));
    expect(get(rig, ids[0] as string).page).toBe(second.value.id);
  });

  it('a frame is copied with what it holds; the copies belong to the new frame', () => {
    const rig = shapeRig();
    const f = add(rig, 'frame', 100, 100, { w: 300, h: 200 });
    const inner = solid(rig, 150, 150, 50, 50, { parent: f.id });
    pasted(pasteAny(rig.core, copyText(rig, [f.id]), { x: 800, y: 400 }));
    const frames = ofKind(rig, 'frame');
    const rects = ofKind(rig, 'rect');
    expect(frames).toHaveLength(2);
    expect(rects).toHaveLength(2);
    const newFrame = frames.find((s) => s.id !== f.id) as ShapeRecord;
    const newInner = rects.find((s) => s.id !== inner.id) as ShapeRecord;
    expect(newInner.parent).toBe(newFrame.id);
    expect(get(rig, inner.id).parent).toBe(f.id);
  });

  it('a group is copied as a group: the copies move together', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 300, 100);
    groupShapes(rig.core, [a.id, b.id]);
    const ids = pasted(pasteAny(rig.core, copyText(rig, [a.id]), { x: 700, y: 500 }));
    expect(ids).toHaveLength(2);
    const parents = new Set(ids.map((id) => get(rig, id).parent));
    expect(parents.size).toBe(1);
    expect([...parents][0]).not.toBeNull();
    expect([...parents][0]).not.toBe(get(rig, a.id).parent);
  });

  it('an arrow stuck to two shapes and copied with them is stuck to the copies; the original stays on the originals', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    const arrow = add(rig, 'arrow', 200, 130, { start: [0, 0], end: [200, 0] });
    stick(rig, arrow.id, [['start', a.id, 150, 130], ['end', b.id, 450, 130]]);
    const ids = pasted(pasteAny(rig.core, copyText(rig, [a.id, b.id, arrow.id]), { x: 600, y: 600 }));
    expect(ids).toHaveLength(3);
    expect(rig.core.store.all('binding')).toHaveLength(4);
    const newArrow = ids.map((id) => get(rig, id)).find((s) => s.kind === 'arrow') as ShapeRecord;
    const newRects = ids.map((id) => get(rig, id)).filter((s) => s.kind === 'rect');
    expect(newRects.map((s) => s.id)).toContain(boundTarget(rig.core.store, newArrow.id, 'start'));
    expect(newRects.map((s) => s.id)).toContain(boundTarget(rig.core.store, newArrow.id, 'end'));
    expect(boundTarget(rig.core.store, arrow.id, 'start')).toBe(a.id);
    expect(boundTarget(rig.core.store, arrow.id, 'end')).toBe(b.id);
    // moving a copy moves the new arrow and leaves the old one
    const oldArrow = plain(get(rig, arrow.id));
    translateShapes(rig.core, [newRects[0]?.id as string], 0, 100);
    expect(plain(get(rig, arrow.id))).toBe(oldArrow);
  });

  it('an arrow copied without its shapes is pasted free', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const arrow = add(rig, 'arrow', 200, 130, { start: [0, 0], end: [200, 0] });
    stick(rig, arrow.id, [['start', a.id, 150, 130]]);
    const ids = pasted(pasteAny(rig.core, copyText(rig, [arrow.id]), { x: 600, y: 600 }));
    expect(rig.core.store.all('binding')).toHaveLength(1);
    expect(boundTarget(rig.core.store, ids[0] as string, 'start')).toBeUndefined();
  });
});

describe('paste between boards', () => {
  it('a copy from one board pasted into another makes the same shapes there', () => {
    const one = shapeRig();
    const two = shapeRig();
    const a = add(one, 'rect', 100, 100, { w: 40, h: 50, fill: '#ff0000', label: 'A' });
    const b = add(one, 'line', 300, 100, { points: [0, 0, 80, 30, 120, 0], size: 5 });
    const text = copyText(one, [a.id, b.id]);
    const ids = pasted(pasteAny(two.core, text, { x: 200, y: 200 }));
    expect(ids).toHaveLength(2);
    expect(shapesOf(two)).toHaveLength(2);
    expect(shapesOf(one)).toHaveLength(2);
    const kinds = ids.map((id) => get(two, id).kind).sort();
    expect(kinds).toEqual(['line', 'rect']);
    const rectCopy = ids.map((id) => get(two, id)).find((s) => s.kind === 'rect') as ShapeRecord;
    expect(plain(rectCopy.props)).toBe(plain(a.props));
    expect(get(two, rectCopy.id).page).toBe(pageOf(two));
  });

  it('the copy is plain text: it survives being written out and read back', () => {
    const one = shapeRig();
    const two = shapeRig();
    const a = solid(one, 100, 100);
    const text = copyText(one, [a.id]);
    const viaString = JSON.parse(JSON.stringify(text)) as string;
    expect(viaString).toBe(text);
    expect(pasted(pasteAny(two.core, viaString, { x: 0, y: 0 }))).toHaveLength(1);
  });

  it('a stroke keeps its points when it goes to another board, in another array', () => {
    const one = shapeRig();
    const two = shapeRig();
    const points = Float32Array.from([0, 0, 0.5, 10, 20, 0.6, 30, 5, 0.7, 40, 40, 0.8]);
    const ink = add(one, 'ink', 50, 60, { points, stride: 3, nib: 'marker', size: 6, color: '#336699', opacity: 1 });
    const ids = pasted(pasteAny(two.core, copyText(one, [ink.id]), { x: 100, y: 100 }));
    const copy = get(two, ids[0] as string);
    expect(copy.kind).toBe('ink');
    expect(copy.props).toMatchObject({ nib: 'marker', size: 6, color: '#336699', stride: 3 });
    const p = (copy.props as { points: Float32Array }).points;
    expect(p).not.toBe((ink.props as { points: Float32Array }).points);
    expect(p).toHaveLength(points.length);
    // the board file keeps pressure in 8 bits and positions in hundredths (design 12), and a copy travels as that file
    Array.from(points).forEach((v, i) => expect(p[i], `point value ${i}`).toBeCloseTo(v, i % 3 === 2 ? 2 : 1));
  });

  it('an image goes with its asset: the copy has the asset record in the new board', () => {
    const one = shapeRig();
    const two = shapeRig();
    const png = pngBytes(64, 32);
    const added = addImage(one.core, png, { at: { x: 100, y: 100 } });
    if (!added.ok) throw new Error(added.message);
    const ids = pasted(pasteAny(two.core, copyText(one, [added.value.id]), { x: 50, y: 50 }));
    const copy = get(two, ids[0] as string);
    expect(copy.kind).toBe('image');
    const assetId = (copy.props as { asset: string }).asset;
    const asset = two.core.store.get(assetId) as { mime: string; data: string; size: number } | undefined;
    expect(asset).toBeDefined();
    expect(asset?.mime).toBe('image/png');
    const original = one.core.store.get((added.value.props as { asset: string }).asset) as { data: string } | undefined;
    expect(asset?.data).toBe(original?.data);
    // undoing the paste takes the asset away with the shape
    two.core.history.undo();
    expect(two.core.store.all('asset')).toHaveLength(0);
  });

  it('an image copied inside one board still points at an asset that exists', () => {
    const rig = shapeRig();
    const added = addImage(rig.core, jpegBytes(20, 20), { at: { x: 100, y: 100 } });
    if (!added.ok) throw new Error(added.message);
    const ids = pasted(pasteAny(rig.core, copyText(rig, [added.value.id]), { x: 400, y: 400 }));
    const asset = (get(rig, ids[0] as string).props as { asset: string }).asset;
    expect(rig.core.store.get(asset)).toBeDefined();
  });
});

describe('a copy shares nothing with its original (design 4: copyProps)', () => {
  it('props and meta of each pasted shape are their own objects, at every depth', () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 100, 100, { points: [0, 0, 50, 50, 100, 0] }, { meta: { host: { tags: ['x', { deep: 1 }] } } });
    const ids = pasted(pasteAny(rig.core, copyText(rig, [a.id]), { x: 400, y: 400 }));
    const copy = get(rig, ids[0] as string);
    expect(copy.props).not.toBe(a.props);
    expect((copy.props as { points: number[] }).points).not.toBe((a.props as { points: number[] }).points);
    expect(copy.meta).not.toBe(a.meta);
    const ma = a.meta as { host: { tags: unknown[] } };
    const mc = copy.meta as { host: { tags: unknown[] } };
    expect(mc.host).not.toBe(ma.host);
    expect(mc.host.tags).not.toBe(ma.host.tags);
    expect(mc.host.tags[1]).not.toBe(ma.host.tags[1]);
    expect(mc.host.tags).toEqual(['x', { deep: 1 }]);
  });

  it('the data of a copy is its own: writing into its points does not change the stored stroke', () => {
    const rig = shapeRig();
    const ink = add(rig, 'ink', 0, 0, { points: Float32Array.from([0, 0, 0.5, 10, 10, 0.5]), stride: 3, nib: 'pen', size: 3, color: '#000000', opacity: 1 });
    const data = copySelection(rig.core, [ink.id]);
    if (!data.ok) throw new Error(data.message);
    const copied = data.value.shapes[0] as ShapeRecord;
    const pts = (copied.props as { points: Float32Array }).points;
    expect(pts).not.toBe((get(rig, ink.id).props as { points: Float32Array }).points);
    pts[0] = 999;
    expect((get(rig, ink.id).props as { points: Float32Array }).points[0]).toBe(0);
  });

  it('pasting the same data twice gives two arrays: writing into one leaves the other and the original alone', () => {
    const rig = shapeRig();
    const ink = add(rig, 'ink', 0, 0, { points: Float32Array.from([0, 0, 0.5, 10, 10, 0.5]), stride: 3, nib: 'pen', size: 3, color: '#000000', opacity: 1 });
    const data = copySelection(rig.core, [ink.id]);
    if (!data.ok) throw new Error(data.message);
    const one = pasted(pasteData(rig.core, data.value, { x: 300, y: 0 }));
    const two = pasted(pasteData(rig.core, data.value, { x: 600, y: 0 }));
    const p1 = (get(rig, one[0] as string).props as { points: Float32Array }).points;
    const p2 = (get(rig, two[0] as string).props as { points: Float32Array }).points;
    expect(p1).not.toBe(p2);
    expect(p1.buffer).not.toBe(p2.buffer);
    p1[0] = 123;
    expect(p2[0]).toBe(0);
    expect((get(rig, ink.id).props as { points: Float32Array }).points[0]).toBe(0);
  });

  it('a pasted shape can be changed and the undo history still holds what was pasted', () => {
    const rig = shapeRig();
    const a = add(rig, 'line', 0, 0, { points: [0, 0, 50, 50] });
    const ids = pasted(pasteAny(rig.core, copyText(rig, [a.id]), { x: 200, y: 200 }));
    translateShapes(rig.core, ids, 10, 10);
    rig.core.history.undo();
    expect(plain((get(rig, ids[0] as string).props as { points: number[] }).points)).toBe('[0,0,50,50]');
    expect(plain(a.props)).toBe(plain(get(rig, a.id).props));
  });
});

describe('plain text makes a text shape (design 7.4)', () => {
  it('a line of text becomes a text shape holding it, at the place given, in one undo step', () => {
    const rig = shapeRig();
    const steps = rig.core.history.undoSteps;
    const ids = pasted(pasteAny(rig.core, 'hello board', { x: 300, y: 200 }));
    expect(ids).toHaveLength(1);
    const s = get(rig, ids[0] as string);
    expect(s.kind).toBe('text');
    expect((s.props as { text: string }).text).toBe('hello board');
    const b = boxOf(rig, s.id);
    expect(b.minX).toBeLessThanOrEqual(300);
    expect(b.maxX).toBeGreaterThanOrEqual(300);
    expect(b.minY).toBeLessThanOrEqual(200);
    expect(b.maxY).toBeGreaterThanOrEqual(200);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(shapesOf(rig)).toHaveLength(0);
  });

  it('text with maths is kept as it is, so the board typesets it', () => {
    const rig = shapeRig();
    const ids = pasted(pasteAny(rig.core, 'the area is $\\pi r^2$', { x: 0, y: 0 }));
    expect((get(rig, ids[0] as string).props as { text: string }).text).toBe('the area is $\\pi r^2$');
  });

  it('several lines are one text shape with the lines kept', () => {
    const rig = shapeRig();
    const ids = pasted(pasteAny(rig.core, 'first line\nsecond line\nthird line', { x: 0, y: 0 }));
    expect(ids).toHaveLength(1);
    expect((get(rig, ids[0] as string).props as { text: string }).text).toBe('first line\nsecond line\nthird line');
  });

  it('pasteText does the same without looking at the text', () => {
    const rig = shapeRig();
    const ids = pasted(pasteText(rig.core, '# incantly 1 is only a word here', { x: 0, y: 0 }));
    expect(get(rig, ids[0] as string).kind).toBe('text');
  });

  it('text that only looks like JSON, but has no tag, is plain text', () => {
    const rig = shapeRig();
    const ids = pasted(pasteAny(rig.core, '{"a": 1}', { x: 0, y: 0 }));
    expect(get(rig, ids[0] as string).kind).toBe('text');
  });
});

describe('an Incantly script makes a figure card (design 7.4, 8)', () => {
  const script = '# incantly 1\nmode graph\nf(x) = x^2\n';

  it('isScript knows the header', () => {
    expect(isScript(script)).toBe(true);
    expect(isScript(`\n  ${script}`)).toBe(true);
    expect(isScript('f(x) = x^2')).toBe(false);
    expect(isScript('see # incantly 1')).toBe(false);
    expect(isScript('')).toBe(false);
  });

  it('pasting a script makes one figure shape holding the script, and no text shape', () => {
    const rig = shapeRig();
    const steps = rig.core.history.undoSteps;
    const ids = pasted(pasteAny(rig.core, script, { x: 400, y: 300 }));
    expect(ids).toHaveLength(1);
    const s = get(rig, ids[0] as string);
    expect(s.kind).toBe('figure');
    expect((s.props as { script: string }).script.startsWith('# incantly 1')).toBe(true);
    expect((s.props as { script: string }).script).toContain('f(x) = x^2');
    expect(ofKind(rig, 'text')).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
  });

  it('the figure card has its middle at the place given', () => {
    const rig = shapeRig();
    const ids = pasted(pasteAny(rig.core, script, { x: 400, y: 300 }));
    const b = boxOf(rig, ids[0] as string);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(400, 6);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(300, 6);
  });

  it('pasteScript makes the same figure card', () => {
    const rig = shapeRig();
    const ids = pasted(pasteScript(rig.core, script, { x: 0, y: 0 }));
    expect(get(rig, ids[0] as string).kind).toBe('figure');
  });

  it('a script with blank space before the header is still a script', () => {
    const rig = shapeRig();
    const ids = pasted(pasteAny(rig.core, `\n\n${script}`, { x: 0, y: 0 }));
    expect(get(rig, ids[0] as string).kind).toBe('figure');
  });
});

describe('an image makes an image shape (design 7.4)', () => {
  it('image bytes become an asset and an image shape on the page, in one undo step', () => {
    const rig = shapeRig();
    const steps = rig.core.history.undoSteps;
    const r = addImage(rig.core, pngBytes(300, 200), { at: { x: 250, y: 250 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe('image');
    expect(get(rig, r.value.id).page).toBe(pageOf(rig));
    expect(rig.core.store.all('asset')).toHaveLength(1);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
  });

  it('bytes that are not an image are refused (asset_invalid) and nothing is pasted', () => {
    const rig = shapeRig();
    const r = addImage(rig.core, new TextEncoder().encode('not a picture'), { at: { x: 0, y: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('asset_invalid');
    expect(shapesOf(rig)).toHaveLength(0);
  });
});

describe('a paste that cannot be made changes nothing (errors.md)', () => {
  it('a tagged copy whose board is broken is board_invalid', () => {
    const rig = shapeRig();
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    const text = JSON.stringify({ type: CLIPBOARD_TYPE, version: 1, board: 'not json' });
    const r = pasteAny(rig.core, text, { x: 0, y: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('board_invalid');
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('a tagged copy that holds no board is board_invalid', () => {
    const rig = shapeRig();
    const r = readClipboardText(rig.core, JSON.stringify({ type: CLIPBOARD_TYPE, version: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('board_invalid');
  });

  it('text that is not a copy is board_invalid to readClipboardText', () => {
    const rig = shapeRig();
    for (const text of ['hello', '{"type":"other"}', 'null', '[]']) {
      const r = readClipboardText(rig.core, text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.kind).toBe('board_invalid');
    }
  });

  it('a copy made by a newer version is board_too_new', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0);
    const parsed = JSON.parse(copyText(rig, [a.id])) as Record<string, unknown>;
    const r = readClipboardText(rig.core, JSON.stringify({ ...parsed, version: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('board_too_new');
  });

  it('a copy whose shapes fail their checks is refused and nothing is written', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0);
    const text = copyText(rig, [a.id]);
    const outer = JSON.parse(text) as { board: string };
    const inner = JSON.parse(outer.board) as { records: { props: { w: number } }[] };
    (inner.records[0] as { props: { w: number } }).props.w = -5;
    outer.board = JSON.stringify(inner);
    const before = dump(rig.core.store);
    const r = pasteAny(rig.core, JSON.stringify(outer), { x: 0, y: 0 });
    expect(r.ok).toBe(false);
    expect(dump(rig.core.store)).toBe(before);
  });

  it('a paste over the limit of shapes on a page is refused with limit, and nothing is written', () => {
    const rig = shapeRig('select', { limits: { shapesPerPage: 3 } });
    const a = solid(rig, 0, 0);
    const b = solid(rig, 200, 0);
    const text = copyText(rig, [a.id, b.id]);
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    const r = pasteAny(rig.core, text, { x: 500, y: 500 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('limit');
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('pasting an empty data set makes nothing', () => {
    const rig = shapeRig();
    const empty: ClipboardData = { shapes: [], bindings: [], assets: [] };
    const r = pasteData(rig.core, empty);
    expect(r.ok && r.value).toEqual([]);
    expect(rig.core.history.undoSteps).toBe(0);
  });
});
