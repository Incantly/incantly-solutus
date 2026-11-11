/**
 * Transformations (docs/features/polygons-transforms/design.md sections 6-8):
 * centre-based application, exact quarter turns, honest image types, progress
 * maps, and Transform values (8.6) with composition.
 */
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { FunctionValue } from '../../language/runtime';
import type { ArcValue, ConicValue, HLine, StoredTransform, V2 } from './types';
import {
  isArcV,
  isCircleV,
  isConicV,
  isFunctionV,
  isGeomCurveV,
  isLineV,
  isPolygonV,
  isPolylineV,
  isPt,
  isRayV,
  isSegmentV,
} from './types';
import { TAU, dist, isSaneNum, isSanePt, norm2, sincos } from './numerics';
import { centralParams, circleConic, classifyQuad, matMul3, matOf, quadOf, transpose3 } from './conics';
import type { Mat3 } from './conics';
import { det3 } from './conics';
import { lineConicSlots, lineLikeOf } from './intersect';
import type { LineLike } from './intersect';
import { rule } from './points';
import { makePolygon } from './polygons';

const P = (call: RuleCall, i: number): V2 => call.values[i] as V2;
const N = (call: RuleCall, i: number): number => call.values[i] as number;

const sanePt = (call: RuleCall, p: V2): boolean => {
  if (!isSanePt(p)) {
    call.fail('not_finite');
    return false;
  }
  return true;
};

const saneNum = (call: RuleCall, v: number): boolean => {
  if (!isSaneNum(v)) {
    call.fail('not_finite');
    return false;
  }
  return true;
};

type Fail = {
  fail:
    | 'singular_transform'
    | 'at_infinity'
    | 'crosses_horizon'
    | 'not_affine'
    | 'out_of_domain'
    | 'too_far'
    | 'degenerate_conic'
    | 'wrong_kind';
  detail?: string;
};
type Mapped = { value: unknown } | Fail;
const isFail = (m: Mapped): m is Fail => (m as Fail).fail !== undefined;

/* ------------------------------ application (6.2) ------------------------------ */

/** Exact geometric application (centre-based); undefined at infinity/singularity. */
export function applyStored(t: StoredTransform, p: V2): V2 | undefined {
  switch (t.kind) {
    case 'translate':
      return { x: p.x + t.vx, y: p.y + t.vy };
    case 'rotate': {
      const { c, s } = sincos(t.angle);
      const dx = p.x - t.cx;
      const dy = p.y - t.cy;
      return { x: t.cx + c * dx - s * dy, y: t.cy + s * dx + c * dy };
    }
    case 'reflectLine': {
      const d = t.nx * p.x + t.ny * p.y + t.c0;
      return { x: p.x - 2 * d * t.nx, y: p.y - 2 * d * t.ny };
    }
    case 'reflectPoint':
      return { x: 2 * t.cx - p.x, y: 2 * t.cy - p.y };
    case 'dilate':
      return { x: t.cx + t.k * (p.x - t.cx), y: t.cy + t.k * (p.y - t.cy) };
    case 'shear': {
      const d = t.nx * p.x + t.ny * p.y + t.c0;
      return { x: p.x + t.ratio * d * t.dx, y: p.y + t.ratio * d * t.dy };
    }
    case 'stretch': {
      const d = t.nx * p.x + t.ny * p.y + t.c0;
      return { x: p.x + (t.ratio - 1) * d * t.nx, y: p.y + (t.ratio - 1) * d * t.ny };
    }
    case 'linear': {
      const m = t.m;
      return {
        x: (m[0] as number) * p.x + (m[2] as number) * p.y + (m[4] as number),
        y: (m[1] as number) * p.x + (m[3] as number) * p.y + (m[5] as number),
      };
    }
    case 'projective': {
      const h = t.h;
      const w = (h[6] as number) * p.x + (h[7] as number) * p.y + (h[8] as number);
      if (w === 0) return undefined;
      return {
        x: ((h[0] as number) * p.x + (h[1] as number) * p.y + (h[2] as number)) / w,
        y: ((h[3] as number) * p.x + (h[4] as number) * p.y + (h[5] as number)) / w,
      };
    }
    case 'inversion': {
      const dx = p.x - t.cx;
      const dy = p.y - t.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 === 0) return undefined;
      // Within 1e-12 r of the centre the image is too far to draw (polygons-transforms 10): `too_far`, not `at_infinity`.
      if (d2 <= 1e-24 * t.r * t.r) return { x: Infinity, y: Infinity };
      const k = (t.r * t.r) / d2;
      return { x: t.cx + k * dx, y: t.cy + k * dy };
    }
    case 'then': {
      let q: V2 | undefined = p;
      for (const s of t.steps) {
        if (!q) return undefined;
        q = applyStored(s, q);
      }
      return q;
    }
  }
}

/** Linear part of an affine stored transform, or undefined. */
function linearOf(t: StoredTransform): [number, number, number, number] | undefined {
  switch (t.kind) {
    case 'translate':
      return [1, 0, 0, 1];
    case 'rotate': {
      const { c, s } = sincos(t.angle);
      return [c, s, -s, c];
    }
    case 'reflectLine': {
      const { nx, ny } = t;
      return [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny];
    }
    case 'reflectPoint':
      return [-1, 0, 0, -1];
    case 'dilate':
      return [t.k, 0, 0, t.k];
    case 'shear':
      return [1 + t.ratio * t.nx * t.dx, t.ratio * t.ny * t.dx, t.ratio * t.nx * t.dy, 1 + t.ratio * t.ny * t.dy];
    case 'stretch': {
      const k = t.ratio - 1;
      return [1 + k * t.nx * t.nx, k * t.nx * t.ny, k * t.nx * t.ny, 1 + k * t.ny * t.ny];
    }
    case 'linear':
      return [t.m[0], t.m[1], t.m[2], t.m[3]];
    default:
      return undefined;
  }
}

/** Similarity scale, or undefined for non-similarities. */
function similarityScale(t: StoredTransform): number | undefined {
  switch (t.kind) {
    case 'translate':
    case 'rotate':
    case 'reflectLine':
    case 'reflectPoint':
      return 1;
    case 'dilate':
      return Math.abs(t.k);
    case 'then': {
      let s = 1;
      for (const st of t.steps) {
        const k = similarityScale(st);
        if (k === undefined) return undefined;
        s *= k;
      }
      return s;
    }
    default:
      return undefined;
  }
}

function reversesOrientation(t: StoredTransform): boolean {
  switch (t.kind) {
    case 'reflectLine':
      return true;
    case 'dilate':
      return t.k < 0;
    case 'linear': {
      const m = t.m;
      return (m[0] as number) * (m[3] as number) - (m[1] as number) * (m[2] as number) < 0;
    }
    case 'then':
      return t.steps.filter((s) => reversesOrientation(s)).length % 2 === 1;
    default:
      return false;
  }
}

/** Condition estimate of the linear part (scale-invariant). */
function linearCond(l: [number, number, number, number]): number {
  const det = Math.abs(l[0] * l[3] - l[1] * l[2]);
  if (det === 0) return Infinity;
  return ((l[0] * l[0] + l[1] * l[1] + l[2] * l[2] + l[3] * l[3]) / det) as number;
}

/** Affine2 of an affine stored transform (for conics and composition). */
function affineOf(t: StoredTransform): [number, number, number, number, number, number] | undefined {
  const o: V2 = { x: 0, y: 0 };
  const ex: V2 = { x: 1, y: 0 };
  const ey: V2 = { x: 0, y: 1 };
  const po = applyStored(t, o);
  const px = applyStored(t, ex);
  const py = applyStored(t, ey);
  if (!po || !px || !py) return undefined;
  if (t.kind === 'projective' || t.kind === 'inversion') return undefined;
  if (t.kind === 'then' && t.steps.some((s) => s.kind === 'projective' || s.kind === 'inversion')) return undefined;
  return [px.x - po.x, px.y - po.y, py.x - po.x, py.y - po.y, po.x, po.y];
}

/** Homogeneous 3x3 of an affine or projective stored transform. */
function homogOf(t: StoredTransform): Mat3 | undefined {
  if (t.kind === 'projective') return [...t.h] as unknown as Mat3;
  if (t.kind === 'inversion') return undefined;
  if (t.kind === 'then') {
    let H: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (const s of t.steps) {
      const h = homogOf(s);
      if (!h) return undefined;
      H = matMul3(h, H);
    }
    return H;
  }
  const a = affineOf(t);
  if (!a) return undefined;
  return [a[0], a[2], a[4], a[1], a[3], a[5], 0, 0, 1];
}

function inv3(m: Mat3): Mat3 | undefined {
  const d = det3(m);
  const n = Math.abs(m[0]) + Math.abs(m[4]) + Math.abs(m[8]) + 1;
  if (Math.abs(d) <= 1e-12 * n * n * n) return undefined;
  const [a, b, c, e, f, g, i, j, k] = [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]];
  const adj: Mat3 = [
    f * k - g * j,
    c * j - b * k,
    b * g - c * f,
    g * i - e * k,
    a * k - c * i,
    c * e - a * g,
    e * j - f * i,
    b * i - a * j,
    a * f - b * e,
  ];
  return adj.map((v) => v / d) as unknown as Mat3;
}

/* ------------------------------ mapping shapes (6.5) ------------------------------ */

function farCheck(p: V2): boolean {
  return Math.abs(p.x) > 1e14 || Math.abs(p.y) > 1e14 || !Number.isFinite(p.x) || !Number.isFinite(p.y);
}

/** Map any shape value; conics go through the matrix path when needed. */
export function mapShape(t: StoredTransform, v: unknown, tol: number): Mapped {
  if (isPt(v) && !isSegmentV(v) && !isRayV(v) && !isLineV(v)) {
    // Points and vectors share {x, y}; vectors under projective/inversion fail below by kind.
    return mapPointLike(t, v, false, tol);
  }
  if (isSegmentV(v)) return mapSegment(t, v, tol);
  if (isRayV(v)) return mapRay(t, v, tol);
  if (isLineV(v)) return mapLine(t, v, tol);
  if (isCircleV(v)) return mapCircle(t, v, tol);
  if (isConicV(v)) return mapConic(t, v, tol);
  if (isArcV(v)) return mapArc(t, v, false, tol);
  if (isPolygonV(v)) return mapPoly(t, v.pts as V2[], true, tol);
  if (isPolylineV(v)) return mapPoly(t, v.pts as V2[], false, tol);
  if (isFunctionV(v)) return mapFunction(t, v);
  if (isGeomCurveV(v)) return mapGeomCurve(t, v, tol);
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const item of v) {
      if (item === undefined) {
        out.push(undefined);
        continue;
      }
      const m = mapShape(t, item, tol);
      if (isFail(m)) return m;
      out.push(m.value);
    }
    return { value: out };
  }
  return { fail: 'out_of_domain', detail: 'not a shape' };
}

/** Points (and vectors for affine maps). */
function mapPointLike(t: StoredTransform, v: V2, isVector: boolean, tol: number): Mapped {
  void tol;
  if (isVector) {
    if (t.kind === 'projective') return { fail: 'not_affine' };
    if (t.kind === 'inversion' || (t.kind === 'then' && t.steps.some((s) => s.kind === 'inversion' || s.kind === 'projective'))) {
      return { fail: 'out_of_domain', detail: 'vectors map only under affine maps' };
    }
    const l = linearOf(t);
    if (!l) {
      // then-chain: apply linear parts in order.
      if (t.kind === 'then') {
        let q = { ...v };
        for (const s of t.steps) {
          const li = linearOf(s);
          if (!li) return { fail: 'not_affine' };
          q = { x: li[0] * q.x + li[2] * q.y, y: li[1] * q.x + li[3] * q.y };
        }
        return { value: q };
      }
      return { fail: 'not_affine' };
    }
    return { value: { x: l[0] * v.x + l[2] * v.y, y: l[1] * v.x + l[3] * v.y } };
  }
  const q = applyStored(t, v);
  if (!q) {
    if (t.kind === 'inversion' || (t.kind === 'then' && t.steps.some((s) => s.kind === 'inversion'))) {
      return { fail: 'at_infinity' };
    }
    return { fail: 'at_infinity' };
  }
  if (farCheck(q)) return { fail: 'too_far' };
  return { value: q };
}

export function mapVector(t: StoredTransform, v: V2, tol: number): Mapped {
  return mapPointLike(t, v, true, tol);
}

function mapSegment(t: StoredTransform, s: { a: V2; b: V2 }, tol: number): Mapped {
  if (t.kind === 'inversion' || (t.kind === 'then' && t.steps.some((x) => x.kind === 'inversion'))) {
    return { fail: 'out_of_domain', detail: 'inversion of a segment is not supported' };
  }
  if (t.kind === 'projective') {
    const h = t.h;
    const w = (p: V2): number => (h[6] as number) * p.x + (h[7] as number) * p.y + (h[8] as number);
    if (w(s.a) * w(s.b) < 0 || w(s.a) === 0 || w(s.b) === 0) return { fail: 'crosses_horizon' };
  }
  const a = applyStored(t, s.a);
  const b = applyStored(t, s.b);
  if (!a || !b) return { fail: 'at_infinity' };
  if (farCheck(a) || farCheck(b)) return { fail: 'too_far' };
  void tol;
  return { value: { a, b } };
}

function mapRay(t: StoredTransform, r: { from: V2; dir: V2 }, tol: number): Mapped {
  if (t.kind === 'inversion' || (t.kind === 'then' && t.steps.some((x) => x.kind === 'inversion'))) {
    return { fail: 'out_of_domain', detail: 'inversion of a ray is not supported' };
  }
  const l = t.kind === 'then' ? undefined : linearOf(t);
  const singular = l ? linearCond(l) === Infinity : false;
  if (singular) return { fail: 'singular_transform' };
  const from = applyStored(t, r.from);
  if (!from) return { fail: 'at_infinity' };
  // Direction by the linear part (affine) or by mapping a second point.
  const tip = applyStored(t, { x: r.from.x + r.dir.x, y: r.from.y + r.dir.y });
  if (!tip) return { fail: 'crosses_horizon' };
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return { fail: 'singular_transform' };
  void tol;
  return { value: { from, dir: { x: dx / len, y: dy / len } } };
}

function mapLine(t: StoredTransform, v: { a: number; b: number; c: number }, tol: number): Mapped {
  if (t.kind === 'inversion') return invertLine(t, v, tol);
  if (t.kind === 'then' && t.steps.some((x) => x.kind === 'inversion')) {
    return { fail: 'out_of_domain', detail: 'inversion of a line is not supported in a chain' };
  }
  const l = Math.hypot(v.a, v.b) || 1;
  const a = v.a / l;
  const b = v.b / l;
  const c = v.c / l;
  const p0 = { x: a * c, y: b * c };
  const p1 = { x: p0.x + b, y: p0.y - a };
  const q0 = applyStored(t, p0);
  const q1 = applyStored(t, p1);
  if (!q0 || !q1) return { fail: 'at_infinity' };
  if (dist(q0, q1) === 0) return { fail: 'singular_transform' };
  const dx = q1.x - q0.x;
  const dy = q1.y - q0.y;
  const len = Math.hypot(dx, dy) || 1;
  const na = -dy / len;
  const nb = dx / len;
  void tol;
  return { value: { a: na, b: nb, c: na * q0.x + nb * q0.y } };
}

/** Inversion of a line: through the centre stays a line, else a circle (both as Conic). */
function invertLine(t: StoredTransform & { kind: 'inversion' }, v: { a: number; b: number; c: number }, tol: number): Mapped {
  const l = Math.hypot(v.a, v.b) || 1;
  const a = v.a / l;
  const b = v.b / l;
  const c = v.c / l;
  const d = a * t.cx + b * t.cy - c;
  if (Math.abs(d) <= 1e-12 * Math.max(1, Math.abs(c))) {
    const r = classifyQuad({ A: 0, B: 0, C: 0, D: 2 * a, E: 2 * b, F: -2 * c }, tol);
    if ('fail' in r) return { fail: 'degenerate_conic' };
    const base: ConicValue = { q: r.q, kind: r.kind, margin: r.margin };
    return { value: r.lines ? { ...base, lines: r.lines } : base };
  }
  // Circle through the centre with diameter to the inverse of the foot.
  const fx = t.cx - d * a;
  const fy = t.cy - d * b;
  const k = (t.r * t.r) / (d * d);
  const ix = t.cx + k * (fx - t.cx);
  const iy = t.cy + k * (fy - t.cy);
  const ccx = (t.cx + ix) / 2;
  const ccy = (t.cy + iy) / 2;
  return { value: circleConic(ccx, ccy, Math.hypot(ix - t.cx, iy - t.cy) / 2) };
}

function mapCircle(t: StoredTransform, v: { cx: number; cy: number; r: number }, tol: number): Mapped {
  if (t.kind === 'inversion') return invertCircle(t, v, tol);
  if (t.kind === 'then' && t.steps.some((x) => x.kind === 'inversion')) {
    return { fail: 'out_of_domain', detail: 'inversion of a circle is not supported in a chain' };
  }
  const s = similarityScale(t);
  if (s !== undefined) {
    const c = applyStored(t, { x: v.cx, y: v.cy });
    if (!c) return { fail: 'at_infinity' };
    if (s === 0) return { fail: 'singular_transform' };
    if (farCheck(c)) return { fail: 'too_far' };
    return { value: { cx: c.x, cy: c.y, r: v.r * s } };
  }
  // General affine/projective: matrix path to a Conic.
  return mapConicMatrix(t, circleConic(v.cx, v.cy, v.r), tol);
}

/** Inversion of a circle: through the centre becomes a line, else a circle. */
function invertCircle(t: StoredTransform & { kind: 'inversion' }, v: { cx: number; cy: number; r: number }, tol: number): Mapped {
  const d = Math.hypot(v.cx - t.cx, v.cy - t.cy);
  if (Math.abs(d - v.r) <= 1e-12 * Math.max(1, v.r)) {
    // Through the centre: line perpendicular to the centre direction.
    const ux = d > 0 ? (v.cx - t.cx) / d : 1;
    const uy = d > 0 ? (v.cy - t.cy) / d : 0;
    // Inverse of the far point gives the line offset.
    const fx = v.cx + ux * v.r;
    const fy = v.cy + uy * v.r;
    const dd = (fx - t.cx) * (fx - t.cx) + (fy - t.cy) * (fy - t.cy);
    if (dd === 0) return { fail: 'degenerate_conic' };
    const k = (t.r * t.r) / dd;
    const ix = t.cx + k * (fx - t.cx);
    const iy = t.cy + k * (fy - t.cy);
    const r = classifyQuad({ A: 0, B: 0, C: 0, D: 2 * ux, E: 2 * uy, F: -2 * (ux * ix + uy * iy) }, tol);
    if ('fail' in r) return { fail: 'degenerate_conic' };
    const base: ConicValue = { q: r.q, kind: r.kind, margin: r.margin };
    return { value: r.lines ? { ...base, lines: r.lines } : base };
  }
  const k = (t.r * t.r) / (d * d - v.r * v.r);
  const ccx = t.cx + k * (v.cx - t.cx);
  const ccy = t.cy + k * (v.cy - t.cy);
  return { value: circleConic(ccx, ccy, Math.abs(k) * v.r) };
}

function mapConic(t: StoredTransform, c: ConicValue, tol: number): Mapped {
  if (t.kind === 'inversion' || (t.kind === 'then' && t.steps.some((x) => x.kind === 'inversion'))) {
    if (c.kind === 'circle') {
      const cp = centralParams(c);
      if (!cp) return { fail: 'wrong_kind' };
      const inv = t.kind === 'inversion' ? t : undefined;
      if (!inv) return { fail: 'out_of_domain', detail: 'inversion of a conic is not supported in a chain' };
      return invertCircle(inv, { cx: cp.cx, cy: cp.cy, r: cp.a }, tol);
    }
    return { fail: 'out_of_domain', detail: 'inversion of a conic is not supported' };
  }
  // Similarities with native frames map the frame directly (keeps labels):
  // the quad comes from the matrix path, the frame from the mapped frame.
  const s = similarityScale(t);
  const cp = centralParams(c);
  const mapped = mapConicMatrix(t, c, tol);
  if (isFail(mapped)) return mapped;
  if (s !== undefined && s !== 0 && cp && c.frame) {
    const nc = applyStored(t, { x: cp.cx, y: cp.cy });
    const tip = nc ? applyStored(t, { x: cp.cx + cp.ux, y: cp.cy + cp.uy }) : undefined;
    if (nc && tip && !farCheck(nc)) {
      let ux = tip.x - nc.x;
      let uy = tip.y - nc.y;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul;
      uy /= ul;
      const nc2 = mapped.value as ConicValue;
      return { value: { ...nc2, frame: { cx: nc.x, cy: nc.y, ux, uy, a: cp.a * s, b: cp.b * s } } };
    }
  }
  if (c.kind === 'parabola' && c.frame && !('cx' in c.frame) && s !== undefined && s !== 0) {
    const f = c.frame;
    const nv = applyStored(t, { x: f.vx, y: f.vy });
    const tip = nv ? applyStored(t, { x: f.vx + f.ux, y: f.vy + f.uy }) : undefined;
    if (nv && tip && !farCheck(nv)) {
      let ux = tip.x - nv.x;
      let uy = tip.y - nv.y;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul;
      uy /= ul;
      const nc2 = mapped.value as ConicValue;
      return { value: { ...nc2, frame: { vx: nv.x, vy: nv.y, ux, uy, p: f.p * s } } };
    }
  }
  return mapped;
}

function mapConicMatrix(t: StoredTransform, c: ConicValue, tol: number): Mapped {
  const H = homogOf(t);
  if (!H) return { fail: 'out_of_domain', detail: 'not an affine or projective map' };
  // Near-singular check for affine maps.
  const lin = linearOf(t);
  if (lin && linearCond(lin) > 1e12) return { fail: 'singular_transform' };
  const Hi = inv3(H);
  if (!Hi) return { fail: 'singular_transform' };
  const Hit = transpose3(Hi);
  const M = matOf(c.q);
  const N = matMul3(matMul3(Hit, M), Hi);
  const r = classifyQuad(quadOf(N), tol);
  if ('fail' in r) return { fail: 'singular_transform' };
  const base: ConicValue = { q: r.q, kind: r.kind, margin: r.margin };
  const w1 = r.frame ? { ...base, frame: r.frame } : base;
  const w2 = r.lines ? { ...w1, lines: r.lines } : w1;
  return { value: r.point ? { ...w2, point: r.point } : w2 };
}

function mapArc(t: StoredTransform, a: ArcValue, isSector: boolean, tol: number): Mapped {
  void isSector;
  const mc = mapConic(t, a.conic, tol);
  if (isFail(mc)) return mc;
  const nc = mc.value as ConicValue;
  const cp = centralParams(nc);
  if (!cp || (nc.kind !== 'circle' && nc.kind !== 'ellipse')) {
    return { fail: 'wrong_kind', detail: 'arc of a degenerate conic' };
  }
  // Projective horizon check over the arc range.
  if (t.kind === 'projective') {
    const h = t.h;
    const wline: HLine = (() => {
      const l = Math.hypot(h[6] as number, h[7] as number) || 1;
      return { a: (h[6] as number) / l, b: (h[7] as number) / l, c: -(h[8] as number) / l };
    })();
    const o = { x: wline.a * wline.c, y: wline.b * wline.c };
    const d = { x: wline.b, y: -wline.a };
    const slots = lineConicSlots(o, d, a.conic, tol, undefined, {
      cx: centralParams(a.conic)?.cx ?? 0,
      cy: centralParams(a.conic)?.cy ?? 0,
      from: a.from,
      sweep: a.sweep,
    });
    if (slots.some((s) => 'p' in s)) return { fail: 'crosses_horizon' };
  }
  // Remap the end points.
  const ocp = centralParams(a.conic);
  if (!ocp) return { fail: 'wrong_kind' };
  const polar = (ang: number): V2 => {
    const rr = 1 / Math.sqrt((Math.cos(ang) * Math.cos(ang)) / (ocp.a * ocp.a) + (Math.sin(ang) * Math.sin(ang)) / (ocp.b * ocp.b));
    void rr;
    // Point at polar angle about the centre on the OLD conic.
    const era = Math.atan2(ocp.a * Math.sin(ang), ocp.b * Math.cos(ang));
    void era;
    return oldArcPoint(a, ocp, ang);
  };
  const e0 = polar(a.from);
  const e1 = polar(a.from + a.sweep);
  const m0 = applyStored(t, e0);
  const m1 = applyStored(t, e1);
  if (!m0 || !m1) return { fail: 'at_infinity' };
  const rev = reversesOrientation(t);
  const a0 = Math.atan2(m0.y - cp.cy, m0.x - cp.cx);
  const a1 = Math.atan2(m1.y - cp.cy, m1.x - cp.cx);
  if (!rev) {
    let sweep = a1 - a0;
    while (sweep < 0) sweep += TAU;
    while (sweep >= TAU) sweep -= TAU;
    if (a.sweep >= TAU - 1e-9) sweep = TAU;
    return { value: { conic: nc, from: a0, sweep } };
  }
  let sweep = a0 - a1;
  while (sweep < 0) sweep += TAU;
  while (sweep >= TAU) sweep -= TAU;
  if (a.sweep >= TAU - 1e-9) sweep = TAU;
  return { value: { conic: nc, from: a1, sweep } };
}

function oldArcPoint(a: ArcValue, ocp: { cx: number; cy: number; ux: number; uy: number; a: number; b: number }, ang: number): V2 {
  const tilt = Math.atan2(ocp.uy, ocp.ux);
  const d = ang - tilt;
  const q = (Math.cos(d) * Math.cos(d)) / (ocp.a * ocp.a) + (Math.sin(d) * Math.sin(d)) / (ocp.b * ocp.b);
  const r = q > 0 ? 1 / Math.sqrt(q) : 0;
  void a;
  return { x: ocp.cx + r * Math.cos(ang), y: ocp.cy + r * Math.sin(ang) };
}

function mapPoly(t: StoredTransform, pts: readonly V2[], closed: boolean, tol: number): Mapped {
  if (t.kind === 'inversion' || (t.kind === 'then' && t.steps.some((x) => x.kind === 'inversion'))) {
    return { fail: 'out_of_domain', detail: 'inversion of a polygon is not supported' };
  }
  if (t.kind === 'projective') {
    const h = t.h;
    const w = (p: V2): number => (h[6] as number) * p.x + (h[7] as number) * p.y + (h[8] as number);
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const p = pts[i] as V2;
      const q = pts[(i + 1) % pts.length] as V2;
      if (w(p) * w(q) < 0 || w(p) === 0 || w(q) === 0) return { fail: 'crosses_horizon' };
    }
  }
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const q = applyStored(t, pts[i] as V2);
    if (!q) return { fail: 'at_infinity' };
    if (farCheck(q)) return { fail: 'too_far', detail: `vertex ${i + 1}` };
    out.push(q);
  }
  void tol;
  if (!closed) return { value: { pts: out } };
  return { value: makePolygon(out) };
}

/**
 * Function-preserving maps build closures (polygons-transforms 6.7).
 * Non-preserving maps are Curve by static routing (mapFunctionToCurve).
 */
function mapFunction(t: StoredTransform, f: FunctionValue): Mapped {
  if (f.ret !== 'Number' || f.arity !== 1) return { fail: 'out_of_domain', detail: 'needs a function of one number' };
  const wrap = (g: (x: number) => number | undefined): FunctionValue => {
    const fv: FunctionValue = {
      arity: 1,
      ret: 'Number',
      call: (...xs: number[]) => {
        const v = g(xs[0] as number);
        if (v === undefined || !Number.isFinite(v)) {
          fv.reason = f.reason ?? 'out_of_domain';
          return NaN;
        }
        return v;
      },
    };
    fv.call1 = (x: number) => {
      const v = g(x);
      if (v === undefined || !Number.isFinite(v)) {
        fv.reason = f.reason ?? 'out_of_domain';
        return NaN;
      }
      return v;
    };
    fv.batch = (xs: Float64Array, out: Float64Array): void => {
      for (let i = 0; i < xs.length; i++) out[i] = fv.call1 ? fv.call1(xs[i] as number) : NaN;
    };
    return fv;
  };
  const ev = (x: number): number | undefined => {
    const v = f.call1 ? f.call1(x) : f.call(x);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  switch (t.kind) {
    case 'translate':
      return { value: wrap((x) => {
        const y = ev(x - t.vx);
        return y === undefined ? undefined : y + t.vy;
      }) };
    case 'dilate': {
      if (t.k === 0) return { fail: 'singular_transform' };
      const { k, cx, cy } = t;
      return { value: wrap((x) => {
        const y = ev(cx + (x - cx) / k);
        return y === undefined ? undefined : cy + k * (y - cy);
      }) };
    }
    case 'reflectPoint': {
      const { cx, cy } = t;
      return { value: wrap((x) => {
        const y = ev(2 * cx - x);
        return y === undefined ? undefined : 2 * cy - y;
      }) };
    }
    case 'reflectLine': {
      // Axis-parallel mirrors only (others are Curve by static routing).
      const vert = Math.abs(t.ny) <= 1e-12 && Math.abs(t.nx) > 0;
      const horiz = Math.abs(t.nx) <= 1e-12 && Math.abs(t.ny) > 0;
      if (vert) {
        const c = -t.c0 / t.nx;
        return { value: wrap((x) => ev(2 * c - x)) };
      }
      if (horiz) {
        const c = -t.c0 / t.ny;
        return { value: wrap((x) => {
          const y = ev(x);
          return y === undefined ? undefined : 2 * c - y;
        }) };
      }
      return { fail: 'out_of_domain', detail: 'oblique reflection of a function is a curve' };
    }
    case 'then': {
      let cur: FunctionValue = f;
      for (const s of t.steps) {
        const m = mapFunction(s, cur);
        if (isFail(m)) return m;
        cur = m.value as FunctionValue;
      }
      return { value: cur };
    }
    default:
      return { fail: 'out_of_domain', detail: 'this map sends functions to curves' };
  }
}

/** Any map of a function to a sampled + exact parametric curve. */
export function mapFunctionToCurve(t: StoredTransform, f: FunctionValue): Mapped {
  if (f.ret !== 'Number' || f.arity !== 1) return { fail: 'out_of_domain', detail: 'needs a function of one number' };
  if (t.kind === 'inversion' || (t.kind === 'then' && t.steps.some((x) => x.kind === 'inversion'))) {
    return { fail: 'out_of_domain', detail: 'inversion of a function is not supported' };
  }
  const ev = (x: number): number | undefined => {
    const v = f.call1 ? f.call1(x) : f.call(x);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const fx = (s: number): number => {
    const y = ev(s);
    if (y === undefined) return NaN;
    const q = applyStored(t, { x: s, y });
    return q ? q.x : NaN;
  };
  const fy = (s: number): number => {
    const y = ev(s);
    if (y === undefined) return NaN;
    const q = applyStored(t, { x: s, y });
    return q ? q.y : NaN;
  };
  const pieces: V2[][] = [];
  let cur: V2[] = [];
  const NPT = 256;
  for (let i = 0; i <= NPT; i++) {
    const s = -10 + (20 * i) / NPT;
    const x = fx(s);
    const y = fy(s);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e14 || Math.abs(y) > 1e14) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
      continue;
    }
    cur.push({ x, y });
  }
  if (cur.length > 1) pieces.push(cur);
  return { value: { tag: 'geomCurve', pieces, closed: false, exact: { fx, fy, from: -10, to: 10 } } };
}

/* ------------------------------ command rules ------------------------------ */

function finish(call: RuleCall, m: Mapped): unknown {
  if (isFail(m)) return call.fail(m.fail, m.detail);
  return m.value;
}

const saneAngle = (call: RuleCall, v: number): boolean => {
  if (!Number.isFinite(v) || Math.abs(v) > 1e10) {
    call.fail('not_finite');
    return false;
  }
  return true;
};

const clampProgress = (u: number): number => Math.min(1, Math.max(0, u));

/** Translate(shape, v). */
export const translateRule: CommandRule = rule(
  (call) => {
    const v = P(call, 1);
    if (!sanePt(call, v)) return undefined;
    const t: StoredTransform = { tag: 'transform', kind: 'translate', vx: v.x, vy: v.y };
    return finish(call, mapShape(t, call.values[0], call.tol));
  },
  {
    invert: (target, c) => {
      if (!isPt(target)) return undefined;
      const s = c.values[0] as V2;
      if (!isPt(s)) return undefined;
      const t = target as V2;
      return [{ param: 1, value: { x: t.x - s.x, y: t.y - s.y } }];
    },
  },
);

export const translateVectorRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const w = P(call, 1);
  if (!sanePt(call, v) || !sanePt(call, w)) return undefined;
  // Direction-only vectors are unchanged by translation.
  return { ...v };
});

/** Translate(Vector, Point): place the vector's start (a no-op for direction-only vectors). */
export const translatePlaceRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const p = P(call, 1);
  if (!sanePt(call, v) || !sanePt(call, p)) return undefined;
  return { ...v };
});

export const translateProgressRule: CommandRule = rule((call) => {
  const v = P(call, 1);
  const u = N(call, 2);
  if (!sanePt(call, v) || !saneNum(call, u)) return undefined;
  const k = clampProgress(u);
  const t: StoredTransform = { tag: 'transform', kind: 'translate', vx: k * v.x, vy: k * v.y };
  return finish(call, mapShape(t, call.values[0], call.tol));
});

export const translateVectorProgressRule: CommandRule = rule((call) => translateVectorRule.run(call));

function rotateStored(angle: number, c: V2, u?: number): StoredTransform {
  const a = u === undefined ? angle : u * angle;
  return { tag: 'transform', kind: 'rotate', angle: a, cx: c.x, cy: c.y };
}

export const rotateRule: CommandRule = rule(
  (call) => {
    const angle = N(call, 1);
    const c = call.values.length > 2 && call.form.params.length > 2 ? (P(call, 2)) : { x: 0, y: 0 };
    if (!saneAngle(call, angle) || !sanePt(call, c)) return undefined;
    return finish(call, mapShape(rotateStored(angle, c), call.values[0], call.tol));
  },
  {
    invert: (target, c) => {
      if (!isPt(target)) return undefined;
      const s = c.values[0] as V2;
      if (!isPt(s)) return undefined;
      const C = c.values.length > 2 ? (c.values[2] as V2) : { x: 0, y: 0 };
      if (!isPt(C)) return undefined;
      const th = c.values[1] as number;
      if (typeof th !== 'number') return undefined;
      const t = target as V2;
      if (dist(s, C) === 0 || dist(t, C) === 0) return undefined;
      const d = Math.atan2(t.y - C.y, t.x - C.x) - Math.atan2(s.y - C.y, s.x - C.x);
      return [{ param: 1, value: th + d }];
    },
  },
);

export const rotateProgressRule: CommandRule = rule((call) => {
  // (shape, angle, progress) about the origin.
  const angle = N(call, 1);
  const u = N(call, 2);
  if (!saneAngle(call, angle) || !saneNum(call, u)) return undefined;
  return finish(call, mapShape(rotateStored(angle, { x: 0, y: 0 }, clampProgress(u)), call.values[0], call.tol));
});

export const rotateCenterProgressRule: CommandRule = rule((call) => {
  const angle = N(call, 1);
  const c = P(call, 2);
  const u = N(call, 3);
  if (!saneAngle(call, angle) || !sanePt(call, c) || !saneNum(call, u)) return undefined;
  return finish(call, mapShape(rotateStored(angle, c, clampProgress(u)), call.values[0], call.tol));
});

export const rotateVectorRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const angle = N(call, 1);
  if (!sanePt(call, v) || !saneAngle(call, angle)) return undefined;
  const { c, s } = sincos(angle);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
});

function reflectLineStored(ll: LineLike, u?: number): StoredTransform {
  if (u === undefined) return { tag: 'transform', kind: 'reflectLine', nx: ll.a, ny: ll.b, c0: -ll.c };
  // Partial fold as an affine map: p - 2u(n.p + c0)n.
  const k = clampProgress(u);
  const { a: nx, b: ny } = ll;
  const c0 = -ll.c;
  return {
    tag: 'transform',
    kind: 'linear',
    m: [1 - 2 * k * nx * nx, -2 * k * nx * ny, -2 * k * nx * ny, 1 - 2 * k * ny * ny, -2 * k * c0 * nx, -2 * k * c0 * ny],
  };
}

export const reflectLineRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[1]);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  return finish(call, mapShape(reflectLineStored(ll), call.values[0], call.tol));
});

export const reflectLineProgressRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[1]);
  const u = N(call, 2);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, u)) return undefined;
  return finish(call, mapShape(reflectLineStored(ll, u), call.values[0], call.tol));
});

export const reflectLineVectorRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const ll = lineLikeOf(call.values[1]);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!sanePt(call, v)) return undefined;
  const d = ll.a * v.x + ll.b * v.y;
  return { x: v.x - 2 * d * ll.a, y: v.y - 2 * d * ll.b };
});

export const reflectPointRule: CommandRule = rule(
  (call) => {
    const c = P(call, 1);
    if (!sanePt(call, c)) return undefined;
    const t: StoredTransform = { tag: 'transform', kind: 'reflectPoint', cx: c.x, cy: c.y };
    return finish(call, mapShape(t, call.values[0], call.tol));
  },
  {
    invert: (target, c) => {
      if (!isPt(target)) return undefined;
      const s = c.values[0] as V2;
      if (!isPt(s)) return undefined;
      const t = target as V2;
      return [{ param: 1, value: { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 } }];
    },
  },
);

export const reflectPointProgressRule: CommandRule = rule((call) => {
  const c = P(call, 1);
  const u = N(call, 2);
  if (!sanePt(call, c) || !saneNum(call, u)) return undefined;
  // p + u(2C - 2p) = dilate by (1 - 2u) about C.
  const t: StoredTransform = { tag: 'transform', kind: 'dilate', k: 1 - 2 * clampProgress(u), cx: c.x, cy: c.y };
  return finish(call, mapShape(t, call.values[0], call.tol));
});

export const reflectPointVectorRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  if (!sanePt(call, v)) return undefined;
  return { x: -v.x, y: -v.y };
});

export const invertPointRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const c = call.values[1] as { cx: number; cy: number; r: number };
  if (!sanePt(call, p)) return undefined;
  const t: StoredTransform = { tag: 'transform', kind: 'inversion', cx: c.cx, cy: c.cy, r: c.r };
  return finish(call, mapShape(t, p, call.tol));
});

export const invertLineRule: CommandRule = rule((call) => {
  const v = call.values[0] as { a: number; b: number; c: number };
  const c = call.values[1] as { cx: number; cy: number; r: number };
  const t: StoredTransform = { tag: 'transform', kind: 'inversion', cx: c.cx, cy: c.cy, r: c.r };
  return finish(call, mapShape(t, v, call.tol));
});

export const invertCircleRule: CommandRule = rule((call) => {
  const v = call.values[0] as { cx: number; cy: number; r: number };
  const c = call.values[1] as { cx: number; cy: number; r: number };
  const t: StoredTransform = { tag: 'transform', kind: 'inversion', cx: c.cx, cy: c.cy, r: c.r };
  return finish(call, mapShape(t, v, call.tol));
});

export const invertListRule: CommandRule = rule((call) => {
  const v = call.values[0] as readonly V2[];
  const c = call.values[1] as { cx: number; cy: number; r: number };
  const t: StoredTransform = { tag: 'transform', kind: 'inversion', cx: c.cx, cy: c.cy, r: c.r };
  return finish(call, mapShape(t, [...v], call.tol));
});

export const dilateRule: CommandRule = rule(
  (call) => {
    const k = N(call, 1);
    const c = call.values.length > 2 && call.form.params.length > 2 ? P(call, 2) : { x: 0, y: 0 };
    if (!saneNum(call, k) || !sanePt(call, c)) return undefined;
    const t: StoredTransform = { tag: 'transform', kind: 'dilate', k, cx: c.x, cy: c.y };
    return finish(call, mapShape(t, call.values[0], call.tol));
  },
  {
    invert: (target, c) => {
      if (!isPt(target)) return undefined;
      const s = c.values[0] as V2;
      if (!isPt(s)) return undefined;
      const C = c.values.length > 2 ? (c.values[2] as V2) : { x: 0, y: 0 };
      if (!isPt(C)) return undefined;
      const t = target as V2;
      const ds = dist(s, C);
      if (ds === 0) return undefined;
      // Signed factor along the ray.
      const dt = (t.x - C.x) * (s.x - C.x) + (t.y - C.y) * (s.y - C.y) >= 0 ? dist(t, C) : -dist(t, C);
      return [{ param: 1, value: dt / ds }];
    },
  },
);

export const dilateProgressRule: CommandRule = rule((call) => {
  const k = N(call, 1);
  const u = N(call, 2);
  if (!saneNum(call, k) || !saneNum(call, u)) return undefined;
  const t: StoredTransform = { tag: 'transform', kind: 'dilate', k: 1 + clampProgress(u) * (k - 1), cx: 0, cy: 0 };
  return finish(call, mapShape(t, call.values[0], call.tol));
});

export const dilateCenterProgressRule: CommandRule = rule((call) => {
  const k = N(call, 1);
  const c = P(call, 2);
  const u = N(call, 3);
  if (!saneNum(call, k) || !sanePt(call, c) || !saneNum(call, u)) return undefined;
  const t: StoredTransform = { tag: 'transform', kind: 'dilate', k: 1 + clampProgress(u) * (k - 1), cx: c.x, cy: c.y };
  return finish(call, mapShape(t, call.values[0], call.tol));
});

export const dilateVectorRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const k = N(call, 1);
  if (!sanePt(call, v) || !saneNum(call, k)) return undefined;
  return { x: k * v.x, y: k * v.y };
});

function shearStored(ll: LineLike, r: number, u?: number): StoredTransform {
  const ratio = u === undefined ? r : clampProgress(u) * r;
  return { tag: 'transform', kind: 'shear', dx: ll.dx, dy: ll.dy, nx: ll.a, ny: ll.b, c0: -ll.c, ratio };
}

export const shearRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r)) return undefined;
  return finish(call, mapShape(shearStored(ll, r), call.values[0], call.tol));
});

export const shearProgressRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  const u = N(call, 3);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r) || !saneNum(call, u)) return undefined;
  return finish(call, mapShape(shearStored(ll, r, u), call.values[0], call.tol));
});

export const shearVectorRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!sanePt(call, v) || !saneNum(call, r)) return undefined;
  const d = ll.a * v.x + ll.b * v.y;
  return { x: v.x + r * d * ll.dx, y: v.y + r * d * ll.dy };
});

export const shearCircleRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r)) return undefined;
  return finish(call, mapShape(shearStored(ll, r), call.values[0], call.tol));
});

export const shearCircleProgressRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  const u = N(call, 3);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r) || !saneNum(call, u)) return undefined;
  return finish(call, mapShape(shearStored(ll, r, u), call.values[0], call.tol));
});

export const shearFuncRule: CommandRule = rule((call) => shearFuncBody(call, undefined));
export const shearFuncProgressRule: CommandRule = rule((call) => shearFuncBody(call, N(call, 3)));

function shearFuncBody(call: RuleCall, u: number | undefined): unknown {
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  const f = call.values[0] as FunctionValue;
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r)) return undefined;
  if (u !== undefined && !saneNum(call, u)) return undefined;
  const m = mapFunctionToCurve(shearStored(ll, r, u), f);
  return finish(call, m);
}

function stretchLineStored(ll: LineLike, r: number, u?: number): StoredTransform {
  const ratio = u === undefined ? r : 1 + clampProgress(u) * (r - 1);
  return { tag: 'transform', kind: 'stretch', nx: ll.a, ny: ll.b, c0: -ll.c, ratio };
}

function stretchVecStored(v: V2): StoredTransform {
  // Axis through the origin perpendicular to v (vectors have no start).
  const l = norm2(v) || 1;
  return { tag: 'transform', kind: 'stretch', nx: v.x / l, ny: v.y / l, c0: 0, ratio: l };
}

export const stretchLineRule: CommandRule = rule((call) => stretchLineBody(call, undefined));
export const stretchLineProgressRule: CommandRule = rule((call) => stretchLineBody(call, N(call, 3)));

function stretchLineBody(call: RuleCall, u: number | undefined): unknown {
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r)) return undefined;
  if (u !== undefined && !saneNum(call, u)) return undefined;
  return finish(call, mapShape(stretchLineStored(ll, r, u), call.values[0], call.tol));
}

export const stretchVecRule: CommandRule = rule((call) => {
  const v = P(call, 1);
  if (!sanePt(call, v)) return undefined;
  return finish(call, mapShape(stretchVecStored(v), call.values[0], call.tol));
});

export const stretchVecProgressRule: CommandRule = rule((call) => {
  const v = P(call, 1);
  const u = N(call, 2);
  if (!sanePt(call, v) || !saneNum(call, u)) return undefined;
  const l = norm2(v) || 1;
  const ratio = 1 + clampProgress(u) * (l - 1);
  const t: StoredTransform = { tag: 'transform', kind: 'stretch', nx: v.x / l, ny: v.y / l, c0: 0, ratio };
  return finish(call, mapShape(t, call.values[0], call.tol));
});

export const stretchVectorRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const w = call.values[1];
  const ll = lineLikeOf(w);
  if (ll) {
    const r = N(call, 2);
    if (!sanePt(call, v) || !saneNum(call, r)) return undefined;
    const d = ll.a * v.x + ll.b * v.y;
    return { x: v.x + (r - 1) * d * ll.a, y: v.y + (r - 1) * d * ll.b };
  }
  const u = w as V2;
  if (!sanePt(call, v) || !sanePt(call, u)) return undefined;
  const l = norm2(u) || 1;
  const d = (v.x * u.x + v.y * u.y) / l;
  return { x: v.x + (l - 1) * d * (u.x / l), y: v.y + (l - 1) * d * (u.y / l) };
});

export const stretchCircleRule: CommandRule = rule((call) => stretchCircleBody(call, undefined));
export const stretchCircleProgressRule: CommandRule = rule((call) => stretchCircleBody(call, N(call, 3)));

function stretchCircleBody(call: RuleCall, u: number | undefined): unknown {
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r)) return undefined;
  if (u !== undefined && !saneNum(call, u)) return undefined;
  return finish(call, mapShape(stretchLineStored(ll, r, u), call.values[0], call.tol));
}

export const stretchCircleVecRule: CommandRule = rule((call) => {
  const v = P(call, 1);
  if (!sanePt(call, v)) return undefined;
  return finish(call, mapShape(stretchVecStored(v), call.values[0], call.tol));
});

export const stretchFuncRule: CommandRule = rule((call) => stretchFuncBody(call, undefined));
export const stretchFuncProgressRule: CommandRule = rule((call) => stretchFuncBody(call, N(call, 3)));

function stretchFuncBody(call: RuleCall, u: number | undefined): unknown {
  const ll = lineLikeOf(call.values[1]);
  const f = call.values[0] as FunctionValue;
  const r = N(call, 2);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r)) return undefined;
  if (u !== undefined && !saneNum(call, u)) return undefined;
  return finish(call, mapFunctionToCurve(stretchLineStored(ll, r, u), f));
}

export const stretchFuncVecRule: CommandRule = rule((call) => {
  const v = P(call, 1);
  const f = call.values[0] as FunctionValue;
  if (!sanePt(call, v)) return undefined;
  return finish(call, mapFunctionToCurve(stretchVecStored(v), f));
});

export const stretchFuncVecProgressRule: CommandRule = rule((call) => {
  const v = P(call, 1);
  const u = N(call, 2);
  const f = call.values[0] as FunctionValue;
  if (!sanePt(call, v) || !saneNum(call, u)) return undefined;
  const l = norm2(v) || 1;
  const ratio = 1 + clampProgress(u) * (l - 1);
  const t: StoredTransform = { tag: 'transform', kind: 'stretch', nx: v.x / l, ny: v.y / l, c0: 0, ratio };
  return finish(call, mapFunctionToCurve(t, f));
});

export const stretchCircleVecProgressRule: CommandRule = rule((call) => {
  const v = P(call, 1);
  const u = N(call, 2);
  if (!sanePt(call, v) || !saneNum(call, u)) return undefined;
  const l = norm2(v) || 1;
  const ratio = 1 + clampProgress(u) * (l - 1);
  const t: StoredTransform = { tag: 'transform', kind: 'stretch', nx: v.x / l, ny: v.y / l, c0: 0, ratio };
  return finish(call, mapShape(t, call.values[0], call.tol));
});

export const rotateVectorProgressRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const angle = N(call, 1);
  const last = call.values[call.values.length - 1] as number;
  if (!sanePt(call, v) || !saneAngle(call, angle) || !saneNum(call, last)) return undefined;
  const { c, s } = sincos(clampProgress(last) * angle);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
});

export const reflectLineVectorProgressRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const ll = lineLikeOf(call.values[1]);
  const u = N(call, 2);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!sanePt(call, v) || !saneNum(call, u)) return undefined;
  const k = clampProgress(u);
  const d = ll.a * v.x + ll.b * v.y;
  return { x: v.x - 2 * k * d * ll.a, y: v.y - 2 * k * d * ll.b };
});

export const reflectPointVectorProgressRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const u = N(call, 2);
  if (!sanePt(call, v) || !saneNum(call, u)) return undefined;
  const k = 1 - 2 * clampProgress(u);
  return { x: k * v.x, y: k * v.y };
});

export const dilateVectorProgressRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const k = N(call, 1);
  const last = call.values[call.values.length - 1] as number;
  if (!sanePt(call, v) || !saneNum(call, k) || !saneNum(call, last)) return undefined;
  const kk = 1 + clampProgress(last) * (k - 1);
  return { x: kk * v.x, y: kk * v.y };
});

export const shearVectorProgressRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  const u = N(call, 3);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!sanePt(call, v) || !saneNum(call, r) || !saneNum(call, u)) return undefined;
  const d = ll.a * v.x + ll.b * v.y;
  const kr = clampProgress(u) * r;
  return { x: v.x + kr * d * ll.dx, y: v.y + kr * d * ll.dy };
});

export const stretchVectorProgressRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const ll = lineLikeOf(call.values[1]);
  const r = N(call, 2);
  const u = N(call, 3);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!sanePt(call, v) || !saneNum(call, r) || !saneNum(call, u)) return undefined;
  const ratio = 1 + clampProgress(u) * (r - 1);
  const d = ll.a * v.x + ll.b * v.y;
  return { x: v.x + (ratio - 1) * d * ll.a, y: v.y + (ratio - 1) * d * ll.b };
});

export const stretchVectorVecProgressRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  const w = P(call, 1);
  const u = N(call, 2);
  if (!sanePt(call, v) || !sanePt(call, w) || !saneNum(call, u)) return undefined;
  const l = norm2(w) || 1;
  const ratio = 1 + clampProgress(u) * (l - 1);
  const d = (v.x * w.x + v.y * w.y) / l;
  return { x: v.x + (ratio - 1) * d * (w.x / l), y: v.y + (ratio - 1) * d * (w.y / l) };
});

/* ------------------------------ ApplyMatrix ------------------------------ */

/** Provisional matrix parsing (nested/flat lists) until the numbers area defines Matrix. */
function parseMatrix(v: unknown): StoredTransform | { fail: 'out_of_domain' | 'not_finite'; detail?: string } {
  const nums = (x: unknown): number[] | undefined => {
    const arr = ArrayBuffer.isView(x) ? Array.from(x as unknown as ArrayLike<number>) : Array.isArray(x) ? [...(x as unknown[])] : undefined;
    if (!arr || !arr.every((e) => typeof e === 'number')) return undefined;
    return arr as number[];
  };
  const isRow = (x: unknown): boolean => Array.isArray(x) || ArrayBuffer.isView(x);
  if (Array.isArray(v) && v.length > 0 && v.every(isRow)) {
    const rows = (v as unknown[]).map((r) => nums(r));
    if (rows.some((r) => r === undefined)) return { fail: 'out_of_domain', detail: 'matrix entries must be numbers' };
    const nn = rows as number[][];
    if (nn.length === 2 && nn.every((r) => r.length === 2)) {
      const flat = nn.flat();
      if (!flat.every((x) => Number.isFinite(x) && Math.abs(x) < 1e150)) return { fail: 'not_finite' };
      const [p, q, r, s] = flat as [number, number, number, number];
      return { tag: 'transform', kind: 'linear', m: [p, r, q, s, 0, 0] };
    }
    if (nn.length === 3 && nn.every((r) => r.length === 3)) {
      const flat = nn.flat();
      if (!flat.every((x) => Number.isFinite(x) && Math.abs(x) < 1e150)) return { fail: 'not_finite' };
      return matrix3(flat as [number, number, number, number, number, number, number, number, number]);
    }
    return { fail: 'out_of_domain', detail: 'needs a 2x2 or 3x3 matrix' };
  }
  const flat = nums(v);
  if (!flat) {
    // A future Matrix value ({rows, cols, data}?): try data-field shapes defensively.
    const o = v as Record<string, unknown>;
    if (o && typeof o === 'object' && Array.isArray(o['data'])) {
      const d = nums(o['data']);
      if (d && (d.length === 4 || d.length === 6 || d.length === 9)) return parseMatrix(d);
    }
    return { fail: 'out_of_domain', detail: 'needs a 2x2 or 3x3 matrix' };
  }
  if (!flat.every((x) => Number.isFinite(x) && Math.abs(x) < 1e150)) return { fail: 'not_finite' };
  if (flat.length === 4) {
    const [p, q, r, s] = flat as [number, number, number, number];
    return { tag: 'transform', kind: 'linear', m: [p, r, q, s, 0, 0] };
  }
  if (flat.length === 6) {
    const [a, b, c, d, e, f] = flat as [number, number, number, number, number, number];
    return { tag: 'transform', kind: 'linear', m: [a, b, c, d, e, f] };
  }
  if (flat.length === 9) {
    return matrix3(flat as [number, number, number, number, number, number, number, number, number]);
  }
  return { fail: 'out_of_domain', detail: 'needs 4, 6 or 9 numbers' };
}

function matrix3(h: [number, number, number, number, number, number, number, number, number]): StoredTransform {
  const affine = Math.abs(h[6]) < 1e-12 && Math.abs(h[7]) < 1e-12 && Math.abs(h[8] - 1) < 1e-9;
  if (affine) {
    return { tag: 'transform', kind: 'linear', m: [h[0], h[3], h[1], h[4], h[2], h[5]] };
  }
  return { tag: 'transform', kind: 'projective', h };
}

export const applyMatrixRule: CommandRule = rule((call) => {
  const m = parseMatrix(call.values[0]);
  if ('fail' in m) return call.fail(m.fail, m.detail);
  return finish(call, mapShape(m, call.values[0 + 1], call.tol));
});

export const applyMatrixVectorRule: CommandRule = rule((call) => {
  const m = parseMatrix(call.values[0]);
  if ('fail' in m) return call.fail(m.fail, m.detail);
  const v = P(call, 1);
  if (!sanePt(call, v)) return undefined;
  return finish(call, mapVector(m, v, call.tol));
});

export const applyMatrixCircleRule: CommandRule = rule((call) => {
  const m = parseMatrix(call.values[0]);
  if ('fail' in m) return call.fail(m.fail, m.detail);
  return finish(call, mapShape(m, call.values[1], call.tol));
});

export const applyMatrixFuncRule: CommandRule = rule((call) => {
  const m = parseMatrix(call.values[0]);
  if ('fail' in m) return call.fail(m.fail, m.detail);
  const f = call.values[1] as FunctionValue;
  // Axis-aligned affine maps of functions stay functions.
  if (m.kind === 'linear') {
    const g = mapFunction(m, f);
    if (!isFail(g)) return g.value;
  }
  return finish(call, mapFunctionToCurve(m, f));
});

/* ------------------------------ Transform values (8.6) ------------------------------ */

export const shiftRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  if (!sanePt(call, v)) return undefined;
  return { tag: 'transform', kind: 'translate', vx: v.x, vy: v.y } satisfies StoredTransform;
});

export const turnRule: CommandRule = rule((call) => {
  const a = N(call, 0);
  const c = call.values.length > 1 ? P(call, 1) : { x: 0, y: 0 };
  if (!saneAngle(call, a) || !sanePt(call, c)) return undefined;
  return { tag: 'transform', kind: 'rotate', angle: a, cx: c.x, cy: c.y } satisfies StoredTransform;
});

export const mirrorRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[0]);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  return { tag: 'transform', kind: 'reflectLine', nx: ll.a, ny: ll.b, c0: -ll.c } satisfies StoredTransform;
});

export const scaleRule: CommandRule = rule((call) => {
  const k = N(call, 0);
  const c = call.values.length > 1 ? P(call, 1) : { x: 0, y: 0 };
  if (!saneNum(call, k) || !sanePt(call, c)) return undefined;
  return { tag: 'transform', kind: 'dilate', k, cx: c.x, cy: c.y } satisfies StoredTransform;
});

export const shearByRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[0]);
  const r = N(call, 1);
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (!saneNum(call, r)) return undefined;
  return { tag: 'transform', kind: 'shear', dx: ll.dx, dy: ll.dy, nx: ll.a, ny: ll.b, c0: -ll.c, ratio: r } satisfies StoredTransform;
});

export const stretchByRule: CommandRule = rule((call) => {
  const w = call.values[0];
  const ll = lineLikeOf(w);
  if (ll) {
    const r = N(call, 1);
    if (!saneNum(call, r)) return undefined;
    return { tag: 'transform', kind: 'stretch', nx: ll.a, ny: ll.b, c0: -ll.c, ratio: r } satisfies StoredTransform;
  }
  // Vector form is handled by a separate rule; this one takes (line, ratio).
  return call.fail('zero_length');
});

export const linearRule: CommandRule = rule((call) => {
  const m = parseMatrix(call.values[0]);
  if ('fail' in m) return call.fail(m.fail, m.detail);
  return m;
});

export const thenRule: CommandRule = rule((call) => {
  const steps: StoredTransform[] = [];
  for (const v of call.values) {
    const t = v as StoredTransform;
    if (!t || t.tag !== 'transform') return call.fail('out_of_domain', 'Then needs transforms');
    steps.push(t);
  }
  return { tag: 'transform', kind: 'then', steps } satisfies StoredTransform;
});

export const inverseRule: CommandRule = rule((call) => {
  const t = call.values[0] as StoredTransform;
  const inv = invertStored(t);
  if (!inv) return call.fail('singular_transform');
  return inv;
});

function invertStored(t: StoredTransform): StoredTransform | undefined {
  switch (t.kind) {
    case 'translate':
      return { tag: 'transform', kind: 'translate', vx: -t.vx, vy: -t.vy };
    case 'rotate':
      return { tag: 'transform', kind: 'rotate', angle: -t.angle, cx: t.cx, cy: t.cy };
    case 'reflectLine':
    case 'reflectPoint':
      return t;
    case 'dilate':
      if (t.k === 0) return undefined;
      return { tag: 'transform', kind: 'dilate', k: 1 / t.k, cx: t.cx, cy: t.cy };
    case 'shear':
      return { ...t, ratio: -t.ratio };
    case 'stretch':
      if (t.ratio === 0) return undefined;
      return { ...t, ratio: 1 / t.ratio };
    case 'linear': {
      const m = t.m;
      const det = (m[0] as number) * (m[3] as number) - (m[1] as number) * (m[2] as number);
      if (det === 0) return undefined;
      const a = (m[3] as number) / det;
      const b = -(m[1] as number) / det;
      const c = -(m[2] as number) / det;
      const d = (m[0] as number) / det;
      const e = -(a * (m[4] as number) + c * (m[5] as number));
      const f = -(b * (m[4] as number) + d * (m[5] as number));
      return { tag: 'transform', kind: 'linear', m: [a, b, c, d, e, f] };
    }
    case 'projective': {
      const H = [...t.h] as unknown as Mat3;
      const Hi = inv3(H);
      if (!Hi) return undefined;
      return { tag: 'transform', kind: 'projective', h: [...Hi] as unknown as StoredTransform & { kind: 'projective' } extends never ? never : [number, number, number, number, number, number, number, number, number] };
    }
    case 'inversion':
      return t;
    case 'then': {
      const steps: StoredTransform[] = [];
      for (let i = t.steps.length - 1; i >= 0; i--) {
        const s = invertStored(t.steps[i] as StoredTransform);
        if (!s) return undefined;
        steps.push(s);
      }
      return { tag: 'transform', kind: 'then', steps };
    }
  }
}

export const moveRule: CommandRule = rule((call) => {
  const t = call.values[1] as StoredTransform;
  if (!t || t.tag !== 'transform') return call.fail('out_of_domain', 'Move needs a transform');
  return finish(call, mapShape(t, call.values[0], call.tol));
});

export const moveVectorRule: CommandRule = rule((call) => {
  const t = call.values[1] as StoredTransform;
  const v = P(call, 0);
  if (!t || t.tag !== 'transform') return call.fail('out_of_domain', 'Move needs a transform');
  if (!sanePt(call, v)) return undefined;
  return finish(call, mapVector(t, v, call.tol));
});

export const moveCircleRule: CommandRule = rule((call) => {
  const t = call.values[1] as StoredTransform;
  if (!t || t.tag !== 'transform') return call.fail('out_of_domain', 'Move needs a transform');
  const v = call.values[0] as { cx: number; cy: number; r: number };
  // Always a Conic (the transform may be non-similar).
  const c = circleConic(v.cx, v.cy, v.r);
  return finish(call, mapConic(t, c, call.tol));
});

export const moveFuncRule: CommandRule = rule((call) => {
  const t = call.values[1] as StoredTransform;
  if (!t || t.tag !== 'transform') return call.fail('out_of_domain', 'Move needs a transform');
  const f = call.values[0] as FunctionValue;
  return finish(call, mapFunctionToCurve(t, f));
});

function mapGeomCurve(t: StoredTransform, c: { pieces: readonly (readonly V2[])[]; closed: boolean; exact?: { fx: (t: number) => number; fy: (t: number) => number; from: number; to: number } }, tol: number): Mapped {
  if (t.kind === 'inversion' || (t.kind === 'then' && t.steps.some((x) => x.kind === 'inversion'))) {
    return { fail: 'out_of_domain', detail: 'inversion of a curve is not supported' };
  }
  const pieces: V2[][] = [];
  for (const piece of c.pieces) {
    const mapped: V2[] = [];
    for (const p of piece) {
      const q = applyStored(t, p);
      if (!q) return { fail: 'crosses_horizon' };
      if (farCheck(q)) return { fail: 'too_far' };
      mapped.push(q);
    }
    pieces.push(mapped);
  }
  void tol;
  if (!c.exact) return { value: { tag: 'geomCurve', pieces, closed: c.closed } };
  const e = c.exact;
  const fx = (s: number): number => {
    const q = applyStored(t, { x: e.fx(s), y: e.fy(s) });
    return q ? q.x : NaN;
  };
  const fy = (s: number): number => {
    const q = applyStored(t, { x: e.fx(s), y: e.fy(s) });
    return q ? q.y : NaN;
  };
  return { value: { tag: 'geomCurve', pieces, closed: c.closed, exact: { fx, fy, from: e.from, to: e.to } } };
}
/** `Rotate(f, angle[, center][, progress])`: a turned function is a Curve (polygons-transforms 6.7). */
export const rotateFuncRule: CommandRule = rule((call) => {
  const names = call.form.params.map((q) => q.name);
  const ci = names.indexOf('center');
  const pi = names.indexOf('progress');
  const angle = N(call, 1);
  const c = ci >= 0 ? P(call, ci) : { x: 0, y: 0 };
  const u = pi >= 0 ? N(call, pi) : undefined;
  if (!saneAngle(call, angle) || !sanePt(call, c)) return undefined;
  if (u !== undefined && !saneNum(call, u)) return undefined;
  return finish(call, mapFunctionToCurve(rotateStored(angle, c, u === undefined ? undefined : clampProgress(u)), call.values[0] as FunctionValue));
});

/** `Reflect(f, line[, progress])`: a Curve; the checker cannot tell an axis-parallel line from the type alone (6.7). */
export const reflectLineFuncRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[1]);
  const u = call.values.length > 2 ? N(call, 2) : undefined;
  if (!ll) return call.fail('coincident_points', 'the axis has no direction');
  if (u !== undefined && !saneNum(call, u)) return undefined;
  return finish(call, mapFunctionToCurve(reflectLineStored(ll, u), call.values[0] as FunctionValue));
});
