/**
 * Circles, arcs, sectors and conics: the command rules (docs/features/conics/
 * design.md sections 4-7). Constructors keep native frames (3.2); properties
 * read the frame through one table; tangents share the intersection machinery.
 */
import type { UndefReason } from '../../contracts/values';
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { RelationValue } from '../../language/runtime';
import type { ConicValue, V2 } from './types';
import { isCircleV } from './types';
import { TAU, det2, dist, isSaneNum, isSanePt, norm2, orient } from './numerics';
import {
  asymptotesOf,
  axesOf,
  centerOf,
  centralParams,
  circleConic,
  classifyQuad,
  coefficientsOf,
  curvatureAt,
  directricesOf,
  dualConicTest,
  eccentricityOf,
  ellipseNative,
  equationOf,
  fivePointConic,
  fociOf,
  hyperbolaNative,
  linearEccentricityOf,
  majorAxisOf,
  matOf,
  matVec3,
  minorAxisOf,
  parabolaNative,
  parabolaParams,
  poleOf,
  semiAxesOf,
  tiltOf,
  toConic,
  typeNameOf,
  verticesOf,
} from './conics';
import { commonTangents, lineLikeOf, tangentsFromPoint, tangentsParallel } from './intersect';
import type { LineSlot } from './intersect';
import { rule } from './points';

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

const asConic = (v: unknown): ConicValue | undefined => toConic(v);

/** Line slots to a List<Line> value (all-share-whole-fail, like points). */
function lineSlotsToList(call: RuleCall, slots: readonly LineSlot[]): unknown {
  let reason: UndefReason | undefined;
  let allMissing = slots.length > 0;
  for (const s of slots) {
    if ('l' in s) {
      allMissing = false;
      break;
    }
    if (reason === undefined) reason = s.reason;
    else if (s.reason !== reason) {
      allMissing = false;
      break;
    }
  }
  if (allMissing && reason !== undefined) return call.fail(reason);
  return slots.map((s) => ('l' in s ? { a: s.l.a, b: s.l.b, c: s.l.c } : undefined));
}

const isRegular = (c: ConicValue): boolean =>
  c.kind === 'circle' || c.kind === 'ellipse' || c.kind === 'hyperbola' || c.kind === 'parabola';

/* ------------------------------ Circle ------------------------------ */

export const circleCRRule: CommandRule = rule((call) => {
  const c = P(call, 0);
  const r = N(call, 1);
  if (!sanePt(call, c)) return undefined;
  if (typeof r !== 'number' || !Number.isFinite(r)) return call.fail('not_finite');
  if (r < 0) return call.fail('negative_radius');
  if (r > 1e150) return call.fail('not_finite');
  return { cx: c.x, cy: c.y, r };
});

export const circleCPRule: CommandRule = rule((call) => {
  const c = P(call, 0);
  const p = P(call, 1);
  if (!sanePt(call, c) || !sanePt(call, p)) return undefined;
  return { cx: c.x, cy: c.y, r: dist(c, p) };
});

export const circleCSegRule: CommandRule = rule((call) => {
  const c = P(call, 0);
  const s = call.values[1] as { a: V2; b: V2 };
  if (!sanePt(call, c) || !sanePt(call, s.a) || !sanePt(call, s.b)) return undefined;
  return { cx: c.x, cy: c.y, r: dist(s.a, s.b) };
});

export const circle3Rule: CommandRule = rule((call) => {
  const A = P(call, 0);
  const B = P(call, 1);
  const C = P(call, 2);
  if (!sanePt(call, A) || !sanePt(call, B) || !sanePt(call, C)) return undefined;
  const tol = call.tol;
  const d = 2 * det2(B.x - A.x, B.y - A.y, C.x - A.x, C.y - A.y).value;
  const scale = Math.max(1, dist(A, B), dist(B, C), dist(C, A));
  if (Math.abs(d) <= tol * scale * scale) return call.fail('collinear');
  const bx = B.x - A.x;
  const by = B.y - A.y;
  const cx = C.x - A.x;
  const cy = C.y - A.y;
  const ux = ((bx * bx + by * by) * cy - (cx * cx + cy * cy) * by) / d;
  const uy = ((cx * cx + cy * cy) * bx - (bx * bx + by * by) * cx) / d;
  const r = Math.hypot(ux, uy);
  if (r > 5e13) return call.fail('too_far');
  return { cx: A.x + ux, cy: A.y + uy, r };
});

export const incircleRule: CommandRule = rule((call) => {
  const A = P(call, 0);
  const B = P(call, 1);
  const C = P(call, 2);
  if (!sanePt(call, A) || !sanePt(call, B) || !sanePt(call, C)) return undefined;
  const a = dist(B, C);
  const b = dist(C, A);
  const c = dist(A, B);
  const area2 = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y));
  if (area2 <= call.tol * Math.max(1, a, b, c) ** 2) return call.fail('collinear');
  const t = a + b + c;
  return { cx: (a * A.x + b * B.x + c * C.x) / t, cy: (a * A.y + b * B.y + c * C.y) / t, r: area2 / t };
});

/* ------------------------------ Arcs and sectors ------------------------------ */

/** Sweep of (from, to): slider-continuous in [0, 2pi], else wrapped. */
function sweepOf(from: number, to: number): number {
  const s = to - from;
  if (s >= 0 && s <= TAU) return s;
  const w = ((s % TAU) + TAU) % TAU;
  return w;
}

const checkArcConic = (call: RuleCall, v: unknown): ConicValue | undefined => {
  const c = asConic(v);
  if (!c) {
    call.fail('wrong_kind', 'needs a circle or ellipse');
    return undefined;
  }
  if (c.kind !== 'circle' && c.kind !== 'ellipse') {
    call.fail('wrong_kind', `arcs need a circle or ellipse, not ${typeNameOf(c)}`);
    return undefined;
  }
  return c;
};

export const arcCNNRule: CommandRule = rule((call) => {
  const c = P(call, 0);
  const r = N(call, 1);
  const from = N(call, 2);
  const to = N(call, 3);
  if (!sanePt(call, c)) return undefined;
  if (!Number.isFinite(r) || r > 1e150) return call.fail('not_finite');
  if (r < 0) return call.fail('negative_radius');
  if (!saneNum(call, from) || !saneNum(call, to)) return undefined;
  return { conic: circleConic(c.x, c.y, r), from, sweep: sweepOf(from, to) };
});

export const arcCSERule: CommandRule = rule((call) => {
  const c = P(call, 0);
  const s = P(call, 1);
  const e = P(call, 2);
  if (!sanePt(call, c) || !sanePt(call, s) || !sanePt(call, e)) return undefined;
  const r = dist(c, s);
  if (r <= call.tol * Math.max(1, norm2(c))) return call.fail('coincident_points');
  if (dist(c, e) <= call.tol * Math.max(1, norm2(c))) return call.fail('coincident_points');
  const from = Math.atan2(s.y - c.y, s.x - c.x);
  let sweep = Math.atan2(e.y - c.y, e.x - c.x) - from;
  while (sweep <= 0) sweep += TAU;
  while (sweep > TAU) sweep -= TAU;
  return { conic: circleConic(c.x, c.y, r), from, sweep };
});

export const arcConicNNRule: CommandRule = rule((call) => {
  const c = checkArcConic(call, call.values[0]);
  if (!c) return undefined;
  const from = N(call, 1);
  const to = N(call, 2);
  if (!saneNum(call, from) || !saneNum(call, to)) return undefined;
  return { conic: c, from, sweep: sweepOf(from, to) };
});

export const arcConicPQRule: CommandRule = rule((call) => {
  const c = checkArcConic(call, call.values[0]);
  if (!c) return undefined;
  const p = P(call, 1);
  const q = P(call, 2);
  if (!sanePt(call, p) || !sanePt(call, q)) return undefined;
  const cp = centralParams(c);
  if (!cp) return call.fail('wrong_kind', 'needs a central conic');
  if (dist(p, { x: cp.cx, y: cp.cy }) <= call.tol || dist(q, { x: cp.cx, y: cp.cy }) <= call.tol) {
    return call.fail('coincident_points');
  }
  const from = Math.atan2(p.y - cp.cy, p.x - cp.cx);
  let sweep = Math.atan2(q.y - cp.cy, q.x - cp.cx) - from;
  while (sweep <= 0) sweep += TAU;
  while (sweep > TAU) sweep -= TAU;
  return { conic: c, from, sweep };
});

export const arcThroughRule: CommandRule = rule((call) => {
  const A = P(call, 0);
  const B = P(call, 1);
  const C = P(call, 2);
  if (!sanePt(call, A) || !sanePt(call, B) || !sanePt(call, C)) return undefined;
  const d = 2 * det2(B.x - A.x, B.y - A.y, C.x - A.x, C.y - A.y).value;
  const scale = Math.max(1, dist(A, B), dist(B, C), dist(C, A));
  if (Math.abs(d) <= call.tol * scale * scale) return call.fail('collinear');
  const bx = B.x - A.x;
  const by = B.y - A.y;
  const cx = C.x - A.x;
  const cy = C.y - A.y;
  const ux = ((bx * bx + by * by) * cy - (cx * cx + cy * cy) * by) / d;
  const uy = ((cx * cx + cy * cy) * bx - (bx * bx + by * by) * cx) / d;
  const O = { x: A.x + ux, y: A.y + uy };
  const r = Math.hypot(ux, uy);
  const conic = circleConic(O.x, O.y, r);
  const aA = Math.atan2(A.y - O.y, A.x - O.x);
  const aC = Math.atan2(C.y - O.y, C.x - O.x);
  if (orient(A, B, C).sign >= 0) {
    let sweep = aC - aA;
    while (sweep <= 0) sweep += TAU;
    return { conic, from: aA, sweep };
  }
  let sweep = aA - aC;
  while (sweep <= 0) sweep += TAU;
  return { conic, from: aC, sweep, reversed: true as const };
});

export const semicircleRule: CommandRule = rule((call) => {
  const A = P(call, 0);
  const B = P(call, 1);
  if (!sanePt(call, A) || !sanePt(call, B)) return undefined;
  if (dist(A, B) <= call.tol * Math.max(1, norm2(A))) return call.fail('coincident_points');
  const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  return { conic: circleConic(M.x, M.y, dist(A, B) / 2), from: Math.atan2(B.y - M.y, B.x - M.x), sweep: Math.PI };
});

export const sectorCNNRule: CommandRule = rule((call) => arcCNNRule.run(call));
export const sectorConicNNRule: CommandRule = rule((call) => arcConicNNRule.run(call));
export const sectorConicPQRule: CommandRule = rule((call) => arcConicPQRule.run(call));
export const sectorCSERule: CommandRule = rule((call) => arcCSERule.run(call));
export const sectorThroughRule: CommandRule = rule((call) => arcThroughRule.run(call));

/* ------------------------------ Conic, Ellipse, Hyperbola, Parabola ------------------------------ */

export const conic5Rule: CommandRule = rule((call) => {
  const pts = [P(call, 0), P(call, 1), P(call, 2), P(call, 3), P(call, 4)];
  for (const p of pts) if (!sanePt(call, p)) return undefined;
  const r = fivePointConic(pts, call.tol);
  if ('fail' in r) return call.fail(r.fail, r.detail);
  return r.conic;
});

export const conic6Rule: CommandRule = rule((call) => {
  const nums = [N(call, 0), N(call, 1), N(call, 2), N(call, 3), N(call, 4), N(call, 5)];
  for (const v of nums) if (typeof v !== 'number' || !Number.isFinite(v)) return call.fail('not_finite');
  const r = classifyQuad(
    { A: nums[0] as number, B: nums[1] as number, C: nums[2] as number, D: nums[3] as number, E: nums[4] as number, F: nums[5] as number },
    call.tol,
  );
  if ('fail' in r) return call.fail(r.fail);
  return toValue(r);
});

export const conicListRule: CommandRule = rule((call) => {
  const v = call.values[0] as ArrayLike<unknown>;
  const len = (v as readonly unknown[]).length;
  if (len !== 6) return call.fail('out_of_domain', `a conic list needs six numbers, found ${len}`);
  const nums = Array.from(v as unknown as ArrayLike<number>);
  if (!nums.every((x) => typeof x === 'number' && Number.isFinite(x))) return call.fail('not_finite');
  const r = classifyQuad(
    { A: nums[0] as number, B: nums[1] as number, C: nums[2] as number, D: nums[3] as number, E: nums[4] as number, F: nums[5] as number },
    call.tol,
  );
  if ('fail' in r) return call.fail(r.fail);
  return toValue(r);
});

function toValue(r: {
  q: ConicValue['q'];
  kind: ConicValue['kind'];
  frame?: ConicValue['frame'];
  margin: number;
  lines?: ConicValue['lines'];
  point?: V2;
}): ConicValue {
  const base: ConicValue = { q: r.q, kind: r.kind, margin: r.margin };
  const withFrame = r.frame ? { ...base, frame: r.frame } : base;
  const withLines = r.lines ? { ...withFrame, lines: r.lines } : withFrame;
  return r.point ? { ...withLines, point: r.point } : withLines;
}

export const conicEqRule: CommandRule = rule((call) => {
  const rel = call.values[0] as RelationValue;
  if (rel.ops.length !== 1 || rel.ops[0] !== '==') return call.fail('bad_equation', 'Conic needs one == equation');
  const poly = rel.poly;
  if (!poly) {
    // Cubic (or larger) versus transcendental: probe the residual's degree.
    const deg = probeDegree(rel.residual);
    if (deg === 'nonpoly') return call.fail('not_polynomial', 'x and y only in sums, products and powers');
    if (deg <= 2) return call.fail('limit', 'the equation has too many terms');
    return call.fail('not_quadratic', 'degree above 2');
  }
  const r = classifyQuad({ A: poly.xx, B: poly.xy, C: poly.yy, D: poly.x, E: poly.y, F: poly.c }, call.tol);
  if ('fail' in r) return call.fail(r.fail);
  return toValue(r);
});

/** Degree of residual(x, 0) by finite differences (<= 8), or 'nonpoly'. */
function probeDegree(residual: (x: number, y: number) => number): number | 'nonpoly' {
  const NPT = 12;
  const vals: number[] = [];
  for (let i = 0; i < NPT; i++) {
    const v = residual(i - NPT / 2, 0);
    if (!Number.isFinite(v)) return 'nonpoly';
    vals.push(v);
  }
  const scale = Math.max(1, ...vals.map(Math.abs));
  let diff = [...vals];
  for (let d = 0; d <= 8; d++) {
    const mx = Math.max(...diff.map(Math.abs));
    if (mx <= 1e-9 * scale) return d;
    if (diff.length <= 2) return 'nonpoly';
    const next: number[] = [];
    for (let i = 0; i + 1 < diff.length; i++) next.push((diff[i + 1] as number) - (diff[i] as number));
    diff = next;
  }
  return 'nonpoly';
}

export const ellipseFociLengthRule: CommandRule = rule((call) => {
  const f1 = P(call, 0);
  const f2 = P(call, 1);
  const a = N(call, 2);
  if (!sanePt(call, f1) || !sanePt(call, f2)) return undefined;
  if (!Number.isFinite(a)) return call.fail('not_finite');
  if (a <= 0) return call.fail('non_positive');
  const c = dist(f1, f2) / 2;
  if (a <= c * (1 + 1e-12) && c > 0) {
    return call.fail('too_short', `2a = ${2 * a} is not more than the focus distance ${2 * c}`);
  }
  if (c === 0) return circleConic(f1.x, f1.y, a);
  return ellipseNative(f1, f2, a);
});

export const ellipseFociSegmentRule: CommandRule = rule((call) => {
  const s = call.values[2] as { a: V2; b: V2 };
  const a = dist(s.a, s.b);
  return ellipseFociLengthRule.run({ ...call, values: [call.values[0], call.values[1], a] });
});

export const ellipseFociPointRule: CommandRule = rule((call) => {
  const f1 = P(call, 0);
  const f2 = P(call, 1);
  const p = P(call, 2);
  if (!sanePt(call, f1) || !sanePt(call, f2) || !sanePt(call, p)) return undefined;
  const a = (dist(p, f1) + dist(p, f2)) / 2;
  return ellipseFociLengthRule.run({ ...call, values: [f1, f2, a] });
});

export const hyperbolaFociLengthRule: CommandRule = rule((call) => {
  const f1 = P(call, 0);
  const f2 = P(call, 1);
  const a = N(call, 2);
  if (!sanePt(call, f1) || !sanePt(call, f2)) return undefined;
  if (!Number.isFinite(a)) return call.fail('not_finite');
  const c = dist(f1, f2) / 2;
  if (c <= call.tol * Math.max(1, norm2(f1))) return call.fail('coincident_points');
  if (a <= 0) return call.fail('non_positive');
  if (a >= c * (1 - 1e-12)) {
    return call.fail('too_long', `2a = ${2 * a} is not less than the focus distance ${2 * c}`);
  }
  return hyperbolaNative(f1, f2, a);
});

export const hyperbolaFociSegmentRule: CommandRule = rule((call) => {
  const s = call.values[2] as { a: V2; b: V2 };
  const a = dist(s.a, s.b);
  return hyperbolaFociLengthRule.run({ ...call, values: [call.values[0], call.values[1], a] });
});

export const hyperbolaFociPointRule: CommandRule = rule((call) => {
  const f1 = P(call, 0);
  const f2 = P(call, 1);
  const p = P(call, 2);
  if (!sanePt(call, f1) || !sanePt(call, f2) || !sanePt(call, p)) return undefined;
  const a = Math.abs(dist(p, f1) - dist(p, f2)) / 2;
  return hyperbolaFociLengthRule.run({ ...call, values: [f1, f2, a] });
});

export const parabolaRule: CommandRule = rule((call) => {
  const f = P(call, 0);
  const ll = lineLikeOf(call.values[1]);
  if (!ll) return call.fail('out_of_domain', 'needs a directrix line');
  if (!sanePt(call, f)) return undefined;
  const d = Math.abs(ll.a * f.x + ll.b * f.y - ll.c);
  if (d <= call.tol * Math.max(1, norm2(f), Math.abs(ll.c))) return call.fail('focus_on_directrix');
  return parabolaNative(f, ll.a, ll.b, ll.c);
});

/* ------------------------------ Properties ------------------------------ */

export const centerRule: CommandRule = rule((call) => {
  const c = asConic(call.values[0]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  const p = centerOf(c);
  if (!p) {
    if (c.kind === 'parabola') return call.fail('no_center');
    return call.fail('wrong_kind', `c is ${typeNameOf(c)}`);
  }
  return p;
});

export const radiusRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (isCircleV(v)) return v.r;
  const c = asConic(v);
  if (!c) return call.fail('not_circle', 'Radius needs a circle');
  if (c.kind !== 'circle') return call.fail('not_circle', `c is ${typeNameOf(c)}; Radius needs a circle`);
  const cp = centralParams(c);
  return cp ? cp.a : call.fail('not_circle', 'Radius needs a circle');
});

function needKinds(call: RuleCall, c: ConicValue | undefined, kinds: readonly string[], what: string): ConicValue | undefined {
  if (!c || !kinds.includes(c.kind)) {
    call.fail('wrong_kind', c ? `c is ${c.kind === 'circle' ? 'a circle' : typeNameOf(c)}; ${what}` : what);
    return undefined;
  }
  return c;
}

export const semiMajorRule: CommandRule = rule((call) => {
  const c = needKinds(call, asConic(call.values[0]), ['circle', 'ellipse', 'hyperbola'], 'SemiMajor needs an ellipse, hyperbola or circle');
  if (!c) return undefined;
  return semiAxesOf(c)[0];
});

export const semiMinorRule: CommandRule = rule((call) => {
  const c = needKinds(call, asConic(call.values[0]), ['circle', 'ellipse', 'hyperbola'], 'SemiMinor needs an ellipse, hyperbola or circle');
  if (!c) return undefined;
  return semiAxesOf(c)[1];
});

export const eccentricityRule: CommandRule = rule((call) => {
  const c = needKinds(
    call,
    asConic(call.values[0]),
    ['circle', 'ellipse', 'hyperbola', 'parabola'],
    'Eccentricity needs a circle, ellipse, hyperbola or parabola',
  );
  if (!c) return undefined;
  return eccentricityOf(c);
});

export const linearEccentricityRule: CommandRule = rule((call) => {
  const c = needKinds(
    call,
    asConic(call.values[0]),
    ['circle', 'ellipse', 'hyperbola', 'parabola'],
    'LinearEccentricity needs a circle, ellipse, hyperbola or parabola',
  );
  if (!c) return undefined;
  return linearEccentricityOf(c);
});

export const focusRule: CommandRule = rule((call) => {
  const c = needKinds(call, asConic(call.values[0]), ['circle', 'ellipse', 'hyperbola', 'parabola'], 'Focus needs a regular conic');
  if (!c) return undefined;
  return fociOf(c);
});

export const vertexConicRule: CommandRule = rule((call) => {
  const c = needKinds(call, asConic(call.values[0]), ['circle', 'ellipse', 'hyperbola', 'parabola'], 'Vertex needs a regular conic');
  if (!c) return undefined;
  return verticesOf(c);
});

export const directrixRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const c = asConic(v);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (c.kind === 'circle') return call.fail('no_directrix');
  if (c.kind !== 'ellipse' && c.kind !== 'hyperbola' && c.kind !== 'parabola') {
    return call.fail('wrong_kind', `c is ${typeNameOf(c)}`);
  }
  return directricesOf(c).map((l) => ({ a: l.a, b: l.b, c: l.c }));
});

export const majorAxisRule: CommandRule = rule((call) => {
  const c = needKinds(
    call,
    asConic(call.values[0]),
    ['circle', 'ellipse', 'hyperbola', 'parabola'],
    'MajorAxis needs a regular conic',
  );
  if (!c) return undefined;
  const l = majorAxisOf(c);
  if (!l) return call.fail('wrong_kind', `c is ${typeNameOf(c)}`);
  return { a: l.a, b: l.b, c: l.c };
});

export const minorAxisRule: CommandRule = rule((call) => {
  const c = needKinds(call, asConic(call.values[0]), ['circle', 'ellipse', 'hyperbola'], 'MinorAxis needs a central conic');
  if (!c) return undefined;
  const l = minorAxisOf(c);
  if (!l) return call.fail('wrong_kind', `c is ${typeNameOf(c)}`);
  return { a: l.a, b: l.b, c: l.c };
});

export const axesRule: CommandRule = rule((call) => {
  const c = asConic(call.values[0]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  const ls = axesOf(c);
  if (c.kind !== 'circle' && c.kind !== 'ellipse' && c.kind !== 'hyperbola' && c.kind !== 'parabola' && c.kind !== 'lines') {
    return call.fail('wrong_kind', `c is ${typeNameOf(c)}`);
  }
  return ls.map((l) => ({ a: l.a, b: l.b, c: l.c }));
});

export const tiltRule: CommandRule = rule((call) => {
  const c = needKinds(call, asConic(call.values[0]), ['ellipse', 'hyperbola', 'parabola'], 'Tilt needs an ellipse, hyperbola or parabola');
  if (!c) return undefined;
  return tiltOf(c);
});

export const parameterRule: CommandRule = rule((call) => {
  const c = needKinds(call, asConic(call.values[0]), ['parabola'], 'Parameter needs a parabola');
  if (!c) return undefined;
  return parabolaParams(c);
});

export const coefficientsRule: CommandRule = rule((call) => {
  const c = asConic(call.values[0]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  return coefficientsOf(c);
});

export const equationRule: CommandRule = rule((call) => {
  const c = asConic(call.values[0]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  return equationOf(c);
});

export const conicTypeRule: CommandRule = rule((call) => {
  const c = asConic(call.values[0]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  return typeNameOf(c);
});

/* ------------------------------ Tangent, Polar, Pole ------------------------------ */

export const tangentPRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (!sanePt(call, p)) return undefined;
  if (!isRegular(c)) return call.fail('degenerate_conic', `c is ${typeNameOf(c)}`);
  return lineSlotsToList(call, tangentsFromPoint(p, c, call.tol));
});

export const tangentLRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[0]);
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (!ll) return call.fail('zero_length');
  if (!isRegular(c)) return call.fail('degenerate_conic', `c is ${typeNameOf(c)}`);
  return lineSlotsToList(call, tangentsParallel(ll, c));
});

export const tangentCCRule: CommandRule = rule((call) => {
  const c1 = asConic(call.values[0]);
  const c2 = asConic(call.values[1]);
  if (!c1 || !c2) return call.fail('wrong_kind', 'needs two conics');
  if (!isRegular(c1) || !isRegular(c2)) return call.fail('degenerate_conic', 'needs two regular conics');
  if (!call.work.spend(2000)) return call.fail('timeout');
  return lineSlotsToList(call, commonTangents(c1, c2, call.tol));
});

export const polarRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (!sanePt(call, p)) return undefined;
  const t = matVec3(matOf(c.q), p.x, p.y, 1);
  if (Math.hypot(t[0], t[1]) <= 1e-12 * Math.abs(t[2]) && t[2] === 0) {
    return call.fail('degenerate_conic', 'the singular point has no polar');
  }
  const l = Math.hypot(t[0], t[1]);
  if (!(l > 0)) return call.fail('degenerate_conic', 'the singular point has no polar');
  return { a: t[0] / l, b: t[1] / l, c: -t[2] / l };
});

export const poleRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[0]);
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (!ll) return call.fail('zero_length');
  if (!isRegular(c)) return call.fail('degenerate_conic', `c is ${typeNameOf(c)}`);
  const r = poleOf(c, { a: ll.a, b: ll.b, c: ll.c });
  if (!r) return call.fail('degenerate_conic');
  if (r.cond > 1e8 && !r.atInfinity) {
    // Ill-conditioned but kept (the note has no channel in the kernel).
    void r.cond;
  }
  if (r.atInfinity || !r.p) return call.fail('at_infinity');
  return r.p;
});

export const conjugateDiameterRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  const ll = lineLikeOf(v);
  let dx: number;
  let dy: number;
  if (ll) {
    dx = ll.dx;
    dy = ll.dy;
  } else {
    const p = v as V2;
    const l = norm2(p);
    if (!(l > 0)) return call.fail('zero_length');
    dx = p.x / l;
    dy = p.y / l;
  }
  const t = matVec3(matOf(c.q), dx, dy, 0);
  const l = Math.hypot(t[0], t[1]);
  if (!(l > 0)) return call.fail('degenerate_conic');
  return { a: t[0] / l, b: t[1] / l, c: -t[2] / l };
});

export const asymptoteRule: CommandRule = rule((call) => {
  const c = asConic(call.values[0]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (c.kind !== 'hyperbola' && c.kind !== 'lines') return call.fail('not_hyperbola', `c is ${typeNameOf(c)}`);
  return asymptotesOf(c).map((l) => ({ a: l.a, b: l.b, c: l.c }));
});

export const isTangentRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[0]);
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (!ll) return call.fail('zero_length');
  return dualConicTest(c, { a: ll.a, b: ll.b, c: ll.c }, call.tol);
});

/* ------------------------------ Curvature ------------------------------ */

export const curvatureRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (!sanePt(call, p)) return undefined;
  if (!isRegular(c)) return call.fail('wrong_kind', `c is ${typeNameOf(c)}`);
  const r = curvatureAt(c, p);
  if (!r.ok) return call.fail('singular_point');
  return r.kappa;
});

export const curvatureVectorRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (!sanePt(call, p)) return undefined;
  if (!isRegular(c)) return call.fail('wrong_kind', `c is ${typeNameOf(c)}`);
  const r = curvatureAt(c, p);
  if (!r.ok) return call.fail('singular_point');
  return { x: r.kappa * r.normal.x, y: r.kappa * r.normal.y };
});

export const osculatingCircleRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const c = asConic(call.values[1]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  if (!sanePt(call, p)) return undefined;
  if (!isRegular(c)) return call.fail('wrong_kind', `c is ${typeNameOf(c)}`);
  const r = curvatureAt(c, p);
  if (!r.ok) return call.fail('singular_point');
  if (r.kappa === 0) return call.fail('straight');
  return { cx: p.x + r.normal.x / r.kappa, cy: p.y + r.normal.y / r.kappa, r: 1 / Math.abs(r.kappa) };
});
