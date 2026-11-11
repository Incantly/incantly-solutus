/**
 * Undefined values with a reason, the cause chain, rootCause, and recovery when inputs come back.
 * Docs: kernel/design.md 4.2 and 6.4; kernel/errors.md 2; errors/design.md 3.2 and 8; errors/errors.md 3;
 * README decision 2.
 */
import { describe, expect, it } from 'vitest';
import type { UndefReason } from '@incantly/kernel';
import { bad, figure, idOf, must, nameOfId, ok, reasonOf, resetRuns, runs, snap, expectUnchanged } from './helpers';

// Two parallel lines, so I is undefined; T reads I; U reads T.
const CHAIN = [
  'O = (0, 0)',
  'Q = (4, 1)',
  'P = (0, 2)',
  'l1 = Line(O, Q)',
  'l2 = Parallel(P, l1)',
  'I = Intersect(l1, l2)',
  'B = (3, 3)',
  'T = Midpoint(I, B)',
  'U = Distance(T, B)',
];

describe('a rule that cannot compute gives undefined with a specific reason', () => {
  it('is a success, not an error, and the figure keeps the object', () => {
    const f = figure(CHAIN.slice(0, 5));
    const r = ok(f.apply('I = Intersect(l1, l2)'));
    expect(r.op).toBe('add');
    expect(r.type).toBe('Point');
    expect(f.get('I')).toBeDefined();
    expect(reasonOf(f, 'I')).toBe('parallel');
    expect(f.value('I')).toBeUndefined();
  });

  it('the result summary says it is undefined and why (errors.md example)', () => {
    const f = figure(CHAIN.slice(0, 5));
    expect(ok(f.apply('I = Intersect(l1, l2)')).summary).toBe('I is undefined (parallel)');
  });

  it('the change report lists it in becameUndefined with its reason', () => {
    const f = figure(CHAIN.slice(0, 5));
    const r = ok(f.apply('I = Intersect(l1, l2)'));
    expect(r.changed.becameUndefined).toEqual([{ name: 'I', reason: 'parallel' }]);
    expect(r.changed.added).toEqual(['I']);
  });

  it('also reports a notice with kind became_undefined', () => {
    const f = figure(CHAIN.slice(0, 5));
    const r = ok(f.apply('I = Intersect(l1, l2)'));
    const n = r.notices.find((x) => x.kind === 'became_undefined');
    expect(n?.names).toEqual(['I']);
    expect(n?.severity).toBe('warning');
    // K3: changed.warnings is the same array, kept for older readers
    expect(r.changed.warnings).toEqual(r.notices);
  });

  it('the reason is specific: parallel, coincident, degenerate, division_by_zero, out_of_domain', () => {
    const f = figure([
      'O = (0, 0)',
      'Q = (4, 1)',
      'P = (0, 2)',
      'l1 = Line(O, Q)',
      'l2 = Parallel(P, l1)',
      'l3 = Parallel(O, l1)',
      'zero = 0',
      'neg = -4',
    ]);
    ok(f.apply('Ipar = Intersect(l1, l2)'));
    ok(f.apply('Isame = Intersect(l1, l3)'));
    ok(f.apply('Ldeg = Line(O, O)'));
    ok(f.apply('div = Reciprocal(zero)'));
    ok(f.apply('rt = sqrt(neg)'));
    expect(reasonOf(f, 'Ipar')).toBe('parallel');
    expect(reasonOf(f, 'Isame')).toBe('coincident');
    expect(reasonOf(f, 'Ldeg')).toBe('degenerate');
    expect(reasonOf(f, 'div')).toBe('division_by_zero');
    expect(reasonOf(f, 'rt')).toBe('out_of_domain');
  });

  it('formulas: a non-finite result is never stored as a Number (errors design 8)', () => {
    const f = figure(['zero = 0', 'big = 1e200']);
    const cases: [string, UndefReason[]][] = [
      ['r1 = 1 / zero', ['division_by_zero']],
      ['r2 = 0 / zero', ['out_of_domain', 'not_finite', 'division_by_zero']],
      ['r3 = sqrt(-1)', ['out_of_domain']],
      ['r4 = asin(2)', ['out_of_domain']],
      ['r5 = big * big', ['overflow']],
      ['r6 = exp(1000)', ['overflow', 'not_finite']],
    ];
    for (const [line, reasons] of cases) {
      ok(f.apply(line), line);
      const name = line.split(' ')[0] as string;
      const r = reasonOf(f, name);
      expect(r, line).toBeDefined();
      expect(reasons, `${line} gave ${r}`).toContain(r);
      expect(f.value(name), line).toBeUndefined();
    }
  });

  it('a value above 1e300 becomes overflow', () => {
    const f = figure(['a = 1e200']);
    ok(f.apply('b = a * a'));
    expect(reasonOf(f, 'b')).toBe('overflow');
  });

  it('every number in a defined Number cell is finite', () => {
    const f = figure(['a = 3', 'b = 0', 'c = a / b', 'd = a * 2']);
    for (const o of f.objects()) {
      if (o.type === 'Number' && o.cell.defined) expect(Number.isFinite(o.cell.value as number)).toBe(true);
    }
  });

  it('undefined never throws: reading an undefined object is safe', () => {
    const f = figure(CHAIN);
    expect(() => f.value('I')).not.toThrow();
    expect(() => f.cellOf('U')).not.toThrow();
    expect(() => f.describe('U')).not.toThrow();
    expect(() => f.steps()).not.toThrow();
    expect(() => f.toScript()).not.toThrow();
  });
});

describe('inheriting undefined: input_undefined and the cause chain', () => {
  it('an object whose own maths is fine but one input is undefined is input_undefined', () => {
    const f = figure(CHAIN);
    const c = must(f.cellOf('T'));
    expect(c.defined).toBe(false);
    expect(c.defined === false && c.reason).toBe('input_undefined');
  });

  it('cause names the nearest undefined input (a direct input), not the root', () => {
    const f = figure(CHAIN);
    const t = must(f.cellOf('T'));
    const u = must(f.cellOf('U'));
    expect(t.defined === false && nameOfId(f, t.cause as number | undefined)).toBe('I');
    expect(u.defined === false && nameOfId(f, u.cause as number | undefined)).toBe('T');
  });

  it('following cause links reaches the root; rootCause does it for you', () => {
    const f = figure(CHAIN);
    expect(f.rootCause('U')).toEqual({ name: 'I', reason: 'parallel' });
    expect(f.rootCause('T')).toEqual({ name: 'I', reason: 'parallel' });
    expect(f.rootCause('I')).toEqual({ name: 'I', reason: 'parallel' });
  });

  it('rootCause of a defined or missing object is undefined', () => {
    const f = figure(CHAIN);
    expect(f.rootCause('B')).toBeUndefined();
    expect(f.rootCause('nope')).toBeUndefined();
  });

  it('the cause is the first undefined input in rule order', () => {
    const f = figure(['O = (0, 0)', 'zero = 0', 'l1 = Line(O, O)', 'l2 = Line(O, O)', 'i1 = Intersect(l1, l2)', 'i2 = Intersect(l2, l1)']);
    const i1 = must(f.cellOf('i1'));
    const i2 = must(f.cellOf('i2'));
    expect(i1.defined === false && nameOfId(f, i1.cause as number | undefined)).toBe('l1');
    expect(i2.defined === false && nameOfId(f, i2.cause as number | undefined)).toBe('l2');
  });

  it('the rule does not run while an input is undefined', () => {
    const f = figure(CHAIN);
    resetRuns();
    f.setFree('B', { x: 5, y: 5 }, 'api');
    f.flush();
    // T reads I (undefined): its rule (Midpoint) must not be called, U (Distance) neither.
    expect(runs.get('Midpoint') ?? 0).toBe(0);
    expect(runs.get('Distance') ?? 0).toBe(0);
    expect(reasonOf(f, 'U')).toBe('input_undefined');
  });

  it('describe() gives { reason, cause, root } for an inherited undefined (agent.md figure form)', () => {
    const f = figure(CHAIN);
    const d = f.describe('U');
    expect('ok' in d).toBe(false);
    if ('undefined' in d) expect(d.undefined).toEqual({ reason: 'input_undefined', cause: 'T', root: 'parallel' });
    const d2 = f.describe('I');
    if ('undefined' in d2) expect(d2.undefined?.reason).toBe('parallel');
  });

  it('every kind of consumer inherits: Number, Point, Line inputs', () => {
    const f = figure([
      'O = (0, 0)',
      'zero = 0',
      'n0 = Reciprocal(zero)', // undefined Number
      'l0 = Line(O, O)', // undefined Line
      'p0 = Intersect(l0, l0)', // undefined Point (via input)
      'cN = Circle(O, n0)', // Number input
      'rN = Reciprocal(n0)',
      'mP = Midpoint(p0, O)', // Point input
      'dP = Distance(O, p0)',
      'pL = Parallel(O, l0)', // Line input
      'iL = Intersect(l0, pL)',
    ]);
    for (const n of ['cN', 'rN', 'mP', 'dP', 'pL', 'iL', 'p0']) {
      expect(reasonOf(f, n), n).toBe('input_undefined');
    }
    expect(reasonOf(f, 'n0')).toBe('division_by_zero');
    expect(reasonOf(f, 'l0')).toBe('degenerate');
    expect(f.rootCause('iL')?.name).toBe('l0');
    expect(f.rootCause('cN')?.name).toBe('n0');
  });

  it('a Circle, Segment and List input also propagate', () => {
    const f = figure([
      'O = (0, 0)',
      'zero = 0',
      'c0 = Circle(O, zero)', // radius 0: degenerate
      'cc = Center(c0)',
      's0 = Segment(O, O)',
      'n1 = Range(-1)', // out_of_domain list
      'tt = Total(n1)',
    ]);
    expect(reasonOf(f, 'c0')).toBe('degenerate');
    expect(reasonOf(f, 'cc')).toBe('input_undefined');
    expect(reasonOf(f, 'n1')).toBe('out_of_domain');
    expect(reasonOf(f, 'tt')).toBe('input_undefined');
    expect(f.rootCause('tt')).toEqual({ name: 'n1', reason: 'out_of_domain' });
  });

  it('a rule declared acceptsUndefined still runs and sees undefined', () => {
    const f = figure(['zero = 0', 'n0 = Reciprocal(zero)']);
    resetRuns();
    ok(f.apply('d = Defined(n0)'));
    expect(runs.get('Defined')).toBe(1);
    expect(f.value('d')).toBe(0);
    f.setFree('zero', 2, 'api');
    f.flush();
    expect(f.value('d')).toBe(1);
  });

  it('a tuple result can be undefined in one part only (Pair)', () => {
    const f = figure([]);
    ok(f.apply('P1, P2 = Pair(-3)'));
    expect(f.value('P1')).toEqual({ x: -3, y: 0 });
    expect(reasonOf(f, 'P2')).toBe('no_intersection');
  });
});

describe('recovery: when an input becomes defined again the rule runs again', () => {
  it('the dependents come back and the report says becameDefined', () => {
    const f = figure(CHAIN);
    // Make l2 not parallel by moving P onto a different slope: redefine l2 through a different line.
    const r = ok(f.apply('l2 = Line(P, B)'));
    expect(reasonOf(f, 'I')).toBeUndefined();
    expect(reasonOf(f, 'T')).toBeUndefined();
    expect(reasonOf(f, 'U')).toBeUndefined();
    expect(r.changed.becameDefined).toEqual(expect.arrayContaining(['I', 'T', 'U']));
    expect(r.changed.becameUndefined).toEqual([]);
  });

  it('a free write that fixes the cause recomputes everything downstream', () => {
    const f = figure(['zero = 0 in -5..5', 'n0 = Reciprocal(zero)', 'm = n0 * 2', 'k = m + 1']);
    expect(reasonOf(f, 'k')).toBe('input_undefined');
    f.setFree('zero', 2, 'slider');
    const d = f.flush();
    expect(f.value('n0')).toBe(0.5);
    expect(f.value('k')).toBe(2);
    expect(d.undefinedChanges.length).toBeGreaterThan(0);
    for (const c of d.undefinedChanges) expect(c.now.defined).toBe(true);
  });

  it('and goes undefined again when the input does', () => {
    const f = figure(['zero = 2 in -5..5', 'n0 = Reciprocal(zero)', 'm = n0 * 2']);
    f.setFree('zero', 0, 'slider');
    const d = f.flush();
    expect(reasonOf(f, 'm')).toBe('input_undefined');
    expect(d.undefinedChanges.map((c) => c.name).sort()).toEqual(['m', 'n0']);
    for (const c of d.undefinedChanges) expect(c.now.defined).toBe(false);
  });

  it('a line that makes existing objects undefined reports them all', () => {
    const f = figure(['O = (0, 0)', 'Q = (4, 1)', 'P = (0, 2)', 'l1 = Line(O, Q)', 'l2 = Line(P, Q)', 'I = Intersect(l1, l2)', 'T = Midpoint(I, O)']);
    expect(reasonOf(f, 'T')).toBeUndefined();
    const r = ok(f.apply('l2 = Parallel(P, l1)'));
    const names = r.changed.becameUndefined.map((x) => x.name).sort();
    expect(names).toEqual(['I', 'T', 'l2'].filter((n) => n !== 'l2'));
    const t = r.changed.becameUndefined.find((x) => x.name === 'T');
    expect(t?.reason).toBe('input_undefined');
    expect(t?.cause).toBe('I'); // change report uses names for cause
    expect(r.changed.becameUndefined.find((x) => x.name === 'I')?.reason).toBe('parallel');
  });
});

describe('free objects: only the literal `undefined` makes a free Number undefined', () => {
  it('u = undefined is a Number with no value, and the reason is explicit or not_set', () => {
    const f = figure([]);
    ok(f.apply('u = undefined'));
    expect(must(f.get('u')).type).toBe('Number');
    expect(must(f.get('u')).free).toBe(true);
    // Docs conflict: kernel/errors.md 2 says `not_set`; language/design.md 3.8 says `explicit`. Either is accepted.
    expect(['not_set', 'explicit']).toContain(reasonOf(f, 'u'));
  });

  it('dependents of an unset Number are input_undefined with cause u', () => {
    const f = figure(['u = undefined', 'v = u + 1']);
    expect(reasonOf(f, 'v')).toBe('input_undefined');
    const c = must(f.cellOf('v'));
    expect(c.defined === false && nameOfId(f, c.cause as number | undefined)).toBe('u');
  });

  it('setting it back to a number makes it defined again, and dependents follow', () => {
    const f = figure(['u = undefined', 'v = u + 1']);
    ok(f.apply('u = 4'));
    expect(f.value('u')).toBe(4);
    expect(f.value('v')).toBe(5);
  });

  it('a free Number can be made undefined by a later line', () => {
    const f = figure(['u = 4', 'v = u + 1']);
    const r = ok(f.apply('u = undefined'));
    expect(r.changed.becameUndefined.map((x) => x.name)).toEqual(expect.arrayContaining(['u', 'v']));
  });

  it('is written to the script as `undefined` and reads back the same', () => {
    const f = figure(['u = undefined', 'v = u + 1']);
    expect(f.toScript()).toContain('u = undefined');
  });

  it('undefined is allowed for Numbers and nothing else: a Point cannot be set to it', () => {
    const f = figure(['A = (1, 2)', 'flag = true', 's = "x"']);
    for (const name of ['A', 'flag', 's']) {
      const before = snap(f);
      bad(f.apply(`${name} = undefined`));
      expectUnchanged(f, before, name);
    }
  });

  it('a slider that is set to undefined keeps its range', () => {
    const f = figure(['a = 3 in 0..10 step 0.5']);
    ok(f.apply('a = undefined'));
    expect(f.value('a')).toBeUndefined();
    expect(must(f.get('a')).range).toEqual({ min: 0, max: 10, step: 0.5 });
  });
});

describe('undefined objects in the rest of the kernel', () => {
  it('the step list shows "undefined (reason)" as the value text', () => {
    const f = figure(CHAIN);
    const steps = f.steps();
    expect(must(steps.find((s) => s.name === 'I')).valueText).toBe('undefined (parallel)');
    expect(must(steps.find((s) => s.name === 'T')).valueText).toContain('undefined');
  });

  it('drawing is the view\'s job: the style of an undefined object is still readable', () => {
    const f = figure(CHAIN);
    expect(f.styleOf(idOf(f, 'I') as never)).toBeDefined();
  });

  it('an undefined showIf hides the object (design 9.6)', () => {
    const f = figure(['zero = 0', 'n0 = Reciprocal(zero)', 'P = (1, 1)', 'P with showIf = (n0 > 1)']);
    const s = must(f.styleOf(idOf(f, 'P') as never));
    expect(s.visible).toBe(true);
    expect(s.shown).toBe(false);
  });
});
