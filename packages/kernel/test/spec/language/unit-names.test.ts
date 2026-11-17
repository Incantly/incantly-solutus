/** The angle units `turn` and `grad` are constants, so they are reserved like `deg` (language/design.md 3.7, errors.md reserved_name). */
import { describe, expect, it } from 'vitest';
import { BUILTIN_CONSTANTS, CommandRegistry, Figure, geometry, registerAnimation, registerFunctions, registerNumbers, registerPhysics } from '../../../src/index';

const registry = (): CommandRegistry => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerPhysics(r);
  return r;
};
const REG = registry();
const newFigure = (): Figure => new Figure({ commands: REG });

type Err = { ok: false; kind: string; message: string; hint?: string; suggest?: string[] };
const fail = (f: Figure, line: string): Err => {
  const r = f.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as unknown as Err;
};
const ok = (f: Figure, line: string): void => {
  const r = f.apply(line);
  if (!r.ok) throw new Error(`${line}: ${(r as { message: string }).message}`);
};

describe('3.7 every built-in constant is a reserved name', () => {
  it.each(BUILTIN_CONSTANTS.map((c) => c.name))('%s = 1 is reserved_name', (n) => {
    expect(fail(newFigure(), `${n} = 1`).kind).toBe('reserved_name');
  });
});

describe('turn as a name', () => {
  it('a slider named turn is refused, with steering as the free name', () => {
    const f = newFigure();
    const e = fail(f, 'turn = 0 in -1..1');
    expect(e.kind).toBe('reserved_name');
    expect(e.message).toContain('constant');
    expect(e.hint).toContain('steering');
    expect(e.suggest?.[0]).toBe('steering = 0 in -1..1');
    ok(f, e.suggest?.[0] as string);
  });

  it('grad is refused the same way', () => {
    expect(fail(newFigure(), 'grad = 2').kind).toBe('reserved_name');
  });

  it('the unit still reads as an angle after the refusal', () => {
    const f = newFigure();
    fail(f, 'turn = 0 in -1..1');
    ok(f, 'a = 0.5turn');
    expect(f.value('a')).toBeCloseTo(Math.PI, 15);
  });

  it('a name that only starts with turn is free', () => {
    const f = newFigure();
    ok(f, 'turning = 0 in -1..1');
    ok(f, 'turn_1 = 2');
  });
});
