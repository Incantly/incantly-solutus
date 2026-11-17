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
import type { SmokeSource2 } from '../../physics/smoke2';
import { Smoke2, markSource } from '../../physics/smoke2';

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

export function isSmokeValue(v: unknown): v is SmokeValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Smoke';
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

function boxOf(region: unknown): { x0: number; y0: number; x1: number; y1: number } | undefined {
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
    const v = wind.value as { x?: unknown; y?: unknown } | undefined;
    if (typeof wind.literal === 'number') return { kind: 'bad_property_value', message: 'wind must be a vector, such as (3, 0).', hint: 'wind is the speed of the air in m/s: (3, 0) blows to the right.', param: 4, params: { key: 'wind', allowed: 'a vector such as (3, 0)' } };
    if (v && typeof v.x === 'number' && typeof v.y === 'number' && !(Math.abs(v.x) <= SMOKE_MAX_WIND && Math.abs(v.y) <= SMOKE_MAX_WIND)) {
      return { kind: 'bad_property_value', message: `Each part of the wind must be at most ${SMOKE_MAX_WIND} m/s.`, hint: 'A strong wind is 10 m/s; a hurricane about 70.', param: 4, params: { key: 'wind', allowed: `each part between -${SMOKE_MAX_WIND} and ${SMOKE_MAX_WIND} m/s` } };
    }
  }
  const until = lit(5);
  if (until !== undefined && !(until >= 0)) return { kind: 'bad_property_value', message: 'until must be 0 or more seconds.', hint: 'until = 0 makes one puff at the start; leave it out to keep making smoke.', param: 5, params: { key: 'until', allowed: '0 or more' } };
  return undefined;
}

export const SMOKE_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Smoke',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('region', 'Polygon'), P('n', 'Number'), named('source', 'Point|Circle|Polygon'), named('heat', 'Number'), named('wind', 'Vector|Point'), named('until', 'Number')],
      returns: 'Smoke',
      summary: 'smoke and air on an n by n grid over a box: made at source, lifted by heat, blown by the wind, blocked and stirred by solids and bodies',
      explain: '{name} is smoke on a {1} by {1} grid over {0}',
      check: checkSmoke,
      rule: () => ({
        run(call: RuleCall) {
          const [region, n, source, heat, wind, until] = call.values;
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
          };
          return startValue(spec);
        },
      }),
    }],
  },
];

function clamp(x: number, m: number): number {
  return Math.min(m, Math.max(-m, x));
}

/** The grid of a spec, set up at its start. */
export function smokeGrid(spec: SmokeSpec, windX: number, windY: number): Smoke2 {
  const g = new Smoke2({ x0: spec.x0, y0: spec.y0, x1: spec.x1, y1: spec.y1, n: spec.n });
  g.heat = spec.heat;
  g.setSource(spec.source);
  g.making = spec.until > 0;
  g.start(windX, windY);
  return g;
}

/** The smoke a grid holds now, as a value. */
export function smokeValue(spec: SmokeSpec, g: Smoke2): SmokeValue {
  return { schema: 'Smoke', spec, density: Float32Array.from(g.s), mass: g.mass(), speed: g.maxSpeed() };
}

/** The start: the source already full of smoke, so it shows before the film runs (no grid is made for it). */
function startValue(spec: SmokeSpec): SmokeValue {
  const n = spec.n;
  const dx = (spec.x1 - spec.x0) / n;
  const dy = (spec.y1 - spec.y0) / n;
  const cells = new Uint8Array(n * n);
  markSource(cells, { n, x0: spec.x0, y0: spec.y0, dx, dy }, spec.source);
  const density = new Float32Array(n * n);
  let k = 0;
  for (let c = 0; c < cells.length; c++) if (cells[c] === 1) {
    density[c] = 1;
    k++;
  }
  const w = spec.wind;
  return { schema: 'Smoke', spec, density, mass: k * dx * dy, speed: w ? Math.max(Math.abs(w.x), Math.abs(w.y)) : 0 };
}

/** How many cells a line of `Smoke` asks for, when its grid is a number written in the line. */
function asked(expr: unknown): number | undefined {
  const e = expr as { n?: string; spec?: { name?: string }; args?: readonly { expr?: { n?: string; v?: number } }[] } | undefined;
  if (e?.n !== 'command' || e.spec?.name !== 'Smoke') return undefined;
  const a = e.args?.[1]?.expr;
  return a?.n === 'num' && typeof a.v === 'number' ? Math.round(a.v) * Math.round(a.v) : undefined;
}

interface FigureObjects {
  objects(): readonly { readonly id: unknown; readonly type: string; readonly cell: { readonly defined: boolean; readonly value?: unknown } }[];
}

/** All smoke grids of a figure together have at most 64 × 64 cells (errors B013). */
export function smokeLineCheck(figure: unknown, line: CheckedLine): ErrorObject | undefined {
  if (line.op !== 'add' && line.op !== 'redefine') return undefined;
  const cells = asked(line.expr);
  if (cells === undefined) return undefined;
  let others = 0;
  for (const o of (figure as FigureObjects).objects()) {
    if (o.type !== 'Smoke' || o.id === line.existing) continue;
    if (o.cell.defined && isSmokeValue(o.cell.value)) others += o.cell.value.spec.n * o.cell.value.spec.n;
  }
  if (others + cells <= SMOKE_MAX_CELLS) return undefined;
  return err('limit', { line: line.line, col: 1, endCol: 1 }, { max: SMOKE_MAX_CELLS, what: 'smoke cells in a figure (one 64 by 64 grid)', limit: 'smoke cells', got: others + cells }, {
    hint: `The other smoke grids already have ${others} cells, so this one can have at most ${Math.max(0, SMOKE_MAX_CELLS - others)} (${Math.floor(Math.sqrt(Math.max(0, SMOKE_MAX_CELLS - others)))} a side).`, recovery: 'rewrite', fingerprintKey: 'limit:smoke',
  });
}
