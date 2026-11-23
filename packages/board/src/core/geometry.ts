/**
 * Where a shape is and what it covers (design 7.2). A kind says where its shape's box is, in the shape's own
 * coordinates; the core puts the shape in the page: it turns about the centre of its box by `rotation`, and the box's
 * origin sits at the shape's `x, y`. So a point of the shape at `l` in its own coordinates is at
 * `(x, y) + c + R(rotation) (l - c)` on the page, with `c` the centre of the box. The results are cached on the
 * record (a record is never changed in place), and dropped when the text measuring function changes. No DOM.
 */
import { inkBounds } from './ink/geometry';
import type { InkProps } from './kinds/ink';
import { builtInKind } from './kinds/builtin';
import type { KindDef, KindGeometry } from './kinds/def';
import type { KindRegistry } from './kinds/def';
import { boxCx, boxCy, rotateAbout } from './math2d';
import { measureGeneration } from './text';
import type { Bounds, ShapeRecord } from './types';

/** True for a stored ink stroke. */
export const isInk = (shape: ShapeRecord): shape is ShapeRecord<'ink', InkProps> => shape.kind === 'ink';

export interface Geometry {
  /** The kind's box, in the shape's own coordinates. */
  readonly box: Bounds;
  /** The centre of the box in the shape's own coordinates: the point the shape turns about. */
  readonly cx: number;
  readonly cy: number;
  /** The centre of the box on the page. */
  readonly pageCx: number;
  readonly pageCy: number;
  /** The page box of the drawing: the rotated box's box, grown by the kind's `pad`. */
  readonly bounds: Bounds;
  /** The corners of the rotated box on the page: top-left, top-right, bottom-right, bottom-left, as 8 numbers. */
  readonly corners: readonly number[];
  /** The outline on the page, `[x0, y0, …]`: the kind's polygon, rotated, or the corners. */
  readonly outline: readonly number[];
  /** True when the page point is on the shape, to within `tol` page units. */
  hit(px: number, py: number, tol: number): boolean;
  /** A page point in the shape's own coordinates. */
  toLocal(px: number, py: number): { readonly x: number; readonly y: number };
  /** A point of the shape's own coordinates on the page. */
  toPage(lx: number, ly: number): { readonly x: number; readonly y: number };
}

interface Cached {
  readonly generation: number;
  readonly kinds: KindRegistry | undefined;
  readonly geometry: Geometry | undefined;
}

const cache = new WeakMap<object, Cached>();

function build(shape: ShapeRecord, def: KindDef): Geometry | undefined {
  if (def.geometry === undefined) return undefined;
  let kg: KindGeometry;
  try {
    kg = def.geometry(shape);
  } catch {
    return undefined;
  }
  const { box } = kg;
  if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) return undefined;
  const cx = boxCx(box);
  const cy = boxCy(box);
  const rot = shape.rotation;
  const toPage = (lx: number, ly: number): { x: number; y: number } => {
    const r = rotateAbout(lx, ly, cx, cy, rot);
    return { x: shape.x + r.x, y: shape.y + r.y };
  };
  const toLocal = (px: number, py: number): { x: number; y: number } => rotateAbout(px - shape.x, py - shape.y, cx, cy, -rot);
  const corner = (lx: number, ly: number): [number, number] => {
    const p = toPage(lx, ly);
    return [p.x, p.y];
  };
  const corners = [...corner(box.minX, box.minY), ...corner(box.maxX, box.minY), ...corner(box.maxX, box.maxY), ...corner(box.minX, box.maxY)];
  const xs = [corners[0], corners[2], corners[4], corners[6]] as number[];
  const ys = [corners[1], corners[3], corners[5], corners[7]] as number[];
  const pad = kg.pad;
  const bounds: Bounds =
    rot === 0 && def.kind === 'ink' && isInk(shape)
      ? inkBounds(shape)
      : { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
  let outline: readonly number[] = corners;
  if (kg.poly !== undefined) {
    const out: number[] = [];
    for (let i = 0; i + 1 < kg.poly.length; i += 2) {
      const p = toPage(kg.poly[i] as number, kg.poly[i + 1] as number);
      out.push(p.x, p.y);
    }
    outline = out;
  }
  const c = toPage(cx, cy);
  return {
    box,
    cx,
    cy,
    pageCx: c.x,
    pageCy: c.y,
    bounds,
    corners,
    outline,
    hit: (px, py, tol) => {
      const l = toLocal(px, py);
      try {
        return kg.hit(l.x, l.y, tol);
      } catch {
        return false;
      }
    },
    toLocal,
    toPage,
  };
}

/** The geometry of a shape, or undefined when its kind is not known or has none. `kinds` is the registry the shape lives in. */
export function shapeGeometry(shape: ShapeRecord, kinds?: KindRegistry): Geometry | undefined {
  const generation = measureGeneration();
  const known = cache.get(shape);
  if (known !== undefined && known.generation === generation && known.kinds === kinds) return known.geometry;
  const def = kinds?.get(shape.kind) ?? builtInKind(shape.kind);
  const geometry = def === undefined ? undefined : build(shape, def);
  cache.set(shape, { generation, kinds, geometry });
  return geometry;
}

/** The page box of a shape, or undefined when its kind has no geometry. */
export function shapeBounds(shape: ShapeRecord, kinds?: KindRegistry): Bounds | undefined {
  return shapeGeometry(shape, kinds)?.bounds;
}

/** The smallest box holding both, or the other one when one is missing. */
export function unionBounds(a: Bounds | undefined, b: Bounds | undefined): Bounds | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}
