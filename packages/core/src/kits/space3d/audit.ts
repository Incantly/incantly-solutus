import type { Vec2 } from '../../api/types';
import type { DepthAudit, DepthViolation } from '../../runtime/kit';
import { centroid, clip, DEPTH_TOLERANCE, LINE_HALF, prepare, sampleWithin, type DepthView, type PieceShape, type Prepared } from './depth';

/**
 * The depth-order audit (PRD 17.7, CH-2): wherever two pieces of a 3D figure
 * overlap on the stage, the one nearer the viewer must be drawn on top. The
 * audit checks the order the engine drew, pair by pair, more closely than the
 * engine can afford to while drawing: each overlap is sampled all over, and
 * at each sample the depth of both pieces is read from their own geometry.
 * It runs in offline checks and tests, never on every frame.
 */

export type { DepthAudit, DepthViolation };

export interface AuditPiece {
  readonly shape: PieceShape;
  /** The depth bias the scene gave it: drawn as if this much nearer. */
  readonly bias: number;
  /** What draws it: a part's name, or its model piece and what it is. */
  readonly label: string;
}

export interface AuditOptions {
  /** The size of what is drawn, in world units, which sets the depth tolerance. */
  readonly radius: number;
  /** Square stage units a wrong overlap must cover to count. Default 2. */
  readonly minArea?: number;
  /** Pairs of pieces, by index, whose order the engine gave up to break a ring: the second was to be drawn after the first. */
  readonly rings?: ReadonlyArray<readonly [number, number]>;
}

/** Samples along a line, in stage units. */
const LINE_STEP = 0.75;
/** Samples across each side of an overlap. */
const GRID = 20;
const MAX_REPORTED = 20;

interface Entry {
  readonly index: number;
  readonly label: string;
  readonly shape: Prepared;
}

/**
 * Audits the order pieces were drawn in, first drawn first: every pair whose
 * boxes overlap on the stage is sampled where both cover it.
 */
export function auditDepth(pieces: readonly AuditPiece[], view: DepthView, options: AuditOptions): DepthAudit {
  const entries: Entry[] = [];
  pieces.forEach((piece, index) => {
    const shape = prepare(piece.shape, piece.bias, view);
    if (shape) entries.push({ index, label: piece.label, shape });
  });
  const tolerance = DEPTH_TOLERANCE * Math.max(options.radius, 1e-6);
  const minArea = options.minArea ?? 2;
  const violations: DepthViolation[] = [];
  const crossings: DepthViolation[] = [];
  const rings: DepthViolation[] = [];
  const ringed = new Set((options.rings ?? []).map(([first, second]) => `${Math.min(first, second)},${Math.max(first, second)}`));
  let pairs = 0;
  const byLeft = [...entries].sort((a, b) => a.shape.minX - b.shape.minX);
  for (let s = 0; s < byLeft.length; s++) {
    const p = byLeft[s]!;
    for (let t = s + 1; t < byLeft.length; t++) {
      const q = byLeft[t]!;
      if (q.shape.minX > p.shape.maxX) break;
      if (q.shape.minY > p.shape.maxY || q.shape.maxY < p.shape.minY) continue;
      pairs++;
      const [under, over] = p.index < q.index ? [p, q] : [q, p];
      const found = comparePair(under.shape, over.shape, tolerance);
      if (!found || found.wrong < minArea) continue;
      const record: DepthViolation = { under: under.label, over: over.label, area: Math.round(found.wrong * 10) / 10, at: found.at };
      // Mostly wrong: the other order would be right, unless that order was given up to break a ring.
      // Wrong and right in like measure: they pass through each other.
      if (found.wrong < 3 * found.right) crossings.push(record);
      else if (ringed.has(`${under.index},${over.index}`)) rings.push(record);
      else violations.push(record);
    }
  }
  const largest = (a: DepthViolation, b: DepthViolation) => b.area - a.area;
  return {
    pieces: entries.length,
    pairs,
    violations: violations.sort(largest).slice(0, MAX_REPORTED),
    crossings: crossings.sort(largest).slice(0, MAX_REPORTED),
    rings: rings.sort(largest).slice(0, MAX_REPORTED),
  };
}

/** How much of a pair's overlap is drawn wrong (the earlier piece nearer) and right, in square stage units. */
function comparePair(under: Prepared, over: Prepared, tolerance: number): { wrong: number; right: number; at: Vec2 } | null {
  const minX = Math.max(under.minX, over.minX);
  const minY = Math.max(under.minY, over.minY);
  const maxX = Math.min(under.maxX, over.maxX);
  const maxY = Math.min(under.maxY, over.maxY);
  if (!(maxX > minX && maxY > minY)) return null;
  const found: { wrong: number; right: number; at: Vec2 | null } = { wrong: 0, right: 0, at: null };
  const sample = (x: number, y: number, area: number) => {
    if (!under.inside(x, y) || !over.inside(x, y)) return;
    const a = under.depth(x, y);
    const b = over.depth(x, y);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    if (a > b + tolerance) {
      found.wrong += area;
      found.at ??= [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    } else if (b > a + tolerance) found.right += area;
  };
  const line = under.line ?? over.line;
  if (line) {
    // Along the line, where it crosses the overlap.
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(length / LINE_STEP));
      for (let k = 0; k < steps; k++) {
        const u = (k + 0.5) / steps;
        const x = a.x + (b.x - a.x) * u;
        const y = a.y + (b.y - a.y) * u;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        sample(x, y, (length / steps) * 2 * LINE_HALF);
      }
    }
  } else if (under.convex || over.convex) {
    // Across the overlap itself, each sample standing for an equal share of its area.
    const overlap = under.convex ? clip(over.outline!, under.outline!) : clip(under.outline!, over.outline!);
    const area = centroid(overlap)?.area ?? 0;
    if (area < 1e-6) return null;
    const points: Array<readonly [number, number]> = [];
    sampleWithin(overlap, (x, y) => points.push([x, y]), GRID);
    for (const [x, y] of points) sample(x, y, area / points.length);
  } else {
    // Across each side of the boxes' overlap, however thin it is.
    const stepX = Math.max(0.4, (maxX - minX) / GRID);
    const stepY = Math.max(0.4, (maxY - minY) / GRID);
    for (let y = minY + stepY / 2; y < maxY; y += stepY) {
      for (let x = minX + stepX / 2; x < maxX; x += stepX) sample(x, y, stepX * stepY);
    }
  }
  return found.wrong + found.right > 0 ? { wrong: found.wrong, right: found.right, at: found.at ?? [minX, minY] } : null;
}
