/**
 * Budgets (performance design 5, graphics-view errors.md 6). Over-budget
 * lines are refused with `limit`; over-budget scenes shed load with a notice.
 */
import { okResult, viewError, viewNotice } from '../errors';
import type { Notice, Result } from '@incantly/kernel';

export interface BudgetLimits {
  /** Objects per figure. */
  readonly objects: number;
  /** Points and particles per figure. */
  readonly pointsAndParticles: number;
  readonly particlesPerSystem: number;
  /** Triangles per 3D figure. */
  readonly triangles: number;
  readonly curveSamplesPerCurve: number;
  readonly labelsShown: number;
  readonly labelChars: number;
  readonly exportSidePx: number;
  readonly svgElements: number;
}

export const DEFAULT_BUDGETS: BudgetLimits = {
  objects: 5000,
  pointsAndParticles: 50000,
  particlesPerSystem: 20000,
  triangles: 200000,
  curveSamplesPerCurve: 4000,
  labelsShown: 300,
  labelChars: 2000,
  exportSidePx: 16384,
  svgElements: 50000,
};

function limitErr(what: string, max: number, got: number): Result<never> {
  return viewError({
    kind: 'limit',
    messageKey: 'view.limit',
    params: { what, max, got },
    token: String(got),
    hint: 'The figure is full; remove something first.',
  });
}

/** Objects: the line is refused with `limit`. */
export function checkObjects(count: number, limits: BudgetLimits = DEFAULT_BUDGETS): Result<void> {
  if (count > limits.objects) return limitErr('objects per figure', limits.objects, count);
  return okResult(undefined);
}

/** Particles: per-system and per-figure caps refuse the line. */
export function checkParticles(
  systemCount: number,
  figureCount: number,
  limits: BudgetLimits = DEFAULT_BUDGETS,
): Result<void> {
  if (systemCount > limits.particlesPerSystem) {
    return limitErr('particles per system', limits.particlesPerSystem, systemCount);
  }
  if (figureCount > limits.pointsAndParticles) {
    return limitErr('points and particles per figure', limits.pointsAndParticles, figureCount);
  }
  return okResult(undefined);
}

/** Triangles: round solids get fewer facets, with a notice. */
export function checkTriangles(count: number, limits: BudgetLimits = DEFAULT_BUDGETS): Notice | null {
  if (count <= limits.triangles) return null;
  return viewNotice(
    'warning',
    'V101',
    `The figure holds ${count} triangles; round solids use fewer facets.`,
    { what: 'triangles', max: limits.triangles, got: count },
  );
}

/** Labels: the lowest-priority labels hide, with a notice. */
export function checkLabels(shown: number, limits: BudgetLimits = DEFAULT_BUDGETS): { hidden: number; notice: Notice | null } {
  if (shown <= limits.labelsShown) return { hidden: 0, notice: null };
  return {
    hidden: shown - limits.labelsShown,
    notice: viewNotice(
      'warning',
      'V102',
      `Showing ${limits.labelsShown} of ${shown} labels; the rest are hidden.`,
      { what: 'labels', max: limits.labelsShown, got: shown },
    ),
  };
}

/** Curve samples: the adaptive sampler stops refining at the cap. */
export function capCurveSamples(wanted: number, limits: BudgetLimits = DEFAULT_BUDGETS): number {
  return Math.min(wanted, limits.curveSamplesPerCurve);
}

/** Label text length: refused with `limit`. */
export function checkLabelChars(chars: number, limits: BudgetLimits = DEFAULT_BUDGETS): Result<void> {
  if (chars > limits.labelChars) return limitErr('label characters', limits.labelChars, chars);
  return okResult(undefined);
}
