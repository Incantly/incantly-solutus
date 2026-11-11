/**
 * Slider animation as a pure function of the clock (numbers-sliders/design.md 3.4).
 *
 * No timer: the player advances t, and each tick writes `valueAt(t)` through the
 * kernel's animation write kind (`setFree(id, v, 'anim')`), which never enters undo
 * history. Replay, seek, frame drops and refresh rates never change the value.
 */

import type { ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import type { AngleUnit, AnimAnchor, LoopMode } from './types';
import { commit, unitScale } from './commit';
import type { CommitResult } from './commit';

const frac = (x: number): number => x - Math.floor(x);
const mod2 = (x: number): number => ((x % 2) + 2) % 2;

/**
 * Deterministic unit value in [0, 1) for one random-mode period. Mirrors the
 * language's rand(seed) hashing (float64 bits mixed to 32 bits), so the sequence
 * matches rand() for the same numeric input.
 */
export function animRandom(seed: number, periodIndex: number): number {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, seed * 1e6 + periodIndex, true);
  let h = dv.getUint32(0, true) ^ Math.imul(dv.getUint32(4, true), 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Position as a fraction of the sweep for sweeps elapsed s (negative s clamps to 0,
 * so seeking before the anchor shows v0). p0 is the anchor position as a fraction.
 */
export function animFraction(loop: LoopMode, p0: number, s: number, dir: 1 | -1): number {
  const ss = s < 0 ? 0 : s;
  const p = Math.min(1, Math.max(0, p0));
  switch (loop) {
    case 'up':
      return frac(p + ss);
    case 'down':
      return 1 - frac(1 - p + ss);
    case 'bounce': {
      const m = (dir > 0 ? p : 2 - p) + ss;
      const mp = mod2(m);
      return mp <= 1 ? mp : 2 - mp;
    }
    case 'once':
      return Math.min(1, p + ss);
    case 'random':
      return p;
  }
}

/** True when a `once` sweep has reached the top (a pure function of s). */
export function onceFinished(p0: number, s: number): boolean {
  return p0 + (s < 0 ? 0 : s) >= 1;
}

/** Instant at which a `once` sweep ends: t0 + period * (1 - p0). */
export function onceEndTime(period: number, t0: number, p0: number): number {
  return t0 + period * (1 - Math.min(1, Math.max(0, p0)));
}

/** Start direction for bounce: up, unless the value is already at the top. */
export function startDir(v0: number, lo: number, hi: number): 1 | -1 {
  return v0 >= hi && v0 > lo ? -1 : 1;
}

export interface AnimationValueOpts {
  readonly loop: LoopMode;
  /** Stored units (radians for angles). */
  readonly lo: number;
  readonly hi: number;
  readonly period: number;
  readonly anchor: AnimAnchor;
  readonly seed: number;
  /** Fixed step in stored units, or 'auto' for continuous motion. */
  readonly step: number | 'auto';
  readonly unit: AngleUnit | 'none';
  readonly t: number;
}

/**
 * The slider value at time t: lo + f*W in display space, converted back, then run
 * through `commit` with source 'animation' (fixed steps quantise, auto stays smooth).
 * Random mode holds the anchor value during the first period, then one new value
 * per period.
 */
export function animationValueAt(opts: AnimationValueOpts): CommitResult {
  const { loop, lo, hi, period, anchor, seed, step, unit, t } = opts;
  const scale = unitScale(unit);
  const ulo = lo / scale;
  const uhi = hi / scale;
  const w = uhi - ulo;
  const p0 = w > 0 ? (anchor.v0 / scale - ulo) / w : 0;
  const s = period > 0 ? (t - anchor.t0) / period : 0;
  let f: number;
  if (loop === 'random') {
    if (s < 1) return commit(anchor.v0, { lo, hi, step, unit, source: 'animation' });
    f = animRandom(seed, Math.floor(s));
  } else {
    f = animFraction(loop, p0, s, anchor.dir);
  }
  return commit((ulo + f * w) * scale, { lo, hi, step, unit, source: 'animation' });
}

/* ------------------------------ anchor store ------------------------------ */

interface FigureAnims {
  readonly live: Map<ObjId, AnimAnchor>;
  readonly paused: Map<ObjId, AnimAnchor>;
  lastT: number;
}

const stores = new WeakMap<Figure, FigureAnims>();

function animsFor(figure: Figure): FigureAnims {
  let s = stores.get(figure);
  if (!s) {
    s = { live: new Map(), paused: new Map(), lastT: 0 };
    stores.set(figure, s);
  }
  return s;
}

/** The live anchor of an object, if it is animating. */
export function getAnchor(figure: Figure, id: ObjId): AnimAnchor | undefined {
  return animsFor(figure).live.get(id);
}

/** Ids with a live anchor. */
export function animatingIds(figure: Figure): ObjId[] {
  return [...animsFor(figure).live.keys()];
}

/** The t of the last tick (draw-channel Animate anchors here; there is no clock getter). */
export function lastTickT(figure: Figure): number {
  return animsFor(figure).lastT;
}

export function setAnchor(figure: Figure, id: ObjId, anchor: AnimAnchor): void {
  const s = animsFor(figure);
  s.live.set(id, anchor);
  s.paused.delete(id);
}

export function clearAnchor(figure: Figure, id: ObjId): boolean {
  const s = animsFor(figure);
  s.paused.delete(id);
  return s.live.delete(id);
}

/** Pointer down on an animating slider: the anchor is dropped, the value stays. */
export function pauseAnimation(figure: Figure, id: ObjId): boolean {
  const s = animsFor(figure);
  const a = s.live.get(id);
  if (!a) return false;
  s.live.delete(id);
  s.paused.set(id, a);
  return true;
}

/** Pointer release: a new anchor at the current t and value (default resume = true). */
export function resumeAnimation(figure: Figure, id: ObjId, t: number, dir?: 1 | -1): boolean {
  const s = animsFor(figure);
  if (!s.paused.has(id)) return false;
  s.paused.delete(id);
  const v = figure.value(id);
  if (typeof v !== 'number') return false;
  const range = figure.get(id)?.range;
  const lo = range?.min ?? v;
  const hi = range?.max ?? v;
  s.live.set(id, { t0: t, v0: v, dir: dir ?? startDir(v, lo, hi) });
  return true;
}

export interface TickReport {
  /** Names written this tick. */
  readonly ticked: readonly string[];
  /** `once` sliders that have reached the top (their anchor is kept; the flag is derived). */
  readonly finished: readonly string[];
  /** Anchored sliders skipped because their range is currently undefined. */
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
}

function extOf(figure: Figure, id: ObjId, key: string): unknown {
  const view = figure.get(id);
  return view ? (view.style.ext as Record<string, unknown>)[key] : undefined;
}

function loopOf(figure: Figure, id: ObjId): LoopMode {
  const v = extOf(figure, id, 'loop');
  return v === 'up' || v === 'down' || v === 'once' || v === 'random' || v === 'bounce' ? v : 'bounce';
}

function periodOf(figure: Figure, id: ObjId): number {
  const v = extOf(figure, id, 'period');
  return typeof v === 'number' && v > 0 && Number.isFinite(v) ? v : 10;
}

function seedOf(figure: Figure, id: ObjId): number {
  const v = extOf(figure, id, 'seed');
  return typeof v === 'number' && Number.isInteger(v) ? v : 1;
}

function unitOf(figure: Figure, id: ObjId): AngleUnit | 'none' {
  const v = extOf(figure, id, 'unit');
  return v === 'rad' || v === 'deg' || v === 'turn' || v === 'grad' || v === 'none' ? v : 'none';
}

/**
 * One player tick: writes animationValueAt(t) for every anchored slider with the
 * animation write kind and runs one pass. Finished `once` sliders are written to
 * the top and reported; sliders whose range is undefined keep their anchor and
 * resume when the range returns. Never throws.
 */
export function tickAnimations(figure: Figure, t: number): TickReport {
  const s = animsFor(figure);
  if (typeof t === 'number' && Number.isFinite(t)) s.lastT = t;
  else t = s.lastT;
  const ticked: string[] = [];
  const finished: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const [id, anchor] of s.live) {
    const view = figure.get(id);
    if (!view) {
      s.live.delete(id);
      continue;
    }
    const range = view.range;
    if (!range) {
      skipped.push({ name: view.name, reason: 'range_undefined' });
      continue;
    }
    const loop = loopOf(figure, id);
    const period = periodOf(figure, id);
    const unit = unitOf(figure, id);
    const scale = unitScale(unit);
    const w = range.max / scale - range.min / scale;
    const p0 = w > 0 ? (anchor.v0 / scale - range.min / scale) / w : 0;
    const ss = period > 0 ? (t - anchor.t0) / period : 0;
    if (loop === 'once' && onceFinished(p0, ss)) {
      const r = commit(range.max, { lo: range.min, hi: range.max, step: range.step ?? 'auto', unit, source: 'animation' });
      if (r.ok) {
        const wr = figure.setFree(id, r.value, 'anim');
        if (wr.ok) ticked.push(view.name);
      }
      finished.push(view.name);
      continue;
    }
    const r = animationValueAt({
      loop,
      lo: range.min,
      hi: range.max,
      period,
      anchor,
      seed: seedOf(figure, id),
      step: range.step ?? 'auto',
      unit,
      t,
    });
    if (!r.ok) {
      skipped.push({ name: view.name, reason: r.reason });
      continue;
    }
    const wr = figure.setFree(id, r.value, 'anim');
    if (wr.ok) ticked.push(view.name);
    else skipped.push({ name: view.name, reason: 'locked' });
  }
  figure.flush();
  return { ticked, finished, skipped };
}
