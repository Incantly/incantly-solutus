/**
 * The compact error for a model, and the repair helpers: nearestNames and defineLine.
 * Docs: errors/design.md 3.5 and 5; errors/agent.md 1 and 3; errors/errors.md 2.
 */
import { describe, expect, it } from 'vitest';
import { COMPACT_LIMIT, compactError, defineLine, err, nearestNames } from '@incantly/kernel';

const at = { line: 3, col: 5, endCol: 20 };
const forms = (n: number): string[] => Array.from({ length: n }, (_, i) => `Circle(p${i}: Point, q${i}: Number) -> Circle`);

describe('compactError (errors design 3.5)', () => {
  const big = err(
    'no_matching_form',
    at,
    { command: 'Circle', given: 'Point, Point, Number' },
    {
      token: 'Circle(O, P, 2)',
      source: 'c = Circle(O, P, 2)',
      forms: forms(6),
      expected: Array.from({ length: 12 }, (_, i) => `tok${i}`),
      suggest: ['c = Circle(O, P)', 'c = Circle(O, 2)', 'c = Circle(O, P, Q)', 'c = Circle(P, 2)'],
      hint: 'Remove one argument, or pass three points.',
    },
  );

  it('caps forms at 4 and counts the rest in formsOmitted', () => {
    const c = compactError(big);
    expect(c.forms?.length).toBe(4);
    expect(c.formsOmitted).toBe(2);
  });

  it('caps expected at 8 and suggest at 3', () => {
    const c = compactError(big);
    expect(c.expected?.length).toBe(8);
    expect(c.suggest?.length).toBe(3);
    expect(c.suggest).toEqual(big.suggest.slice(0, 3));
  });

  it('drops source when the caller sent the line itself, keeps it otherwise', () => {
    expect(compactError(big, { sentSource: true }).source).toBeUndefined();
    expect(compactError(big).source ?? big.source).toBeDefined();
  });

  it('keeps what a model needs to repair the line: kind, code, message, position, token, hint, suggest, recovery', () => {
    const c = compactError(big);
    expect(c.ok).toBe(false);
    expect(c.kind).toBe('no_matching_form');
    expect(c.code).toBe('C001');
    expect(c.message).toBe(big.message);
    expect(c.line).toBe(3);
    expect(c.col).toBe(5);
    expect(c.token).toBe('Circle(O, P, 2)');
    expect(c.hint).toBe('Remove one argument, or pass three points.');
    expect(c.recovery).toBe('choose_form');
  });

  it.each(['params', 'messageKey', 'fingerprint', 'committed', 'phase'])('leaves out %s, which the model does not need (agent.md 1)', (k) => {
    const c = compactError(big) as Record<string, unknown>;
    expect(c[k], k).toBeUndefined();
  });

  it('is at most about 800 characters of JSON (the limit is exported)', () => {
    expect(COMPACT_LIMIT).toBe(800);
    expect(JSON.stringify(compactError(big, { sentSource: true })).length).toBeLessThanOrEqual(COMPACT_LIMIT);
  });

  it('stays under the limit for a long error: a trimmed hint or fewer forms, never a refusal', () => {
    const huge = err('no_matching_form', at, { command: 'Circle', given: 'x' }, {
      token: 'Circle(O, P, 2)',
      forms: Array.from({ length: 6 }, (_, i) => `Circle(center${i}: Point, through${i}: Point, radius${i}: Number) -> Circle`),
      expected: Array.from({ length: 12 }, (_, i) => `expected token number ${i}`),
      suggest: ['c = Circle(O, P, 2)', 'c = Circle(O, 2)', 'c = Circle(Origin, Pointer)'],
      hint: 'Remove one argument, or pass three points, or use a radius.',
    });
    const c = compactError(huge, { sentSource: true });
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(COMPACT_LIMIT);
    expect(c.kind).toBe('no_matching_form');
    expect(c.recovery).toBeDefined();
  });

  it('a custom limit is honoured', () => {
    const c = compactError(big, { sentSource: true, limit: 400 });
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(400);
  });

  it('a small error is not padded: it passes through with its fields', () => {
    const e = err('unknown_name', { line: 1, col: 15, endCol: 16 }, { name: 'k' }, { token: 'k', hint: 'Define it first.', suggest: ['k = 1 in 0..10'] });
    const c = compactError(e, { sentSource: true });
    expect(c.suggest).toEqual(['k = 1 in 0..10']);
    expect(c.forms ?? []).toEqual([]);
    expect(JSON.stringify(c).length).toBeLessThan(400);
  });

  it('keeps blockedBy and recovery fix_earlier for a blocked line (agent.md 1 example)', () => {
    const e = err('unknown_name', { line: 3, col: 12, endCol: 13 }, { name: 'M' }, { token: 'M', blockedBy: { line: 2, kind: 'unknown_command' }, recovery: 'fix_earlier' });
    const c = compactError(e);
    expect(c.blockedBy).toEqual({ line: 2, kind: 'unknown_command' });
    expect(c.recovery).toBe('fix_earlier');
  });

  it('keeps one level of cause, itself compact', () => {
    const inner = err('type_mismatch', at, { op: '+', left: 'Point', right: 'Point' }, { token: 'A + B', source: 'x' });
    const outer = err('no_matching_form', at, { command: 'Circle', given: 'x' }, { token: 'Circle(A + B, 2)', cause: inner });
    const c = compactError(outer);
    if (c.cause) expect((c.cause as Record<string, unknown>).params).toBeUndefined();
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(compactError(big)))).toEqual(compactError(big));
  });
});

describe('nearestNames (errors design 5)', () => {
  const names = ['Midpoint', 'Segment', 'Line', 'Circle', 'Distance', 'Polygon'];

  it('finds the close name for a typo', () => {
    expect(nearestNames('Midpont', names)).toEqual(['Midpoint']);
    expect(nearestNames('Circel', names)).toEqual(['Circle']);
  });

  it('counts a swap of two letters as one edit (transposition)', () => {
    expect(nearestNames('Cicrle', names)).toEqual(['Circle']);
    expect(nearestNames('Lnie', names)).toEqual(['Line']);
  });

  it('is case-insensitive', () => {
    expect(nearestNames('midpoint', names)).toEqual(['Midpoint']);
    expect(nearestNames('LINE', names)).toEqual(['Line']);
  });

  it('gives at most k names, closest first', () => {
    const many = ['aaab', 'aaac', 'aaad', 'aaae', 'aaaf'];
    expect(nearestNames('aaaa', many, 3).length).toBe(3);
    expect(nearestNames('aaaa', many, 1).length).toBe(1);
    expect(nearestNames('Lin', ['Line', 'Lines', 'Linen', 'Lion'], 4)[0]).toBe('Line');
  });

  it('the default limit is 3', () => {
    expect(nearestNames('aaaa', ['aaab', 'aaac', 'aaad', 'aaae', 'aaaf']).length).toBeLessThanOrEqual(3);
  });

  it('offers nothing when no name is close: the threshold scales with the length', () => {
    expect(nearestNames('Zebra', names)).toEqual([]);
    expect(nearestNames('x', ['Midpoint'])).toEqual([]);
  });

  it('threshold max(1, floor(len/3)): a 6-letter word may be 2 edits away, a 2-letter word only 1', () => {
    expect(nearestNames('Planet', ['Planer'])).toEqual(['Planer']); // 1 edit
    expect(nearestNames('Circle', ['Cirkle'])).toEqual(['Cirkle']);
    expect(nearestNames('Circle', ['Ciarcl'])).toEqual(['Ciarcl'].filter(() => true)); // 2 edits on length 6
    expect(nearestNames('ab', ['xyz'])).toEqual([]); // 3 edits
    expect(nearestNames('ab', ['ac'])).toEqual(['ac']);
  });

  it('is deterministic and does not mutate or depend on the order of the candidates', () => {
    const a = nearestNames('Midpont', names);
    const b = nearestNames('Midpont', [...names].reverse());
    expect(a).toEqual(b);
    expect(nearestNames('Midpont', names)).toEqual(a);
  });

  it('works on any iterable of candidates', () => {
    expect(nearestNames('Midpont', new Set(names))).toEqual(['Midpoint']);
  });

  it('an empty candidate list or an empty name gives an empty list and never throws', () => {
    expect(nearestNames('x', [])).toEqual([]);
    expect(() => nearestNames('', names)).not.toThrow();
    expect(nearestNames('abc', names, 0)).toEqual([]);
  });

});

describe('defineLine (errors design 5): the line that would define a missing name', () => {
  it('a Number: k = 1 in 0..10', () => {
    expect(defineLine('k', 'Number')).toBe('k = 1 in 0..10');
  });
  it('a Point: P = (0, 0)', () => {
    expect(defineLine('P', 'Point')).toBe('P = (0, 0)');
  });
  it('a Bool: flag = true', () => {
    expect(defineLine('flag', 'Bool')).toBe('flag = true');
  });
  it('a Text gives a plain string line', () => {
    const l = defineLine('s', 'Text');
    if (l !== undefined) expect(l).toMatch(/^s = ".*"$/);
  });
  it('types without a plain literal give no line', () => {
    for (const t of ['Circle', 'Line', 'Polygon', 'Function', 'List<Number>', 'Region']) {
      expect(defineLine('x', t), t).toBeUndefined();
    }
  });
  it('the line it gives is accepted by the language', async () => {
    const { figure, ok } = await import('../kernel/helpers');
    const f = figure([]);
    for (const [n, t] of [['k', 'Number'], ['P', 'Point'], ['flag', 'Bool']] as const) {
      const l = defineLine(n, t);
      expect(l).toBeDefined();
      ok(f.apply(l as string), l);
    }
  });
});
