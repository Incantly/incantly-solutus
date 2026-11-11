/**
 * Errors: the Result boundary, validation, limits and never-throw.
 *
 * Docs: `docs/features/errors/design.md` (sections 3-6: the unified error
 * object, kinds, `Result<T>`, internal faults caught at the boundary),
 * `docs/features/README.md` decisions 3-4 (one `bad_argument`, notices on
 * results), `docs/design/performance.md` section 5 (budgets),
 * `packages/plot/src/contracts.ts` (hard caps refused with `limit`).
 * Fallible entries use only `bad_argument` / `limit` / `internal`.
 */
import { describe, expect, it } from 'vitest';
import {
  createView,
  fieldFromRelation,
  fillPredicate1D,
  fillRegion,
  plotFunction,
  predicateFromRelation,
  resumeFunctionPlot,
  traceImplicit,
  traceParamCurve,
} from '@incantly/plot';
import type { Result } from '@incantly/kernel';
import { TIMEOUT, VIEW, expectErr, expectOk, fn1, pointFn, rel2 } from './helpers';

type Thunk = () => Result<never>;

describe('errors/design§5: success carries value and empty notices', () => {
  const okCases: [string, Thunk][] = [
    ['plotFunction', () => plotFunction(fn1('x^2'), VIEW) as Result<never>],
    ['traceParamCurve', () => traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: 6.283185307179586 }, VIEW) as Result<never>],
    ['traceImplicit', () => traceImplicit({ residual: (x, y) => x * x + y * y - 4 }, VIEW) as Result<never>],
    ['fillRegion', () => fillRegion({ test: (x, y) => x * x + y * y <= 4 }, VIEW) as Result<never>],
    ['fillPredicate1D', () => fillPredicate1D({ test: (x) => x > 0 }, VIEW) as Result<never>],
    ['fieldFromRelation', () => fieldFromRelation(rel2('x^2 + y^2 == 4')) as Result<never>],
    ['predicateFromRelation', () => predicateFromRelation(rel2('x^2 + y^2 <= 4')) as Result<never>],
    ['createView', () => createView(VIEW) as Result<never>],
  ];
  it.each(okCases)('%s returns value with notices []', (_name, run) => {
    const r = run();
    if (!r.ok) throw new Error(`expected success, got ${r.kind}: ${r.message}`);
    expect(r.value).toBeDefined();
    expect(r.notices).toEqual([]);
  }, TIMEOUT);

  it('resumeFunctionPlot returns value with notices []', () => {
    const f = fn1('sin(1/x)');
    const first = expectOk(plotFunction(f, VIEW, { maxEvals: 300 }));
    if (first.resume === undefined) throw new Error('no resume token');
    const r = resumeFunctionPlot(first.resume, f, { maxEvals: 50000 });
    if (!r.ok) throw new Error(`expected success, got ${r.kind}: ${r.message}`);
    expect(r.value).toBeDefined();
    expect(r.notices).toEqual([]);
  }, TIMEOUT);
});

describe('errors/design§3: error objects are well-formed', () => {
  const errCases: [string, Thunk][] = [
    ['bad_argument', () => createView({ ...VIEW, x0: 5, x1: -5 }) as Result<never>],
    ['limit', () => plotFunction(fn1('x^2'), VIEW, { maxSamples: 100000 }) as Result<never>],
    [
      'internal',
      () => {
        const base = fn1('x^2');
        const rec = base as unknown as Record<string, unknown>;
        const throwing = {
          ...rec,
          call: (): number => { throw new Error('boom'); },
          call1: (): number => { throw new Error('boom'); },
          batch: (): void => { throw new Error('boom'); },
        };
        return plotFunction(throwing as never, VIEW) as Result<never>;
      },
    ],
  ];
  it.each(errCases)('%s is a well-formed ErrorObject', (_name, run) => {
    const e = expectErr(run());
    expect(e.ok).toBe(false);
    expect(e.committed).toBe(false);
    expect(e.severity).toBe('error');
    expect(e.code).toMatch(/^[A-Z]\d{3}$/);
    expect(typeof e.kind).toBe('string');
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.messageKey.length).toBeGreaterThan(0);
    expect(e.fingerprint.length).toBeGreaterThan(0);
    expect(Array.isArray(e.expected)).toBe(true);
    expect(Array.isArray(e.forms)).toBe(true);
    expect(Array.isArray(e.suggest)).toBe(true);
    expect(e.line).toBeGreaterThanOrEqual(1);
    expect(e.col).toBeGreaterThanOrEqual(1);
    expect(e.endCol).toBeGreaterThanOrEqual(e.col);
  }, TIMEOUT);

  it('every error names a fix (hint) and a next move (recovery)', () => {
    const valid = ['fix_line', 'use_suggestion', 'choose_form', 'create_first', 'fix_earlier', 'choose', 'rewrite', 'skip', 'report'];
    for (const [_name, run] of errCases) {
      const e = expectErr(run());
      expect(typeof e.hint === 'string' && e.hint.length > 0, `${e.kind} hint`).toBe(true);
      expect(valid.includes(e.recovery), `${e.kind} recovery ${e.recovery}`).toBe(true);
    }
  }, TIMEOUT);

  it('the same bad input fails the same way twice', () => {
    const a = expectErr(createView({ ...VIEW, x0: 5, x1: -5 }));
    const b = expectErr(createView({ ...VIEW, x0: 5, x1: -5 }));
    expect(b.kind).toBe(a.kind);
    expect(b.code).toBe(a.code);
  }, TIMEOUT);
});

describe('bad_argument: malformed views are refused everywhere', () => {
  it.each([[5, -5], [2, 2]])('createView refuses x0 >= x1 (%s..%s)', (x0, x1) => {
    expect(expectErr(createView({ ...VIEW, x0, x1 })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('createView refuses y0 >= y1', () => {
    expect(expectErr(createView({ ...VIEW, y0: 5, y1: -5 })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('createView refuses non-finite bounds', () => {
    expect(expectErr(createView({ ...VIEW, x0: Number.NaN })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('createView refuses a zero pixel width', () => {
    expect(expectErr(createView({ ...VIEW, widthPx: 0 })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('createView refuses a negative pixel height', () => {
    expect(expectErr(createView({ ...VIEW, heightPx: -2 })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it.each(['plotFunction', 'traceParamCurve', 'traceImplicit', 'fillRegion', 'fillPredicate1D'])(
    '%s refuses a bad view',
    (entry) => {
      const bad = { ...VIEW, x0: 5, x1: -5 };
      const r = entry === 'plotFunction' ? plotFunction(fn1('x^2'), bad)
        : entry === 'traceParamCurve' ? traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: 1 }, bad)
        : entry === 'traceImplicit' ? traceImplicit({ residual: (x: number, y: number) => x * x + y * y - 4 }, bad)
        : entry === 'fillRegion' ? fillRegion({ test: () => true }, bad)
        : fillPredicate1D({ test: () => true }, bad);
      expect(expectErr(r).kind).toBe('bad_argument');
    },
    TIMEOUT,
  );
});

describe('bad_argument: malformed ranges, spans, breaks and budgets', () => {
  it('traceParamCurve refuses lo == hi', () => {
    const r = traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 1, hi: 1 }, VIEW);
    expect(expectErr(r).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('traceParamCurve refuses lo > hi', () => {
    const r = traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 2, hi: 1 }, VIEW);
    expect(expectErr(r).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('traceParamCurve refuses a non-finite bound', () => {
    const r = traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: Number.NaN, hi: 1 }, VIEW);
    expect(expectErr(r).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('plotFunction refuses a domain span with lo > hi', () => {
    const r = plotFunction(fn1('x^2'), VIEW, { domain: [{ lo: 3, hi: -3, loOpen: false, hiOpen: false }] });
    expect(expectErr(r).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('plotFunction refuses a non-finite domain bound', () => {
    const r = plotFunction(fn1('x^2'), VIEW, { domain: [{ lo: Number.NaN, hi: 3, loOpen: false, hiOpen: false }] });
    expect(expectErr(r).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('plotFunction refuses a non-finite break', () => {
    const r = plotFunction(fn1('x^2'), VIEW, { breaks: [Number.NaN] });
    expect(expectErr(r).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('plotFunction refuses a negative maxSamples', () => {
    expect(expectErr(plotFunction(fn1('x^2'), VIEW, { maxSamples: -1 })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('plotFunction refuses a negative maxEvals', () => {
    expect(expectErr(plotFunction(fn1('x^2'), VIEW, { maxEvals: -1 })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it.each(['traceParamCurve', 'traceImplicit', 'fillRegion'])('%s refuses a negative maxEvals', (entry) => {
    const r = entry === 'traceParamCurve'
      ? traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: 1 }, VIEW, { maxEvals: -1 })
      : entry === 'traceImplicit'
        ? traceImplicit({ residual: (x: number, y: number) => x * x + y * y - 4 }, VIEW, { maxEvals: -1 })
        : fillRegion({ test: () => true }, VIEW, { maxEvals: -1 });
    expect(expectErr(r).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('plotFunction refuses a negative coarse count', () => {
    expect(expectErr(plotFunction(fn1('x^2'), VIEW, { coarse: -1 })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('plotFunction refuses a negative depth', () => {
    expect(expectErr(plotFunction(fn1('x^2'), VIEW, { depth: -1 })).kind).toBe('bad_argument');
  }, TIMEOUT);

  it.each(['traceImplicit', 'fillRegion'])('%s refuses an unknown quality', (entry) => {
    const r = entry === 'traceImplicit'
      ? traceImplicit({ residual: (x: number, y: number) => x * x + y * y - 4 }, VIEW, { quality: 'ultra' as never })
      : fillRegion({ test: () => true }, VIEW, { quality: 'ultra' as never });
    expect(expectErr(r).kind).toBe('bad_argument');
  }, TIMEOUT);

  // Negative capacities are untested: the docs never specify capacity
  // validation, and either throwing or clamping is defensible. See the report.
});

describe('bad_argument: mistyped inputs are refused, never thrown through', () => {
  it('plotFunction refuses a null function', () => {
    let r: Result<unknown> | undefined;
    expect(() => { r = plotFunction(null as never, VIEW); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('traceParamCurve refuses a null input', () => {
    let r: Result<unknown> | undefined;
    expect(() => { r = traceParamCurve(null as never, VIEW); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('fieldFromRelation refuses a non-relation', () => {
    let r: Result<unknown> | undefined;
    expect(() => { r = fieldFromRelation({} as never); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('predicateFromRelation refuses a non-relation', () => {
    let r: Result<unknown> | undefined;
    expect(() => { r = predicateFromRelation(42 as never); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('resumeFunctionPlot refuses a garbage token', () => {
    let r: Result<unknown> | undefined;
    expect(() => { r = resumeFunctionPlot(null as never, fn1('x^2')); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('bad_argument');
  }, TIMEOUT);

  it('resumeFunctionPlot refuses a wrong-shaped token', () => {
    let r: Result<unknown> | undefined;
    expect(() => { r = resumeFunctionPlot({} as never, fn1('x^2')); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('bad_argument');
  }, TIMEOUT);
});

describe('limit: over-cap budgets and views are refused with limit', () => {
  it.each(['plotFunction', 'fillRegion'])('%s refuses maxSamples over the hard cap', (entry) => {
    const r = entry === 'plotFunction'
      ? plotFunction(fn1('x^2'), VIEW, { maxSamples: 100000 })
      : fillRegion({ test: () => true }, VIEW, { maxSamples: 100000 });
    expect(expectErr(r).kind).toBe('limit');
  }, TIMEOUT);

  it.each(['plotFunction', 'traceParamCurve', 'fillPredicate1D'])('%s refuses maxEvals over the hard cap', (entry) => {
    const huge = 20000000;
    const r = entry === 'plotFunction' ? plotFunction(fn1('x^2'), VIEW, { maxEvals: huge })
      : entry === 'traceParamCurve'
        ? traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: 1 }, VIEW, { maxEvals: huge })
        : fillPredicate1D({ test: () => true }, VIEW, { maxEvals: huge });
    expect(expectErr(r).kind).toBe('limit');
  }, TIMEOUT);

  it('a view side over 16384px is refused with limit', () => {
    const wide = { ...VIEW, widthPx: 20000 };
    expect(expectErr(plotFunction(fn1('x^2'), wide)).kind).toBe('limit');
    const tall = { ...VIEW, heightPx: 20000 };
    expect(expectErr(plotFunction(fn1('x^2'), tall)).kind).toBe('limit');
  }, TIMEOUT);

  it('a view area over 16777216px is refused with limit', () => {
    const big = { ...VIEW, widthPx: 5000, heightPx: 5000 };
    expect(expectErr(plotFunction(fn1('x^2'), big)).kind).toBe('limit');
  }, TIMEOUT);

  it('a limit error names the cap it hit', () => {
    const e = expectErr(plotFunction(fn1('x^2'), VIEW, { maxSamples: 100000 }));
    expect(e.message.includes('65536')).toBe(true);
  }, TIMEOUT);

  it('a limit error carries a machine-readable limit param (errors/design§11)', () => {
    const e = expectErr(plotFunction(fn1('x^2'), VIEW, { maxSamples: 100000 }));
    expect('limit' in e.params).toBe(true);
  }, TIMEOUT);
});

describe('internal: throwing callbacks become internal errors, never throws', () => {
  const throwingScalar = (): never => {
    const base = fn1('x^2');
    const rec = base as unknown as Record<string, unknown>;
    return {
      ...rec,
      call: (): number => { throw new Error('boom'); },
      call1: (): number => { throw new Error('boom'); },
      batch: (): void => { throw new Error('boom'); },
    } as never;
  };

  it('a throwing function becomes internal (plotFunction)', () => {
    let r: Result<unknown> | undefined;
    expect(() => { r = plotFunction(throwingScalar(), VIEW); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('internal');
  }, TIMEOUT);

  it('a throwing residual becomes internal (traceImplicit)', () => {
    let r: Result<unknown> | undefined;
    expect(() => {
      r = traceImplicit({ residual: (_x: number, _y: number): number => { throw new Error('boom'); } }, VIEW);
    }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('internal');
  }, TIMEOUT);

  it('a throwing test becomes internal (fillRegion)', () => {
    let r: Result<unknown> | undefined;
    expect(() => {
      r = fillRegion({ test: (_x: number, _y: number): boolean => { throw new Error('boom'); } }, VIEW);
    }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('internal');
  }, TIMEOUT);

  it('a throwing test becomes internal (fillPredicate1D)', () => {
    let r: Result<unknown> | undefined;
    expect(() => {
      r = fillPredicate1D({ test: (_x: number): boolean => { throw new Error('boom'); } }, VIEW);
    }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('internal');
  }, TIMEOUT);

  it('a throwing scalar enclosure becomes internal', () => {
    // exact:true must consult the enclosure for every column, so it must throw here.
    let r: Result<unknown> | undefined;
    expect(() => {
      r = plotFunction(fn1('x^2'), VIEW, {
        exact: true,
        enclosure: (_lo: number, _hi: number): never => { throw new Error('boom'); },
      });
    }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('internal');
  }, TIMEOUT);

  it('a throwing field enclosure becomes internal', () => {
    let r: Result<unknown> | undefined;
    expect(() => {
      r = traceImplicit({
        residual: (x: number, y: number) => x * x + y * y - 4,
        enclosure: (_x0: number, _x1: number, _y0: number, _y1: number): never => { throw new Error('boom'); },
      }, VIEW);
    }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('internal');
  }, TIMEOUT);

  it('a throwing relation residual becomes internal when traced', () => {
    const rel = rel2('x^2 + y^2 == 4') as unknown as Record<string, unknown>;
    const bad = { ...rel, residual: (): number => { throw new Error('boom'); } };
    const field = expectOk(fieldFromRelation(bad as never));
    let r: Result<unknown> | undefined;
    expect(() => { r = traceImplicit(field, VIEW); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('internal');
  }, TIMEOUT);

  it('a throwing relation test becomes internal when filled', () => {
    const rel = rel2('x^2 + y^2 <= 4') as unknown as Record<string, unknown>;
    const bad = { ...rel, test: (): boolean => { throw new Error('boom'); } };
    const pred = expectOk(predicateFromRelation(bad as never));
    let r: Result<unknown> | undefined;
    expect(() => { r = fillRegion(pred, VIEW_SQ_SAFE); }).not.toThrow();
    expect(expectErr(r ?? { ok: true } as never).kind).toBe('internal');
  }, TIMEOUT);
});

const VIEW_SQ_SAFE = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 600, heightPx: 600 };

describe('errors/design§5: nothing throws across the package boundary', () => {
  const nullCases: [string, Thunk][] = [
    ['plotFunction', () => plotFunction(null as never, VIEW) as Result<never>],
    ['traceParamCurve', () => traceParamCurve(null as never, VIEW) as Result<never>],
    ['traceImplicit', () => traceImplicit(null as never, VIEW) as Result<never>],
    ['fillRegion', () => fillRegion(null as never, VIEW) as Result<never>],
    ['createView', () => createView(null as never) as Result<never>],
  ];
  it.each(nullCases)('%s survives a null input', (_name, run) => {
    let r: Result<never> | undefined;
    expect(() => { r = run(); }).not.toThrow();
    expect(r?.ok).toBe(false);
  }, TIMEOUT);

  it.each(['plotFunction', 'traceImplicit'] as const)('%s survives an undefined input', (entry) => {
    let r: Result<unknown> | undefined;
    expect(() => {
      r = entry === 'plotFunction' ? plotFunction(undefined as never, VIEW) : traceImplicit(undefined as never, VIEW);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
  }, TIMEOUT);
});
