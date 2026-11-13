/**
 * Loci, paths and envelopes by sweeping the kernel's `slice` (curves design 9, 11):
 * the rules between a mover and a target run on scratch values, view-independently.
 * The mover here is a free number (or the clock); a `PointOn` mover needs kernel
 * support for rule movers (see the builder notes) and is reported, not guessed.
 */
import type { ObjId, Pt } from '../../contracts/values';
import type { UndefReason } from '../../contracts/values';
import type { Cell } from '../../graph/types';
import type { RuleCall } from '../../graph/registry';
import type { Coef2, SampledCurveData } from './types';
import { isCircle3, isLine3, isPt } from './types';
import { asCurve, curvePoint, curveRange } from './curves';

export type Fail = { readonly ok: false; readonly reason: UndefReason; readonly detail: string };
export type Win<T> = { readonly ok: true; readonly value: T };
export type Fallible<T> = Win<T> | Fail;

export const fail = (reason: UndefReason, detail: string): Fail => ({ ok: false, reason, detail });

/** A sample of the sweep: the mover value and the target point (null when undefined). */
export interface SweepSample {
  readonly s: number;
  readonly p: Pt | null;
}

/** Runs the slice for one mover value; null when the budget is spent there. */
function runOne(run: (values: Iterable<unknown>) => Cell[], v: number): SweepSample | null {
  const cells = run([v]);
  const cell = cells[0] as Cell;
  if (!cell.defined) {
    if (cell.reason === 'timeout') return null;
    return { s: v, p: null };
  }
  const val = cell.value;
  return { s: v, p: isPt(val) ? val : null };
}

export interface SweepSetup {
  readonly run: (values: Iterable<unknown>) => Cell[];
}

export function openSlice(call: RuleCall, mover: ObjId | 't', target: ObjId): Fallible<SweepSetup> {
  const slice = call.slice(mover, target);
  if ('ok' in slice) {
    if (slice.kind === 'not_free') {
      return fail(
        'not_a_mover',
        'The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel support for movers on paths.',
      );
    }
    return fail('no_dependency', `The kernel slice refused this pair (${slice.kind}).`);
  }
  // over the clock, a point that moves only through states has no rules in between, but it still moves
  if (slice.chain.length === 0 && (slice.states?.length ?? 0) === 0) return fail('no_dependency', noDependency(call, target));
  return { ok: true, value: { run: slice.run } };
}

/* ------------------------------ movers on paths ------------------------------ */

/** A path a point can move along, read in natural units: an angle on a circle, a distance on a segment or a line. */
export interface MoverPath {
  at(s: number): Pt | undefined;
  readonly lo: number;
  readonly hi: number;
  readonly closed: boolean;
}

const LINE_REACH = 10;

/** The path a value is, or `undefined` when a point cannot move along it. */
export function pathOf(v: unknown): MoverPath | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  if (isCircle3(v)) {
    if (!(v.r > 0) || !Number.isFinite(v.cx) || !Number.isFinite(v.cy)) return undefined;
    return { at: (s) => ({ x: v.cx + v.r * Math.cos(s), y: v.cy + v.r * Math.sin(s) }), lo: 0, hi: 2 * Math.PI, closed: true };
  }
  const o = v as { a?: unknown; b?: unknown; dir?: unknown };
  if (isPt(o.a) && isPt(o.b)) {
    const a = o.a;
    const b = o.b;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) return undefined;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // a ray keeps going past its second point; a segment stops there
    const ray = (v as { ray?: unknown }).ray === true;
    return { at: (s) => ({ x: a.x + ux * s, y: a.y + uy * s }), lo: 0, hi: ray ? LINE_REACH * Math.max(1, len) : len, closed: false };
  }
  if (isLine3(v)) {
    const n2 = v.a * v.a + v.b * v.b;
    if (!(n2 > 0)) return undefined;
    const n = Math.sqrt(n2);
    const px = (v.a * v.c) / n2;
    const py = (v.b * v.c) / n2;
    return { at: (s) => ({ x: px - (v.b / n) * s, y: py + (v.a / n) * s }), lo: -LINE_REACH, hi: LINE_REACH, closed: false };
  }
  const c = asCurve(v);
  if (c) {
    const r = curveRange(c);
    if (!r || !Number.isFinite(r[0]) || !Number.isFinite(r[1]) || !(r[0] < r[1])) return undefined;
    return { at: (s) => curvePoint(c, s) ?? undefined, lo: r[0], hi: r[1], closed: false };
  }
  return undefined;
}

export interface PathSweep {
  readonly setup: SweepSetup;
  readonly path: MoverPath;
}

/**
 * Opens a sweep whose mover is a point on a path (`P = PointOn(c, 0.3)`): the kernel puts each path point in place of
 * the mover and re-runs what lies between it and the target. The sweep's own variable is the path's natural unit.
 */
export function openPathSlice(call: RuleCall, mover: ObjId, target: ObjId): Fallible<PathSweep> {
  const inputs = call.inputsOf(mover);
  let path: MoverPath | undefined;
  // the path is an argument of the mover's own command, written as a name or in place: PointOn(Segment(A, B), 0.3)
  for (const v of [...call.argsOf(mover), ...inputs.map((i) => i.value)]) {
    path = pathOf(v);
    if (path) break;
  }
  if (!path) {
    return fail(
      'not_a_mover',
      inputs.length === 0
        ? 'The mover is a free point, not a point on a path. Put it on a path first, for example P = PointOn(c, 0.5).'
        : 'The mover is not a point on a path. Put it on a path first, for example P = PointOn(c, 0.5).',
    );
  }
  const slice = call.slice(mover, target, { override: true });
  if ('ok' in slice) return fail('no_dependency', `The kernel slice refused this pair (${slice.kind}).`);
  if (slice.chain.length === 0) return fail('no_dependency', noDependency(call, target));
  const p = path;
  const run = (values: Iterable<unknown>): Cell[] => {
    const pts: unknown[] = [];
    for (const s of values) pts.push(typeof s === 'number' ? p.at(s) : undefined);
    return slice.run(pts);
  };
  return { ok: true, value: { setup: { run }, path } };
}

/** The no_dependency sentence, naming what the target does read. */
function noDependency(call: RuleCall, target: ObjId): string {
  const names = call.inputsOf(target).map((i) => i.name);
  return names.length > 0
    ? `The point does not depend on the mover, so its locus would be a single point. It depends on ${names.join(', ')}.`
    : 'The point does not depend on the mover, so its locus would be a single point. It depends on nothing that moves.';
}

/* ------------------------------ adaptive sweep ------------------------------ */

const LOCUS_N0 = 128;
const LOCUS_MAX_DEPTH = 12;
const LOCUS_SAMPLE_CAP = 20000;

interface SweepState {
  count: number;
  capped: boolean;
  spent: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function distP(p: Pt, q: Pt): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function distToChord(m: Pt, p: Pt, q: Pt): number {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distP(m, p);
  const t = ((m.x - p.x) * dx + (m.y - p.y) * dy) / len2;
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(m.x - (p.x + c * dx), m.y - (p.y + c * dy));
}

/**
 * Sweeps one value per mover sample over `[from, to]` with adaptive refinement
 * (curves design 9): split when the midpoint leaves the chord by more than `5e-4 D`
 * or the chord is longer than `D / 64`. Returns ordered pieces (gaps split).
 * Deterministic. `batch` seeds the initial sweep in one call when given.
 */
export function sweepProvider(
  sample: (s: number) => SweepSample | null,
  from: number,
  to: number,
  batch: ((ss: readonly number[]) => (SweepSample | null)[]) | null,
): { readonly pieces: readonly (readonly Pt[])[]; readonly spent: boolean; readonly capped: boolean } {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const st: SweepState = { count: 0, capped: false, spent: false, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const grow = (p: Pt): void => {
    if (p.x < st.minX) st.minX = p.x;
    if (p.x > st.maxX) st.maxX = p.x;
    if (p.y < st.minY) st.minY = p.y;
    if (p.y > st.maxY) st.maxY = p.y;
  };
  const diag = (): number => Math.max(Math.hypot(st.maxX - st.minX, st.maxY - st.minY), 1e-300);
  // Initial uniform sweep.
  const initS: number[] = [];
  for (let i = 0; i <= LOCUS_N0; i++) initS.push(lo + ((hi - lo) * i) / LOCUS_N0);
  const inits: SweepSample[] = [];
  if (batch) {
    for (const sm of batch(initS)) {
      if (!sm) {
        st.spent = true;
        inits.push({ s: initS[inits.length] as number, p: null });
      } else inits.push(sm);
    }
  } else {
    for (const s of initS) {
      const sm = sample(s);
      if (!sm) {
        st.spent = true;
        inits.push({ s, p: null });
      } else inits.push(sm);
    }
  }
  st.count = inits.length;
  for (const sm of inits) if (sm.p) grow(sm.p);
  // Refine each initial segment; stitch pieces that share an exact endpoint.
  const out: Pt[][] = [];
  let current: Pt[] = [];
  const flush = (): void => {
    if (current.length > 0) out.push(current);
    current = [];
  };
  const samePt = (p: Pt, q: Pt): boolean => p.x === q.x && p.y === q.y;
  for (let i = 0; i < inits.length - 1; i++) {
    const segPieces = refineSegment(sample, inits[i] as SweepSample, inits[i + 1] as SweepSample, 0, diag, grow, st);
    segPieces.forEach((piece, j) => {
      if (j > 0) flush();
      else if (current.length > 0 && (piece.length === 0 || !samePt(current[current.length - 1] as Pt, piece[0] as Pt))) flush();
      for (const pt of piece) {
        const last = current[current.length - 1];
        if (last && samePt(last, pt)) continue;
        current.push(pt);
      }
    });
  }
  flush();
  return { pieces: out, spent: st.spent, capped: st.capped };
}

export type Sampler = (s: number) => SweepSample | null;

function refineSegment(
  sample: Sampler,
  a: SweepSample,
  b: SweepSample,
  depth: number,
  diag: () => number,
  grow: (p: Pt) => void,
  st: SweepState,
): (readonly Pt[])[] {
  const D = diag();
  // Both ends undefined: look for a defined island inside.
  if (!a.p || !b.p) {
    if (!a.p && !b.p) {
      if (depth >= LOCUS_MAX_DEPTH) return [];
      const m = sample((a.s + b.s) / 2);
      st.count++;
      if (!m) {
        st.spent = true;
        return [];
      }
      if (!m.p) return [];
      grow(m.p);
      return [...refineSegment(sample, a, m, depth + 1, diag, grow, st), ...refineSegment(sample, m, b, depth + 1, diag, grow, st)];
    }
    // One end undefined: bisect to the boundary of the defined stretch.
    const edge = findEdge(sample, a, b, st);
    if (!edge.at) return [];
    grow(edge.at.p);
    // the defined stretch runs from the defined end to the edge just found
    return a.p
      ? refineSegment(sample, a, edge.at, depth + 1, diag, grow, st)
      : refineSegment(sample, edge.at, b, depth + 1, diag, grow, st);
  }
  const pa = a.p;
  const pb = b.p;
  const chord = distP(pa, pb);
  // Long chord: a jump splits the piece (curves design 9 rule 4).
  if (chord > D / 6) {
    const jump = checkJump(sample, a, b, chord, st);
    if (jump.isJump) return [[pa], [pb]];
    if (jump.mid) {
      grow(jump.mid.p);
      return joinPieces(
        refineSegment(sample, a, jump.mid, depth + 1, diag, grow, st),
        refineSegment(sample, jump.mid, b, depth + 1, diag, grow, st),
      );
    }
    return [[pa, pb]];
  }
  if (depth >= LOCUS_MAX_DEPTH || st.capped) return [[pa, pb]];
  const m = sample((a.s + b.s) / 2);
  st.count++;
  if (!m) {
    st.spent = true;
    return [[pa, pb]];
  }
  if (!m.p) {
    return [...refineSegment(sample, a, m, depth + 1, diag, grow, st), ...refineSegment(sample, m, b, depth + 1, diag, grow, st)];
  }
  grow(m.p);
  const off = distToChord(m.p, pa, pb);
  if (off > 5e-4 * D || chord > D / 64) {
    if (st.count > LOCUS_SAMPLE_CAP) {
      st.capped = true;
      return [[pa, pb]];
    }
    return joinPieces(
      refineSegment(sample, a, m, depth + 1, diag, grow, st),
      refineSegment(sample, m, b, depth + 1, diag, grow, st),
    );
  }
  return [[pa, pb]];
}

/** Sweeps a slice target over `[from, to]` (the `Locus`/`Path` case). */
export function sweepLocus(
  setup: SweepSetup,
  from: number,
  to: number,
): { readonly pieces: readonly (readonly Pt[])[]; readonly spent: boolean; readonly capped: boolean } {
  const run = setup.run;
  const sample = (s: number): SweepSample | null => runOne(run, s);
  const batch = (ss: readonly number[]): (SweepSample | null)[] =>
    run(ss).map((cell, i) => {
      if (!cell.defined) return cell.reason === 'timeout' ? null : { s: ss[i] as number, p: null };
      return { s: ss[i] as number, p: isPt(cell.value) ? cell.value : null };
    });
  return sweepProvider(sample, from, to, batch);
}

/** Joins adjacent refined pieces that share an endpoint. */
function joinPieces(l: readonly (readonly Pt[])[], r: readonly (readonly Pt[])[]): (readonly Pt[])[] {
  if (l.length === 0) return [...r];
  if (r.length === 0) return [...l];
  const out = [...l];
  const first = r[0] as readonly Pt[];
  const last = out[out.length - 1] as readonly Pt[];
  const le = last[last.length - 1] as Pt;
  const fs = first[0] as Pt;
  if (le.x === fs.x && le.y === fs.y) out[out.length - 1] = [...last, ...first.slice(1)];
  else out.push(first);
  for (let i = 1; i < r.length; i++) out.push(r[i] as readonly Pt[]);
  return out;
}

interface EdgeOut {
  readonly at: { readonly s: number; readonly p: Pt } | null;
}

/** Bisects `[a, b]` (one end undefined) to the defined edge, to 1e-12 in the parameter. */
function findEdge(sample: Sampler, a: SweepSample, b: SweepSample, st: SweepState): EdgeOut {
  let undefinedEnd = !a.p ? a.s : b.s;
  let definedEnd = !a.p ? b.s : a.s;
  let definedPt = (!a.p ? b.p : a.p) as Pt;
  for (let i = 0; i < 40; i++) {
    if (Math.abs(definedEnd - undefinedEnd) <= 1e-12 * Math.max(1, Math.abs(definedEnd))) break;
    const m = 0.5 * (undefinedEnd + definedEnd);
    const sm = sample(m);
    st.count++;
    if (!sm) {
      st.spent = true;
      return { at: null };
    }
    if (sm.p) {
      definedEnd = m;
      definedPt = sm.p;
    } else undefinedEnd = m;
  }
  return { at: { s: definedEnd, p: definedPt } };
}

interface JumpOut {
  readonly isJump: boolean;
  readonly mid: { readonly s: number; readonly p: Pt } | null;
}

/**
 * Decides whether a long chord is a jump (curves design 9 rule 4): bisect 20 times;
 * when no bisection brings the neighbour distance below half, it is a jump.
 */
function checkJump(sample: Sampler, a: SweepSample, b: SweepSample, chord: number, st: SweepState): JumpOut {
  const pa = a.p as Pt;
  const pb = b.p as Pt;
  let lo = a.s;
  let plo = pa;
  let hi = b.s;
  let phi = pb;
  for (let i = 0; i < 20; i++) {
    const m = 0.5 * (lo + hi);
    const sm = sample(m);
    st.count++;
    if (!sm) {
      st.spent = true;
      return { isJump: false, mid: null };
    }
    if (!sm.p) return { isJump: true, mid: null };
    const d1 = distP(plo, sm.p);
    const d2 = distP(sm.p, phi);
    if (Math.max(d1, d2) < chord / 2) return { isJump: false, mid: { s: sm.s, p: sm.p } };
    if (d1 >= d2) {
      hi = m;
      phi = sm.p;
    } else {
      lo = m;
      plo = sm.p;
    }
  }
  return { isJump: true, mid: null };
}

/* ------------------------------ envelopes ------------------------------ */

type Clip = { readonly t: 'seg'; readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number } | {
  readonly t: 'ray';
  readonly fx: number;
  readonly fy: number;
  readonly dx: number;
  readonly dy: number;
};

type Member =
  | { readonly t: 'line'; readonly a: number; readonly b: number; readonly c: number; readonly clip: Clip | null }
  | { readonly t: 'circle'; readonly cx: number; readonly cy: number; readonly r: number };

function lineOf(ax: number, ay: number, bx: number, by: number): Member | null {
  const dx = bx - ax;
  const dy = by - ay;
  const n = Math.hypot(dx, dy);
  if (!(n > 0)) return null;
  return { t: 'line', a: dy / n, b: -dx / n, c: (dy * ax - dx * ay) / n, clip: null };
}

function isSegLike(v: unknown): v is { readonly a: Pt; readonly b: Pt } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return isPt(o['a']) && isPt(o['b']);
}

function isRayLike(v: unknown): v is { readonly from: Pt; readonly dir: Pt } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return isPt(o['from']) && isPt(o['dir']);
}

function isCircleLike(v: unknown): v is { readonly cx: number; readonly cy: number; readonly r: number } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['cx'] === 'number' && typeof o['cy'] === 'number' && typeof o['r'] === 'number';
}

function isLineLike(v: unknown): v is { readonly a: number; readonly b: number; readonly c: number } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['a'] === 'number' && typeof o['b'] === 'number' && typeof o['c'] === 'number';
}

function isRelationLike(v: unknown): v is { readonly poly?: { readonly xx: number; readonly xy: number; readonly yy: number; readonly x: number; readonly y: number; readonly c: number } } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['residual'] === 'function' && typeof o['test'] === 'function';
}

/** Reads one family member from a slice cell. `'bad'` is an unsupported family. */
function memberOf(cell: Cell, tol: number): Member | 'undef' | 'bad' | null {
  if (!cell.defined) return cell.reason === 'timeout' ? null : 'undef';
  const v = cell.value;
  if (isLineLike(v)) {
    const n = Math.hypot(v.a, v.b);
    if (!(n > 0)) return 'undef';
    return { t: 'line', a: v.a / n, b: v.b / n, c: v.c / n, clip: null };
  }
  if (isSegLike(v)) {
    const m = lineOf(v.a.x, v.a.y, v.b.x, v.b.y);
    if (!m || m.t !== 'line') return 'undef';
    return { ...m, clip: { t: 'seg', ax: v.a.x, ay: v.a.y, bx: v.b.x, by: v.b.y } };
  }
  if (isRayLike(v)) {
    const m = lineOf(v.from.x, v.from.y, v.from.x + v.dir.x, v.from.y + v.dir.y);
    if (!m || m.t !== 'line') return 'undef';
    return { ...m, clip: { t: 'ray', fx: v.from.x, fy: v.from.y, dx: v.dir.x, dy: v.dir.y } };
  }
  if (isCircleLike(v)) {
    if (!(v.r > 0) || v.cx !== v.cx || v.cy !== v.cy || v.r !== v.r) return 'undef';
    return { t: 'circle', cx: v.cx, cy: v.cy, r: v.r };
  }
  if (isRelationLike(v) && v.poly) {
    const p = v.poly;
    const q = Math.max(Math.abs(p.xx), Math.abs(p.xy), Math.abs(p.yy));
    const l = Math.max(Math.abs(p.x), Math.abs(p.y), 1e-300);
    if (q <= tol * l) {
      const n = Math.hypot(p.x, p.y);
      if (!(n > 0)) return 'undef';
      return { t: 'line', a: p.x / n, b: p.y / n, c: -p.c / n, clip: null };
    }
    if (Math.abs(p.xx - p.yy) <= tol * Math.max(Math.abs(p.xx), 1e-300) && Math.abs(p.xy) <= tol * Math.abs(p.xx) && p.xx !== 0) {
      const cx = -p.x / (2 * p.xx);
      const cy = -p.y / (2 * p.xx);
      const r2 = (p.x * p.x + p.y * p.y) / (4 * p.xx * p.xx) - p.c / p.xx;
      if (!(r2 > 0) || cx !== cx || cy !== cy) return 'undef';
      return { t: 'circle', cx, cy, r: Math.sqrt(r2) };
    }
    return 'bad';
  }
  return 'bad';
}

function inClip(clip: Clip, p: Pt, tol: number): boolean {
  if (clip.t === 'seg') {
    const dx = clip.bx - clip.ax;
    const dy = clip.by - clip.ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return false;
    const t = ((p.x - clip.ax) * dx + (p.y - clip.ay) * dy) / len2;
    return t >= -tol && t <= 1 + tol;
  }
  const len2 = clip.dx * clip.dx + clip.dy * clip.dy;
  if (len2 === 0) return false;
  return ((p.x - clip.fx) * clip.dx + (p.y - clip.fy) * clip.dy) / len2 >= -tol;
}

/**
 * Sweeps an envelope over `[from, to]` (curves design 11). Derivatives wrt the mover
 * are 5-point central differences with step `1e-4` of the range. Circle families
 * produce one sweep per branch. Deterministic.
 */
export function sweepEnvelope(
  setup: SweepSetup,
  from: number,
  to: number,
  tol: number,
): Fallible<{ readonly pieces: readonly (readonly Pt[])[]; readonly spent: boolean; readonly capped: boolean }> {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const h = Math.max((hi - lo) * 1e-4, 1e-12 * Math.max(1, Math.abs(lo), Math.abs(hi)));
  const run = setup.run;
  const memberAt = (s: number): Member | 'undef' | 'bad' | null => {
    const cells = run([s]);
    return memberOf(cells[0] as Cell, tol);
  };
  const first = memberAt(lo + (hi - lo) / 2);
  if (first === null) return { ok: true, value: { pieces: [], spent: true, capped: false } };
  if (first === 'bad') {
    return fail('unsupported_family', 'Envelope handles lines, segments, rays and circles. Other families are not supported.');
  }
  if (first === 'undef') {
    // The middle is undefined; find a defined member to learn the family kind.
    let kind: Member['t'] | null = null;
    for (let i = 0; i <= 16; i++) {
      const m = memberAt(lo + ((hi - lo) * i) / 16);
      if (m === null) return { ok: true, value: { pieces: [], spent: true, capped: false } };
      if (m !== 'undef' && m !== 'bad') {
        kind = m.t;
        break;
      }
      if (m === 'bad') return fail('unsupported_family', 'Envelope handles lines, segments, rays and circles. Other families are not supported.');
    }
    if (!kind) return { ok: true, value: { pieces: [], spent: false, capped: false } };
    return sweepEnvelopeKind(setup, from, to, tol, h, kind);
  }
  return sweepEnvelopeKind(setup, from, to, tol, h, first.t);
}

function sweepEnvelopeKind(
  setup: SweepSetup,
  from: number,
  to: number,
  tol: number,
  h: number,
  kind: Member['t'],
): Fallible<{ readonly pieces: readonly (readonly Pt[])[]; readonly spent: boolean; readonly capped: boolean }> {
  const run = setup.run;
  const memberAt = (s: number): Member | 'undef' | 'bad' | null => {
    const cells = run([s]);
    return memberOf(cells[0] as Cell, tol);
  };
  const stencil = (s: number): { readonly m2: Member; readonly m1: Member; readonly c: Member; readonly p1: Member; readonly p2: Member } | 'undef' | 'bad' | null => {
    const m2 = memberAt(s - 2 * h);
    const m1 = memberAt(s - h);
    const c = memberAt(s);
    const p1 = memberAt(s + h);
    const p2 = memberAt(s + 2 * h);
    for (const m of [m2, m1, c, p1, p2]) {
      if (m === null) return null;
      if (m === 'bad' || (typeof m === 'object' && m.t !== kind)) return 'bad';
      if (m === 'undef') return 'undef';
    }
    return { m2: m2 as Member, m1: m1 as Member, c: c as Member, p1: p1 as Member, p2: p2 as Member };
  };
  const linePoint = (s: number): Pt | 'undef' | 'bad' | null => {
    const st = stencil(s);
    if (st === null || st === 'undef' || st === 'bad') return st;
    const L = (m: Member): readonly [number, number, number] => (m.t === 'line' ? [m.a, m.b, m.c] : [0, 0, 0]);
    const [a2, b2, c2] = L(st.m2);
    const [a1, b1, cc1] = L(st.m1);
    const [a, b, c] = L(st.c);
    const [a3, b3, cc3] = L(st.p1);
    const [a4, b4, cc4] = L(st.p2);
    // 5-point derivatives; members were normalised per sample, which the differences absorb.
    const da = (-a4 + 8 * a3 - 8 * a1 + a2) / (12 * h);
    const db = (-b4 + 8 * b3 - 8 * b1 + b2) / (12 * h);
    const dc = (-cc4 + 8 * cc3 - 8 * cc1 + c2) / (12 * h);
    const det = a * db - da * b;
    if (!(Math.abs(det) > tol * Math.max(1, Math.abs(a * db), Math.abs(da * b)))) return 'undef';
    const p = { x: (c * db - dc * b) / det, y: (a * dc - da * c) / det };
    if (p.x !== p.x || p.y !== p.y) return 'undef';
    const clip = st.c.t === 'line' ? st.c.clip : null;
    if (clip && !inClip(clip, p, tol)) return 'undef';
    return p;
  };
  const circlePoints = (s: number): readonly [Pt | null, Pt | null] | 'undef' | 'bad' | null => {
    const st = stencil(s);
    if (st === null || st === 'undef' || st === 'bad') return st;
    const C = (m: Member): readonly [number, number, number] => (m.t === 'circle' ? [m.cx, m.cy, m.r] : [0, 0, 0]);
    const [x2, y2, r2] = C(st.m2);
    const [x1, y1, r1] = C(st.m1);
    const [cx, cy, r] = C(st.c);
    const [x3, y3, r3] = C(st.p1);
    const [x4, y4, r4] = C(st.p2);
    const dx = (-x4 + 8 * x3 - 8 * x1 + x2) / (12 * h);
    const dy = (-y4 + 8 * y3 - 8 * y1 + y2) / (12 * h);
    const dr = (-r4 + 8 * r3 - 8 * r1 + r2) / (12 * h);
    // Line `(x - cx) dx + (y - cy) dy + r dr = 0` meets the circle.
    // In shifted coords u = x - cx: A u + B v = -r dr.
    const rhs = -r * dr;
    const n2 = dx * dx + dy * dy;
    if (!(n2 > 0)) return 'undef';
    const n = Math.sqrt(n2);
    const dist = rhs / n;
    if (Math.abs(dist) > r * (1 + tol)) return [null, null];
    const ux = (dx * rhs) / n2;
    const uy = (dy * rhs) / n2;
    const along = Math.sqrt(Math.max(0, r * r - dist * dist));
    const tx = -dy / n;
    const ty = dx / n;
    const pA = { x: cx + ux + tx * along, y: cy + uy + ty * along };
    const pB = { x: cx + ux - tx * along, y: cy + uy - ty * along };
    if (along <= tol * Math.max(1, r)) return [pA, null];
    // Branches apart by the sign of the cross product with the centre velocity.
    const cross = (p: Pt): number => (p.x - cx) * dy - (p.y - cy) * dx;
    return cross(pA) >= 0 ? [pA, pB] : [pB, pA];
  };
  if (kind === 'line') {
    let bad = false;
    const sample = (s: number): SweepSample | null => {
      const p = linePoint(s);
      if (p === null) return null;
      if (p === 'bad') {
        bad = true;
        return { s, p: null };
      }
      if (p === 'undef') return { s, p: null };
      return { s, p };
    };
    const out = sweepProvider(sample, from, to, null);
    if (bad) return fail('unsupported_family', 'Envelope handles lines, segments, rays and circles. Other families are not supported.');
    return { ok: true, value: out };
  }
  const outs: (readonly Pt[])[][] = [];
  let spent = false;
  let capped = false;
  let bad = false;
  for (const branch of [0, 1] as const) {
    const sample = (s: number): SweepSample | null => {
      const ps = circlePoints(s);
      if (ps === null) return null;
      if (ps === 'bad') {
        bad = true;
        return { s, p: null };
      }
      if (ps === 'undef') return { s, p: null };
      const p = ps[branch];
      return { s, p };
    };
    const out = sweepProvider(sample, from, to, null);
    spent = spent || out.spent;
    capped = capped || out.capped;
    outs.push([...out.pieces]);
  }
  if (bad) return fail('unsupported_family', 'Envelope handles lines, segments, rays and circles. Other families are not supported.');
  return { ok: true, value: { pieces: outs.flat(), spent, capped } };
}

/* ------------------------------ algebraic fit ------------------------------ */

function chebRow(x: number, d: number, out: Float64Array): void {
  out[0] = 1;
  if (d >= 1) out[1] = x;
  for (let n = 2; n <= d; n++) out[n] = 2 * x * (out[n - 1] as number) - (out[n - 2] as number);
}

interface NullOut {
  readonly vec: Float64Array | null;
  readonly tinyCount: number;
  /** Smallest taken pivot and the largest entry (for the separation check). */
  readonly minTaken: number;
  readonly gmax: number;
}

/**
 * One-dimensional nullspace of the symmetric `k x k` Gram matrix by Gauss-Jordan.
 * A column is free when its best pivot is at most `1e-13` of the largest entry
 * (elimination on the squared system cannot see the docs' `1e-22`; the separation
 * check and the held-out verification keep the fit honest). Null when the nullity
 * is not exactly 1.
 */
function nullspace1(g: Float64Array, k: number): NullOut {
  let gmax = 0;
  for (let i = 0; i < k * k; i++) {
    const v = Math.abs(g[i] as number);
    if (v > gmax) gmax = v;
  }
  if (!(gmax > 0)) return { vec: null, tinyCount: k, minTaken: 0, gmax };
  const tiny = 1e-13 * gmax;
  const m = Float64Array.from(g);
  const where = new Array<number>(k).fill(-1);
  let row = 0;
  let minTaken = Infinity;
  for (let col = 0; col < k && row < k; col++) {
    let sel = -1;
    let best = tiny;
    for (let i = row; i < k; i++) {
      const v = Math.abs(m[i * k + col] as number);
      if (v > best) {
        best = v;
        sel = i;
      }
    }
    if (sel === -1) continue;
    if (best < minTaken) minTaken = best;
    for (let j = col; j < k; j++) {
      const t = m[sel * k + j] as number;
      m[sel * k + j] = m[row * k + j] as number;
      m[row * k + j] = t;
    }
    where[col] = row;
    const inv = 1 / (m[row * k + col] as number);
    for (let j = col; j < k; j++) m[row * k + j] = (m[row * k + j] as number) * inv;
    for (let i = 0; i < k; i++) {
      if (i === row) continue;
      const f = m[i * k + col] as number;
      if (f === 0) continue;
      for (let j = col; j < k; j++) m[i * k + j] = (m[i * k + j] as number) - f * (m[row * k + j] as number);
    }
    row++;
  }
  const free: number[] = [];
  for (let col = 0; col < k; col++) if (where[col] === -1) free.push(col);
  if (free.length !== 1) return { vec: null, tinyCount: free.length, minTaken, gmax };
  const vec = new Float64Array(k);
  vec[free[0] as number] = 1;
  for (let col = 0; col < k; col++) {
    const r = where[col] as number;
    if (r !== -1) vec[col] = -(m[r * k + (free[0] as number)] as number);
  }
  return { vec, tinyCount: 1, minTaken, gmax };
}

/** Power-basis coefficients of T_0..T_d by the recurrence (for the printed equation). */
function chebPower(d: number): number[][] {
  const t: number[][] = [[1], [0, 1]];
  for (let n = 2; n <= d; n++) {
    const prev = t[n - 1] as number[];
    const prev2 = t[n - 2] as number[];
    const cur = new Array<number>(n + 1).fill(0);
    for (let i = 0; i < prev.length; i++) cur[i + 1] = 2 * (prev[i] as number);
    for (let i = 0; i < prev2.length; i++) cur[i] = (cur[i] as number) - (prev2[i] as number);
    t.push(cur);
  }
  return t;
}

function binomial(n: number, k: number): number {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

function rationalText(v: number): string {
  if (v === 0) return '0';
  const sign = v < 0 ? '-' : '';
  const x = Math.abs(v);
  if (Number.isInteger(x)) return `${sign}${x}`;
  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let b = x;
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > 1000000) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (Math.abs(x - h1 / k1) < 1e-9 * Math.max(1, x)) break;
    const frac = b - a;
    if (frac < 1e-12) break;
    b = 1 / frac;
  }
  if (k1 === 1) return `${sign}${h1}`;
  const dec = x.toPrecision(6).replace(/\.?0+$/, '');
  const frac = `${h1}/${k1}`;
  return sign + (frac.length <= dec.length + 2 ? frac : dec);
}

/** Formats `poly = 0` in graded order, for example `x^2 - 8 y = 0`. */
function equationText(poly: readonly Coef2[]): string {
  const terms = [...poly].filter((t) => t.c !== 0).sort((p, q) => q.i + q.j - (p.i + p.j) || q.i - p.i);
  if (terms.length === 0) return '0 = 0';
  let out = '';
  terms.forEach((t, idx) => {
    const neg = t.c < 0;
    const mag = rationalText(Math.abs(t.c));
    const mag1 = mag === '1' && (t.i > 0 || t.j > 0);
    const vars = `${t.i === 0 ? '' : t.i === 1 ? 'x' : `x^${t.i}`}${t.j === 0 ? '' : t.j === 1 ? 'y' : `y^${t.j}`}`;
    const core = `${mag1 ? '' : mag}${mag1 || vars === '' ? '' : ' '}${vars}`;
    if (idx === 0) out = neg ? `-${core}` : core;
    else out += neg ? ` - ${core}` : ` + ${core}`;
  });
  return `${out} = 0`;
}

export interface AlgebraicFit {
  readonly poly: readonly Coef2[];
  readonly text: string;
  readonly f: (x: number, y: number) => number;
  readonly degree: number;
}

/**
 * Fits the lowest-degree polynomial (degree <= 8) vanishing on `pts`, verified on
 * `heldOut` (curves design 10). Coordinates are scaled to `[-1, 1]` and expanded in
 * a Chebyshev basis for conditioning. Deterministic.
 */
export function fitAlgebraic(pts: readonly Pt[], heldOut: readonly Pt[], tol: number): Fallible<AlgebraicFit> {
  if (pts.length < 10) return fail('degenerate_points', 'The locus covers too little of the curve to fit an equation.');
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sx = Math.max((maxX - minX) / 2, 1e-300);
  const sy = Math.max((maxY - minY) / 2, 1e-300);
  const sc = (p: Pt): readonly [number, number] => [(p.x - cx) / sx, (p.y - cy) / sy];
  let sawDegenerate = false;
  for (let d = 1; d <= 8; d++) {
    const terms: [number, number][] = [];
    for (let i = 0; i <= d; i++) for (let j = 0; j <= d - i; j++) terms.push([i, j]);
    const k = terms.length;
    if (pts.length <= k) continue;
    const tx = new Float64Array(d + 1);
    const ty = new Float64Array(d + 1);
    // Gram matrix of the Chebyshev-Vandermonde matrix.
    const gram = new Float64Array(k * k);
    const basis = new Float64Array(k);
    for (const p of pts) {
      const [x, y] = sc(p);
      chebRow(x, d, tx);
      chebRow(y, d, ty);
      for (let t = 0; t < k; t++) {
        const [i, j] = terms[t] as [number, number];
        basis[t] = (tx[i] as number) * (ty[j] as number);
      }
      for (let i = 0; i < k; i++) for (let j = i; j < k; j++) gram[i * k + j] = (gram[i * k + j] as number) + (basis[i] as number) * (basis[j] as number);
    }
    for (let i = 0; i < k; i++) for (let j = 0; j < i; j++) gram[i * k + j] = gram[j * k + i] as number;
    const ns = nullspace1(gram, k);
    if (!ns.vec) {
      if (ns.tinyCount > 1 && d <= 4) sawDegenerate = true;
      continue;
    }
    // Separation: the second-smallest direction must be well determined (docs'
    // 1e-7, squared for the Gram matrix and loosened for elimination rounding).
    if (!(ns.minTaken > 1e-11 * ns.gmax)) {
      if (d <= 4) sawDegenerate = true;
      continue;
    }
    // Normalise before verifying, so an ill-conditioned direction cannot pass on a huge bound.
    const raw = ns.vec;
    let cmax = 0;
    for (let t = 0; t < k; t++) if (Math.abs(raw[t] as number) > cmax) cmax = Math.abs(raw[t] as number);
    if (!(cmax > 0)) continue;
    const c = Float64Array.from(raw, (v) => v / cmax);
    // Verify on the held-out points.
    const bound = 1e-9 * (1 + k);
    let ok = heldOut.length >= 20;
    for (const p of heldOut) {
      const [x, y] = sc(p);
      chebRow(x, d, tx);
      chebRow(y, d, ty);
      let r = 0;
      for (let t = 0; t < k; t++) {
        const [i, j] = terms[t] as [number, number];
        r += (c[t] as number) * (tx[i] as number) * (ty[j] as number);
      }
      if (!(Math.abs(r) <= bound)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // Convert to the power basis in original coordinates.
    const tp = chebPower(d);
    const acc = new Map<string, number>();
    const add = (i: number, j: number, v: number): void => {
      const key = `${i},${j}`;
      acc.set(key, (acc.get(key) ?? 0) + v);
    };
    for (let t = 0; t < k; t++) {
      const [bi, bj] = terms[t] as [number, number];
      const cc = c[t] as number;
      if (cc === 0) continue;
      const px = tp[bi] as number[];
      const py = tp[bj] as number[];
      for (let i = 0; i < px.length; i++) {
        if (px[i] === 0) continue;
        for (let j = 0; j < py.length; j++) {
          if (py[j] === 0) continue;
          // ((X - cx)/sx)^i ((Y - cy)/sy)^j expanded by the binomial theorem.
          for (let u = 0; u <= i; u++) {
            for (let v = 0; v <= j; v++) {
              const coef = cc * (px[i] as number) * (py[j] as number) * binomial(i, u) * binomial(j, v) *
                Math.pow(-cx, i - u) * Math.pow(-cy, j - v) / (Math.pow(sx, i) * Math.pow(sy, j));
              add(u, v, coef);
            }
          }
        }
      }
    }
    let largest = 0;
    for (const v of acc.values()) if (Math.abs(v) > largest) largest = Math.abs(v);
    if (!(largest > 0)) continue;
    const kept: Coef2[] = [];
    for (const [key, v] of acc) {
      const w = v / largest;
      if (Math.abs(w) <= tol) continue;
      const [i, j] = key.split(',').map(Number) as [number, number];
      kept.push({ i, j, c: w });
    }
    // The equation is written with leading coefficient 1 (curves design 10): the leading term is the one of highest
    // total degree, and among those the one with the highest power of x.
    let lead: Coef2 | undefined;
    for (const t of kept) {
      if (!lead || t.i + t.j > lead.i + lead.j || (t.i + t.j === lead.i + lead.j && t.i > lead.i)) lead = t;
    }
    const scale = lead ? lead.c : 1;
    const poly: Coef2[] = kept.map((t) => ({ i: t.i, j: t.j, c: t.c / scale }));
    const f = (x: number, y: number): number => {
      let s = 0;
      for (const t of poly) s += t.c * Math.pow(x, t.i) * Math.pow(y, t.j);
      return s;
    };
    return { ok: true, value: { poly, text: equationText(poly), f, degree: d } };
  }
  if (sawDegenerate) return fail('degenerate_points', 'The locus covers too little of the curve to fix one equation.');
  return fail('no_algebraic_equation', 'No polynomial of degree 8 or less vanishes on this locus.');
}

/** Builds the sampled curve value from sweep pieces, flagging closed loops. */
export function toSampledCurve(pieces: readonly (readonly Pt[])[], origin: SampledCurveData['origin']): SampledCurveData {
  const flat: Float64Array[] = [];
  const closed: boolean[] = [];
  const singles: Pt[] = [];
  for (const piece of pieces) {
    if (piece.length < 2) {
      if (piece.length === 1) singles.push(piece[0] as Pt);
      continue;
    }
    const arr = new Float64Array(piece.length * 2);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    piece.forEach((p, i) => {
      arr[2 * i] = p.x;
      arr[2 * i + 1] = p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    const d = Math.max(Math.hypot(maxX - minX, maxY - minY), 1e-300);
    const first = piece[0] as Pt;
    const last = piece[piece.length - 1] as Pt;
    closed.push(distP(first, last) <= 1e-9 * d);
    flat.push(arr);
  }
  if (flat.length === 0 && singles.length > 0) {
    // The sweep collapsed to isolated points: keep them as one piece.
    const ded: Pt[] = [];
    for (const q of singles) {
      const last = ded[ded.length - 1];
      if (!last || last.x !== q.x || last.y !== q.y) ded.push(q);
    }
    const arr = new Float64Array(ded.length * 2);
    ded.forEach((q, i) => {
      arr[2 * i] = q.x;
      arr[2 * i + 1] = q.y;
    });
    flat.push(arr);
    closed.push(false);
  }
  return { kind: 'curve', curve: 'sampled', pieces: flat, closed, origin };
}
