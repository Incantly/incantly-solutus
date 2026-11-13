/**
 * Lists (design 3 and 4; errors 2, 3 and 5): building, testing and totals, reordering, cutting and joining, sets, lists
 * of points, broadcasting.
 */
import { describe, expect, it } from 'vitest';
import { isRecord } from '@incantly/kernel';
import { bad, fig, nums, ok, undef, val } from './helpers';

const SQ = ['sq = Seq(k^2, k, 1, 5)'];
const PTS = ['pts = Seq((k, k^2), k, -2, 2)'];

describe('4.1 build', () => {
  it('Seq(expr, k, from, to) gives one value per k; a rule that gives points gives points', () => {
    expect(nums(val([], 'sq = Seq(k^2, k, 1, 5)'))).toEqual([1, 4, 9, 16, 25]);
    expect(val([], 'p = Seq((k, 2k), k, 1, 2)')).toEqual([{ x: 1, y: 2 }, { x: 2, y: 4 }]);
  });
  it('Seq(n) is 1..n and Seq(from, to) the whole numbers between', () => {
    expect(nums(val([], 's = Seq(4)'))).toEqual([1, 2, 3, 4]);
    expect(nums(val([], 's = Seq(3, 6)'))).toEqual([3, 4, 5, 6]);
  });
  it('a stepped Seq computes from + i*step, keeps the last element despite rounding, and is empty when the sign is wrong', () => {
    const s = nums(val([], 's = Seq(k, k, 0, 1, 0.1)'));
    expect(s).toHaveLength(11);
    expect(s[10]).toBe(1);
    expect(s[3]).toBe(0 + 3 * 0.1);
    expect(nums(val(['n = 0'], 's = Seq(k, k, 1, n)'))).toEqual([]);
    expect(nums(val([], 's = Seq(k, k, 5, 1, 1)'))).toEqual([]);
  });
  it('a step of 0 is undefined bad_step', () => {
    expect(undef(['h = 0'], 's = Seq(k, k, 0, 1, h)')).toBe('bad_step');
  });
  it('Range, Repeat and Linspace', () => {
    expect(nums(val([], 'r = Range(1, 2, 0.5)'))).toEqual([1, 1.5, 2]);
    expect(nums(val([], 'r = Repeat(7, 3)'))).toEqual([7, 7, 7]);
    expect(nums(val([], 'r = Linspace(0, 1, 5)'))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(nums(val([], 'r = Linspace(2, 9, 1)'))).toEqual([2]);
  });
  it('Map gives its binder the element type of the list', () => {
    expect(nums(val(PTS, 'm = Map(pts, p, p.x + p.y)'))).toEqual([2, 0, 0, 2, 6]);
  });
  it('Zip runs over several lists by index; unequal lengths are size_mismatch', () => {
    expect(nums(val(SQ, 'w = Zip(a + b, a, sq, b, [1, 1, 1, 1, 1])'))).toEqual([2, 5, 10, 17, 26]);
    expect(val(PTS, 'w = Zip(p.x * q, p, pts, q, [1, 2, 3, 4, 5])')).toBeInstanceOf(Float64Array);
    expect(undef([], 'w = Zip(a + b, a, [1, 2], b, [1, 2, 3])')).toBe('size_mismatch');
  });
  it('Fold reduces, Scan keeps every step', () => {
    expect(val(SQ, 'f = Fold(sq, s, v, 0, s + v)')).toBe(55);
    expect(nums(val(SQ, 'f = Scan(sq, s, v, 0, s + v)'))).toEqual([1, 5, 14, 30, 55]);
  });
  it('Iterate and IterateList, including the two-term recurrence', () => {
    expect(val([], 'w = Iterate(2 x, x, 1, 10)')).toBe(1024);
    expect(nums(val([], 'w = IterateList(x + 1, x, 0, 3)'))).toEqual([0, 1, 2, 3]);
    expect(nums(val([], 'fib = IterateList(a + b, a, b, 1, 1, 6)'))).toEqual([1, 1, 2, 3, 5, 8, 13, 21]);
  });
  it('a slider that the rule reads rebuilds the list', () => {
    const f = fig(['n = 3', 'xs = Seq(k, k, 1, n)']);
    expect(f.setFree('n', 5, 'api').ok).toBe(true);
    f.flush();
    expect(nums(f.value('xs'))).toEqual([1, 2, 3, 4, 5]);
  });
  it('a literal count above 1,000,000 is limit at check time', () => {
    bad(fig().apply('s = Seq(k, k, 1, 5000000)'), 'limit');
    bad(fig().apply('s = Seq(2000000)'), 'limit');
  });
});

describe('3.1 indexing', () => {
  it('lists are 1-based, -1 is the last element, and out of range is index_out_of_range', () => {
    expect(val(SQ, 'a = sq[1]')).toBe(1);
    expect(val(SQ, 'a = sq[-1]')).toBe(25);
    expect(undef(SQ, 'a = sq[9]')).toBe('index_out_of_range');
  });
});

describe('4.2 test, count, total', () => {
  it('Count, Contains and IndexOf (0 when absent)', () => {
    expect(val(SQ, 'c = Count(sq)')).toBe(5);
    expect(val(SQ, 'c = Count(sq, k, k > 4)')).toBe(3);
    expect(val(SQ, 'c = Contains(sq, 9)')).toBe(true);
    expect(val(SQ, 'c = IndexOf(16, sq)')).toBe(4);
    expect(val(SQ, 'c = IndexOf(7, sq)')).toBe(0);
    expect(val([], 'c = IndexOf(1, [1, 2, 1], 2)')).toBe(3);
  });
  it('Sum adds numbers with compensation, points by component and texts by joining', () => {
    expect(val([], 's = Sum(Repeat(0.1, 1000000))')).toBe(100000);
    expect(val(PTS, 's = Sum(pts)')).toEqual({ x: 0, y: 10 });
    expect(val([], 's = Sum(["a", "b"])')).toBe('ab');
    expect(val(SQ, 's = Sum(sq, k, 2k)')).toBe(110);
  });
  it('the empty list: Sum 0, Product 1, Count 0; Min, Max, First, Last, ArgMin empty_list', () => {
    const E = ['em = Filter([1, 2], k, k > 5)'];
    expect(val(E, 's = Sum(em)')).toBe(0);
    expect(val(E, 's = Product(em)')).toBe(1);
    expect(val(E, 's = Count(em)')).toBe(0);
    for (const c of ['Min', 'Max', 'First', 'Last', 'ArgMin', 'ArgMax']) expect(undef(E, `s = ${c}(em)`)).toBe('empty_list');
  });
  it('Product, Min, Max, ArgMin, ArgMax, CumSum, Diff, Filter', () => {
    expect(val(SQ, 'v = Product(sq)')).toBe(14400);
    expect(val([], 'v = Min([3, -1, 2])')).toBe(-1);
    expect(val([], 'v = Max(["pear", "apple"])')).toBe('pear');
    expect(val([], 'v = ArgMax([1, 5, 5])')).toBe(2);
    expect(nums(val(SQ, 'v = CumSum(sq)'))).toEqual([1, 5, 14, 30, 55]);
    expect(nums(val(SQ, 'v = Diff(sq)'))).toEqual([3, 5, 7, 9]);
    expect(nums(val(SQ, 'v = Filter(sq, k, k > 4)'))).toEqual([9, 16, 25]);
  });
});

describe('4.3 reorder and dedupe', () => {
  it('Sort is stable, up by default, "down" reverses; points sort by x then y', () => {
    expect(nums(val([], 's = Sort([3, 1, 2])'))).toEqual([1, 2, 3]);
    expect(nums(val([], 's = Sort([3, 1, 2], "down")'))).toEqual([3, 2, 1]);
    expect(val([], 's = Sort([(1, 2), (0, 5), (1, 1)])')).toEqual([{ x: 0, y: 5 }, { x: 1, y: 1 }, { x: 1, y: 2 }]);
    expect(val([], 's = Sort(["b", "a", "c"])')).toEqual(['a', 'b', 'c']);
  });
  it('Sort by a key keeps equal keys in their order', () => {
    expect(val(PTS, 's = Sort(pts, p, -p.y)')).toEqual([{ x: -2, y: 4 }, { x: 2, y: 4 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }]);
  });
  it('an order other than "up" or "down" is bad_option', () => {
    bad(fig().apply('s = Sort([1, 2], "ascending")'), 'bad_option');
  });
  it('Reverse; Shuffle is a pure function of the seed', () => {
    expect(nums(val([], 's = Reverse([1, 2, 3])'))).toEqual([3, 2, 1]);
    const a = nums(val([], 's = Shuffle(Seq(20), 4)'));
    expect(nums(val([], 's = Shuffle(Seq(20), 4)'))).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
  it('Unique keeps the first occurrence in the original order; with tol it merges close numbers', () => {
    expect(nums(val([], 'u = Unique([3, 1, 3, 2, 1])'))).toEqual([3, 1, 2]);
    expect(nums(val([], 'u = Unique([1, 1.001, 2], 0.01)'))).toEqual([1, 2]);
  });
  it('Tally is a record of values (sorted) and counts', () => {
    expect(isRecord(val([], 'tl = Tally([2, 1, 2, 3, 2])'))).toBe(true);
    const f = fig(['tl = Tally([2, 1, 2, 3, 2])', 'v = tl.values', 'c = tl.counts']);
    expect(nums(f.value('v'))).toEqual([1, 2, 3]);
    expect(nums(f.value('c'))).toEqual([1, 3, 1]);
  });
});

describe('4.4 cut, grow and join', () => {
  it('First, Last, Head, Tail, Rest', () => {
    expect(val(SQ, 'v = First(sq)')).toBe(1);
    expect(val(PTS, 'v = Last(pts)')).toEqual({ x: 2, y: 4 });
    expect(nums(val(SQ, 'v = Head(sq, 2)'))).toEqual([1, 4]);
    expect(nums(val(SQ, 'v = Tail(sq, 9)'))).toEqual([1, 4, 9, 16, 25]);
    expect(nums(val(SQ, 'v = Rest(sq)'))).toEqual([4, 9, 16, 25]);
  });
  it('Slice is inclusive, 1-based, negative from the end, and clamps', () => {
    expect(nums(val(SQ, 'v = Slice(sq, 2, -2)'))).toEqual([4, 9, 16]);
    expect(nums(val(SQ, 'v = Slice(sq, 4, 99)'))).toEqual([16, 25]);
  });
  it('Append, Prepend, Insert (pos is where the first new item lands), Remove, RemoveAt', () => {
    expect(nums(val(SQ, 'v = Append(sq, 0)'))).toEqual([1, 4, 9, 16, 25, 0]);
    expect(nums(val(SQ, 'v = Prepend(0, sq)'))).toEqual([0, 1, 4, 9, 16, 25]);
    expect(nums(val([], 'v = Insert(9, [1, 2, 3], 2)'))).toEqual([1, 9, 2, 3]);
    expect(nums(val([], 'v = Insert([8, 9], [1, 2, 3], 4)'))).toEqual([1, 2, 3, 8, 9]);
    expect(nums(val([], 'v = Remove([1, 2, 1, 3], 1)'))).toEqual([2, 3]);
    expect(nums(val([], 'v = RemoveAt([1, 2, 3], -1)'))).toEqual([1, 2]);
    expect(undef([], 'v = RemoveAt([1, 2, 3], 5)')).toBe('index_out_of_range');
  });
  it('Join takes several lists or one list of lists; Flatten', () => {
    expect(nums(val([], 'v = Join([1], [2, 3], [4])'))).toEqual([1, 2, 3, 4]);
    expect(nums(val([], 'v = Join([[1, 2], [3, 4]])'))).toEqual([1, 2, 3, 4]);
    expect(nums(val([], 'v = Flatten([[1, 2], [3, 4]])'))).toEqual([1, 2, 3, 4]);
  });
});

describe('4.5 sets and 4.6 lists of points', () => {
  it('Union, Intersection, Difference keep first-occurrence order', () => {
    expect(nums(val([], 'v = Union([3, 1], [1, 2])'))).toEqual([3, 1, 2]);
    expect(nums(val([], 'v = Intersection([1, 2, 3, 2], [2, 3, 4])'))).toEqual([2, 3]);
    expect(nums(val([], 'v = Difference([1, 2, 3], [2])'))).toEqual([1, 3]);
    expect(nums(val([], 'v = Union([1], [1.0001], 0.01)'))).toEqual([1]);
  });
  it('Points, Xs, Ys, OnAxis', () => {
    expect(val([], 'v = Points([1, 2], [5, 6])')).toEqual([{ x: 1, y: 5 }, { x: 2, y: 6 }]);
    expect(val([], 'v = Points([5, 6])')).toEqual([{ x: 1, y: 5 }, { x: 2, y: 6 }]);
    expect(nums(val(PTS, 'v = Xs(pts)'))).toEqual([-2, -1, 0, 1, 2]);
    expect(nums(val(PTS, 'v = Ys(pts)'))).toEqual([4, 1, 0, 1, 4]);
    expect(val([], 'v = OnAxis([1, 2])')).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  });
});

describe('4.7 broadcasting', () => {
  it('+ - * / ^ between a list of numbers and a number, either side, and between equal-length lists', () => {
    expect(nums(val(SQ, 'v = sq * 2'))).toEqual([2, 8, 18, 32, 50]);
    expect(nums(val(SQ, 'v = 100 - sq'))).toEqual([99, 96, 91, 84, 75]);
    expect(nums(val(SQ, 'v = sq + sq'))).toEqual([2, 8, 18, 32, 50]);
    expect(nums(val(SQ, 'v = -sq'))).toEqual([-1, -4, -9, -16, -25]);
  });
  it('lists of different lengths are size_mismatch', () => {
    expect(undef(SQ, 'v = sq + [1, 2]')).toBe('size_mismatch');
  });
});

describe('3.3 speed', () => {
  it('Seq(sin(k), k, 1, 100000) builds in well under 50 ms', () => {
    const f = fig();
    const t0 = performance.now();
    ok(f.apply('s = Seq(sin(k), k, 1, 100000)'));
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
