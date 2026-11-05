import { FILM_SCENE_MAX_SECONDS } from './storyboard';

/**
 * Film length presets (video-figures.md PRD 28, ADR 009): 30 s and 1 min films
 * are one scene through today's pipeline; 2, 3 and 4 min films are several
 * scenes, one scene call each, in parallel.
 *
 * Every number below comes from the bench, not from a guess:
 * - scenes per length: about one scene per 30 to 60 s of film (ADR 009), with
 *   each scene capped at FILM_SCENE_MAX_SECONDS (60 s, bench: seek-by-replay
 *   stays under ~150 ms on the slowest supported iPad).
 * - plan cap: the figure plan call writes ~150 tokens; the film plan writes a
 *   storyboard of N scenes plus the shared context, measured at ~700 tokens
 *   per scene over the figure plan on the bench storyboard runs.
 * - deadlines: the bench's novel scene p50 is ~12 s written whole, the plan
 *   p50 ~3 s, repairs ~4 s each; a film's deadline is its plan plus its
 *   slowest scene plus one repair plus checks, within the 3-minute ceiling.
 */

export const FILM_LENGTH_PRESETS: readonly number[] = [30, 60, 120, 180, 240];

/** Tokens per storyboard scene over the figure plan cap, measured on the bench. */
export const FILM_PLAN_TOKENS_PER_SCENE = 700;

/** The figure plan cap the film plan builds on. */
export const FILM_PLAN_BASE_TOKENS = 1500;

/** The whole-film generation ceiling in milliseconds: three minutes. */
export const FILM_GENERATION_CEILING_MS = 180_000;

export interface FilmPreset {
  /** The length target in seconds: 30, 60, 120, 180 or 240. */
  readonly seconds: number;
  /** Scenes the storyboard holds for this length. */
  readonly scenes: number;
  /** Whole-film deadline in milliseconds, within the 3-minute ceiling. */
  readonly deadlineMs: number;
  /** The plan call's output cap in tokens for this length. */
  readonly planTokens: number;
}

/** Bench-measured whole-film deadlines per length, in milliseconds. */
const FILM_DEADLINES_MS: Readonly<Record<number, number>> = {
  30: 25_000,
  60: 45_000,
  120: 90_000,
  180: 135_000,
  240: 175_000,
};

/** Bench-derived scene counts per length: one scene per ~60 s of film. */
const FILM_SCENES: Readonly<Record<number, number>> = {
  30: 1,
  60: 1,
  120: 2,
  180: 3,
  240: 4,
};

/** Nearest preset at or above a length target, defaulting to the longest. */
export function filmPresetFor(lengthTarget: number): FilmPreset {
  const seconds = FILM_LENGTH_PRESETS.find((preset) => preset >= lengthTarget) ?? FILM_LENGTH_PRESETS[FILM_LENGTH_PRESETS.length - 1]!;
  const scenes = FILM_SCENES[seconds]!;
  return { seconds, scenes, deadlineMs: FILM_DEADLINES_MS[seconds]!, planTokens: FILM_PLAN_BASE_TOKENS + FILM_PLAN_TOKENS_PER_SCENE * scenes };
}

/** Scenes a length target maps to, within the cap. */
export function filmScenesFor(lengthTarget: number): number {
  return filmPresetFor(lengthTarget).scenes;
}

/** Whole-film deadline for a length target, within the 3-minute ceiling. */
export function filmDeadlineMs(lengthTarget: number): number {
  return filmPresetFor(lengthTarget).deadlineMs;
}

/** Plan-call output cap for a scene count, from the bench. */
export function filmPlanTokens(scenes: number): number {
  return FILM_PLAN_BASE_TOKENS + FILM_PLAN_TOKENS_PER_SCENE * Math.max(1, Math.min(scenes, 32));
}

/** Longest a scene may run: re-exported here so presets read as one table. */
export const FILM_PRESET_SCENE_MAX_SECONDS = FILM_SCENE_MAX_SECONDS;
