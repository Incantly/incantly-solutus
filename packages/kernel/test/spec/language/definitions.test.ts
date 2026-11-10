import { describe, expect, it } from 'vitest';
import { accepts, binaryOp, fnOf, listOf, parseTy, T, tyEq, tyStr, typeSet } from '@incantly/kernel';
import { check, checked, expectFixPasses, failure, newFig } from './helpers';

describe('language/design.md 3.8 what a definition makes', () => {
  it.each([
    ['n1 = 1 + 2', 'Number', true],
    ['n1 = 2 * pi', 'Number', true],
    ['n1 = a + 1', 'Number', false],
    ['n1 = t * 2', 'Number', false],
    ['n1 = f(2)', 'Number', false],
    ['n1 = A.x', 'Number', false],
    ['n1 = L[2]', 'Number', false],
    ['n1 = if(a > 1, 2, 3)', 'Number', false],
    ['n1 = sqrt(a^2 + b^2)', 'Number', false],
  ])('%s makes a %s (free: %s)', (src, type, free) => {
    const c = checked(src);
    expect(c.type?.k).toBe(type);
    expect(c.op).toBe('add');
    expect(c.free).toBe(free);
  });

  it('3.8 a Number using t is a dependent Number and usesT is set', () => {
    const c = checked('n1 = t * 2');
    expect(c.usesT).toBe(true);
    expect(c.free).toBe(false);
    expect(checked('n1 = 2').usesT).toBe(false);
  });

  it('3.8 bt and beat are readable clock values (README 18)', () => {
    expect(checked('n1 = bt + beat').type?.k).toBe('Number');
  });

  it.each([
    ['b1 = true'],
    ['b1 = false'],
    ['b1 = 1 < 2'],
    ['b1 = a > 2'],
    ['b1 = not true'],
    ['b1 = true and false'],
    ['b1 = a == 3'],
    ['b1 = flag or false'],
    ['b1 = 0 < a < 5'],
  ])('3.8 %s makes a Bool', (src) => {
    expect(checked(src).type?.k).toBe('Bool');
  });

  it('3.8 a String makes Text; a point pair makes a Point', () => {
    expect(checked('tx = "hi"').type?.k).toBe('Text');
    const pt = checked('Q = (1, 2)');
    expect(pt.type?.k).toBe('Point');
    expect(pt.free).toBe(true);
  });

  it('core 3 free versus dependent: (a, 2) depends on a', () => {
    const c = checked('Q = (a, 2)');
    expect(c.type?.k).toBe('Point');
    expect(c.free).toBe(false);
    expect(c.reads.length).toBe(1);
  });

  it('3.8 (r; θ) is a Point', () => {
    expect(checked('Q = (2; pi / 2)').type?.k).toBe('Point');
    expect(checked('Q = (a; 30°)').type?.k).toBe('Point');
  });

  it('3.8 a list literal or range is a List of one element type', () => {
    const l1 = checked('L1 = [1, 2, 3]');
    expect(l1.type?.k).toBe('List');
    expect(l1.type?.of?.k).toBe('Number');
    const l2 = checked('L1 = [1..5]');
    expect(l2.type?.of?.k).toBe('Number');
    const l3 = checked('L1 = [(0, 0), (1, 1)]');
    expect(l3.type?.of?.k).toBe('Point');
    expect(checked('L1 = [0..1 step 0.1]').type?.of?.k).toBe('Number');
    expect(checked('L1 = ["a", "b"]').type?.of?.k).toBe('Text');
    expect(checked('L1 = [true, false]').type?.of?.k).toBe('Bool');
  });

  it('3.8 a command call has the return type of the form that matched', () => {
    expect(checked('c9 = Circle(A, 2)').type?.k).toBe('Circle');
    expect(checked('c9 = Circle(A, B)').type?.k).toBe('Circle');
    expect(checked('c9 = Circle(A, B, C)').type?.k).toBe('Circle');
    expect(checked('M9 = Midpoint(A, B)').type?.k).toBe('Point');
    expect(checked('M9 = Midpoint(s)').type?.k).toBe('Point');
    expect(checked('d9 = Distance(A, B)').type?.k).toBe('Number');
    expect(checked('S9 = Seq(k^2, k, 1, 5)').type?.k).toBe('List');
    expect(checked('S9 = Seq(k^2, k, 1, 5)').type?.of?.k).toBe('Number');
  });

  it('3.8 a command line is dependent, not free', () => {
    const c = checked('M9 = Midpoint(A, B)');
    expect(c.free).toBe(false);
    expect(c.reads.length).toBe(2);
  });

  it('3.4 defmany: A, B = Intersect(c, d) makes two objects with the tuple types', () => {
    const c = checked('X1, X2 = Intersect(c1, c2)');
    expect(c.kind).toBe('defmany');
    expect(c.names).toEqual(['X1', 'X2']);
    expect(c.types?.map((t) => t.k)).toEqual(['Point', 'Point']);
  });

  it('3.4 defmany: the number of names must equal the number of results', () => {
    expect(check('X1, X2, X3 = Intersect(c1, c2)').ok).toBe(false);
    expect(check('X1, X2 = Midpoint(A, B)').ok).toBe(false);
  });

  it('3.8 f(x) = … is a Function of one parameter returning a Number', () => {
    const c = checked('h9(x) = x^2 - 2');
    expect(c.type?.k).toBe('Function');
    expect(c.type?.ret).toBe('Number');
    expect(c.type?.arity).toBe(1);
    expect(c.kind).toBe('function');
    expect(c.params?.map((q) => q.name)).toEqual(['x']);
  });

  it('3.10 a function of two variables has arity 2', () => {
    const c = checked('h9(x, y) = x * y');
    expect(c.type?.arity).toBe(2);
    expect(c.type?.ret).toBe('Number');
  });

  it('3.10 f(x) = (cos(x), sin(x)) is a Function<Point> of one parameter', () => {
    const c = checked('h9(x) = (cos(x), sin(x))');
    expect(c.type?.k).toBe('Function');
    expect(c.type?.ret).toBe('Point');
    expect(c.type?.arity).toBe(1);
  });

  it('3.10 a function may use up to four parameters', () => {
    expect(checked('h9(a1, b1, c1, d1) = a1 + b1 + c1 + d1').type?.arity).toBe(4);
  });

  it('3.8 a bare function name (h = f) is a Function', () => {
    const c = checked('h9 = f');
    expect(c.type?.k).toBe('Function');
    expect(c.type?.ret).toBe('Number');
  });

  it('3.8 function arithmetic: f + g, 2 f, f(g(x)) with f, g functions', () => {
    for (const src of ['h9 = f + g', 'h9 = 2 f', 'h9 = f + 1', 'h9 = 1 + f', 'h9 = 2 f + 1', 'h9 = f * g', 'h9 = f / g', 'h9 = f - g', 'h9 = f ^ 2', 'h9 = f / 2', 'h9 = f * 2']) {
      const c = checked(src);
      expect(c.type?.k, src).toBe('Function');
      expect(c.type?.ret, src).toBe('Number');
    }
  });

  it('3.8 f(g(x)) outside a parameter list is a free variable; inside a function definition it is a Function', () => {
    expect(failure('h9 = f(g(x))').kind).toBe('free_variable');
    const c = checked('h9(x) = f(g(x))');
    expect(c.type?.k).toBe('Function');
  });

  it('3.10 rule 4: calling a Function object with a List<Number> is type_mismatch', () => {
    expect(failure('n1 = f(L)').kind).toBe('type_mismatch');
  });

  it('3.10 rule 4: a call has Function arity arguments; a wrong count is no_matching_form with the single form', () => {
    const e = failure('n1 = f(1, 2)');
    // errors.md 5 calls this kind `bad_arity` ("same as no_matching_form with the single form"); the shared
    // ErrorKind list has `arg_count` instead.
    expect(['no_matching_form', 'arg_count', 'bad_arity']).toContain(e.kind);
    expect(e.forms.length).toBe(1);
    expect(e.forms[0]).toContain('f(');
  });

  it('3.10 rule 4: a call result follows the codomain', () => {
    const fig = newFig();
    fig.apply('pf(x) = (x, x^2)');
    expect(checked('Q9 = pf(2)', fig).type?.k).toBe('Point');
    expect(checked('n1 = f(2)', fig).type?.k).toBe('Number');
  });

  it('3.8 a free variable anywhere else is free_variable with a function fix', () => {
    const fig = newFig();
    const e = failure('v9 = x + 1', fig);
    expect(e.kind).toBe('free_variable');
    expect(e.line).toBe(1);
    expect(e.col).toBe(6);
    expect(e.endCol).toBe(7);
    expect(e.token).toBe('x');
    expect(e.fix).toBe('v9(x) = x + 1');
    expectFixPasses(e, fig);
  });

  it('agent.md 5.3 v = f(x) is free_variable at the x, fix v(x) = f(x)', () => {
    const e = failure('v9 = f(x)');
    expect(e.kind).toBe('free_variable');
    expect(e.token).toBe('x');
    expect(e.col).toBe(8);
    expect(e.fix).toBe('v9(x) = f(x)');
  });

  it('errors.md 4: with two free variables there is no single function fix', () => {
    const e = failure('v9 = x + y');
    expect(e.kind).toBe('free_variable');
    expect(e.fix).toBeUndefined();
  });

  it('3.8 a free x in an unrelated place of a command is free_variable', () => {
    expect(failure('c9 = Circle(A, x)').kind).toBe('free_variable');
  });
});

describe('language/design.md 3.9 equations versus assignments', () => {
  it.each([
    ['l9 = y == 2x + 1', 'Line', 'line'],
    ['l9 = 3x + 4y == 12', 'Line', 'line'],
    ['l9 = x == 3', 'Line', 'line'],
    ['l9 = y == 2', 'Line', 'line'],
    ['l9 = x + y == 0', 'Line', 'line'],
    ['l9 = 2 * y == x', 'Line', 'line'],
    ['l9 = y == a*x + b', 'Line', 'line'],
  ])('%s is a %s', (src, type, shape) => {
    const c = checked(src);
    expect(c.type?.k).toBe(type);
    expect(c.shape).toBe(shape);
  });

  it.each([
    ['c9 = x^2 + y^2 == 4'],
    ['c9 = (x - 1)^2 + (y - 2)^2 == 9'],
    ['c9 = (x - a)^2 + (y + b)^2 == 16'],
  ])('%s is a Circle', (src) => {
    const c = checked(src);
    expect(c.type?.k).toBe('Circle');
    expect(c.shape).toBe('circle');
  });

  it('3.9 a degree-2 equation that is not a circle is a Curve tagged conic', () => {
    for (const src of ['k9 = x^2 / 4 + y^2 == 1', 'k9 = x^2 - y^2 == 1', 'k9 = x*y == 1', 'k9 = x^2 + y^2 == 0']) {
      const c = checked(src);
      expect(c.type?.k, src).toBe('Curve');
      expect(c.shape, src).toBe('conic');
    }
  });

  it('3.9 anything else with == is an implicit Curve', () => {
    for (const src of ['k9 = x^3 + y^3 == 1', 'k9 = sin(x) == y', 'k9 = x^2 * y == 1']) {
      const c = checked(src);
      expect(c.type?.k, src).toBe('Curve');
    }
  });

  it('3.9 y == x^2 is an implicit Curve, not a Function', () => {
    const c = checked('k9 = y == x^2');
    expect(c.type?.k).toBe('Curve');
  });

  it.each([
    ['r9 = y < x'],
    ['r9 = y <= 2x + 1'],
    ['r9 = x > 2'],
    ['r9 = x^2 + y^2 < 4'],
    ['r9 = y >= x^2'],
  ])('%s is a Region', (src) => {
    const c = checked(src);
    expect(c.type?.k).toBe('Region');
    expect(c.shape).toBe('region');
  });

  it('3.9 a relation with no free variables is a Bool', () => {
    expect(checked('b9 = 1 == 1').type?.k).toBe('Bool');
    expect(checked('b9 = a == 3').type?.k).toBe('Bool');
    expect(checked('b9 = a < b').type?.k).toBe('Bool');
  });

  it('3.9 = never builds an equation (a relation between x and y written with = is refused)', () => {
    const e = failure('l9 = y = 2x + 1');
    expect(['assign_in_expr', 'syntax']).toContain(e.kind);
    expect(e.expected).toContain('==');
  });

  it('3.9 rule 5: the type Relation is a command argument only', () => {
    expect(checked('l9 = Line(3x + 4y == 12)').type?.k).toBe('Line');
    expect(checked('l9 = Line(y == 2)').type?.k).toBe('Line');
    // A non-relation where a Relation is needed.
    expect(failure('l9 = Line(3x + 4y)').kind).not.toBe('internal');
    expect(check('l9 = Line(a)').ok).toBe(false);
  });

  it('3.9 rule 6: a relation with a free variable reads no free variable names as objects', () => {
    const c = checked('l9 = y == 2x + a');
    expect(c.reads.length).toBe(1);
    expect(c.free).toBe(false);
  });
});

describe('language/design.md 3.10 operator table', () => {
  it.each([
    ['n1 = a + b', 'Number'],
    ['n1 = a - b', 'Number'],
    ['n1 = a * b', 'Number'],
    ['n1 = a / b', 'Number'],
    ['n1 = a ^ b', 'Number'],
    ['v9 = 2 * u', 'Vector'],
    ['v9 = u * 2', 'Vector'],
    ['v9 = u / 2', 'Vector'],
    ['v9 = u + w', 'Vector'],
    ['v9 = u - w', 'Vector'],
    ['v9 = -u', 'Vector'],
    ['P9 = A + u', 'Point'],
    ['P9 = A - u', 'Point'],
    ['v9 = B - A', 'Vector'], // README 6: Point - Point is a Vector
    ['tx = "a" + "b"', 'Text'],
    ['b9 = true and false', 'Bool'],
    ['b9 = true or false', 'Bool'],
    ['b9 = true xor false', 'Bool'],
    ['b9 = A == B', 'Bool'],
    ['b9 = u == w', 'Bool'],
    ['b9 = "a" == "b"', 'Bool'],
    ['b9 = true == false', 'Bool'],
    ['b9 = a < b', 'Bool'],
    ['b9 = a <= b', 'Bool'],
    ['b9 = a > b', 'Bool'],
    ['b9 = a >= b', 'Bool'],
    ['b9 = a != b', 'Bool'],
  ])('%s has type %s', (src, type) => {
    expect(checked(src).type?.k).toBe(type);
  });

  it('3.10 List<Number> with a Number is element-wise (list on the left)', () => {
    for (const op of ['+', '-', '*', '/']) {
      const c = checked(`L9 = L ${op} 2`);
      expect(c.type?.k).toBe('List');
      expect(c.type?.of?.k).toBe('Number');
    }
  });

  it('3.10 function arithmetic types', () => {
    expect(checked('h9 = f + g').type?.k).toBe('Function');
    expect(checked('h9 = 2 + f').type?.k).toBe('Function');
    expect(checked('h9 = 2 - f').type?.k).toBe('Function');
    expect(checked('h9 = 2 * f').type?.k).toBe('Function');
    expect(checked('h9 = f ^ 3').type?.k).toBe('Function');
  });

  it.each([
    ['w9 = 2 * A', 'Number', 'Point'],
    ['w9 = A * 2', 'Point', 'Number'],
    ['w9 = A + B', 'Point', 'Point'],
    ['w9 = u * w', 'Vector', 'Vector'],
    ['w9 = A * B', 'Point', 'Point'],
    ['w9 = "a" + 1', 'Text', 'Number'],
    ['w9 = 1 + "a"', 'Number', 'Text'],
    ['w9 = true + 1', 'Bool', 'Number'],
    ['w9 = a and b', 'Number', 'Number'],
    ['w9 = a ^ u', 'Number', 'Vector'],
    ['w9 = u / w', 'Vector', 'Vector'],
    ['w9 = 2 / f', 'Number', 'Function<Number>'],
    ['w9 = A < B', 'Point', 'Point'],
    ['w9 = "a" < "b"', 'Text', 'Text'],
    ['w9 = u ^ 2', 'Vector', 'Number'],
    ['w9 = 2 - s', 'Number', 'Segment'],
  ])('3.10 %s is type_mismatch (%s, %s)', (src, left, right) => {
    const e = failure(src);
    expect(e.kind).toBe('type_mismatch');
    expect(e.left).toBe(left);
    expect(e.right).toBe(right);
    expect(e.message).toContain(left);
    expect(e.message).toContain(right);
  });

  it('errors.md 5 Number * Point: span, hint and quick fixes', () => {
    const fig = newFig();
    const e = failure('w9 = 2 * A', fig);
    expect(e.kind).toBe('type_mismatch');
    expect(e.line).toBe(1);
    expect(e.col).toBe(6);
    expect(e.endCol).toBe(11);
    expect(e.token).toBe('2 * A');
    expect(e.hint).toContain('Vector');
    expect(e.hint).toContain('Dilate');
    const lines = (e.quickFixes ?? []).flatMap((q) => q.lines);
    expect(lines).toContain('w9 = 2 * Vector(A)');
  });

  it('3.10 Point + Point and Vector * Vector hint at Vector(A) and dot / cross', () => {
    expect(failure('w9 = A + B').hint).toContain('Vector');
    const h = failure('w9 = u * w').hint ?? '';
    expect(h).toMatch(/dot/);
    expect(h).toMatch(/cross/);
  });

  it('3.10 unary minus on a non-numeric type is type_mismatch', () => {
    expect(failure('w9 = -"a"').kind).toBe('type_mismatch');
    expect(failure('w9 = -A').kind).toBe('type_mismatch');
    expect(failure('w9 = not 1').kind).toBe('type_mismatch');
  });

  it('3.10 binaryOp is exact on both types, no coercion', () => {
    expect(binaryOp('+', T.Number, T.Number)?.result.k).toBe('Number');
    expect(binaryOp('-', T.Point, T.Point)?.result.k).toBe('Vector');
    expect(binaryOp('+', T.Point, T.Vector)?.result.k).toBe('Point');
    expect(binaryOp('*', T.Number, T.Vector)?.result.k).toBe('Vector');
    expect(binaryOp('+', T.Text, T.Text)?.result.k).toBe('Text');
    expect(binaryOp('==', T.Point, T.Point)?.result.k).toBe('Bool');
    expect(binaryOp('<', T.Number, T.Number)?.result.k).toBe('Bool');
    expect(binaryOp('*', T.Point, T.Number)).toBeUndefined();
    expect(binaryOp('+', T.Point, T.Point)).toBeUndefined();
    expect(binaryOp('*', T.Vector, T.Vector)).toBeUndefined();
    expect(binaryOp('+', T.Number, T.Text)).toBeUndefined();
    expect(binaryOp('<', T.Text, T.Text)).toBeUndefined();
    expect(binaryOp('and', T.Number, T.Number)).toBeUndefined();
    expect(binaryOp('and', T.Bool, T.Bool)?.result.k).toBe('Bool');
    expect(binaryOp('+', listOf(T.Number), T.Number)?.result.k).toBe('List');
    expect(binaryOp('+', fnOf('Number', 1), T.Number)?.result.k).toBe('Function');
  });
});

describe('language/design.md 3.10 fields', () => {
  it.each([
    ['n1 = A.x', 'Number'],
    ['n1 = A.y', 'Number'],
    ['n1 = u.x', 'Number'],
    ['n1 = u.length', 'Number'],
    ['n1 = s.length', 'Number'],
    ['P9 = s.start', 'Point'],
    ['P9 = s.end', 'Point'],
    ['P9 = c1.center', 'Point'],
    ['n1 = c1.radius', 'Number'],
    ['n1 = pg.area', 'Number'],
    ['n1 = pg.perimeter', 'Number'],
    ['n1 = m.length', 'Number'],
  ])('%s has type %s', (src, type) => {
    expect(checked(src).type?.k).toBe(type);
  });

  it('3.10 Polygon .vertices is a List<Point>', () => {
    const c = checked('PL9 = pg.vertices');
    expect(c.type?.k).toBe('List');
    expect(c.type?.of?.k).toBe('Point');
  });

  it('3.10 Line .point and .direction', () => {
    expect(checked('P9 = ln.point').type?.k).toBe('Point');
    expect(['Vector', 'Point']).toContain(checked('v9 = ln.direction').type?.k);
  });

  it('3.10 rule 9: an unknown field is type_mismatch listing the available fields', () => {
    const e = failure('n1 = u.foo');
    expect(e.kind).toBe('type_mismatch');
    const all = JSON.stringify(e);
    expect(all).toContain('length');
    const e2 = failure('n1 = A.z');
    expect(e2.kind).toBe('type_mismatch');
    expect(JSON.stringify(e2)).toMatch(/\bx\b/);
  });

  it('3.10 rule 9: a field on a Number is type_mismatch', () => {
    expect(failure('n1 = a.x').kind).toBe('type_mismatch');
    expect(failure('n1 = s.radius').kind).toBe('type_mismatch');
    expect(failure('n1 = A.length').kind).toBe('type_mismatch');
  });

  it('3.10 a field value is read from the object', () => {
    const fig = newFig();
    fig.apply('n1 = u.length');
    expect(fig.valueOf('n1')).toBeCloseTo(Math.sqrt(5), 12);
    fig.apply('n2 = s.length');
    expect(fig.valueOf('n2')).toBeCloseTo(5, 12);
    fig.apply('n3 = c1.radius');
    expect(fig.valueOf('n3')).toBe(2);
    fig.apply('n4 = pg.area');
    expect(fig.valueOf('n4')).toBeCloseTo(0.5, 12);
    fig.apply('n5 = m.length');
    expect(fig.valueOf('n5')).toBe(2);
  });
});

describe('language/design.md 3.10 unit tag on Number', () => {
  it('Angle returns a Number tagged as an angle', () => {
    const c = checked('al = Angle(A, B, C)');
    expect(c.type?.k).toBe('Number');
    expect(c.unit).toBe('angle');
  });

  it('the tag is kept for angle + angle, angle * number, -angle, angle / number', () => {
    expect(checked('al = ang + ang').unit).toBe('angle');
    expect(checked('al = ang * 2').unit).toBe('angle');
    expect(checked('al = -ang').unit).toBe('angle');
    expect(checked('al = ang / 2').unit).toBe('angle');
  });

  it('every other result is untagged', () => {
    expect(checked('al = ang + 1').unit).toBeUndefined();
    expect(checked('al = ang * ang').unit).toBeUndefined();
    expect(checked('al = a + b').unit).toBeUndefined();
    expect(checked('al = sin(ang)').unit).toBeUndefined();
  });

  it('a plain number definition has no unit', () => {
    expect(checked('al = 3').unit).toBeUndefined();
  });
});

describe('language/design.md 3.10 type helpers', () => {
  it('tyStr writes types as in messages and forms', () => {
    expect(tyStr(T.Number)).toBe('Number');
    expect(tyStr(listOf(T.Point))).toBe('List<Point>');
    expect(tyStr(fnOf('Number', 1))).toBe('Function<Number>');
    expect(tyStr(listOf(listOf(T.Number)))).toBe('List<List<Number>>');
  });

  it('parseTy reads them back', () => {
    expect(parseTy('Number')?.k).toBe('Number');
    const l = parseTy('List<Point>');
    expect(l?.k).toBe('List');
    expect(l?.of?.k).toBe('Point');
    expect(parseTy('Function<Point>')?.ret).toBe('Point');
  });

  it('tyEq compares element types and function shapes', () => {
    expect(tyEq(listOf(T.Number), listOf(T.Number))).toBe(true);
    expect(tyEq(listOf(T.Number), listOf(T.Point))).toBe(false);
    expect(tyEq(fnOf('Number', 1), fnOf('Number', 2))).toBe(false);
    expect(tyEq(fnOf('Number', 1), fnOf('Point', 1))).toBe(false);
    expect(tyEq(T.Line, T.Line)).toBe(true);
    expect(tyEq(T.Line, T.Circle)).toBe(false);
  });

  it('3.11 aliases: Shape, Path, Curvelike, Scalar', () => {
    const shape = typeSet('Shape');
    for (const t of [T.Point, T.Segment, T.Ray, T.Line, T.Circle, T.Arc, T.Polygon, T.Curve, T.Vector]) expect(accepts(shape, t)).toBe(true);
    expect(accepts(shape, T.Number)).toBe(false);
    expect(accepts(shape, T.Text)).toBe(false);
    const path = typeSet('Path');
    for (const t of [T.Segment, T.Ray, T.Line, T.Circle, T.Arc, T.Curve, fnOf('Number', 1)]) expect(accepts(path, t)).toBe(true);
    expect(accepts(path, T.Point)).toBe(false);
    expect(accepts(path, T.Polygon)).toBe(false);
    const cl = typeSet('Curvelike');
    expect(accepts(cl, fnOf('Point', 1))).toBe(true);
    expect(accepts(cl, T.Curve)).toBe(true);
    expect(accepts(cl, fnOf('Number', 1))).toBe(false);
    const sc = typeSet('Scalar');
    expect(accepts(sc, T.Number)).toBe(true);
    expect(accepts(sc, T.Point)).toBe(false);
  });

  it('3.11 unions and lists: Number|Point, List<Point>, Function<Number>, Any', () => {
    expect(accepts(typeSet('Number|Point'), T.Number)).toBe(true);
    expect(accepts(typeSet('Number|Point'), T.Point)).toBe(true);
    expect(accepts(typeSet('Number|Point'), T.Line)).toBe(false);
    expect(accepts(typeSet('List<Point>'), listOf(T.Point))).toBe(true);
    expect(accepts(typeSet('List<Point>'), listOf(T.Number))).toBe(false);
    expect(accepts(typeSet('Function<Number>'), fnOf('Number', 1))).toBe(true);
    expect(accepts(typeSet('Function<Number>'), fnOf('Point', 1))).toBe(false);
    expect(accepts(typeSet('Any'), T.Segment)).toBe(true);
    expect(accepts(typeSet('Any'), listOf(T.Number))).toBe(true);
    expect(accepts(typeSet('Relation'), T.Relation)).toBe(true);
    expect(accepts(typeSet('Number'), T.Relation)).toBe(false);
  });
});
