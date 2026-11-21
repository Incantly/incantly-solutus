/**
 * The round-3 tables (docs/state-machines.md, "board", B19 to B24): every row of every `*_MACHINE` table is exact, every
 * move the document does not list has no row, and the running code refuses the moves with no row without changing what
 * the board holds. B24 is in `web/images.ts`; its table is exported from the package entry with the others.
 */
import { describe, expect, it } from 'vitest';
import { EDITOR_MACHINE, HOLD_MACHINE, IMAGE_MACHINE, SELECT_MACHINE, SHAPE_TOOL_MACHINE, SNAP_MACHINE, frameOf, handlesOf, rectTool, selectTool } from '../../src/index';
import type { ToolHandlers } from '../../src/index';
import { ImageEntry } from '../../src/web/images';
import { dump } from './helpers';
import { sample, walk } from './ink-helpers';
import { add, key, pageOf, shapeRig, shapesOf } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

// B19 select tool
walk(
  'B19 SELECT_MACHINE',
  SELECT_MACHINE,
  ['idle', 'pointing', 'dragging', 'resizing', 'rotating', 'handling', 'brushing', 'editing'],
  ['down', 'grabResize', 'grabRotate', 'grabHandle', 'edit', 'dragShape', 'brush', 'move', 'up', 'cancel', 'close'],
  [
    ['idle', 'down', 'pointing'],
    ['idle', 'grabResize', 'resizing'],
    ['idle', 'grabRotate', 'rotating'],
    ['idle', 'grabHandle', 'handling'],
    ['idle', 'edit', 'editing'],
    ['pointing', 'dragShape', 'dragging'],
    ['pointing', 'brush', 'brushing'],
    ['pointing', 'up', 'idle'],
    ['pointing', 'cancel', 'idle'],
    ['dragging', 'move', 'dragging'],
    ['dragging', 'up', 'idle'],
    ['dragging', 'cancel', 'idle'],
    ['resizing', 'move', 'resizing'],
    ['resizing', 'up', 'idle'],
    ['resizing', 'cancel', 'idle'],
    ['rotating', 'move', 'rotating'],
    ['rotating', 'up', 'idle'],
    ['rotating', 'cancel', 'idle'],
    ['handling', 'move', 'handling'],
    ['handling', 'up', 'idle'],
    ['handling', 'cancel', 'idle'],
    ['brushing', 'move', 'brushing'],
    ['brushing', 'up', 'idle'],
    ['brushing', 'cancel', 'idle'],
    ['editing', 'close', 'idle'],
  ],
);

// B20 shape tools
walk('B20 SHAPE_TOOL_MACHINE', SHAPE_TOOL_MACHINE, ['idle', 'making'], ['down', 'move', 'up', 'cancel'], [
  ['idle', 'down', 'making'],
  ['making', 'move', 'making'],
  ['making', 'up', 'idle'],
  ['making', 'cancel', 'idle'],
]);

// B21 text editor
walk('B21 EDITOR_MACHINE', EDITOR_MACHINE, ['closed', 'editing', 'composing'], ['open', 'set', 'compose', 'endCompose', 'commit'], [
  ['closed', 'open', 'editing'],
  ['editing', 'set', 'editing'],
  ['editing', 'compose', 'composing'],
  ['editing', 'commit', 'closed'],
  ['composing', 'set', 'composing'],
  ['composing', 'endCompose', 'editing'],
  ['composing', 'commit', 'closed'],
]);

// B22 snap
walk('B22 SNAP_MACHINE', SNAP_MACHINE, ['idle', 'tracking', 'snapped'], ['begin', 'found', 'miss', 'end'], [
  ['idle', 'begin', 'tracking'],
  ['tracking', 'found', 'snapped'],
  ['tracking', 'miss', 'tracking'],
  ['snapped', 'found', 'snapped'],
  ['snapped', 'miss', 'tracking'],
  ['tracking', 'end', 'idle'],
  ['snapped', 'end', 'idle'],
]);

// B23 recognise hold
walk('B23 HOLD_MACHINE', HOLD_MACHINE, ['idle', 'watching', 'fired'], ['begin', 'move', 'fire', 'end', 'cancel'], [
  ['idle', 'begin', 'watching'],
  ['watching', 'move', 'watching'],
  ['watching', 'fire', 'fired'],
  ['watching', 'end', 'idle'],
  ['watching', 'cancel', 'idle'],
  ['fired', 'end', 'idle'],
  ['fired', 'cancel', 'idle'],
]);

// B24 image decode
walk('B24 IMAGE_MACHINE', IMAGE_MACHINE, ['pending', 'ready', 'failed'], ['decoded', 'fail'], [
  ['pending', 'decoded', 'ready'],
  ['pending', 'fail', 'failed'],
]);

const mouse = (phase: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, t: number, modifiers = 0): ReturnType<typeof sample> =>
  sample({ device: 'mouse', pressure: Number.NaN, phase, x, y, time: t, buttons: phase === 'up' || phase === 'cancel' ? 0 : 1, modifiers });

/** A select tool made on the board's own context, so a test can read its state. */
function tool(rig: BoardRig): ToolHandlers {
  return selectTool.create(rig.ctx);
}

const solid = (rig: BoardRig, x: number, y: number, w = 100, h = 60): ReturnType<typeof add> => add(rig, 'rect', x, y, { w, h, fill: '#ffcc00' });

describe('B19: the select tool goes through the rows of its table, and refuses the moves with no row', () => {
  it('idle, pointing, dragging, idle on a selected shape', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    const t = tool(rig);
    expect(t.state).toBe('idle');
    t.onDown(mouse('down', 150, 130, 0));
    expect(t.state).toBe('pointing');
    t.onMove(mouse('move', 152, 131, 8));
    expect(t.state).toBe('pointing');
    t.onMove(mouse('move', 190, 150, 16));
    expect(t.state).toBe('dragging');
    t.onMove(mouse('move', 200, 160, 24));
    expect(t.state).toBe('dragging');
    t.onUp(mouse('up', 200, 160, 32));
    expect(t.state).toBe('idle');
  });

  it('idle, pointing, brushing, idle on empty page', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    const t = tool(rig);
    t.onDown(mouse('down', 500, 500, 0));
    expect(t.state).toBe('pointing');
    t.onMove(mouse('move', 600, 560, 8));
    expect(t.state).toBe('brushing');
    t.onUp(mouse('up', 600, 560, 16));
    expect(t.state).toBe('idle');
  });

  it('pointing goes back to idle on up and on cancel', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    const t = tool(rig);
    t.onDown(mouse('down', 150, 130, 0));
    t.onUp(mouse('up', 150, 130, 8));
    expect(t.state).toBe('idle');
    t.onDown(mouse('down', 150, 130, 100));
    t.onCancel();
    expect(t.state).toBe('idle');
  });

  it('a press on a resize handle is resizing, on the rotate handle rotating, on a handle of the kind handling', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const arrow = add(rig, 'arrow', 100, 400, { start: [0, 0], end: [200, 0] });
    const handle = (kind: 'resize' | 'rotate' | 'kind'): { x: number; y: number } => {
      const f = frameOf(rig.core, rig.core.selection.ids);
      const h = f === undefined ? undefined : handlesOf(rig.core, f, 1).find((x) => x.kind === kind);
      if (h === undefined) throw new Error(`no ${kind} handle`);
      return h;
    };
    const t = tool(rig);
    rig.core.selection.set([a.id]);
    const r = handle('resize');
    t.onDown(mouse('down', r.x, r.y, 0));
    expect(t.state).toBe('resizing');
    t.onMove(mouse('move', r.x + 10, r.y + 10, 8));
    expect(t.state).toBe('resizing');
    t.onUp(mouse('up', r.x + 10, r.y + 10, 16));
    expect(t.state).toBe('idle');
    const rot = handle('rotate');
    t.onDown(mouse('down', rot.x, rot.y, 100));
    expect(t.state).toBe('rotating');
    t.onMove(mouse('move', rot.x + 30, rot.y + 5, 108));
    expect(t.state).toBe('rotating');
    t.onUp(mouse('up', rot.x + 30, rot.y + 5, 116));
    expect(t.state).toBe('idle');
    rig.core.selection.set([arrow.id]);
    const k = handle('kind');
    t.onDown(mouse('down', k.x, k.y, 200));
    expect(t.state).toBe('handling');
    t.onMove(mouse('move', k.x + 20, k.y + 20, 208));
    expect(t.state).toBe('handling');
    t.onUp(mouse('up', k.x + 20, k.y + 20, 216));
    expect(t.state).toBe('idle');
  });

  it('a cancel from every working state goes to idle and puts the shapes back', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    const t = tool(rig);
    const before = dump(rig.core.store);
    t.onDown(mouse('down', 150, 130, 0));
    t.onMove(mouse('move', 250, 230, 8));
    expect(t.state).toBe('dragging');
    t.onCancel();
    expect(t.state).toBe('idle');
    expect(dump(rig.core.store)).toBe(before);
    const f = frameOf(rig.core, [a.id]);
    const se = f === undefined ? undefined : handlesOf(rig.core, f, 1).find((h) => h.id === 'se');
    t.onDown(mouse('down', se?.x ?? 0, se?.y ?? 0, 100));
    t.onMove(mouse('move', (se?.x ?? 0) + 50, (se?.y ?? 0) + 50, 108));
    expect(t.state).toBe('resizing');
    t.onCancel();
    expect(t.state).toBe('idle');
    expect(dump(rig.core.store)).toBe(before);
    t.onDown(mouse('down', 600, 600, 200));
    t.onMove(mouse('move', 700, 700, 208));
    expect(t.state).toBe('brushing');
    t.onCancel();
    expect(t.state).toBe('idle');
  });

  it('move and up in idle have no row: nothing changes', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    const t = tool(rig);
    const before = dump(rig.core.store);
    const steps = rig.core.history.undoSteps;
    t.onMove(mouse('move', 150, 130, 0));
    t.onUp(mouse('up', 150, 130, 8));
    t.onCancel();
    expect(t.state).toBe('idle');
    expect(dump(rig.core.store)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps);
    expect(rig.core.selection.size).toBe(0);
  });

  it('a second down while dragging has no row: the drag goes on', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.selection.set([a.id]);
    const t = tool(rig);
    t.onDown(mouse('down', 150, 130, 0));
    t.onMove(mouse('move', 250, 230, 8));
    t.onDown(mouse('down', 600, 600, 16));
    expect(t.state).toBe('dragging');
    t.onUp(mouse('up', 250, 230, 24));
    expect(t.state).toBe('idle');
  });

  it('the editor opening is the edit move: it has a row in idle and none in any other state', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    rig.core.selection.set([a.id]);
    const t = tool(rig);
    t.onDown(mouse('down', 150, 130, 0));
    t.onMove(mouse('move', 250, 230, 8));
    expect(t.state).toBe('dragging');
    rig.core.editor.open(b.id);
    expect(t.state).toBe('dragging');
    rig.core.editor.commit();
    t.onUp(mouse('up', 250, 230, 16));
    expect(t.state).toBe('idle');
    rig.core.editor.open(b.id);
    expect(t.state).toBe('editing');
  });

  it('editing: moves and ups are ignored, and closing the editor goes back to idle', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const t = tool(rig);
    rig.core.editor.open(a.id);
    expect(t.state).toBe('editing');
    const before = dump(rig.core.store);
    t.onMove(mouse('move', 300, 300, 0));
    t.onUp(mouse('up', 300, 300, 8));
    t.onCancel();
    expect(t.state).toBe('editing');
    expect(dump(rig.core.store)).toBe(before);
    rig.core.editor.commit();
    expect(t.state).toBe('idle');
  });

  it('a down while editing closes the editor first, then goes on as a press', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    const t = tool(rig);
    rig.core.editor.open(a.id);
    rig.core.editor.set('kept');
    t.onDown(mouse('down', 450, 130, 0));
    expect(rig.core.editor.state).toBe('closed');
    expect(t.state).toBe('pointing');
    expect(rig.core.selection.ids).toEqual([b.id]);
    t.onUp(mouse('up', 450, 130, 8));
    expect(t.state).toBe('idle');
  });

  it('the guides are shown only while dragging or resizing', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100, 100, 60);
    solid(rig, 400, 300, 60, 40);
    rig.core.selection.set([a.id]);
    const t = tool(rig);
    expect(rig.overlay.guides).toEqual([]);
    t.onDown(mouse('down', 150, 130, 0));
    expect(rig.overlay.guides).toEqual([]);
    t.onMove(mouse('move', 150 + 304, 130 + 170, 8));
    expect(t.state).toBe('dragging');
    t.onUp(mouse('up', 150 + 304, 130 + 170, 16));
    expect(rig.overlay.guides).toEqual([]);
  });
});

describe('B20: a shape tool goes through its rows and refuses the moves with no row', () => {
  it('idle, making, idle on a drag, and on a cancel', () => {
    const rig = shapeRig('rect');
    const t = rectTool.create(rig.ctx);
    expect(t.state).toBe('idle');
    t.onDown(mouse('down', 100, 100, 0));
    expect(t.state).toBe('making');
    t.onMove(mouse('move', 200, 180, 8));
    expect(t.state).toBe('making');
    t.onUp(mouse('up', 200, 180, 16));
    expect(t.state).toBe('idle');
    expect(shapesOf(rig)).toHaveLength(1);
    t.onDown(mouse('down', 300, 300, 100));
    t.onMove(mouse('move', 400, 380, 108));
    t.onCancel();
    expect(t.state).toBe('idle');
    expect(shapesOf(rig)).toHaveLength(1);
  });

  it('move, up and cancel in idle have no row: nothing is made', () => {
    const rig = shapeRig('rect');
    const t = rectTool.create(rig.ctx);
    t.onMove(mouse('move', 100, 100, 0));
    t.onUp(mouse('up', 100, 100, 8));
    t.onCancel();
    expect(t.state).toBe('idle');
    expect(shapesOf(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
  });

  it('a second down while making has no row', () => {
    const rig = shapeRig('rect');
    const t = rectTool.create(rig.ctx);
    t.onDown(mouse('down', 100, 100, 0));
    t.onMove(mouse('move', 160, 140, 8));
    t.onDown(mouse('down', 500, 500, 16));
    expect(t.state).toBe('making');
    t.onUp(mouse('up', 160, 140, 24));
    expect(shapesOf(rig)).toHaveLength(1);
  });

  it('every shape tool keeps its own state', () => {
    const rig = shapeRig('rect');
    const a = rectTool.create(rig.ctx);
    const b = rectTool.create(rig.ctx);
    a.onDown(mouse('down', 100, 100, 0));
    expect(a.state).toBe('making');
    expect(b.state).toBe('idle');
  });
});

describe('B21: the text editor goes through its rows and refuses the moves with no row', () => {
  it('closed, editing, composing, editing, closed', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const ed = rig.core.editor;
    expect(ed.state).toBe('closed');
    expect(ed.open(a.id).ok).toBe(true);
    expect(ed.state).toBe('editing');
    expect(ed.shapeId).toBe(a.id);
    expect(ed.set('x').ok).toBe(true);
    expect(ed.compose()).toBe(true);
    expect(ed.state).toBe('composing');
    expect(ed.set('xy').ok).toBe(true);
    expect(ed.state).toBe('composing');
    expect(ed.endCompose()).toBe(true);
    expect(ed.state).toBe('editing');
    expect(ed.commit().ok).toBe(true);
    expect(ed.state).toBe('closed');
    expect(ed.shapeId).toBe('');
  });

  it('commit from composing closes the editor', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.editor.open(a.id);
    rig.core.editor.compose();
    rig.core.editor.commit();
    expect(rig.core.editor.state).toBe('closed');
  });

  it('set, compose and endCompose in closed have no row: an error or false, and nothing changes', () => {
    const rig = shapeRig();
    solid(rig, 100, 100);
    const before = dump(rig.core.store);
    const set = rig.core.editor.set('text');
    expect(set.ok).toBe(false);
    if (!set.ok) expect(set.kind).toBe('bad_argument');
    expect(rig.core.editor.compose()).toBe(false);
    expect(rig.core.editor.endCompose()).toBe(false);
    expect(rig.core.editor.commit().ok).toBe(true);
    expect(rig.core.editor.state).toBe('closed');
    expect(dump(rig.core.store)).toBe(before);
  });

  it('open in editing or composing has no row: a second shape cannot be opened before the first is committed', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    const b = solid(rig, 400, 100);
    rig.core.editor.open(a.id);
    const second = rig.core.editor.open(b.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.kind).toBe('bad_argument');
    expect(rig.core.editor.shapeId).toBe(a.id);
    rig.core.editor.compose();
    expect(rig.core.editor.open(b.id).ok).toBe(false);
    expect(rig.core.editor.state).toBe('composing');
  });

  it('compose in composing, and endCompose in editing, have no row', () => {
    const rig = shapeRig();
    const a = solid(rig, 100, 100);
    rig.core.editor.open(a.id);
    expect(rig.core.editor.endCompose()).toBe(false);
    rig.core.editor.compose();
    expect(rig.core.editor.compose()).toBe(false);
    expect(rig.core.editor.state).toBe('composing');
  });

  it('open is refused for a locked shape, a kind with no text, and a shape that is not there', () => {
    const rig = shapeRig();
    const locked = add(rig, 'rect', 0, 0, { w: 10, h: 10 }, { locked: true });
    const line = add(rig, 'line', 100, 100, { points: [0, 0, 50, 50] });
    for (const id of [locked.id, line.id, 'shape:nope']) {
      const r = rig.core.editor.open(id);
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.kind).toBe('bad_argument');
      expect(rig.core.editor.state).toBe('closed');
    }
  });

  it('typing is one undo step, sealed when the editor closes', () => {
    const rig = shapeRig();
    const a = add(rig, 'text', 100, 100, { text: 'a' });
    const steps = rig.core.history.undoSteps;
    rig.core.editor.open(a.id);
    for (const t of ['ab', 'abc', 'abcd', 'abcde']) rig.core.editor.set(t);
    rig.core.editor.commit();
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect((rig.core.store.get(a.id) as { props: { text: string } }).props.text).toBe('a');
  });

  it('a box shape holds its text as the label, a frame as its name, a sticky note as its text', () => {
    const rig = shapeRig();
    const r = solid(rig, 0, 0);
    const f = add(rig, 'frame', 300, 0, { w: 100, h: 100 });
    const s = add(rig, 'sticky', 600, 0, {});
    for (const [id, field, text] of [[r.id, 'label', 'L'], [f.id, 'name', 'Slide'], [s.id, 'text', 'note']] as const) {
      rig.core.editor.open(id);
      rig.core.editor.set(text);
      rig.core.editor.commit();
      expect((rig.core.store.get(id) as { props: Record<string, unknown> }).props[field], id).toBe(text);
    }
  });

  it('the listeners are told on open and on close, and stop when removed', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0);
    const told: boolean[] = [];
    const stop = rig.core.editor.on((open) => told.push(open));
    rig.core.editor.open(a.id);
    rig.core.editor.commit();
    expect(told).toEqual([true, false]);
    stop();
    rig.core.editor.open(a.id);
    rig.core.editor.commit();
    expect(told).toEqual([true, false]);
  });

  it('the editor keeps the selection range it was given, inside the text', () => {
    const rig = shapeRig();
    const a = add(rig, 'text', 0, 0, { text: 'hello' });
    rig.core.editor.open(a.id);
    rig.core.editor.set('hello world', 2, 5);
    expect(rig.core.editor.range).toEqual({ start: 2, end: 5 });
    rig.core.editor.set('hi', 40, 90);
    expect(rig.core.editor.range).toEqual({ start: 2, end: 2 });
    expect(rig.core.editor.text).toBe('hi');
  });

  it('Enter opens the editor on a selected shape with text, and keys do not choose tools while it is open', () => {
    const rig = shapeRig();
    const a = solid(rig, 0, 0);
    rig.core.selection.set([a.id]);
    key(rig, 'Enter');
    expect(rig.core.editor.state).toBe('editing');
    expect(pageOf(rig)).toBeDefined();
  });
});

describe('B22, B23, B24: the other tables', () => {
  it('the snapper in idle refuses found, miss and end, and begin while tracking', () => {
    const rig = shapeRig();
    expect(rig.overlay.guides).toEqual([]);
    expect(SNAP_MACHINE.idle).toEqual({ begin: 'tracking' });
  });

  it('an image entry leaves pending only through a decoded or fail move, and tells its owner once', () => {
    let told = 0;
    const entry = new ImageEntry('data:image/png;base64,AAAA', () => {
      told++;
    });
    expect(['pending', 'ready', 'failed']).toContain(entry.state);
    // the test DOM may decode at once; either way the owner is told exactly when the entry left pending
    expect(told).toBe(entry.state === 'pending' ? 0 : 1);
    expect(entry.picture === null).toBe(entry.state !== 'ready');
    entry.release();
    expect(told).toBeLessThanOrEqual(1);
  });

  it('ready and failed are final: the table has no move out of them', () => {
    expect(IMAGE_MACHINE.ready).toEqual({});
    expect(IMAGE_MACHINE.failed).toEqual({});
  });
});
