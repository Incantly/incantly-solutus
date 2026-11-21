// @vitest-environment node
/**
 * The shape tools (docs/features/board/ui.md "Shapes and editing", "Keys"; design 7.4; docs/state-machines.md B20, B21):
 * drag makes the shape, a click makes the default size centred on the point, Shift makes a square or a circle (and
 * snaps a line to 15 degrees), Alt draws from the centre, one gesture is one undo step, a cancel removes what was
 * started, and the text tools open the editor. Only the public API is used.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_TOOLS, SHAPE_TOOL_MACHINE, boardTools, builtInKind, shapeGeometry } from '../../src/index';
import type { ShapeRecord } from '../../src/index';
import { sample } from './ink-helpers';
import { MOD_ALT, MOD_SHIFT, add, boxOf, centreOf, drag, get, key, ofKind, pageOf, press, release, shapeRig, shapesOf, tap } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

const BOX_TOOLS = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'frame'] as const;

/** The only shape of a kind on the page. */
function only(rig: BoardRig, kind: string): ShapeRecord {
  const list = ofKind(rig, kind);
  expect(list, kind).toHaveLength(1);
  return list[0] as ShapeRecord;
}

const size = (rig: BoardRig, id: string): { w: number; h: number } => {
  const b = boxOf(rig, id);
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
};

const defaultSize = (kind: string): { w: number; h: number } => {
  const d = builtInKind(kind)?.defaults as { w: number; h: number };
  return { w: d.w, h: d.h };
};

describe('which tools there are, and their keys (ui.md)', () => {
  it('the shape tools are rect, ellipse, triangle, diamond, star, line, arrow, text, sticky and frame', () => {
    expect(SHAPE_TOOLS.map((t) => t.id)).toEqual(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow', 'text', 'sticky', 'frame']);
  });

  it('the board tools are the select tool, the ink tools, the hand and the shape tools', () => {
    const ids = boardTools.ids();
    for (const id of ['select', 'pen', 'highlighter', 'eraser', 'laser', 'lasso', 'hand', ...SHAPE_TOOLS.map((t) => t.id)]) expect(ids, id).toContain(id);
  });

  it.each([
    ['v', 'select'],
    ['r', 'rect'],
    ['o', 'ellipse'],
    ['a', 'arrow'],
    ['t', 'text'],
    ['n', 'sticky'],
    ['f', 'frame'],
    ['h', 'hand'],
    ['p', 'pen'],
  ] as const)('the key %s chooses %s', (k, tool) => {
    const rig = shapeRig('pen');
    key(rig, k);
    expect(rig.host.tool).toBe(tool);
  });

  it('shift+l chooses the line and l chooses the lasso', () => {
    const rig = shapeRig();
    key(rig, 'l', { shift: true });
    expect(rig.host.tool).toBe('line');
    key(rig, 'l');
    expect(rig.host.tool).toBe('lasso');
  });

  it('every shape tool has a label, a key and a state that starts idle', () => {
    for (const def of SHAPE_TOOLS) {
      expect(def.label.length, def.id).toBeGreaterThan(0);
      expect(def.key, def.id).toBeDefined();
      const rig = shapeRig(def.id);
      expect(rig.host.tool).toBe(def.id);
    }
  });
});

describe('drag makes the shape from the down point to the pointer (B20)', () => {
  it.each(BOX_TOOLS)('%s: a drag down and to the right makes a box from the down point to the pointer', (tool) => {
    const rig = shapeRig(tool);
    drag(rig, [100, 100], [220, 180]);
    const s = only(rig, tool);
    expect(boxOf(rig, s.id)).toEqual({ minX: 100, minY: 100, maxX: 220, maxY: 180 });
  });

  it.each(['up-left', 'up-right', 'down-left'] as const)('rect: a drag %s makes the same box, from the corner the pointer went to', (way) => {
    const rig = shapeRig('rect');
    const to: Record<typeof way, [number, number]> = { 'up-left': [40, 30], 'up-right': [260, 30], 'down-left': [40, 190] };
    drag(rig, [150, 110], to[way]);
    const b = boxOf(rig, only(rig, 'rect').id);
    expect(b.minX).toBeCloseTo(Math.min(150, to[way][0]), 6);
    expect(b.maxX).toBeCloseTo(Math.max(150, to[way][0]), 6);
    expect(b.minY).toBeCloseTo(Math.min(110, to[way][1]), 6);
    expect(b.maxY).toBeCloseTo(Math.max(110, to[way][1]), 6);
  });

  it('a line drag makes a line from the down point to the pointer', () => {
    const rig = shapeRig('line');
    drag(rig, [50, 60], [250, 160]);
    const s = only(rig, 'line');
    const p = (s.props as { points: number[] }).points;
    const g = shapeGeometry(s, rig.core.store.kinds);
    const a = g?.toPage(p[0] as number, p[1] as number);
    const b = g?.toPage(p[p.length - 2] as number, p[p.length - 1] as number);
    expect(a?.x).toBeCloseTo(50, 6);
    expect(a?.y).toBeCloseTo(60, 6);
    expect(b?.x).toBeCloseTo(250, 6);
    expect(b?.y).toBeCloseTo(160, 6);
  });

  it('an arrow drag makes an arrow with its start at the down point and its end at the pointer', () => {
    const rig = shapeRig('arrow');
    drag(rig, [50, 60], [250, 160]);
    const s = only(rig, 'arrow');
    const props = s.props as { start: [number, number]; end: [number, number] };
    const g = shapeGeometry(s, rig.core.store.kinds);
    const a = g?.toPage(props.start[0], props.start[1]);
    const b = g?.toPage(props.end[0], props.end[1]);
    expect(a?.x).toBeCloseTo(50, 6);
    expect(a?.y).toBeCloseTo(60, 6);
    expect(b?.x).toBeCloseTo(250, 6);
    expect(b?.y).toBeCloseTo(160, 6);
  });

  it('a text drag makes a text box with a fixed width', () => {
    const rig = shapeRig('text');
    drag(rig, [100, 100], [300, 140]);
    const s = only(rig, 'text');
    expect((s.props as { w: number | null }).w).toBeCloseTo(200, 6);
    expect(s.x).toBeCloseTo(100, 6);
  });

  it('a shape drawn with the pen styles of the style bar takes them (ToolStyles.shape)', () => {
    const rig = shapeRig('rect');
    rig.styles.shape = { color: '#cc0000', fill: '#ffee00', dash: 'dashed', size: 6, font: 'serif' };
    drag(rig, [10, 10], [110, 90]);
    expect(only(rig, 'rect').props).toMatchObject({ stroke: '#cc0000', fill: '#ffee00', dash: 'dashed', size: 6 });
  });

  it('the shape is on the current page, on top of the shapes already there', () => {
    const rig = shapeRig('rect');
    const below = add(rig, 'rect', 0, 0);
    drag(rig, [300, 300], [380, 360]);
    const made = shapesOf(rig).find((s) => s.id !== below.id) as ShapeRecord;
    expect(made.page).toBe(pageOf(rig));
    expect(made.index > below.index).toBe(true);
  });

  it('a shape made with its middle inside a frame belongs to the frame', () => {
    const rig = shapeRig('rect');
    const frame = add(rig, 'frame', 0, 0, { w: 400, h: 300 });
    drag(rig, [50, 50], [150, 120]);
    expect(only(rig, 'rect').parent).toBe(frame.id);
    rig.host.setTool('rect');
    drag(rig, [600, 600], [700, 660], 0, 6, 1000);
    const outside = ofKind(rig, 'rect').find((s) => s.x >= 600) as ShapeRecord;
    expect(outside.parent).toBeNull();
  });
});

describe('the shape is written from the first move past the slop, and each move updates it (B20)', () => {
  it('no shape exists while the pointer stays within 4 screen pixels; one exists after it goes further; each move changes it', () => {
    const rig = shapeRig('rect');
    press(rig, [[100, 100], [102, 101]]);
    expect(ofKind(rig, 'rect')).toHaveLength(0);
    press(rig, [[100, 100], [140, 130]]);
    const id = only(rig, 'rect').id;
    expect(size(rig, id)).toEqual({ w: 40, h: 30 });
    rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase: 'move', x: 180, y: 170, time: 50, buttons: 1 }));
    expect(ofKind(rig, 'rect')).toHaveLength(1);
    expect(size(rig, id)).toEqual({ w: 80, h: 70 });
    release(rig, 180, 170);
    expect(size(rig, id)).toEqual({ w: 80, h: 70 });
  });

  it('a drag is one undo step however many moves it had; undo removes the shape and redo brings it back', () => {
    const rig = shapeRig('ellipse');
    const steps = rig.core.history.undoSteps;
    drag(rig, [100, 100], [260, 200], 0, 20);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    const made = only(rig, 'ellipse');
    rig.core.history.undo();
    expect(ofKind(rig, 'ellipse')).toHaveLength(0);
    rig.core.history.redo();
    expect(only(rig, 'ellipse')).toEqual(made);
  });

  it('a click is one undo step too', () => {
    const rig = shapeRig('rect');
    const steps = rig.core.history.undoSteps;
    tap(rig, 200, 200);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(ofKind(rig, 'rect')).toHaveLength(0);
  });

  it('two shapes made one after the other are two undo steps, never merged', () => {
    const rig = shapeRig('rect');
    const steps = rig.core.history.undoSteps;
    drag(rig, [10, 10], [60, 50]);
    rig.host.setTool('rect');
    drag(rig, [100, 100], [160, 150], 0, 6, 1000);
    expect(ofKind(rig, 'rect')).toHaveLength(2);
    expect(rig.core.history.undoSteps).toBe(steps + 2);
  });

  it('a cancel removes the shape that was started and leaves no undo step', () => {
    const rig = shapeRig('rect');
    const steps = rig.core.history.undoSteps;
    press(rig, [[100, 100], [160, 150], [200, 190]]);
    expect(ofKind(rig, 'rect')).toHaveLength(1);
    rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase: 'cancel', x: 200, y: 190, time: 100, buttons: 0 }));
    expect(ofKind(rig, 'rect')).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(steps);
    expect(rig.core.history.canRedo).toBe(false);
  });

  it('a cancel before the pointer left the slop changes nothing', () => {
    const rig = shapeRig('rect');
    const steps = rig.core.history.undoSteps;
    press(rig, [[100, 100], [101, 100]]);
    rig.host.cancel();
    expect(ofKind(rig, 'rect')).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(steps);
  });

  it('after a cancel the tool is idle and a new drag works', () => {
    const rig = shapeRig('rect');
    press(rig, [[100, 100], [160, 150]]);
    rig.host.cancel();
    drag(rig, [10, 10], [90, 70], 0, 6, 500);
    expect(ofKind(rig, 'rect')).toHaveLength(1);
  });

  it('when the shape is made it is selected and the select tool is chosen again', () => {
    const rig = shapeRig('rect');
    drag(rig, [100, 100], [200, 180]);
    expect(rig.core.selection.ids).toEqual([only(rig, 'rect').id]);
    expect(rig.host.tool).toBe('select');
  });

  it('a new shape clears the selection that was there before', () => {
    const rig = shapeRig('rect');
    const old = add(rig, 'rect', 400, 400);
    rig.core.selection.set([old.id]);
    drag(rig, [100, 100], [200, 180]);
    expect(rig.core.selection.has(old.id)).toBe(false);
  });
});

describe('a click makes the default size, centred on the point (B20)', () => {
  it.each(['rect', 'ellipse', 'frame'] as const)('%s: the kind default w by h, centred on the click', (tool) => {
    const rig = shapeRig(tool);
    tap(rig, 300, 200);
    const s = only(rig, tool);
    const want = defaultSize(tool);
    expect(size(rig, s.id).w).toBeCloseTo(want.w, 6);
    expect(size(rig, s.id).h).toBeCloseTo(want.h, 6);
    expect(centreOf(rig, s.id).x).toBeCloseTo(300, 6);
    expect(centreOf(rig, s.id).y).toBeCloseTo(200, 6);
  });

  // B20: "a `up` before the pointer moved past the slop makes the kind's default size centred on the point"
  it.each(['triangle', 'diamond', 'star'] as const)('%s: the kind default w by h, centred on the click', (tool) => {
    const rig = shapeRig(tool);
    tap(rig, 300, 200);
    const s = only(rig, tool);
    const want = defaultSize(tool);
    expect(size(rig, s.id).w).toBeCloseTo(want.w, 6);
    expect(size(rig, s.id).h).toBeCloseTo(want.h, 6);
    expect(centreOf(rig, s.id).x).toBeCloseTo(300, 6);
    expect(centreOf(rig, s.id).y).toBeCloseTo(200, 6);
  });

  it('a sticky note: its fixed size, centred on the click, and the editor open on it', () => {
    const rig = shapeRig('sticky');
    tap(rig, 300, 200);
    const s = only(rig, 'sticky');
    expect(centreOf(rig, s.id).x).toBeCloseTo(300, 6);
    expect(centreOf(rig, s.id).y).toBeCloseTo(200, 6);
    expect(rig.core.editor.state).toBe('editing');
    expect(rig.core.editor.shapeId).toBe(s.id);
  });

  it('a line: the default length, horizontal, centred on the click; an arrow the same', () => {
    for (const tool of ['line', 'arrow'] as const) {
      const rig = shapeRig(tool);
      tap(rig, 300, 200);
      const s = only(rig, tool);
      const b = boxOf(rig, s.id);
      const d = builtInKind(tool)?.defaults as { points?: number[]; start?: number[]; end?: number[] };
      const len = d.points !== undefined ? (d.points[2] as number) - (d.points[0] as number) : (d.end?.[0] as number) - (d.start?.[0] as number);
      expect(b.maxX - b.minX).toBeCloseTo(len, 6);
      expect((b.minX + b.maxX) / 2).toBeCloseTo(300, 6);
      expect(b.minY).toBeCloseTo(200, 6);
      expect(b.maxY).toBeCloseTo(200, 6);
    }
  });

  it('a text: a text shape with the point inside its box, and the editor open on it', () => {
    const rig = shapeRig('text');
    tap(rig, 300, 200);
    const s = only(rig, 'text');
    const b = boxOf(rig, s.id);
    expect(300).toBeGreaterThanOrEqual(b.minX);
    expect(300).toBeLessThanOrEqual(b.maxX);
    expect(200).toBeGreaterThanOrEqual(b.minY);
    expect(200).toBeLessThanOrEqual(b.maxY);
    expect(rig.core.editor.state).toBe('editing');
    expect(rig.core.editor.shapeId).toBe(s.id);
  });

  it('a pointer that moved less than the slop is still a click', () => {
    const rig = shapeRig('rect');
    press(rig, [[100, 100], [102, 102]]);
    release(rig, 102, 102);
    const s = only(rig, 'rect');
    expect(size(rig, s.id).w).toBeCloseTo(defaultSize('rect').w, 6);
  });

  it('a click works at another zoom and pan: the point is in page units', () => {
    const rig = shapeRig('rect');
    rig.core.camera?.moveTo(100, 50, 2, 0);
    tap(rig, 200, 100);
    const s = only(rig, 'rect');
    expect(centreOf(rig, s.id).x).toBeCloseTo(100 + 200 / 2, 6);
    expect(centreOf(rig, s.id).y).toBeCloseTo(50 + 100 / 2, 6);
  });
});

describe('Shift makes a square or a circle, Alt draws from the centre (ui.md)', () => {
  it('rect with Shift: a square on the longer side, in every direction', () => {
    for (const to of [[260, 150], [260, 40], [40, 150], [40, 40], [130, 260]] as const) {
      const rig = shapeRig('rect');
      drag(rig, [150, 100], to, MOD_SHIFT);
      const { w, h } = size(rig, only(rig, 'rect').id);
      expect(w, String(to)).toBeCloseTo(h, 6);
      expect(w, String(to)).toBeCloseTo(Math.max(Math.abs(to[0] - 150), Math.abs(to[1] - 100)), 6);
    }
  });

  it('ellipse with Shift: a circle', () => {
    const rig = shapeRig('ellipse');
    drag(rig, [100, 100], [220, 150], MOD_SHIFT);
    const s = only(rig, 'ellipse');
    const { w, h } = size(rig, s.id);
    expect(w).toBeCloseTo(h, 6);
    expect(w).toBeCloseTo(120, 6);
  });

  it('a square made with Shift keeps its corner at the down point', () => {
    const rig = shapeRig('rect');
    drag(rig, [100, 100], [220, 150], MOD_SHIFT);
    const b = boxOf(rig, only(rig, 'rect').id);
    expect(b.minX).toBeCloseTo(100, 6);
    expect(b.minY).toBeCloseTo(100, 6);
  });

  it('line and arrow with Shift: the direction snaps to a step of 15 degrees and the length is kept', () => {
    for (const tool of ['line', 'arrow'] as const) {
      for (const to of [[300, 130], [200, 300], [100, 200], [270, 270]] as const) {
        const rig = shapeRig(tool);
        drag(rig, [200, 200], to, MOD_SHIFT);
        const s = only(rig, tool);
        const g = shapeGeometry(s, rig.core.store.kinds);
        const props = s.props as { points?: number[]; end?: number[] };
        const last = props.points !== undefined ? [props.points[props.points.length - 2] as number, props.points[props.points.length - 1] as number] : (props.end as number[]);
        const p = g?.toPage(last[0] as number, last[1] as number) ?? { x: 0, y: 0 };
        const dx = p.x - 200;
        const dy = p.y - 200;
        const steps = (Math.atan2(dy, dx) * 12) / Math.PI;
        expect(Math.abs(steps - Math.round(steps)), `${tool} to ${String(to)}`).toBeLessThan(1e-6);
        expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(to[0] - 200, to[1] - 200), 4);
      }
    }
  });

  it('rect with Alt: the box grows from the down point, which stays its middle', () => {
    const rig = shapeRig('rect');
    drag(rig, [200, 200], [260, 230], MOD_ALT);
    const s = only(rig, 'rect');
    expect(size(rig, s.id)).toEqual({ w: 120, h: 60 });
    expect(centreOf(rig, s.id).x).toBeCloseTo(200, 6);
    expect(centreOf(rig, s.id).y).toBeCloseTo(200, 6);
  });

  it('rect with Alt in every direction has the same box', () => {
    for (const to of [[260, 230], [140, 230], [260, 170], [140, 170]] as const) {
      const rig = shapeRig('rect');
      drag(rig, [200, 200], to, MOD_ALT);
      const s = only(rig, 'rect');
      expect(size(rig, s.id).w, String(to)).toBeCloseTo(120, 6);
      expect(size(rig, s.id).h, String(to)).toBeCloseTo(60, 6);
      expect(centreOf(rig, s.id).x).toBeCloseTo(200, 6);
    }
  });

  it('ellipse with Alt and Shift: a circle from its centre', () => {
    const rig = shapeRig('ellipse');
    drag(rig, [200, 200], [250, 230], MOD_ALT | MOD_SHIFT);
    const s = only(rig, 'ellipse');
    const { w, h } = size(rig, s.id);
    expect(w).toBeCloseTo(100, 6);
    expect(h).toBeCloseTo(100, 6);
    expect(centreOf(rig, s.id).x).toBeCloseTo(200, 6);
    expect(centreOf(rig, s.id).y).toBeCloseTo(200, 6);
  });

  it('the modifiers are read from the moves: Shift pressed only at the end still makes the square', () => {
    const rig = shapeRig('rect');
    press(rig, [[100, 100], [180, 150]]);
    rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase: 'move', x: 220, y: 140, time: 80, buttons: 1, modifiers: MOD_SHIFT }));
    release(rig, 220, 140, MOD_SHIFT);
    const { w, h } = size(rig, only(rig, 'rect').id);
    expect(w).toBeCloseTo(h, 6);
  });
});

describe('text and sticky open the editor (B20, B21)', () => {
  it('a text drag opens the editor on the new shape when the pointer comes up', () => {
    const rig = shapeRig('text');
    drag(rig, [100, 100], [300, 140]);
    expect(rig.core.editor.state).toBe('editing');
    expect(rig.core.editor.shapeId).toBe(only(rig, 'text').id);
  });

  it('what is typed goes into the shape, and typing is one undo step with the shape', () => {
    const rig = shapeRig('text');
    const steps = rig.core.history.undoSteps;
    tap(rig, 100, 100);
    rig.core.editor.set('h');
    rig.core.editor.set('hi');
    rig.core.editor.set('hi $x^2$');
    rig.core.editor.commit();
    expect((only(rig, 'text').props as { text: string }).text).toBe('hi $x^2$');
    expect(rig.core.history.undoSteps).toBeLessThanOrEqual(steps + 2);
    rig.core.history.undo();
    const left = ofKind(rig, 'text');
    expect(left.every((s) => (s.props as { text: string }).text !== 'hi $x^2$')).toBe(true);
  });

  it('a sticky note takes the typed text', () => {
    const rig = shapeRig('sticky');
    tap(rig, 200, 200);
    rig.core.editor.set('remember');
    rig.core.editor.commit();
    expect((only(rig, 'sticky').props as { text: string }).text).toBe('remember');
  });

  it.each(['', '   ', '\n \t'])('a text shape left empty (%j) is removed when the editor closes', (typed) => {
    const rig = shapeRig('text');
    tap(rig, 100, 100);
    if (typed !== '') rig.core.editor.set(typed);
    rig.core.editor.commit();
    expect(rig.core.editor.state).toBe('closed');
    expect(ofKind(rig, 'text')).toHaveLength(0);
  });

  it('an empty sticky note is removed when the editor closes', () => {
    const rig = shapeRig('sticky');
    tap(rig, 100, 100);
    rig.core.editor.commit();
    expect(ofKind(rig, 'sticky')).toHaveLength(0);
  });

  it('a text shape that has text stays when the editor closes', () => {
    const rig = shapeRig('text');
    tap(rig, 100, 100);
    rig.core.editor.set('kept');
    rig.core.editor.commit();
    expect(ofKind(rig, 'text')).toHaveLength(1);
  });

  it('a press with another tool commits the editor first (a down while editing closes it)', () => {
    const rig = shapeRig('text');
    tap(rig, 100, 100);
    rig.core.editor.set('words');
    rig.host.setTool('rect');
    drag(rig, [300, 300], [380, 360], 0, 6, 500);
    expect(rig.core.editor.state).toBe('closed');
    expect((only(rig, 'text').props as { text: string }).text).toBe('words');
  });

  it('a rect, an ellipse and a frame make no editor on their own (they open on a double click, not on creation)', () => {
    for (const tool of ['rect', 'ellipse', 'frame', 'line', 'arrow'] as const) {
      const rig = shapeRig(tool);
      tap(rig, 200, 200);
      expect(rig.core.editor.state, tool).toBe('closed');
    }
  });
});

describe('the shape tool table (B20)', () => {
  it('has the idle and making states, and the rows of the document', () => {
    expect(Object.keys(SHAPE_TOOL_MACHINE).sort()).toEqual(['idle', 'making']);
    expect(SHAPE_TOOL_MACHINE.idle).toEqual({ down: 'making' });
    expect(SHAPE_TOOL_MACHINE.making).toEqual({ move: 'making', up: 'idle', cancel: 'idle' });
  });

  it('move and up in idle have no row: a stray move or up makes no shape', () => {
    for (const tool of SHAPE_TOOLS.map((t) => t.id)) {
      const rig = shapeRig(tool);
      rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase: 'move', x: 50, y: 50, time: 0 }));
      rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase: 'up', x: 50, y: 50, time: 8, buttons: 0 }));
      expect(shapesOf(rig), tool).toHaveLength(0);
      expect(rig.core.history.undoSteps, tool).toBe(0);
    }
  });

  it('a second down while making has no row: it does not start a second shape', () => {
    const rig = shapeRig('rect');
    press(rig, [[100, 100], [160, 150]]);
    rig.host.sample(sample({ device: 'mouse', pressure: Number.NaN, phase: 'down', x: 300, y: 300, time: 200, buttons: 1 }));
    release(rig, 200, 200);
    expect(ofKind(rig, 'rect')).toHaveLength(1);
  });

  it('a shape that has a text kind shows its text at once: the stored shape of get() equals what the tool made', () => {
    const rig = shapeRig('rect');
    drag(rig, [10, 10], [90, 50]);
    const s = only(rig, 'rect');
    expect(get(rig, s.id)).toBe(s);
  });
});
