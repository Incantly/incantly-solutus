/** The kernel's hooks for app modes (.kiro/specs/app-modes R3): line uses, the gate, line origin, directive values, decimal commas. */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, lineUses, registerFunctions, registerNumbers, checkLine, parseLine } from '../../../src/index';
import type { GateCall } from '../../../src/index';

function fig(): Figure {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  return new Figure({ commands: r });
}

describe('lineUses', () => {
  it('lists commands with their group, functions and operators', () => {
    const f = fig();
    f.apply('A = (1, 2)');
    let seen: GateCall | undefined;
    f.setGate((c) => {
      seen = c;
      return undefined;
    });
    expect(f.apply('M = Midpoint(A, (sin(1) + 2, 0))').ok).toBe(true);
    const u = seen?.uses;
    expect(u?.commands.map((c) => [c.name, c.group])).toEqual([['Midpoint', 'geometry']]);
    expect(u?.functions.map((x) => x.name)).toEqual(['sin']);
    expect(u?.operators.map((x) => x.name)).toEqual(['+']);
    expect(u?.equation).toBe(false);
    expect(seen?.origin).toBe('host');
  });

  it('sees equations, lists, texts and states', () => {
    const f = fig();
    const calls: GateCall[] = [];
    f.setGate((c) => {
      calls.push(c);
      return undefined;
    });
    f.apply('c = x^2 + y^2 == 4');
    f.apply('L = [1, 2, 3]');
    f.apply('t1 = "hello"');
    f.apply('s = state(0)');
    expect(calls.map((c) => [c.uses.equation, c.uses.list, c.uses.text, c.uses.state])).toEqual([
      [true, false, false, false],
      [false, true, false, false],
      [false, false, true, false],
      [false, false, false, true],
    ]);
  });

  it('is exported for hosts that check lines themselves', () => {
    const f = fig();
    const p = parseLine('d = Distance((0, 0), (3, 4))', { line: 1 });
    if (!p.ok) throw new Error();
    const c = checkLine(p.value, (f as unknown as { view: never }).view);
    if (!c.ok) throw new Error(c.message);
    expect(lineUses(c.value).commands.map((x) => x.name)).toEqual(['Distance']);
  });
});

describe('the gate', () => {
  it('a refusal fails the line and changes nothing', () => {
    const f = fig();
    f.setGate((c) => (c.uses.commands.some((x) => x.name === 'Midpoint') ? ({ ok: false, kind: 'mode_forbids', line: c.line.line, col: 1, endCol: 1, message: 'no', suggest: [], recovery: 'rewrite', fingerprint: 'x', phase: 'plan', code: 'C090', messageKey: 'k', params: {}, token: '' } as never) : undefined));
    const r = f.apply('M = Midpoint((0, 0), (2, 2))');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('mode_forbids');
    expect(f.get('M')).toBeUndefined();
    expect(f.apply('N = (1, 1)').ok).toBe(true);
  });

  it('existing objects keep working once a gate arrives', () => {
    const f = fig();
    f.apply('a = 1 in 0..5');
    f.apply('M = Midpoint((0, 0), (2 * a, 0))');
    const refuse = fig().apply('Bad(');
    f.setGate((c) => (c.uses.commands.length > 0 && !refuse.ok ? refuse : undefined));
    expect(f.setFree('a', 3).ok).toBe(true);
    f.flush();
    expect(f.value('M')).toEqual({ x: 3, y: 0 });
    // a redefinition that uses a forbidden command is refused
    expect(f.apply('M = Midpoint((0, 0), (4, 0))').ok).toBe(false);
    expect(f.apply('a = 2').ok).toBe(true);
  });

  it('a gate that throws is skipped', () => {
    const f = fig();
    f.setGate(() => {
      throw new Error('boom');
    });
    expect(f.apply('A = (1, 1)').ok).toBe(true);
  });

  it('the batch origin reaches the gate', () => {
    const f = fig();
    const origins: string[] = [];
    f.setGate((c) => {
      origins.push(c.origin);
      return undefined;
    });
    f.applyBatch(['A = (1, 1)', 'B = (2, 2)'], { group: 'model lines', origin: 'model' });
    expect(origins).toEqual(['model', 'model']);
  });
});

describe('host directives (R3.3)', () => {
  it('the model and a learner may not write @mode, @restrict or @exam', () => {
    const f = fig();
    for (const line of ['@mode geometry', '@restrict deny=Derivative', '@exam basic']) {
      for (const origin of ['model', 'learner'] as const) {
        const r = f.apply(line, { origin });
        expect(r.ok).toBe(false);
        if (r.ok) continue;
        expect(r.kind).toBe('bad_directive');
        expect(r.message).toMatch(/chosen by the host page/);
        expect(r.expected).toContain('@angleunit');
      }
    }
  });

  it('the host may', () => {
    const f = fig();
    expect(f.apply('@mode geometry').ok).toBe(true);
    expect(f.apply('@restrict hide=algebra deny=Derivative,Integral').ok).toBe(true);
    expect(f.apply('@exam off').ok).toBe(true);
    expect(f.toScript()).toContain('@restrict hide=algebra deny=Derivative,Integral');
  });
});

describe('directive values (R3.4)', () => {
  const cases: [string, boolean][] = [
    ['@angleunit degree', true], ['@angleunit radian', true], ['@angleunit degrees', false], ['@angleunit', false],
    ['@rounding 2', true], ['@rounding 0', true], ['@rounding 15', true], ['@rounding 16', false], ['@rounding 4s', true], ['@rounding 0s', false], ['@rounding 16s', false], ['@rounding two', false],
    ['@coords polar', true], ['@coords cartesian', true], ['@coords spherical', false],
    ['@title "Triangle centres"', true], ['@title Triangle', false],
    ['@restrict deny', false], ['@exam', false], ['@mode', false],
  ];
  for (const [line, ok] of cases) {
    it(line, () => {
      const r = fig().apply(line);
      expect(r.ok).toBe(ok);
      if (!r.ok) {
        expect(r.kind).toBe('bad_directive');
        expect(r.hint).toMatch(/^Write @|^Write /);
      }
    });
  }

  it('a bad value lists the legal lines', () => {
    const r = fig().apply('@angleunit gradians');
    if (r.ok) throw new Error();
    expect(r.expected).toEqual(['@angleunit radian', '@angleunit degree']);
  });
});

describe('decimal commas (R3.5)', () => {
  it('2,5 outside brackets is decimal_comma with the fixed line', () => {
    for (const [line, fixed] of [['a = 2,5', 'a = 2.5'], ['f(x) = 2,5x', 'f(x) = 2.5x'], ['b = 3 * 0,25', 'b = 3 * 0.25']]) {
      const r = fig().apply(line as string);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.kind).toBe('decimal_comma');
      expect(r.message).toBe('A comma separates arguments. Decimals use a point.');
      expect(r.suggest).toEqual([fixed]);
      expect(r.hint).toMatch(/^Write \d+\.\d+\.$/);
    }
  });

  it('a comma inside brackets is still a separator', () => {
    const f = fig();
    expect(f.apply('P = (2,5)').ok).toBe(true);
    expect(f.value('P')).toEqual({ x: 2, y: 5 });
    expect(f.apply('m = max(2,5)').ok).toBe(true);
  });

  it('a spaced comma is not read as a decimal', () => {
    const r = fig().apply('a = 2, 5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).not.toBe('decimal_comma');
  });
});
