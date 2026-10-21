import type { Ease, MotionHelpers, Vec2 } from '../api/types';
import { SceneApiError } from '../scene/errors';
import { EASINGS } from '../runtime/tween';

/**
 * Calm, time-based motion (MO-1, BR-8). Every helper is a pure function of
 * time or of the previous state and dt, so it stops when the figure pauses,
 * runs at the same pace on every device, and is still under reduced motion.
 */

const ease = (k: number, name: Ease = 'inOut'): number => {
  const fn = EASINGS[name];
  if (!fn) throw new SceneApiError(`Unknown easing "${String(name)}"`);
  return fn(Math.min(1, Math.max(0, k)));
};

/** Moves `current` toward `target`, covering half the gap every `halfLife` seconds. */
function follow(current: number, target: number, dt: number, halfLife = 0.15): number {
  if (!(halfLife > 0) || !(dt > 0)) return dt > 0 ? target : current;
  return target + (current - target) * 2 ** (-dt / halfLife);
}

/** A damped spring toward `target`; returns [position, velocity]. Stable at any frame rate. */
function spring(position: number, velocity: number, target: number, dt: number, options: { readonly stiffness?: number; readonly damping?: number } = {}): Vec2 {
  const k = options.stiffness ?? 120;
  const c = options.damping ?? 14;
  let x = position;
  let v = velocity;
  const steps = Math.min(64, Math.max(1, Math.ceil(dt / (1 / 240))));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
  }
  return [x, v];
}

/** Loops through `values`: holds each for `hold` seconds, then eases to the next over `move` seconds. */
function tour(time: number, values: readonly number[], options: { readonly hold?: number; readonly move?: number; readonly ease?: Ease } = {}): number {
  if (!Array.isArray(values) || values.length === 0) throw new SceneApiError('motion.tour needs a list of values');
  if (values.length === 1) return values[0]!;
  const hold = Math.max(0, options.hold ?? 1.5);
  const move = Math.max(0.01, options.move ?? 1);
  const period = hold + move;
  const t = ((time % (period * values.length)) + period * values.length) % (period * values.length);
  const index = Math.floor(t / period);
  const within = t - index * period;
  const from = values[index]!;
  const to = values[(index + 1) % values.length]!;
  return within < hold ? from : from + (to - from) * ease((within - hold) / move, options.ease ?? 'inOut');
}

/** A smooth swing from 0 to 1 and back every `period` seconds. */
function wave(time: number, period = 2): number {
  if (!(period > 0)) throw new SceneApiError('motion.wave needs a positive period');
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * time) / period);
}

export const motion: MotionHelpers = Object.freeze({ follow, spring, tour, ease, wave });
