/* Throwaway smoke probe for the functions area. Deleted before committing. */
import { describe, expect, it } from 'vitest';
import { Figure, CommandRegistry } from '@incantly/kernel';
import type { FunctionValue } from '@incantly/kernel';
import { registerFunctions } from './index';
import type { CurveData, FieldData, RegionData } from './types';
import { fitAlgebraic } from './locus';

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
    console.log('sys[0](1.5708) =', sys?.[0]?.call1?.(1.5708), '(expect ~0)');
    f.apply('sp = SolveODE(r2, r1, 1, 0, 6)');
    console.log('solveode-param type:', f.cellOf('sp') !== undefined);
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
