/**
 * The algebra view's model (algebra-view design 3.1 to 3.7, 3.13, 3.15): rows as plain data from the figure's objects,
 * with the four display modes, sorting and groups, filtering, auxiliary objects, dependency expansion, the undefined
 * cause chain, `@algebra` directives and next-step suggestions. No DOM: the panel renders what this returns.
 */
import { DEFAULT_FORMAT, describeObject, formatNumber, prettyText, valueTextOf } from '@incantly/kernel';
import type { ValueFormat } from '@incantly/kernel';

export type DisplayMode = 'value' | 'definition' | 'description' | 'definitionAndValue';
export type AlgebraSort = 'creation' | 'type' | 'dependency' | 'name' | 'layer';

export interface AlgebraPrefs {
  readonly sort: AlgebraSort;
  readonly mode: DisplayMode;
  readonly showAux: boolean;
  readonly format: ValueFormat;
  readonly filter: { readonly text: string; readonly onlyUndefined: boolean; readonly onlyHidden: boolean };
  /** Restriction of the input (design 3.11): anything, some commands, or no input. */
  readonly input: { readonly kind: 'any' } | { readonly kind: 'commands'; readonly names: readonly string[] } | { readonly kind: 'off' };
}

export const DEFAULT_PREFS: AlgebraPrefs = {
  sort: 'creation', mode: 'definitionAndValue', showAux: false, format: DEFAULT_FORMAT,
  filter: { text: '', onlyUndefined: false, onlyHidden: false }, input: { kind: 'any' },
};

/** What the model reads of an object; a figure's object view has all of it. */
export interface AlgebraObject {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly typeText: string;
  readonly free: boolean;
  readonly order: number;
  readonly definition: string;
  readonly inputs: readonly number[];
  readonly cell: { readonly defined: boolean; readonly value?: unknown; readonly reason?: string; readonly detail?: string; readonly cause?: unknown };
  readonly range?: { readonly min: number; readonly max: number; readonly step?: number };
  readonly style: { readonly visible: boolean; readonly shown: boolean; readonly aux?: boolean; readonly layer?: number };
}

export interface AlgebraRow {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly free: boolean;
  /** 0 for free objects, else one more than the deepest input. */
  readonly depth: number;
  readonly visible: boolean;
  readonly aux: boolean;
  readonly layer: number;
  /** Pretty source: `f(x) = x² − 2`. */
  readonly definitionText: string;
  /** Plain source, for editing. */
  readonly source: string;
  readonly valueText: string | null;
  readonly descriptionText: string;
  /** What the panel shows for the mode: the first row, and an optional second. */
  readonly lines: readonly [string, string | null];
  readonly undefinedInfo: { readonly reason: string; readonly text: string; readonly chain: readonly string[] } | null;
  readonly slider: { readonly min: number; readonly max: number; readonly step: number; readonly value: number } | null;
  readonly approx: boolean;
  readonly madeFrom: readonly string[];
  readonly usedBy: readonly string[];
}

export interface AlgebraGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly AlgebraRow[];
}

/** Undefined reasons in words, for the row and the chain (design 3.7). */
const REASON_WORDS: Readonly<Record<string, string>> = {
  input_undefined: 'an input is undefined', out_of_domain: 'outside the domain', not_finite: 'not a finite number', parallel: 'the lines are parallel',
  collinear: 'the points are in a line', coincident: 'the points coincide', no_intersection: 'they do not meet', division_by_zero: 'division by zero',
  bad_parameter: 'a parameter is out of range', undefined_moment: 'no such moment', empty_list: 'the list is empty', no_root: 'no root here',
};
export const reasonWords = (r: string): string => REASON_WORDS[r] ?? r.replace(/_/g, ' ');

const TYPE_GROUPS: readonly (readonly [string, string, (t: string) => boolean])[] = [
  ['numbers', 'Numbers and sliders', (t) => t === 'Number' || t === 'Bool'],
  ['points', 'Points and vectors', (t) => t === 'Point' || t === 'Vector'],
  ['lines', 'Lines and segments', (t) => ['Line', 'Segment', 'Ray', 'Polyline'].includes(t)],
  ['circles', 'Circles and conics', (t) => ['Circle', 'Arc', 'Sector', 'Conic'].includes(t)],
  ['functions', 'Functions and curves', (t) => ['Function', 'Curve', 'Relation', 'Predicate', 'Predicate2'].includes(t)],
  ['polygons', 'Polygons and regions', (t) => t === 'Polygon' || t === 'Region'],
  ['lists', 'Lists and data', (t) => ['List', 'Record', 'Chart', 'Table'].includes(t) || t.endsWith('Distribution')],
  ['other', 'Text and other', () => true],
];

/** Natural order: `P_2` before `P_10`. */
const natural = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** Reads `@algebra` directives from a script into preferences (design 3.15). */
export function prefsFromScript(script: string, base: AlgebraPrefs = DEFAULT_PREFS): AlgebraPrefs {
  let p: AlgebraPrefs = base;
  for (const line of script.split('\n')) {
    const m = /^@algebra\s+(\w+)\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const what = m[1] as string;
    const rest = (m[2] as string).trim();
    if (what === 'mode' && ['value', 'definition', 'description', 'definitionAndValue'].includes(rest)) p = { ...p, mode: rest as DisplayMode };
    else if (what === 'sort' && ['creation', 'type', 'dependency', 'name', 'layer'].includes(rest)) p = { ...p, sort: rest as AlgebraSort };
    else if (what === 'round' && /^\d+$/.test(rest)) p = { ...p, format: { ...p.format, decimals: Math.min(10, Number(rest)) } };
    else if (what === 'aux') p = { ...p, showAux: rest === 'show' };
    else if (what === 'input') p = { ...p, input: rest === 'off' ? { kind: 'off' } : rest === 'any' || rest === '' ? { kind: 'any' } : { kind: 'commands', names: rest.split(/\s+/) } };
  }
  return p;
}

/** The chain of undefined causes from an object to the first one (design 3.7): `["B: an input is undefined", "A: …"]`. */
function chainOf(o: AlgebraObject, byId: ReadonlyMap<number, AlgebraObject>): string[] {
  const out: string[] = [];
  let cur: AlgebraObject | undefined = o;
  const seen = new Set<number>();
  while (cur && !cur.cell.defined && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(`${cur.name}: ${reasonWords(cur.cell.reason ?? 'undefined')}${cur.cell.detail ? ` (${cur.cell.detail})` : ''}`);
    if (cur.cell.reason !== 'input_undefined') break;
    cur = cur.inputs.map((i) => byId.get(i)).find((x) => x && !x.cell.defined);
  }
  return out;
}

/** The rows of the figure, for the preferences: filtered, sorted and grouped (design 3.6). */
export function algebraRows(objects: readonly AlgebraObject[], prefs: AlgebraPrefs = DEFAULT_PREFS): { rows: AlgebraRow[]; groups: AlgebraGroup[] } {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const usedBy = new Map<number, string[]>();
  for (const o of objects) for (const i of o.inputs) (usedBy.get(i) ?? usedBy.set(i, []).get(i) as string[]).push(o.name);
  const depth = new Map<number, number>();
  const depthOf = (o: AlgebraObject, guard = 0): number => {
    const hit = depth.get(o.id);
    if (hit !== undefined) return hit;
    const d = o.free || o.inputs.length === 0 || guard > 64 ? 0 : 1 + Math.max(...o.inputs.map((i) => { const x = byId.get(i); return x ? depthOf(x, guard + 1) : 0; }));
    depth.set(o.id, d);
    return d;
  };
  const rows: AlgebraRow[] = [];
  for (const o of objects) {
    const aux = o.style.aux === true;
    if (aux && !prefs.showAux) continue;
    const source = o.definition;
    const definitionText = prettyText(source.replace(/\swith\s.*$/, ''));
    const madeFrom = o.inputs.map((i) => byId.get(i)?.name).filter((x): x is string => x !== undefined);
    const value = o.cell.defined ? valueTextOf(o.typeText || o.type, o.cell.value, prefs.format) : null;
    const approx = o.cell.defined && typeof o.cell.value === 'number' ? formatNumber(o.cell.value, prefs.format).approx : false;
    const descriptionText = describeObject(o, madeFrom);
    const rhs = definitionText.slice(definitionText.indexOf('=') + 1).trim();
    const isFunction = o.type === 'Function' || /^\S+\([^)]*\)\s*=/.test(definitionText);
    const shown = value === null ? '—' : value;
    // the second row only when it adds something (design 3.2)
    const adds = !isFunction && value !== null && value !== rhs && !(o.free && o.type !== 'List');
    let lines: [string, string | null];
    switch (prefs.mode) {
      case 'definition': lines = [definitionText, null]; break;
      case 'value': lines = [isFunction ? definitionText : `${o.name} = ${shown}`, null]; break;
      case 'description': lines = [`${o.name}: ${descriptionText}`, isFunction || value === null ? null : shown]; break;
      // an equation (a line's, a circle's) is shown as it is, not after another "="
      default: lines = [o.free && o.type !== 'List' ? `${o.name} = ${shown}` : definitionText, adds ? (shown.includes('=') ? shown : `= ${shown}`) : null];
    }
    const undefinedInfo = o.cell.defined ? null : { reason: o.cell.reason ?? 'undefined', text: reasonWords(o.cell.reason ?? 'undefined'), chain: chainOf(o, byId) };
    rows.push({
      id: o.id, name: o.name, type: o.type, free: o.free, depth: depthOf(o), visible: o.style.visible, aux, layer: o.style.layer ?? 0,
      definitionText, source, valueText: value, descriptionText, lines, undefinedInfo,
      slider: o.free && o.type === 'Number' && o.range && typeof o.cell.value === 'number'
        ? { min: o.range.min, max: o.range.max, step: o.range.step ?? (o.range.max - o.range.min) / 100, value: o.cell.value } : null,
      approx, madeFrom, usedBy: usedBy.get(o.id) ?? [],
    });
  }
  // filter (never reorders)
  const f = prefs.filter;
  const q = f.text.trim().toLowerCase();
  const kept = rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || r.definitionText.toLowerCase().includes(q) || r.source.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
    && (!f.onlyUndefined || r.undefinedInfo !== null) && (!f.onlyHidden || !r.visible));
  const order = new Map(objects.map((o) => [o.id, o.order]));
  const byOrder = (a: AlgebraRow, b: AlgebraRow): number => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  let groups: AlgebraGroup[];
  switch (prefs.sort) {
    case 'name':
      groups = [{ key: 'all', label: '', rows: [...kept].sort((a, b) => natural(a.name, b.name)) }];
      break;
    case 'type':
      groups = TYPE_GROUPS.map(([key, label]) => ({ key, label, rows: kept.filter((r) => groupOf(r.type) === key).sort(byOrder) })).filter((g) => g.rows.length > 0);
      break;
    case 'dependency': {
      const free = kept.filter((r) => r.free && !r.aux).sort(byOrder);
      const dep = kept.filter((r) => !r.free && !r.aux).sort((a, b) => a.depth - b.depth || byOrder(a, b));
      const aux = kept.filter((r) => r.aux).sort(byOrder);
      groups = [{ key: 'free', label: 'Free', rows: free }, { key: 'dependent', label: 'Dependent', rows: dep }, { key: 'aux', label: 'Auxiliary', rows: aux }].filter((g) => g.rows.length > 0);
      break;
    }
    case 'layer': {
      const layers = [...new Set(kept.map((r) => r.layer))].sort((a, b) => a - b);
      groups = layers.map((l) => ({ key: `layer${l}`, label: `Layer ${l}`, rows: kept.filter((r) => r.layer === l).sort(byOrder) }));
      break;
    }
    default:
      groups = [{ key: 'all', label: '', rows: [...kept].sort(byOrder) }];
  }
  return { rows: groups.flatMap((g) => g.rows), groups };
}

/** The first type group whose test accepts the type. */
const groupOf = (type: string): string => TYPE_GROUPS.find(([, , t]) => t(type))?.[0] ?? 'other';

/** A next-step card (design 3.13): its text and the lines it writes when accepted. */
export interface Suggestion {
  readonly id: string;
  readonly text: string;
  readonly lines: readonly string[];
}

/**
 * Next-step cards for a new object, as pure rules over the figure (design 3.13). `view` is the visible maths box; `free`
 * gives a fresh name for a kind (`point`, `list`, `number`). A card is not offered when its result already exists.
 */
export function suggestionsFor(row: AlgebraRow, objects: readonly AlgebraObject[], view: { x0: number; x1: number }, free: (kind: string) => string): Suggestion[] {
  const out: Suggestion[] = [];
  const uses = (cmd: string, ...names: string[]): boolean => objects.some((o) => new RegExp(`\\b${cmd}\\(\\s*${names.map((x) => `${x}\\b[^)]*`).join('')}`).test(o.definition));
  const x0 = Number(view.x0.toPrecision(4));
  const x1 = Number(view.x1.toPrecision(4));
  if (row.undefinedInfo) return out;
  if (row.type === 'Function') {
    if (!uses('Roots', row.name)) out.push({ id: 'roots', text: `Mark where ${row.name} crosses the x-axis`, lines: [`${free('list')} = Roots(${row.name}, ${x0}, ${x1})`] });
    if (!uses('Extremum', row.name)) out.push({ id: 'extremum', text: `Mark the turning points of ${row.name}`, lines: [`${free('list')} = Extremum(${row.name}, ${x0}, ${x1})`] });
    const other = objects.find((o) => o.type === 'Function' && o.name !== row.name && o.cell.defined);
    if (other && !uses('Intersect', row.name, other.name) && !uses('Intersect', other.name, row.name)) {
      out.push({ id: 'meet', text: `Mark where ${row.name} and ${other.name} meet`, lines: [`${free('list')} = Intersect(${row.name}, ${other.name}, ${x0}, ${x1})`] });
    }
  }
  if (row.type === 'Line' || row.type === 'Circle') {
    const want = row.type === 'Line' ? 'Circle' : 'Line';
    const other = objects.find((o) => o.type === want && o.cell.defined);
    if (other && !uses('Intersect', row.name, other.name) && !uses('Intersect', other.name, row.name)) {
      out.push({ id: 'meet', text: `Mark where ${row.name} and ${other.name} meet`, lines: [`${free('point')} = Intersect(${row.name}, ${other.name}, 1)`, `${free('point')} = Intersect(${row.name}, ${other.name}, 2)`] });
    }
  }
  if (row.type === 'List' && /List<Number>/.test(objects.find((o) => o.id === row.id)?.typeText ?? '') && !uses('Mean', row.name)) {
    out.push({ id: 'stats', text: `Show the mean and total of ${row.name}`, lines: [`${free('number')} = Mean(${row.name})`, `${free('number')} = Sum(${row.name})`] });
  }
  return out.slice(0, 1);
}
