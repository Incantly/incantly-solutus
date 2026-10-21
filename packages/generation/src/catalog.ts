/**
 * The capability catalog: what a plan may ask for, one line each for the
 * model, and the declarations of the SDK's own type contract the scene call
 * receives for each. Capabilities are kit features, never concepts: a plan
 * picks from this list, and the plan validator rejects anything else.
 */

export interface Capability {
  readonly name: string;
  /** The catalog line the model always sees. */
  readonly line: string;
  /** Declarations from packages/core/src/api/types.ts that the scene call needs for it. */
  readonly contract: readonly string[];
  /** Whether it gives the scene a stage to draw on. */
  readonly draws: boolean;
}

const STAGE = ['StageOptions', 'ElementOptions', 'Layer', 'Stage', 'PartOptions', 'Handle', 'PathHandle', 'TextHandle', 'PolylineHandle', 'Group'];

export const CAPABILITIES: readonly Capability[] = [
  {
    name: 'graph2d',
    draws: true,
    line: 'graph2d: a Cartesian graph with axes, grid and labels; plot y = f(x) or a parametric path, points, segments, arrows, trails and labels (inc.graph2d).',
    contract: ['GraphOptions', 'CurveOptions', 'PlotFunction', 'Graph', 'GraphCurve', 'GraphPoint', 'GraphSegment', 'GraphArrow', 'GraphTrail', ...STAGE],
  },
  {
    name: 'svg',
    draws: true,
    line: 'svg: a diagram stage in your own coordinates; group, path, line, circle, rect, text and polyline handles with change-only writes and transforms (inc.svg).',
    contract: [...STAGE, 'GeometryAttribute', 'AttributeValues'],
  },
  {
    name: 'path',
    draws: false,
    line: 'path: path data for svg paths: polylines, sampled curves that break at discontinuities, parametric curves, arcs and arrows (inc.path).',
    contract: ['PathHelpers'],
  },
  {
    name: 'geometry',
    draws: false,
    line: 'geometry: points, midpoints, distances, lines through two points, intersections and clipping to a box (inc.geom).',
    contract: ['GeometryHelpers', 'Point', 'Line', 'Segment', 'Bounds'],
  },
  {
    name: 'formula',
    draws: false,
    line: 'formula: an authored maths expression bound to parameters, whose source stays visible; call it as f(x, t) (inc.formula).',
    contract: ['Formula', 'FormulaOptions'],
  },
  {
    name: 'readout',
    draws: false,
    line: 'readout: live, labelled values computed from the model (inc.readout).',
    contract: [],
  },
  {
    name: 'explain',
    draws: false,
    line: 'explain: one sentence that explains the current state, computed from the model (inc.explain).',
    contract: [],
  },
  {
    name: 'describe',
    draws: false,
    line: 'describe: the text alternative, a function of the model; every scene has one (inc.describe).',
    contract: [],
  },
  {
    name: 'steps',
    draws: false,
    line: 'steps: two to five teaching steps; each says one thing, may focus a named part and may set parameters (inc.steps).',
    contract: ['Step'],
  },
  {
    name: 'tween',
    draws: false,
    line: 'tween: an eased change over scene time, for a one-off animation (inc.tween).',
    contract: ['TweenOptions', 'Ease'],
  },
  {
    name: 'random',
    draws: false,
    line: 'random: a seeded random number in [0, 1); the same sequence on every run (inc.random).',
    contract: [],
  },
];

/** Declarations every scene call receives: parameters, the model, frames and the inc object. */
export const CORE_CONTRACT: readonly string[] = ['Tone', 'Readable', 'Vec2', 'ViewBox', 'ParamOptions', 'Param', 'ParamValues', 'Model', 'FrameInfo', 'Inc'];

const BY_NAME = new Map(CAPABILITIES.map((c) => [c.name, c]));

export function capability(name: string): Capability | undefined {
  return BY_NAME.get(name);
}

export function capabilityNames(): string[] {
  return CAPABILITIES.map((c) => c.name);
}

/** The catalog as the model sees it: one line per capability. */
export function catalogText(): string {
  return CAPABILITIES.map((c) => `- ${c.line}`).join('\n');
}
