import { describe, expect, it } from 'vitest';
import type { Inc } from '../src/api/types';
import { calculus as calc } from '../src/helpers/calc';
import { motion } from '../src/helpers/motion';
import { shapes } from '../src/helpers/shapes';
import { chem, sym } from '../src/helpers/sym';
import { units } from '../src/helpers/units';
import { vectors as vec } from '../src/helpers/vec';
import { SceneRuntime } from '../src/runtime/runtime';
import { validateSceneJs } from '../src/validation/js';

const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe('inc.calc (FM-6, FM-7)', () => {
  it('gives scenes the same smooth noise as formulas (FM-5)', async () => {
    const { compileExpression } = await import('../src/expr');
    for (const x of [-2.3, 0.4, 5.75]) expect(calc.noise(x)).toBe(compileExpression('noise(x)', ['x']).evaluate({ x }));
    expect(calc.noise(0.4, 1.6)).toBe(compileExpression('noise(x, y)', ['x', 'y']).evaluate({ x: 0.4, y: 1.6 }));
  });

  it('differentiates, integrates and finds roots and turning points', () => {
    close(calc.derivative(Math.sin, 0), 1);
    close(calc.derivative((x) => x * x * x, 2), 12, 4);
    close(calc.integral((x) => x * x, 0, 3), 9);
    close(calc.integral(Math.sin, 0, Math.PI), 2);
    close(calc.root((x) => x * x - 2, 0, 2)!, Math.SQRT2, 9);
    expect(calc.root((x) => x * x + 1, -1, 1)).toBeNull();
    const roots = calc.roots(Math.sin, 0.5, 10);
    expect(roots).toHaveLength(3);
    roots.forEach((r, i) => close(r, Math.PI * (i + 1), 6));
    // tan jumps across its asymptotes without a root there.
    expect(calc.roots(Math.tan, 1, 2)).toEqual([]);
    const turns = calc.extrema(Math.sin, 0, 7);
    expect(turns.map((t) => t.kind)).toEqual(['max', 'min']);
    close(turns[0]!.x, Math.PI / 2, 3);
    close(turns[1]!.y, -1, 6);
  });

  it('interpolates tables and steps ODEs', () => {
    expect(calc.interp([0, 1, 3], [0, 10, 30], 2)).toBe(20);
    expect(calc.interp([0, 1], [5, 6], -4)).toBe(5);
    // dy/dt = y from y = 1: e after one second.
    let y: readonly number[] = [1];
    for (let i = 0; i < 10; i++) y = calc.rk4((_t, v) => [v[0]!], i * 0.1, y, 0.1);
    close(y[0]!, Math.E, 5);
    let e: readonly number[] = [1];
    for (let i = 0; i < 10; i++) e = calc.euler((_t, v) => [v[0]!], i * 0.1, e, 0.1);
    expect(e[0]!).toBeLessThan(Math.E);
    expect(() => calc.rk4((() => [1, 2]) as never, 0, [1], 0.1)).toThrow('one rate per value');
  });

  it('knows the normal distribution and the small helpers', () => {
    close(calc.normal(0), 1 / Math.sqrt(2 * Math.PI));
    close(calc.normalCdf(1.96), 0.975, 3);
    close(calc.normalCdf(0, 5, 2), calc.normalCdf(-2.5), 6);
    expect(calc.clamp(5, 0, 1)).toBe(1);
    expect(calc.lerp(2, 4, 0.25)).toBe(2.5);
    expect(calc.map(5, 0, 10, 100, 200)).toBe(150);
    expect(() => calc.integral(Math.sin, 0, 1, 1e9)).toThrow('steps');
  });
});

describe('inc.vec (FM-9)', () => {
  it('works on 2D and 3D vectors and 3x3 matrices', () => {
    expect(vec.add([1, 2], [3, 4])).toEqual([4, 6]);
    expect(vec.sub([1, 2, 3], [1, 1, 1])).toEqual([0, 1, 2]);
    expect(vec.dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(vec.cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(vec.cross([2, 0], [0, 3])).toBe(6);
    expect(vec.length([3, 4])).toBe(5);
    expect(vec.normalize([0, 0])).toEqual([0, 0]);
    const r = vec.rotate([1, 0], Math.PI / 2);
    close(r[0], 0);
    close(r[1], 1);
    close(vec.angle([1, 0], [0, 2]), Math.PI / 2);
    const m = vec.rotA([0, 0, 1], Math.PI / 2);
    const p = vec.apply(m, [1, 0, 0]);
    close(p[0], 0);
    close(p[1], 1);
    const twice = vec.apply(vec.mul(m, m), [1, 0, 0]);
    close(twice[0], -1);
    expect(() => vec.add([1, 2], [1, 2, 3])).toThrow('same size');
    expect(() => vec.length([1] as never)).toThrow('2 or 3 numbers');
  });
});

describe('inc.units (FM-8)', () => {
  it('converts within a quantity and refuses across quantities', () => {
    close(units.convert(100, 'C', 'F'), 212, 9);
    close(units.convert(32, '°F', 'K'), 273.15, 9);
    close(units.convert(0, 'K', 'C'), -273.15, 9);
    expect(units.convert(1, 'km', 'm')).toBe(1000);
    close(units.convert(1, 'atm', 'kPa'), 101.325, 9);
    close(units.convert(180, 'deg', 'rad'), Math.PI, 12);
    close(units.convert(36, 'km/h', 'm/s'), 10, 12);
    expect(() => units.convert(1, 'm', 's')).toThrow('Cannot convert length (m) to time (s)');
    expect(() => units.convert(1, 'furlong', 'm')).toThrow('does not know "furlong"');
  });

  it('formats values for reading', () => {
    expect(units.format(12.345, 'm/s')).toBe('12.35 m/s');
    expect(units.format(30, '°', 0)).toBe('30°');
    expect(units.format(-0.001, '', 1)).toBe('0.0');
    expect(units.format(Number.NaN, 'm')).toBe('—');
  });
});

describe('inc.motion (MO-1)', () => {
  it('follows, springs, tours and swings as functions of time', () => {
    close(motion.follow(0, 10, 0.15, 0.15), 5);
    expect(motion.follow(0, 10, 0)).toBe(0);
    let state: readonly [number, number] = [0, 0];
    for (let i = 0; i < 300; i++) state = motion.spring(state[0], state[1], 1, 1 / 60);
    close(state[0], 1, 3);
    // Big steps stay stable.
    const big = motion.spring(0, 0, 1, 0.5);
    expect(Math.abs(big[0])).toBeLessThan(2);
    expect(motion.tour(0.5, [1, 2, 3], { hold: 1, move: 1 })).toBe(1);
    close(motion.tour(1.5, [1, 2, 3], { hold: 1, move: 1, ease: 'linear' }), 1.5);
    expect(motion.tour(4.5, [1, 2, 3], { hold: 1, move: 1 })).toBe(3);
    // Then back to the first value, looping.
    close(motion.tour(5.5, [1, 2, 3], { hold: 1, move: 1, ease: 'linear' }), 2);
    close(motion.wave(1, 2), 1);
    close(motion.ease(0.5, 'linear'), 0.5);
  });
});

describe('inc.shapes (SV-4, DG-1)', () => {
  const ends = (d: string) => {
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    return { first: numbers.slice(0, 2), last: numbers.slice(-2) };
  };

  it('draws lines of springs, resistors, coils and waves from end to end', () => {
    for (const draw of [shapes.spring, shapes.zigzag, shapes.coil]) {
      const { first, last } = ends(draw(10, 20, 110, 20));
      expect(first).toEqual([10, 20]);
      expect(last).toEqual([110, 20]);
    }
    expect(shapes.wave(0, 0, 100, 0, { wavelength: 50 })).toMatch(/^M0 0L/);
    expect(() => shapes.spring(0, 0, 1, Number.NaN)).toThrow('finite numbers');
    expect(() => shapes.spring(0, 0, 10, 0, { coils: 500 })).toThrow('from 1 to 60');
  });

  it('closes gears, hulls, blobs and polygons', () => {
    for (const d of [shapes.gear({ center: [50, 50], radius: 20 }), shapes.hull([[0, 0, 10], [100, 0, 20]]), shapes.blob(0, 0, 10, { seed: 3 }), shapes.regular(0, 0, 10, 6), shapes.polygon([[0, 0], [1, 0], [0, 1]])]) {
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
    }
    // The belt reaches the far side of the larger pulley.
    const xs = shapes.hull([[0, 0, 10], [100, 0, 20]]).match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeCloseTo(120, 0);
    expect(Math.min(...xs)).toBeCloseTo(-10, 0);
    expect(shapes.blob(0, 0, 10, { seed: 3 })).toBe(shapes.blob(0, 0, 10, { seed: 3 }));
  });

  it('keeps a gear\'s teeth between half its radius and its rim, whether depth is a fraction or units', () => {
    // A sprocket once asked for depth: 4, meaning units, and drew spikes three radii long.
    const radii = (d: string) => {
      const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      return n.filter((_, i) => i % 2 === 0).map((x, i) => Math.hypot(x - 50, n[2 * i + 1]! - 50));
    };
    for (const [toothDepth, inner] of [[undefined, 50 * 0.82], [5, 45], [4, 46], [500, 25]] as const) {
      const r = radii(shapes.gear({ center: [50, 50], radius: 50, teeth: 20, ...(toothDepth !== undefined ? { toothDepth } : {}) }));
      expect(Math.max(...r), String(toothDepth)).toBeCloseTo(50, 1);
      expect(Math.min(...r), String(toothDepth)).toBeCloseTo(inner, 1);
    }
    // Saved figures call it as (cx, cy, r, { depth }), a fraction under 1 and units from 1.
    const positional = shapes.gear as unknown as (cx: number, cy: number, r: number, options?: { teeth?: number; depth?: number }) => string;
    expect(positional(50, 50, 50, { teeth: 20, depth: 0.1 })).toBe(shapes.gear({ center: [50, 50], radius: 50, teeth: 20, toothDepth: 5 }));
    expect(positional(50, 50, 50, { teeth: 20, depth: 4 })).toBe(shapes.gear({ center: [50, 50], radius: 50, teeth: 20, toothDepth: 4 }));
    expect(() => shapes.gear({ radius: 5 } as never)).toThrow('center: [x, y]');
    expect(shapes.gear({ cx: 50, cy: 50, r: 50, teeth: 20 } as never)).toBe(shapes.gear({ center: [50, 50], radius: 50, teeth: 20 }));
    // Turned by a whole tooth, a gear looks the same; by half a tooth, it does not.
    const step = (2 * Math.PI) / 20;
    expect(shapes.gear({ center: [50, 50], radius: 50, teeth: 20, rotation: step * 20 })).toBe(shapes.gear({ center: [50, 50], radius: 50, teeth: 20 }));
    expect(shapes.gear({ center: [50, 50], radius: 50, teeth: 20, rotation: step / 2 })).not.toBe(shapes.gear({ center: [50, 50], radius: 50, teeth: 20 }));
  });

  it('draws circuit symbols, lenses, tanks and braces', () => {
    for (const d of [
      shapes.battery(0, 0, 100, 0, { cells: 2 }),
      shapes.capacitor(0, 0, 100, 0),
      shapes.ground(0, 0),
      shapes.bulb(0, 0, 10),
      shapes.switch(0, 0, 100, 0, false),
      shapes.switch(0, 0, 100, 0, true),
      shapes.lens(50, 50, 80),
      shapes.lens(50, 50, 80, { bulge: -0.2 }),
      shapes.tank(0, 0, 50, 80),
      shapes.brace(0, 0, 0, 100),
    ]) {
      expect(d).toMatch(/^M-?\d/);
      expect(d).not.toContain('NaN');
    }
    expect(shapes.switch(0, 0, 100, 0, true)).not.toBe(shapes.switch(0, 0, 100, 0, false));
  });
});

describe('inc.sym and inc.chem (DG-5)', () => {
  it('writes scripts, Greek letters and operators as text', () => {
    expect(sym('v_0^2')).toBe('v₀²');
    expect(sym('Delta theta')).toBe('Δ θ');
    expect(sym('e^{-x}')).toBe('e⁻ˣ');
    expect(sym('x^-1')).toBe('x⁻¹');
    expect(sym('x^2-1')).toBe('x²-1');
    expect(sym('v_max')).toBe('vₘₐₓ');
    expect(sym('theta_0')).toBe('θ₀');
    expect(sym('F -> m*a')).toBe('F → m·a');
    expect(sym('a <= b != c')).toBe('a ≤ b ≠ c');
    expect(sym('m/s^2')).toBe('m/s²');
    expect(sym('\\vec{F}')).toBe('F\u20d7');
    expect(sym('\\alpha + \\beta')).toBe('α + β');
    expect(sym('2pi r')).toBe('2π r');
    // Words that merely contain a Greek name stay as they are.
    expect(sym('alphabet epsilonic pivot')).toBe('alphabet epsilonic pivot');
    // Characters with no subscript form keep their notation.
    expect(sym('x_q')).toBe('x_q');
    expect(sym('T_{cq}')).toBe('T_(cq)');
  });

  it('writes chemical formulas, charges, equations and hydrates', () => {
    expect(chem('H2SO4')).toBe('H₂SO₄');
    expect(chem('Ca(OH)2')).toBe('Ca(OH)₂');
    expect(chem('SO4^2-')).toBe('SO₄²⁻');
    expect(chem('Fe^3+')).toBe('Fe³⁺');
    expect(chem('Na+ + Cl- -> NaCl')).toBe('Na⁺ + Cl⁻ → NaCl');
    expect(chem('2H2 + O2 -> 2H2O')).toBe('2H₂ + O₂ → 2H₂O');
    expect(chem('N2 + 3H2 <=> 2NH3')).toBe('N₂ + 3H₂ ⇌ 2NH₃');
    expect(chem('CuSO4.5H2O')).toBe('CuSO₄·5H₂O');
    expect(chem('NH4+(aq)')).toBe('NH₄⁺(aq)');
    expect(chem('^14C')).toBe('¹⁴C');
    expect(chem('CH3-CH3')).toBe('CH₃-CH₃');
    expect(chem('0.1 M HCl')).toBe('0.1 M HCl');
  });

  it('refuses what is not text', () => {
    expect(() => sym(3 as never)).toThrow('needs a string');
    expect(() => chem('H'.repeat(500))).toThrow('at most 400');
  });
});

describe('the kit on inc', () => {
  it('is reachable from scenes and passes the validator', () => {
    const source = `
const s = inc.svg('#s', { viewBox: [0, 0, 200, 100], title: 'Kit' });
const k = inc.param('k', { min: 1, max: 10, value: 4 });
const spring = s.path(inc.shapes.spring(10, 50, 100, 50));
const label = s.text(150, 50, inc.chem('H2O'));
inc.state.set('ready', true);
inc.onFrame((frame) => {
  const area = inc.calc.integral((x) => k.value * x, 0, 1);
  const v = inc.vec.rotate([1, 0], frame.time);
  spring.set(inc.shapes.spring(10, 50, 100 + 10 * inc.motion.wave(frame.time), 50));
  label.text(inc.units.format(area, 'J') + ' ' + inc.sym('theta_0') + ' ' + v[0].toFixed(1));
});
`;
    const { diagnostics } = validateSceneJs(source);
    expect(diagnostics.map((d) => d.message)).toEqual([]);
    const runtime = new SceneRuntime({ autoplay: false });
    const mount = runtime.mount((inc: Inc) => {
      const s = inc.svg('#s', { viewBox: [0, 0, 200, 100], title: 'Kit' });
      const label = s.text(150, 50, inc.chem('H2O'));
      inc.onFrame(() => label.text(inc.units.format(inc.calc.integral((x) => x, 0, 2), 'J')));
    });
    runtime.tick(0);
    expect(mount.ui.error).toBeNull();
    expect(Object.isFrozen(runtime.inc.calc)).toBe(true);
  });

  it('names the namespace members a scene got wrong', () => {
    const { diagnostics } = validateSceneJs(`inc.calc.differentiate((x) => x, 1);\ninc.kits.go();`);
    const messages = diagnostics.map((d) => d.message);
    expect(messages[0]).toContain('inc.calc.differentiate is not part of the SDK. Available: clamp, derivative,');
    expect(messages[1]).toContain('inc.kits is not part of the SDK');
  });

  it('suggests the helper a scene meant: a close name, or two names joined', () => {
    const { diagnostics } = validateSceneJs(`const p = inc.calc.integrate((x) => x, 0, 1);\nconst q = inc.calc.normal.cdf(1) - inc.calc.normal.cdf(-1);\nconst r = inc.calc.normal(0, 0, 1);`);
    const messages = diagnostics.map((d) => d.message);
    expect(messages[0]).toContain('inc.calc.integrate is not part of the SDK; did you mean inc.calc.integral? Available:');
    expect(messages[1]).toBe('inc.calc.normal is a function, not an object of helpers; did you mean inc.calc.normalCdf?');
    // Called as a function, the helper is fine.
    expect(diagnostics).toHaveLength(3);
  });
});
