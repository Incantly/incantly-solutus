/* Throwaway smoke probe for the functions area. Deleted before committing. */
import { describe, expect, it } from 'vitest';
import { Figure, CommandRegistry } from '@incantly/kernel';
import type { FunctionValue } from '@incantly/kernel';
import { registerFunctions } from './index';
import type { CurveData, FieldData, RegionData } from './types';
import { fitAlgebraic } from './locus';
import { asCurve, curvePoint } from './curves';
import { findRoots, quad } from './numeric';

function fig(): Figure {
  const registry = new CommandRegistry();
  registerFunctions(registry);
  return new Figure({ commands: registry });
}

function show(f: Figure, line: string): void {
  const r = f.apply(line);
  if (!r.ok) {
    console.log(`${line}  => ERROR ${r.kind}: ${r.message} ${r.hint ?? ''}`);
    return;
  }
  const cell = r.name ? f.cellOf(r.name) : undefined;
  if (cell && !cell.defined) console.log(`${line}  => UNDEFINED reason=${cell.reason} detail=${cell.detail}`);
  else console.log(`${line}  => ok type=${r.type} summary=${r.summary}`);
}

function num(f: Figure, line: string): number {
  const r = f.apply(line);
  if (!r.ok || !r.name) throw new Error(`line failed: ${line}: ${JSON.stringify(r)}`);
  return f.value(r.name) as number;
}

function fn(f: Figure, name: string): FunctionValue {
  return f.value(name) as FunctionValue;
}

describe('probe', () => {
  it('deep values', () => {
    const f = fig();
    f.apply('f(x) = x^3 - 3*x');
    f.apply('d = Derivative(f)');
    console.log('d(2) =', fn(f, 'd').call1?.(2), '(expect 9)');
    console.log('d(1) =', fn(f, 'd').call1?.(1), '(expect 0)');
    f.apply('F = Integral(f)');
    console.log('F(2) =', fn(f, 'F').call1?.(2), '(expect -2)');
    f.apply('q(x) = sin(x)/x');
    f.apply('T = Taylor(q, 0, 4)');
    console.log('T(0.5) =', fn(f, 'T').call1?.(0.5), '(expect ~0.958851)');
    console.log('T coeffs via eval at 0:', fn(f, 'T').call1?.(0), '(expect 1)');
    f.apply('g(x, y) = x - y');
    f.apply('sol = SolveODE(g, 0, 1, 4)');
    console.log('sol(4) =', fn(f, 'sol').call1?.(4), '(expect ~3.0366)');
    f.apply('r1(s, y, v) = v');
    f.apply('r2(s, y, v) = -4*y');
    show(f, 'sys = NSolveODE([r1, r2], [1, 0], 0, 6)');
    const sys = f.value('sys') as FunctionValue[] | undefined;
    console.log('sys[0](1.5708) =', sys?.[0]?.call1?.(1.5708), '(expect ~-1, cos(2s))');
    f.apply('pdx(x, y) = y');
    f.apply('pdy(x, y) = -4*x');
    show(f, 'sp = SolveODE(pdy, pdx, 1, 0, 6)');
    console.log('solveode-param defined:', f.cellOf('sp')?.defined);
    f.apply('r(x) = (x^3 - 2*x^2 - x + 4)/(2*x^2 - 2)');
    show(f, 'as = Asymptote(r, -3, 3)');
    console.log('asymptotes:', JSON.stringify(f.value('as')));
    show(f, 'rp = Roots(f)');
    console.log('Roots(f):', JSON.stringify(f.value('rp')));
    show(f, 'ex = Extremum(f)');
    f.apply('h(x) = (x^2 - 1)/(x - 1)');
    show(f, 'hh = Hole(h, -3, 3)');
    show(f, 'Lh = Limit(h, 1)');
    f.apply('sq(x) = sqrt(x)');
    show(f, 'corner = Slope(sq, 0)');
    show(f, 'up = Riemann(sq, 0, 1, 4, "upper")');
    console.log('upper value:', (f.value('up') as RegionData).value, '(expect ~0.683)');
    show(f, 'trap = TrapezoidalSum(sq, 0, 1, 100)');
    console.log('trap value:', (f.value('trap') as RegionData).value, '(expect ~0.666)');
    f.apply('os(x) = 1/x');
    show(f, 'av = Asymptote(os)');
    console.log('1/x asymptotes:', JSON.stringify(f.value('av')));
    f.apply('e2(x) = exp(x)');
    show(f, 'le = Limit(e2, inf)');
    show(f, 'le2 = Limit(os, inf)');
    f.apply('osc(x) = sin(1/x)');
    show(f, 'lo = Limit(osc, 0)');
    expect(true).toBe(true);
  });
  it('curves deep', () => {
    const f = fig();
    show(f, 'el = x^2/4 + y^2 == 1');
    show(f, 'N = Normal(el, (2, 0))');
    console.log('normal:', JSON.stringify(f.value('N')), '(expect y=0 line)');
    show(f, 'S2 = Slope(el, (0, 1))');
    console.log('slope at (0,1):', f.value('S2'), '(expect 0)');
    show(f, 'ID = ImplicitDerivative(el)');
    console.log('ID(0,1) =', fn(f, 'ID').call(0, 1), '(expect 0)');
    show(f, 'cc = Curve(cos(s), sin(s), s, 0, tau)');
    show(f, 'I = Intersect(el, cc)');
    console.log('intersections:', JSON.stringify(f.value('I')));
    show(f, 'D = Derivative(cc)');
    show(f, 'cf = Curve([(1, 0), (0, 1), (-1, 0), (0, -1), (0.7071, 0.7071)])');
    show(f, 'disc = x^2 + y^2 <= 4');
    show(f, 'AR = Area(disc, -3, 3, -3, 3)');
    console.log('disc area:', f.value('AR'), '(expect ~12.566)');
    show(f, 'half = y > x');
    show(f, 'both = x^2 + y^2 <= 4 and y > x');
    show(f, 'AR2 = Area(both, -3, 3, -3, 3)');
    console.log('half-disc area:', f.value('AR2'), '(expect ~6.283)');
    f.apply('gg(x, y) = x - y');
    show(f, 'sf2 = SlopeField(gg, 10)');
    console.log('field:', JSON.stringify({ ...(f.value('sf2') as FieldData), slope: '<fn>' }));
    expect(true).toBe(true);
  });
  it('loci deep', () => {
    const f = fig();
    f.apply('a = 0.1');
    f.apply('Q = (a, a*a)');
    show(f, 'loc = Locus(Q, a, -2, 2)');
    const loc = f.value('loc') as CurveData;
    console.log('locus pieces:', loc.curve === 'sampled' ? loc.pieces.length : loc.curve, 'samples:', loc.curve === 'sampled' ? (loc.pieces[0]?.length ?? 0) / 2 : 0);
    show(f, 'eq = LocusEquation(Q, a, -2, 2)');
    const eq = f.value('eq') as CurveData;
    console.log('locus equation:', eq.curve === 'implicit' ? eq.text : JSON.stringify(eq));
    // Ladder envelope.
    f.apply('w = sqrt(25 - a*a)');
    show(f, 'lad = w*x + a*y == a*w');
    show(f, 'env = Envelope(lad, a, 0.5, 4.9)');
    const env = f.value('env') as CurveData | undefined;
    console.log('envelope:', env && env.curve === 'sampled' ? `${env.pieces.length} pieces, first=${(env.pieces[0] as Float64Array)?.slice(0, 4)}` : JSON.stringify(env)?.slice(0, 200));
    expect(true).toBe(true);
  });
  it('fitdiag', () => {
    const pts = Array.from({ length: 600 }, (_, k) => {
      const x = -2 + (4 * (k + 0.5)) / 600;
      return { x, y: x * x };
    });
    const held = Array.from({ length: 200 }, (_, k) => {
      const x = -2 + (4 * (k + 0.25)) / 200;
      return { x, y: x * x };
    });
    console.log('direct fit:', JSON.stringify(fitAlgebraic(pts, held, 1e-9), (_, x) => typeof x === 'function' ? '<fn>' : x));
    // Now the same through the real sweep.
    const f = fig();
    f.apply('a = 0.1');
    f.apply('Q = (a, a*a)');
    f.apply('loc = Locus(Q, a, -2, 2)');
    const loc = f.value('loc') as CurveData;
    if (loc.curve === 'sampled') {
      for (const [i, pc] of loc.pieces.entries()) {
        const arr = pc as Float64Array;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < arr.length; k += 2) {
          const x = arr[k] as number;
          const y = arr[k + 1] as number;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        console.log(`sweep piece ${i}: n=${arr.length / 2} bbox=[${minX},${maxX}]x[${minY},${maxY}] first=(${arr[0]},${arr[1]}) last=(${arr[arr.length - 2]},${arr[arr.length - 1]})`);
        // Residual of y - x^2 over the piece.
        let worst = 0;
        for (let k = 0; k < arr.length; k += 2) {
          const r = Math.abs((arr[k + 1] as number) - (arr[k] as number) * (arr[k] as number));
          if (r > worst) worst = r;
        }
        console.log(`  worst |y - x^2| = ${worst}`);
      }
      void 0;
    }
    expect(true).toBe(true);
  });
  it('more forms', () => {
    const f = fig();
    f.apply('g(x, y) = x^2*y + sin(x)');
    show(f, 'dx = Derivative(g, x)');
    console.log('dx(1,2) =', fn(f, 'dx').call(1, 2), '(expect ~3.54)');
    show(f, 'dz = Derivative(g, z)');
    show(f, 'ig = Integral(g, y)');
    console.log('ig(1,2) =', fn(f, 'ig').call(1, 2), '(expect ~2+2sin1 = 3.68)');
    show(f, 'io = Integral(g, y, 0, 1)');
    console.log('io(2) =', fn(f, 'io').call1?.(2), '(expect ~2+sin2 = 2.909)');
    show(f, 'rose = Polar(sin(3*th) + 2, th, 0, tau)');
    const rose = f.value('rose');
    console.log('rose(0) =', JSON.stringify(curvePoint(asCurve(rose)!, 0)));
    show(f, 'spc = Spline([(0, 0), (1, 1), (2, 0)], true, "centripetal")');
    show(f, 'w6 = Curve([(0, 0), (1, 1)])');
    show(f, 'cusp(s) = (s*s, s*s*s)');
    show(f, 'cu = Curve(s*s, s*s*s, s, -1, 1)');
    show(f, 'tcu = Tangent(cu, 0)');
    console.log('cusp tangent:', JSON.stringify(f.value('tcu')));
    show(f, 'scu = Slope(cu, 0)');
    show(f, 'ln1 = Curve(s, 2*s + 1, s, 0, 1)');
    show(f, 'ol = OsculatingCircle(ln1, 0.5)');
    show(f, 'cc2 = Curve(cos(s), sin(s), s, 0, tau)');
    show(f, 'sv = Slope(cc2, 0)');
    show(f, 'tp = Tangent(cc2, (0, 1))');
    show(f, 'w2 = sin(x) + sin(y) == 0');
    show(f, 'aw = Asymptote(w2)');
    f.apply('a = 0.5');
    f.apply('Q = (a, a)');
    show(f, 'lp = Locus(Q, (1, 1))');
    f.apply('Pf = (1, 2)');
    show(f, 'lp2 = Locus(Q, Pf)');
    f.apply('st = (1, 1)');
    show(f, 'pth = Path(st, 0, 1)');
    show(f, 'inf = Inflection(x^3 - 3*x)');
    show(f, 'h2(x) = x^2 - 2');
    show(f, 'rl = RootList(h2, [-2, 2])');
    show(f, 'la = LimitAbove(h2, 0)');
    show(f, 'lb = LimitBelow(h2, 0)');
    show(f, 'ni2 = NIntegral(h2, 0, 1)');
    console.log('NIntegral:', f.value('ni2'), '(expect -1.6667)');
    show(f, 'tp2 = TurningPoint(h2, -2, 2)');
    show(f, 'rd = RemovableDiscontinuity(h2, -2, 2)');
    show(f, 'ls = LeftSum(h2, 0, 1, 10)');
    show(f, 'pd = ParametricDerivative(cc2, 1)');
    console.log('ParametricDerivative:', f.value('pd'));
    f.apply('bl(x, y) = 1 + y^2');
    show(f, 'bad = SolveODE(bl, 0, 0, 3)');
    const bad = fn(f, 'bad');
    console.log('blowup sol(1.5) =', bad.call1?.(1.5), 'sol(3) =', bad.call1?.(3), '(expect finite then undefined)');
    f.apply('e1 = x^2 + y^2 == 1');
    f.apply('e2c = (x-1)^2 + y^2 == 1');
    show(f, 'ccx = Intersect(e1, e2c)');
    console.log('circle-circle:', JSON.stringify(f.value('ccx')));
    show(f, 'bw = Boundary(x^2 + y^2 <= 4, -5, 5)');
    expect(true).toBe(true);
  });
  it('perf', () => {
    const f = fig();
    const t = (label: string, fn2: () => void): void => {
      fn2();
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) fn2();
      console.log(`${label}: ${((performance.now() - t0) / 5).toFixed(2)} ms`);
    };
    f.apply('p8(x) = x^8 - 8*x^7 + 20*x^6 - 8*x^5 - 26*x^4 + 8*x^3 + 20*x^2 - 8*x + 1');
    t('roots deg-8', () => {
      const g = fig();
      g.apply('p8(x) = x^8 - 8*x^7 + 20*x^6 - 8*x^5 - 26*x^4 + 8*x^3 + 20*x^2 - 8*x + 1');
      g.apply('r = Roots(p8, -3, 3)');
    });
    t('smooth integral', () => {
      const g = fig();
      g.apply('s(x) = sin(x) + x^2/10');
      g.apply('i = Integral(s, 0, 5)');
    });
    t('sin(1/x) roots', () => {
      const g = fig();
      g.apply('w(x) = sin(1/x)');
      g.apply('r = Roots(w, 0.01, 1)');
    });
    t('ode 2-var', () => {
      const g = fig();
      g.apply('r1(s, y, v) = v');
      g.apply('r2(s, y, v) = -9.8*sin(y)');
      g.apply('o = NSolveODE([r1, r2], [0.6, 0], 0, 10)');
    });
    t('locus quad', () => {
      const g = fig();
      g.apply('a = 0.1');
      g.apply('Q = (a, a*a)');
      g.apply('l = Locus(Q, a, -2, 2)');
    });
    t('area disc', () => {
      const g = fig();
      g.apply('AR = Area(x^2 + y^2 <= 4, -3, 3, -3, 3)');
    });
    t('taylor-12', () => {
      const g = fig();
      g.apply('e(x) = exp(x)');
      g.apply('T = Taylor(e, 0, 12)');
    });
    // Batch speed of an emitted derivative.
    const g = fig();
    g.apply('b(x) = sin(x)*cos(2*x) + sqrt(x + 2)');
    g.apply('db = Derivative(b)');
    const db = fn(g, 'db');
    const xs = new Float64Array(2000);
    for (let i = 0; i < 2000; i++) xs[i] = (i / 2000) * 5;
    const out = new Float64Array(2000);
    db.batch?.(xs, out);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) db.batch?.(xs, out);
    console.log(`deriv batch 2000: ${((performance.now() - t0) / 20).toFixed(3)} ms`);
    // Root counts.
    const g2 = fig();
    g2.apply('w(x) = sin(1/x)');
    g2.apply('r = Roots(w, 0.01, 1)');
    console.log('sin(1/x) root count:', (g2.value('r') as unknown[]).length, '(expect 62)');
    const g3 = fig();
    g3.apply('p8(x) = x^8 - 8*x^7 + 20*x^6 - 8*x^5 - 26*x^4 + 8*x^3 + 20*x^2 - 8*x + 1');
    g3.apply('r = Roots(p8, -3, 3)');
    console.log('deg-8 roots:', JSON.stringify(g3.value('r')));
    // Method-only timings (no line overhead).
    const mkWork = (): import('@incantly/kernel').RuleWork => {
      let used = 0;
      const limit = 1000000;
      return { limit, get used() { return used; }, get left() { return limit - used; }, spend: (n = 1) => { used += n; return used <= limit; } };
    };
    const fq = (x: number): number => Math.sin(x) + (x * x) / 10;
    let t1 = performance.now();
    for (let i = 0; i < 100; i++) quad(fq, 0, 5, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: mkWork() });
    console.log(`quad smooth method-only: ${((performance.now() - t1) / 100).toFixed(3)} ms`);
    const fr = (x: number): number => x * x * x - 3 * x;
    t1 = performance.now();
    for (let i = 0; i < 100; i++) findRoots(fr, -3, 3, 1e-9, mkWork(), 512);
    console.log(`roots cubic method-only: ${((performance.now() - t1) / 100).toFixed(3)} ms`);
    expect(true).toBe(true);
  });
  it('errors', () => {
    const f = fig();
    for (const line of [
      's(x) = sin(x)',
      'ni = Roots(s)',
      'ne = Extremum(s)',
      'nl = Limit(s, 0)',
      'f(x) = x^2',
      'xo = Derivative(f, 2.5)',
      'xo2 = Taylor(f, 0, 100)',
      'xo3 = Riemann(f, 0, 1, 4, "middle")',
      'xo4 = Root(f, 2, 3)',
      'xo5 = Slope(f, 1, 2)',
      'xo6 = Length(x^2 + y^2 == 1)',
      'xo7 = Derivative(x^2 + y^2 == 1)',
      'xo8 = Asymptote(sin(x))',
    ]) show(f, line);
    expect(true).toBe(true);
  });
});
