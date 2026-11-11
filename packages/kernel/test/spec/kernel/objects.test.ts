/**
 * Object store, free and dependent objects, ids and names.
 * Docs: kernel/design.md sections 4, 14 (suggestName) and 15 (edge cases); kernel/rulings.md K4, K5;
 * core design section 2 and 3 (what a definition makes).
 */
import { describe, expect, it } from 'vitest';
import { Figure, SCRIPT_VERSION } from '@incantly/kernel';
import { BASIC, build, figure, idOf, must, newFigure, ok, bad } from './helpers';

const WORLD = [
  'A = (1, 2)',
  'B = (4, 6)',
  'a = 3',
  'k = 2 in 0..10 step 0.5',
  'flag = true',
  's = "hello"',
  'L = [1, 2, 3]',
  'f(x) = x^2 - 2',
  'M = Midpoint(A, B)',
  'seg = Segment(A, B)',
  'l = Line(A, B)',
  'c = Circle(A, 2)',
  'h = sqrt(a^2 + k^2)',
  'C = (a, 2)',
];

describe('every value kind: type, free or dependent', () => {
  const cases: [string, string, boolean][] = [
    ['A', 'Point', true],
    ['a', 'Number', true],
    ['k', 'Number', true],
    ['flag', 'Bool', true],
    ['s', 'Text', true],
    ['L', 'List', true],
    ['f', 'Function', false],
    ['M', 'Point', false],
    ['seg', 'Segment', false],
    ['l', 'Line', false],
    ['c', 'Circle', false],
    ['h', 'Number', false],
    ['C', 'Point', false],
  ];
  it.each(cases)('%s is a %s (free: %s)', (name, type, free) => {
    const f = figure(WORLD);
    const o = must(f.get(name));
    expect(o.type).toBe(type);
    // A function made by `f(x) = ...` has no object inputs; the docs do not say whether it counts as free.
    if (name !== 'f') expect(o.free).toBe(free);
  });

  it('a result carries the type, name, op and the summary text (K4)', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 2)']);
    const r = ok(f.apply('M = Midpoint(A, B)'));
    expect(r.op).toBe('add');
    expect(r.name).toBe('M');
    expect(r.type).toBe('Point');
    expect(r.summary).toBe('M = (2, 1)');
    expect(r.changed.added).toEqual(['M']);
  });

  it('free values come back as the language\'s raw runtime values, not a tagged union (K5)', () => {
    const f = figure(WORLD);
    expect(f.value('A')).toEqual({ x: 1, y: 2 });
    expect(f.value('a')).toBe(3);
    expect(f.value('flag')).toBe(true);
    expect(f.value('s')).toBe('hello');
    // performance.md 5.7: lists of numbers may live in typed arrays, so compare element by element.
    expect(Array.from(f.value('L') as ArrayLike<number>)).toEqual([1, 2, 3]);
    expect(f.value('M')).toEqual({ x: 2.5, y: 4 });
    expect(f.value('h')).toBeCloseTo(Math.sqrt(9 + 4), 12);
    expect(f.value('c')).toEqual({ cx: 1, cy: 2, r: 2 });
  });

  it('cells are { defined: true, value } for a computed object', () => {
    const f = figure(WORLD);
    const c = must(f.cellOf('M'));
    expect(c.defined).toBe(true);
    expect(c.defined && c.value).toEqual({ x: 2.5, y: 4 });
  });

  it('a Number with an `in a..b step s` clause is a slider with a range', () => {
    const f = figure(['a = 3 in 0..10 step 0.5']);
    expect(must(f.get('a')).range).toEqual({ min: 0, max: 10, step: 0.5 });
    expect(must(f.get('a')).free).toBe(true);
  });

  it('free versus dependent follows the inputs: (1, 2) is free, (a, 2) is not', () => {
    const f = figure(['a = 1', 'P = (1, 2)', 'Q = (a, 2)']);
    expect(must(f.get('P')).free).toBe(true);
    expect(must(f.get('Q')).free).toBe(false);
    expect(must(f.get('Q')).inputs).toEqual([idOf(f, 'a')]);
  });

  it('a dependent object lists its direct inputs, in the order the rule reads them', () => {
    const f = figure(['B = (4, 0)', 'A = (0, 0)', 'M = Midpoint(B, A)']);
    expect(must(f.get('M')).inputs).toEqual([idOf(f, 'B'), idOf(f, 'A')]);
  });
});

describe('ids and names', () => {
  it('ids are issued once, unique and numeric', () => {
    const f = figure(WORLD);
    const ids = f.objects().map((o) => o.id as number);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Number.isInteger(id)).toBe(true);
  });

  it('get() takes a name or an id and returns the same object', () => {
    const f = figure(BASIC);
    const id = idOf(f, 'M');
    expect(f.get(id as never)).toEqual(f.get('M'));
    expect(f.get('nope')).toBeUndefined();
    expect(f.get(999999 as never)).toBeUndefined();
  });

  it('objects() lists every object in order, and `order` is the dense index 0..n-1', () => {
    const f = figure(WORLD);
    const objs = f.objects();
    expect(objs.map((o) => o.name)).toEqual(['A', 'B', 'a', 'k', 'flag', 's', 'L', 'f', 'M', 'seg', 'l', 'c', 'h', 'C']);
    objs.forEach((o, i) => expect(o.order).toBe(i));
    expect(f.count).toBe(objs.length);
    expect(f.names()).toEqual(objs.map((o) => o.name));
  });

  it('the order is always a valid dependency order', () => {
    const f = figure(WORLD);
    for (const o of f.objects()) for (const input of o.inputs) expect(must(f.get(input as never)).order).toBeLessThan(o.order);
  });

  it('names are case-sensitive: a and A are different objects', () => {
    const f = figure(['a = 1', 'A = (1, 1)']);
    expect(must(f.get('a')).type).toBe('Number');
    expect(must(f.get('A')).type).toBe('Point');
    expect(f.count).toBe(2);
  });

  it('two references to the same input are one edge', () => {
    const f = figure(['A = (0, 0)', 'M = Midpoint(A, A)']);
    expect(must(f.get('M')).inputs).toEqual([idOf(f, 'A')]);
    expect(f.dependentsOf('A')).toEqual([idOf(f, 'M')]);
    expect(f.ancestorsOf('M')).toEqual([idOf(f, 'A')]);
  });

  it('each object keeps the line that defined it', () => {
    const f = figure(WORLD);
    expect(must(f.get('M')).definition).toBe('M = Midpoint(A, B)');
    expect(must(f.get('A')).definition).toBe('A = (1, 2)');
  });

  it('a failed line does not use up an id or a name', () => {
    const f = figure(['A = (0, 0)']);
    const before = f.objects().map((o) => o.id);
    bad(f.apply('Q = Midpoint(A, Z)'));
    ok(f.apply('B = (1, 1)'));
    const after = f.objects().map((o) => o.id as number);
    expect(after.slice(0, 1)).toEqual(before);
    expect(f.names()).toEqual(['A', 'B']);
  });
});

describe('a figure with zero objects', () => {
  it('still has the clock and a script that is just the header', () => {
    const f = newFigure();
    expect(f.count).toBe(0);
    expect(f.objects()).toEqual([]);
    expect(f.clock().t).toBe(0);
    expect(f.toScript()).toBe(`@fig ${SCRIPT_VERSION}\n`);
  });

  it('SCRIPT_VERSION is 1 (the first and only version)', () => {
    expect(SCRIPT_VERSION).toBe(1);
  });
});

describe('suggestName (kernel design 14)', () => {
  it('points A, B, ... skipping taken names', () => {
    const f = figure(['A = (0, 0)', 'B = (1, 1)']);
    expect(f.suggestName('Point')).toBe('C');
  });
  // Docs conflict: kernel/design.md 14 says `A1, B1`; language/design.md 3.7 (the owner of naming) says `A_1, B_1`.
  // README decision 16 also reserves the `A_1` style for names. We follow the language doc.
  it('points run on to A_1 after Z (language design 3.7)', () => {
    const f = newFigure();
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') build(f, [`${ch} = (0, 0)`]);
    expect(f.suggestName('Point')).toBe('A_1');
  });
  it('numbers a, b, c ...', () => {
    expect(figure(['a = 1']).suggestName('Number')).toBe('b');
    expect(newFigure().suggestName('Number')).toBe('a');
  });
  it('functions f, g, h', () => {
    expect(newFigure().suggestName('Function')).toBe('f');
    expect(figure(['f(x) = x']).suggestName('Function')).toBe('g');
  });
  // Docs conflict: kernel/design.md 14 says `l1`, `c1`, `flag1`; language/design.md 3.7 says `l`, `c`, `cond1`.
  // Polygon `poly1` and Text `text1` agree. We follow the language doc for the rest.
  it('lines l, circles c, polygons poly1, texts text1, booleans cond1', () => {
    const f = newFigure();
    expect(f.suggestName('Line')).toBe('l');
    expect(f.suggestName('Circle')).toBe('c');
    expect(f.suggestName('Polygon')).toBe('poly1');
    expect(f.suggestName('Text')).toBe('text1');
    expect(f.suggestName('Bool')).toBe('cond1');
  });
  it('skips names that are reserved (commands, built-ins, keywords)', () => {
    const f = newFigure();
    // `e` and `t` are constants of the language; a number name must not be one of them.
    const names = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const n = f.suggestName('Number');
      names.add(n);
      build(f, [`${n} = ${i}`]);
    }
    expect(names.size).toBe(30);
    for (const reserved of ['e', 't', 'x', 'y', 'z', 'pi']) expect(names.has(reserved)).toBe(false);
  });
  it('a suggested name is always accepted by a definition line', () => {
    const f = figure(WORLD);
    for (const type of ['Point', 'Number', 'Function', 'Line', 'Circle', 'Polygon', 'Text', 'Bool'] as const) {
      const n = f.suggestName(type);
      expect(f.get(n)).toBeUndefined();
      const line = type === 'Function' ? `${n}(x) = x` : type === 'Point' ? `${n} = (0, 0)` : `${n} = 1`;
      ok(f.apply(line), line);
    }
  });
});

describe('Figure construction', () => {
  it('can be created with no options', () => {
    const f = new Figure();
    expect(f.count).toBe(0);
    ok(f.apply('a = 1'));
    expect(f.value('a')).toBe(1);
  });
  it('limits default to the table in kernel/errors.md section 6', () => {
    const f = new Figure();
    expect(f.limits.objects).toBe(5000);
    expect(f.limits.lineLength).toBe(2000);
    expect(f.limits.listSize).toBe(100000);
    expect(f.limits.journalEntries).toBe(500);
  });
});
