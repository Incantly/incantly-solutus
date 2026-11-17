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

declare module '../../contracts/values' {
  interface AreaTypeNames {
    Liquid: true;
    Water: true;
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
    }],
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

/** The start: a liquid's drops on their grid in its region (so it shows, and `l.level` reads, before the film runs). */
function startValue(spec: LiquidSpec): LiquidValue {
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
