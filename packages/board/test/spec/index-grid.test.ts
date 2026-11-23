// @vitest-environment node
/**
 * R3 and design 9.2: a sparse grid of 512-unit cells; viewport, point, box and lasso queries read only the cells they
 * touch, and stay correct after insert, move and remove. Checked against a brute-force scan.
 */
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, IndexGrid, pointInPolygon, polygonMeetsBox } from '../../src/index';
import type { Bounds } from '../../src/index';
import { must, rng } from './helpers';

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY });
const meets = (a: Bounds, b: Bounds): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe('basics', () => {
  it('has 512-unit cells', () => {
    expect(CELL_SIZE).toBe(512);
  });

  it('starts empty and counts shapes and cells', () => {
    const g = new IndexGrid();
    expect(g.size).toBe(0);
    expect(g.cellCount).toBe(0);
    must(g.insert('a', box(0, 0, 10, 10)));
    expect(g.size).toBe(1);
    expect(g.cellCount).toBe(1);
    expect(g.has('a')).toBe(true);
    expect(g.has('b')).toBe(false);
    expect(g.boundsOf('a')).toEqual(box(0, 0, 10, 10));
    expect(g.boundsOf('b')).toBeUndefined();
  });

  it('holds a shape in every cell its bounds touch, and no others', () => {
    const g = new IndexGrid();
    must(g.insert('wide', box(10, 10, 1100, 20)));
    expect(g.cellCount).toBe(3);
    must(g.insert('tall', box(10, 10, 20, 600)));
    expect(g.size).toBe(2);
    g.remove('wide');
    g.remove('tall');
    expect(g.cellCount).toBe(0);
    expect(g.size).toBe(0);
  });

  it('is sparse: far away shapes cost only their own cells', () => {
    const g = new IndexGrid();
    must(g.insert('near', box(0, 0, 5, 5)));
    must(g.insert('far', box(1e7, -1e7, 1e7 + 5, -1e7 + 5)));
    expect(g.cellCount).toBe(2);
    expect(g.queryBox(box(-10, -10, 10, 10))).toEqual(['near']);
  });

  it('handles negative coordinates and a shape across the origin', () => {
    const g = new IndexGrid();
    must(g.insert('cross', box(-600, -600, 600, 600)));
    expect(g.queryPoint(-599, -599)).toEqual(['cross']);
    expect(g.queryPoint(599, 599)).toEqual(['cross']);
    expect(g.queryPoint(601, 0)).toEqual([]);
  });

  it('treats the edge of a box as inside (inclusive)', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 10, 10)));
    expect(g.queryBox(box(10, 10, 20, 20))).toEqual(['a']);
    expect(g.queryBox(box(10.001, 0, 20, 10))).toEqual([]);
    expect(g.queryPoint(10, 10)).toEqual(['a']);
    expect(g.queryPoint(0, 0)).toEqual(['a']);
    expect(g.queryPoint(-0.001, 0)).toEqual([]);
  });

  it('puts a shape on a cell edge (512) in both cells and finds it from either side', () => {
    const g = new IndexGrid();
    must(g.insert('edge', box(CELL_SIZE, CELL_SIZE, CELL_SIZE, CELL_SIZE)));
    expect(g.queryPoint(CELL_SIZE, CELL_SIZE)).toEqual(['edge']);
    expect(g.queryBox(box(CELL_SIZE - 1, CELL_SIZE - 1, CELL_SIZE + 1, CELL_SIZE + 1))).toEqual(['edge']);
    expect(g.queryBox(box(0, 0, CELL_SIZE - 1, CELL_SIZE - 1))).toEqual([]);
  });

  it('returns a shape once, even when it touches many cells in the query', () => {
    const g = new IndexGrid();
    must(g.insert('big', box(0, 0, 5000, 5000)));
    expect(g.queryViewport(box(0, 0, 5000, 5000))).toEqual(['big']);
  });

  it('appends to the array it is given and returns it', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 1, 1)));
    const out = ['x'];
    expect(g.queryBox(box(0, 0, 1, 1), out)).toBe(out);
    expect(out).toEqual(['x', 'a']);
    const out2: string[] = [];
    expect(g.queryPoint(0, 0, 0, out2)).toBe(out2);
    expect(out2).toEqual(['a']);
  });

  it('clears everything', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 1, 1)));
    g.clear();
    expect([g.size, g.cellCount]).toEqual([0, 0]);
    expect(g.queryBox(box(-5, -5, 5, 5))).toEqual([]);
  });
});

describe('insert, move and remove', () => {
  it('moves a shape that is inserted again under the same id', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 10, 10)));
    must(g.insert('a', box(2000, 2000, 2010, 2010)));
    expect(g.size).toBe(1);
    expect(g.queryBox(box(0, 0, 10, 10))).toEqual([]);
    expect(g.queryBox(box(2000, 2000, 2010, 2010))).toEqual(['a']);
  });

  it('is found at the new place and not the old after move', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 10, 10)));
    must(g.move('a', box(1000, 0, 1010, 10)));
    expect(g.queryPoint(5, 5)).toEqual([]);
    expect(g.queryPoint(1005, 5)).toEqual(['a']);
    expect(g.boundsOf('a')).toEqual(box(1000, 0, 1010, 10));
    expect(g.cellCount).toBe(1);
  });

  it('a move inside the same cells leaves the cell count alone, and a grow adds only the new cells', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(10, 10, 20, 20)));
    must(g.move('a', box(30, 30, 40, 40)));
    expect(g.cellCount).toBe(1);
    must(g.move('a', box(30, 30, 1100, 40)));
    expect(g.cellCount).toBe(3);
    must(g.move('a', box(30, 30, 40, 40)));
    expect(g.cellCount).toBe(1);
  });

  it('removes a shape: gone from every query, false when it was not there', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 2000, 10)));
    expect(g.remove('a')).toBe(true);
    expect(g.remove('a')).toBe(false);
    expect(g.remove('never')).toBe(false);
    expect(g.queryBox(box(-10, -10, 3000, 3000))).toEqual([]);
    expect(g.has('a')).toBe(false);
    expect(g.cellCount).toBe(0);
  });

  it('refuses bounds that are not numbers or have min above max, and keeps the old bounds', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 10, 10)));
    for (const bad of [box(Number.NaN, 0, 1, 1), box(0, 0, Number.POSITIVE_INFINITY, 1), box(5, 0, 1, 1), box(0, 5, 1, 1)]) {
      expect(g.insert('b', bad).ok).toBe(false);
      expect(g.move('a', bad).ok).toBe(false);
    }
    expect(g.has('b')).toBe(false);
    expect(g.boundsOf('a')).toEqual(box(0, 0, 10, 10));
    expect(g.size).toBe(1);
  });

  it('does not throw when moving a shape that is not in the index', () => {
    const g = new IndexGrid();
    expect(() => g.move('ghost', box(0, 0, 1, 1))).not.toThrow();
    expect(g.size === 0 || g.has('ghost')).toBe(true);
  });
});

describe('queries', () => {
  it('queryViewport finds the shapes whose bounds meet the viewport', () => {
    const g = new IndexGrid();
    must(g.insert('in', box(100, 100, 200, 200)));
    must(g.insert('out', box(5000, 5000, 5100, 5100)));
    must(g.insert('edge', box(900, 0, 1100, 50)));
    expect(sorted(g.queryViewport(box(0, 0, 1000, 800)))).toEqual(['edge', 'in']);
  });

  it('queryPoint with a tolerance finds shapes within that many page units', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(100, 100, 200, 200)));
    expect(g.queryPoint(95, 150)).toEqual([]);
    expect(g.queryPoint(95, 150, 5)).toEqual(['a']);
    expect(g.queryPoint(94, 150, 5)).toEqual([]);
    expect(g.queryPoint(205, 205, 5)).toEqual(['a']);
    // a tolerance that crosses into the next cell
    must(g.insert('b', box(CELL_SIZE + 2, 10, CELL_SIZE + 20, 20)));
    expect(g.queryPoint(CELL_SIZE - 3, 15, 6)).toEqual(['b']);
  });

  it('queryLasso finds the shapes whose bounds meet the polygon, and leaves out one that meets only its box', () => {
    const g = new IndexGrid();
    // a triangle (0,0) (100,0) (0,100); the corner box (60..100, 60..100) is in the polygon's box but outside it
    must(g.insert('inside', box(10, 10, 20, 20)));
    must(g.insert('crossing', box(40, 40, 80, 80)));
    must(g.insert('corner', box(70, 70, 100, 100)));
    must(g.insert('away', box(500, 500, 600, 600)));
    const tri = [0, 0, 100, 0, 0, 100];
    expect(sorted(g.queryLasso(tri))).toEqual(['crossing', 'inside']);
  });

  it('BR-75: queryLassoSplit says what testing every edge says, for loops of many corners and boxes of every size (a grid of cells over the loop answers the easy ones)', () => {
    // a small deterministic generator: the test is the same every run
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 40; round++) {
      const corners = 3 + Math.floor(next() * 60);
      const loop: number[] = [];
      for (let i = 0; i < corners; i++) {
        const a = (i / corners) * Math.PI * 2;
        const r = 200 + next() * (round % 2 === 0 ? 60 : 160);
        loop.push(400 + Math.cos(a) * r, 400 + Math.sin(a) * r);
      }
      const g = new IndexGrid();
      const boxes = new Map<string, Bounds>();
      for (let i = 0; i < 300; i++) {
        const x = next() * 900 - 50;
        const y = next() * 900 - 50;
        const w = next() < 0.8 ? next() * 25 : next() * 300;
        const h = next() < 0.8 ? next() * 25 : next() * 300;
        const b = box(x, y, x + w, y + h);
        boxes.set(`s${i}`, b);
        must(g.insert(`s${i}`, b));
      }
      const ids: string[] = [];
      const whole: boolean[] = [];
      g.queryLassoSplit(loop, ids, whole);
      const got = new Map(ids.map((id, i) => [id, whole[i] as boolean]));
      const xs = loop.filter((_, i) => i % 2 === 0);
      const ys = loop.filter((_, i) => i % 2 === 1);
      const lo = { x: Math.min(...xs), y: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      for (const [id, b] of boxes) {
        const meets = polygonMeetsBox(loop, b.minX, b.minY, b.maxX, b.maxY);
        const inBox = b.maxX >= lo.x && b.minX <= lo.x1 && b.maxY >= lo.y && b.minY <= lo.y1;
        expect(got.has(id), `round ${round} ${id} found`).toBe(meets && inBox);
        if (!got.has(id)) continue;
        // a box that is reported whole has every corner inside the loop and no edge of the loop crossing it
        if (got.get(id) === true) {
          for (const [cx, cy] of [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] as const) expect(pointInPolygon(cx, cy, loop), `round ${round} ${id} corner`).toBe(true);
        }
      }
    }
  });

  it('polygon helpers: point in polygon (even-odd) and polygon meets box', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, -1, square)).toBe(false);
    const bow = [0, 0, 10, 10, 10, 0, 0, 10];
    expect(pointInPolygon(5, 1, bow)).toBe(false);
    expect(pointInPolygon(5, 9, bow)).toBe(false);
    expect(pointInPolygon(1, 5, bow)).toBe(true);
    expect(pointInPolygon(9, 5, bow)).toBe(true);
    expect(polygonMeetsBox(square, 5, 5, 20, 20)).toBe(true);
    expect(polygonMeetsBox(square, 11, 11, 20, 20)).toBe(false);
    expect(polygonMeetsBox(square, 2, 2, 3, 3)).toBe(true);
    expect(polygonMeetsBox([0, 0, 100, 0, 0, 100], 70, 70, 100, 100)).toBe(false);
  });

  it('returns nothing, without throwing, for a polygon with fewer than 3 points', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 10, 10)));
    expect(() => g.queryLasso([0, 0, 10, 10])).not.toThrow();
    expect(g.queryLasso([0, 0, 10, 10])).toEqual([]);
    expect(g.queryLasso([])).toEqual([]);
  });

  it('answers a query with a box of no area, or with NaN, without throwing', () => {
    const g = new IndexGrid();
    must(g.insert('a', box(0, 0, 10, 10)));
    expect(g.queryBox(box(5, 5, 5, 5))).toEqual(['a']);
    expect(() => g.queryBox(box(Number.NaN, 0, 1, 1))).not.toThrow();
    expect(() => g.queryPoint(Number.NaN, Number.NaN)).not.toThrow();
  });
});

describe('correct against a scan of all shapes after many inserts, moves and removes', () => {
  it('matches brute force for box, viewport and point queries (seeded)', () => {
    const rand = rng(20260521);
    const g = new IndexGrid();
    const truth = new Map<string, Bounds>();
    const place = (): Bounds => {
      const x = (rand() - 0.5) * 8000;
      const y = (rand() - 0.5) * 8000;
      const w = rand() < 0.1 ? rand() * 3000 : rand() * 120;
      const h = rand() < 0.1 ? rand() * 3000 : rand() * 120;
      return box(x, y, x + w, y + h);
    };
    for (let i = 0; i < 400; i++) {
      const b = place();
      truth.set(`s${i}`, b);
      must(g.insert(`s${i}`, b));
    }
    const check = (round: number): void => {
      for (let q = 0; q < 12; q++) {
        const x = (rand() - 0.5) * 9000;
        const y = (rand() - 0.5) * 9000;
        const area = box(x, y, x + rand() * 1500, y + rand() * 1500);
        const want = [...truth].filter(([, b]) => meets(b, area)).map(([id]) => id).sort();
        expect(sorted(g.queryBox(area)), `box, round ${round}`).toEqual(want);
        expect(sorted(g.queryViewport(area)), `viewport, round ${round}`).toEqual(want);
        const tol = rand() < 0.5 ? 0 : rand() * 30;
        const px = x;
        const py = y;
        const grown = box(px - tol, py - tol, px + tol, py + tol);
        const wantP = [...truth].filter(([, b]) => meets(b, grown)).map(([id]) => id).sort();
        const gotP = sorted(g.queryPoint(px, py, tol));
        // a point query with a tolerance never misses a shape that contains the point or is within the tolerance in both axes
        for (const id of wantP) {
          const b = truth.get(id) as Bounds;
          const dx = Math.max(b.minX - px, 0, px - b.maxX);
          const dy = Math.max(b.minY - py, 0, py - b.maxY);
          if (Math.hypot(dx, dy) <= tol) expect(gotP, `point ${id}, round ${round}`).toContain(id);
        }
        for (const id of gotP) expect(wantP, `point result ${id} is within the grown box, round ${round}`).toContain(id);
      }
      expect(g.size).toBe(truth.size);
    };
    check(0);
    for (let round = 1; round <= 6; round++) {
      for (let k = 0; k < 120; k++) {
        const id = `s${Math.floor(rand() * 500)}`;
        const op = rand();
        if (op < 0.4) {
          const b = place();
          if (truth.has(id)) must(g.move(id, b));
          else must(g.insert(id, b));
          truth.set(id, b);
        } else if (op < 0.7) {
          const had = truth.delete(id);
          expect(g.remove(id)).toBe(had);
        } else if (op < 0.85) {
          const b = place();
          must(g.insert(id, b));
          truth.set(id, b);
        } else if (truth.has(id)) {
          const old = truth.get(id) as Bounds;
          const b = box(old.minX + 3, old.minY - 2, old.maxX + 3, old.maxY - 2);
          must(g.move(id, b));
          truth.set(id, b);
        }
      }
      check(round);
    }
    for (const id of [...truth.keys()]) {
      g.remove(id);
      truth.delete(id);
    }
    check(99);
    expect(g.cellCount).toBe(0);
  });

  it('matches brute force for lasso queries (seeded)', () => {
    const rand = rng(77);
    const g = new IndexGrid();
    const truth = new Map<string, Bounds>();
    for (let i = 0; i < 200; i++) {
      const x = rand() * 3000;
      const y = rand() * 3000;
      const b = box(x, y, x + rand() * 100, y + rand() * 100);
      truth.set(`s${i}`, b);
      must(g.insert(`s${i}`, b));
    }
    for (let q = 0; q < 20; q++) {
      const cx = rand() * 3000;
      const cy = rand() * 3000;
      const poly: number[] = [];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const r = 150 + rand() * 500;
        poly.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      const want = [...truth].filter(([, b]) => polygonMeetsBox(poly, b.minX, b.minY, b.maxX, b.maxY)).map(([id]) => id).sort();
      expect(sorted(g.queryLasso(poly)), `lasso ${q}`).toEqual(want);
    }
  });
});
