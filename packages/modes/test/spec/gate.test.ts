/** Lines in a mode (.kiro/specs/app-modes R3.1, R3.2, R3.4): the gate built from a policy, on a real figure. */
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry, Figure, geometry, registerAnimation, registerFunctions, registerLists, registerNumbers, registerProbability, registerStatistics, registerText,
} from '@incantly/kernel';
import { EXAM_PROFILES, MODES, catalogueOf, compilePolicy, deriveMode, makeGate } from '../../src/index';
import type { GateLayer, ModeConfig, ModeForbidsError } from '../../src/index';

const registry = (): CommandRegistry => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerLists(r);
  registerStatistics(r);
  registerProbability(r);
  registerText(r);
  return r;
};
const REG = registry();
const CAT = catalogueOf(REG.all());

function figureIn(layers: GateLayer[], locked?: string[]): Figure {
  const f = new Figure({ commands: REG });
  f.setGate(makeGate({ layers, catalogue: CAT, ...(locked ? { lockedDirectives: locked } : {}) }));
  return f;
}
const layer = (m: ModeConfig, reason: GateLayer['reason'] = 'mode', examProfile?: GateLayer['examProfile']): GateLayer => ({ policy: compilePolicy(m), reason, ...(examProfile ? { examProfile } : {}) });

function forbids(f: Figure, line: string): ModeForbidsError {
  const r = f.apply(line, { origin: 'learner' });
  if (r.ok) throw new Error(`${line} was accepted`);
  expect(r.kind).toBe('mode_forbids');
  return r as unknown as ModeForbidsError;
}

describe('the gate in a mode (R3.1)', () => {
  it('every command in the table has a group a mode can name', () => {
    expect(CAT.every((c) => typeof c.group === 'string' && c.group.length > 0)).toBe(true);
  });

  it('scientific refuses a circle and names it', () => {
    const f = figureIn([layer(MODES.scientific)]);
    expect(f.apply('r1 = 3/5 + 1/4').ok).toBe(true);
    expect(f.apply('r2 = Mean([1, 2, 3])').ok).toBe(true);
    const e = forbids(f, 'c = Circle((0, 0), 2)');
    expect(e.command).toBe('Circle');
    expect(e.mode).toBe('scientific');
    expect(e.reason).toBe('mode');
    expect(e.message).toBe('Circle is not available in the scientific mode.');
    expect(e.col).toBe(5);
    expect(f.get('c')).toBeUndefined();
  });

  it('a command two areas give is judged by the form used (Normal: a line, a curve normal or a distribution)', () => {
    expect(CAT.filter((c) => c.name === 'Normal').map((c) => c.group).sort()).toEqual(['distributions', 'functions', 'geometry']);
    expect(figureIn([layer(MODES.probability)]).apply('d = Normal(0, 1)', { origin: 'learner' }).ok).toBe(true);
    expect(forbids(figureIn([layer(MODES.geometry)]), 'd = Normal(0, 1)').command).toBe('Normal');
  });

  it('scientific refuses equations and texts', () => {
    const f = figureIn([layer(MODES.scientific)]);
    expect(forbids(f, 'cc = x^2 + y^2 == 4').message).toMatch(/equation/);
    expect(forbids(f, 'tx = "hi"').message).toMatch(/^Text/);
  });

  it('geometry refuses Derivative and offers allowed commands of the same group', () => {
    const f = figureIn([layer(MODES.geometry)]);
    f.apply('f(x) = x^2');
    const e = forbids(f, 'd = Derivative(f)');
    expect(e.allowedInstead.length).toBeGreaterThan(0);
    expect(e.allowedInstead.length).toBeLessThanOrEqual(5);
    for (const n of e.allowedInstead) expect(compilePolicy(MODES.geometry).command(n, CAT.find((c) => c.name === n)?.group ?? '')).toBe(true);
    expect(e.hint).toMatch(/available/);
  });

  it('geometry allows motion with state(); probability refuses it', () => {
    const f = figureIn([layer(MODES.geometry)]);
    expect(f.apply('s = state(0)', { origin: 'learner' }).ok).toBe(true);
    expect(f.apply("s' = 1", { origin: 'learner' }).ok).toBe(true);
    expect(forbids(figureIn([layer(MODES.probability)]), 's = state(0)').message).toMatch(/state/);
  });

  it('figure mode lets everything through', () => {
    const f = figureIn([layer(MODES.figure)]);
    for (const l of ['f(x) = x^2', 'd = Derivative(f)', 'cc = x^2 + y^2 == 4', 's = state(0)', 'h = Histogram([0, 1, 2, 3, 4], [1, 2, 2, 3])']) expect(f.apply(l).ok).toBe(true);
  });
});

describe('restriction and exam layers (R3.1, R3.2)', () => {
  it('the reason names the narrowest layer that refuses', () => {
    const restricted = deriveMode(MODES.graphing, { base: 'graphing', denyCommands: ['Integral'] }, { commands: CAT });
    const exam = deriveMode(restricted.ok ? restricted.value : MODES.graphing, { base: 'graphing', ...EXAM_PROFILES.basic.restrict }, { commands: CAT });
    if (!restricted.ok || !exam.ok) throw new Error();
    const f = figureIn([layer(MODES.graphing), layer(restricted.value, 'restriction'), layer(exam.value, 'exam', 'basic')]);
    f.apply('f(x) = x^2');
    const a = forbids(f, 'i = Integral(f, 0, 1)');
    expect(a.reason).toBe('restriction');
    const b = forbids(f, 'd = Derivative(f)');
    expect(b.reason).toBe('exam');
    expect(b.examProfile).toBe('basic');
    expect(b.message).toBe("Derivative is not available in exam profile 'basic' (mode: graphing).");
    expect(b.hint).toMatch(/^This test does not allow it\./);
    const c = forbids(f, 'H = Hyperbola((0, 0), (3, 0), 1)');
    expect(c.reason).toBe('mode');
    expect(f.apply('tg = Tangent(f, 1)').ok).toBe(true);
  });

  it('a function denied by an exam is refused, others still work', () => {
    const exam = deriveMode(MODES.scientific, { base: 'scientific', denyFunctions: ['ln'] });
    if (!exam.ok) throw new Error();
    const f = figureIn([layer(MODES.scientific), layer(exam.value, 'exam', 'custom')]);
    const e = forbids(f, 'r1 = ln(2)');
    expect(e.function).toBe('ln');
    expect(f.apply('r1 = sin(2)').ok).toBe(true);
  });

  it('existing objects keep working; a redefinition with the forbidden command is refused (R3.2)', () => {
    const f = new Figure({ commands: REG });
    f.apply('a = 1 in 0..4');
    expect(f.apply('f(x) = a * x^2').ok).toBe(true);
    expect(f.apply('d = Derivative(f)').ok).toBe(true);
    const exam = deriveMode(MODES.graphing, { base: 'graphing', ...EXAM_PROFILES.basic.restrict }, { commands: CAT });
    if (!exam.ok) throw new Error();
    f.setGate(makeGate({ layers: [layer(MODES.graphing), layer(exam.value, 'exam', 'basic')], catalogue: CAT }));
    expect(f.setFree('a', 2).ok).toBe(true);
    f.flush();
    expect(f.get('d')?.cell.defined).toBe(true);
    expect(forbids(f, 'd = Derivative(f) + 1').command).toBe('Derivative');
  });

  it('locked directives are refused during an exam (R3.4)', () => {
    const f = figureIn([layer(MODES.graphing), layer(MODES.graphing, 'exam', 'basic')], ['angleunit', 'rounding']);
    const e = forbids(f, '@angleunit degree');
    expect(e.reason).toBe('exam');
    expect(f.apply('@view -5 5 -5 5').ok).toBe(true);
  });

  it('an argument rule refuses the expression form and keeps the function form', () => {
    const narrowed: ModeConfig = { ...MODES.graphing, commands: { ...MODES.graphing.commands, argumentRules: [{ command: 'Derivative', firstArg: 'user-function', hint: 'Define f(x) first, then write Derivative(f).' }] } };
    const f = figureIn([layer(narrowed)]);
    f.apply('f(x) = x^3');
    expect(f.apply('d = Derivative(f)').ok).toBe(true);
    const r = f.apply('d2 = Derivative(x^3)');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('no_matching_form');
      expect(r.hint).toMatch(/Define f\(x\) first/);
    }
  });
});
