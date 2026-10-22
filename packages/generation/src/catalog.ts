/**
 * The capability catalog: what a plan may ask for, one line each for the
 * model, and the declarations of the SDK's own type contract the scene call
 * receives for each. Capabilities are kit features, never concepts: a plan
 * picks from this list, and the plan validator rejects anything else. The
 * lines are terse on purpose: the catalog is in every call.
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

const STAGE = ['StageOptions', 'ElementOptions', 'EquationOptions', 'Shade', 'Layer', 'Stage', 'PartOptions', 'Handle', 'PathHandle', 'TextHandle', 'PolylineHandle', 'Group'];
const DRAG = ['DragInfo', 'DragMap', 'Values'];
const SPACE = ['Vec3', 'Mat3', 'CameraOptions', 'View3D', 'Object3D', 'Group3D', 'Line3DOptions', 'Line3D', 'Arrow3D', 'Label3D', 'PartOptions'];

export const CAPABILITIES: readonly Capability[] = [
  // Stages: every plan has at least one.
  {
    name: 'graph2d',
    draws: true,
    line: 'graph2d: graphs of y=f(x), parametric, polar and implicit curves, scatter, bars, histograms, areas, fields, points, arrows, trails, tracing, draggable handles, roots, log axes (inc.graph2d).',
    contract: [
      'GraphOptions',
      'CurveOptions',
      'PlotFunction',
      'PointsSource',
      'ValuesSource',
      'Bound',
      'SeriesOptions',
      'BarOptions',
      'HistogramOptions',
      'FieldOptions',
      'HandleOptions',
      'Graph',
      'GraphCurve',
      'GraphPoint',
      'GraphSegment',
      'GraphArrow',
      'GraphTrail',
      'GraphMark',
      ...DRAG,
      ...STAGE,
    ],
  },
  {
    name: 'svg',
    draws: true,
    line: 'svg: a diagram in your own units: groups, paths, lines, circles, rects, text, equations as maths, connectors and callouts, copies, dot clouds, flowing fluids, shading, dragging (inc.svg).',
    contract: [...STAGE, 'GeometryAttribute', 'AttributeValues', 'ConnectorOptions', 'CalloutOptions', 'DotsOptions', 'Dots', 'FluidOptions', 'Fluid', ...DRAG],
  },
  {
    name: 'space3d',
    draws: true,
    line: 'space3d: a 3D scene the learner turns (inc.space3d): models (rocket, beaker, car…), solids, lathes, tubes, coils, meshes, arrows, angle arcs, labels, grids, axes, field lines, dot clouds, dragging.',
    contract: ['Space3DOptions', 'Solid3DOptions', 'Mesh3DData', 'LatheOptions', 'ModelName', 'ModelOptions', 'Model3D', 'GridOptions', 'AxesOptions', 'FieldLineOptions', 'Space3D', ...SPACE, ...DRAG, ...STAGE],
  },
  {
    name: 'graph3d',
    draws: true,
    line: 'graph3d: a 3D graph the learner turns; surfaces z=f(x,y), parametric surfaces and curves, points, vectors, planes, contours, cross-sections (inc.graph3d).',
    contract: ['Graph3DOptions', 'SurfaceOptions', 'ParametricSurfaceOptions', 'Curve3DOptions', 'Surface3D', 'Graph3D', ...SPACE, 'Stage'],
  },
  {
    name: 'physics2d',
    draws: true,
    line: 'physics2d: 2D physics in metres: balls, boxes, ramps, springs, ropes, rods, hinges, pulleys, liquids, charges, magnets, live force arrows, energy, dragging (inc.physics2d).',
    contract: [
      'Live',
      'Physics2DOptions',
      'BodyOptions',
      'JointOptions',
      'SpringJointOptions',
      'HingeOptions',
      'TankOptions',
      'ForceKind',
      'ForceArrowOptions',
      'Body2D',
      'Joint2D',
      'Tank2D',
      'Energy',
      'World2D',
      ...STAGE,
    ],
  },
  {
    name: 'chart',
    draws: true,
    line: 'chart: bar, line, area, stacked, pie, histogram, box and scatter charts with live data, legends and reference lines (inc.chart).',
    contract: ['ChartKind', 'ChartOptions', 'ChartData', 'ChartSeriesOptions', 'ChartSeries', 'Chart', ...STAGE],
  },
  {
    name: 'flow',
    draws: true,
    line: 'flow: a flowchart or state diagram that lays itself out; nodes, labelled edges, an active node (inc.flow).',
    contract: ['FlowOptions', 'FlowNodeOptions', 'FlowEdgeOptions', 'FlowNode', 'FlowEdge', 'Flow', ...STAGE],
  },
  {
    name: 'chemistry',
    draws: true,
    line: 'chemistry: atoms, bonds and molecules from formulas with real geometry, lone pairs, partial charges, electron shells, reactions acted out with bond energies, energy profiles (inc.chemistry).',
    contract: [
      'ChemistryOptions',
      'AtomOptions',
      'Atom',
      'BondOptions',
      'Bond',
      'MoleculeStructure',
      'MoleculeOptions',
      'Molecule',
      'ShellOptions',
      'Shells',
      'ReactionOptions',
      'ReactionEnergy',
      'Reaction',
      'ProfileOptions',
      'Profile',
      'Chemistry',
      ...STAGE,
    ],
  },
  {
    name: 'biology',
    draws: true,
    line: "biology: animal, plant and bacterial cells with organelles, diffusion and active transport across a membrane, DNA's double helix, flows along vessels (inc.biology).",
    contract: ['BiologyOptions', 'CellKind', 'Organelle', 'CellOptions', 'Cell', 'MembraneOptions', 'Membrane', 'HelixOptions', 'Helix', 'StreamOptions', 'Stream', 'Biology', ...STAGE],
  },
  // Controls and time.
  {
    name: 'controls',
    draws: false,
    line: 'controls: switches, choices, colour pickers, buttons, presets and linked parameters (inc.toggle, choice, color, button, presets, link).',
    contract: ['ToggleOptions', 'Toggle', 'ChoiceOptions', 'Choice', 'ColorOptions', 'ColorParam', 'Values'],
  },
  {
    name: 'simulate',
    draws: false,
    line: 'simulate: fixed-step simulation for your own equations, and a timed cycle with progress (inc.simulate, inc.timeline).',
    contract: ['SimulateOptions', 'TimelineOptions'],
  },
  {
    name: 'state',
    draws: false,
    line: 'state: named values beside the parameters, and hooks for reset, parameter changes and steps (inc.state, onReset, onParamChange, onStep).',
    contract: ['StateValue', 'State'],
  },
  {
    name: 'tween',
    draws: false,
    line: 'tween: an eased change over scene time, queued one after another (inc.tween).',
    contract: ['TweenOptions', 'Ease'],
  },
  {
    name: 'idle',
    draws: false,
    line: 'idle: gently sweeps one parameter while nobody touches the figure (inc.idle).',
    contract: ['IdleOptions'],
  },
  // Teaching.
  {
    name: 'readout',
    draws: false,
    line: 'readout: live, labelled values computed from the model (inc.readout).',
    contract: [],
  },
  {
    name: 'explain',
    draws: false,
    line: 'explain: one sentence explaining the current state, from the model (inc.explain).',
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
    line: 'steps: two to five teaching steps; each says one thing, may focus a part and set parameters (inc.steps).',
    contract: ['Step'],
  },
  {
    name: 'table',
    draws: false,
    line: 'table: a live table of values beside the drawing (inc.table).',
    contract: ['TableOptions'],
  },
  {
    name: 'predict',
    draws: false,
    line: 'predict: the learner predicts before a reveal (inc.predict).',
    contract: ['PredictOptions'],
  },
  {
    name: 'compare',
    draws: false,
    line: 'compare: keeps a faint copy of the curves to compare against after a change (inc.compare).',
    contract: [],
  },
  {
    name: 'formula',
    draws: false,
    line: 'formula: a maths expression bound to parameters, shown as maths, optionally editable by the learner; call it as f(x, t) (inc.formula).',
    contract: ['Formula', 'FormulaOptions'],
  },
  // Helpers: no stage of their own.
  {
    name: 'calc',
    draws: false,
    line: 'calc: derivatives, integrals, roots, extrema, interpolation, Euler and RK4 steps, the normal distribution (inc.calc).',
    contract: ['Extremum', 'Rate', 'Calculus'],
  },
  {
    name: 'vec',
    draws: false,
    line: 'vec: 2D and 3D vectors and 3x3 rotation matrices (inc.vec).',
    contract: ['Vec3', 'Mat3', 'VectorHelpers'],
  },
  {
    name: 'units',
    draws: false,
    line: 'units: values formatted with units, and unit conversion (inc.units).',
    contract: ['Units'],
  },
  {
    name: 'motion',
    draws: false,
    line: 'motion: calm motion; follow, damped spring, looping tour, easing, wave (inc.motion).',
    contract: ['SpringOptions', 'TourOptions', 'Ease', 'MotionHelpers'],
  },
  {
    name: 'shapes',
    draws: false,
    line: 'shapes: path data for springs, resistors, coils, waves, gears, belts, lenses, cells, circuit symbols, tanks, braces, blobs, polygons (inc.shapes).',
    contract: ['ShapeHelpers'],
  },
  {
    name: 'symbols',
    draws: false,
    line: 'symbols: labels with sub and superscripts, Greek letters and chemical formulas (inc.sym, inc.chem).',
    contract: [],
  },
  {
    name: 'path',
    draws: false,
    line: 'path: path data for polylines, sampled curves that break at discontinuities, parametric curves, arcs and arrows (inc.path).',
    contract: ['PathHelpers'],
  },
  {
    name: 'geometry',
    draws: false,
    line: 'geometry: points, midpoints, distances, lines, intersections and clipping to a box (inc.geom).',
    contract: ['GeometryHelpers', 'Point', 'Line', 'Segment', 'Bounds'],
  },
  {
    name: 'random',
    draws: false,
    line: 'random: a seeded random number in [0, 1); the same sequence on every run (inc.random).',
    contract: [],
  },
];

/** Declarations every scene call receives: parameters, the model, frames and the inc object. */
export const CORE_CONTRACT: readonly string[] = ['Tone', 'Readable', 'Vec2', 'ViewBox', 'ParamOptions', 'Param', 'ParamValues', 'Model', 'FrameInfo', 'PanelLayout', 'Inc'];

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
