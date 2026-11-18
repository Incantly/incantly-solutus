/**
 * Properties accepted by the `with` clause (docs/features/kernel/design.md section 9.1).
 * The kernel owns the meaning; the language checks key names and literal values.
 * Other areas may append entries.
 */
/** `point`: a position, written as a point expression (`at = M`, `at = (1, 2)`), text-logic design 2.1. */
export type PropKind = 'bool' | 'enum' | 'int' | 'number' | 'text' | 'color' | 'boolexpr' | 'textlist' | 'point' | 'boolnum';

export interface PropSpec {
  readonly kind: PropKind;
  readonly values?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  /** Text shown when a value is refused: "a whole number from 0 to 9". */
  readonly allowed: string;
  /** May be an expression (makes a property rule). */
  readonly expr?: boolean;
}

/** Looks a key up among a registry's own entries, never on `Object.prototype`. */
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

export const PROPERTIES: Record<string, PropSpec> = {
  visible: { kind: 'bool', allowed: 'true or false' },
  label: { kind: 'enum', values: ['name', 'value', 'both', 'caption', 'none'], allowed: 'name, value, both, caption or none' },
  caption: { kind: 'text', allowed: 'a text' },
  aux: { kind: 'bool', allowed: 'true or false' },
  fixed: { kind: 'bool', allowed: 'true or false' },
  selectable: { kind: 'bool', allowed: 'true or false' },
  layer: { kind: 'int', min: 0, max: 9, allowed: 'a whole number from 0 to 9' },
  showIf: { kind: 'boolexpr', allowed: 'a true/false expression', expr: true },
  color: { kind: 'color', allowed: 'a colour name, rgb(r, g, b), hsl(h, s, l) or a Color', expr: true },
  opacity: { kind: 'number', min: 0, max: 1, allowed: 'a number from 0 to 1', expr: true },
  width: { kind: 'number', min: 0.5, max: 12, allowed: 'a number from 0.5 to 12' },
  pointSize: { kind: 'number', min: 1, max: 20, allowed: 'a number from 1 to 20' },
  lineStyle: { kind: 'enum', values: ['solid', 'dashed', 'dotted', 'dashdot'], allowed: 'solid, dashed, dotted or dashdot' },
  pointStyle: { kind: 'enum', values: ['dot', 'circle', 'cross', 'plus', 'diamond', 'square', 'triangle'], allowed: 'dot, circle, cross, plus, diamond, square or triangle' },
  fill: { kind: 'enum', values: ['solid', 'hatch', 'cross', 'dots', 'checker'], allowed: 'solid, hatch, cross, dots or checker' },
  fillAngle: { kind: 'number', allowed: 'a number' },
  fillGap: { kind: 'number', allowed: 'a number' },
  trace: { kind: 'bool', allowed: 'true or false' },
  tip: { kind: 'enum', values: ['auto', 'name', 'value', 'caption', 'off'], allowed: 'auto, name, value, caption or off' },
  tags: { kind: 'textlist', allowed: 'a list of texts' },
  animate: { kind: 'enum', values: ['off', 'oscillate', 'forward', 'backward', 'bounce', 'loop', 'once'], allowed: 'off, oscillate, forward, backward, bounce, loop or once' },
};

/** Colour words accepted as bare names in `color = …`. */
export const COLOR_WORDS: readonly string[] = [
  'red', 'blue', 'green', 'orange', 'purple', 'black', 'grey', 'gray', 'white', 'teal', 'pink', 'brown', 'yellow', 'cyan', 'magenta',
  'lightred', 'lightblue', 'lightgreen', 'darkred', 'darkblue', 'darkgreen', 'lightgrey', 'darkgrey',
];

/** Directives known to the language: name -> usage forms. Other areas append. */
export const DIRECTIVES: Record<string, readonly string[]> = {
  view: ['@view x0 x1 y0 y1', '@view home'],
  grid: ['@grid on', '@grid off', '@grid step N', '@grid major', '@grid minor'],
  axes: ['@axes on', '@axes off'],
  beat: ['@beat id "title"'],
  clock: ['@clock 0..30'],
  // the input log of a film (animation-time 8.2), written at the end of a saved script
  input: ['@input name value at t', '@input name value base', '@input reset at t'],
  seed: ['@seed N', '@seed N v1'],
  title: ['@title "text"'],
  step: ['@step "title"'],
  sheet: ['@sheet cols rows'],
  mode: ['@mode name'],
  algebra: ['@algebra option'],
  tools: ['@tools list'],
  solver: ['@solver step 1/480'],
  restrict: ['@restrict hide=algebra deny=Command,…'],
  angleunit: ['@angleunit degree'],
  rounding: ['@rounding 4s'],
  tol: ['@tol N'],
  tolerance: ['@tolerance N'],
  cell: ['@cell ref value'],
  limit: ['@limit name N'],
  exam: ['@exam profile'],
  digits: ['@digits N'],
  coords: ['@coords mode'],
  sig: ['@sig N'],
  datalab: ['@datalab option'],
  colwidth: ['@colwidth col width'],
  alt: ['@alt "text"'],
  theme: ['@theme name'],
  snap: ['@snap on', '@snap off'],
  sheetview: ['@sheetview option'],
  incantly: ['@incantly version'],
  background: ['@background color'],
  fig: ['@fig n'],
};
