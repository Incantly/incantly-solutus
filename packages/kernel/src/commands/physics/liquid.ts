/**
 * Liquid and still water in the plane (docs/features/physics/design.md 2.4, 9.1, 9.2; errors.md B004, B013, B017):
 * `Liquid(region, count)`, `Pour(at, rate, speed)` and `Water(level)`, `Water(region, level)`.
 *
 * The rules give the start (what to fill, where the tap is); the plane driver (`./driver`) owns the drops and writes
 * where they are into each liquid's value after each pass.
 */
import type { ErrorObject } from '../../contracts/errors';
import { err } from '../../errors/table';
import type { RuleCall } from '../../graph/registry';
import type { CheckedLine } from '../../language/check';
import type { CommandSpec, FormCheck, ParamSpec, Refusal } from '../../language/table';
import { MAX_DROPS, fillRegion, restLevel, spacingFor } from '../../physics/fluid2';
import type { Region3 } from '../../physics/fluid3';
import { fillRegion3, restLevel3, spacingFor3 } from '../../physics/fluid3';
import { MAX_WAVE_SIDE, WAVE_DAMPING } from '../../physics/waves';
import { solid3Of } from './body3';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    Liquid: true;
    Water: true;
    Waves: true;
  }
}
declare module '../../contracts/errors' {
  interface AreaNoticeKinds {
    worker_crashed: true;
    cloth_drawn_coarse: true;
  }
}

export interface Pt2 {
  readonly x: number;
  readonly y: number;
}

/** What a liquid is made from: drops that fill a region at the start, or a tap. Equal specs give the same film. */
export interface LiquidSpec {
  readonly kind: 'fill' | 'pour';
  /** `Liquid`: the region and how many drops fill it. */
  readonly region?: readonly Pt2[];
  readonly count: number;
  /** `Pour`: where, how many a second, the speed the drops leave with, and how many in all (`count` is `max`). */
  readonly at?: Pt2;
  readonly rate?: number;
  readonly vx?: number;
  readonly vy?: number;
  /** In space (round 7): the region is a convex solid or a ball, the tap a point in space. */
  readonly region3?: Region3;
  readonly at3?: { readonly x: number; readonly y: number; readonly z: number };
  readonly vz?: number;
  readonly viscosity: number;
  readonly density: number;
  readonly color?: string;
}

/** A liquid's value: its start, and its drops now (written by the driver). */
export interface LiquidValue {
  readonly schema: 'Liquid';
  readonly spec: LiquidSpec;
  /** Drops now, and the height of the surface (NaN with no drops). */
  readonly count: number;
  readonly level: number;
  /** Where each drop is, for drawing (plain numbers, in order). */
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  /** Heights of the drops in space; none in the plane. */
  readonly zs?: Float32Array;
  /** The drops' spacing at rest: they are drawn as discs this wide. */
  readonly size: number;
}

export interface WaterValue {
  readonly schema: 'Water';
  readonly level: number;
  /** The water's walls; none for water everywhere below the level. */
  readonly region?: readonly Pt2[];
  readonly density: number;
}

/**
 * Waves (design 9.3): a height grid of nx × ny cells in space, or nx points along a line in the plane (ny = 1). The
 * driver writes the heights after each step.
 */
export interface WavesValue {
  readonly schema: 'Waves';
  readonly space: boolean;
  readonly nx: number;
  readonly ny: number;
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  /** The water's height at rest (z in space, y in the plane), its depth, and how fast waves die away (per second). */
  readonly level: number;
  readonly depth: number;
  readonly damping: number;
  /**
   * The water's height above the rest level at each cell centre, row by row (j × nx + i): the surface, and under a body
   * the level the body's push holds the water at (its waterline), so the surface reads flat round a floating boat.
   */
  readonly heights: Float32Array;
  /** The wave speed √(g × depth), or the most the grid can carry (written by the driver). */
  readonly speed: number;
  /**
   * The level of the water now: the rest level raised by what bodies moved aside (the mean of `heights`).
   */
  readonly mean: number;
}

export function isWavesValue(v: unknown): v is WavesValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Waves';
}

/** Is a liquid or waves in space? */
export function inSpace(v: unknown): boolean {
  if (isWavesValue(v)) return v.space;
  if (isLiquidValue(v)) return v.spec.region3 !== undefined || v.spec.at3 !== undefined;
  return false;
}

export function isLiquidValue(v: unknown): v is LiquidValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Liquid';
}

export function isWaterValue(v: unknown): v is WaterValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Water';
}

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string): ParamSpec => P(name, type, { optional: true, named: true });
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A tap lets out at most this many drops unless `max` says otherwise. */
export const POUR_MAX = 500;
const DEFAULT_VISCOSITY = 0.01;

function ptsOf(v: unknown): Pt2[] | undefined {
  const p = (v as { pts?: unknown } | undefined)?.pts;
  if (!Array.isArray(p) || p.length < 3) return undefined;
  const out: Pt2[] = [];
  for (const q of p as { x?: unknown; y?: unknown }[]) {
    if (typeof q?.x !== 'number' || typeof q.y !== 'number' || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return undefined;
    out.push({ x: q.x, y: q.y });
  }
  return out;
}

function area(pts: readonly Pt2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt2;
    const q = pts[(i + 1) % pts.length] as Pt2;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

/** Literal values that can never work: no drops, too many, a viscosity out of range (errors B004, B013, B017). */
function checkDrops(c: FormCheck, countAt: number, rateAt: number | undefined, viscAt: number, densAt: number): Refusal | undefined {
  const cmd = c.command;
  const lit = (i: number): number | undefined => {
    const a = c.args[i];
    return a && !a.omitted && typeof a.literal === 'number' ? a.literal : undefined;
  };
  const n = lit(countAt);
  if (n !== undefined && !(n >= 1)) return { kind: 'bad_argument', message: `${cmd} needs at least one drop.`, hint: cmd === 'Pour' ? 'Write max = 300, or leave it out for 500.' : 'Try 500 drops: Liquid(Box((0, 2), 4, 2), 500).', param: countAt, params: { command: cmd, why: 'the number of drops must be at least 1' } };
  if (n !== undefined && n > MAX_DROPS) {
    return { kind: 'limit', message: `A figure can have at most ${MAX_DROPS} drops of liquid. This line asks for ${n}.`, hint: 'Use fewer drops: 1,000 already look like water.', param: countAt, params: { max: MAX_DROPS, what: 'drops of liquid' }, limit: { name: 'drops', max: MAX_DROPS, got: n } };
  }
  const r = rateAt !== undefined ? lit(rateAt) : undefined;
  if (r !== undefined && rateAt !== undefined && !(r > 0)) return { kind: 'bad_argument', message: 'A tap needs a rate above 0 drops a second.', hint: 'Try 60 drops a second.', param: rateAt, params: { command: cmd, why: 'the rate must be above 0' } };
  const v = lit(viscAt);
  if (v !== undefined && (v < 0 || v > 1)) return { kind: 'bad_property_value', message: 'viscosity must be between 0 and 1.', hint: '0.01 is water, 0.3 is like honey.', param: viscAt, params: { key: 'viscosity', allowed: 'between 0 and 1' } };
  const d = lit(densAt);
  if (d !== undefined && !(d > 0)) return { kind: 'bad_property_value', message: 'density must be above 0.', hint: 'Water is 1.', param: densAt, params: { key: 'density', allowed: 'above 0' } };
  return undefined;
}

export const LIQUID_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Liquid',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('region', 'Polygon'), P('count', 'Number'), named('viscosity', 'Number'), named('density', 'Number'), named('color', 'Text')],
      returns: 'Liquid',
      summary: 'liquid drops that fill a region at the start, then flow, splash and push bodies',
      explain: '{name} is a liquid of {1} drops in {0}',
      check: (c) => checkDrops(c, 1, undefined, 2, 3),
      rule: () => ({
        run(call: RuleCall) {
          const [region, count, viscosity, density, color] = call.values;
          const pts = ptsOf(region);
          if (!pts) return call.fail('input_undefined', 'the region is undefined');
          if (!(area(pts) > 0)) return call.fail('degenerate', 'the region has no area');
          const n = Math.round(num(count, 0));
          if (!(n >= 1)) return call.fail('degenerate', 'a liquid needs at least one drop');
          const spec: LiquidSpec = {
            kind: 'fill', region: pts, count: Math.min(MAX_DROPS, n), viscosity: Math.min(1, Math.max(0, num(viscosity, DEFAULT_VISCOSITY))), density: num(density, 1) > 0 ? num(density, 1) : 1,
            ...(typeof color === 'string' && color !== '' ? { color } : {}),
          };
          return startValue(spec);
        },
      }),
    }, {
      params: [P('region', 'Polyhedron|Sphere'), P('count', 'Number'), named('viscosity', 'Number'), named('density', 'Number'), named('color', 'Text')],
      returns: 'Liquid',
      summary: 'liquid drops in space that fill a box or a ball at the start, then flow, splash and push bodies',
      explain: '{name} is a liquid of {1} drops in {0}',
      check: (c) => checkDrops(c, 1, undefined, 2, 3),
      rule: () => ({
        run(call: RuleCall) {
          const [region, count, viscosity, density, color] = call.values;
          const r = solid3Of(region)?.[0];
          if (!r || (r.kind !== 'hull' && r.kind !== 'sphere')) return call.fail('input_undefined', 'the region is undefined');
          const n = Math.round(num(count, 0));
          if (!(n >= 1)) return call.fail('degenerate', 'a liquid needs at least one drop');
          const spec: LiquidSpec = {
            kind: 'fill', region3: r, count: Math.min(MAX_DROPS, n), viscosity: Math.min(1, Math.max(0, num(viscosity, DEFAULT_VISCOSITY))), density: num(density, 1) > 0 ? num(density, 1) : 1,
            ...(typeof color === 'string' && color !== '' ? { color } : {}),
          };
          return startValue(spec);
        },
      }),
    }],
  },
  {
    name: 'Pour',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('at', 'Point'), P('rate', 'Number'), P('speed', 'Number|Vector|Point'), named('max', 'Number'), named('viscosity', 'Number'), named('density', 'Number'), named('color', 'Text')],
      returns: 'Liquid',
      summary: 'a tap at a point: rate drops a second leave it at a speed (a number is straight down), up to max (500)',
      explain: '{name} pours {1} drops a second from {0}',
      check: (c) => checkDrops(c, 3, 1, 4, 5),
      rule: () => ({
        run(call: RuleCall) {
          const [at, rate, speed, max, viscosity, density, color] = call.values;
          const p = at as { x?: unknown; y?: unknown } | undefined;
          if (typeof p?.x !== 'number' || typeof p.y !== 'number') return call.fail('input_undefined', 'the tap is undefined');
          const r = num(rate, 0);
          if (!(r > 0)) return call.fail('degenerate', 'a tap needs a rate above 0');
          const s = speed as { x?: unknown; y?: unknown } | number | undefined;
          const v = typeof s === 'number' ? { x: 0, y: -Math.abs(s) } : { x: num(s?.x, 0), y: num(s?.y, 0) };
          const m = Math.round(num(max, POUR_MAX));
          const spec: LiquidSpec = {
            kind: 'pour', at: { x: p.x, y: p.y }, rate: r, vx: v.x, vy: v.y, count: Math.min(MAX_DROPS, Math.max(1, m)),
            viscosity: Math.min(1, Math.max(0, num(viscosity, DEFAULT_VISCOSITY))), density: num(density, 1) > 0 ? num(density, 1) : 1,
            ...(typeof color === 'string' && color !== '' ? { color } : {}),
          };
          return startValue(spec);
        },
      }),
    }, {
      params: [P('at', 'Point3'), P('rate', 'Number'), P('speed', 'Number|Vector3|Point3'), named('max', 'Number'), named('viscosity', 'Number'), named('density', 'Number'), named('color', 'Text')],
      returns: 'Liquid',
      summary: 'a tap in space: rate drops a second leave it at a speed (a number is straight down), up to max (500)',
      explain: '{name} pours {1} drops a second from {0}',
      check: (c) => checkDrops(c, 3, 1, 4, 5),
      rule: () => ({
        run(call: RuleCall) {
          const [at, rate, speed, max, viscosity, density, color] = call.values;
          const p = at as { x?: unknown; y?: unknown; z?: unknown } | undefined;
          if (typeof p?.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') return call.fail('input_undefined', 'the tap is undefined');
          const r = num(rate, 0);
          if (!(r > 0)) return call.fail('degenerate', 'a tap needs a rate above 0');
          const sv = speed as { x?: unknown; y?: unknown; z?: unknown } | number | undefined;
          const v = typeof sv === 'number' ? { x: 0, y: 0, z: -Math.abs(sv) } : { x: num(sv?.x, 0), y: num(sv?.y, 0), z: num(sv?.z, 0) };
          const m = Math.round(num(max, POUR_MAX));
          const spec: LiquidSpec = {
            kind: 'pour', at3: { x: p.x, y: p.y, z: p.z }, rate: r, vx: v.x, vy: v.y, vz: v.z, count: Math.min(MAX_DROPS, Math.max(1, m)),
            viscosity: Math.min(1, Math.max(0, num(viscosity, DEFAULT_VISCOSITY))), density: num(density, 1) > 0 ? num(density, 1) : 1,
            ...(typeof color === 'string' && color !== '' ? { color } : {}),
          };
          return startValue(spec);
        },
      }),
    }],
  },
  {
    name: 'Waves',
    kind: 'object',
    group: 'physics',
    forms: [
      {
        params: [P('box', 'Polyhedron'), P('n', 'Number'), named('damping', 'Number')],
        returns: 'Waves',
        summary: 'a water surface on an n by n grid over a box in space, up to its top: it waves when bodies hit it, and they float on it',
        explain: '{name} is a wave surface of {1} by {1} cells over {0}',
        check: (c) => checkWaves(c, 2),
        rule: () => ({ run: (call: RuleCall) => wavesInSpace(call) }),
      },
      {
        params: [P('surface', 'Segment'), P('n', 'Number'), named('depth', 'Number'), named('damping', 'Number')],
        returns: 'Waves',
        summary: 'a water surface of n points along a segment in the plane, depth deep (1 m): it waves when bodies hit it',
        explain: '{name} is a wave surface of {1} points along {0}',
        check: (c) => checkWaves(c, 3, 2),
        rule: () => ({ run: (call: RuleCall) => wavesInPlane(call) }),
      },
    ],
  },
  {
    name: 'Water',
    kind: 'object',
    group: 'physics',
    forms: [
      {
        params: [P('level', 'Number')],
        returns: 'Water',
        summary: 'still water everywhere below a height: bodies float by Archimedes\' rule',
        explain: '{name} is water up to y = {0}',
        rule: () => ({ run: (call: RuleCall) => waterValue(call, undefined, call.values[0]) }),
      },
      {
        params: [P('region', 'Polygon'), P('level', 'Number')],
        returns: 'Water',
        summary: 'still water inside a region, up to a height: a tank or a glass',
        explain: '{name} is water in {0} up to y = {1}',
        rule: () => ({ run: (call: RuleCall) => waterValue(call, call.values[0], call.values[1]) }),
      },
    ],
  },
];

/** A wave grid of 2 to 64 a side (errors B013, B017), and a damping of 0 to 10 (B004). */
function checkWaves(c: FormCheck, dampAt: number, depthAt?: number): Refusal | undefined {
  const a = c.args[1];
  const n = a && !a.omitted && typeof a.literal === 'number' ? a.literal : undefined;
  if (n !== undefined && n > MAX_WAVE_SIDE) {
    return { kind: 'limit', message: `A wave grid can be at most ${MAX_WAVE_SIDE} by ${MAX_WAVE_SIDE}. This line asks for ${n}.`, hint: '32 already looks smooth and costs a quarter.', param: 1, params: { max: MAX_WAVE_SIDE, what: 'cells a side of a wave grid' }, limit: { name: 'wave grid', max: MAX_WAVE_SIDE, got: n } };
  }
  if (n !== undefined && !(n >= 2)) return { kind: 'bad_argument', message: 'Waves needs at least 2 cells a side.', hint: 'Try 32.', param: 1, params: { command: 'Waves', why: 'the grid needs at least 2 cells a side' } };
  const lit = (i: number | undefined): number | undefined => {
    const a = i === undefined ? undefined : c.args[i];
    return a && !a.omitted && typeof a.literal === 'number' ? a.literal : undefined;
  };
  const damp = lit(dampAt);
  if (damp !== undefined && (damp < 0 || damp > 10)) return { kind: 'bad_property_value', message: 'damping must be between 0 and 10.', hint: `${WAVE_DAMPING} lets waves ring for a while; 2 stills them in a second.`, param: dampAt, params: { key: 'damping', allowed: 'between 0 and 10' } };
  const depth = lit(depthAt);
  if (depth !== undefined && !(depth > 0)) return { kind: 'bad_property_value', message: 'depth must be above 0.', hint: 'Try depth = 1.', ...(depthAt !== undefined ? { param: depthAt } : {}), params: { key: 'depth', allowed: 'above 0' } };
  return undefined;
}

function sideOf(call: RuleCall, n: unknown): number | undefined {
  const k = Math.round(num(n, 0));
  return k >= 2 ? Math.min(MAX_WAVE_SIDE, k) : undefined;
}

function wavesInSpace(call: RuleCall): unknown {
  const [box, n, damping] = call.values;
  const k = sideOf(call, n);
  if (k === undefined) return call.fail('degenerate', 'the grid needs at least 2 cells a side');
  const p = box as { verts?: readonly { x: number; y: number; z: number }[] } | undefined;
  if (!p?.verts || p.verts.length < 4) return call.fail('input_undefined', 'the box is undefined');
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (const v of p.verts) {
    x0 = Math.min(x0, v.x);
    y0 = Math.min(y0, v.y);
    z0 = Math.min(z0, v.z);
    x1 = Math.max(x1, v.x);
    y1 = Math.max(y1, v.y);
    z1 = Math.max(z1, v.z);
  }
  if (!(x1 > x0 && y1 > y0 && z1 > z0)) return call.fail('degenerate', 'the box has no volume');
  return { schema: 'Waves', space: true, nx: k, ny: k, x0, y0, dx: (x1 - x0) / k, dy: (y1 - y0) / k, level: z1, depth: z1 - z0, damping: Math.min(10, Math.max(0, num(damping, WAVE_DAMPING))), heights: new Float32Array(k * k), speed: Math.sqrt(9.8 * (z1 - z0)), mean: z1 } satisfies WavesValue;
}

function wavesInPlane(call: RuleCall): unknown {
  const [seg, n, depth, damping] = call.values;
  const k = sideOf(call, n);
  if (k === undefined) return call.fail('degenerate', 'the surface needs at least 2 points');
  const s = seg as { a?: Pt2; b?: Pt2 } | undefined;
  if (!s?.a || !s.b || ![s.a.x, s.a.y, s.b.x, s.b.y].every(Number.isFinite)) return call.fail('input_undefined', 'the surface is undefined');
  const x0 = Math.min(s.a.x, s.b.x);
  const x1 = Math.max(s.a.x, s.b.x);
  if (!(x1 > x0)) return call.fail('degenerate', 'the surface has no width');
  const d = num(depth, 1) > 0 ? num(depth, 1) : 1;
  return { schema: 'Waves', space: false, nx: k, ny: 1, x0, y0: 0, dx: (x1 - x0) / k, dy: 1, level: 0.5 * (s.a.y + s.b.y), depth: d, damping: Math.min(10, Math.max(0, num(damping, WAVE_DAMPING))), heights: new Float32Array(k), speed: Math.sqrt(9.8 * d), mean: 0.5 * (s.a.y + s.b.y) } satisfies WavesValue;
}

/** The start: a liquid's drops on their grid in its region (so it shows, and `l.level` reads, before the film runs). */
function startValue(spec: LiquidSpec): LiquidValue {
  if (spec.region3) {
    const d = spacingFor3(spec.region3, spec.count);
    const f = fillRegion3(spec.region3, spec.count, d);
    return { schema: 'Liquid', spec, count: f.xs.length, level: restLevel3(f.xs, f.ys, f.zs, d), xs: Float32Array.from(f.xs), ys: Float32Array.from(f.ys), zs: Float32Array.from(f.zs), size: d };
  }
  if (spec.at3) return { schema: 'Liquid', spec, count: 0, level: Number.NaN, xs: new Float32Array(0), ys: new Float32Array(0), zs: new Float32Array(0), size: 0 };
  if (spec.kind !== 'fill' || !spec.region) return { schema: 'Liquid', spec, count: 0, level: Number.NaN, xs: new Float32Array(0), ys: new Float32Array(0), size: 0 };
  const d = spacingFor(spec.region, spec.count);
  const f = fillRegion(spec.region, spec.count, d);
  return { schema: 'Liquid', spec, count: f.xs.length, level: restLevel(f.xs, f.ys, d), xs: Float32Array.from(f.xs), ys: Float32Array.from(f.ys), size: d };
}

function waterValue(call: RuleCall, region: unknown, level: unknown): unknown {
  if (typeof level !== 'number' || !Number.isFinite(level)) return call.fail('input_undefined', 'the water level is undefined');
  if (region !== undefined) {
    const pts = ptsOf(region);
    if (!pts) return call.fail('input_undefined', 'the region is undefined');
    if (!(area(pts) > 0)) return call.fail('degenerate', 'the region has no area');
    return { schema: 'Water', level, region: pts, density: 1 } satisfies WaterValue;
  }
  return { schema: 'Water', level, density: 1 } satisfies WaterValue;
}

/** How many drops a line of `Liquid` or `Pour` asks for, when it is a number written in the line. */
function asked(expr: unknown): number | undefined {
  const e = expr as { n?: string; spec?: { name?: string }; args?: readonly { expr?: { n?: string; v?: number } }[] } | undefined;
  if (e?.n !== 'command') return undefined;
  const at = e.spec?.name === 'Liquid' ? 1 : e.spec?.name === 'Pour' ? 3 : -1;
  if (at < 0) return undefined;
  const a = e.args?.[at]?.expr;
  if (e.spec?.name === 'Pour' && a === undefined) return 500;
  return a?.n === 'num' && typeof a.v === 'number' ? a.v : undefined;
}

interface FigureObjects {
  objects(): readonly { readonly id: unknown; readonly type: string; readonly cell: { readonly defined: boolean; readonly value?: unknown } }[];
}

/** All liquids of a figure together hold at most 2,000 drops (errors B013). */
export function liquidLineCheck(figure: unknown, line: CheckedLine): ErrorObject | undefined {
  if (line.op !== 'add' && line.op !== 'redefine') return undefined;
  const n = asked(line.expr);
  if (n === undefined) return undefined;
  let others = 0;
  for (const o of (figure as FigureObjects).objects()) {
    if (o.type !== 'Liquid' || o.id === line.existing) continue;
    if (o.cell.defined && isLiquidValue(o.cell.value)) others += o.cell.value.spec.count;
  }
  if (others + n <= MAX_DROPS) return undefined;
  return err('limit', { line: line.line, col: 1, endCol: 1 }, { max: MAX_DROPS, what: 'drops of liquid in a figure', limit: 'drops', got: others + n }, {
    hint: `The other liquids already hold ${others} drops, so this one can have at most ${Math.max(0, MAX_DROPS - others)}.`, recovery: 'rewrite', fingerprintKey: 'limit:drops',
  });
}
