/**
 * Round 5 fix BR-57 (handoff/board/findings.md; agent.md 2): `'free'` finds an empty strip in view before it goes
 * below the content.
 */
import { describe, expect, it } from 'vitest';
import { PLACE_GAP, resolvePlace } from '../../src/index';
import type { Bounds } from '../../src/index';
import { must } from './round4-helpers';
import { add, shapeRig } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

describe("BR-57: 'free' looks for an empty strip in view (agent.md 2)", () => {
  const VIEW: Bounds = { minX: 0, minY: 0, maxX: 1280, maxY: 720 };
  const spot = (rig: BoardRig, w: number, h: number): { x: number; y: number } => must(resolvePlace(rig.core, 'free', { w, h }, { view: VIEW, last: undefined }));
  const row = (rig: BoardRig, y: number, h: number): void => {
    for (let i = 0; i < 4; i++) add(rig, 'rect', 60 + i * 300, y, { w: 200, h });
  };

  it('on an empty view the spot is the middle', () => {
    const rig = shapeRig();
    const s = spot(rig, 100, 60);
    expect(s.x).toBeCloseTo(590, 3);
    expect(s.y).toBeCloseTo(330, 3);
  });

  it('the strip at the foot of a full view is used, and the box lies wholly in view with the edge gap kept', () => {
    const rig = shapeRig();
    for (const y of [20, 220, 420]) row(rig, y, 180);
    const s = spot(rig, 100, 60);
    expect(s.y + 60).toBeLessThanOrEqual(VIEW.maxY - PLACE_GAP + 1e-6);
    expect(s.y).toBeGreaterThanOrEqual(606 - 1e-6);
  });

  it('the nearest gap to the middle is chosen, not the first one found', () => {
    const rig = shapeRig();
    // full-width bands at y 0..200, 300..500 and 600..700: gaps at 200..300 and 500..600, and the middle of the view (360) is nearer the first
    add(rig, 'rect', 0, 0, { w: 1280, h: 200 });
    add(rig, 'rect', 0, 300, { w: 1280, h: 200 });
    add(rig, 'rect', 0, 600, { w: 1280, h: 100 });
    const s = spot(rig, 40, 40);
    expect(s.y + 20).toBeGreaterThan(200);
    expect(s.y + 20).toBeLessThan(300);
  });

  it('a column between boxes in the same row is found', () => {
    const rig = shapeRig();
    row(rig, 0, 700);
    const s = spot(rig, 60, 100);
    // the boxes are at x 60..260, 360..560, 660..860, 960..1160: the nearest column gap to the middle is 560..660
    expect(s.x).toBeGreaterThanOrEqual(560);
    expect(s.x + 60).toBeLessThanOrEqual(660);
  });

  it('with no room anywhere in view the spot is below everything', () => {
    const rig = shapeRig();
    add(rig, 'rect', 0, 0, { w: 1280, h: 720 });
    const s = spot(rig, 100, 60);
    expect(s.y).toBeGreaterThanOrEqual(720);
  });

  it('a box wider than the view lands below too (no spot can hold it)', () => {
    const rig = shapeRig();
    const s = spot(rig, 1400, 60);
    expect(s.y).toBeGreaterThanOrEqual(720);
  });
});
