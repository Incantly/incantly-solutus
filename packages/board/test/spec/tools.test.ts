// @vitest-environment node
/**
 * Ink tools (docs/features/board/design.md 6.4, 6.5, 9; requirements R3.4, R4.5; state-machines B7 to B12): pen nibs,
 * the highlighter under ink, the eraser (whole and partial, one undo step a drag), the pen's eraser end and the last
 * tool coming back, the laser (never stored), the lasso (more than half of a stroke's points), the hand, and the keys
 * that choose a tool.
 */
import { describe, expect, it } from 'vitest';
import { BUTTON_ERASER, BUTTON_MIDDLE, LASER_FADE_MS, LASER_MAX_POINTS, inkTools, groupShapes } from '../../src/index';
import type { ShapeRecord } from '../../src/index';
import { copyOf, drawPath, line, makeRig, pointCount, pointsOf, sample, strokes } from './ink-helpers';
import type { Rig } from './ink-helpers';
import { add } from './shape-helpers';

const key = (k: string, over: { down?: boolean; shift?: boolean; mod?: boolean; repeat?: boolean } = {}): Parameters<Rig['host']['key']>[0] => ({
  key: k, down: over.down ?? true, shift: over.shift ?? false, alt: false, mod: over.mod ?? false, repeat: over.repeat ?? false,
});

/** Three long horizontal strokes at y = 50, 100, 150 and a short one far away at y = 400. */
function threeLines(rig: Rig): readonly ShapeRecord[] {
  drawPath(rig, line(0, 50, 200, 50, 20), {}, 0);
  drawPath(rig, line(0, 100, 200, 100, 20), {}, 1000);
  drawPath(rig, line(0, 150, 200, 150, 20), {}, 2000);
  drawPath(rig, line(0, 400, 100, 400, 10), {}, 3000);
  return strokes(rig);
}

/** Absolute (page) x of each point of a stroke. */
const xsOf = (s: ShapeRecord): readonly number[] => {
  const a = pointsOf(s);
  const stride = (s.props as { stride: number }).stride;
  return Array.from({ length: a.length / stride }, (_v, i) => s.x + (a[i * stride] as number));
};

describe('pen and highlighter (design 6.4)', () => {
  it('the pen has the nibs pen, marker and pencil, and the stroke keeps the nib it was drawn with', () => {
    for (const nib of ['pen', 'marker', 'pencil'] as const) {
      const rig = makeRig();
      rig.styles.pen = { ...rig.styles.pen, nib };
      drawPath(rig, line(0, 0, 60, 20));
      expect((strokes(rig)[0] as ShapeRecord).props).toMatchObject({ nib });
    }
  });

  it('tilt is stored only for the nibs that use it: marker and highlighter keep it, the pen nib does not (6.1 item 4, 5)', () => {
    const tilted = { tiltX: 25, tiltY: -15 };
    const penRig = makeRig();
    drawPath(penRig, line(0, 0, 60, 20), tilted);
    const pen = strokes(penRig)[0] as ShapeRecord;
    expect(pen.props).toMatchObject({ stride: 3 });
    expect(pointsOf(pen).length).toBe(pointCount(pen) * 3);

    const markerRig = makeRig();
    markerRig.styles.pen = { ...markerRig.styles.pen, nib: 'marker' };
    drawPath(markerRig, line(0, 0, 60, 20), tilted);
    const marker = strokes(markerRig)[0] as ShapeRecord;
    expect(marker.props).toMatchObject({ stride: 5 });
    expect(pointsOf(marker)[3]).toBe(25);
    expect(pointsOf(marker)[4]).toBe(-15);
  });

  it('the highlighter is wide and see-through', () => {
    const rig = makeRig({ tool: 'highlighter' });
    drawPath(rig, line(0, 0, 100, 0));
    const s = strokes(rig)[0] as ShapeRecord;
    const props = s.props as { nib: string; size: number; opacity: number };
    expect(props.nib).toBe('highlighter');
    expect(props.opacity).toBeLessThan(1);
    expect(props.size).toBeGreaterThan(rig.styles.pen.size * 2);
  });

  it('a highlighter stroke is drawn under ink and shapes, even when it was drawn after them', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 20, 100, 20)); // pen first
    rig.host.setTool('highlighter');
    drawPath(rig, line(0, 20, 100, 20), {}, 1000); // highlighter over it
    const items = rig.core.drawList.itemsIn({ minX: -50, minY: -50, maxX: 200, maxY: 100 }, 1);
    expect(items).toHaveLength(2);
    const ids = new Map(strokes(rig).map((s) => [s.id, (s.props as { nib: string }).nib]));
    expect(items.map((i) => ids.get(i.id))).toEqual(['highlighter', 'pen']);
    expect(items[0]?.layer).toBe(0);
    expect(items[1]?.layer).toBe(1);
  });

  it('the live stroke of a highlighter multiplies with what is under it; a pen stroke does not', () => {
    const rig = makeRig({ tool: 'highlighter' });
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    rig.host.sample(sample({ x: 30, y: 0, phase: 'move', time: 8 }));
    rig.core.live.rebuild(1);
    expect(rig.core.live.view().multiply).toBe(true);
    rig.host.sample(sample({ x: 30, y: 0, phase: 'up', time: 16 }));
    rig.host.setTool('pen');
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    rig.host.sample(sample({ x: 30, y: 0, phase: 'move', time: 8 }));
    rig.core.live.rebuild(1);
    expect(rig.core.live.view().multiply).toBe(false);
  });

  it('a new stroke clears the selection, as a click on the board does', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 50, 0));
    rig.core.selection.set([(strokes(rig)[0] as ShapeRecord).id]);
    drawPath(rig, line(0, 40, 50, 40), {}, 1000);
    expect(rig.core.selection.size).toBe(0);
  });
});

describe('eraser (design 6.4, B8)', () => {
  it('whole mode removes every stroke the eraser touches and no other', () => {
    const rig = makeRig();
    const [a, b, c, far] = threeLines(rig) as readonly [ShapeRecord, ShapeRecord, ShapeRecord, ShapeRecord];
    rig.styles.eraser = { mode: 'whole', radius: 8 };
    rig.host.setTool('eraser');
    drawPath(rig, line(100, 20, 100, 180, 16), {}, 5000);
    const left = strokes(rig).map((s) => s.id);
    expect(left).toEqual([far.id]);
    expect([a, b, c].every((s) => !left.includes(s.id))).toBe(true);
  });

  it('a drag is one undo step, however many strokes it crosses, and undo brings them all back', () => {
    const rig = makeRig();
    threeLines(rig);
    const steps = rig.core.history.undoSteps;
    rig.styles.eraser = { mode: 'whole', radius: 8 };
    rig.host.setTool('eraser');
    drawPath(rig, line(100, 20, 100, 180, 16), {}, 5000);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(strokes(rig)).toHaveLength(4);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('two drags are two undo steps', () => {
    const rig = makeRig();
    threeLines(rig);
    const steps = rig.core.history.undoSteps;
    rig.host.setTool('eraser');
    drawPath(rig, line(100, 40, 100, 60, 4), {}, 5000);
    drawPath(rig, line(100, 90, 100, 110, 4), {}, 6000);
    expect(strokes(rig)).toHaveLength(2);
    expect(rig.core.history.undoSteps).toBe(steps + 2);
  });

  it('the eraser leaves a stroke it does not reach', () => {
    const rig = makeRig();
    threeLines(rig);
    rig.host.setTool('eraser');
    drawPath(rig, line(300, 20, 300, 180, 8), {}, 5000);
    expect(strokes(rig)).toHaveLength(4);
  });

  it('a locked stroke is never erased', () => {
    const rig = makeRig();
    const [a] = threeLines(rig) as readonly [ShapeRecord];
    rig.core.store.change('user', (tx) => {
      tx.update(a.id, { locked: true });
    });
    rig.host.setTool('eraser');
    drawPath(rig, line(100, 20, 100, 180, 16), {}, 5000);
    expect(strokes(rig).map((s) => s.id)).toContain(a.id);
    expect(strokes(rig)).toHaveLength(2);
  });

  it('partial mode cuts a stroke where it passes: two new strokes of 2 or more points, the original gone', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 100, 200, 100, 40));
    const original = strokes(rig)[0] as ShapeRecord;
    rig.styles.eraser = { mode: 'partial', radius: 6 };
    rig.host.setTool('eraser');
    drawPath(rig, line(100, 80, 100, 120, 8), {}, 5000);
    const pieces = strokes(rig);
    expect(pieces.some((p) => p.id === original.id)).toBe(false);
    expect(pieces.length).toBe(2);
    for (const p of pieces) expect(pointCount(p)).toBeGreaterThanOrEqual(2);
    expect(pieces.reduce((n, p) => n + pointCount(p), 0)).toBeLessThan(pointCount(original));
    const [left, right] = [...pieces].sort((a, b) => Math.min(...xsOf(a)) - Math.min(...xsOf(b))) as [ShapeRecord, ShapeRecord];
    expect(Math.max(...xsOf(left))).toBeLessThan(100);
    expect(Math.min(...xsOf(right))).toBeGreaterThan(100);
    // the pieces keep the look of the stroke
    expect(left.props).toMatchObject({ nib: 'pen', color: (original.props as { color: string }).color, size: (original.props as { size: number }).size });
  });

  it('partial mode: the cut is one undo step and undo gives back the whole stroke', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 100, 200, 100, 40));
    const original = strokes(rig)[0] as ShapeRecord;
    const kept = copyOf(original);
    const steps = rig.core.history.undoSteps;
    rig.styles.eraser = { mode: 'partial', radius: 6 };
    rig.host.setTool('eraser');
    drawPath(rig, line(60, 80, 60, 120, 6), {}, 5000);
    drawPath(rig, line(140, 80, 140, 120, 6), {}, 6000);
    expect(strokes(rig).length).toBe(3);
    expect(rig.core.history.undoSteps).toBe(steps + 2);
    rig.core.history.undo();
    rig.core.history.undo();
    expect(strokes(rig)).toHaveLength(1);
    expect(copyOf(strokes(rig)[0] as ShapeRecord)).toEqual(kept);
  });

  it('partial mode cuts a long segment at the eraser, and leaves the ink the ring did not touch', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 100, 200, 100, 1));
    rig.styles.eraser = { mode: 'partial', radius: 6 };
    rig.host.setTool('eraser');
    drawPath(rig, line(100, 80, 100, 120, 4), {}, 5000);
    const pieces = strokes(rig);
    expect(pieces).toHaveLength(2);
    const [left, right] = [...pieces].sort((a, b) => Math.min(...xsOf(a)) - Math.min(...xsOf(b))) as [ShapeRecord, ShapeRecord];
    const leftEnd = Math.max(...xsOf(left));
    const rightStart = Math.min(...xsOf(right));
    // the ring is 6 across the centre, plus the stroke's own half width, so the cut sits just beside it
    expect(leftEnd).toBeGreaterThan(85);
    expect(leftEnd).toBeLessThan(96);
    expect(rightStart).toBeGreaterThan(104);
    expect(rightStart).toBeLessThan(115);
  });

  it('partial mode: a stroke wiped from end to end leaves no piece', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 100, 40, 100, 8));
    rig.styles.eraser = { mode: 'partial', radius: 30 };
    rig.host.setTool('eraser');
    drawPath(rig, line(-20, 100, 80, 100, 10), {}, 5000);
    expect(strokes(rig)).toHaveLength(0);
  });

  it('the eraser shows a ring of its size on the overlay while it hovers, and takes it away when the tool changes', () => {
    const rig = makeRig();
    rig.styles.eraser = { mode: 'whole', radius: 14 };
    rig.host.setTool('eraser');
    rig.host.sample(sample({ x: 33, y: 44, phase: 'hover', buttons: 0 }));
    expect(rig.overlay.cursor).toMatchObject({ x: 33, y: 44, radius: 14 });
    rig.host.setTool('pen');
    expect(rig.overlay.cursor).toBeNull();
  });
});

describe("the pen's eraser end (design 6.4, ui.md Pen, B12)", () => {
  it('erases while the eraser end is down, then the chosen tool comes back', () => {
    const rig = makeRig();
    threeLines(rig);
    expect(rig.host.tool).toBe('pen');
    rig.host.sample(sample({ x: 100, y: 20, phase: 'down', buttons: BUTTON_ERASER, time: 5000 }));
    expect(rig.host.state).toBe('eraserEnd');
    expect(rig.host.active).toBe('eraser');
    expect(rig.host.tool).toBe('pen');
    for (let y = 30; y <= 180; y += 10) rig.host.sample(sample({ x: 100, y, phase: 'move', buttons: BUTTON_ERASER, time: 5000 + y }));
    rig.host.sample(sample({ x: 100, y: 180, phase: 'up', buttons: 0, time: 5300 }));
    expect(strokes(rig)).toHaveLength(1);
    expect(rig.host.state).toBe('chosen');
    expect(rig.host.active).toBe('pen');
    // and the pen draws again
    drawPath(rig, line(0, 300, 80, 300), {}, 6000);
    expect(strokes(rig)).toHaveLength(2);
  });

  it('the last tool is back whichever it was: highlighter, laser or lasso', () => {
    for (const tool of ['highlighter', 'laser', 'lasso'] as const) {
      const rig = makeRig({ tool });
      rig.host.sample(sample({ x: 10, y: 10, phase: 'down', buttons: BUTTON_ERASER }));
      expect(rig.host.active).toBe('eraser');
      rig.host.sample(sample({ x: 20, y: 10, phase: 'up', buttons: 0, time: 8 }));
      expect(rig.host.active, tool).toBe(tool);
      expect(rig.host.tool).toBe(tool);
    }
  });

  it('the eraser end erases with the eraser style (whole or partial), as an eraser does', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 100, 200, 100, 40));
    rig.styles.eraser = { mode: 'partial', radius: 6 };
    rig.host.sample(sample({ x: 100, y: 80, phase: 'down', buttons: BUTTON_ERASER, time: 5000 }));
    for (let y = 90; y <= 120; y += 10) rig.host.sample(sample({ x: 100, y, phase: 'move', buttons: BUTTON_ERASER, time: 5000 + y }));
    rig.host.sample(sample({ x: 100, y: 120, phase: 'up', buttons: 0, time: 5200 }));
    expect(strokes(rig)).toHaveLength(2);
  });

  it('the eraser end does not leave a stroke, a dot or an undo step of its own on empty board', () => {
    const rig = makeRig();
    rig.host.sample(sample({ x: 10, y: 10, phase: 'down', buttons: BUTTON_ERASER }));
    rig.host.sample(sample({ x: 50, y: 50, phase: 'move', buttons: BUTTON_ERASER, time: 8 }));
    rig.host.sample(sample({ x: 50, y: 50, phase: 'up', buttons: 0, time: 16 }));
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
  });
});

describe('laser (design 6.4, B9)', () => {
  it('draws a trail on the overlay and stores nothing', () => {
    const rig = makeRig({ tool: 'laser' });
    drawPath(rig, line(0, 0, 100, 100, 20));
    expect(rig.core.store.all('shape')).toHaveLength(0);
    expect(rig.core.history.canUndo).toBe(false);
    expect(rig.overlay.laser?.count).toBeGreaterThan(10);
  });

  it('the trail holds at most 256 points', () => {
    expect(LASER_MAX_POINTS).toBe(256);
    const rig = makeRig({ tool: 'laser' });
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    for (let i = 1; i <= 600; i++) rig.host.sample(sample({ x: i, y: i % 50, phase: 'move', time: i }));
    expect(rig.overlay.laser?.count).toBeLessThanOrEqual(LASER_MAX_POINTS);
  });

  it('the trail fades and is gone about 1.2 s after the pointer is up; the laser keeps asking for frames until then', () => {
    expect(LASER_FADE_MS).toBe(1200);
    const rig = makeRig({ tool: 'laser' });
    drawPath(rig, line(0, 0, 100, 0, 10), {}, 0);
    expect(rig.host.tick(100)).toBe(true);
    expect(rig.overlay.laser?.count).toBeGreaterThan(0);
    const midAges = Array.from(rig.overlay.laser?.age.subarray(0, rig.overlay.laser.count) ?? []);
    expect(midAges.every((a) => a >= 0 && a < 1)).toBe(true);
    expect(rig.host.tick(100 + LASER_FADE_MS + 100)).toBe(false);
    expect(rig.overlay.laser).toBeNull();
    expect(rig.core.store.all('shape')).toHaveLength(0);
  });

  it('a new stroke while the old one fades keeps the old points while they fade (B9: down in fading)', () => {
    const rig = makeRig({ tool: 'laser' });
    drawPath(rig, line(0, 0, 100, 0, 10), {}, 0);
    const before = rig.overlay.laser?.count ?? 0;
    rig.host.sample(sample({ x: 200, y: 50, phase: 'down', time: 200 }));
    expect(rig.overlay.laser?.count).toBeGreaterThan(before);
  });

  it('a held pointer keeps its trail: tick does not end the laser while the pointer is down', () => {
    const rig = makeRig({ tool: 'laser' });
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down', time: 0 }));
    rig.host.sample(sample({ x: 10, y: 0, phase: 'move', time: 10 }));
    expect(rig.host.tick(5000)).toBe(true);
    // the pointer is still down: the next point still joins a live trail
    rig.host.sample(sample({ x: 20, y: 0, phase: 'move', time: 5010 }));
    expect(rig.overlay.laser?.count).toBeGreaterThan(0);
  });
});

describe('lasso (design 6.4, B10)', () => {
  const loop = [[0, 0], [210, 0], [210, 200], [0, 200], [0, 2]] as const;

  /** A closed loop drawn with the lasso. */
  function lasso(rig: Rig, pts: readonly (readonly [number, number])[]): void {
    rig.host.setTool('lasso');
    drawPath(rig, pts, {}, 9000);
  }

  it('selects the strokes with more than half of their points inside, and no others', () => {
    const rig = makeRig();
    drawPath(rig, line(20, 100, 180, 100, 10), {}, 0); // all inside
    drawPath(rig, [100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300].map((x) => [x, 150] as const), {}, 1000); // 6 of 11 inside
    drawPath(rig, [150, 170, 190, 210, 230, 250, 270, 290, 310, 330, 350].map((x) => [x, 180] as const), {}, 2000); // 3 of 11 inside
    drawPath(rig, line(400, 100, 500, 100, 10), {}, 3000); // outside
    const [a, b, c, d] = strokes(rig) as readonly [ShapeRecord, ShapeRecord, ShapeRecord, ShapeRecord];
    lasso(rig, loop);
    expect(new Set(rig.core.selection.ids)).toEqual(new Set([a.id, b.id]));
    expect(rig.core.selection.has(c.id)).toBe(false);
    expect(rig.core.selection.has(d.id)).toBe(false);
  });

  it('exactly half is not enough: more than half is the rule', () => {
    const rig = makeRig();
    // 10 points at x = 10, 30, ..., 190: a loop to x = 100 holds 5, a loop to x = 120 holds 6
    drawPath(rig, Array.from({ length: 10 }, (_v, i) => [10 + 20 * i, 100] as const));
    const [s] = strokes(rig) as readonly [ShapeRecord];
    lasso(rig, [[0, 0], [100, 0], [100, 200], [0, 200], [0, 2]]);
    expect(rig.core.selection.has(s.id)).toBe(false);
    lasso(rig, [[0, 0], [120, 0], [120, 200], [0, 200], [0, 2]]);
    expect(rig.core.selection.has(s.id)).toBe(true);
  });

  it('the selection is not stored and is not an undo step, and the loop is gone from the overlay', () => {
    const rig = makeRig();
    drawPath(rig, line(20, 100, 180, 100, 10));
    const steps = rig.core.history.undoSteps;
    const records = rig.core.store.size;
    lasso(rig, loop);
    expect(rig.core.selection.size).toBe(1);
    expect(rig.core.history.undoSteps).toBe(steps);
    expect(rig.core.store.size).toBe(records);
    expect(rig.overlay.loop).toBeNull();
  });

  it('the loop is on the overlay while the pointer is down', () => {
    const rig = makeRig({ tool: 'lasso' });
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    rig.host.sample(sample({ x: 100, y: 0, phase: 'move', time: 8 }));
    rig.host.sample(sample({ x: 100, y: 100, phase: 'move', time: 16 }));
    expect(rig.overlay.loop?.count).toBe(3);
  });

  it('a locked stroke is not selected', () => {
    const rig = makeRig();
    drawPath(rig, line(20, 100, 180, 100, 10));
    const [s] = strokes(rig) as readonly [ShapeRecord];
    rig.core.store.change('user', (tx) => {
      tx.update(s.id, { locked: true });
    });
    lasso(rig, loop);
    expect(rig.core.selection.size).toBe(0);
  });

  it('a loop of fewer than 3 points selects nothing and clears the selection', () => {
    const rig = makeRig();
    drawPath(rig, line(20, 100, 180, 100, 10));
    lasso(rig, loop);
    expect(rig.core.selection.size).toBe(1);
    rig.host.sample(sample({ x: 50, y: 50, phase: 'down', time: 12000 }));
    rig.host.sample(sample({ x: 50, y: 50, phase: 'up', time: 12010 }));
    expect(rig.core.selection.size).toBe(0);
  });

  it('a cancelled loop keeps the selection and drops the loop', () => {
    const rig = makeRig();
    drawPath(rig, line(20, 100, 180, 100, 10));
    lasso(rig, loop);
    rig.host.sample(sample({ x: 300, y: 300, phase: 'down', time: 12000 }));
    rig.host.sample(sample({ x: 340, y: 300, phase: 'move', time: 12008 }));
    rig.host.sample(sample({ x: 340, y: 300, phase: 'cancel', time: 12016 }));
    expect(rig.core.selection.size).toBe(1);
    expect(rig.overlay.loop).toBeNull();
  });

  it('Delete removes the selected strokes in one undo step', () => {
    const rig = makeRig();
    drawPath(rig, line(20, 100, 180, 100, 10));
    drawPath(rig, line(20, 150, 180, 150, 10), {}, 1000);
    lasso(rig, loop);
    expect(rig.core.selection.size).toBe(2);
    const steps = rig.core.history.undoSteps;
    expect(rig.host.key(key('Delete'))).toBe(true);
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(strokes(rig)).toHaveLength(2);
  });

  // design 6.4: "or a shape's centre"; B10: "and later shapes whose centre is inside"
  it('selects a shape whose centre is inside the loop', () => {
    const rig = makeRig();
    const a = add(rig, 'rect', 50, 50, { w: 100, h: 60, fill: '#ffcc00' });
    lasso(rig, loop);
    expect(rig.core.selection.ids).toEqual([a.id]);
  });

  it('does not select a shape whose centre is outside, even when a corner of it is inside the loop', () => {
    const rig = makeRig();
    // x 150..350 and y 50..110: its centre (250, 80) is outside the loop, which ends at x = 210
    add(rig, 'rect', 150, 50, { w: 200, h: 60, fill: '#ffcc00' });
    lasso(rig, loop);
    expect(rig.core.selection.size).toBe(0);
  });

  it('selects a shape that is bigger than the loop when its centre is inside', () => {
    const rig = makeRig();
    const big = add(rig, 'rect', -200, -200, { w: 600, h: 600, fill: '#ffcc00' });
    lasso(rig, loop);
    expect(rig.core.selection.ids).toEqual([big.id]);
  });

  it('the rule is the centre for every kind: ellipse, line, text, sticky and frame', () => {
    const rig = makeRig();
    const made = [
      add(rig, 'ellipse', 20, 20, { w: 60, h: 40 }),
      add(rig, 'line', 50, 100, { points: [0, 0, 100, 0] }),
      add(rig, 'text', 20, 150, { text: 'hi' }),
      add(rig, 'sticky', 100, 10, { text: 'n' }),
      add(rig, 'frame', 10, 120, { w: 100, h: 60 }),
    ];
    // a sticky note is 200 wide: its centre (200, 110) is inside; the one far away is not
    const far = add(rig, 'ellipse', 600, 600, { w: 60, h: 40 });
    lasso(rig, loop);
    expect(new Set(rig.core.selection.ids)).toEqual(new Set(made.map((s) => s.id)));
    expect(rig.core.selection.has(far.id)).toBe(false);
  });

  it('a turned shape is judged by its centre, which a turn does not move', () => {
    const rig = makeRig();
    const a = add(rig, 'rect', 50, 90, { w: 100, h: 20, fill: '#ffcc00' }, { rotation: Math.PI / 2 });
    lasso(rig, [[60, 40], [140, 40], [140, 160], [60, 160], [60, 42]]);
    expect(rig.core.selection.ids).toEqual([a.id]);
  });

  it('a locked shape is not selected, and a shape of a group brings the whole group', () => {
    const rig = makeRig();
    const locked = add(rig, 'rect', 50, 50, { w: 100, h: 60 }, { locked: true });
    const inside = add(rig, 'rect', 50, 130, { w: 100, h: 40 });
    const outside = add(rig, 'rect', 600, 600, { w: 100, h: 40 });
    groupShapes(rig.core, [inside.id, outside.id]);
    lasso(rig, loop);
    expect(rig.core.selection.has(locked.id)).toBe(false);
    expect(new Set(rig.core.selection.ids)).toEqual(new Set([inside.id, outside.id]));
  });

  it('shapes and strokes are chosen together by their own rules, and the selection is not an undo step', () => {
    const rig = makeRig();
    drawPath(rig, line(20, 150, 180, 150, 10), {}, 0);
    const [ink] = strokes(rig) as [ShapeRecord];
    const a = add(rig, 'rect', 50, 50, { w: 100, h: 60 });
    const steps = rig.core.history.undoSteps;
    const size = rig.core.store.size;
    lasso(rig, loop);
    expect(new Set(rig.core.selection.ids)).toEqual(new Set([ink.id, a.id]));
    expect(rig.core.history.undoSteps).toBe(steps);
    expect(rig.core.store.size).toBe(size);
  });
});

describe('hand, wheel and pinch (R3.4, design 9 item 1, B11, B12)', () => {
  it('the hand tool drags the page with the pointer', () => {
    const rig = makeRig({ tool: 'hand' });
    drawPath(rig, line(100, 100, 160, 130, 6));
    expect(rig.core.camera?.x).toBeCloseTo(-60, 5);
    expect(rig.core.camera?.y).toBeCloseTo(-30, 5);
    expect(rig.core.store.all('shape')).toHaveLength(0);
  });

  it('a drag pans by the pointer movement in page units: at zoom 2 a 60 px drag is 30 units', () => {
    const rig = makeRig({ tool: 'hand' });
    rig.core.camera?.moveTo(0, 0, 2, 0);
    drawPath(rig, line(100, 100, 160, 100, 6));
    expect(rig.core.camera?.x).toBeCloseTo(-30, 5);
  });

  it('holding Space gives the hand for as long as it is held, then the chosen tool is back', () => {
    const rig = makeRig();
    expect(rig.host.key(key(' '))).toBe(true);
    expect(rig.host.state).toBe('handHeld');
    expect(rig.host.active).toBe('hand');
    drawPath(rig, line(100, 100, 150, 100, 5));
    expect(rig.core.camera?.x).toBeCloseTo(-50, 5);
    expect(strokes(rig)).toHaveLength(0);
    rig.host.key(key(' ', { down: false }));
    expect(rig.host.state).toBe('chosen');
    expect(rig.host.active).toBe('pen');
    drawPath(rig, line(0, 0, 50, 0), {}, 1000);
    expect(strokes(rig)).toHaveLength(1);
  });

  it('the middle button gives the hand for that drag', () => {
    const rig = makeRig();
    rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, x: 100, y: 100, phase: 'down', buttons: BUTTON_MIDDLE }));
    expect(rig.host.state).toBe('handHeld');
    rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, x: 140, y: 120, phase: 'move', buttons: BUTTON_MIDDLE, time: 8 }));
    rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, x: 140, y: 120, phase: 'up', buttons: 0, time: 16 }));
    expect(rig.core.camera?.x).toBeCloseTo(-40, 5);
    expect(rig.core.camera?.y).toBeCloseTo(-20, 5);
    expect(rig.host.state).toBe('chosen');
    expect(strokes(rig)).toHaveLength(0);
  });

  it('a wheel notch zooms about the pointer: the page point under it stays under it', () => {
    const rig = makeRig();
    const camera = rig.core.camera as NonNullable<Rig['core']['camera']>;
    const before = camera.toPage(300, 200);
    rig.host.wheel({ x: 300, y: 200, dx: 0, dy: -240, zoom: true, time: 0 });
    expect(camera.zoom).toBeGreaterThan(1);
    const after = camera.toPage(300, 200);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    rig.host.wheel({ x: 300, y: 200, dx: 0, dy: 480, zoom: true, time: 10 });
    expect(camera.zoom).toBeLessThan(1);
    expect(camera.toPage(300, 200).x).toBeCloseTo(before.x, 6);
  });

  it('a wheel without zoom pans', () => {
    const rig = makeRig();
    rig.host.wheel({ x: 0, y: 0, dx: 0, dy: 80, zoom: false, time: 0 });
    expect(rig.core.camera?.y).toBeCloseTo(80, 6);
    expect(rig.core.camera?.zoom).toBe(1);
  });

  it('the zoom stays between 0.05 and 20 however far the wheel turns', () => {
    const rig = makeRig();
    const camera = rig.core.camera as NonNullable<Rig['core']['camera']>;
    for (let i = 0; i < 200; i++) rig.host.wheel({ x: 10, y: 10, dx: 0, dy: -480, zoom: true, time: i });
    expect(camera.zoom).toBe(20);
    for (let i = 0; i < 400; i++) rig.host.wheel({ x: 10, y: 10, dx: 0, dy: 480, zoom: true, time: 1000 + i });
    expect(camera.zoom).toBe(0.05);
    expect(Number.isFinite(camera.x) && Number.isFinite(camera.y)).toBe(true);
  });

  it('a two-finger gesture pans by the centre and zooms about it by the change of spread', () => {
    const rig = makeRig();
    const camera = rig.core.camera as NonNullable<Rig['core']['camera']>;
    const under = camera.toPage(200, 100);
    rig.host.gesture({ x: 200, y: 100, dx: 0, dy: 0, scale: 2, time: 0 });
    expect(camera.zoom).toBeCloseTo(2, 6);
    expect(camera.toPage(200, 100).x).toBeCloseTo(under.x, 6);
    rig.host.gesture({ x: 200, y: 100, dx: 40, dy: 10, scale: 1, time: 10 });
    expect(camera.zoom).toBeCloseTo(2, 6);
    expect(camera.x).toBeCloseTo(under.x - 200 / 2 - 20, 4);
  });

  it('a pinch cannot take the zoom outside 0.05 to 20', () => {
    const rig = makeRig();
    rig.host.gesture({ x: 0, y: 0, dx: 0, dy: 0, scale: 1e9, time: 0 });
    expect(rig.core.camera?.zoom).toBe(20);
    rig.host.gesture({ x: 0, y: 0, dx: 0, dy: 0, scale: 1e-12, time: 10 });
    expect(rig.core.camera?.zoom).toBe(0.05);
  });

  it('zoom changes make the steady zoom wait 150 ms (design 9 item 5)', () => {
    const rig = makeRig();
    const camera = rig.core.camera as NonNullable<Rig['core']['camera']>;
    rig.host.wheel({ x: 0, y: 0, dx: 0, dy: -240, zoom: true, time: 1000 });
    expect(camera.motion).toBe('zooming');
    expect(camera.steadyZoom).toBe(1);
    expect(camera.tick(1100)).toBe(false);
    expect(camera.tick(1160)).toBe(true);
    expect(camera.motion).toBe('steady');
    expect(camera.steadyZoom).toBeCloseTo(camera.zoom, 9);
  });
});

describe('the tool host (B12) and the keys (ui.md)', () => {
  it('the default tools are pen, highlighter, eraser, laser, lasso and hand', () => {
    expect([...inkTools.ids()].sort()).toEqual(['eraser', 'hand', 'highlighter', 'laser', 'lasso', 'pen']);
  });

  it('a tool id that is not registered is tool_unknown and changes nothing', () => {
    const rig = makeRig();
    const r = rig.host.setTool('wand');
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.kind).toBe('tool_unknown');
    expect(rig.host.tool).toBe('pen');
  });

  it('changing the tool in the middle of a stroke cancels the stroke: nothing is stored', () => {
    const rig = makeRig();
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    rig.host.sample(sample({ x: 50, y: 0, phase: 'move', time: 8 }));
    expect(rig.host.setTool('eraser').ok).toBe(true);
    expect(rig.core.live.state).toBe('idle');
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
  });

  it('the keys p, shift+p, e, k, l and h choose pen, highlighter, eraser, laser, lasso and hand', () => {
    const rig = makeRig();
    const pick = (k: string, shift = false): string => {
      rig.host.key(key(k, { shift }));
      return rig.host.tool;
    };
    expect(pick('e')).toBe('eraser');
    expect(pick('k')).toBe('laser');
    expect(pick('l')).toBe('lasso');
    expect(pick('h')).toBe('hand');
    expect(pick('p', true)).toBe('highlighter');
    expect(pick('p')).toBe('pen');
  });

  it('mod+z undoes, mod+shift+z and mod+y redo', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 50, 0));
    expect(rig.host.key(key('z', { mod: true }))).toBe(true);
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.host.key(key('z', { mod: true, shift: true }))).toBe(true);
    expect(strokes(rig)).toHaveLength(1);
    rig.host.key(key('z', { mod: true }));
    expect(rig.host.key(key('y', { mod: true }))).toBe(true);
    expect(strokes(rig)).toHaveLength(1);
  });

  it('a key does not choose a tool while a pointer is down', () => {
    const rig = makeRig();
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    expect(rig.host.key(key('e'))).toBe(false);
    expect(rig.host.tool).toBe('pen');
  });

  it('Escape drops the selection', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 50, 0));
    rig.core.selection.set([(strokes(rig)[0] as ShapeRecord).id]);
    rig.host.key(key('Escape'));
    expect(rig.core.selection.size).toBe(0);
  });

  it('a host can take a tool out of the list and the key for it does nothing', () => {
    const rig = makeRig({ tools: inkTools.without('laser') });
    expect(rig.host.setTool('laser').ok).toBe(false);
    rig.host.key(key('k'));
    expect(rig.host.tool).toBe('pen');
  });
});
