/**
 * Loci (points-lines 8): sweep a free number, re-run the rules between it and
 * the tracer with the kernel slice, collect the tracer into a sampled curve.
 * The (tracer, mover) form needs slice-from-a-path support the kernel lacks.
 */
import type { CommandRule } from '../../graph/registry';
import type { ObjId } from '../../contracts/values';
import type { V2 } from './types';
import { isPt } from './types';
import { isSaneNum } from './numerics';
import { rule } from './points';
import { openPathSlice, sweepLocus } from '../functions/locus';

/** Locus(Q, s, from, to) with s a free number. */
export const locusSweepRule: CommandRule = rule((call) => {
  const from0 = call.values[2] as number;
  const to0 = call.values[3] as number;
  if (!isSaneNum(from0) || !isSaneNum(to0)) return undefined;
  const lo = Math.min(from0, to0);
  const hi = Math.max(from0, to0);
  const tracer = call.ids[0] as ObjId | undefined;
  const source = call.ids[1] as ObjId | undefined;
  if (tracer === undefined) return call.fail('no_dependency', 'the tracer must be a named object');
  if (source === undefined) return call.fail('no_dependency', 'the sweep needs a free number');
  const slice = call.slice(source, tracer);
  if ('ok' in slice && !slice.ok) {
    return call.fail('no_dependency', slice.kind === 'not_free' ? 'the sweep number must be free' : 'the tracer does not depend on the sweep number');
  }
  if (!('chain' in slice) || slice.chain.length === 0) {
    return call.fail('no_dependency', 'the tracer does not depend on the sweep number');
  }
  const run = (vs: number[]): Array<{ defined: boolean; value?: unknown }> =>
    (slice.run(vs) as Array<{ defined: boolean; value?: unknown }>);
  // Coarse sweep.
  const N0 = 64;
  const params: number[] = [];
  for (let i = 0; i <= N0; i++) params.push(lo + ((hi - lo) * i) / N0);
  if (!call.work.spend(params.length)) return call.fail('timeout');
  const coarse = run(params);
  const pts = coarse.map((c) => (c.defined && isPt(c.value) ? (c.value as V2) : undefined));
  // Scale from the coarse bounding box (the rule cannot see the figure extent).
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (!p) continue;
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const scale = Math.max(1, x1 - x0, y1 - y0);
  const tolDev = 0.0025 * scale;
  // Adaptive refinement per interval; undefined boundaries by bisection.
  interface Sample {
    s: number;
    p?: V2;
  }
  const refined: Sample[] = [];
  let total = 0;
  const CAP = 4000;
  const evalAt = (s: number): V2 | undefined => {
    if (total >= CAP || !call.work.spend(1)) return undefined;
    total++;
    const [c] = run([s]) as Array<{ defined: boolean; value?: unknown }>;
    return c && c.defined && isPt(c.value) ? (c.value as V2) : undefined;
  };
  total = params.length;
  const pushInterval = (s0: number, p0: V2 | undefined, s1: number, p1: V2 | undefined, depth: number): void => {
    if (p0 && p1) {
      if (depth >= 8 || total >= CAP) {
        refined.push({ s: s0, p: p0 });
        return;
      }
      const mid = (s0 + s1) / 2;
      const pm = evalAt(mid);
      if (!pm) {
        // Boundary inside: bisect from both sides.
        const b0 = bisectEnd(s0, true);
        const b1 = bisectEnd(s1, false);
        refined.push({ s: s0, p: p0 });
        if (b0) refined.push(b0);
        refined.push({ s: Number.NaN });
        if (b1) refined.push(b1);
        return;
      }
      const dev = Math.abs((pm.x - p0.x) * (p1.y - p0.y) - (pm.y - p0.y) * (p1.x - p0.x)) / (Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1);
      if (dev <= tolDev) {
        refined.push({ s: s0, p: p0 });
        return;
      }
      pushInterval(s0, p0, mid, pm, depth + 1);
      pushInterval(mid, pm, s1, p1, depth + 1);
      return;
    }
    if (p0 && !p1) {
      refined.push({ s: s0, p: p0 });
      const b = bisectEnd(s0, true);
      if (b) refined.push(b);
      refined.push({ s: Number.NaN });
      return;
    }
    if (!p0 && p1) {
      const b = bisectEnd(s1, false);
      if (b) refined.push(b);
      return;
    }
  };
  const bisectEnd = (edge: number, forward: boolean): Sample | undefined => {
    // 20 bisection steps toward the undefined side.
    let a = edge;
    let b = forward ? hi : lo;
    let pa = evalAt(a);
    if (!pa) return undefined;
    for (let i = 0; i < 20; i++) {
      const mid = (a + b) / 2;
      const pm = evalAt(mid);
      if (pm) {
        a = mid;
        pa = pm;
      } else {
        b = mid;
      }
    }
    return { s: a, p: pa };
  };
  for (let i = 0; i < N0; i++) {
    pushInterval(params[i] as number, pts[i], params[i + 1] as number, pts[i + 1], 0);
  }
  const last = pts[N0];
  if (last) refined.push({ s: params[N0] as number, p: last });
  // Assemble pieces (NaN breaks).
  const pieces: V2[][] = [];
  let cur: V2[] = [];
  for (const s of refined) {
    if (!s.p) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
      continue;
    }
    cur.push(s.p);
  }
  if (cur.length > 1) pieces.push(cur);
  if (pieces.length === 0 && cur.length === 1) pieces.push(cur);
  const closed =
    pieces.length === 1 &&
    (pieces[0] as V2[]).length > 2 &&
    Math.hypot(
      ((pieces[0] as V2[])[0] as V2).x - ((pieces[0] as V2[])[(pieces[0] as V2[]).length - 1] as V2).x,
      ((pieces[0] as V2[])[0] as V2).y - ((pieces[0] as V2[])[(pieces[0] as V2[]).length - 1] as V2).y,
    ) <= 1e-9 * scale;
  return { tag: 'geomCurve', pieces, closed };
});

/**
 * Locus(Q, P) over a point on a path: P goes along its whole path and Q is traced. The sweep is the functions area's
 * (the kernel slice with `override`, fed the path's points); the result is a geometry curve.
 */
export const locusMoverRule: CommandRule = rule((call) => {
  const tracer = call.ids[0] as ObjId | undefined;
  const mover = call.ids[1] as ObjId | undefined;
  if (tracer === undefined || mover === undefined) return call.fail('no_dependency', 'Locus needs the names of the traced point and the moving point.');
  const open = openPathSlice(call, mover, tracer);
  if (!open.ok) return call.fail(open.reason, open.detail);
  const sw = sweepLocus(open.value.setup, open.value.path.lo, open.value.path.hi);
  if (sw.spent && sw.pieces.every((piece) => piece.length < 2)) return call.fail('timeout');
  const pieces = sw.pieces.filter((piece) => piece.length > 0).map((piece) => piece.map((q) => ({ x: q.x, y: q.y })));
  const first = pieces.length === 1 ? (pieces[0] as V2[]) : undefined;
  const a = first?.[0];
  const b = first?.[first.length - 1];
  let scale = 1;
  for (const piece of pieces) for (const q of piece) scale = Math.max(scale, Math.abs(q.x), Math.abs(q.y));
  const closed = first !== undefined && first.length > 2 && a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9 * scale;
  return { tag: 'geomCurve', pieces, closed };
});
