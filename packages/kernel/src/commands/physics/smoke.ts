/**
 * Smoke in the plane (docs/features/physics/design.md 2.4, 9.4; errors.md B004, B013, B017): `Smoke(region, n)` with
 * named `source`, `heat`, `wind` and `until`.
 *
 * The rule gives the start (the box, the grid, where smoke is made); the plane driver (`./driver`) owns the grid and
 * writes the smoke's density into the value after each pass.
 */
import type { ErrorObject } from '../../contracts/errors';
import { err } from '../../errors/table';
import type { RuleCall } from '../../graph/registry';
import type { CheckedLine } from '../../language/check';
import type { CommandSpec, FormCheck, ParamSpec, Refusal } from '../../language/table';
import { FLAME_AT, FUEL_GONE, IGNITE_AT, flameCells, fuelSum, hottest } from '../../physics/fire2';
import { flameCells3, fuelSum3, hottest3 } from '../../physics/fire3';
import type { SmokeSource2 } from '../../physics/smoke2';
import { Smoke2, markSource } from '../../physics/smoke2';
import type { SmokeSource3 } from '../../physics/smoke3';
import { Smoke3, markSource3 } from '../../physics/smoke3';
import { shape3Of } from '../space/types';
import type { Polyhedron, Sphere3 } from '../space/types';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    Smoke: true;
  }
}

/** The finest grid, and all smoke grids of a figure together (design 11.3). */
export const SMOKE_MAX_N = 64;
export const SMOKE_MAX_CELLS = SMOKE_MAX_N * SMOKE_MAX_N;
/** The coarsest grid that still shows a flow. */
export const SMOKE_MIN_N = 4;
/** `heat` is m/s² of lift for thick smoke; past this the plume leaves the box in a few steps. */
export const SMOKE_MAX_HEAT = 50;
/** `wind`: each part at most this many m/s (a hurricane is about 70). */
export const SMOKE_MAX_WIND = 100;
/** Lift of thick smoke when a source is given and `heat` is not: warm smoke rises slowly. */
export const SMOKE_DEFAULT_HEAT = 2;

/** What a smoke grid is made from. Equal specs give the same film. */
export interface SmokeSpec {
  /** The box the grid covers: the bounding box of the region. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly n: number;
  readonly source?: SmokeSource2;
  readonly heat: number;
  /** The smoke's own wind; without it the grid feels `world.wind`. */
  readonly wind?: { readonly x: number; readonly y: number };
  /** The source makes smoke while the film time is before this (seconds); Infinity for all the film. */
  readonly until: number;
  /** Curls kept by vorticity confinement (0 to 10); left out when 0, so a smoke without it has its old spec. */
  readonly swirl?: number;
  /** A fire grid's settings (design 9.7); left out for smoke. */
  readonly fire?: FireSpec;
  /**
   * In space (design 9.8; left out in the plane, so a smoke in the plane has its old spec): the grid is `n` cells a side
   * over the box from (x0, y0, z0) to (x1, y1, z1), the source is `source3` and the wind has a z part. `source` is not used.
   */
  readonly space?: true;
  readonly z0?: number;
  readonly z1?: number;
  readonly source3?: SmokeSource3;
  readonly windZ?: number;
}

/** What a `Fire` adds to a smoke grid's spec (design 9.7). */
export interface FireSpec {
  readonly fuel: number;
  readonly burn: number;
  /** The hottest a flame gets, °C. */
  readonly heat: number;
  readonly smoke: number;
  /** A crackle that follows how much burns. */
  readonly sound: boolean;
}

/** A smoke grid's value: its start, and its smoke now (written by the driver). */
export interface SmokeValue {
  readonly schema: 'Smoke';
  readonly spec: SmokeSpec;
  /** Smoke density in each cell, row by row from the bottom left (n × n; 1 is thick). */
  readonly density: Float32Array;
  /** How much smoke there is: density times area, m². */
  readonly mass: number;
  /** The fastest air in the box, m/s. */
  readonly speed: number;
}

/** A fire's value: a smoke value with the temperature of each cell and what is burning (design 9.7). */
export interface FireValue extends SmokeValue {
  readonly spec: SmokeSpec & { readonly fire: FireSpec };
  /** Temperature in each cell, °C above the air, laid out as `density`. */
  readonly temp: Float32Array;
  /** The hottest cell, °C. */
  readonly hottest: number;
  /** Some cell is above 500 °C. */
  readonly burning: boolean;
  /** Fuel in the grid: Σ F × dx × dy. */
  readonly fuel: number;
  /** Cells above 500 °C. */
  readonly flames: number;
  /** The fire has been alight and is out (no source, nothing above 150 °C, no fuel). */
  readonly out: boolean;
}

export function isSmokeValue(v: unknown): v is SmokeValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Smoke';
}

export function isFireValue(v: unknown): v is FireValue {
  return isSmokeValue(v) && v.spec.fire !== undefined && (v as { temp?: unknown }).temp instanceof Float32Array;
}

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string): ParamSpec => P(name, type, { optional: true, named: true });
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A source: a point, a circle or a polygon, from its value. */
export function sourceOf(v: unknown): SmokeSource2 | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as { x?: unknown; y?: unknown; cx?: unknown; cy?: unknown; r?: unknown; pts?: unknown };
  if (typeof o.cx === 'number' && typeof o.cy === 'number' && typeof o.r === 'number' && Number.isFinite(o.cx) && Number.isFinite(o.cy) && o.r > 0) return { kind: 'circle', x: o.cx, y: o.cy, r: o.r };
  if (Array.isArray(o.pts) && o.pts.length >= 3) {
    const pts: { x: number; y: number }[] = [];
    for (const p of o.pts as { x?: unknown; y?: unknown }[]) {
      if (typeof p?.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
      pts.push({ x: p.x, y: p.y });
    }
    return { kind: 'poly', pts };
  }
  if (typeof o.x === 'number' && typeof o.y === 'number' && Number.isFinite(o.x) && Number.isFinite(o.y)) return { kind: 'point', x: o.x, y: o.y };
  return undefined;
}

export function boxOf(region: unknown): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const pts = (region as { pts?: unknown } | undefined)?.pts;
  if (!Array.isArray(pts) || pts.length < 3) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts as { x?: unknown; y?: unknown }[]) {
    if (typeof p?.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

/** A grid in space is 4 to 32 cells a side, one grid in space for a figure (design 9.8, 11.3). */
export const SMOKE3_MIN_N = 4;
export const SMOKE3_MAX_N = 32;

/** The bounding box of a solid in space (the region of a grid in space), or undefined for anything else. */
export function box3Of(region: unknown): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | undefined {
  if (shape3Of(region) !== 'Polyhedron') return undefined;
  const verts = (region as Polyhedron).verts;
  if (verts.length === 0) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (const p of verts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return undefined;
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

/** A source in space: a point, a sphere or a convex solid, from its value. */
export function source3Of(v: unknown): SmokeSource3 | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const k = shape3Of(v);
  if (k === 'Sphere') {
    const s = v as Sphere3;
    return s.r > 0 && Number.isFinite(s.c.x + s.c.y + s.c.z) ? { kind: 'sphere', x: s.c.x, y: s.c.y, z: s.c.z, r: s.r } : undefined;
  }
  if (k === 'Polyhedron') {
    const p = v as Polyhedron;
    if (p.verts.length === 0 || p.faces.length === 0) return undefined;
    const planes: number[] = [];
    for (const f of p.faces) {
      const o = p.verts[f.idx[0] as number];
      if (!o) return undefined;
      planes.push(f.normal.x, f.normal.y, f.normal.z, f.normal.x * o.x + f.normal.y * o.y + f.normal.z * o.z);
    }
    let x = 0;
    let y = 0;
    let z = 0;
    for (const q of p.verts) {
      x += q.x;
      y += q.y;
      z += q.z;
    }
    return planes.every(Number.isFinite) ? { kind: 'hull', planes, x: x / p.verts.length, y: y / p.verts.length, z: z / p.verts.length } : undefined;
  }
  const o = v as { x?: unknown; y?: unknown; z?: unknown };
  if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.z === 'number' && Number.isFinite(o.x + o.y + o.z)) return { kind: 'point', x: o.x, y: o.y, z: o.z };
  return undefined;
}

/** Is a smoke or fire value in space? */
export function isSpaceSmoke(v: unknown): boolean {
  return isSmokeValue(v) && v.spec.space === true;
}

/** Literal values of a grid in space that can never work: a grid too fine or too coarse, a box with no volume, heat, wind or until out of range. */
function checkSmoke3(c: FormCheck): Refusal | undefined {
  const lit = (i: number): number | undefined => {
    const a = c.args[i];
    return a && !a.omitted && typeof a.literal === 'number' ? a.literal : undefined;
  };
  const n = lit(1);
  if (n !== undefined && !(n >= SMOKE3_MIN_N && n <= SMOKE3_MAX_N && Number.isInteger(n))) {
    return { kind: 'bad_property_value', message: `n must be a whole number from ${SMOKE3_MIN_N} to ${SMOKE3_MAX_N}.`, hint: 'A grid in space is n cells a side: 24 looks smooth, 32 is the finest.', param: 1, params: { key: 'n', allowed: `a whole number from ${SMOKE3_MIN_N} to ${SMOKE3_MAX_N}` } };
  }
  const r = c.args[0];
  if (r && !r.omitted && r.value !== undefined) {
    const b = box3Of(r.value);
    if (b && !(b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0)) return { kind: 'bad_argument', message: `Smoke(${r.text}): the region has no volume.`, hint: 'Give Smoke a box: Smoke(Box((0, 0, 1), 4, 4, 3), 24).', param: 0, params: { command: 'Smoke', why: 'the region has no volume' } };
  }
  const heat = lit(3);
  if (heat !== undefined && !(Math.abs(heat) <= SMOKE_MAX_HEAT)) return { kind: 'bad_property_value', message: `heat must be between -${SMOKE_MAX_HEAT} and ${SMOKE_MAX_HEAT}.`, hint: 'heat is how hard thick smoke rises, in m/s²: a candle is about 5. Below 0 it sinks.', param: 3, params: { key: 'heat', allowed: `between -${SMOKE_MAX_HEAT} and ${SMOKE_MAX_HEAT}` } };
  const wind = c.args[4];
  if (wind && !wind.omitted) {
    const v = (wind.literal ?? wind.value) as { x?: unknown; y?: unknown; z?: unknown } | undefined;
    if (typeof wind.literal === 'number') return { kind: 'bad_property_value', message: 'wind must be a vector, such as (3, 0, 0).', hint: 'wind is the speed of the air in m/s: (3, 0, 0) blows along x.', param: 4, params: { key: 'wind', allowed: 'a vector such as (3, 0, 0)' } };
    if (v && [v.x, v.y, v.z].some((x) => typeof x === 'number' && !(Math.abs(x) <= SMOKE_MAX_WIND))) {
      return { kind: 'bad_property_value', message: `Each part of the wind must be at most ${SMOKE_MAX_WIND} m/s.`, hint: 'A strong wind is 10 m/s; a hurricane about 70.', param: 4, params: { key: 'wind', allowed: `each part between -${SMOKE_MAX_WIND} and ${SMOKE_MAX_WIND} m/s` } };
    }
  }
  const until = lit(5);
  if (until !== undefined && !(until >= 0)) return { kind: 'bad_property_value', message: 'until must be 0 or more seconds.', hint: 'until = 0 makes one puff at the start; leave it out to keep making smoke.', param: 5, params: { key: 'until', allowed: '0 or more' } };
  const swirl = lit(6);
  if (swirl !== undefined && !(swirl >= 0 && swirl <= SWIRL_MAX)) return swirlRefusal(6);
  return undefined;
}

/** A vector in space (or the plane) as `{x, y, z}` with each part clamped, or undefined when it is not a vector. */
export function wind3Of(wind: unknown): { x: number; y: number; z: number } | undefined {
  const wv = wind as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (typeof wv?.x !== 'number' || typeof wv.y !== 'number' || !Number.isFinite(wv.x) || !Number.isFinite(wv.y)) return undefined;
  const z = typeof wv.z === 'number' && Number.isFinite(wv.z) ? wv.z : 0;
  return { x: clamp(wv.x, SMOKE_MAX_WIND), y: clamp(wv.y, SMOKE_MAX_WIND), z: clamp(z, SMOKE_MAX_WIND) };
}

/** Literal values that can never work: a grid too fine or too coarse, a box with no area, heat or wind out of range. */
function checkSmoke(c: FormCheck): Refusal | undefined {
  const lit = (i: number): number | undefined => {
    const a = c.args[i];
    return a && !a.omitted && typeof a.literal === 'number' ? a.literal : undefined;
  };
  const n = lit(1);
  if (n !== undefined && n > SMOKE_MAX_N) {
    return {
      kind: 'limit', message: `A smoke grid can be at most ${SMOKE_MAX_N} by ${SMOKE_MAX_N}. This line asks for ${n} by ${n}.`, hint: 'Use 48: it looks smooth and costs half as much.', param: 1,
      params: { max: SMOKE_MAX_N, what: 'cells a side of a smoke grid' }, limit: { name: 'smoke grid', max: SMOKE_MAX_N, got: n },
    };
  }
  if (n !== undefined && !(n >= SMOKE_MIN_N && Number.isInteger(n))) {
    return { kind: 'bad_argument', message: `Smoke needs a whole number of cells a side, from ${SMOKE_MIN_N} to ${SMOKE_MAX_N}.`, hint: 'Try Smoke(Box((0, 2), 6, 4), 48).', param: 1, params: { command: 'Smoke', why: `the grid must be a whole number from ${SMOKE_MIN_N} to ${SMOKE_MAX_N}` } };
  }
  const r = c.args[0];
  if (r && !r.omitted && r.value !== undefined) {
    const b = boxOf(r.value);
    if (b && !(b.x1 > b.x0 && b.y1 > b.y0)) return { kind: 'bad_argument', message: `Smoke(${r.text}): the region has no area.`, hint: 'Give Smoke a box: Smoke(Box((0, 2), 6, 4), 48).', param: 0, params: { command: 'Smoke', why: 'the region has no area' } };
  }
  const heat = lit(3);
  if (heat !== undefined && !(Math.abs(heat) <= SMOKE_MAX_HEAT)) return { kind: 'bad_property_value', message: `heat must be between -${SMOKE_MAX_HEAT} and ${SMOKE_MAX_HEAT}.`, hint: 'heat is how hard thick smoke rises, in m/s²: a candle is about 5. Below 0 it sinks.', param: 3, params: { key: 'heat', allowed: `between -${SMOKE_MAX_HEAT} and ${SMOKE_MAX_HEAT}` } };
  const wind = c.args[4];
  if (wind && !wind.omitted) {
    // a vector written in the line is its literal; a bare name, its value now
    const v = (wind.literal ?? wind.value) as { x?: unknown; y?: unknown } | undefined;
    if (typeof wind.literal === 'number') return { kind: 'bad_property_value', message: 'wind must be a vector, such as (3, 0).', hint: 'wind is the speed of the air in m/s: (3, 0) blows to the right.', param: 4, params: { key: 'wind', allowed: 'a vector such as (3, 0)' } };
    if (v && typeof v.x === 'number' && typeof v.y === 'number' && !(Math.abs(v.x) <= SMOKE_MAX_WIND && Math.abs(v.y) <= SMOKE_MAX_WIND)) {
      return { kind: 'bad_property_value', message: `Each part of the wind must be at most ${SMOKE_MAX_WIND} m/s.`, hint: 'A strong wind is 10 m/s; a hurricane about 70.', param: 4, params: { key: 'wind', allowed: `each part between -${SMOKE_MAX_WIND} and ${SMOKE_MAX_WIND} m/s` } };
    }
  }
  const until = lit(5);
  if (until !== undefined && !(until >= 0)) return { kind: 'bad_property_value', message: 'until must be 0 or more seconds.', hint: 'until = 0 makes one puff at the start; leave it out to keep making smoke.', param: 5, params: { key: 'until', allowed: '0 or more' } };
  const swirl = lit(6);
  if (swirl !== undefined && !(swirl >= 0 && swirl <= SWIRL_MAX)) return swirlRefusal(6);
  return undefined;
}

/** `swirl` is 0 to 10 on smoke and fire. */
export const SWIRL_MAX = 10;
export function swirlRefusal(param: number): Refusal {
  return { kind: 'bad_property_value', message: `swirl must be between 0 and ${SWIRL_MAX}.`, hint: 'swirl keeps the curls of the flow: 0 is none, 2 is a lively flame.', param, params: { key: 'swirl', allowed: `between 0 and ${SWIRL_MAX}` } };
}

export const SMOKE_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Smoke',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('region', 'Polygon'), P('n', 'Number'), named('source', 'Point|Circle|Polygon'), named('heat', 'Number'), named('wind', 'Vector|Point'), named('until', 'Number'), named('swirl', 'Number')],
      returns: 'Smoke',
      summary: 'smoke and air on an n by n grid over a box: made at source, lifted by heat, blown by the wind, blocked and stirred by solids and bodies; swirl keeps its curls',
      explain: '{name} is smoke on a {1} by {1} grid over {0}',
      check: checkSmoke,
      rule: () => ({
        run(call: RuleCall) {
          const [region, n, source, heat, wind, until, swirl] = call.values;
          const box = boxOf(region);
          if (!box) return call.fail('input_undefined', 'the region is undefined');
          if (!(box.x1 > box.x0 && box.y1 > box.y0)) return call.fail('degenerate', 'the region has no area');
          if (typeof n !== 'number' || !Number.isFinite(n)) return call.fail('input_undefined', 'the grid size is undefined');
          const src = source === undefined ? undefined : sourceOf(source);
          if (source !== undefined && !src) return call.fail('input_undefined', 'the source is undefined');
          const wv = wind as { x?: unknown; y?: unknown } | undefined;
          const w = typeof wv?.x === 'number' && typeof wv.y === 'number' && Number.isFinite(wv.x) && Number.isFinite(wv.y) ? { x: clamp(wv.x, SMOKE_MAX_WIND), y: clamp(wv.y, SMOKE_MAX_WIND) } : undefined;
          const spec: SmokeSpec = {
            ...box, n: Math.min(SMOKE_MAX_N, Math.max(SMOKE_MIN_N, Math.round(n))),
            ...(src ? { source: src } : {}),
            heat: clamp(num(heat, src ? SMOKE_DEFAULT_HEAT : 0), SMOKE_MAX_HEAT),
            ...(w ? { wind: w } : {}),
            until: typeof until === 'number' && until >= 0 ? until : Infinity,
            ...(typeof swirl === 'number' && swirl > 0 ? { swirl: Math.min(SWIRL_MAX, swirl) } : {}),
          };
          return startValue(spec);
        },
      }),
    }, {
      params: [P('box', 'Polyhedron'), P('n', 'Number'), named('source', 'Point3|Sphere|Polyhedron'), named('heat', 'Number'), named('wind', 'Vector3|Point3'), named('until', 'Number'), named('swirl', 'Number')],
      returns: 'Smoke',
      summary: 'smoke and air in space on an n by n by n grid over the bounding box of a solid (n 4 to 32): made at source, lifted by heat, blown by the wind, blocked and stirred by solids and bodies',
      explain: '{name} is smoke on a {1} by {1} by {1} grid over {0}',
      check: checkSmoke3,
      rule: () => ({
        run(call: RuleCall) {
          const [region, n, source, heat, wind, until, swirl] = call.values;
          const box = box3Of(region);
          if (!box) return call.fail('input_undefined', 'the region is undefined');
          if (!(box.x1 > box.x0 && box.y1 > box.y0 && box.z1 > box.z0)) return call.fail('degenerate', 'the region has no volume');
          if (typeof n !== 'number' || !Number.isFinite(n)) return call.fail('input_undefined', 'the grid size is undefined');
          const src = source === undefined ? undefined : source3Of(source);
          if (source !== undefined && !src) return call.fail('input_undefined', 'the source is undefined');
          const w = wind3Of(wind);
          const spec: SmokeSpec = {
            ...box, n: Math.min(SMOKE3_MAX_N, Math.max(SMOKE3_MIN_N, Math.round(n))), space: true,
            ...(src ? { source3: src } : {}),
            heat: clamp(num(heat, src ? SMOKE_DEFAULT_HEAT : 0), SMOKE_MAX_HEAT),
            ...(w ? { wind: { x: w.x, y: w.y }, windZ: w.z } : {}),
            until: typeof until === 'number' && until >= 0 ? until : Infinity,
            ...(typeof swirl === 'number' && swirl > 0 ? { swirl: Math.min(SWIRL_MAX, swirl) } : {}),
          };
          return startValue3(spec);
        },
      }),
    }],
  },
];

export function clamp(x: number, m: number): number {
  return Math.min(m, Math.max(-m, x));
}

/** The grid of a spec, set up at its start. */
export function smokeGrid(spec: SmokeSpec, windX: number, windY: number): Smoke2 {
  const f = spec.fire;
  const g = new Smoke2({ x0: spec.x0, y0: spec.y0, x1: spec.x1, y1: spec.y1, n: spec.n, ...(f ? { fire: { fuel: f.fuel, burn: f.burn, heat: f.heat, smoke: f.smoke } } : {}) });
  g.heat = spec.heat;
  g.swirl = spec.swirl ?? 0;
  g.setSource(spec.source);
  g.making = spec.until > 0;
  g.start(windX, windY);
  return g;
}

/** The smoke a grid holds now, as a value; a fire's value also holds its temperature. */
export function smokeValue(spec: SmokeSpec, g: Smoke2): SmokeValue {
  const base: SmokeValue = { schema: 'Smoke', spec, density: new Float32Array(g.s), mass: g.mass(), speed: g.maxSpeed() };
  if (!spec.fire) return base;
  const top = hottest(g.T);
  const fuel = fuelSum(g);
  const flames = flameCells(g.T);
  const stopped = !(g.sourced && g.making);
  const fire: FireValue = { ...base, spec: spec as FireValue['spec'], temp: new Float32Array(g.T), hottest: top, burning: flames > 0, fuel, flames, out: g.alive && stopped && !(top > IGNITE_AT) && fuel < FUEL_GONE };
  return fire;
}

/** The grid in space of a spec, set up at its start. */
export function smokeGrid3(spec: SmokeSpec, windX: number, windY: number, windZ: number): Smoke3 {
  const f = spec.fire;
  const g = new Smoke3({ x0: spec.x0, y0: spec.y0, z0: spec.z0 ?? 0, x1: spec.x1, y1: spec.y1, z1: spec.z1 ?? 1, n: spec.n, ...(f ? { fire: { fuel: f.fuel, burn: f.burn, heat: f.heat, smoke: f.smoke } } : {}) });
  g.heat = spec.heat;
  g.swirl = spec.swirl ?? 0;
  g.setSource(spec.source3);
  g.making = spec.until > 0;
  g.start(windX, windY, windZ);
  return g;
}

/** The smoke a grid in space holds now, as a value (`density` and `temp` are copies, so they can be moved to the page). */
export function smokeValue3(spec: SmokeSpec, g: Smoke3): SmokeValue {
  const base: SmokeValue = { schema: 'Smoke', spec, density: new Float32Array(g.s), mass: g.mass(), speed: g.maxSpeed() };
  if (!spec.fire) return base;
  const top = hottest3(g.T);
  const fuel = fuelSum3(g);
  const flames = flameCells3(g.T);
  const stopped = !(g.sourced && g.making);
  const fire: FireValue = { ...base, spec: spec as FireValue['spec'], temp: new Float32Array(g.T), hottest: top, burning: flames > 0, fuel, flames, out: g.alive && stopped && !(top > IGNITE_AT) && fuel < FUEL_GONE };
  return fire;
}

/** The start of a grid in space: the source already full of smoke (a fire: at its heat), as the plane's. */
function startValue3(spec: SmokeSpec): SmokeValue {
  const n = spec.n;
  const N = n * n * n;
  const g = { n, x0: spec.x0, y0: spec.y0, z0: spec.z0 ?? 0, dx: (spec.x1 - spec.x0) / n, dy: (spec.y1 - spec.y0) / n, dz: ((spec.z1 ?? 1) - (spec.z0 ?? 0)) / n };
  const cells = new Uint8Array(N);
  markSource3(cells, g, spec.source3);
  const density = new Float32Array(N);
  const w = spec.wind;
  const speed = Math.max(w ? Math.max(Math.abs(w.x), Math.abs(w.y)) : 0, Math.abs(spec.windZ ?? 0));
  let count = 0;
  for (let c = 0; c < N; c++) if (cells[c] === 1) count++;
  if (spec.fire) {
    const temp = new Float32Array(N);
    let hot = 0;
    if (spec.until > 0) for (let c = 0; c < N; c++) if (cells[c] === 1) {
      temp[c] = spec.fire.heat;
      hot = spec.fire.heat;
    }
    const fire: FireValue = { schema: 'Smoke', spec: spec as FireValue['spec'], density, mass: 0, speed, temp, hottest: hot, burning: hot > FLAME_AT, fuel: 0, flames: hot > FLAME_AT ? count : 0, out: false };
    return fire;
  }
  for (let c = 0; c < N; c++) if (cells[c] === 1) density[c] = 1;
  return { schema: 'Smoke', spec, density, mass: count * g.dx * g.dy * g.dz, speed };
}

/** The start of a fire in space (its rule, `fire.ts`). */
export function fireStart3(spec: SmokeSpec): SmokeValue {
  return startValue3(spec);
}

/** The start: the source already full of smoke (a fire: at its heat), so it shows before the film runs (no grid is made for it). */
function startValue(spec: SmokeSpec): SmokeValue {
  const n = spec.n;
  const dx = (spec.x1 - spec.x0) / n;
  const dy = (spec.y1 - spec.y0) / n;
  const cells = new Uint8Array(n * n);
  markSource(cells, { n, x0: spec.x0, y0: spec.y0, dx, dy }, spec.source);
  const density = new Float32Array(n * n);
  const w = spec.wind;
  const speed = w ? Math.max(Math.abs(w.x), Math.abs(w.y)) : 0;
  if (spec.fire) {
    const temp = new Float32Array(n * n);
    let hot = 0;
    if (spec.until > 0) for (let c = 0; c < cells.length; c++) if (cells[c] === 1) {
      temp[c] = spec.fire.heat;
      hot = spec.fire.heat;
    }
    const fire: FireValue = { schema: 'Smoke', spec: spec as FireValue['spec'], density, mass: 0, speed, temp, hottest: hot, burning: hot > FLAME_AT, fuel: 0, flames: hot > FLAME_AT ? cells.reduce((a, b) => a + b, 0) : 0, out: false };
    return fire;
  }
  let k = 0;
  for (let c = 0; c < cells.length; c++) if (cells[c] === 1) {
    density[c] = 1;
    k++;
  }
  return { schema: 'Smoke', spec, density, mass: k * dx * dy, speed };
}

/** The start of a fire (its rule, `fire.ts`). */
export function fireStart(spec: SmokeSpec): SmokeValue {
  return startValue(spec);
}

/** How many cells a line of `Smoke` or `Fire` asks for, when its grid is a number written in the line. */
function asked(expr: unknown): number | undefined {
  const e = expr as { n?: string; spec?: { name?: string }; form?: { params?: readonly { type: string }[] }; args?: readonly { expr?: { n?: string; v?: number } }[] } | undefined;
  if (e?.n !== 'command') return undefined;
  // a grid in space is counted by its own rule (one grid in space), not against the 64 × 64 of the plane
  if (isSpaceForm(e.form?.params?.[0]?.type)) return undefined;
  if (e.spec?.name === 'Fire' && e.form?.params?.[0]?.type === 'Point') return FIRE_AT_N * FIRE_AT_N;
  if (e.spec?.name !== 'Smoke' && e.spec?.name !== 'Fire') return undefined;
  const a = e.args?.[1]?.expr;
  return a?.n === 'num' && typeof a.v === 'number' ? Math.round(a.v) * Math.round(a.v) : undefined;
}

/** The grid of `Fire(at)`: 48 cells a side. */
export const FIRE_AT_N = 48;

interface FigureObjects {
  objects(): readonly { readonly id: unknown; readonly type: string; readonly cell: { readonly defined: boolean; readonly value?: unknown } }[];
}

/** Is a form's first parameter one of a grid in space (a solid or a point in space)? */
function isSpaceForm(first: string | undefined): boolean {
  return first === 'Polyhedron' || first === 'Point3';
}

/** One smoke or fire grid in space for a figure (design 9.8, 11.3): a second is refused with `limit`. */
export function spaceSmokeLineCheck(figure: unknown, line: CheckedLine): ErrorObject | undefined {
  if (line.op !== 'add' && line.op !== 'redefine') return undefined;
  const e = line.expr as { n?: string; spec?: { name?: string }; form?: { params?: readonly { type: string }[] } } | undefined;
  if (e?.n !== 'command' || (e.spec?.name !== 'Smoke' && e.spec?.name !== 'Fire') || !isSpaceForm(e.form?.params?.[0]?.type)) return undefined;
  let others = 0;
  for (const o of (figure as FigureObjects).objects()) {
    if ((o.type !== 'Smoke' && o.type !== 'Fire') || o.id === line.existing) continue;
    if (o.cell.defined && isSmokeValue(o.cell.value) && isSpaceSmoke(o.cell.value)) others++;
  }
  if (others === 0) return undefined;
  return err('limit', { line: line.line, col: 1, endCol: 1 }, { max: 1, what: 'smoke or fire grids in space in a figure', limit: 'smoke grids in space', got: others + 1 }, {
    hint: 'A figure can have one smoke or fire grid in space. Make one grid bigger instead of two.', recovery: 'rewrite', fingerprintKey: 'limit:smoke3',
  });
}

/** All smoke grids of a figure together have at most 64 × 64 cells (errors B013). */
export function smokeLineCheck(figure: unknown, line: CheckedLine): ErrorObject | undefined {
  if (line.op !== 'add' && line.op !== 'redefine') return undefined;
  const cells = asked(line.expr);
  if (cells === undefined) return undefined;
  let others = 0;
  for (const o of (figure as FigureObjects).objects()) {
    if ((o.type !== 'Smoke' && o.type !== 'Fire') || o.id === line.existing) continue;
    if (o.cell.defined && isSmokeValue(o.cell.value) && !isSpaceSmoke(o.cell.value)) others += o.cell.value.spec.n * o.cell.value.spec.n;
  }
  if (others + cells <= SMOKE_MAX_CELLS) return undefined;
  return err('limit', { line: line.line, col: 1, endCol: 1 }, { max: SMOKE_MAX_CELLS, what: 'smoke and fire cells in a figure (one 64 by 64 grid)', limit: 'smoke cells', got: others + cells }, {
    hint: `The other smoke and fire grids already have ${others} cells, so this one can have at most ${Math.max(0, SMOKE_MAX_CELLS - others)} (${Math.floor(Math.sqrt(Math.max(0, SMOKE_MAX_CELLS - others)))} a side).`, recovery: 'rewrite', fingerprintKey: 'limit:smoke',
  });
}
