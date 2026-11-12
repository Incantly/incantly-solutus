/**
 * Traces (design 9; errors 2 and 6): actions and properties, sampling while playing, rebuilding on a seek, caps, gaps.
 */
import { describe, expect, it } from 'vitest';
import { MAX_TRACES, MAX_TRACE_POINTS, isTraced, playerOf, tracePoints, traceSnapshots } from '@incantly/kernel';
import type { Figure, ObjId } from '@incantly/kernel';
import { bad, fig, manualClock, ok } from './helpers';

const CIRCLE = ['@clock 0..60', 'P = (cos(t), sin(t))'];
const idOf = (f: Figure, name: string): ObjId => {
  const o = f.get(name);
  if (!o) throw new Error(`no object ${name}`);
  return o.id;
};
const pts = (f: Figure, name: string): number[] => Array.from(tracePoints(f, idOf(f, name)) ?? []);

describe('9.1 actions', () => {
  it('Trace(P) starts a trace that already holds the path up to now', () => {
    const f = fig(CIRCLE);
    playerOf(f).seek(1);
    ok(f.apply('Trace(P)'));
    const xy = pts(f, 'P');
    expect(xy.length / 2).toBe(61);
    expect(xy[0]).toBeCloseTo(1, 12);
    expect(xy.at(-2)).toBeCloseTo(Math.cos(1), 12);
  });
  it('Untrace(P) stops and forgets; ClearTrace(P) forgets and keeps tracing', () => {
    const f = fig(CIRCLE);
    const p = playerOf(f);
    p.seek(1);
    ok(f.apply('Trace(P)'));
    ok(f.apply('ClearTrace(P)'));
    expect(pts(f, 'P')).toHaveLength(0);
    expect(isTraced(f, idOf(f, 'P'))).toBe(true);
    ok(f.apply('Untrace(P)'));
    expect(isTraced(f, idOf(f, 'P'))).toBe(false);
  });
  it('Trace(P, seconds) keeps only the last seconds', () => {
    const f = fig(CIRCLE);
    playerOf(f).seek(10);
    ok(f.apply('Trace(P, 2)'));
    expect(pts(f, 'P').length / 2).toBe(121);
  });
  it('P with trace = true traces like Trace(P)', () => {
    const f = fig([...CIRCLE, 'P with trace = true, traceWindow = 1']);
    playerOf(f).seek(5);
    expect(pts(f, 'P').length / 2).toBe(61);
  });
});

describe('9.2 and errors 2: what can be traced', () => {
  it('a Number, Bool or Text is not_traceable, with a hint naming what can be', () => {
    const e = bad(fig(['n = 3']).apply('Trace(n)'), 'not_traceable');
    expect(e.hint).toMatch(/point/);
    bad(fig(['b = true']).apply('Trace(b)'), 'not_traceable');
  });
  it('a segment keeps snapshots of its value', () => {
    const f = fig(['@clock 0..10', 'A = (0, 0)', 'B = (cos(t), sin(t))', 's = Segment(A, B)']);
    playerOf(f).seek(1);
    ok(f.apply('Trace(s)'));
    expect((traceSnapshots(f, idOf(f, 's')) ?? []).length).toBe(31);
  });
  it('a window that is not a positive number is bad_trace_option', () => {
    bad(fig(CIRCLE).apply('Trace(P, -1)'), 'bad_trace_option');
  });
  it(`more than ${MAX_TRACES} traces is a limit error`, () => {
    const lines = ['@clock 0..10'];
    for (let k = 0; k <= MAX_TRACES; k++) lines.push(`Q${k} = (t, ${k})`);
    const f = fig(lines);
    for (let k = 0; k < MAX_TRACES; k++) ok(f.apply(`Trace(Q${k})`));
    bad(f.apply(`Trace(Q${MAX_TRACES})`), 'limit');
  });
});

describe('9.4 sampling while playing and on a seek', () => {
  it('each frame adds the samples since the last one, every 1/60 s', () => {
    const f = fig(CIRCLE);
    const clock = manualClock();
    const p = playerOf(f, clock);
    ok(f.apply('Trace(P)'));
    p.play();
    for (let k = 1; k <= 30; k++) {
      clock.set(k / 60);
      p.frame();
    }
    expect(pts(f, 'P').length / 2).toBe(31);
  });
  it('a seek back rebuilds the trace for the time before t', () => {
    const f = fig(CIRCLE);
    const p = playerOf(f);
    ok(f.apply('Trace(P)'));
    p.seek(3);
    p.seek(1);
    expect(pts(f, 'P').length / 2).toBe(61);
  });
  it('a long history without a window is thinned to the cap and keeps its whole shape', () => {
    const f = fig(['@clock 0..400', 'P = (cos(t), sin(t))']);
    const p = playerOf(f);
    ok(f.apply('Trace(P)'));
    p.seek(200);
    const n = pts(f, 'P').length / 2;
    expect(n).toBeLessThanOrEqual(MAX_TRACE_POINTS);
    expect(pts(f, 'P')[0]).toBeCloseTo(1, 12);
  });
  it('an undefined sample is a gap (NaN)', () => {
    const f = fig(['@clock 0..10', 'P = (t, sqrt(1 - t))']);
    const p = playerOf(f);
    ok(f.apply('Trace(P)'));
    p.seek(2);
    expect(pts(f, 'P').some((v) => Number.isNaN(v))).toBe(true);
  });
  it('traces are stored in maths coordinates', () => {
    const f = fig(['@clock 0..10', 'P = (100 t, 0)']);
    playerOf(f).seek(1);
    ok(f.apply('Trace(P)'));
    expect(pts(f, 'P').at(-2)).toBeCloseTo(100, 9);
  });
});
