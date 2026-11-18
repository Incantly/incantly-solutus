/**
 * Fire in the plane (docs/features/physics/design.md 2.4, 9.7; errors.md B004, B013, B017, B020, B021): `Fire(region, n)`
 * and `Fire(at)` with named `source`, `fuel`, `burn`, `heat`, `smoke`, `swirl`, `wind`, `until` and `sound`.
 *
 * A fire is a smoke grid with temperature and fuel in each cell, so its value is a smoke value with more fields
 * (`isSmokeValue` holds for it, and every smoke readout works). The rule gives the start; the plane driver owns the grid
 * and writes where the heat is into the value after each pass.
 */
import type { RuleCall } from '../../graph/registry';
import type { CommandSpec, FormCheck, ParamSpec, Refusal } from '../../language/table';
import { SMOKE_MAX_N, SMOKE_MAX_WIND, SMOKE_MIN_N, SWIRL_MAX, boxOf, clamp, fireStart, sourceOf } from './smoke';
import type { FireSpec, SmokeSpec } from './smoke';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    Fire: true;
  }
  interface AreaUndefReasons {
    burnt: true;
  }
}
declare module '../../contracts/errors' {
  interface AreaNoticeKinds {
    burnt: true;
    fire_out: true;
  }
}

/** The finest and coarsest `Fire(at)` and its grid. */
export const FIRE_AT_BOX = Object.freeze({ left: 1, right: 1, below: 0.5, above: 3.5, radius: 0.25, n: 48 });
/** Ranges of the named arguments (design 9.7). */
export const FIRE_RANGES = Object.freeze({ fuel: [0, 10], burn: [0.1, 10], heat: [100, 2000], smoke: [0, 5], swirl: [0, SWIRL_MAX] } as const);
export const FIRE_DEFAULTS = Object.freeze({ fuel: 1, burn: 1, heat: 1000, smoke: 1, swirl: 2 });

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string): ParamSpec => P(name, type, { optional: true, named: true });
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const within = (v: number, r: readonly [number, number]): number => Math.min(r[1], Math.max(r[0], v));

const NAMED = [
  named('source', 'Point|Circle|Polygon'), named('fuel', 'Number'), named('burn', 'Number'), named('heat', 'Number'), named('smoke', 'Number'),
  named('swirl', 'Number'), named('wind', 'Vector|Point'), named('until', 'Number'), named('sound', 'Bool'),
];

const HINTS: Readonly<Record<'fuel' | 'burn' | 'heat' | 'smoke' | 'swirl', string>> = {
  fuel: 'fuel is how much fuel the source makes a second: 1 is a steady flame, 0.3 a candle.',
  burn: 'burn is how fast fuel burns: fast burning makes short flames, slow burning tall ones.',
  heat: 'heat is the hottest a flame gets, in °C: a candle is about 800, a camp fire 1,000.',
  smoke: 'smoke is the smoke made for each unit of fuel burnt: 0 is a clean flame.',
  swirl: 'swirl keeps the curls of the flow: 0 is none, 2 is a lively flame.',
};

/** Literal values that can never work. `first` is the index of `source` (2 with a region, 1 with a point). */
function checkFire(c: FormCheck, first: number, withGrid: boolean): Refusal | undefined {
  const lit = (i: number): number | undefined => {
    const a = c.args[i];
    return a && !a.omitted && typeof a.literal === 'number' ? a.literal : undefined;
  };
  if (withGrid) {
    const n = lit(1);
    if (n !== undefined && n > SMOKE_MAX_N) {
      return {
        kind: 'limit', message: `A fire grid can be at most ${SMOKE_MAX_N} by ${SMOKE_MAX_N}. This line asks for ${n} by ${n}.`, hint: 'Use 48: it looks smooth and costs half as much.', param: 1,
        params: { max: SMOKE_MAX_N, what: 'cells a side of a fire grid' }, limit: { name: 'smoke grid', max: SMOKE_MAX_N, got: n },
      };
    }
    if (n !== undefined && !(n >= SMOKE_MIN_N && Number.isInteger(n))) {
      return { kind: 'bad_argument', message: `Fire needs a whole number of cells a side, from ${SMOKE_MIN_N} to ${SMOKE_MAX_N}.`, hint: 'Try Fire(Box((0, 2), 4, 4), 48).', param: 1, params: { command: 'Fire', why: `the grid must be a whole number from ${SMOKE_MIN_N} to ${SMOKE_MAX_N}` } };
    }
    const r = c.args[0];
    if (r && !r.omitted && r.value !== undefined) {
      const b = boxOf(r.value);
      if (b && !(b.x1 > b.x0 && b.y1 > b.y0)) return { kind: 'bad_argument', message: `Fire(${r.text}): the region has no area.`, hint: 'Give Fire a box: Fire(Box((0, 2), 4, 4), 48).', param: 0, params: { command: 'Fire', why: 'the region has no area' } };
    }
  }
  const keys = ['fuel', 'burn', 'heat', 'smoke', 'swirl'] as const;
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k] as (typeof keys)[number];
    const v = lit(first + 1 + k);
    const [lo, hi] = FIRE_RANGES[key];
    if (v !== undefined && !(v >= lo && v <= hi)) return { kind: 'bad_property_value', message: `${key} must be between ${lo} and ${hi}.`, hint: HINTS[key], param: first + 1 + k, params: { key, allowed: `between ${lo} and ${hi}` } };
  }
  const wind = c.args[first + 6];
  if (wind && !wind.omitted) {
    // a vector written in the line is its literal; a bare name, its value now
    const v = (wind.literal ?? wind.value) as { x?: unknown; y?: unknown } | undefined;
    if (typeof wind.literal === 'number') return { kind: 'bad_property_value', message: 'wind must be a vector, such as (3, 0).', hint: 'wind is the speed of the air in m/s: (3, 0) blows to the right.', param: first + 6, params: { key: 'wind', allowed: 'a vector such as (3, 0)' } };
    if (v && typeof v.x === 'number' && typeof v.y === 'number' && !(Math.abs(v.x) <= SMOKE_MAX_WIND && Math.abs(v.y) <= SMOKE_MAX_WIND)) {
      return { kind: 'bad_property_value', message: `Each part of the wind must be at most ${SMOKE_MAX_WIND} m/s.`, hint: 'A strong wind is 10 m/s; a hurricane about 70.', param: first + 6, params: { key: 'wind', allowed: `each part between -${SMOKE_MAX_WIND} and ${SMOKE_MAX_WIND} m/s` } };
    }
  }
  const until = lit(first + 7);
  if (until !== undefined && !(until >= 0)) return { kind: 'bad_property_value', message: 'until must be 0 or more seconds.', hint: 'until = 0 lights the fire for no time; leave it out to keep the source going.', param: first + 7, params: { key: 'until', allowed: '0 or more' } };
  return undefined;
}

/** The settings every form shares, from the values of the named arguments (starting at `source`). */
function build(call: RuleCall, at: number, box: { x0: number; y0: number; x1: number; y1: number }, n: number, defaultSource: SmokeSpec['source']): unknown {
  const [source, fuel, burn, heat, smoke, swirl, wind, until, sound] = call.values.slice(at);
  const src = source === undefined ? defaultSource : sourceOf(source);
  if (source !== undefined && !src) return call.fail('input_undefined', 'the source is undefined');
  const wv = wind as { x?: unknown; y?: unknown } | undefined;
  const w = typeof wv?.x === 'number' && typeof wv.y === 'number' && Number.isFinite(wv.x) && Number.isFinite(wv.y) ? { x: clamp(wv.x, SMOKE_MAX_WIND), y: clamp(wv.y, SMOKE_MAX_WIND) } : undefined;
  const fire: FireSpec = {
    fuel: within(num(fuel, FIRE_DEFAULTS.fuel), FIRE_RANGES.fuel),
    burn: within(num(burn, FIRE_DEFAULTS.burn), FIRE_RANGES.burn),
    heat: within(num(heat, FIRE_DEFAULTS.heat), FIRE_RANGES.heat),
    smoke: within(num(smoke, FIRE_DEFAULTS.smoke), FIRE_RANGES.smoke),
    sound: sound === true,
  };
  const sw = within(num(swirl, FIRE_DEFAULTS.swirl), FIRE_RANGES.swirl);
  const spec: SmokeSpec = {
    ...box, n,
    ...(src ? { source: src } : {}),
    // the fire's own heat replaces the smoke's lift (design 9.7 step 2)
    heat: 0,
    ...(w ? { wind: w } : {}),
    until: typeof until === 'number' && until >= 0 ? until : Infinity,
    ...(sw > 0 ? { swirl: sw } : {}),
    fire,
  };
  return fireStart(spec);
}

export const FIRE_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Fire',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('region', 'Polygon'), P('n', 'Number'), ...NAMED],
      returns: 'Fire',
      summary: 'fire and its smoke on an n by n grid over a box: fuel made at source burns where it is hot, heat lifts the flow, swirl keeps its curls',
      explain: '{name} is fire on a {1} by {1} grid over {0}',
      check: (c) => checkFire(c, 2, true),
      rule: () => ({
        run(call: RuleCall) {
          const [region, n] = call.values;
          const box = boxOf(region);
          if (!box) return call.fail('input_undefined', 'the region is undefined');
          if (!(box.x1 > box.x0 && box.y1 > box.y0)) return call.fail('degenerate', 'the region has no area');
          if (typeof n !== 'number' || !Number.isFinite(n)) return call.fail('input_undefined', 'the grid size is undefined');
          return build(call, 2, box, Math.min(SMOKE_MAX_N, Math.max(SMOKE_MIN_N, Math.round(n))), undefined);
        },
      }),
    }, {
      params: [P('at', 'Point'), ...NAMED],
      returns: 'Fire',
      summary: 'a fire at a point: a box 2 m wide and 4 m high round it with 48 cells a side, and a small circle of fuel',
      explain: '{name} is a fire at {0}',
      check: (c) => checkFire(c, 1, false),
      rule: () => ({
        run(call: RuleCall) {
          const p = call.values[0] as { x?: unknown; y?: unknown } | undefined;
          if (typeof p?.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return call.fail('input_undefined', 'the point is undefined');
          const f = FIRE_AT_BOX;
          const box = { x0: p.x - f.left, y0: p.y - f.below, x1: p.x + f.right, y1: p.y + f.above };
          return build(call, 1, box, f.n, { kind: 'circle', x: p.x, y: p.y, r: f.radius });
        },
      }),
    }],
  },
];
