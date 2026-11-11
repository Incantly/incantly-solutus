/**
 * Deterministic repair helpers (docs/features/errors/design.md section 5): the nearest names and the line that would
 * define a missing one. They never throw; a helper that fails gives an empty list.
 */
import type { TypeName } from '../contracts/values';
import { closestNames } from '../language/errors';

export { closestNames };

/** The nearest existing names, at most `k`, closest first. */
export function nearestNames(name: string, candidates: Iterable<string>, k = 3): string[] {
  try {
    return closestNames(name, candidates, k);
  } catch {
    return [];
  }
}

/**
 * The line that would define `name` as a value of `type`, for an unknown name used there: `k = 1 in 0..10` for a
 * Number, `P = (0, 0)` for a Point, `u = Vector(1, 0)` for a Vector, `flag = true` for a Bool. Types without a plain literal give no line.
 */
export function defineLine(name: string, type: TypeName | string): string | undefined {
  switch (type) {
    case 'Number':
      return `${name} = 1 in 0..10`;
    case 'Point':
      return `${name} = (0, 0)`;
    case 'Vector':
      return `${name} = Vector(1, 0)`;
    case 'Bool':
      return `${name} = true`;
    case 'Text':
      return `${name} = "text"`;
    default:
      return undefined;
  }
}
