/**
 * BR-73 (docs/features/board/design.md 9 item 4, handoff/board/bench.md): shapes are triangles on the GPU. A shape's paths
 * are tessellated once per scale and kept on its parts; its text is a piece of a glyph atlas; a stroke's outline is shared
 * by every zoom step that makes the same triangles; a draw item is kept for a stored shape at a scale.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GlyphAtlas, ATLAS_SIZE } from '../../src/web/painter-atlas';
import type { AtlasTexture } from '../../src/web/painter-atlas';
import { cssRgba, meshOf } from '../../src/core/shape-mesh';
import { OutlineCache, saturatedTolerance } from '../../src/core/ink/outline';
import type { GlyphPart, Part, ShapeItem } from '../../src/core/paint';
import { line, drawPath } from './ink-helpers';
import { add, shapeRig } from './shape-helpers';
import { installGpu } from './gl-helpers';
import type { GpuProbe } from './gl-helpers';

const BOX = { minX: -2, minY: -2, maxX: 514, maxY: 514 };
const shapeItems = (rig: ReturnType<typeof shapeRig>, scale = 1): ShapeItem[] => rig.core.drawList.itemsIn(BOX, scale).filter((i): i is ShapeItem => i.k === 'shape');

describe('colours of parts', () => {
  it('reads hex and rgb() colours, and refuses what it does not know', () => {
    expect(cssRgba('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(cssRgba('#0f0')).toEqual([0, 1, 0, 1]);
    expect(cssRgba('#00000080')?.[3]).toBeCloseTo(128 / 255, 6);
    expect(cssRgba('rgba(15,23,42,0.18)')).toEqual([15 / 255, 23 / 255, 42 / 255, 0.18]);
    expect(cssRgba('rgb(255, 255, 255)')).toEqual([1, 1, 1, 1]);
    expect(cssRgba('red')).toBeNull();
    expect(cssRgba('transparent')).toBeNull();
  });
});

describe('the mesh of a shape', () => {
  it('a rect with a fill and a line is two runs, the fill first, with their own colours', () => {
    const rig = shapeRig('pen');
    add(rig, 'rect', 20, 20, { w: 100, h: 60, fill: '#ffe08a', stroke: '#1f2430', size: 3 });
    const item = shapeItems(rig)[0] as ShapeItem;
    const mesh = meshOf(item.parts, 1);
    expect(mesh).not.toBeNull();
    expect(mesh?.runs).toBe(2);
    expect(Array.from(mesh?.colors.slice(0, 3) ?? [])).toEqual([0xff / 255, 0xe0 / 255, 0x8a / 255].map((c) => Math.fround(c)));
    expect(mesh?.glyphs).toEqual([null, null]);
    expect(mesh?.vertexEnds[1]).toBeGreaterThan(mesh?.vertexEnds[0] as number);
  });

  it('is made once for a shape and a scale, and again for another scale', () => {
    const rig = shapeRig('pen');
    add(rig, 'ellipse', 20, 20, { w: 100, h: 60, fill: '#bfe3ff', stroke: '#1f2430', size: 3 });
    const item = shapeItems(rig)[0] as ShapeItem;
    const a = meshOf(item.parts, 1);
    expect(meshOf(item.parts, 1)).toBe(a);
    const b = meshOf(item.parts, 4);
    expect(b).not.toBe(a);
    // a finer scale cuts the curve into more segments
    expect((b?.vertices.length ?? 0)).toBeGreaterThan(a?.vertices.length ?? 0);
  });

  it('a picture has no mesh, and text is a run of its own that makes no triangles', () => {
    const rig = shapeRig('pen');
    add(rig, 'image', 20, 20, { asset: 'asset:a', w: 100, h: 60 });
    add(rig, 'text', 200, 20, { text: 'Area' });
    const items = shapeItems(rig);
    const picture = items.find((i) => i.parts.some((p: Part) => p.k === 'image')) as ShapeItem;
    const text = items.find((i) => i.parts.some((p: Part) => p.k === 'glyph')) as ShapeItem;
    expect(meshOf(picture.parts, 1)).toBeNull();
    const mesh = meshOf(text.parts, 1);
    expect(mesh?.glyphs.some((g) => g !== null)).toBe(true);
    expect(mesh?.maxVertices).toBeGreaterThanOrEqual(4);
    expect(mesh?.maxIndices).toBeGreaterThanOrEqual(6);
  });

  it('a stored shape that changes is a new record and gets a new mesh', () => {
    const rig = shapeRig('pen');
    const r = add(rig, 'rect', 20, 20, { w: 100, h: 60, fill: '#ffe08a', stroke: '#1f2430', size: 3 });
    const before = meshOf((shapeItems(rig)[0] as ShapeItem).parts, 1);
    const changed = rig.core.store.change('user', (tx) => {
      tx.update(r.id, { props: { ...r.props, w: 160 } } as Record<string, unknown>);
    });
    expect(changed.ok).toBe(true);
    const after = meshOf((shapeItems(rig)[0] as ShapeItem).parts, 1);
    expect(after).not.toBe(before);
    expect(Math.max(...Array.from(after?.vertices ?? []))).toBeGreaterThan(Math.max(...Array.from(before?.vertices ?? [])));
  });
});

describe('the draw item of a stored shape', () => {
  it('is kept for the same record and scale, and made again for another scale', () => {
    const rig = shapeRig('pen');
    const r = add(rig, 'rect', 20, 20, { w: 100, h: 60 });
    const list = rig.core.drawList;
    const a = list.itemOf(r, 1);
    expect(list.itemOf(r, 1)).toBe(a);
    expect(list.itemOf(r, 2)).not.toBe(a);
  });

  it('a shape inside a frame is made fresh every time: its clip is the frame\'s record', () => {
    const rig = shapeRig('pen');
    const frame = add(rig, 'frame', 0, 0, { w: 300, h: 300 });
    const inside = add(rig, 'rect', 20, 20, { w: 100, h: 60 }, { parent: frame.id });
    const list = rig.core.drawList;
    const a = list.itemOf(inside, 1);
    expect(a?.k === 'shape' && a.clip !== null).toBe(true);
    expect(list.itemOf(inside, 1)).not.toBe(a);
  });
});

describe('stroke outlines at several zoom steps', () => {
  it('a small stroke has one outline for every step far enough out; a bigger zoom that cuts its arcs finer builds another', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(10, 10, 60, 30, 12), {}, 0);
    const cache = new OutlineCache();
    const stroke = rig.core.store.shapesOn(rig.core.pages.current as string).find((s) => s.kind === 'ink');
    const props = (stroke as unknown as { props: { points: Float32Array; stride: 3 | 5; size: number; nib: 'pen' } }).props;
    const owner = props.points;
    const get = (tolerance: number) => cache.get(owner, props.points, props.stride, { size: props.size, nib: props.nib, tolerance });
    const far = get(8);
    expect(get(4)).toBe(far);
    expect(get(saturatedTolerance(props.size) * 3)).toBe(far);
    expect(cache.has(owner, 2)).toBe(true);
    const near = get(0.01);
    expect(near).not.toBe(far);
    expect(near.vertices.length).toBeGreaterThanOrEqual(far.vertices.length);
  });

  it('the shared outline is the same triangles a build at the larger tolerance makes', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(10, 10, 80, 40, 12), {}, 0);
    const stroke = rig.core.store.shapesOn(rig.core.pages.current as string).find((s) => s.kind === 'ink');
    const props = (stroke as unknown as { props: { points: Float32Array; stride: 3 | 5; size: number; nib: 'pen' } }).props;
    const a = new OutlineCache().get(props.points, props.points, props.stride, { size: props.size, nib: props.nib, tolerance: saturatedTolerance(props.size) });
    const b = new OutlineCache().get({}, props.points, props.stride, { size: props.size, nib: props.nib, tolerance: 100 });
    expect(Array.from(b.vertices)).toEqual(Array.from(a.vertices));
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
  });
});

describe('the glyph atlas', () => {
  let probe: GpuProbe;
  let uploads: { x: number; y: number }[];
  let whites: number;
  let atlas: GlyphAtlas;
  const texture: AtlasTexture = {
    upload: (_source, x, y) => {
      uploads.push({ x, y });
      return true;
    },
    fillWhite: () => {
      whites++;
      return true;
    },
  };
  const glyph = (s: string, px = 20): GlyphPart => ({ k: 'glyph', x: 0, y: 0, s, font: 'text', family: 'sans', px, color: '#1f2430' });
  beforeEach(() => {
    probe = installGpu();
    uploads = [];
    whites = 0;
    atlas = new GlyphAtlas(texture);
    atlas.beginTile();
  });
  afterEach(() => probe.restore());

  it('writes the white block when it starts', () => {
    expect(whites).toBe(1);
  });

  it('draws a piece of text once for its string, font and size on screen', () => {
    const a = atlas.slot(glyph('Area'), 1);
    expect(a).not.toBeNull();
    expect(atlas.slot(glyph('Area'), 1)).toBe(a);
    expect(uploads).toHaveLength(1);
    expect(atlas.slot(glyph('Area'), 2)).not.toBe(a);
    expect(atlas.slot(glyph('Other'), 1)).not.toBe(a);
    expect(uploads).toHaveLength(3);
  });

  it('places entries side by side without overlap, inside the texture', () => {
    const slots = ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map((s) => atlas.slot(glyph(s), 1));
    for (const s of slots) {
      expect(s).not.toBeNull();
      expect((s?.u1 ?? 2) <= 1 && (s?.v1 ?? 2) <= 1).toBe(true);
    }
    const boxes = slots.map((s) => [(s?.u0 ?? 0) * ATLAS_SIZE, (s?.v0 ?? 0) * ATLAS_SIZE, (s?.u1 ?? 0) * ATLAS_SIZE, (s?.v1 ?? 0) * ATLAS_SIZE] as const);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]] as [readonly number[], readonly number[]];
        const apart = (a[2] as number) <= (b[0] as number) || (b[2] as number) <= (a[0] as number) || (a[3] as number) <= (b[1] as number) || (b[3] as number) <= (a[1] as number);
        expect(apart).toBe(true);
      }
    }
  });

  it('inside one tile a full atlas gives no entry (the shape is drawn with Canvas 2D), and the next tile starts it again', () => {
    let n = 0;
    while (atlas.slot(glyph(`piece ${n}`), 1) !== null && n < 100000) n++;
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(100000);
    atlas.beginTile();
    expect(atlas.slot(glyph('after'), 1)).not.toBeNull();
  });

  it('starts again between tiles once it is nearly full, and writes its white block again', () => {
    let n = 0;
    while (atlas.size < 100000 && whites === 1 && n < 6000) {
      atlas.slot(glyph(`piece ${n}`, 30), 1);
      atlas.beginTile();
      n++;
    }
    expect(whites).toBe(2);
    expect(atlas.size).toBeLessThan(n);
  });
});
