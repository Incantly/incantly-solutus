/**
 * Smooth noise (FM-5): gradient noise in one or two dimensions, from -1 to 1,
 * continuous with a continuous slope, and the same on every device and in
 * every run, so a figure that wobbles or a terrain that rolls looks the same
 * to every learner and to the probe. Whole numbers are its lattice: noise is
 * 0 there, and features are about one unit apart.
 */

/** A well-mixed hash of a lattice point, from -1 to 1. */
function hash(i: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** 6t^5 - 15t^4 + 10t^3: flat at both ends, so the noise and its slope are continuous. */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i) * f;
  const b = hash(i + 1) * (f - 1);
  // The gradients reach at most 1/2 between lattice points.
  return 2 * (a + fade(f) * (b - a));
}

function corner(ix: number, iy: number, dx: number, dy: number): number {
  const angle = hash(Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) * Math.PI;
  return Math.cos(angle) * dx + Math.sin(angle) * dy;
}

function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fade(fx);
  const v = fade(fy);
  const bottom = corner(ix, iy, fx, fy) + u * (corner(ix + 1, iy, fx - 1, fy) - corner(ix, iy, fx, fy));
  const top = corner(ix, iy + 1, fx, fy - 1) + u * (corner(ix + 1, iy + 1, fx - 1, fy - 1) - corner(ix, iy + 1, fx, fy - 1));
  // Unit gradients reach at most sqrt(1/2) in two dimensions.
  return Math.max(-1, Math.min(1, Math.SQRT2 * (bottom + v * (top - bottom))));
}

/** noise(x), or noise(x, y): smooth noise from -1 to 1; NaN for a value that is not finite. */
export function noise(x: number, y?: number): number {
  if (!Number.isFinite(x) || (y !== undefined && !Number.isFinite(y))) return Number.NaN;
  return y === undefined ? noise1(x) : noise2(x, y);
}
