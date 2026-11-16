/**
 * Meshes of surfaces and curves in space (docs/features/space-3d/design.md 6.3; ui.md 7;
 * .kiro/specs/space-3d-surfaces R1): a grid of the parameter square, cells with an undefined corner left out, each cell
 * a face coloured by its height, grid lines every few rows on the faces themselves (so the painter's order hides the
 * ones behind), and curves as polylines split where they are undefined. Pure.
 */
import type { space } from '@incantly/kernel';

type V3 = space.V3;

export interface MeshFace {
  readonly pts: readonly V3[];
  readonly color: string;
  /** Which sides to stroke: a→b, b→c, c→d, d→a. */
  readonly edges: readonly [boolean, boolean, boolean, boolean];
}

const LOW = [47, 111, 219];
const HIGH = [233, 162, 59];

/** Blue at the bottom, orange at the top (ui.md 7). */
export function heightColor(k: number): string {
  const t = Math.max(0, Math.min(1, k));
  const c = (i: number): string => Math.round((LOW[i] as number) + ((HIGH[i] as number) - (LOW[i] as number)) * t).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

/**
 * The faces of a surface given as `at(i, j)` on an `n` by `n` grid. `keep` drops a cell (outside the box), `step` sets
 * how often a grid line is drawn.
 */
export function gridFaces(n: number, at: (i: number, j: number) => V3 | undefined, opts: { step?: number; keep?: (p: V3) => boolean } = {}): MeshFace[] {
  const step = opts.step ?? 5;
  const pts: (V3 | undefined)[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      let p = at(i, j);
      if (p && opts.keep && !opts.keep(p)) p = undefined;
      pts.push(p);
      if (p) {
        lo = Math.min(lo, p.z);
        hi = Math.max(hi, p.z);
      }
    }
  }
  const P = (i: number, j: number): V3 | undefined => pts[i * (n + 1) + j];
  const span = hi - lo || 1;
  const out: MeshFace[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = P(i, j);
      const b = P(i + 1, j);
      const c = P(i + 1, j + 1);
      const d = P(i, j + 1);
      if (!a || !b || !c || !d) continue;
      const z = (a.z + b.z + c.z + d.z) / 4;
      out.push({ pts: [a, b, c, d], color: heightColor((z - lo) / span), edges: [j % step === 0, (i + 1) % step === 0, (j + 1) % step === 0, i % step === 0] });
    }
  }
  return out;
}

/** A curve as runs of points, split where it is undefined. */
export function curveRuns(at: (s: number) => V3 | undefined, lo: number, hi: number, n = 200): V3[][] {
  const runs: V3[][] = [];
  let cur: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = at(lo + ((hi - lo) * i) / n);
    if (p) cur.push(p);
    else if (cur.length > 0) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}
