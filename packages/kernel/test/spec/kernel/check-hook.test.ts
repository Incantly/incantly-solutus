/**
 * The check-time hooks of a command (errors design, "Check time"): `CommandForm.check` refuses a line whose arguments
 * fit the form but can never work, and `CommandSpec.refuse` gives arguments that fit no form a specific error.
 * Built from the public API only.
 */
import { describe, expect, it } from 'vitest';
import { Figure } from '@incantly/kernel';
import type { CallCheck, CommandSpec, FormCheck, Refusal, RuleCall } from '@incantly/kernel';
import { bad, expectUnchanged, expectWellFormedError, ok, snap } from './helpers';

const seen: FormCheck[] = [];
const seenCalls: CallCheck[] = [];

const num = (call: RuleCall, i: number): number => call.values[i] as number;

/** `Ring(centre, radius)`: a negative literal radius is refused; a radius of 13 makes the hook throw. */
const RING: CommandSpec = {
  name: 'Ring',
  kind: 'object',
  group: 'test',
  forms: [{
    params: [{ name: 'centre', type: 'Point' }, { name: 'radius', type: 'Number' }],
    returns: 'Number',
    summary: 'Ring (test command)',
    rule: () => ({ run: (call: RuleCall) => (num(call, 1) < 0 ? call.fail('out_of_domain') : num(call, 1)) }),
    check: (c): Refusal | undefined => {
      seen.push(c);
      const r = c.args[1]?.literal;
      if (r === 13) throw new Error('hook failure');
      if (typeof r === 'number' && r < 0) {
        return { kind: 'bad_argument', message: 'Ring: the radius must not be negative.', hint: 'Use a radius of 0 or more.', param: 1, suggest: ['k = Ring(O, 2)'] };
      }
      return undefined;
    },
  }],
  refuse: (c): Refusal | undefined => {
    seenCalls.push(c);
    if (c.args.length >= 1 && c.args[0]?.type === 'Number') {
      return { kind: 'bad_argument', message: 'Ring needs a point as its centre.', param: 0 };
    }
    return undefined;
  },
};

/** `Sum(first, ...more)`: a literal 0 among the rest arguments is refused. */
const SUM: CommandSpec = {
  name: 'Sum',
  kind: 'object',
  group: 'test',
  forms: [{
    params: [{ name: 'first', type: 'Number' }],
    rest: { name: 'more', type: 'Number' },
    returns: 'Number',
    summary: 'Sum (test command)',
    rule: () => ({ run: (call: RuleCall) => call.values.reduce<number>((a: number, v: unknown) => a + (v as number), 0) }),
    check: (c): Refusal | undefined => {
      seen.push(c);
      const at = c.rest.findIndex((a) => a.literal === 0);
      return at < 0 ? undefined : { kind: 'bad_argument', message: 'Sum: a zero adds nothing.', param: at, inRest: true };
    },
  }],
};

/** A hook that names a kind the error table does not have. */
const WILD: CommandSpec = {
  name: 'Wild',
  kind: 'object',
  group: 'test',
  forms: [{
    params: [{ name: 'n', type: 'Number' }],
    returns: 'Number',
    summary: 'Wild (test command)',
    rule: () => ({ run: (call: RuleCall) => num(call, 0) }),
    check: () => ({ kind: 'no_such_kind_at_all', message: 'never shown' }),
  }],
};

const fig = (lines: readonly string[] = []): Figure => {
  seen.length = 0;
  seenCalls.length = 0;
  const f = new Figure({ commands: [RING, SUM, WILD] });
  for (const l of ['O = (0, 0)', 'r = 3', ...lines]) ok(f.apply(l), l);
  return f;
};

describe('CommandForm.check: a refusal fails the line', () => {
  it('a negative literal radius is the refusal\'s error, on the argument', () => {
    const f = fig();
    const before = snap(f);
    const e = bad(f.apply('k = Ring(O, -2)'), 'bad_argument');
    expect(e.message).toBe('Ring: the radius must not be negative.');
    expect(e.hint).toBe('Use a radius of 0 or more.');
    expect(e.suggest).toEqual(['k = Ring(O, 2)']);
    expect(e.token).toBe('-2');
    expect(e.phase).toBe('typecheck');
    expectWellFormedError(e);
    expectUnchanged(f, before, 'a refused line changes nothing');
  });

  it('the object is not created', () => {
    const f = fig();
    bad(f.apply('k = Ring(O, -2)'), 'bad_argument');
    expect(f.get('k')).toBeUndefined();
  });

  it('a literal the hook accepts passes and the rule runs', () => {
    const f = fig();
    ok(f.apply('k = Ring(O, 2)'));
    expect(f.value('k')).toBe(2);
  });

  it('a value that is not a literal reaches the rule: the hook sees no literal', () => {
    const f = fig(['m = -4']);
    ok(f.apply('k = Ring(O, m)'));
    expect(seen.at(-1)?.args[1]?.literal).toBeUndefined();
    expect(f.get('k')).toBeDefined();
  });

  it('a refusal on a rest argument points at that argument', () => {
    const f = fig();
    const e = bad(f.apply('s = Sum(1, 2, 0, 4)'), 'bad_argument');
    expect(e.token).toBe('0');
    expect(e.col).toBe('s = Sum(1, 2, '.length + 1);
  });

  it('a refusal with no param spans the call', () => {
    const f = new Figure({ commands: [{ ...SUM, forms: [{ ...SUM.forms[0]!, check: () => ({ kind: 'bad_argument', message: 'No.' }) }] }] });
    const e = bad(f.apply('s = Sum(1, 2)'), 'bad_argument');
    expect(e.col).toBe('s = '.length + 1);
  });
});

describe('what the hook is told', () => {
  it('types, literals and texts arrive in parameter order', () => {
    const f = fig();
    ok(f.apply('k = Ring(O, 2.5)'));
    const c = seen.at(-1)!;
    expect(c.command).toBe('Ring');
    expect(c.args.map((a) => a.type)).toEqual(['Point', 'Number']);
    expect(c.args.map((a) => a.text)).toEqual(['O', '2.5']);
    expect(c.args[0]?.literal).toBeUndefined();
    expect(c.args[1]?.literal).toBe(2.5);
    expect(c.args.every((a) => !a.omitted)).toBe(true);
  });

  it.each([
    ['-2', -2],
    ['+2', 2],
    ['pi', Math.PI],
    ['-pi', -Math.PI],
  ])('the literal %s is read as %s', (text, want) => {
    const f = fig();
    f.apply(`k = Ring(O, ${text})`);
    // A refused line has its suggested lines checked too, so the hook may run again after this call.
    const call = seen.find((c) => c.args[1]?.text === text);
    expect(call?.args[1]?.literal).toBe(want);
  });

  it.each(['r', 'r + 1', '2 * 3', 'sqrt(4)'])('%s is not a literal', (text) => {
    const f = fig();
    f.apply(`k = Ring(O, ${text})`);
    expect(seen.at(-1)?.args[1]?.literal).toBeUndefined();
  });

  it('a literal point is read as its coordinates', () => {
    const f = fig();
    ok(f.apply('k = Ring((1, -2), 1)'));
    expect(seen.at(-1)?.args[0]?.literal).toEqual({ x: 1, y: -2 });
  });

  it('rest arguments arrive in `rest`, in order', () => {
    const f = fig();
    ok(f.apply('s = Sum(1, 2, r, 4)'));
    const c = seen.at(-1)!;
    expect(c.args.map((a) => a.literal)).toEqual([1]);
    expect(c.rest.map((a) => a.literal)).toEqual([2, undefined, 4]);
    expect(c.rest.map((a) => a.text)).toEqual(['2', 'r', '4']);
  });
});

describe('CommandSpec.refuse: arguments that fit no form', () => {
  it('a specific refusal replaces no_matching_form', () => {
    const f = fig();
    const before = snap(f);
    const e = bad(f.apply('k = Ring(3, 2)'), 'bad_argument');
    expect(e.message).toBe('Ring needs a point as its centre.');
    expect(e.token).toBe('3');
    expectWellFormedError(e);
    expectUnchanged(f, before);
  });

  it('it is told the types and literals as written', () => {
    const f = fig();
    f.apply('k = Ring(3, O)');
    const c = seenCalls.at(-1)!;
    expect(c.command).toBe('Ring');
    expect(c.args.map((a) => a.type)).toEqual(['Number', 'Point']);
    expect(c.args[0]?.literal).toBe(3);
  });

  it('when it returns nothing the general error stands', () => {
    const f = fig();
    bad(f.apply('k = Ring(O, O)'), 'no_matching_form');
  });

  it('a wrong argument count also reaches it, and falls back to arg_count', () => {
    const f = fig();
    bad(f.apply('k = Ring(O)'), 'arg_count');
    expect(seenCalls.length).toBe(1);
    bad(f.apply('k = Ring(3)'), 'bad_argument');
  });

  it('it is not called when a form fits', () => {
    const f = fig();
    ok(f.apply('k = Ring(O, 2)'));
    expect(seenCalls.length).toBe(0);
  });

  it('a real error inside an argument comes first', () => {
    const f = fig();
    bad(f.apply('k = Ring(nope, 2)'), 'unknown_name');
    expect(seenCalls.length).toBe(0);
  });
});

describe('a hook cannot break the checker', () => {
  it('a hook that throws is an internal error and the figure is unchanged', () => {
    const f = fig();
    const before = snap(f);
    const e = bad(f.apply('k = Ring(O, 13)'), 'internal');
    expectWellFormedError(e);
    expectUnchanged(f, before);
  });

  it('a refusal with a kind the error table does not have is an internal error, not a made-up kind', () => {
    const f = fig();
    const e = bad(f.apply('w = Wild(1)'), 'internal');
    expect(e.hint ?? '').toContain('no_such_kind_at_all');
  });

  it('a command without hooks behaves as before', () => {
    const plain: CommandSpec = { ...RING, name: 'Plain', forms: [{ ...RING.forms[0]!, check: undefined as never }], refuse: undefined as never };
    const f = new Figure({ commands: [plain] });
    ok(f.apply('O = (0, 0)'));
    ok(f.apply('k = Plain(O, -2)'));
    expect(f.get('k')).toBeDefined();
    bad(f.apply('j = Plain(3, 2)'), 'no_matching_form');
  });
});
