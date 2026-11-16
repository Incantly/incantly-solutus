/** The exam profiles (app-modes design 3.7): each narrows the current mode and says what is blocked and watched. */
import type { ExamProfile, ExamProfileId } from './types';

const BLOCK_ALL = { share: true, export: true, fileOpen: true, fileSave: true, network: true, paste: true, clipboardImages: true } as const;
const WATCH_ALL = { focusLoss: true, fullscreenExit: true, visibilityHidden: true, multiWindow: true } as const;
const LOCK = ['angleUnit', 'rounding', 'language'];

/** Calculus and solving tools, which most written tests leave out. */
export const CALCULUS_TOOLS = [
  'Derivative', 'NDerivative', 'Integral', 'NIntegral', 'IntegralBetween', 'AreaUnder', 'Solve', 'Solutions', 'NSolve', 'NSolutions', 'CSolve', 'CSolutions',
  'Factor', 'Expand', 'Simplify', 'Limit', 'LimitAbove', 'LimitBelow', 'Taylor', 'TaylorPolynomial', 'PartialFractions',
];

export const EXAM_PROFILES: Readonly<Record<ExamProfileId, ExamProfile>> = Object.freeze({
  basic: {
    id: 'basic',
    title: 'exam.basic.title',
    rules: ['exam.rule.calculus', 'exam.rule.files', 'exam.rule.watch', 'exam.rule.honest'],
    restrict: { denyCommands: CALCULUS_TOOLS, features: { share: false, export: false, fileOps: false, cas: false } },
    lockSettings: LOCK,
    forceSettings: {},
    outputRules: [],
    block: BLOCK_ALL,
    watch: WATCH_ALL,
    durationMinutes: 60,
    flagAfter: { times: 2, seconds: 30 },
    keepFigure: false,
  },
  'no-calculator-tools': {
    id: 'no-calculator-tools',
    title: 'exam.noCalc.title',
    rules: ['exam.rule.calculus', 'exam.rule.symbolic', 'exam.rule.files', 'exam.rule.watch', 'exam.rule.honest'],
    restrict: {
      denyCommands: [...CALCULUS_TOOLS, 'Root', 'Roots', 'Extremum', 'Maximum', 'Minimum', 'Inflection', 'Intersect'],
      features: { share: false, export: false, fileOps: false, cas: false, suggestions: false },
    },
    lockSettings: LOCK,
    forceSettings: {},
    outputRules: ['decimals-only', 'no-symbolic'],
    block: BLOCK_ALL,
    watch: WATCH_ALL,
    durationMinutes: 60,
    flagAfter: { times: 2, seconds: 30 },
    keepFigure: false,
  },
  'graphing-only': {
    id: 'graphing-only',
    title: 'exam.graphingOnly.title',
    rules: ['exam.rule.graphingOnly', 'exam.rule.files', 'exam.rule.watch', 'exam.rule.honest'],
    restrict: { hideViews: ['sheet', 'cas', 'script', 'datalab'], features: { share: false, export: false, fileOps: false, cas: false, scripting: false, sheet: false } },
    lockSettings: LOCK,
    forceSettings: {},
    outputRules: [],
    block: BLOCK_ALL,
    watch: WATCH_ALL,
    durationMinutes: 90,
    flagAfter: { times: 3, seconds: 60 },
    keepFigure: false,
  },
  custom: {
    id: 'custom',
    title: 'exam.custom.title',
    rules: ['exam.rule.files', 'exam.rule.watch', 'exam.rule.honest'],
    restrict: { features: { share: false, export: false, fileOps: false } },
    lockSettings: LOCK,
    forceSettings: {},
    outputRules: [],
    block: BLOCK_ALL,
    watch: WATCH_ALL,
    flagAfter: { times: 2, seconds: 30 },
    keepFigure: true,
  },
});
