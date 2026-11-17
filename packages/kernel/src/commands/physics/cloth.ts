/**
 * Cloth (docs/features/physics/design.md 2.4, 9.5, 11.3; errors.md B004, B010, B013, B017, B018, B019): `Cloth` as a
 * sheet in space, a rope or a net in the plane, and `Pin`.
 *
 * The rules give the start (where the points are, what holds them); the drivers (`./driver`, `./driver3`) own the
 * points and write where they are into each cloth's value after each pass.
 */
import type { ErrorObject } from '../../contracts/errors';
import { err } from '../../errors/table';
import type { RuleCall } from '../../graph/registry';
import type { CheckedLine } from '../../language/check';
import type { CallCheck, CommandSpec, FormCheck, ParamSpec, Refusal } from '../../language/table';
import type { ClothDef, ClothKind, PinDef } from '../../physics/cloth';
import { CLOTH_DEFAULTS, MAX_CLOTH_POINTS, MAX_PINS, MAX_ROPE, MAX_SHEET, MAX_SHEET_U, pinWord, sheetPoints } from '../../physics/cloth';
import type { BodySpec3 } from './body3';
import type { BodySpec } from './types';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    Cloth: true;
    Pin: true;
  }
}
declare module '../../contracts/errors' {
  interface AreaErrorKinds {
    not_a_cloth: true;
    pin_off_cloth: true;
  }
  interface AreaNoticeKinds {
    torn: true;
    cloth_drawn_coarse: true;
  }
}

/** What a cloth is made from. Equal specs give the same film. */
export interface ClothSpec {
  readonly kind: ClothKind;
  readonly space: boolean;
  readonly nu: number;
  readonly nv: number;
  /** Start places, x y z for each point, row by row (z is 0 in the plane). */
  readonly pos: readonly number[];
  readonly mass: number;
  readonly stretch: number;
  readonly bend: number;
  readonly damping: number;
  /** 0: the links never tear. */
  readonly tears: number;
  readonly self: boolean;
  readonly thickness: number;
  readonly friction: number;
  /** The points `pins` holds still at the start. */
  readonly pins: readonly number[];
  /** How `pins` was written, for the row ("pinned on the left"). */
  readonly pinWords: string;
}

/** A cloth's value: its start, and its points now (written by the driver). */
export interface ClothValue {
  readonly schema: 'Cloth';
  readonly spec: ClothSpec;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly zs: Float64Array;
  /**
   * What tore, 1 each; empty before the film runs. In space the faces with a torn side, two a cell row by row (the
   * cell (i, j) has faces 2 (j (nu − 1) + i) and the next). In the plane the torn threads: along u first, (nu − 1) × nv,
   * index j (nu − 1) + i, then along v, nu × (nv − 1), index j nu + i.
   */
  readonly cut: Uint8Array;
  readonly torn: number;
  readonly stretchMax: number;
  readonly energy: number;
  readonly asleep: boolean;
  readonly touching: readonly string[];
  /** Where each pin holds its point now (x y z each), for drawing. */
  readonly pinsAt: readonly number[];
}

/** A pin: the cloth point nearest `at`, held still or to a body (design 2.4). */
export interface PinValue {
  readonly schema: 'Pin';
  readonly cloth: ClothSpec;
  readonly point: number;
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  /** The body it is held to: its start (as joints name their ends). */
  readonly body?: BodySpec | BodySpec3;
  readonly space: boolean;
}

export function isClothValue(v: unknown): v is ClothValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Cloth';
}

export function isPinValue(v: unknown): v is PinValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Pin';
}

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string): ParamSpec => P(name, type, { optional: true, named: true });
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const NAMED = [named('mass', 'Number'), named('stretch', 'Number'), named('bend', 'Number'), named('damping', 'Number'), named('pins', 'Text|List'), named('tears', 'Number'), named('self', 'Bool'), named('thickness', 'Number'), named('friction', 'Number')];

/** Ranges of the named arguments (design 2.4, errors B004). */
const RANGES: Readonly<Record<string, { lo: number; hi: number; open?: boolean; allowed: string; hint: string }>> = {
  mass: { lo: 0, hi: Infinity, open: true, allowed: 'above 0 kg', hint: 'mass is the whole cloth in kg: a flag is about 0.5.' },
  stretch: { lo: 0, hi: 1, allowed: 'between 0 and 1', hint: '1 is cloth, 0.5 is rubber.' },
  bend: { lo: 0, hi: 1, allowed: 'between 0 and 1', hint: '0 is silk, 1 is card.' },
  damping: { lo: 0, hi: 1, allowed: 'between 0 and 1', hint: '0.02 lets a flag settle slowly.' },
  tears: { lo: 1.1, hi: 10, allowed: 'between 1.1 and 10', hint: 'tears = 1.5: a link breaks when stretched to 1.5 times its length.' },
  thickness: { lo: 0.005, hi: 0.2, allowed: 'between 0.005 and 0.2 m', hint: '0.02 m keeps the cloth just off what it lies on.' },
  friction: { lo: 0, hi: 2, allowed: 'between 0 and 2', hint: '0.4 is cloth on wood.' },
};
const NAMES = ['mass', 'stretch', 'bend', 'damping', 'pins', 'tears', 'self', 'thickness', 'friction'];

/** Literal values that can never work (errors B004, B013, B017). `first` is the index of `mass`; `sides` the grid. */
function checkCloth(c: FormCheck, first: number, sides: readonly number[], rope: boolean): Refusal | undefined {
  const lit = (i: number): number | undefined => {
    const a = c.args[i];
    return a && !a.omitted && typeof a.literal === 'number' ? a.literal : undefined;
  };
  const n = sides.map(lit);
  for (let k = 0; k < sides.length; k++) {
    const v = n[k];
    if (v !== undefined && !(v >= 2)) return { kind: 'bad_argument', message: rope ? 'A rope needs at least 2 points.' : 'A cloth needs at least 2 points a side.', hint: rope ? 'Try 40 points: Cloth(A, B, 40).' : 'Try 32 by 32.', param: sides[k] as number, params: { command: 'Cloth', why: 'fewer than 2 points a side' } };
  }
  if (rope) {
    const v = n[0];
    if (v !== undefined && v > MAX_ROPE) return { kind: 'limit', message: `A rope can have at most ${MAX_ROPE} points. This line asks for ${v}.`, hint: '100 points already bend smoothly.', param: sides[0] as number, params: { max: MAX_ROPE, what: 'points in a rope' }, limit: { name: 'rope points', max: MAX_ROPE, got: v } };
  } else {
    const [a, b] = n;
    if (a !== undefined && b !== undefined && (a * b > MAX_SHEET || Math.max(a, b) > MAX_SHEET_U)) {
      return { kind: 'limit', message: `A cloth can have at most 64 by 32 points. This line asks for ${a} by ${b}.`, hint: 'Use fewer points: 32 × 32 looks smooth and costs half.', param: sides[0] as number, params: { max: MAX_SHEET, what: 'points in a cloth (64 by 32)' }, limit: { name: 'cloth points', max: MAX_SHEET, got: a * b } };
    }
  }
  for (let k = 0; k < NAMES.length; k++) {
    const name = NAMES[k] as string;
    const r = RANGES[name];
    if (!r) continue;
    const v = lit(first + k);
    if (v === undefined) continue;
    const ok = r.open ? v > r.lo && v <= r.hi : v >= r.lo && v <= r.hi;
    if (!ok) return { kind: 'bad_property_value', message: `${name} must be ${r.allowed}.`, hint: r.hint, param: first + k, params: { key: name, allowed: r.allowed } };
  }
  const pins = c.args[first + 4];
  if (pins && !pins.omitted) {
    if (typeof pins.literal === 'string' && !['top', 'left', 'corners', 'top corners'].includes(pins.literal.trim().toLowerCase().replace(/\s+/g, ' '))) {
      return { kind: 'bad_property_value', message: `pins = "${pins.literal}" is not one of the words pins takes.`, hint: 'Write pins = "top", "left", "corners" or "top corners", or a list of points.', param: first + 4, params: { key: 'pins', allowed: '"top", "left", "corners", "top corners" or a list of points' } };
    }
    if (Array.isArray(pins.literal) && pins.literal.length > MAX_PINS) {
      return { kind: 'limit', message: `A cloth can have at most ${MAX_PINS} pins. This line asks for ${pins.literal.length}.`, hint: 'Pin a whole edge with pins = "top".', param: first + 4, params: { max: MAX_PINS, what: 'pins on a cloth' }, limit: { name: 'pins', max: MAX_PINS, got: pins.literal.length } };
    }
  }
  return undefined;
}

/** `u` and `v` along one line (errors B017), when both are written as literals. */
function checkSides(c: FormCheck): Refusal | undefined {
  const v3 = (i: number): { x: number; y: number; z: number } | undefined => {
    const a = c.args[i];
    const l = a && !a.omitted ? (a.literal as { x?: unknown; y?: unknown; z?: unknown } | undefined) : undefined;
    return l && typeof l.x === 'number' && typeof l.y === 'number' && typeof l.z === 'number' ? { x: l.x, y: l.y, z: l.z } : undefined;
  };
  const u = v3(1);
  const v = v3(2);
  if (!u || !v) return undefined;
  const cx = u.y * v.z - u.z * v.y;
  const cy = u.z * v.x - u.x * v.z;
  const cz = u.x * v.y - u.y * v.x;
  const lu = Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z);
  const lv = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (Math.sqrt(cx * cx + cy * cy + cz * cz) <= 1e-9 * Math.max(1e-12, lu * lv)) {
    return { kind: 'bad_argument', message: 'The two sides of a cloth must not be along one line.', hint: 'Give two sides at an angle, such as (3, 0, 0) and (0, 0, -2).', param: 2, params: { command: 'Cloth', why: 'u and v are along one line' } };
  }
  return undefined;
}

/** The common part of a cloth's spec from the named arguments. */
function named9(vals: readonly unknown[], at: number, pos: Float64Array, nu: number, nv: number, dim: 2 | 3, call: RuleCall): Omit<ClothSpec, 'kind' | 'space' | 'nu' | 'nv' | 'pos'> | { fail: unknown } {
  const [mass, stretch, bend, damping, pins, tears, self, thickness, friction] = vals.slice(at);
  let pinIdx: number[] = [];
  let pinWords = '';
  if (typeof pins === 'string') {
    const p = pinWord(pins, pos, nu, nv, dim);
    if (!p) return { fail: call.fail('input_undefined', `pins = "${pins}" is not top, left, corners or top corners`) };
    pinIdx = p;
    pinWords = pins.trim().toLowerCase().replace(/\s+/g, ' ');
  } else if (Array.isArray(pins)) {
    for (const q of pins as { x?: unknown; y?: unknown; z?: unknown }[]) {
      if (typeof q?.x !== 'number' || typeof q.y !== 'number') return { fail: call.fail('input_undefined', 'a pin point is undefined') };
      const i = nearestOf(pos, q.x, q.y, typeof q.z === 'number' ? q.z : 0);
      if (!pinIdx.includes(i)) pinIdx.push(i);
    }
    pinIdx = pinIdx.slice(0, MAX_PINS);
    pinWords = `${pinIdx.length} point${pinIdx.length === 1 ? '' : 's'}`;
  }
  const t = num(tears, 0);
  return {
    mass: num(mass, CLOTH_DEFAULTS.mass) > 0 ? num(mass, CLOTH_DEFAULTS.mass) : CLOTH_DEFAULTS.mass,
    stretch: clamp(num(stretch, CLOTH_DEFAULTS.stretch), 0, 1),
    bend: clamp(num(bend, CLOTH_DEFAULTS.bend), 0, 1),
    damping: clamp(num(damping, CLOTH_DEFAULTS.damping), 0, 1),
    tears: t > 0 ? clamp(t, 1.1, 10) : 0,
    self: self === true,
    thickness: clamp(num(thickness, CLOTH_DEFAULTS.thickness), 0.005, 0.2),
    friction: clamp(num(friction, CLOTH_DEFAULTS.friction), 0, 2),
    pins: pinIdx.sort((a, b) => a - b),
    pinWords,
  };
}

function nearestOf(pos: ArrayLike<number>, x: number, y: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i * 3 < pos.length; i++) {
    const dx = (pos[i * 3] as number) - x;
    const dy = (pos[i * 3 + 1] as number) - y;
    const dz = (pos[i * 3 + 2] as number) - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function build(call: RuleCall, kind: ClothKind, space: boolean, pos: Float64Array, nu: number, nv: number, at: number): unknown {
  const rest = named9(call.values, at, pos, nu, nv, space ? 3 : 2, call);
  if ('fail' in rest) return rest.fail;
  return startValue({ kind, space, nu, nv, pos: Array.from(pos), ...rest });
}

/** The start: the points where the cloth is made, so it shows before the film runs. */
export function startValue(spec: ClothSpec): ClothValue {
  const n = spec.nu * spec.nv;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = spec.pos[i * 3] as number;
    ys[i] = spec.pos[i * 3 + 1] as number;
    zs[i] = spec.pos[i * 3 + 2] as number;
  }
  const pinsAt: number[] = [];
  for (const i of spec.pins) pinsAt.push(spec.pos[i * 3] as number, spec.pos[i * 3 + 1] as number, spec.pos[i * 3 + 2] as number);
  let e = 0;
  const g = spec.space ? -9.8 : -9.8;
  const m = spec.mass / n;
  for (let i = 0; i < n; i++) e -= m * g * (spec.space ? (spec.pos[i * 3 + 2] as number) : (spec.pos[i * 3 + 1] as number));
  return { schema: 'Cloth', spec, xs, ys, zs, cut: new Uint8Array(0), torn: 0, stretchMax: 1, energy: e, asleep: false, touching: [], pinsAt };
}

/** The engine's definition of a cloth, with the pins of `Pin` lines added (body: the world index, −1 the world). */
export function clothDef(spec: ClothSpec, extra: readonly PinDef[]): ClothDef {
  const pins: PinDef[] = spec.pins.map((point) => ({ point, body: -1 }));
  for (const p of extra) {
    const had = pins.findIndex((q) => q.point === p.point);
    if (had >= 0) pins[had] = p;
    else pins.push(p);
  }
  pins.sort((a, b) => a.point - b.point);
  return {
    kind: spec.kind, nu: spec.nu, nv: spec.nv, pos: Float64Array.from(spec.pos), mass: spec.mass, stretch: spec.stretch, bend: spec.bend, damping: spec.damping,
    tears: spec.tears, self: spec.self, thickness: spec.thickness, friction: spec.friction, pins: pins.slice(0, MAX_PINS),
  };
}

/** `Pin(c, P)` where c is not a cloth (errors B018). */
function refusePin(c: CallCheck): Refusal | undefined {
  const a = c.args[0];
  if (a && !a.omitted && !/^Cloth/.test(a.type)) {
    const at = c.args[1]?.text ?? 'P';
    const isBody = /^Body/.test(a.type);
    return {
      kind: 'not_a_cloth', message: `Pin holds a cloth, and ${a.text} is a ${a.type.replace(/<.*$/, '').toLowerCase()}.`, param: 0,
      hint: isBody ? `Pin holds a cloth. To hold a body, use Hinge(${a.text}, wall, ${at}).` : 'Pin holds a cloth: Pin(flag, (0, 0, 3)).',
      ...(isBody ? { suggest: [`Hinge(${a.text}, wall, ${at})`] } : {}),
      params: { why: `${a.text} is not a cloth` },
    };
  }
  return undefined;
}

/** `Pin(c, P)` with a literal point further than one link from every point of c (errors B019). */
function checkPin(c: FormCheck): Refusal | undefined {
  const cl = c.args[0]?.value;
  const p = c.args[1];
  if (!isClothValue(cl) || !p || p.omitted) return undefined;
  const l = p.literal as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (!l || typeof l.x !== 'number' || typeof l.y !== 'number') return undefined;
  const s = cl.spec;
  const z = typeof l.z === 'number' ? l.z : 0;
  const i = nearestOf(s.pos, l.x, l.y, z);
  const d = Math.sqrt(((s.pos[i * 3] as number) - l.x) ** 2 + ((s.pos[i * 3 + 1] as number) - l.y) ** 2 + ((s.pos[i * 3 + 2] as number) - z) ** 2);
  // one link: the longest step between neighbouring points
  let link = 0;
  for (let k = 0; k + 1 < s.nu; k++) link = Math.max(link, dist(s.pos, k, k + 1));
  if (s.nv > 1) link = Math.max(link, dist(s.pos, 0, s.nu));
  if (d <= link * (1 + 1e-9) + 1e-12) return undefined;
  const near = s.space ? `(${f3(s.pos[i * 3])}, ${f3(s.pos[i * 3 + 1])}, ${f3(s.pos[i * 3 + 2])})` : `(${f3(s.pos[i * 3])}, ${f3(s.pos[i * 3 + 1])})`;
  return {
    kind: 'pin_off_cloth', message: `${p.text} is ${f3(d)} m from the cloth: its nearest point is ${near}.`, param: 1,
    hint: 'Pin at a point on the cloth, such as a corner, or use pins = "top".', replaceArg: near, params: { why: `${p.text} is ${f3(d)} m from the nearest point ${near}` },
  };
}

const f3 = (x: unknown): string => String(Number((x as number).toFixed(3)));

function dist(pos: readonly number[], a: number, b: number): number {
  return Math.sqrt(((pos[a * 3] as number) - (pos[b * 3] as number)) ** 2 + ((pos[a * 3 + 1] as number) - (pos[b * 3 + 1] as number)) ** 2 + ((pos[a * 3 + 2] as number) - (pos[b * 3 + 2] as number)) ** 2);
}

function pinRule(call: RuleCall, space: boolean): unknown {
  const [c, at, body] = call.values;
  if (!isClothValue(c)) return call.fail('input_undefined', 'the cloth is undefined');
  const p = at as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (typeof p?.x !== 'number' || typeof p.y !== 'number') return call.fail('input_undefined', 'the pin point is undefined');
  const z = typeof p.z === 'number' ? p.z : 0;
  const b = body as { spec?: BodySpec | BodySpec3 } | undefined;
  if (body !== undefined && !b?.spec) return call.fail('input_undefined', 'the body is undefined');
  const point = nearestOf(c.spec.pos, p.x, p.y, z);
  return { schema: 'Pin', cloth: c.spec, point, at: { x: p.x, y: p.y, z }, ...(b?.spec ? { body: b.spec } : {}), space } satisfies PinValue;
}

/** A cloth in space pinned to a flat body, or a rope pinned to a body in space (errors B010). */
function mixedPin(c: FormCheck): Refusal | undefined {
  const a = c.args[0];
  const b = c.args[2];
  if (!a || !b || b.omitted) return undefined;
  const clothSpace = isClothValue(a.value) ? a.value.spec.space : undefined;
  const bodySpace = /^Body3/.test(b.type) ? true : /^Body/.test(b.type) ? false : undefined;
  if (clothSpace === undefined || bodySpace === undefined || clothSpace === bodySpace) return undefined;
  return {
    kind: 'mixed_dimension', message: clothSpace ? `${a.text} is a cloth in space, and ${b.text} is a body in the plane.` : `${a.text} is a cloth in the plane, and ${b.text} is a body in space.`, param: 2,
    hint: 'Pin a cloth to a body of its own kind: in space, a Body of a solid.', params: { why: 'a cloth and a body of different dimensions' },
  };
}

export const CLOTH_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Cloth',
    kind: 'object',
    group: 'physics',
    forms: [
      {
        params: [P('corner', 'Point3'), P('u', 'Vector3|Point3'), P('v', 'Vector3|Point3'), P('nu', 'Number'), P('nv', 'Number'), ...NAMED],
        returns: 'Cloth',
        summary: 'a sheet of nu by nv points spanning corner + s u + r v in space: it hangs, drapes and waves in the wind',
        explain: '{name} is a cloth of {3} by {4} points from {0}',
        check: (c) => checkCloth(c, 5, [3, 4], false) ?? checkSides(c),
        rule: () => ({
          run(call: RuleCall) {
            const [corner, u, v, nu, nv] = call.values;
            const p = corner as { x?: unknown; y?: unknown; z?: unknown } | undefined;
            const a = u as { x?: unknown; y?: unknown; z?: unknown } | undefined;
            const b = v as { x?: unknown; y?: unknown; z?: unknown } | undefined;
            if (![p?.x, p?.y, p?.z, a?.x, a?.y, a?.z, b?.x, b?.y, b?.z].every((x) => typeof x === 'number' && Number.isFinite(x))) return call.fail('input_undefined', "the cloth's corner or sides are undefined");
            const ku = Math.round(num(nu, 0));
            const kv = Math.round(num(nv, 0));
            if (!(ku >= 2 && kv >= 2)) return call.fail('degenerate', 'a cloth needs at least 2 points a side');
            if (ku * kv > MAX_SHEET || Math.max(ku, kv) > MAX_SHEET_U) return call.fail('degenerate', 'a cloth has at most 64 by 32 points');
            const [cx, cy, cz, ux, uy, uz, vx, vy, vz] = [p?.x, p?.y, p?.z, a?.x, a?.y, a?.z, b?.x, b?.y, b?.z] as number[] as [number, number, number, number, number, number, number, number, number];
            const crx = uy * vz - uz * vy;
            const cry = uz * vx - ux * vz;
            const crz = ux * vy - uy * vx;
            if (!(crx * crx + cry * cry + crz * crz > 1e-18)) return call.fail('degenerate', 'the two sides are along one line');
            return build(call, 'sheet', true, sheetPoints(cx, cy, cz, ux, uy, uz, vx, vy, vz, ku, kv), ku, kv, 5);
          },
        }),
      },
      {
        params: [P('a', 'Point'), P('b', 'Point'), P('n', 'Number'), ...NAMED],
        returns: 'Cloth',
        summary: 'a rope of n points from a to b in the plane that bends, swings and drapes',
        explain: '{name} is a rope of {2} points from {0} to {1}',
        check: (c) => checkCloth(c, 3, [2], true),
        rule: () => ({
          run(call: RuleCall) {
            const [a, b, n] = call.values;
            const p = a as { x?: unknown; y?: unknown } | undefined;
            const q = b as { x?: unknown; y?: unknown } | undefined;
            if (![p?.x, p?.y, q?.x, q?.y].every((x) => typeof x === 'number' && Number.isFinite(x))) return call.fail('input_undefined', "the rope's ends are undefined");
            const k = Math.round(num(n, 0));
            if (!(k >= 2)) return call.fail('degenerate', 'a rope needs at least 2 points');
            if (k > MAX_ROPE) return call.fail('degenerate', `a rope has at most ${MAX_ROPE} points`);
            const [ax, ay, bx, by] = [p?.x, p?.y, q?.x, q?.y] as number[] as [number, number, number, number];
            if (ax === bx && ay === by) return call.fail('degenerate', 'the two ends are at one point');
            return build(call, 'rope', false, sheetPoints(ax, ay, 0, bx - ax, by - ay, 0, 0, 0, 0, k, 1), k, 1, 3);
          },
        }),
      },
      {
        params: [P('box', 'Polygon'), P('nu', 'Number'), P('nv', 'Number'), ...NAMED],
        returns: 'Cloth',
        summary: 'a net of nu by nv points over a box in the plane, seen from the side: a curtain or a hammock',
        explain: '{name} is a net of {1} by {2} points over {0}',
        check: (c) => checkCloth(c, 3, [1, 2], false),
        rule: () => ({
          run(call: RuleCall) {
            const [box, nu, nv] = call.values;
            const pts = (box as { pts?: readonly { x: number; y: number }[] } | undefined)?.pts;
            if (!pts || pts.length < 3 || !pts.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return call.fail('input_undefined', 'the box is undefined');
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            for (const q of pts) {
              x0 = Math.min(x0, q.x);
              x1 = Math.max(x1, q.x);
              y0 = Math.min(y0, q.y);
              y1 = Math.max(y1, q.y);
            }
            if (!(x1 > x0 && y1 > y0)) return call.fail('degenerate', 'the box has no area');
            const ku = Math.round(num(nu, 0));
            const kv = Math.round(num(nv, 0));
            if (!(ku >= 2 && kv >= 2)) return call.fail('degenerate', 'a net needs at least 2 points a side');
            if (ku * kv > MAX_SHEET || Math.max(ku, kv) > MAX_SHEET_U) return call.fail('degenerate', 'a net has at most 64 by 32 points');
            // row 0 along the top, from the left
            return build(call, 'net', false, sheetPoints(x0, y1, 0, x1 - x0, 0, 0, 0, y0 - y1, 0, ku, kv), ku, kv, 3);
          },
        }),
      },
    ],
  },
  {
    name: 'Pin',
    kind: 'object',
    group: 'physics',
    refuse: refusePin,
    forms: [
      {
        params: [P('c', 'Cloth'), P('at', 'Point|Point3')],
        returns: 'Pin',
        summary: 'holds the cloth point nearest a point still',
        explain: '{name} pins {0} at {1}',
        check: checkPin,
        rule: () => ({ run: (call: RuleCall) => pinRule(call, isClothValue(call.values[0]) ? call.values[0].spec.space : false) }),
      },
      {
        params: [P('c', 'Cloth'), P('at', 'Point|Point3'), P('b', 'Body|Body3')],
        returns: 'Pin',
        summary: 'holds the cloth point nearest a point to a body: the cloth moves with it and pulls on it',
        explain: '{name} pins {0} to {2} at {1}',
        check: (c) => mixedPin(c) ?? checkPin(c),
        rule: () => ({ run: (call: RuleCall) => pinRule(call, isClothValue(call.values[0]) ? call.values[0].spec.space : false) }),
      },
    ],
  },
];

/* ------------------------------ limits of the figure (errors B013) ------------------------------ */

/** How many points a `Cloth` line asks for, and whether it hits itself, when its sizes are numbers in the line. */
function asked(expr: unknown): { points: number; self: boolean } | undefined {
  const e = expr as { n?: string; spec?: { name?: string }; form?: { params?: readonly { type: string }[] }; args?: readonly ({ name?: string; expr?: { n?: string; v?: unknown } } | undefined)[] } | undefined;
  if (e?.n !== 'command' || e.spec?.name !== 'Cloth') return undefined;
  const lit = (i: number): number | undefined => {
    const a = e.args?.[i]?.expr;
    return a?.n === 'num' && typeof a.v === 'number' ? Math.round(a.v) : undefined;
  };
  const first = e.form?.params?.[0]?.type ?? '';
  let points: number | undefined;
  let selfAt = -1;
  if (first === 'Point3') {
    const a = lit(3);
    const b = lit(4);
    points = a !== undefined && b !== undefined ? a * b : undefined;
    selfAt = 11;
  } else if (first === 'Point') {
    points = lit(2);
    selfAt = 9;
  } else {
    const a = lit(1);
    const b = lit(2);
    points = a !== undefined && b !== undefined ? a * b : undefined;
    selfAt = 9;
  }
  if (points === undefined) return undefined;
  const s = e.args?.[selfAt]?.expr as { n?: string; v?: unknown } | undefined;
  return { points, self: s?.v === true };
}

interface FigureObjects {
  objects(): readonly { readonly id: unknown; readonly type: string; readonly cell: { readonly defined: boolean; readonly value?: unknown } }[];
}

/** All cloths of a figure hold at most 4,096 points, one cloth may hit itself, a cloth has at most 64 pins (B013). */
export function clothLineCheck(figure: unknown, line: CheckedLine): ErrorObject | undefined {
  if (line.op !== 'add' && line.op !== 'redefine') return undefined;
  const at = { line: line.line, col: 1, endCol: 1 };
  const e = line.expr as { n?: string; spec?: { name?: string } } | undefined;
  if (e?.n === 'command' && e.spec?.name === 'Pin') {
    // a 65th pin on one cloth: the pins it was made with and the Pin lines on it
    return pinLimit(figure as FigureObjects, line, at);
  }
  const a = asked(line.expr);
  if (!a) return undefined;
  let others = 0;
  let selfOthers = 0;
  for (const o of (figure as FigureObjects).objects()) {
    if (o.type !== 'Cloth' || o.id === line.existing) continue;
    if (!o.cell.defined || !isClothValue(o.cell.value)) continue;
    others += o.cell.value.spec.nu * o.cell.value.spec.nv;
    if (o.cell.value.spec.self) selfOthers++;
  }
  if (others + a.points > MAX_CLOTH_POINTS) {
    return err('limit', at, { max: MAX_CLOTH_POINTS, what: 'cloth points in a figure', limit: 'cloth points', got: others + a.points }, {
      hint: `The other cloths already have ${others} points, so this one can have at most ${Math.max(0, MAX_CLOTH_POINTS - others)}.`, recovery: 'rewrite', fingerprintKey: 'limit:cloth',
    });
  }
  if (a.self && selfOthers > 0) {
    return err('limit', at, { max: 1, what: 'cloth with self = true in a figure', limit: 'self cloths', got: selfOthers + 1 }, {
      hint: 'Only one cloth of a figure may hit itself: leave self out of this one.', recovery: 'rewrite', fingerprintKey: 'limit:cloth-self',
    });
  }
  return undefined;
}

function pinLimit(figure: FigureObjects, line: CheckedLine, at: { line: number; col: number; endCol: number }): ErrorObject | undefined {
  const objs = figure.objects();
  // the cloth the line names first: count its pins
  const ref = (line.expr as { args?: readonly ({ expr?: { n?: string; id?: unknown } } | undefined)[] }).args?.[0]?.expr;
  if (ref?.n !== 'ref') return undefined;
  const cell = objs.find((o) => o.id === ref.id)?.cell;
  const cloth = cell?.defined ? cell.value : undefined;
  if (!isClothValue(cloth)) return undefined;
  let n = cloth.spec.pins.length;
  for (const o of objs) if (o.type === 'Pin' && o.id !== line.existing && o.cell.defined && isPinValue(o.cell.value) && o.cell.value.cloth === cloth.spec) n++;
  if (n + 1 <= MAX_PINS) return undefined;
  return err('limit', at, { max: MAX_PINS, what: 'pins on a cloth', limit: 'pins', got: n + 1 }, { hint: 'Pin a whole edge with pins = "top".', recovery: 'rewrite', fingerprintKey: 'limit:pins' });
}
