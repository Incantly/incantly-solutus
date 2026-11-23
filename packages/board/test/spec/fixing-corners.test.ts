// @vitest-environment node
/**
 * Shape fixing finds corners first (design 7.3; round 3, BR-32): a closed stroke with 3 to 6 clear corners is a
 * polygon, so a drawn pentagon or hexagon is not turned into a circle, and a drawn circle stays a circle.
 */
import { describe, expect, it } from 'vitest';
import { recogniseStroke } from '../../src/index';
import type { ShapeRecord } from '../../src/index';
import { sample } from './ink-helpers';
import { shapeRig, shapesOf } from './shape-helpers';

type Pt = readonly [number, number];

const xy = (path: readonly Pt[]): number[] => path.flatMap(([x, y]) => [x, y]);

/** The corners of a regular polygon of `n` sides round `cx, cy`, the first one at the top. */
const regular = (n: number, cx: number, cy: number, r: number): Pt[] =>
  Array.from({ length: n }, (_v, i) => [cx + r * Math.sin((i / n) * Math.PI * 2), cy - r * Math.cos((i / n) * Math.PI * 2)] as Pt);

/** A closed walk through the corners with a small steady wobble, ending a little past the first corner. */
function drawn(corners: readonly Pt[], per = 14, amount = 1.6): Pt[] {
  const out: Pt[] = [];
  let k = 0;
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c] as Pt;
    const b = corners[(c + 1) % corners.length] as Pt;
    for (let i = 0; i < per; i++) {
      const t = i / per;
      const w = amount * Math.sin(k++ * 2.3 + 0.4);
      out.push([a[0] + (b[0] - a[0]) * t + w, a[1] + (b[1] - a[1]) * t - w]);
    }
  }
  const first = corners[0] as Pt;
  out.push([first[0] + 1, first[1] + 1]);
  return out;
}

/** A circle drawn a little more than once round, with the same wobble. */
const circle = (r: number, n = 64, amount = 1.6): Pt[] =>
  Array.from({ length: n + 1 }, (_v, i) => {
    const a = (i / n) * Math.PI * 2.04;
    const w = amount * Math.sin(i * 2.3 + 0.4);
    return [300 + (r + w) * Math.cos(a), 300 + (r + w) * Math.sin(a)] as Pt;
  });

describe('corners come before the ellipse (BR-32)', () => {
  it.each([[5], [6]] as const)('a drawn regular polygon of %i sides is a polygon of that many corners', (n) => {
    const r = recogniseStroke(xy(drawn(regular(n, 300, 300, 100))));
    expect(r?.kind).toBe('polygon');
    expect(r?.kind === 'polygon' ? r.points.length / 2 : 0).toBe(n);
  });

  it('a clean regular pentagon and hexagon are polygons too', () => {
    for (const n of [5, 6]) {
      const r = recogniseStroke(xy(drawn(regular(n, 300, 300, 100), 14, 0)));
      expect(r?.kind, `${n} sides`).toBe('polygon');
    }
  });

  it('a pentagon drawn at another size and turn is still a pentagon', () => {
    const turned = regular(5, 0, 0, 160).map(([x, y]) => [x * Math.cos(0.5) - y * Math.sin(0.5) + 80, x * Math.sin(0.5) + y * Math.cos(0.5) + 40] as Pt);
    const r = recogniseStroke(xy(drawn(turned, 16)));
    expect(r?.kind).toBe('polygon');
    expect(r?.kind === 'polygon' ? r.points.length / 2 : 0).toBe(5);
  });

  it.each([60, 100, 150])('a drawn circle of radius %i stays a circle', (r) => {
    const found = recogniseStroke(xy(circle(r)));
    expect(found?.kind).toBe('ellipse');
    expect(found?.kind === 'ellipse' ? Math.abs(found.w - found.h) : 1).toBeLessThan(1e-6);
  });

  it('a drawn circle with few points stays a circle', () => {
    expect(recogniseStroke(xy(circle(100, 24, 0.5)))?.kind).toBe('ellipse');
  });

  it('a drawn oval stays an ellipse', () => {
    const oval = circle(100).map(([x, y]) => [300 + (x - 300) * 1.8, y] as Pt);
    expect(recogniseStroke(xy(oval))?.kind).toBe('ellipse');
  });

  it('a square and a triangle are still a rectangle and a polygon', () => {
    expect(recogniseStroke(xy(drawn([[0, 0], [200, 0], [200, 200], [0, 200]])))?.kind).toBe('rect');
    const tri = recogniseStroke(xy(drawn([[0, 0], [200, 0], [100, 180]])));
    expect(tri?.kind === 'polygon' ? tri.points.length / 2 : 0).toBe(3);
  });

  it('the hold on the pen fixes a drawn pentagon into a closed shape of five corners', () => {
    const rig = shapeRig('pen');
    const path = drawn(regular(5, 300, 300, 100));
    let t = 0;
    path.forEach(([x, y], i) => {
      rig.host.sample(sample({ x, y, phase: i === 0 ? 'down' : 'move', time: t }));
      t += 8;
    });
    rig.host.tick(t + 1000);
    const made = shapesOf(rig).filter((s) => s.kind !== 'ink');
    expect(made).toHaveLength(1);
    const s = made[0] as ShapeRecord;
    expect(s.kind).toBe('line');
    const props = s.props as { points: number[]; closed: boolean };
    expect(props.closed).toBe(true);
    expect(props.points.length / 2).toBe(5);
  });
});
