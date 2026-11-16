/**
 * The camera object (docs/features/space-3d/design.md 8.1, 8.3, 8.4; errors 3; .kiro/specs/space-3d R3.1, R3.2).
 *
 * `space` is the object `space = Space(azimuth = …, …)`: each property is a named argument, so it may be a formula of
 * `t` or a slider. `space with azimuth = 40deg` is read as a redefinition that keeps the other properties, and
 * `ViewPreset`, `ViewReset`, `ViewFacing` and `ViewAll` are read as the same line. No other object may be a camera, and
 * `space` may be nothing else.
 */
import type { ErrorObject } from '../../contracts/errors';
import { err } from '../../errors/table';
import type { CommandRule, LineRewrite } from '../../graph/registry';
import type { CheckedLine } from '../../language/check';
import type { CommandSpec, FormCheck, ParamSpec, Refusal } from '../../language/table';
import type { Circle3, Cone3, Cylinder3, Line3, Plane3, Polygon3, Polyhedron, Segment3, Sphere3 } from './types';
import { shape3Of } from './types';
import type { V3 } from './v3';
import { add, isV3, normalOf, scale, sub, unit } from './v3';

export type Projection = 'ortho' | 'persp' | 'oblique';
export type Light = 'on' | 'off' | 'flat';

/** The value of `space`: the camera and display properties of design 8.1 that phase 1 draws. Angles in radians. */
export interface View3 {
  readonly shape3: 'View3';
  readonly azimuth: number;
  readonly elevation: number;
  readonly roll: number;
  readonly zoom: number;
  readonly target: V3;
  readonly projection: Projection;
  readonly fov: number;
  readonly obliqueAngle: number;
  readonly obliqueFactor: number;
  readonly axes: boolean;
  readonly floor: boolean;
  readonly grid: boolean;
  readonly light: Light;
}

const DEG = Math.PI / 180;

export const DEFAULT_VIEW3: View3 = Object.freeze({
  shape3: 'View3',
  azimuth: -40 * DEG,
  elevation: 22 * DEG,
  roll: 0,
  zoom: 1,
  target: Object.freeze({ x: 0, y: 0, z: 0 }),
  projection: 'ortho',
  fov: 40 * DEG,
  obliqueAngle: 30 * DEG,
  obliqueFactor: 0.5,
  axes: true,
  floor: true,
  grid: true,
  light: 'on',
});

const PROJECTIONS: readonly Projection[] = ['ortho', 'persp', 'oblique'];
const LIGHTS: readonly Light[] = ['on', 'off', 'flat'];
const WORDS: Readonly<Record<string, readonly string[]>> = { projection: PROJECTIONS, light: LIGHTS };

/** The properties in their written order, with their types. */
/** The radius of space the view shows at zoom 1 (the axes run from -5 to 5 with room around them). */
export const SPACE_FIT_RADIUS = 6;

const PROPS: readonly (readonly [keyof View3, string])[] = [
  ['azimuth', 'Number'], ['elevation', 'Number'], ['roll', 'Number'], ['zoom', 'Number'], ['target', 'Point3'], ['projection', 'Text'],
  ['fov', 'Number'], ['obliqueAngle', 'Number'], ['obliqueFactor', 'Number'], ['axes', 'Bool'], ['floor', 'Bool'], ['grid', 'Bool'], ['light', 'Text'],
];
export const VIEW3_PROPERTIES: readonly string[] = PROPS.map(([k]) => k);

/** The camera of a figure: the value of `space`, or the defaults while there is none (or it is undefined). */
export function viewOf(figure: { get(name: string): { type: string; cell: { defined: boolean; value?: unknown } } | undefined }): View3 {
  const o = figure.get('space');
  if (o && o.type === 'View3' && o.cell.defined && shape3Of(o.cell.value) === 'View3') return o.cell.value as View3;
  return DEFAULT_VIEW3;
}

/* ------------------------------ the Space command ------------------------------ */

const spaceRule: CommandRule = {
  run(call) {
    const out: Record<string, unknown> = { ...DEFAULT_VIEW3 };
    PROPS.forEach(([k], i) => {
      const v = call.values[i];
      if (v === undefined) return;
      if (WORDS[k] && !(WORDS[k] as readonly string[]).includes(v as string)) return;
      if (k === 'zoom' && !((v as number) > 0)) return;
      if (k === 'elevation') out[k] = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, v as number));
      else if (k === 'fov') out[k] = Math.max(5 * DEG, Math.min(120 * DEG, v as number));
      else if (k === 'obliqueFactor') out[k] = Math.max(0, Math.min(1, v as number));
      else out[k] = v;
    });
    return out as unknown as View3;
  },
};

/** A number written as `12`, `-3.5` or `40deg`, or `undefined` for a formula. */
function writtenNumber(text: string): number | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*(deg)?\s*$/.exec(text);
  if (!m) return undefined;
  return Number(m[1]) * (m[2] ? DEG : 1);
}

/** Literal values that can never work are errors on the line (S005), with the allowed set or range. */
function checkSpace(c: FormCheck): Refusal | undefined {
  const bad = (i: number, key: string, allowed: string, hint: string, suggest?: string): Refusal => ({
    kind: 'bad_property_value', message: `${key} must be ${allowed}.`, hint, param: i, params: { key, allowed }, ...(suggest ? { suggest: [suggest] } : {}),
  });
  for (let i = 0; i < PROPS.length; i++) {
    const a = c.args[i];
    if (!a || a.omitted) continue;
    const [key] = PROPS[i] as readonly [string, string];
    const words = WORDS[key];
    if (words && typeof a.literal === 'string' && !words.includes(a.literal)) {
      if (key === 'projection' && a.literal === 'isometric') {
        return bad(i, key, words.join(', '), 'Isometric is a camera angle in orthographic projection. Use ViewPreset(isometric).', 'ViewPreset(isometric)');
      }
      return bad(i, key, words.join(', '), `Write ${key} = ${words[0]}.`);
    }
    const n = typeof a.literal === 'number' ? a.literal : writtenNumber(a.text);
    if (n === undefined) continue;
    if (key === 'fov' && (n < 5 * DEG - 1e-12 || n > 120 * DEG + 1e-12)) return bad(i, key, 'between 5deg and 120deg', 'A wide angle above 120deg bends straight lines too much. Try 60deg.');
    if (key === 'zoom' && !(n > 0)) return bad(i, key, 'above 0', 'Zoom 1 fits the figure; 2 is twice as close.');
    if (key === 'elevation' && Math.abs(n) > Math.PI / 2 + 1e-12) return bad(i, key, 'between -90deg and 90deg', 'Elevation is the tilt above the floor; 90deg looks straight down.');
    if (key === 'obliqueFactor' && (n < 0 || n > 1)) return bad(i, key, 'between 0 and 1', 'The depth axis is drawn at this fraction of its length; 0.5 is usual.');
  }
  return undefined;
}

const named = (name: string, type: string): ParamSpec => ({ name, type, optional: true, named: true });

export const SPACE_CAMERA_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Space',
    kind: 'object',
    group: 'space',
    forms: [{
      params: PROPS.map(([k, t]) => named(k, t)),
      returns: 'View3',
      rule: () => spaceRule,
      summary: 'the camera of the Space view: only as space = Space(...), written space with azimuth = 40deg',
      check: checkSpace,
    }],
  },
];

/* ------------------------------ `space` is the camera, and only it ------------------------------ */

export function spaceLineCheck(_figure: unknown, line: CheckedLine): ErrorObject | undefined {
  const expr = line.expr as { n?: string; spec?: { name?: string } } | undefined;
  const isCamera = expr?.n === 'command' && expr.spec?.name === 'Space';
  const at = { line: line.line, col: 1, endCol: 1 };
  if (isCamera && (line.names.length !== 1 || line.names[0] !== 'space')) {
    return err('reserved_name', at, { name: 'Space(...)', group: 'the camera, which only space can be' }, {
      hint: 'Write space with azimuth = 40deg, or space = Space(azimuth = 40deg).',
      suggest: [], recovery: 'rewrite', fingerprintKey: 'camera',
    });
  }
  if (!isCamera && line.names.includes('space') && (line.op === 'add' || line.op === 'redefine')) {
    return err('reserved_name', at, { name: 'space', group: 'the camera of the Space view' }, {
      hint: 'Pick another name. To change the camera, write space with azimuth = 40deg.',
      suggest: [], recovery: 'rewrite', fingerprintKey: 'space',
    });
  }
  return undefined;
}

/* ------------------------------ the lines that change the camera ------------------------------ */

interface FigureLike {
  get(name: string): { type: string; definition: string; cell: { defined: boolean; value?: unknown } } | undefined;
  objects(): Iterable<{ type: string; cell: { defined: boolean; value?: unknown } }>;
}

/** Splits `a = 1, b = f(2, 3)` at the commas that are not inside brackets or quotes. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && (ch === '(' || ch === '[' || ch === '{')) depth++;
    if (!quote && (ch === ')' || ch === ']' || ch === '}')) depth--;
    if (!quote && depth === 0 && ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The named arguments of the camera's line now, in written order. */
function currentArgs(figure: FigureLike): Map<string, string> {
  const out = new Map<string, string>();
  const def = figure.get('space')?.definition ?? '';
  const m = /^\s*(?:space\s*=\s*)?Space\((.*)\)\s*$/s.exec(def);
  if (!m) return out;
  for (const item of splitTop(m[1] as string)) {
    const kv = /^([A-Za-z]\w*)\s*=\s*([\s\S]+)$/.exec(item);
    if (kv) out.set(kv[1] as string, (kv[2] as string).trim());
  }
  return out;
}

/** `projection = persp` is written with a bare word: it is read as the text "persp". */
function valueText(key: string, value: string): string {
  if (WORDS[key] && /^[A-Za-z]+$/.test(value)) return `"${value}"`;
  return value;
}

const deg = (rad: number): string => `${Number(((rad * 180) / Math.PI).toFixed(4))}deg`;
const num = (x: number): string => String(Number(x.toPrecision(6)));
const point = (p: V3): string => `(${num(p.x)}, ${num(p.y)}, ${num(p.z)})`;

/** The camera line with these properties set (`undefined` removes one, so it takes its default). */
function cameraLine(figure: FigureLike, set: Readonly<Record<string, string | undefined>>, keep = true): string {
  const args = keep ? currentArgs(figure) : new Map<string, string>();
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) args.delete(k);
    else args.set(k, valueText(k, v));
  }
  // properties in the order of design 8.1, so the line reads the same whoever wrote it
  const ordered = VIEW3_PROPERTIES.filter((k) => args.has(k)).map((k) => `${k} = ${args.get(k) as string}`);
  const unknown = [...args.keys()].filter((k) => !VIEW3_PROPERTIES.includes(k)).map((k) => `${k} = ${args.get(k) as string}`);
  return `space = Space(${[...ordered, ...unknown].join(', ')})`;
}

const PRESETS: Readonly<Record<string, { azimuth: number; elevation: number }>> = {
  front: { azimuth: 0, elevation: 0 },
  back: { azimuth: Math.PI, elevation: 0 },
  left: { azimuth: -Math.PI / 2, elevation: 0 },
  right: { azimuth: Math.PI / 2, elevation: 0 },
  top: { azimuth: 0, elevation: Math.PI / 2 },
  bottom: { azimuth: 0, elevation: -Math.PI / 2 },
  isometric: { azimuth: Math.PI / 4, elevation: Math.asin(1 / Math.sqrt(3)) },
};
export const VIEW_PRESETS: readonly string[] = Object.keys(PRESETS);

/** The camera's direction from the target, as azimuth and elevation (design 8.2, z up). */
export function azElOf(off: V3): { azimuth: number; elevation: number } {
  const u = unit(off) ?? { x: 0, y: -1, z: 0 };
  return { azimuth: Math.atan2(u.x, -u.y), elevation: Math.asin(Math.max(-1, Math.min(1, u.z))) };
}

function offsetOf(v: View3): V3 {
  const ce = Math.cos(v.elevation);
  return { x: ce * Math.sin(v.azimuth), y: -ce * Math.cos(v.azimuth), z: Math.sin(v.elevation) };
}

/** The points a value covers, for `ViewAll` and the centre of `ViewFacing`. */
export function pointsOf(v: unknown): V3[] {
  if (isV3(v)) return [v];
  if (Array.isArray(v)) return v.flatMap(pointsOf);
  switch (shape3Of(v)) {
    case 'Segment3': return [(v as Segment3).a, (v as Segment3).b];
    case 'Line3': case 'Ray3': return [(v as Line3).o];
    case 'Plane': return [(v as Plane3).f.o];
    case 'Polygon3': return [...(v as Polygon3).pts];
    case 'Circle3': {
      const c = v as Circle3;
      return [add(c.f.o, scale(c.f.u, c.r)), sub(c.f.o, scale(c.f.u, c.r)), add(c.f.o, scale(c.f.v, c.r)), sub(c.f.o, scale(c.f.v, c.r))];
    }
    case 'Polyhedron': return [...(v as Polyhedron).verts];
    case 'Sphere': {
      const s = v as Sphere3;
      return [add(s.c, { x: s.r, y: s.r, z: s.r }), sub(s.c, { x: s.r, y: s.r, z: s.r })];
    }
    case 'Cylinder': case 'Cone': {
      const s = v as Cylinder3 | Cone3;
      const r = { x: s.r, y: s.r, z: s.r };
      return [add(s.a, r), sub(s.a, r), add(s.b, r), sub(s.b, r)];
    }
    default: return [];
  }
}

const centreOf = (pts: readonly V3[]): V3 | undefined => {
  if (pts.length === 0) return undefined;
  const lo = { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)), z: Math.min(...pts.map((p) => p.z)) };
  const hi = { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)), z: Math.max(...pts.map((p) => p.z)) };
  return scale(add(lo, hi), 0.5);
};

/** The direction to look along to see an object face on: a plane's or polygon's normal, a line's perpendicular. */
function facingNormal(v: unknown): V3 | undefined {
  switch (shape3Of(v)) {
    case 'Plane': return (v as Plane3).n;
    case 'Polygon3': return normalOf((v as Polygon3).f);
    case 'Circle3': return normalOf((v as Circle3).f);
    case 'Line3': case 'Ray3': case 'Segment3': {
      const d = shape3Of(v) === 'Segment3' ? sub((v as Segment3).b, (v as Segment3).a) : (v as Line3).d;
      // look across the line, from as level as it allows
      const side = unit({ x: -d.y, y: d.x, z: 0 });
      return side ?? { x: 0, y: -1, z: 0 };
    }
    default: return undefined;
  }
}

const VIEW_LINE = /^\s*(ViewPreset|ViewReset|ViewFacing|ViewAll)\s*\(\s*([^)]*?)\s*\)\s*$/;
const WITH_LINE = /^\s*space\s+with\s+(.+)$/s;

export function cameraRewrite(figure: unknown, text: string): LineRewrite | undefined {
  const fig = figure as FigureLike;
  const w = WITH_LINE.exec(text);
  if (w) {
    const set: Record<string, string> = {};
    for (const item of splitTop(w[1] as string)) {
      const kv = /^([A-Za-z]\w*)\s*=\s*([\s\S]+)$/.exec(item);
      if (!kv) return undefined;
      set[kv[1] as string] = (kv[2] as string).trim();
    }
    return { text: cameraLine(fig, set) };
  }
  const m = VIEW_LINE.exec(text);
  if (!m) return undefined;
  const [, cmd, arg] = m as unknown as [string, string, string];
  const at = { line: 1, col: 1, endCol: text.length + 1 };
  if (cmd === 'ViewReset') return { text: 'space = Space()' };
  if (cmd === 'ViewPreset') {
    const name = arg.replace(/^"|"$/g, '');
    const p = PRESETS[name];
    if (!p) {
      return {
        error: err('bad_option', at, { command: 'ViewPreset', why: `${name || 'nothing'} is not a view. The views are ${VIEW_PRESETS.join(', ')}.` }, {
          expected: [...VIEW_PRESETS], hint: 'Write ViewPreset(top), for example.', suggest: [], recovery: 'use_suggestion', fingerprintKey: `preset:${name}`,
        }),
      };
    }
    return { text: cameraLine(fig, { azimuth: deg(p.azimuth), elevation: deg(p.elevation), roll: undefined, projection: 'ortho' }) };
  }
  if (cmd === 'ViewAll') {
    const pts: V3[] = [];
    for (const o of fig.objects()) if (o.cell.defined && o.type !== 'View3') pts.push(...pointsOf(o.cell.value));
    const c = centreOf(pts) ?? { x: 0, y: 0, z: 0 };
    // the zoom that shows the box of everything with a tenth to spare
    const r = pts.length > 0 ? Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z))) * 1.1 : SPACE_FIT_RADIUS;
    const zoom = SPACE_FIT_RADIUS / Math.max(r, 0.5);
    return { text: cameraLine(fig, { target: point(c), zoom: Math.abs(zoom - 1) < 1e-9 ? undefined : num(zoom) }) };
  }
  // ViewFacing(obj)
  const o = fig.get(arg);
  const value = o?.cell.defined ? o.cell.value : undefined;
  const n = facingNormal(value);
  if (!o || !n) {
    return {
      error: err('bad_option', at, { command: 'ViewFacing', why: o ? `${arg} has no face to look at; give a plane, polygon, circle or line.` : `${arg} is not an object.` }, {
        hint: 'Write ViewFacing(p) with a plane, polygon, circle or line.', suggest: [], recovery: 'fix_line', fingerprintKey: 'facing',
      }),
    };
  }
  // of the two sides, the one nearer the camera now, so the turn is the shorter one (design 8.4)
  const now = offsetOf(viewOf(fig as never));
  const side = n.x * now.x + n.y * now.y + n.z * now.z >= 0 ? n : scale(n, -1);
  const ae = azElOf(side);
  const c = centreOf(pointsOf(value)) ?? { x: 0, y: 0, z: 0 };
  return { text: cameraLine(fig, { azimuth: deg(ae.azimuth), elevation: deg(ae.elevation), roll: undefined, target: point(c) }) };
}
