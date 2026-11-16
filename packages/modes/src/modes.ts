/**
 * The mode table (app-modes design 3.2, 3.2.1, 3.2.2): one record per mode, plain data. Adding a mode adds a record;
 * nothing else changes. Command groups are the `group` values of the command table.
 */
import type { AppModeId, ExpressionPolicy, FeatureFlags, ModeConfig, ModeDefaults, UiOptions } from './types';

/** Every command group the command table has today, with the kernel's own actions (`figure`, `batch`). */
export const COMMAND_GROUPS = [
  'figure', 'batch', 'geometry', 'conics', 'polygons', 'transforms', 'functions', 'lists', 'matrices', 'stats', 'charts',
  'fits', 'probability', 'distributions', 'random', 'symbolic', 'text', 'logic', 'controls', 'animation', 'rounding',
  'size', 'colour', 'vector', 'trig', 'space', 'sound',
] as const;

const ALL_EXPRESSIONS: ExpressionPolicy = {
  functions: 'all', operators: 'all', allowImplicitEquations: true, allowTextObjects: true, allowLists: true, allowStates: true, allowParticles: true,
};

const NO_FEATURES: FeatureFlags = {
  sheet: false, cas: false, threeD: false, scripting: false, inputBar: false, menu: false, fileOps: false, share: false, export: false,
  suggestions: false, ansButton: false, statistics: false, clockBar: false, undoRedo: true, pageSet: false,
};

const BASE_DEFAULTS: ModeDefaults = {
  angleUnit: 'radian',
  rounding: { mode: 'decimals', digits: 2 },
  view: { x0: -10, x1: 10, y0: -6, y1: 6, keepRatio: true },
  axes: true,
  grid: 'major',
  autoSliders: false,
  autoLabels: 'points',
  pointStyle: 'dot',
  pointSize: 5,
  lineWidth: 3,
  dragDependent: false,
  previewPoints: false,
  greekAngleLabels: false,
  equationForm: 'explicit',
  coordinates: 'cartesian',
};

const UI_ALL: UiOptions = { menu: true, toolbar: true, algebra: true, inputBar: true, zoomButtons: true, fullscreenButton: true };

const SETTINGS_COMMON = ['angleUnit', 'rounding', 'coordinates', 'undoLimit', 'language', 'decimalSeparator', 'reducedMotion', 'highContrast', 'textScale', 'screenReaderMode', 'keyboard', 'keyboardLayout', 'theme', 'masterVolume', 'soundOnStart'];
const SETTINGS_GRAPHICS = ['axes', 'grid', 'keepRatio', 'snapToGrid', 'pointSnap', 'showLabels', 'defaultLineWidth', 'defaultPointSize', 'fontSize'];
const SETTINGS_ALGEBRA = ['sort', 'description'];

const EXAM_ALL = { allowed: true, profiles: ['basic', 'no-calculator-tools', 'graphing-only', 'custom'] } as const;

const figure: ModeConfig = {
  id: 'figure',
  title: 'mode.figure.title',
  purpose: 'mode.figure.purpose',
  stage: 1,
  available: true,
  views: { available: ['graphics', 'clock'], initial: ['graphics', 'clock'], layout: 'single', canToggle: false },
  tools: { groups: ['move'], toolbar: 'none', add: ['move-view'], customTools: false },
  commands: { allow: 'all' },
  expressions: ALL_EXPRESSIONS,
  defaults: { ...BASE_DEFAULTS, grid: 'none' },
  features: { ...NO_FEATURES, clockBar: true },
  keyboard: 'standard',
  settings: ['reducedMotion', 'highContrast', 'textScale', 'screenReaderMode', 'language', 'theme'],
  ui: { menu: false, toolbar: false, algebra: false, inputBar: false, zoomButtons: true, fullscreenButton: true },
  exam: { allowed: false, profiles: [] },
};

const graphing: ModeConfig = {
  id: 'graphing',
  title: 'mode.graphing.title',
  purpose: 'mode.graphing.purpose',
  stage: 1,
  available: true,
  views: { available: ['graphics', 'algebra', 'sheet', 'datalab'], initial: ['algebra', 'graphics'], layout: 'split', canToggle: true },
  tools: { groups: ['move', 'point', 'line', 'general'], toolbar: 'compact', add: ['tangents', 'slider'], deny: ['polyline', 'segment-fixed-length'], customTools: false },
  commands: {
    allow: ['figure', 'batch', 'functions', 'lists', 'stats', 'charts', 'fits', 'tests', 'text', 'logic', 'controls', 'animation', 'rounding', 'size', 'trig', 'random', 'sound'],
    add: ['Point', 'PointOn', 'Midpoint', 'Line', 'Segment', 'Ray', 'Vector', 'Intersect', 'Tangent', 'Slope', 'Distance', 'Circle', 'Polygon', 'Area', 'Reflect', 'Translate'],
  },
  expressions: ALL_EXPRESSIONS,
  defaults: { ...BASE_DEFAULTS, autoSliders: true, autoLabels: 'new-points-only' },
  features: { ...NO_FEATURES, inputBar: true, menu: true, fileOps: true, share: true, export: true, suggestions: true, statistics: true, clockBar: true },
  keyboard: 'standard',
  settings: [...SETTINGS_COMMON, ...SETTINGS_GRAPHICS, ...SETTINGS_ALGEBRA],
  ui: UI_ALL,
  exam: EXAM_ALL,
};

const geometry: ModeConfig = {
  id: 'geometry',
  title: 'mode.geometry.title',
  purpose: 'mode.geometry.purpose',
  stage: 2,
  available: true,
  views: { available: ['graphics', 'algebra'], initial: ['graphics'], layout: 'single', canToggle: true },
  tools: { groups: ['move', 'point', 'line', 'special-line', 'polygon', 'circle-arc', 'conic', 'measure', 'transform', 'action', 'general'], toolbar: 'full', customTools: false },
  commands: {
    allow: ['figure', 'batch', 'geometry', 'conics', 'polygons', 'transforms', 'lists', 'text', 'logic', 'controls', 'animation', 'rounding', 'size', 'trig', 'vector', 'sound'],
    add: ['Root', 'Roots', 'Extremum', 'Slope'],
  },
  expressions: { ...ALL_EXPRESSIONS, allowStates: true, allowParticles: true },
  defaults: {
    ...BASE_DEFAULTS, angleUnit: 'degree', axes: false, grid: 'none', autoLabels: 'all', dragDependent: true, previewPoints: true, greekAngleLabels: true,
    equationForm: 'implicit', view: { x0: -8, x1: 8, y0: -5, y1: 5, keepRatio: true },
  },
  features: { ...NO_FEATURES, menu: true, fileOps: true, share: true, export: true },
  keyboard: 'geometry',
  settings: [...SETTINGS_COMMON, ...SETTINGS_GRAPHICS, ...SETTINGS_ALGEBRA],
  ui: { ...UI_ALL, algebra: false, inputBar: false },
  exam: EXAM_ALL,
};

const classic: ModeConfig = {
  id: 'classic',
  title: 'mode.classic.title',
  purpose: 'mode.classic.purpose',
  stage: 2,
  available: true,
  views: { available: ['graphics', 'algebra', 'sheet', 'cas', 'datalab', 'distribution', 'script', 'clock'], initial: ['algebra', 'graphics'], layout: 'split', canToggle: true },
  tools: { groups: ['move', 'point', 'line', 'special-line', 'polygon', 'circle-arc', 'conic', 'measure', 'transform', 'action', 'general'], toolbar: 'full', customTools: true },
  commands: { allow: 'all' },
  expressions: ALL_EXPRESSIONS,
  defaults: { ...BASE_DEFAULTS, autoSliders: true, autoLabels: 'all', dragDependent: true },
  features: {
    sheet: true, cas: true, threeD: false, scripting: true, inputBar: true, menu: true, fileOps: true, share: true, export: true, suggestions: true,
    ansButton: false, statistics: true, clockBar: true, undoRedo: true, pageSet: false,
  },
  keyboard: 'standard',
  settings: [...SETTINGS_COMMON, ...SETTINGS_GRAPHICS, ...SETTINGS_ALGEBRA],
  ui: UI_ALL,
  exam: EXAM_ALL,
};

const scientific: ModeConfig = {
  id: 'scientific',
  title: 'mode.scientific.title',
  purpose: 'mode.scientific.purpose',
  stage: 2,
  available: true,
  views: { available: ['results'], initial: ['results'], layout: 'single', canToggle: false },
  tools: { groups: [], toolbar: 'none', customTools: false },
  commands: { allow: ['rounding', 'size', 'trig'], add: ['Mean', 'Median', 'Sum', 'StdDev', 'Min', 'Max', 'Product'] },
  expressions: { functions: 'all', operators: 'all', allowImplicitEquations: false, allowUserFunctions: false, allowTextObjects: false, allowLists: true, allowStates: false, allowParticles: false },
  defaults: { ...BASE_DEFAULTS, angleUnit: 'degree', rounding: { mode: 'sig', digits: 10 }, axes: false, grid: 'none', autoLabels: 'none' },
  features: { ...NO_FEATURES, ansButton: true },
  keyboard: 'scientific',
  settings: ['angleUnit', 'rounding', ...SETTINGS_COMMON.filter((s) => s !== 'angleUnit' && s !== 'rounding' && s !== 'coordinates')],
  ui: { menu: true, toolbar: false, algebra: false, inputBar: true, zoomButtons: false, fullscreenButton: false },
  exam: { allowed: true, profiles: ['basic', 'custom'] },
};

const probability: ModeConfig = {
  id: 'probability',
  title: 'mode.probability.title',
  purpose: 'mode.probability.purpose',
  stage: 2,
  available: true,
  views: { available: ['distribution', 'graphics', 'results', 'datalab'], initial: ['distribution', 'graphics'], layout: 'split', canToggle: true },
  tools: { groups: [], toolbar: 'none', customTools: false },
  commands: { allow: ['figure', 'batch', 'probability', 'distributions', 'stats', 'tests', 'fits', 'random', 'charts', 'lists', 'rounding', 'size', 'text'] },
  expressions: { ...ALL_EXPRESSIONS, allowImplicitEquations: false, allowStates: false, allowParticles: false },
  defaults: { ...BASE_DEFAULTS, rounding: { mode: 'decimals', digits: 4 } },
  features: { ...NO_FEATURES, statistics: true, menu: true, export: true },
  keyboard: 'probability',
  settings: ['rounding', ...SETTINGS_COMMON.filter((s) => s !== 'angleUnit' && s !== 'rounding' && s !== 'coordinates')],
  ui: { menu: true, toolbar: false, algebra: false, inputBar: false, zoomButtons: false, fullscreenButton: true },
  exam: { allowed: true, profiles: ['basic', 'custom'] },
};

const notes: ModeConfig = {
  id: 'notes',
  title: 'mode.notes.title',
  purpose: 'mode.notes.purpose',
  stage: 3,
  available: false,
  unavailableReason: 'The notes board is not part of this app yet.',
  views: { available: ['board'], initial: ['board'], layout: 'single', canToggle: false },
  tools: { groups: ['board'], toolbar: 'full', customTools: false },
  commands: { allow: [] },
  expressions: { functions: [], operators: [], allowImplicitEquations: false, allowTextObjects: true, allowLists: false, allowStates: false, allowParticles: false },
  defaults: { ...BASE_DEFAULTS, axes: false, grid: 'none' },
  features: { ...NO_FEATURES, menu: true, fileOps: true, share: true, export: true, pageSet: true },
  keyboard: 'notes',
  settings: SETTINGS_COMMON.filter((s) => !['angleUnit', 'rounding', 'coordinates'].includes(s)),
  ui: { ...UI_ALL, algebra: false, inputBar: false },
  exam: { allowed: false, profiles: [] },
};

const cas: ModeConfig = {
  id: 'cas',
  title: 'mode.cas.title',
  purpose: 'mode.cas.purpose',
  stage: 3,
  available: true,
  views: { available: ['cas', 'graphics', 'algebra', 'sheet'], initial: ['cas'], layout: 'split', canToggle: true },
  tools: { groups: ['move', 'point', 'line'], toolbar: 'compact', add: ['tangents', 'roots', 'extremum'], customTools: false },
  commands: { allow: 'all' },
  expressions: ALL_EXPRESSIONS,
  defaults: { ...BASE_DEFAULTS, rounding: { mode: 'sig', digits: 10 }, autoLabels: 'none', exact: true },
  features: { ...NO_FEATURES, cas: true, suggestions: true, export: true, menu: true, fileOps: true },
  keyboard: 'standard',
  settings: [...SETTINGS_COMMON, ...SETTINGS_GRAPHICS],
  ui: { ...UI_ALL, inputBar: false },
  exam: { allowed: true, profiles: ['basic', 'custom'] },
};

const graphing3d: ModeConfig = {
  id: 'graphing3d',
  title: 'mode.graphing3d.title',
  purpose: 'mode.graphing3d.purpose',
  stage: 3,
  available: false,
  unavailableReason: 'The 3D mode is not part of this app yet.',
  views: { available: ['graphics3d', 'algebra', 'graphics'], initial: ['algebra', 'graphics3d'], layout: 'split', canToggle: true },
  tools: { groups: ['move', 'space'], toolbar: 'full', customTools: false },
  commands: { allow: ['figure', 'batch', 'space', 'functions', 'geometry', 'transforms', 'lists', 'rounding', 'size', 'trig', 'vector'] },
  expressions: ALL_EXPRESSIONS,
  defaults: { ...BASE_DEFAULTS, autoSliders: true, dragDependent: true },
  features: { ...NO_FEATURES, threeD: true, inputBar: true, suggestions: true, clockBar: true, export: true, menu: true },
  keyboard: 'standard',
  settings: [...SETTINGS_COMMON, ...SETTINGS_GRAPHICS, ...SETTINGS_ALGEBRA],
  ui: UI_ALL,
  exam: { allowed: true, profiles: ['basic', 'custom'] },
};

/** The registry, in the order of the start screen. */
export const MODES: Readonly<Record<AppModeId, ModeConfig>> = Object.freeze({
  graphing, geometry, scientific, probability, cas, notes, classic, graphing3d, figure,
});

export const MODE_IDS = Object.keys(MODES) as AppModeId[];
