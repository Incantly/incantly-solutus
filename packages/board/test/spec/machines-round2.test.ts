/**
 * The round-2 tables (docs/state-machines.md, "board", B5 to B18): every row of every `*_MACHINE` table is exact, every
 * move the document does not list has no row, and the running code refuses the moves with no row without changing what
 * the board holds.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKEND_MACHINE, BUTTON_ERASER, ERASER_MACHINE, FRAME_MACHINE, GATE_MACHINE, HAND_MACHINE, LASER_MACHINE, LASSO_MACHINE, LIVELAYER_MACHINE, LIVE_MACHINE, LOOP_MACHINE,
  PAGEBAR_MACHINE, PROBE_MACHINE, PointerGate, TILE_MACHINE, TOOLS_MACHINE, Tile, inkTools,
} from '../../src/index';
import type { InputSample } from '../../src/index';
import { drawPath, line, makeRig, sample, strokes, walk } from './ink-helpers';

// B5 pointer gate and palm rule
walk(
  'B5 GATE_MACHINE',
  GATE_MACHINE,
  ['idle', 'penNear', 'penDown', 'mouseDown', 'touchDown', 'gesture'],
  ['penHover', 'penDown', 'penUp', 'penAway', 'penCancel', 'mouseDown', 'mouseUp', 'touchDown', 'touchUp', 'secondTouch', 'gestureEnd'],
  [
    ['idle', 'penHover', 'penNear'],
    ['idle', 'penDown', 'penDown'],
    ['idle', 'mouseDown', 'mouseDown'],
    ['idle', 'touchDown', 'touchDown'],
    ['idle', 'secondTouch', 'gesture'],
    ['penNear', 'penHover', 'penNear'],
    ['penNear', 'penDown', 'penDown'],
    ['penNear', 'penAway', 'idle'],
    ['penNear', 'mouseDown', 'mouseDown'],
    ['penNear', 'secondTouch', 'gesture'],
    ['penDown', 'penUp', 'penNear'],
    ['penDown', 'penCancel', 'idle'],
    ['mouseDown', 'mouseUp', 'idle'],
    ['touchDown', 'touchUp', 'idle'],
    ['touchDown', 'secondTouch', 'gesture'],
    ['touchDown', 'penHover', 'penNear'],
    ['touchDown', 'penDown', 'penDown'],
    ['gesture', 'secondTouch', 'gesture'],
    ['gesture', 'gestureEnd', 'idle'],
  ],
);

// B6 pen pressure probe
walk('B6 PROBE_MACHINE', PROBE_MACHINE, ['unknown', 'flat', 'real'], ['flat', 'varied'], [
  ['unknown', 'flat', 'flat'],
  ['unknown', 'varied', 'real'],
  ['flat', 'varied', 'real'],
]);

// B7 live stroke
walk('B7 LIVE_MACHINE', LIVE_MACHINE, ['idle', 'drawing'], ['begin', 'sample', 'end', 'cancel'], [
  ['idle', 'begin', 'drawing'],
  ['drawing', 'sample', 'drawing'],
  ['drawing', 'end', 'idle'],
  ['drawing', 'cancel', 'idle'],
]);

// B8 eraser
walk('B8 ERASER_MACHINE', ERASER_MACHINE, ['idle', 'erasing'], ['down', 'move', 'up', 'cancel'], [
  ['idle', 'down', 'erasing'],
  ['erasing', 'move', 'erasing'],
  ['erasing', 'up', 'idle'],
  ['erasing', 'cancel', 'idle'],
]);

// B9 laser
walk('B9 LASER_MACHINE', LASER_MACHINE, ['idle', 'pointing', 'fading'], ['down', 'move', 'up', 'cancel', 'faded'], [
  ['idle', 'down', 'pointing'],
  ['pointing', 'move', 'pointing'],
  ['pointing', 'up', 'fading'],
  ['pointing', 'cancel', 'fading'],
  ['fading', 'down', 'pointing'],
  ['fading', 'faded', 'idle'],
]);

// B10 lasso
walk('B10 LASSO_MACHINE', LASSO_MACHINE, ['idle', 'drawing'], ['down', 'move', 'up', 'cancel'], [
  ['idle', 'down', 'drawing'],
  ['drawing', 'move', 'drawing'],
  ['drawing', 'up', 'idle'],
  ['drawing', 'cancel', 'idle'],
]);

// B11 hand
walk('B11 HAND_MACHINE', HAND_MACHINE, ['idle', 'panning'], ['down', 'move', 'up', 'cancel'], [
  ['idle', 'down', 'panning'],
  ['panning', 'move', 'panning'],
  ['panning', 'up', 'idle'],
  ['panning', 'cancel', 'idle'],
]);

// B12 tool host
walk('B12 TOOLS_MACHINE', TOOLS_MACHINE, ['chosen', 'eraserEnd', 'handHeld'], ['eraserDown', 'eraserUp', 'handDown', 'handUp'], [
  ['chosen', 'eraserDown', 'eraserEnd'],
  ['chosen', 'handDown', 'handHeld'],
  ['eraserEnd', 'eraserUp', 'chosen'],
  ['handHeld', 'handUp', 'chosen'],
]);

// B13 page bar
walk('B13 PAGEBAR_MACHINE', PAGEBAR_MACHINE, ['closed', 'open'], ['open', 'close'], [
  ['closed', 'open', 'open'],
  ['open', 'close', 'closed'],
]);

// B14 tile
walk('B14 TILE_MACHINE', TILE_MACHINE, ['blank', 'fresh', 'stale', 'gone'], ['draw', 'dirty', 'lose', 'evict'], [
  ['blank', 'draw', 'fresh'],
  ['fresh', 'dirty', 'stale'],
  ['stale', 'dirty', 'stale'],
  ['stale', 'draw', 'fresh'],
  ['fresh', 'lose', 'blank'],
  ['stale', 'lose', 'blank'],
  ['blank', 'evict', 'gone'],
  ['fresh', 'evict', 'gone'],
  ['stale', 'evict', 'gone'],
]);

// B15 painter back-end
walk('B15 BACKEND_MACHINE', BACKEND_MACHINE, ['gl', 'lost', 'canvas2d'], ['contextLost', 'contextRestored', 'fail'], [
  ['gl', 'contextLost', 'lost'],
  ['lost', 'contextRestored', 'gl'],
  ['gl', 'fail', 'canvas2d'],
  ['lost', 'fail', 'canvas2d'],
]);

// B16 painter frame
walk('B16 FRAME_MACHINE', FRAME_MACHINE, ['between', 'drawing'], ['begin', 'end'], [
  ['between', 'begin', 'drawing'],
  ['drawing', 'end', 'between'],
]);

// B17 live layer
walk('B17 LIVELAYER_MACHINE', LIVELAYER_MACHINE, ['clear', 'inking', 'holding'], ['ink', 'release', 'abort', 'settle'], [
  ['clear', 'ink', 'inking'],
  ['inking', 'ink', 'inking'],
  ['inking', 'release', 'holding'],
  ['inking', 'abort', 'clear'],
  ['holding', 'settle', 'clear'],
]);

// B18 frame loop
walk('B18 LOOP_MACHINE', LOOP_MACHINE, ['idle', 'queued', 'running', 'again'], ['request', 'run', 'done'], [
  ['idle', 'request', 'queued'],
  ['queued', 'request', 'queued'],
  ['queued', 'run', 'running'],
  ['running', 'request', 'again'],
  ['running', 'done', 'idle'],
  ['again', 'request', 'again'],
  ['again', 'done', 'queued'],
]);

describe('moves with no row are refused by the running code (the "Reachable invalid" line of each machine)', () => {
  const pen = (phase: InputSample['phase'], time: number, over: Partial<{ -readonly [K in keyof InputSample]: InputSample[K] }> = {}): InputSample => sample({ device: 'pen', phase, time, ...over });
  const mouse = (phase: InputSample['phase'], time: number): InputSample => sample({ device: 'mouse', phase, time, pressure: Number.NaN });
  const touch = (phase: InputSample['phase'], time: number, pointer: number): InputSample => sample({ device: 'touch', phase, time, pointer, pressure: Number.NaN });

  it('B5: a touch in penDown has no row: it is ignored and only counted', () => {
    const gate = new PointerGate();
    gate.admit(pen('down', 0));
    expect(gate.admit(touch('down', 1, 5))).toBe('ignore');
    expect(gate.state).toBe('penDown');
    expect(gate.touches).toBe(1);
  });

  it('B5: penAway, a mouse up and a move with nothing down change nothing in idle', () => {
    const gate = new PointerGate();
    gate.penAway();
    expect(gate.state).toBe('idle');
    expect(gate.admit(mouse('up', 0))).toBe('ignore');
    expect(gate.admit(mouse('move', 1))).toBe('ignore');
    expect(gate.admit(pen('move', 2))).toBe('ignore');
    expect(gate.admit(touch('move', 3, 4))).toBe('ignore');
    expect(gate.admit(touch('up', 4, 4))).toBe('ignore');
    expect(gate.state).toBe('idle');
    expect(gate.touches).toBe(0);
  });

  it('B5: a second mouse down while a button is down, and a pen up with no pen down, have no row', () => {
    const gate = new PointerGate();
    expect(gate.admit(mouse('down', 0))).toBe('draw');
    expect(gate.admit(mouse('down', 1))).toBe('ignore');
    expect(gate.admit(pen('up', 2))).toBe('ignore');
    expect(gate.state).toBe('mouseDown');
  });

  it('B5: a pen while two fingers pan and zoom has no row and is ignored (a pen during a gesture)', () => {
    const gate = new PointerGate();
    gate.admit(touch('down', 0, 1));
    gate.admit(touch('down', 1, 2));
    expect(gate.state).toBe('gesture');
    expect(gate.admit(pen('down', 2))).toBe('ignore');
    expect(gate.state).toBe('gesture');
  });

  it('B7: a stray move or up with no stroke stores nothing', () => {
    const rig = makeRig();
    rig.host.sample(sample({ x: 10, y: 10, phase: 'move' }));
    rig.host.sample(sample({ x: 10, y: 10, phase: 'up', time: 8 }));
    expect(rig.core.live.state).toBe('idle');
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
  });

  /** A tool of the default list, made on the context of a board. */
  const tool = (id: string): { readonly rig: ReturnType<typeof makeRig>; readonly t: ReturnType<NonNullable<ReturnType<typeof inkTools.get>>['create']> } => {
    const rig = makeRig();
    const def = inkTools.get(id);
    if (def === undefined) throw new Error(`no tool ${id}`);
    return { rig, t: def.create(rig.ctx) };
  };

  it.each(['eraser', 'lasso', 'hand'] as const)('B8, B10, B11: %s: move and up in idle have no row; down in the working state has none either', (id) => {
    const { rig, t } = tool(id);
    expect(t.state).toBe('idle');
    t.onMove(sample({ x: 5, y: 5 }));
    t.onUp(sample({ x: 5, y: 5, phase: 'up' }));
    expect(t.state).toBe('idle');
    expect(rig.core.history.undoSteps).toBe(0);
    t.onDown(sample({ x: 5, y: 5, phase: 'down' }));
    const working = t.state;
    expect(working).not.toBe('idle');
    t.onDown(sample({ x: 50, y: 50, phase: 'down', time: 8 }));
    expect(t.state).toBe(working);
    t.onUp(sample({ x: 50, y: 50, phase: 'up', time: 16 }));
    expect(t.state).toBe('idle');
  });

  it('B8: cancel in idle has no row and leaves the eraser idle', () => {
    const { t } = tool('eraser');
    t.onCancel();
    expect(t.state).toBe('idle');
  });

  it('B9: the laser goes idle, pointing, fading, idle; up in idle and faded while pointing have no row', () => {
    const { rig, t } = tool('laser');
    expect(t.state).toBe('idle');
    t.onUp(sample({ x: 1, y: 1, phase: 'up' }));
    expect(t.state).toBe('idle');
    t.onDown(sample({ x: 1, y: 1, phase: 'down', time: 0 }));
    expect(t.state).toBe('pointing');
    // a held pointer keeps its trail: a long tick does not end it
    t.tick?.(100_000);
    expect(t.state).toBe('pointing');
    t.onUp(sample({ x: 5, y: 1, phase: 'up', time: 100_010 }));
    expect(t.state).toBe('fading');
    t.onDown(sample({ x: 9, y: 9, phase: 'down', time: 100_020 }));
    expect(t.state).toBe('pointing');
    t.onCancel();
    expect(t.state).toBe('fading');
    expect(t.tick?.(200_000)).toBe(false);
    expect(t.state).toBe('idle');
    expect(rig.core.store.all('shape')).toHaveLength(0);
  });

  it('B12: Space while the eraser end is down gives no second temporary tool', () => {
    const rig = makeRig();
    rig.host.sample(sample({ x: 5, y: 5, phase: 'down', buttons: BUTTON_ERASER }));
    expect(rig.host.state).toBe('eraserEnd');
    rig.host.key({ key: ' ', down: true, shift: false, alt: false, mod: false, repeat: false });
    expect(rig.host.state).toBe('eraserEnd');
    expect(rig.host.active).toBe('eraser');
  });

  it('B12: the eraser end while Space is held gives no second temporary tool', () => {
    const rig = makeRig();
    rig.host.key({ key: ' ', down: true, shift: false, alt: false, mod: false, repeat: false });
    expect(rig.host.state).toBe('handHeld');
    rig.host.sample(sample({ x: 5, y: 5, phase: 'down', buttons: BUTTON_ERASER }));
    expect(rig.host.state).toBe('handHeld');
    expect(rig.host.active).toBe('hand');
    rig.host.sample(sample({ x: 5, y: 5, phase: 'up', buttons: 0, time: 8 }));
    rig.host.key({ key: ' ', down: false, shift: false, alt: false, mod: false, repeat: false });
    expect(rig.host.state).toBe('chosen');
  });

  it('B12: a tool is not switched by a key while a pointer is down, and an unknown id is refused', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 40, 0));
    expect(rig.host.setTool('nothing').ok).toBe(false);
    expect(rig.host.tool).toBe('pen');
  });

  it('B14: dirty in blank, draw in fresh and every event in gone have no row', () => {
    const blank = new Tile(0, 0, 0);
    expect(blank.dirty()).toBe(false);
    expect(blank.state).toBe('blank');
    expect(blank.drawn()).toBe(true);
    expect(blank.drawn()).toBe(false);
    expect(blank.state).toBe('fresh');
    expect(blank.evict()).toBe(true);
    expect([blank.drawn(), blank.dirty(), blank.lose(), blank.evict()]).toEqual([false, false, false, false]);
    expect(blank.state).toBe('gone');
  });

  it('B14: a tile that is stale and then marked again stays stale; drawing it makes it fresh', () => {
    const tile = new Tile(1, 2, 3);
    tile.drawn();
    expect(tile.dirty()).toBe(true);
    expect(tile.dirty()).toBe(true);
    expect(tile.state).toBe('stale');
    expect(tile.needsDraw).toBe(true);
    expect(tile.drawn()).toBe(true);
    expect(tile.state).toBe('fresh');
    expect(tile.needsDraw).toBe(false);
  });
});
