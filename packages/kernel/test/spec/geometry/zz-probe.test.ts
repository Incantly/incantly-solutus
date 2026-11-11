import { test } from 'vitest';
import { fig } from './helpers';

const show = (lines: string[], names: string[]): void => {
  let f;
  try {
    f = fig(lines);
  } catch (e) {
    console.log('SETUP FAIL', (e as Error).message);
    return;
  }
  for (const n of names) {
    const c = f.cellOf(n);
    console.log(n, '=>', JSON.stringify(c));
  }
};

test('probe', () => {
  // A: function x line outside [-10, 10]
  show(['f(x) = x - 20', 'l = Line(y == 0)', 'I = Intersect(f, l)'], ['I']);
  show(['f(x) = x^2 - 400', 'g(x) = 0*x', 'I = Intersect(f, g)'], ['I']);
  show(['f(x) = x', 'c = Circle((100, 100), 5)', 'I = Intersect(f, c)'], ['I']);
  show(['f(x) = x', 'r = Ray((0, 0), (1, 1))', 'q = Ray((0,0),(1,0))', 'h(x) = 200 - x', 'I = Intersect(h, r)'], ['I']);
  // B: common tangents through the origin
  show(['c1 = Circle((-3, 1), 1)', 'c2 = Circle((3, 1), 1)', 'T = Tangent(c1, c2)'], ['T']);
  show(['c1 = Circle((-3, 1.001), 1)', 'c2 = Circle((3, 1.001), 1)', 'T = Tangent(c1, c2)'], ['T']);
  // C: arc closest
  show(['c = Circle((0, 0), 1)', 'a = Arc(c, 0, pi/2)', 'Q = Closest(a, (-0.99, -0.14))'], ['a', 'Q']);
  // D: PointOn outside [0,1]
  show(['s = Segment((0, 0), (1, 0))', 'P = PointOn(s, 2)', 'l = Line((0,0),(1,0))', 'Q = PointOn(l, 1.2)', 'R = PointOn(l, 0.2)'], ['P', 'Q', 'R']);
  // E: PointIn on non-convex polygon
  show(['p = Polygon((0,0),(10,0),(10,1),(1,1),(1,9),(10,9),(10,10),(0,10))', 'P = PointIn(p, 0, 0)', 'b = InRegion(P, p)', 'P2 = PointIn(p, 0.1, 0.5)', 'b2 = InRegion(P2, p)'], ['P', 'b', 'P2', 'b2']);
});
