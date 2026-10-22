import type { ShapeHelpers, Vec2 } from '../api/types';
import { SceneApiError } from '../scene/errors';
import { fmt } from '../scene/format';
import { polylinePath } from '../scene/path';

/**
 * Path data for the shapes school diagrams keep drawing (SV-4, DG-1, DG-6):
 * springs, resistors, coils, waves, gears, belts around pulleys, lenses,
 * circuit symbols, braces, tanks and cells. Each returns a path string for
 * stage.path(); the scene places and tones it.
 */

function finite(call: string, ...values: number[]): void {
  if (!values.every(Number.isFinite)) throw new SceneApiError(`shapes.${call} needs finite numbers`);
}

/** Points along a line from (x1, y1) to (x2, y2), offset sideways by `side(k)` at fraction k. */
function along(x1: number, y1: number, x2: number, y2: number, n: number, side: (k: number, i: number) => number): Vec2[] {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / length;
  const ny = (x2 - x1) / length;
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const s = side(k, i);
    out.push([x1 + (x2 - x1) * k + nx * s, y1 + (y2 - y1) * k + ny * s]);
  }
  return out;
}

function count(value: number | undefined, fallback: number, min: number, max: number, call: string): number {
  const n = Math.round(value ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max) throw new SceneApiError(`shapes.${call} takes from ${min} to ${max}`);
  return n;
}

const spring: ShapeHelpers['spring'] = (x1, y1, x2, y2, options = {}) => {
  finite('spring', x1, y1, x2, y2);
  const coils = count(options.coils, 8, 1, 60, 'spring coils');
  const width = options.width ?? 12;
  // Straight ends, then a zigzag of `coils` turns.
  const lead = 0.08;
  return polylinePath(
    along(x1, y1, x2, y2, coils * 2 + 2, (k, i) => {
      if (i === 0 || i === coils * 2 + 2) return 0;
      return (i % 2 === 0 ? -1 : 1) * width * (k < lead || k > 1 - lead ? 0.5 : 1);
    }),
  );
};

const zigzag: ShapeHelpers['zigzag'] = (x1, y1, x2, y2, options = {}) => {
  finite('zigzag', x1, y1, x2, y2);
  const teeth = count(options.teeth, 6, 2, 40, 'zigzag teeth');
  const width = options.width ?? 8;
  const n = teeth * 2 + 2;
  return polylinePath(along(x1, y1, x2, y2, n, (_k, i) => (i === 0 || i === 1 || i === n - 1 || i === n ? 0 : (i % 2 === 0 ? -1 : 1) * width)));
};

const coil: ShapeHelpers['coil'] = (x1, y1, x2, y2, options = {}) => {
  finite('coil', x1, y1, x2, y2);
  const loops = count(options.loops, 5, 1, 40, 'coil loops');
  const width = options.width ?? 10;
  const n = loops * 16;
  // A row of loops: a cycloid-like curve.
  return polylinePath(
    along(x1, y1, x2, y2, n, (k) => {
      const phase = k * loops * 2 * Math.PI;
      return -Math.abs(Math.sin(phase / 2)) * width;
    }),
  );
};

const wave: ShapeHelpers['wave'] = (x1, y1, x2, y2, options = {}) => {
  finite('wave', x1, y1, x2, y2);
  const amplitude = options.amplitude ?? 10;
  const wavelength = options.wavelength ?? 40;
  if (!(wavelength > 0)) throw new SceneApiError('shapes.wave needs a positive wavelength');
  const phase = options.phase ?? 0;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.min(400, Math.max(8, Math.ceil((length / wavelength) * 24)));
  return polylinePath(along(x1, y1, x2, y2, n, (k) => amplitude * Math.sin((2 * Math.PI * k * length) / wavelength + phase)));
};

const gear: ShapeHelpers['gear'] = (cx, cy, r, options = {}) => {
  finite('gear', cx, cy, r);
  const teeth = count(options.teeth, 12, 3, 120, 'gear teeth');
  const depth = r * (options.depth ?? 0.18);
  const points: Vec2[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * 2 * Math.PI;
    const step = (2 * Math.PI) / teeth;
    for (const [da, rr] of [
      [0, r - depth],
      [step * 0.12, r - depth],
      [step * 0.28, r],
      [step * 0.62, r],
      [step * 0.78, r - depth],
    ] as const) {
      points.push([cx + rr * Math.cos(a + da), cy + rr * Math.sin(a + da)]);
    }
  }
  return `${polylinePath(points)}Z`;
};

/** The outline of a belt around circles [cx, cy, r]: the convex hull of the circles. */
const hull: ShapeHelpers['hull'] = (circles) => {
  if (!Array.isArray(circles) || circles.length === 0 || circles.length > 24) throw new SceneApiError('shapes.hull needs from 1 to 24 circles [cx, cy, r]');
  const samples: Vec2[] = [];
  for (const c of circles) {
    const [cx, cy, r] = c;
    finite('hull', cx, cy, r);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * 2 * Math.PI;
      samples.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  // Monotone chain convex hull.
  const points = samples.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of points) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return `${polylinePath([...lower.slice(0, -1), ...upper.slice(0, -1)])}Z`;
};

/** A lens of the given height: `bulge` above 0 is convex, below 0 concave (as a fraction of the height). */
const lens: ShapeHelpers['lens'] = (cx, cy, height, options = {}) => {
  finite('lens', cx, cy, height);
  const bulge = options.bulge ?? 0.18;
  const h = height / 2;
  const b = bulge * height;
  const edge = bulge < 0 ? Math.abs(b) + 3 : 3;
  // Each face is a quadratic curve; a concave lens is thicker at its rim.
  return (
    `M${fmt(cx - edge)} ${fmt(cy - h)}Q${fmt(cx - edge - b * 2)} ${fmt(cy)} ${fmt(cx - edge)} ${fmt(cy + h)}` +
    `L${fmt(cx + edge)} ${fmt(cy + h)}Q${fmt(cx + edge + b * 2)} ${fmt(cy)} ${fmt(cx + edge)} ${fmt(cy - h)}Z`
  );
};

const battery: ShapeHelpers['battery'] = (x1, y1, x2, y2, options = {}) => {
  finite('battery', x1, y1, x2, y2);
  const cells = count(options.cells, 1, 1, 6, 'battery cells');
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const nx = -uy;
  const ny = ux;
  const gap = Math.min(10, length / (cells * 2 + 2));
  const start = length / 2 - (cells * 2 - 1) * (gap / 2);
  let d = `M${fmt(x1)} ${fmt(y1)}L${fmt(x1 + ux * start)} ${fmt(y1 + uy * start)}`;
  for (let i = 0; i < cells * 2; i++) {
    const at = start + i * gap;
    const half = i % 2 === 0 ? 14 : 7; // long plate positive, short plate negative
    const px = x1 + ux * at;
    const py = y1 + uy * at;
    d += `M${fmt(px + nx * half)} ${fmt(py + ny * half)}L${fmt(px - nx * half)} ${fmt(py - ny * half)}`;
  }
  const end = start + (cells * 2 - 1) * gap;
  d += `M${fmt(x1 + ux * end)} ${fmt(y1 + uy * end)}L${fmt(x2)} ${fmt(y2)}`;
  return d;
};

const capacitor: ShapeHelpers['capacitor'] = (x1, y1, x2, y2, options = {}) => {
  finite('capacitor', x1, y1, x2, y2);
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const gap = options.gap ?? 8;
  const half = (options.plate ?? 24) / 2;
  const a = length / 2 - gap / 2;
  const b = length / 2 + gap / 2;
  const pa: Vec2 = [x1 + ux * a, y1 + uy * a];
  const pb: Vec2 = [x1 + ux * b, y1 + uy * b];
  return (
    `M${fmt(x1)} ${fmt(y1)}L${fmt(pa[0])} ${fmt(pa[1])}M${fmt(pa[0] - uy * half)} ${fmt(pa[1] + ux * half)}L${fmt(pa[0] + uy * half)} ${fmt(pa[1] - ux * half)}` +
    `M${fmt(pb[0] - uy * half)} ${fmt(pb[1] + ux * half)}L${fmt(pb[0] + uy * half)} ${fmt(pb[1] - ux * half)}M${fmt(pb[0])} ${fmt(pb[1])}L${fmt(x2)} ${fmt(y2)}`
  );
};

const ground: ShapeHelpers['ground'] = (x, y, size = 14) => {
  finite('ground', x, y, size);
  return `M${fmt(x)} ${fmt(y)}V${fmt(y + size * 0.6)}M${fmt(x - size)} ${fmt(y + size * 0.6)}H${fmt(x + size)}M${fmt(x - size * 0.6)} ${fmt(y + size)}H${fmt(x + size * 0.6)}M${fmt(x - size * 0.25)} ${fmt(y + size * 1.4)}H${fmt(x + size * 0.25)}`;
};

const bulb: ShapeHelpers['bulb'] = (cx, cy, r) => {
  finite('bulb', cx, cy, r);
  const k = r * 0.7;
  return `M${fmt(cx + r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0M${fmt(cx - k)} ${fmt(cy - k)}L${fmt(cx + k)} ${fmt(cy + k)}M${fmt(cx - k)} ${fmt(cy + k)}L${fmt(cx + k)} ${fmt(cy - k)}`;
};

const switchShape: ShapeHelpers['switch'] = (x1, y1, x2, y2, closed) => {
  finite('switch', x1, y1, x2, y2);
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const a: Vec2 = [x1 + ux * length * 0.3, y1 + uy * length * 0.3];
  const b: Vec2 = [x1 + ux * length * 0.7, y1 + uy * length * 0.7];
  const lever: Vec2 = closed ? b : [a[0] + (b[0] - a[0]) * Math.cos(0.5) + uy * length * 0.2, a[1] + (b[1] - a[1]) * Math.cos(0.5) - ux * length * 0.2];
  return `M${fmt(x1)} ${fmt(y1)}L${fmt(a[0])} ${fmt(a[1])}L${fmt(lever[0])} ${fmt(lever[1])}M${fmt(b[0])} ${fmt(b[1])}L${fmt(x2)} ${fmt(y2)}`;
};

/** An open-topped container. */
const tank: ShapeHelpers['tank'] = (x, y, w, h) => {
  finite('tank', x, y, w, h);
  return `M${fmt(x)} ${fmt(y)}V${fmt(y + h)}H${fmt(x + w)}V${fmt(y)}`;
};

/** A curly brace from (x1, y1) to (x2, y2), its point `depth` to the left. */
const brace: ShapeHelpers['brace'] = (x1, y1, x2, y2, depth = 10) => {
  finite('brace', x1, y1, x2, y2, depth);
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / length) * depth;
  const ny = ((x2 - x1) / length) * depth;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const q = (a: number, b: number, k: number) => a + (b - a) * k;
  return (
    `M${fmt(x1)} ${fmt(y1)}Q${fmt(x1 + nx)} ${fmt(y1 + ny)} ${fmt(q(x1, mx, 0.5) + nx)} ${fmt(q(y1, my, 0.5) + ny)}T${fmt(mx + nx * 2)} ${fmt(my + ny * 2)}` +
    `M${fmt(x2)} ${fmt(y2)}Q${fmt(x2 + nx)} ${fmt(y2 + ny)} ${fmt(q(x2, mx, 0.5) + nx)} ${fmt(q(y2, my, 0.5) + ny)}T${fmt(mx + nx * 2)} ${fmt(my + ny * 2)}`
  );
};

/** A closed, gently irregular outline, such as a cell; the same seed draws the same shape. */
const blob: ShapeHelpers['blob'] = (cx, cy, r, options = {}) => {
  finite('blob', cx, cy, r);
  const wobble = options.wobble ?? 0.12;
  const seed = options.seed ?? 1;
  const n = 64;
  const points: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const rr = r * (1 + wobble * (Math.sin(3 * a + seed) * 0.5 + Math.sin(5 * a + seed * 1.7) * 0.3 + Math.sin(2 * a + seed * 2.3) * 0.2));
    points.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return `${polylinePath(points)}Z`;
};

const polygon: ShapeHelpers['polygon'] = (points) => {
  if (!Array.isArray(points) || points.length < 3) throw new SceneApiError('shapes.polygon needs at least three points');
  return `${polylinePath(points)}Z`;
};

/** A regular polygon: triangles, hexagons, the face of a nut. */
const regular: ShapeHelpers['regular'] = (cx, cy, r, sides, rotation = 0) => {
  finite('regular', cx, cy, r, rotation);
  const n = count(sides, 6, 3, 64, 'regular sides');
  const points: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * 2 * Math.PI - Math.PI / 2;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return `${polylinePath(points)}Z`;
};

export const shapes: ShapeHelpers = Object.freeze({
  spring,
  zigzag,
  // The name people reach for first draws the same symbol.
  resistor: zigzag,
  coil,
  wave,
  gear,
  hull,
  lens,
  battery,
  capacitor,
  ground,
  bulb,
  switch: switchShape,
  tank,
  brace,
  blob,
  polygon,
  regular,
});
