/**
 * Style properties, name sequences and field declarations of the numbers area
 * (numbers-sliders/design.md 3.2, controls-scripting/design.md 3.1).
 *
 * Registration only runs when registerNumbers() is called, so figures that do not
 * use this area see no new keys. Everything here appends to the kernel's own
 * registries (PROPERTIES, registerPropertyTypes, registerTypeStyle, FIELDS).
 */

import type { Figure } from '../../graph/figure';
import type { Name, ObjId } from '../../contracts/values';
import { registerFields, registerFieldTyper } from '../../language/check';
import type { Ty } from '../../language/types';
import { registerFieldReader } from '../../language/compile';
import { PROPERTIES, registerProperty } from '../../language/props';
import type { PropSpec } from '../../language/props';
import { T, listOf } from '../../language/types';
import { registerPropertyTypes, registerTypeStyle } from '../../graph/props';
import type { AngleUnit, LoopMode, Placement } from './types';
import { autoStep, unitScale } from './commit';

/* ------------------------------ property specs ------------------------------ */

const PROPS: Readonly<Record<string, { spec: PropSpec; types: readonly string[] | '*' }>> = {
  // display unit of a Number (none = plain number)
  unit: { spec: { kind: 'enum', values: ['none', 'rad', 'deg', 'turn', 'grad'], allowed: 'none, rad, deg, turn or grad' }, types: ['Number'] },
  // rounding overrides (figure defaults come from @digits/@sig mirrored in format.ts)
  digits: { spec: { kind: 'int', min: 0, max: 15, allowed: 'a whole number from 0 to 15' }, types: ['Number'] },
  sig: { spec: { kind: 'int', min: 1, max: 15, allowed: 'a whole number from 1 to 15' }, types: ['Number'] },
  trim: { spec: { kind: 'bool', allowed: 'true or false' }, types: ['Number'] },
  // animation (read by tickAnimations; stored as plain style data)
  loop: { spec: { kind: 'enum', values: ['bounce', 'up', 'down', 'once', 'random'], allowed: 'bounce, up, down, once or random' }, types: ['Number'] },
  period: { spec: { kind: 'number', min: 0.001, allowed: 'a number of seconds above 0' }, types: ['Number'] },
  seed: { spec: { kind: 'int', allowed: 'a whole number' }, types: ['Number'] },
  // dragging an animating slider resumes on release unless resume = false
  resume: { spec: { kind: 'bool', allowed: 'true or false' }, types: ['Number'] },
  // slider geometry
  vertical: { spec: { kind: 'bool', allowed: 'true or false' }, types: ['Number'] },
  length: { spec: { kind: 'number', min: 1, max: 4000, allowed: 'a number of pixels from 1 to 4000' }, types: ['Number'] },
  // placement in the control layer: dock, screen(x, y) or at(x, y). The value is a text made by the screen() and
  // at() functions of this area; a bare `dock` word cannot be a value of a text property (kernel prop-value hook).
  place: { spec: { kind: 'text', allowed: 'dock, screen(x, y) or at(x, y)' }, types: ['Number', 'Bool', 'Button', 'Choice', 'Input'] },
  // which corner a screen placement counts from
  anchor: { spec: { kind: 'enum', values: ['tl', 'tr', 'bl', 'br'], allowed: 'tl, tr, bl or br' }, types: ['Number', 'Bool', 'Button', 'Choice', 'Input'] },
  // dropdown captions
  captions: { spec: { kind: 'textlist', allowed: 'a list of texts' }, types: ['Choice'] },
  // any visible object may raise click
  clickable: { spec: { kind: 'bool', allowed: 'true or false' }, types: '*' },
};

let registered = false;

/** Appends this area's properties, type styles and fields. Idempotent. */
export function registerNumbersProperties(): void {
  if (registered) return;
  registered = true;
  for (const [key, { spec, types }] of Object.entries(PROPS)) {
    if (!Object.hasOwn(PROPERTIES, key)) registerProperty(key, spec);
    registerPropertyTypes(key, types);
  }
  registerTypeStyle('Button', { defaults: { color: 'grey', label: 'caption' }, drawable: false });
  registerTypeStyle('Choice', { defaults: { label: 'caption' }, drawable: false });
  registerTypeStyle('Input', { defaults: { label: 'caption' }, drawable: false });
  // Slider and control fields (checking only; evaluation needs a kernel field hook).
  registerFields('Number', { min: T.Number, max: T.Number, step: T.Number, animating: T.Bool });
  registerFields('Choice', { index: T.Number, count: T.Number });
  registerFields('Input', { text: T.Text, valid: T.Bool });
  // d.value is the selected option, so its type is the type of the options (controls-scripting design 3.1)
  registerFieldTyper('Choice', (field, target, fig) => {
    if (field !== 'value' || target.n !== 'ref') return undefined;
    const inputs = fig.inputsOf(target.id).map((id) => fig.byId(id)?.type).filter((t): t is Ty => t !== undefined);
    const first = inputs[0];
    if (first && inputs.length === 1 && first.k === 'List' && first.of) return first.of;
    if (first && inputs.every((t) => t.k === first.k)) return first;
    const v = fig.read?.(target.id) as { value?: unknown } | undefined;
    const o = v?.value;
    if (typeof o === 'number') return T.Number;
    if (typeof o === 'string') return T.Text;
    if (typeof o === 'boolean') return T.Bool;
    if (typeof o === 'object' && o !== null && 'x' in o && 'y' in o) return T.Point;
    return undefined;
  });
  registerFieldReader('Choice', (field, value) => {
    const o = value as Record<string, unknown> | undefined;
    return o && (field === 'value' || field === 'index' || field === 'count') ? o[field] : undefined;
  });
  registerFieldReader('Number', (field, _value, at) => {
    const figure = at.host as Figure | undefined;
    if (!figure || at.id === undefined) return undefined;
    const view = figure.get(at.id);
    if (!view) return undefined;
    if (field === 'animating') return isAnimatingHook(figure, view.name);
    if (!view.range) return undefined;
    if (field === 'min') return view.range.min;
    if (field === 'max') return view.range.max;
    return field === 'step' ? stepOf(figure, at.id) : undefined;
  });
  registerFieldReader('Input', (field, _value, at) => {
    const figure = at.host as Figure | undefined;
    if (!figure || at.id === undefined) return undefined;
    return field === 'text' ? inputHook.text(figure, at.id) : field === 'valid' ? inputHook.valid(figure, at.id) : undefined;
  });
  void listOf;
}

/**
 * Readers that live in files which import this one: they are set at registration so this file needs no import cycle.
 */
let isAnimatingHook: (figure: Figure, name: string) => boolean = () => false;
const inputHook: { text: (figure: Figure, id: ObjId) => string | undefined; valid: (figure: Figure, id: ObjId) => boolean | undefined } = {
  text: () => undefined,
  valid: () => undefined,
};

export function setFieldHooks(h: { animating: (figure: Figure, name: string) => boolean; text: (figure: Figure, id: ObjId) => string; valid: (figure: Figure, id: ObjId) => boolean }): void {
  isAnimatingHook = h.animating;
  inputHook.text = h.text;
  inputHook.valid = h.valid;
}

/* ------------------------------ selectors ------------------------------ */

/** Resolve a name or id to an id (undefined when the object does not exist). */
export function resolveId(figure: Figure, x: Name | ObjId): ObjId | undefined {
  return figure.get(x)?.id;
}

function extOf(figure: Figure, id: ObjId): Record<string, unknown> {
  return (figure.get(id)?.style.ext ?? {}) as Record<string, unknown>;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Effective placement of a control: dock by default. */
export function placementOf(figure: Figure, x: Name | ObjId): Placement {
  const id = resolveId(figure, x);
  if (id === undefined) return { kind: 'dock' };
  const ext = extOf(figure, id);
  const place = ext['place'];
  const parsed = typeof place === 'string' ? parsePlacement(place) : undefined;
  if (parsed?.kind === 'screen') {
    const anchor = ext['anchor'];
    return { ...parsed, anchor: anchor === 'tr' || anchor === 'bl' || anchor === 'br' ? anchor : 'tl' };
  }
  return parsed ?? { kind: 'dock' };
}

const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const SCREEN_RE = new RegExp(String.raw`^screen\(\s*(${NUM})\s*,\s*(${NUM})\s*\)$`);
const AT_RE = new RegExp(String.raw`^at\(\s*(${NUM})\s*,\s*(${NUM})\s*\)$`);

/** Parse the design's `screen(x, y)` / `at(x, y)` / `dock` placement text. */
export function parsePlacement(text: string): Placement | undefined {
  const t = text.trim();
  if (t === 'dock') return { kind: 'dock' };
  let m = SCREEN_RE.exec(t);
  if (m) return { kind: 'screen', x: Number(m[1]), y: Number(m[2]), anchor: 'tl' };
  m = AT_RE.exec(t);
  if (m) return { kind: 'at', x: Number(m[1]), y: Number(m[2]) };
  return undefined;
}

/** Control caption: the style caption, else the object name. */
export function labelOf(figure: Figure, x: Name | ObjId): string {
  const id = resolveId(figure, x);
  if (id === undefined) return '';
  const view = figure.get(id);
  if (!view) return '';
  return view.style.caption ?? view.name;
}

/** Button label: the style caption, else the Button(...) argument, else the name. */
export function buttonLabelOf(figure: Figure, x: Name | ObjId): string {
  const id = resolveId(figure, x);
  if (id === undefined) return '';
  const view = figure.get(id);
  if (!view) return '';
  if (view.style.caption !== undefined) return view.style.caption;
  const v = figure.value(id) as { label?: unknown } | undefined;
  if (typeof v?.label === 'string') return v.label;
  return view.name;
}

/** Dropdown captions override, if the author gave one. */
export function captionsOf(figure: Figure, x: Name | ObjId): readonly string[] | null {
  const id = resolveId(figure, x);
  if (id === undefined) return null;
  const v = extOf(figure, id)['captions'];
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as readonly string[]) : null;
}

/** Whether a click on the object raises `click`. */
export function isClickable(figure: Figure, x: Name | ObjId): boolean {
  const id = resolveId(figure, x);
  if (id === undefined) return false;
  const view = figure.get(id);
  if (!view) return false;
  if (view.type === 'Button') return true;
  return extOf(figure, id)['clickable'] === true;
}

/** Whether a drag on an animating slider resumes on release (default true). */
export function resumeOf(figure: Figure, x: Name | ObjId): boolean {
  const id = resolveId(figure, x);
  if (id === undefined) return true;
  return extOf(figure, id)['resume'] !== false;
}

/** Animation loop mode (default bounce). */
export function loopOf(figure: Figure, x: Name | ObjId): LoopMode {
  const id = resolveId(figure, x);
  if (id === undefined) return 'bounce';
  const v = extOf(figure, id)['loop'];
  return v === 'up' || v === 'down' || v === 'once' || v === 'random' || v === 'bounce' ? v : 'bounce';
}

/** Seconds per sweep (default 10). */
export function periodOf(figure: Figure, x: Name | ObjId): number {
  const id = resolveId(figure, x);
  if (id === undefined) return 10;
  const v = num(extOf(figure, id)['period']);
  return v !== undefined && v > 0 ? v : 10;
}

/** Random-mode seed (default 1). */
export function seedOf(figure: Figure, x: Name | ObjId): number {
  const id = resolveId(figure, x);
  if (id === undefined) return 1;
  const v = extOf(figure, id)['seed'];
  return typeof v === 'number' && Number.isInteger(v) ? v : 1;
}

/**
 * A unit constant in the text: `deg`, `turn` or `grad`, alone (`x = deg`) or glued to a number (`30deg`, `0.5turn`),
 * but never the end of a longer name (`v2deg`).
 */
const UNIT_TOKEN = /(?<![A-Za-z0-9_.\u0370-\u03FF])(?:\d+\.?\d*|\.\d+)?(?:[eE][-+]?\d+)?(deg|turn|grad)(?![A-Za-z0-9_\u0370-\u03FF])/;

/**
 * Display unit from the definition text: a literal ending in an angle constant (`30deg`), `°`, or an Angle(...)
 * right-hand side. Only the text after the first `=` is read, so the name never decides (numbers-sliders 3.2).
 * The kernel tags angle arithmetic too, but the tag is not publicly readable, so only the textual cases are inferred.
 */
export function inferUnitFromDefinition(definition: string): AngleUnit | undefined {
  const eq = definition.indexOf('=');
  const rhs = eq < 0 ? definition : definition.slice(eq + 1);
  const m = UNIT_TOKEN.exec(rhs);
  if (m) return m[1] as AngleUnit;
  if (/°|(?<![A-Za-z0-9_])Angle\s*\(/.test(rhs)) return 'deg';
  return undefined;
}

/** Effective display unit: explicit `with unit`, else inference, else none. */
export function displayUnitOf(figure: Figure, x: Name | ObjId): AngleUnit | 'none' {
  const id = resolveId(figure, x);
  if (id === undefined) return 'none';
  const v = extOf(figure, id)['unit'];
  if (v === 'rad' || v === 'deg' || v === 'turn' || v === 'grad' || v === 'none') return v;
  if (v !== undefined) return 'none';
  const view = figure.get(id);
  if (view?.type !== 'Number') return 'none';
  return inferUnitFromDefinition(view.definition) ?? 'none';
}

/** Slider minimum in stored units, if the object currently has a range. */
export function minOf(figure: Figure, x: Name | ObjId): number | undefined {
  const id = resolveId(figure, x);
  if (id === undefined) return undefined;
  return figure.get(id)?.range?.min;
}

/** Slider maximum in stored units, if the object currently has a range. */
export function maxOf(figure: Figure, x: Name | ObjId): number | undefined {
  const id = resolveId(figure, x);
  if (id === undefined) return undefined;
  return figure.get(id)?.range?.max;
}

/** Resolved step in stored units (the fixed step, else the automatic nice step). */
export function stepOf(figure: Figure, x: Name | ObjId): number | undefined {
  const id = resolveId(figure, x);
  if (id === undefined) return undefined;
  const range = figure.get(id)?.range;
  if (!range) return undefined;
  if (range.step !== undefined) return range.step;
  const scale = unitScale(displayUnitOf(figure, id));
  return autoStep(range.min / scale, range.max / scale) * scale;
}

/** Slider orientation (default horizontal). */
export function orientationOf(figure: Figure, x: Name | ObjId): 'horizontal' | 'vertical' {
  const id = resolveId(figure, x);
  if (id === undefined) return 'horizontal';
  return extOf(figure, id)['vertical'] === true ? 'vertical' : 'horizontal';
}

/** Slider track length in pixels (default 180). */
export function lengthOf(figure: Figure, x: Name | ObjId): number {
  const id = resolveId(figure, x);
  if (id === undefined) return 180;
  const v = num(extOf(figure, id)['length']);
  return v !== undefined && v >= 1 ? v : 180;
}
