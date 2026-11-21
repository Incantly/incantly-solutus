/**
 * Bounds and hit tests of shapes by kind (design 7.2). Round 2 knows the `ink` kind; round 3 adds the others to the
 * same functions. A shape of a kind this build does not know has no geometry yet and is not indexed.
 */
import { inkBounds } from './ink/geometry';
import type { InkProps } from './kinds/ink';
import type { Bounds, ShapeRecord } from './types';

/** True for a stored ink stroke. */
export const isInk = (shape: ShapeRecord): shape is ShapeRecord<'ink', InkProps> => shape.kind === 'ink';

/** The page box of a shape, or undefined when its kind has no geometry. */
export function shapeBounds(shape: ShapeRecord): Bounds | undefined {
  return isInk(shape) ? inkBounds(shape) : undefined;
}

/** The smallest box holding both, or the other one when one is missing. */
export function unionBounds(a: Bounds | undefined, b: Bounds | undefined): Bounds | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}
