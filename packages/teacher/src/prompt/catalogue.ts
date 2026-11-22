/**
 * The command catalogue the model reads (teacher design 5): every form of every command the app mode allows, one line
 * a form, grouped by command group, built from the kernel's command table and filtered by the mode's policy so the
 * model never sees a command the gate would refuse. Cached per registry and mode.
 *
 * Past `ON_DEMAND_TOKENS` the groups load on demand: a mode's first groups, the groups the request needs, and a one-line
 * index of the rest. `withGroups` picks the groups that fit the room the caller gives it.
 */
import { err, formGroup, formText } from '@incantly/kernel';
import type { CommandRegistry, Result } from '@incantly/kernel';
import { MODES, catalogueOf, compilePolicy, filterCatalogue } from '@incantly/modes';
import { sdkRegistry } from '@incantly/sdk';
import { tokensOf } from './tokens';

/** Past this many tokens the catalogue loads its groups on demand (design 5). */
export const ON_DEMAND_TOKENS = 2000;
/** The tokens of the groups loaded before the request says what it needs. */
export const ALWAYS_TOKENS = 1800;
/** The commands the one-line index names for each group not loaded. */
const INDEX_NAMES = 4;

/** One line about each command group, for the index of the groups not loaded. */
const GROUP_NOTES: Readonly<Record<string, string>> = {
  figure: 'show, hide, delete and rename objects',
  batch: 'run several lines as one step',
  geometry: 'points, lines, segments, circles, angles, intersections, distances',
  conics: 'ellipses, parabolas, hyperbolas and other conics',
  polygons: 'polygons, regular shapes, areas and perimeters',
  transforms: 'reflect, rotate, translate and dilate',
  functions: 'plots, derivatives, integrals, roots, extrema, tangents, curves',
  lists: 'lists, sequences, sorting, sums, tables of values',
  matrices: 'matrices and linear algebra',
  stats: 'data, mean, median, spread, regression',
  charts: 'histograms, box plots, bar and pie charts',
  fits: 'curve fits and regression models',
  tests: 'hypothesis tests and intervals',
  probability: 'probability and counting',
  distributions: 'probability distributions',
  random: 'random numbers and samples (seeded)',
  symbolic: 'exact algebra: solve, simplify, factor, steps',
  text: 'texts, labels and readouts',
  logic: 'conditions and booleans',
  controls: 'sliders, buttons, checkboxes and readouts',
  animation: 'motion over time, traces, particles, paths',
  rounding: 'rounding and number formats',
  size: 'size and scale',
  colour: 'colours',
  vector: 'vectors and their operations',
  trig: 'trigonometry helpers',
  space: 'three-dimensional points, planes, solids and surfaces',
  sound: 'notes, tones and sound',
  sheet: 'spreadsheet cells, ranges and tables',
  physics: 'bodies, forces, joints, cloth, fire, smoke and liquid',
};

/** Words in a request that need a group (matched in the request's text, case-insensitive). */
const GROUP_WORDS: Readonly<Record<string, RegExp>> = {
  geometry: /\b(points?|lines?|segments?|rays?|circles?|triangles?|angles?|midpoints?|perpendicular|parallel|tangents?|intersect\w*|distance|bisector|vertex|vertices|radius|diameter)\b/i,
  conics: /\b(parabolas?|ellipses?|hyperbolas?|conics?|foci|focus|directrix)\b/i,
  polygons: /\b(polygons?|squares?|rectangles?|pentagons?|hexagons?|quadrilaterals?|areas?|perimeters?)\b/i,
  transforms: /\b(rotat\w*|reflect\w*|translat\w*|dilat\w*|transform\w*|mirror\w*|symmetr\w*)\b/i,
  functions: /\b(functions?|graphs?|plots?|curves?|derivatives?|integrals?|slopes?|roots?|zeros?|maxim\w*|minim\w*|extrem\w*|limits?|asymptotes?|area under|sine|cosine|parametric)\b|x\^|x²|sin\(|cos\(/i,
  lists: /\b(lists?|sequences?|tables?|sorted?|sums?|series)\b/i,
  matrices: /\b(matri(x|ces)|determinant|vectors? space|linear algebra)\b/i,
  stats: /\b(mean|median|mode|data|dataset|variance|standard deviation|regression|correlation|scatter)\b/i,
  charts: /\b(histograms?|box plots?|bar chart|pie chart|charts?)\b/i,
  fits: /\b(fit|fits|best fit|trend ?line)\b/i,
  probability: /\b(probabilit\w*|dice|coins?|combinations?|permutations?|odds)\b/i,
  distributions: /\b(normal|binomial|poisson|distributions?|bell curve)\b/i,
  random: /\b(random\w*|sample|simulat\w*)\b/i,
  symbolic: /\b(solve|simplify|factor\w*|expand|algebra\w*|equations?|steps?|exact)\b/i,
  text: /\b(text|labels?|captions?|titles?|readouts?)\b/i,
  controls: /\b(sliders?|buttons?|checkbox\w*|controls?)\b/i,
  animation: /\b(animat\w*|motion|moves?|moving|traces?|trail|paths?|loci|locus|orbits?|spins?|speed|time)\b/i,
  space: /\b(3d|three.dimensional|space|spheres?|cubes?|cones?|cylinders?|solids?|planes?|surfaces?)\b/i,
  sound: /\b(sounds?|notes?|tones?|music\w*|frequency|play)\b/i,
  sheet: /\b(sheets?|spreadsheets?|cells?)\b/i,
  physics: /\b(physics|pendulum|spring|ball|gravity|collisions?|bounc\w*|bod(y|ies)|cloth|fire|flames?|smoke|liquid|water|falls?|falling|force|friction|rope|pulley)\b/i,
};

/** Object types in the figure now, and the group each needs. */
const TYPE_GROUPS: Readonly<Record<string, string>> = {
  Body: 'physics',
  Body3: 'physics',
  Cloth: 'physics',
  Sound: 'sound',
  Point3: 'space',
  Matrix: 'matrices',
};

/** The groups a mode loads first, in order. The first always loads; the next while `ALWAYS_TOKENS` holds. */
const GEOMETRY_FIRST: readonly string[] = ['geometry', 'conics', 'polygons', 'controls', 'animation', 'text', 'logic'];
const FUNCTIONS_FIRST: readonly string[] = ['functions', 'controls', 'animation', 'geometry', 'text', 'logic'];
const GEOMETRY_MODES: ReadonlySet<string> = new Set(['geometry', 'figure', 'classic']);

export interface CatalogueGroup {
  readonly name: string;
  readonly note: string;
  /** The distinct command names, in table order. */
  readonly commands: readonly string[];
  /** One printed form a line. */
  readonly lines: readonly string[];
  /** Tokens of the lines (and the group's heading). */
  readonly tokens: number;
  /** Tokens of the group's line in the index of groups not loaded. */
  readonly indexTokens: number;
}

/** The groups chosen for one prompt. */
export interface Selection {
  /** Group names, in catalogue order. */
  readonly loaded: readonly string[];
  /** The catalogue text: the loaded groups, then the index of the rest. */
  readonly text: string;
  readonly tokens: number;
}

export interface Catalogue {
  readonly mode: string;
  readonly groups: readonly CatalogueGroup[];
  /** Tokens of every group's lines. */
  readonly tokens: number;
  /** True past `ON_DEMAND_TOKENS`: groups load on demand. */
  readonly onDemand: boolean;
  /** The groups a prompt loads before the request says what it needs. */
  readonly always: readonly string[];
  /** The group a command name belongs to (its first form's group), or undefined. */
  groupOf(command: string): string | undefined;
  /** The groups that `text` (a request) and the object `types` in the figure need, in catalogue order. */
  groupsFor(text: string, types?: readonly string[]): readonly string[];
  /**
   * The catalogue text with the always-loaded groups and the groups in `names` (most wanted first), as many as fit in
   * `room` tokens together with the index of the rest. Everything loads when the catalogue is not on demand.
   */
  withGroups(names?: readonly string[], room?: number): Selection;
}

const heading = (name: string): string => `# ${name}`;

function indexLine(name: string, note: string, commands: readonly string[]): string {
  return `- ${name}: ${note} (${commands.slice(0, INDEX_NAMES).join(', ')}${commands.length > INDEX_NAMES ? ', ...' : ''})`;
}

const INDEX_HEADING = 'MORE COMMAND GROUPS (not shown yet; write a command from one and its forms load on the next call):';

class CatalogueImpl implements Catalogue {
  readonly tokens: number;
  readonly onDemand: boolean;
  readonly always: readonly string[];
  private readonly byName: ReadonlyMap<string, CatalogueGroup>;
  private readonly ofCommand: ReadonlyMap<string, string>;
  private readonly title: string;

  constructor(
    readonly mode: string,
    readonly groups: readonly CatalogueGroup[],
  ) {
    this.byName = new Map(groups.map((g) => [g.name, g]));
    const ofCommand = new Map<string, string>();
    for (const g of groups) for (const c of g.commands) if (!ofCommand.has(c)) ofCommand.set(c, g.name);
    this.ofCommand = ofCommand;
    this.tokens = groups.reduce((n, g) => n + g.tokens, 0);
    this.onDemand = this.tokens > ON_DEMAND_TOKENS;
    this.always = this.onDemand ? pickAlways(mode, groups) : groups.map((g) => g.name);
    this.title = `COMMAND CATALOGUE (${mode} mode). One form a line: Name(param: Type, [optional]) -> Result.`;
  }

  groupOf(command: string): string | undefined {
    return this.ofCommand.get(command);
  }

  groupsFor(text: string, types: readonly string[] = []): readonly string[] {
    const need = new Set<string>();
    for (const [group, words] of Object.entries(GROUP_WORDS)) if (this.byName.has(group) && words.test(text)) need.add(group);
    for (const type of types) {
      const group = TYPE_GROUPS[type];
      if (group !== undefined && this.byName.has(group)) need.add(group);
    }
    return this.groups.filter((g) => need.has(g.name)).map((g) => g.name);
  }

  withGroups(names: readonly string[] = [], room: number = Number.POSITIVE_INFINITY): Selection {
    if (!this.onDemand) return this.render(this.groups.map((g) => g.name));
    const order = [...new Set([...names.filter((n) => this.byName.has(n)), ...this.always])];
    const loaded = new Set<string>();
    let used = tokensOf(this.title) + tokensOf(INDEX_HEADING);
    // every group starts in the index; loading one swaps its index line for its forms
    let indexCost = this.groups.reduce((n, g) => n + g.indexTokens, 0);
    for (const name of order) {
      const g = this.byName.get(name) as CatalogueGroup;
      const next = used + g.tokens;
      if (next + indexCost - g.indexTokens <= room) {
        loaded.add(name);
        used = next;
        indexCost -= g.indexTokens;
      }
    }
    return this.render(this.groups.filter((g) => loaded.has(g.name)).map((g) => g.name));
  }

  private render(loaded: readonly string[]): Selection {
    const have = new Set(loaded);
    const lines: string[] = [this.title];
    for (const g of this.groups) if (have.has(g.name)) lines.push(heading(g.name), ...g.lines);
    const rest = this.groups.filter((g) => !have.has(g.name));
    if (rest.length > 0) {
      lines.push(INDEX_HEADING);
      for (const g of rest) lines.push(indexLine(g.name, g.note, g.commands));
    }
    const text = lines.join('\n');
    return { loaded, text, tokens: tokensOf(text) };
  }
}

/** The first groups of a mode: the first always, the next while the always budget holds. */
function pickAlways(mode: string, groups: readonly CatalogueGroup[]): readonly string[] {
  const first = GEOMETRY_MODES.has(mode) ? GEOMETRY_FIRST : FUNCTIONS_FIRST;
  const have = new Map(groups.map((g) => [g.name, g]));
  const picked: string[] = [];
  let used = 0;
  for (const name of first) {
    const g = have.get(name);
    if (g === undefined) continue;
    if (picked.length > 0 && used + g.tokens > ALWAYS_TOKENS) continue;
    picked.push(name);
    used += g.tokens;
  }
  if (picked.length === 0 && groups[0] !== undefined) picked.push(groups[0].name);
  return picked;
}

const GROUP_ORDER: readonly string[] = [
  'geometry', 'conics', 'polygons', 'transforms', 'functions', 'symbolic', 'lists', 'matrices', 'stats', 'charts', 'fits', 'tests', 'probability',
  'distributions', 'random', 'text', 'logic', 'controls', 'animation', 'space', 'physics', 'sound', 'sheet', 'figure', 'batch',
];

const CACHE = new WeakMap<CommandRegistry, Map<string, Catalogue>>();

/**
 * The catalogue of an app mode over a command table (the SDK's table when none is given). Built once per table and
 * mode. An unknown mode is `bad_argument`.
 */
export function catalogueFor(mode: string, registry: CommandRegistry = sdkRegistry()): Result<Catalogue> {
  const cached = CACHE.get(registry)?.get(mode);
  if (cached !== undefined) return { ok: true, value: cached, notices: [] };
  if (!Object.hasOwn(MODES, mode)) {
    return err('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'catalogue', why: `There is no mode called ${mode}.` }, { token: mode, fingerprintKey: mode });
  }
  const config = MODES[mode as keyof typeof MODES];
  const specs = registry.all();
  const permitted = new Set(filterCatalogue(compilePolicy(config), catalogueOf(specs)).map((c) => `${c.name}\u0000${c.group}`));
  const lines = new Map<string, string[]>();
  const commands = new Map<string, string[]>();
  for (const spec of specs) {
    for (const form of spec.forms) {
      const group = formGroup(form) ?? spec.group;
      if (!permitted.has(`${spec.name}\u0000${group}`)) continue;
      const l = lines.get(group) ?? [];
      l.push(formText(spec.name, form));
      lines.set(group, l);
      const c = commands.get(group) ?? [];
      if (!c.includes(spec.name)) c.push(spec.name);
      commands.set(group, c);
    }
  }
  const names = [...lines.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? GROUP_ORDER.length : ia) - (ib < 0 ? GROUP_ORDER.length : ib) || a.localeCompare(b);
  });
  const groups: CatalogueGroup[] = names.map((name) => {
    const gl = lines.get(name) as string[];
    const gc = commands.get(name) as string[];
    const note = GROUP_NOTES[name] ?? `${name} commands`;
    return { name, note, commands: gc, lines: gl, tokens: tokensOf([heading(name), ...gl].join('\n')), indexTokens: tokensOf(indexLine(name, note, gc)) + 1 };
  });
  const value = new CatalogueImpl(mode, groups);
  const perMode = CACHE.get(registry) ?? new Map<string, Catalogue>();
  perMode.set(mode, value);
  CACHE.set(registry, perMode);
  return { ok: true, value, notices: [] };
}
