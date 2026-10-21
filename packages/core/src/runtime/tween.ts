import type { Ease, TweenOptions } from '../api/types';

export const EASINGS: Readonly<Record<Ease, (k: number) => number>> = {
  linear: (k) => k,
  in: (k) => k * k * k,
  out: (k) => 1 - (1 - k) ** 3,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  // A damped spring that overshoots a little and settles exactly at 1.
  spring: (k) => (k >= 1 ? 1 : 1 - Math.exp(-6 * k) * Math.cos(9 * k) * (1 - k)),
};

export interface TweenState {
  readonly options: TweenOptions;
  elapsed: number;
}

/** Advances the active tween by `dt` real seconds. Returns true when it completed. */
export function advanceTween(tween: TweenState, dt: number): { k: number; done: boolean } {
  tween.elapsed += dt;
  const duration = Math.max(0, tween.options.duration);
  const raw = duration === 0 ? 1 : Math.min(1, tween.elapsed / duration);
  const ease = EASINGS[tween.options.ease ?? 'inOut'] ?? EASINGS.inOut;
  return { k: ease(raw), done: raw >= 1 };
}
