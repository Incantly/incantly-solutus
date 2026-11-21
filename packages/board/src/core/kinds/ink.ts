/**
 * The `ink` kind (design 7.1): a pen stroke stored as its samples. `points` is a `Float32Array` of `x, y, pressure`
 * triples (`x, y, pressure, tiltX, tiltY` when `stride` is 5), relative to the shape's origin. The outline is derived
 * and cached (`core/ink/outline.ts`). `check` copies the points into an array of its own, so a caller that keeps its
 * array and writes to it later never changes a stored record or the history (BR-10).
 */
import { boardError, ok } from '../errors';
import type { BoardResult } from '../errors';
import { NIBS } from '../ink/outline';
import type { Nib } from '../ink/outline';
import type { Stride } from '../ink/samples';
import type { KindDef } from './def';

export interface InkProps {
  readonly points: Float32Array;
  readonly stride: Stride;
  readonly nib: Nib;
  /** The stroke's width at full pressure, in page units. */
  readonly size: number;
  /** `#rgb`, `#rrggbb` or `#rrggbbaa`. */
  readonly color: string;
  /** 0 to 1; the highlighter's is below 1. */
  readonly opacity: number;
}

export const INK_SIZE_MAX = 500;
export const INK_COLOR_DEFAULT = '#1f2430';

export const INK_DEFAULTS: InkProps = Object.freeze({
  points: new Float32Array(0),
  stride: 3,
  nib: 'pen',
  size: 3,
  color: INK_COLOR_DEFAULT,
  opacity: 1,
});

/**
 * The arrays this kind made. A record that comes back through `check` (a move, a patch to another field) keeps its
 * array, so the array is the same object while the points are the same points (BR-12: the outline is cached by it).
 * Any other array a caller hands in is copied.
 */
const stored = new WeakSet<Float32Array>();

const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** A `#rgb`, `#rrggbb` or `#rrggbbaa` colour as `[r, g, b, a]`, each 0 to 1; black when it does not parse. */
export function parseColor(color: string): readonly [number, number, number, number] {
  if (!COLOR.test(color)) return [0, 0, 0, 1];
  const hex = color.slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const at = (i: number): number => parseInt(full.slice(i, i + 2), 16) / 255;
  return [at(0), at(2), at(4), full.length === 8 ? at(6) : 1];
}

const bad = (field: string, message: string): ReturnType<typeof boardError> => boardError('record_invalid', message, { detail: { field } });

export const inkKind: KindDef<InkProps> = {
  kind: 'ink',
  defaults: INK_DEFAULTS,
  check(props: unknown): BoardResult<InkProps> {
    if (typeof props !== 'object' || props === null || Array.isArray(props)) return bad('props', 'Ink needs props.');
    const p = props as Record<string, unknown>;
    const stride = p['stride'] ?? 3;
    if (stride !== 3 && stride !== 5) return bad('props.stride', 'stride must be 3 (x, y, pressure) or 5 (and tiltX, tiltY).');
    const points = p['points'] ?? INK_DEFAULTS.points;
    if (!(points instanceof Float32Array) || points.length % stride !== 0) {
      return bad('props.points', `points must be a Float32Array of ${stride} numbers for each point.`);
    }
    for (let i = 0; i < points.length; i++) {
      if (!Number.isFinite(points[i])) return bad('props.points', 'Every number of an ink point must be finite.');
    }
    const nib = p['nib'] ?? INK_DEFAULTS.nib;
    if (typeof nib !== 'string' || !(NIBS as readonly string[]).includes(nib)) return bad('props.nib', `nib must be one of ${NIBS.join(', ')}.`);
    const size = p['size'] ?? INK_DEFAULTS.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || size > INK_SIZE_MAX) {
      return bad('props.size', `size must be a number above 0 and up to ${INK_SIZE_MAX}.`);
    }
    const color = p['color'] ?? INK_DEFAULTS.color;
    if (typeof color !== 'string' || !COLOR.test(color)) return bad('props.color', 'color must be #rgb, #rrggbb or #rrggbbaa.');
    const opacity = p['opacity'] ?? 1;
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) return bad('props.opacity', 'opacity must be a number from 0 to 1.');
    // the stored array is our own copy: nothing the caller keeps can change it
    let own = points;
    if (!stored.has(points)) {
      own = points.slice();
      stored.add(own);
    }
    return ok({ points: own, stride, nib: nib as Nib, size, color, opacity });
  },
  points: (props) => props.points.length / props.stride,
};
