/**
 * Plot errors. Every public function returns `Result<T>` and never throws.
 * Plot uses only the shared core kinds (`bad_argument` for invalid inputs,
 * `limit` for budgets above the hard caps, `internal` for faults), with the
 * catalogue codes those kinds already carry (`C004`, `K040`, `K999`), so no
 * registry entries are needed. See `docs/features/errors/design.md`.
 */
import type { ErrorObject, Recovery, Result } from '@incantly/kernel';
import { HARD_MAX_EVALS, HARD_MAX_SAMPLES, MAX_VIEW_AREA_PX, MAX_VIEW_SIDE_PX } from './contracts';
import type { ViewBox } from './contracts';

function fingerprintOf(kind: string, message: string): string {
  let h = 2166136261;
  const s = `plot:${kind}:${message}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `plot-${kind}-${(h >>> 0).toString(16)}`;
}

function fail(
  kind: 'bad_argument' | 'limit' | 'internal',
  code: string,
  caller: string,
  why: string,
  hint: string,
  limitName?: string,
): ErrorObject {
  const message = kind === 'internal' ? `Something went wrong inside ${caller}; nothing was changed.` : `${caller}: ${why}.`;
  const recovery: Recovery = kind === 'internal' ? 'skip' : 'rewrite';
  return {
    ok: false,
    committed: false,
    kind,
    code,
    phase: 'runtime-host',
    message,
    messageKey: `plot.${kind}`,
    params: limitName === undefined ? { caller, why } : { caller, why, limit: limitName },
    line: 1,
    col: 1,
    endCol: 1,
    token: '',
    expected: [],
    forms: [],
    hint,
    suggest: [],
    recovery,
    fingerprint: fingerprintOf(kind, message),
    severity: 'error',
  };
}

/** Invalid input to a plot call (a bad view, range or option). */
export function badArgument(caller: string, why: string, hint: string): ErrorObject {
  return fail('bad_argument', 'C004', caller, why, hint);
}

/** A budget above its hard cap. */
export function overLimit(caller: string, what: string, max: number, got: number): ErrorObject {
  return fail(
    'limit',
    'K040',
    caller,
    `that would exceed the limit of ${max} ${what} (got ${got})`,
    `Use a ${what} budget of at most ${max}.`,
    what,
  );
}

/** A fault inside the plotter (including a throwing callback); the caller retries nothing. */
export function internal(caller: string): ErrorObject {
  return fail('internal', 'K999', caller, '', 'Do not retry the same input; report it.');
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Checks the shared view shape; every tracer calls this first. */
export function checkView(caller: string, view: ViewBox): ErrorObject | undefined {
  if (typeof view !== 'object' || view === null) {
    return badArgument(caller, 'the view is missing', 'Pass a view with x0, x1, y0, y1, widthPx and heightPx.');
  }
  if (!isFiniteNumber(view.x0) || !isFiniteNumber(view.x1) || !(view.x0 < view.x1)) {
    return badArgument(caller, `the view needs finite x0 < x1 (got ${String(view.x0)}..${String(view.x1)})`, 'Pass a view with x0 < x1, both finite.');
  }
  if (!isFiniteNumber(view.y0) || !isFiniteNumber(view.y1) || !(view.y0 < view.y1)) {
    return badArgument(caller, `the view needs finite y0 < y1 (got ${String(view.y0)}..${String(view.y1)})`, 'Pass a view with y0 < y1, both finite.');
  }
  if (!isFiniteNumber(view.widthPx) || !isFiniteNumber(view.heightPx) || view.widthPx <= 0 || view.heightPx <= 0) {
    return badArgument(
      caller,
      `the view needs a positive pixel size (got ${String(view.widthPx)}x${String(view.heightPx)})`,
      'Pass widthPx and heightPx above 0.',
    );
  }
  if (view.widthPx > MAX_VIEW_SIDE_PX || view.heightPx > MAX_VIEW_SIDE_PX || view.widthPx * view.heightPx > MAX_VIEW_AREA_PX) {
    return overLimit(caller, 'view pixels', MAX_VIEW_AREA_PX, view.widthPx * view.heightPx);
  }
  const dpr = view.devicePixelRatio ?? 1;
  if (!isFiniteNumber(dpr) || dpr <= 0 || dpr > 4) {
    return badArgument(caller, `devicePixelRatio must be in (0, 4] (got ${String(view.devicePixelRatio)})`, 'Pass a devicePixelRatio between 0 (exclusive) and 4.');
  }
  return undefined;
}

/** Checks the shared sample/evaluation budgets. */
export function checkBudgets(
  caller: string,
  maxSamples: number | undefined,
  maxEvals: number | undefined,
): ErrorObject | undefined {
  if (maxSamples !== undefined && (!isFiniteNumber(maxSamples) || maxSamples < 16)) {
    return badArgument(caller, `maxSamples must be at least 16 (got ${String(maxSamples)})`, 'Pass a maxSamples of 16 or more.');
  }
  if (maxEvals !== undefined && (!isFiniteNumber(maxEvals) || maxEvals < 16)) {
    return badArgument(caller, `maxEvals must be at least 16 (got ${String(maxEvals)})`, 'Pass a maxEvals of 16 or more.');
  }
  if (maxSamples !== undefined && maxSamples > HARD_MAX_SAMPLES) {
    return overLimit(caller, 'samples', HARD_MAX_SAMPLES, maxSamples);
  }
  if (maxEvals !== undefined && maxEvals > HARD_MAX_EVALS) {
    return overLimit(caller, 'evaluations', HARD_MAX_EVALS, maxEvals);
  }
  return undefined;
}

/** Runs a tracer body, turning any fault (including a throwing callback) into `internal`. */
export function guard<T>(caller: string, body: () => Result<T>): Result<T> {
  try {
    return body();
  } catch {
    return internal(caller);
  }
}
