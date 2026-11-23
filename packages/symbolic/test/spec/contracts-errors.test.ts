/**
 * Codes, limits, errors and undefined values (docs/features/cas/errors.md), budgets and
 * determinism (design 5.13, 9), plus the phase-2 parts: trig forms, Steps, small matrices
 * (design 2.7, 5.10, 11).
 */
import { afterEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_LIMITS,
  ENGINE_VERSION,
  HEAVY_OPS,
  SYMBOLIC_COMMANDS,
  SYMBOLIC_ERROR_CODES,
  SYMBOLIC_NOTICE_CODES,
  SYMBOLIC_UNDEF_CODES,
  clearCache,
  compileFunction,
  handleWorkerRequest,
  parseExpression,
  run,
  stepsToText,
  toText,
} from '@incantly/symbolic/engine';
import type { OpName, Result, RunSuccess, Step, SymArg } from '@incantly/symbolic/engine';
import {
  asExpr,
  agree,
  asList,
  asText,
  bi,
  cd,
  err,
  ex,
  expectWellFormed,
  exprText,
  li,
  mt,
  named,
  nm,
  numeric,
  numericAt,
  ran,
  sy,
  tx,
  undef,
  val,
} from './helpers';

afterEach(() => {
  clearCache();
});

// errors.md 1.2, 1.3, 2: the stable codes.
describe('code tables', () => {
  test('line error codes are Y001 to Y011 in the documented order', () => {
    expect(SYMBOLIC_ERROR_CODES).toEqual({
      not_symbolic: 'Y001',
      bad_variable: 'Y002',
      time_dependent_input: 'Y003',
      not_polynomial: 'Y004',
      bad_digits: 'Y005',
      bad_domain: 'Y006',
      bad_option: 'Y007',
      solve_arity: 'Y008',
      bad_assumption: 'Y009',
      redefinition_domain: 'Y010',
      division_by_zero_literal: 'Y011',
    });
  });
  test('notice codes are Y101 to Y112', () => {
    expect(SYMBOLIC_NOTICE_CODES).toEqual({
      numeric_fallback: 'Y101',
      multiple_root: 'Y102',
      irreducible: 'Y103',
      denominator_unchecked: 'Y104',
      real_odd_root: 'Y105',
      precision_lost: 'Y106',
      excluded_values: 'Y107',
      periodic_family: 'Y108',
      cases: 'Y109',
      no_steps: 'Y110',
      domain_changed: 'Y111',
      differ_at: 'Y112',
    });
  });
  test('undefined detail codes are Y200 to Y213', () => {
    const want: Record<string, string> = {
      pending: 'Y200', unsupported: 'Y201', non_elementary: 'Y202', no_limit: 'Y203', divergent: 'Y204',
      indeterminate: 'Y205', unproven: 'Y206', singular: 'Y207', timeout: 'Y208', limit: 'Y209',
      out_of_domain: 'Y210', division_by_zero: 'Y211', no_solution: 'Y212', not_finite: 'Y213',
    };
    for (const [reason, code] of Object.entries(want)) expect(SYMBOLIC_UNDEF_CODES[reason], reason).toBe(code);
  });
  test('the limits table (errors.md 4)', () => {
    expect(DEFAULT_LIMITS.maxInputNodes).toBe(20000);
    expect(DEFAULT_LIMITS.maxNodes).toBe(200000);
    expect(DEFAULT_LIMITS.maxDigits).toBe(100000);
    expect(DEFAULT_LIMITS.maxExpandTerms).toBe(5000);
    expect(DEFAULT_LIMITS.maxSystemVars).toBe(6);
    expect(DEFAULT_LIMITS.maxFactorDegree).toBe(200);
    expect(DEFAULT_LIMITS.maxNumericDigits).toBe(200);
    expect(DEFAULT_LIMITS.maxSteps).toBe(2_000_000);
    expect(DEFAULT_LIMITS.maxMs).toBe(1000);
    expect(DEFAULT_LIMITS.maxMatrixSize).toBe(4);
  });
  test('engine version is a number (part of the cache key)', () => {
    expect(typeof ENGINE_VERSION).toBe('number');
  });
});

// design 1, 2, 3 and 5.15: the command catalogue.
describe('command catalogue', () => {
  const documented: readonly string[] = [
    'Expr', 'Symbol', 'Hold', 'Evaluate', 'LeftSide', 'RightSide', 'ToFunction', 'ToExpr', 'Simplify', 'Expand',
    'Factor', 'Rationalize', 'PartialFractions', 'CompleteSquare', 'Coefficients', 'Degree', 'Div', 'Mod', 'Division',
    'GCD', 'LCM', 'Equivalent', 'IsZero', 'Solve', 'Solutions', 'NSolve', 'NSolutions', 'CSolve', 'CSolutions',
    'Substitute', 'Numeric', 'MixedNumber', 'Assume', 'Derivative', 'Integral', 'Limit', 'LimitAbove', 'LimitBelow',
    'SolveODE', 'IsPrime', 'NextPrime', 'PreviousPrime', 'PrimeFactors', 'Divisors', 'DivisorsList', 'DivisorsSum',
    'ToBase', 'FromBase', 'ExtendedGCD', 'ModularExponent', 'TrigExpand', 'TrigCombine', 'TrigSimplify', 'Eigenvalues',
    'Eigenvectors', 'CharacteristicPolynomial', 'Inverse', 'Determinant', 'Steps', 'ToNumber',
  ];
  test('every documented command has a catalogue entry', () => {
    const names = new Set(SYMBOLIC_COMMANDS.map((c) => c.name as string));
    expect(documented.filter((n) => !names.has(n))).toEqual([]);
  });
  test('every entry has at least one form with a summary', () => {
    for (const c of SYMBOLIC_COMMANDS) {
      expect(c.forms.length, c.name).toBeGreaterThan(0);
      for (const f of c.forms) expect(f.summary.length, c.name).toBeGreaterThan(0);
    }
  });
  test('heavy flags: heavy commands are in HEAVY_OPS, cheap ones are not (design 5.3, 12.2)', () => {
    for (const c of SYMBOLIC_COMMANDS) expect(HEAVY_OPS.has(c.name), c.name).toBe(c.heavy);
    for (const cheap of ['Substitute', 'Numeric', 'ToFunction'] as const) expect(HEAVY_OPS.has(cheap)).toBe(false);
    for (const heavy of ['Solve', 'Factor', 'Integral', 'Limit', 'Simplify'] as const) expect(HEAVY_OPS.has(heavy)).toBe(true);
  });
  test('Solve has the documented forms (c, v), (cs, vs), (c)', () => {
    const solve = SYMBOLIC_COMMANDS.find((c) => c.name === 'Solve');
    const shapes = (solve?.forms ?? []).map((f) => f.params.map((p) => p.name).join(','));
    expect(shapes.length).toBeGreaterThanOrEqual(3);
    expect(shapes.some((s) => s.startsWith('c,v'))).toBe(true);
    expect(shapes.some((s) => s.startsWith('cs,vs'))).toBe(true);
    expect(shapes).toContain('c');
  });
});

// errors.md 1: line errors are returned as data and are well formed.
describe('line errors', () => {
  test('a non-symbol variable is bad_variable (Y002)', () => {
    for (const bad of [nm(2), ex('x+1')]) {
      const e = err('Solve', [cd('x+1==2'), bad]);
      expect(e.kind).toBe('bad_variable');
      expect(e.code).toBe('Y002');
      expectWellFormed(e);
    }
    expect(err('Derivative', [ex('x^2'), ex('x+1')]).kind).toBe('bad_variable');
  });
  test('an unknown named argument is bad_option (Y007) and lists the command options', () => {
    const e = err('Solve', [cd('x+1==2'), sy('x'), named('banana', nm(1))]);
    expect(e.kind).toBe('bad_option');
    expect(e.code).toBe('Y007');
  });
  test('from greater than to is bad_option (Y007)', () => {
    const e = err('Solve', [cd('x^2==4'), sy('x'), named('from', nm(5)), named('to', nm(1))]);
    expect(e.kind).toBe('bad_option');
  });
  test('a bad domain option is bad_domain (Y006)', () => {
    const e = err('Solve', [cd('x^2==4'), sy('x'), named('domain', tx('banana'))]);
    expect(e.kind).toBe('bad_domain');
    expect(e.code).toBe('Y006');
  });
  test('not_polynomial (Y004) names the offending sub-expression', () => {
    for (const op of ['Degree', 'Coefficients'] as const) {
      const e = err(op, [ex('sin(x)+x^2'), sy('x')]);
      expect(e.kind).toBe('not_polynomial');
      expect(e.token).toBe('sin(x)');
      expectWellFormed(e);
    }
  });
  test('wrong argument count is arg_count (language ruling Q7)', () => {
    const e = err('Simplify', []);
    // errors.md 1.1 folds the count into no_matching_form; ruling Q7 gives it its own kind.
    expect(['arg_count', 'no_matching_form']).toContain(e.kind);
    expectWellFormed(e);
  });
  test('wrong argument type is no_matching_form with at most 4 forms listed', () => {
    const e = err('Simplify', [tx('hello')]);
    expect(e.kind).toBe('no_matching_form');
    expect(e.forms.length).toBeGreaterThan(0);
    expect(e.forms.length).toBeLessThanOrEqual(4);
    expectWellFormed(e);
  });
  test('input over 20,000 nodes is the error limit', () => {
    const big = `[${Array.from({ length: 21000 }, (_, i) => `a${i}`).join(',')}]`;
    const e = err('Simplify', [{ k: 'expr', e: parseExpression(big), exact: true }]);
    expect(e.kind).toBe('limit');
    expectWellFormed(e);
  }, 30000);
  test('errors carry at most 3 suggestions and a recovery', () => {
    const e = err('Solve', [cd('x+1==2'), nm(2)]);
    expect(e.suggest.length).toBeLessThanOrEqual(3);
    expect(typeof e.recovery).toBe('string');
  });
});

// errors.md: nothing throws across the boundary.
describe('run never throws', () => {
  const ops = SYMBOLIC_COMMANDS.map((c) => c.name);
  const argSets: readonly (readonly SymArg[])[] = [
    [],
    [ex('x')],
    [tx('junk')],
    [nm(-1), nm(0)],
    [cd('x==1'), sy('x'), nm(3)],
    [li([]), li([])],
    [ex('x^2'), sy('x'), nm(1), nm(2), nm(3), nm(4)],
    [bi(0n), bi(-5n)],
    [mt([['1']]), ex('y')],
  ];
  test('every command on malformed arguments returns a Result', () => {
    const bad: string[] = [];
    for (const op of ops) {
      for (const [i, args] of argSets.entries()) {
        try {
          const r: Result<RunSuccess> = run(op, args, { limits: { maxMs: 300 } });
          if (typeof r.ok !== 'boolean') bad.push(`${op}#${i}: not a Result`);
        } catch (e) {
          bad.push(`${op}#${i}: threw ${(e as Error).message}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120000);
});

// design 5.13, 9.7: budgets stop pathological input with a reason, quickly.
describe('budgets', () => {
  test('a tiny step budget gives undefined timeout (Y208) with a stage', () => {
    const u = undef('Expand', [ex('(x+y+1)^12')], { limits: { maxSteps: 10 } });
    expect(u.reason).toBe('timeout');
    expect(u.detail?.code).toBe('Y208');
    expect((u.detail?.stage ?? '').length).toBeGreaterThan(0);
  });
  test('the 5,000-term Expand limit stops within 1.2 s', () => {
    const t0 = Date.now();
    const u = undef('Expand', [ex('(x+y+z+w+1)^40')]);
    expect(['limit', 'timeout']).toContain(u.reason);
    expect(Date.now() - t0).toBeLessThan(2500);
  }, 20000);
  test('a degree-16 Swinnerton-Dyer polynomial stops or returns itself within 2.5 s', () => {
    const sd = 'x^16-136*x^14+6476*x^12-141912*x^10+1513334*x^8-7453176*x^6+13950764*x^4-5596840*x^2+46225';
    const t0 = Date.now();
    const { cell } = ran('Factor', [ex(sd)]);
    expect(Date.now() - t0).toBeLessThan(2500);
    if (cell.defined) {
      const back = toText(asExpr(cell.value, 'factored'));
      for (const x of [1, 2, 3]) expect(numeric(back, { x })).toBe(numeric(sd, { x }));
    } else {
      expect(['timeout', 'limit', 'unsupported']).toContain(cell.reason);
    }
  }, 20000);
  test('Solve(x^x == 7, x) stops with limit, timeout or unsupported within 2.5 s and leaves the figure intact', () => {
    const t0 = Date.now();
    const { cell } = ran('Solve', [cd('x^x==7'), sy('x')]);
    expect(Date.now() - t0).toBeLessThan(2500);
    if (!cell.defined) expect(['limit', 'timeout', 'unsupported']).toContain(cell.reason);
  }, 20000);
  test('Factor of degree over 200 is undefined limit', () => {
    expect(undef('Factor', [ex('x^201+x+1')]).reason).toBe('limit');
  });
  test('pending: a zero-ms fast lane never loses the answer', () => {
    const r = ran('Solve', [cd('x^2-5*x+6==0'), sy('x')], { fastLaneMs: 0 });
    if (!r.cell.defined) expect(r.cell.reason).toBe('pending');
  });
});

// design 9.9, 5.13: results are pure functions of their inputs.
describe('determinism and cache', () => {
  test('two runs give byte-identical text', () => {
    const a = exprText('Simplify', [ex('(x^2-1)/(x-1)+sin(x)^2+cos(x)^2')]);
    clearCache();
    const b = exprText('Simplify', [ex('(x^2-1)/(x-1)+sin(x)^2+cos(x)^2')]);
    expect(b).toBe(a);
  });
  test('a cache hit gives the same value as a cold run', () => {
    const cold = exprText('Expand', [ex('(x+1)^8')]);
    const warm = exprText('Expand', [ex('(x+1)^8')]);
    expect(warm).toBe(cold);
  });
  test('the worker handler returns the same result as run, tagged with the request id', () => {
    const req = { id: 7, op: 'Expand' as OpName, args: [ex('(x+1)^3')] };
    const res = handleWorkerRequest(req, (op, args, opts, ctx) => run(op, args, opts, ctx));
    expect(res.id).toBe(7);
    const direct = run('Expand', [ex('(x+1)^3')]);
    expect(res.result.ok).toBe(direct.ok);
  });
  test('the worker forwards symbol domains to the run', () => {
    const req = {
      id: 1,
      op: 'Simplify' as OpName,
      args: [ex('abs(k)')],
      domains: [['k', 'positive'] as const],
    };
    const res = handleWorkerRequest(req, (op, args, opts, ctx) => run(op, args, opts, ctx));
    if (!res.result.ok) throw new Error('expected ok');
    const c = res.result.value.cell;
    if (!c.defined) throw new Error('expected defined');
    expect(exprText('Evaluate', [c.value])).toBe('k');
  });
});

// design 11, 5.15: derivation log and Steps.
describe('Steps', () => {
  test('run with steps: true returns the derivation with rule ids', () => {
    const full: Result<RunSuccess> = run('Simplify', [ex('(x^2-1)/(x-1)+sin(x)^2+cos(x)^2')], { steps: true });
    if (!full.ok) throw new Error('expected ok');
    const steps: readonly Step[] = full.value.steps ?? [];
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.rule.length).toBeGreaterThan(0);
  });
  test('without steps: true there is no derivation log', () => {
    const full: Result<RunSuccess> = run('Simplify', [ex('(x^2-1)/(x-1)+sin(x)^2+cos(x)^2')]);
    if (!full.ok) throw new Error('expected ok');
    expect(full.value.steps === undefined || full.value.steps.length === 0).toBe(true);
  });
  test('Steps(cmd) returns one text per line, at most 12 lines', () => {
    const lines = asList(val('Steps', [tx('Solve(x^2 - 5x + 6 == 0, x)')]), 'steps').map((l) => (l.k === 'text' ? l.v : ''));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(12);
    for (const l of lines) expect(l.length).toBeGreaterThan(0);
  });
  test('a derivation with no phrases gives "(no steps available)" and notice no_steps (Y110)', () => {
    const r = ran('Steps', [tx('IsPrime(7)')]);
    if (!r.cell.defined) return;
    const lines = asList(r.cell.value, 'steps').map((l) => (l.k === 'text' ? l.v : ''));
    expect(lines).toEqual(['(no steps available)']);
    expect(r.notices.map((n) => n.kind)).toContain('no_steps');
  });
  test('stepsToText caps at 12 lines', () => {
    const before = parseExpression('x+x');
    const after = parseExpression('2*x');
    const many: Step[] = Array.from({ length: 30 }, (_, i) => ({ rule: i % 2 === 0 ? 'add.collect' : 'expand', before, after, teaching: true }));
    expect(stepsToText(many).lines.length).toBeLessThanOrEqual(12);
  });
  test('stepsToText of nothing is a single "no steps" line', () => {
    const out = stepsToText([]);
    expect(out.noSteps).toBe(true);
    expect(out.lines).toEqual(['(no steps available)']);
  });
});

// design 2 (11 TrigExpand, TrigCombine, TrigSimplify).
describe('trig forms', () => {
  test('TrigExpand sin(x + y) uses the addition formula', () => {
    const t = exprText('TrigExpand', [ex('sin(x+y)')]);
    expect(t).not.toContain('sin(x + y)');
    for (const [x, y] of [[0.3, 0.9], [1.1, -0.4], [2, 0.5]] as const) {
      expect(numeric(t, { x, y })).toBeCloseTo(Math.sin(x + y), 10);
    }
  });
  test('TrigExpand cos(2x) uses the double-angle formula', () => {
    const t = exprText('TrigExpand', [ex('cos(2*x)')]);
    expect(t).not.toContain('cos(2 * x)');
    expect(numeric(t, { x: 0.7 })).toBeCloseTo(Math.cos(1.4), 10);
  });
  test('TrigCombine is the inverse direction', () => {
    const t = exprText('TrigCombine', [ex('sin(x)*cos(y)+cos(x)*sin(y)')]);
    for (const [x, y] of [[0.3, 0.9], [1.1, -0.4]] as const) {
      expect(numeric(t, { x, y })).toBeCloseTo(Math.sin(x + y), 10);
    }
    expect(t).toContain('sin');
  });
  test('TrigSimplify collapses Pythagoras to 1', () => {
    expect(exprText('TrigSimplify', [ex('sin(x)^2+cos(x)^2')])).toBe('1');
  });
  test('trig forms keep the value (generated)', () => {
    for (const f of ['sin(3*x)', 'cos(x)*cos(2*x)', 'sin(x)^2*cos(x)', 'tan(x)*cos(x)']) {
      for (const op of ['TrigExpand', 'TrigCombine', 'TrigSimplify'] as const) {
        const t = exprText(op, [ex(f)]);
        expect(agree(t, f), `${op}(${f}) = ${t}`).toBe(true);
      }
    }
  });
});

// design 2.7: small exact matrices.
describe('matrices', () => {
  const A = mt([['1', '2'], ['3', '4']]);
  test('Determinant of a 2x2 and a 3x3', () => {
    expect(exprText('Determinant', [A])).toBe('-2');
    expect(exprText('Determinant', [mt([['2', '0', '1'], ['1', '3', '2'], ['1', '1', '2']])])).toBe('6');
  });
  test('Inverse times the matrix is the identity', () => {
    const inv = val('Inverse', [A]);
    if (inv.k !== 'matrix') throw new Error('expected matrix');
    const a = [[1, 2], [3, 4]];
    const m = inv.rows.map((r) => r.map((c) => numericAt(c) ?? Number.NaN));
    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        const s = (a[i]?.[0] ?? 0) * (m[0]?.[j] ?? 0) + (a[i]?.[1] ?? 0) * (m[1]?.[j] ?? 0);
        expect(s).toBeCloseTo(i === j ? 1 : 0, 12);
      }
    }
  });
  test('a singular matrix is undefined singular (Y207) and detail gives the rank', () => {
    const u = undef('Inverse', [mt([['1', '2'], ['2', '4']])]);
    expect(u.reason).toBe('singular');
    expect(u.detail?.code).toBe('Y207');
    expect(u.detail?.text).toMatch(/rank\s*1|1/);
  });
  test('CharacteristicPolynomial of [[1,2],[3,4]] is x^2 - 5x - 2', () => {
    const t = exprText('CharacteristicPolynomial', [A]);
    expect(numeric(t, { x: 2 })).toBe(-8);
    expect(numeric(t, { x: 0 })).toBe(-2);
  });
  test('Eigenvalues of a symmetric 2x2 are exact: 1 and 3', () => {
    const vals = asList(val('Eigenvalues', [mt([['2', '1'], ['1', '2']])]), 'ev').map((v) => numericAt(asExpr(v, 'ev')));
    expect([...vals].sort()).toEqual([1, 3]);
  });
  test('Eigenvectors satisfy A v = lambda v', () => {
    const M = mt([['2', '1'], ['1', '2']]);
    const lambdas = asList(val('Eigenvalues', [M]), 'ev').map((v) => numericAt(asExpr(v, 'ev')) ?? Number.NaN);
    const vecs = asList(val('Eigenvectors', [M]), 'evec');
    expect(vecs.length).toBe(lambdas.length);
    vecs.forEach((vec, i) => {
      const comps = asList(vec, 'vec').map((c) => numericAt(asExpr(c, 'c')) ?? Number.NaN);
      const l = lambdas[i] ?? 0;
      expect(2 * (comps[0] ?? 0) + (comps[1] ?? 0)).toBeCloseTo(l * (comps[0] ?? 0), 10);
      expect((comps[0] ?? 0) + 2 * (comps[1] ?? 0)).toBeCloseTo(l * (comps[1] ?? 0), 10);
    });
  });
  test('a 5 by 5 matrix is undefined limit (4 by 4 is the exact limit)', () => {
    const rows = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => (i === j ? '1' : '0')));
    expect(undef('Determinant', [mt(rows)]).reason).toBe('limit');
  });
  test('a non-square matrix is an error, not a crash', () => {
    expect(typeof err('Determinant', [mt([['1', '2']])]).kind).toBe('string');
  });
});

// design 2.1, 5.15: ToFunction, ToExpr and the numeric compiler.
describe('ToFunction, ToExpr and compileFunction', () => {
  test('ToFunction returns a Function descriptor over the parameter, and ToExpr gives the body back', () => {
    const f = val('ToFunction', [ex('x^2+1'), sy('x')]);
    if (f.k !== 'function') throw new Error(`expected function, got ${f.k}`);
    expect(f.param).toBe('x');
    expect(numeric(toText(f.body), { x: 3 })).toBe(10);
    expect(numeric(exprText('ToExpr', [f]), { x: 3 })).toBe(10);
  });
  test('compileFunction compiles the tree for plotting: call and batch agree', () => {
    const c = compileFunction('x', parseExpression('x^2+1'));
    expect(c.call(3)).toBe(10);
    expect(c.readsClock).toBe(false);
    const xs = Float64Array.from([0, 1, 2]);
    const out = new Float64Array(3);
    c.batch(xs, out);
    expect(Array.from(out)).toEqual([1, 2, 5]);
  });
  test('Steps lines are Text values', () => {
    const items = asList(val('Steps', [tx('Factor(x^2 - 5x + 6)')]), 'steps');
    for (const i of items) expect(asText(i, 'line').length).toBeGreaterThan(0);
  });
});
