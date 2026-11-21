/**
 * The select tool (docs/state-machines.md B19): click and box select, move, resize with 8 handles, rotate, the kind's
 * own handles (an arrow's ends and bend, a line's points), snap guides, and the hand-off to the text editor. Every write
 * of a gesture goes through one `Gesture` (`core/edit.ts`, B25): one undo step when the pointer comes up, and a cancel
 * puts back every record any write changed, bindings included. Arrow bindings follow in the same transaction
 * (`core/bindings.ts`). No DOM, no timers.
 */
import { StateMachine } from '@incantly/kernel';
import { refusedMove } from '../errors';
import type { MachineTable } from '@incantly/kernel';
import { bindEnd, bindTargetAt, unbindEnd } from '../bindings';
import type { ArrowEnd } from '../bindings';
import { beginGesture, layoutBox, patchShapes, settleParents, turnShapes, withMembers } from '../edit';
import type { Gesture as EditGesture, ShapePatch } from '../edit';
import { shapeGeometry } from '../geometry';
import { MOD_ALT, MOD_SHIFT } from '../input';
import type { InputSample } from '../input';
import { rotateAbout, shift as shiftBox, wrapAngle } from '../math2d';
import { pickInBox, pickShape } from '../pick';
import { frameOf, handleAt, handlesOf } from '../selection-view';
import type { SelectionFrame } from '../selection-view';
import { expandGroups, selectionFor, shapeOf } from '../shapes';
import { GRID_UNITS, SNAP_PX, Snapper } from '../snap';
import { resizePatch, scalePatches } from '../transform';
import type { Bounds, ShapeRecord } from '../types';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

type SelectState = 'idle' | 'pointing' | 'dragging' | 'resizing' | 'rotating' | 'handling' | 'brushing' | 'editing';
type SelectEvent = 'down' | 'grabResize' | 'grabRotate' | 'grabHandle' | 'edit' | 'dragShape' | 'brush' | 'move' | 'up' | 'cancel' | 'close';

export const SELECT_MACHINE: MachineTable<SelectState, SelectEvent> = {
  idle: { down: 'pointing', grabResize: 'resizing', grabRotate: 'rotating', grabHandle: 'handling', edit: 'editing' },
  pointing: { dragShape: 'dragging', brush: 'brushing', up: 'idle', cancel: 'idle' },
  dragging: { move: 'dragging', up: 'idle', cancel: 'idle' },
  resizing: { move: 'resizing', up: 'idle', cancel: 'idle' },
  rotating: { move: 'rotating', up: 'idle', cancel: 'idle' },
  handling: { move: 'handling', up: 'idle', cancel: 'idle' },
  brushing: { move: 'brushing', up: 'idle', cancel: 'idle' },
  editing: { close: 'idle' },
};

/** The pointer moves this many screen pixels before a press is a drag. */
const SLOP_PX = 4;
/** A click lands on a shape within this many screen pixels of it. */
const HIT_PX = 6;
/** Two clicks this close in time and place are a double click. */
const DOUBLE_MS = 400;
const DOUBLE_PX = 6;
/** The rotate handle snaps to steps of 15 degrees with Shift. */
const ROTATE_STEP = Math.PI / 12;

/** What the pointer went down on and how the shapes were then; reset by every `down`. */
interface Gesture {
  hit: string;
  handle: string;
  sx: number;
  sy: number;
  px: number;
  py: number;
  /** The shapes the gesture changes (with what frames and groups hold), as they were. */
  originals: readonly ShapeRecord[];
  /** The selected shapes themselves, as they were. */
  selected: readonly ShapeRecord[];
  frame: SelectionFrame | undefined;
  startBox: Bounds | undefined;
  startAngle: number;
  mods: number;
  wasSelected: boolean;
  /** The writes of the gesture, begun with the first one; a cancel puts them all back. */
  edit: EditGesture | undefined;
  /** The shape an arrow end would stick to ('' for none). */
  target: string;
}

const emptyGesture = (): Gesture => ({
  hit: '', handle: '', sx: 0, sy: 0, px: 0, py: 0, originals: [], selected: [], frame: undefined, startBox: undefined, startAngle: 0, mods: 0, wasSelected: false, edit: undefined, target: '',
});

class SelectTool implements ToolHandlers {
  readonly #ctx: ToolContext;
  readonly #machine = new StateMachine(SELECT_MACHINE, 'idle', refusedMove('select tool', () => this.#ctx.core.store.sink));
  readonly #snapper = new Snapper((e) => this.#ctx.core.store.sink(e));
  #gesture: Gesture = emptyGesture();
  /** The last click that was not a drag, for double clicks. */
  readonly #click = { time: -1e9, x: 0, y: 0, id: '' };

  constructor(ctx: ToolContext) {
    this.#ctx = ctx;
    const editor = ctx.core.editor;
    if (editor.state !== 'closed') this.#machine.send('edit');
    editor.on((open) => {
      if (open) this.#machine.send('edit');
      else this.#machine.send('close');
    });
  }

  get state(): string {
    return this.#machine.state;
  }

  // ---------------------------------------------------------------------------------------------------------- down

  onDown(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    const { core } = this.#ctx;
    if (core.editor.state !== 'closed') core.editor.commit();
    if (!this.#machine.is('idle')) return;
    const p = camera.toPage(s.x, s.y);
    const mods = s.modifiers ?? 0;
    const g = emptyGesture();
    g.sx = s.x;
    g.sy = s.y;
    g.px = p.x;
    g.py = p.y;
    g.mods = mods;
    this.#gesture = g;

    const frame = frameOf(core, core.selection.ids);
    const handle = frame === undefined ? undefined : handleAt(handlesOf(core, frame, camera.zoom), p.x, p.y, camera.zoom);
    if (frame !== undefined && handle !== undefined) {
      g.frame = frame;
      g.handle = handle.id;
      g.selected = frame.shapes;
      g.originals = withMembers(core, frame.shapes.map((x) => x.id));
      g.startBox = this.#boxOf(frame.shapes);
      g.startAngle = Math.atan2(p.y - frame.cy, p.x - frame.cx) + Math.PI / 2;
      if (handle.kind === 'resize') {
        this.#snapper.begin(this.#neighbours(g.originals, camera.zoom));
        this.#machine.send('grabResize');
      } else if (handle.kind === 'rotate') {
        this.#machine.send('grabRotate');
      } else {
        this.#machine.send('grabHandle');
      }
      return;
    }

    const hit = pickShape(core, p.x, p.y, HIT_PX / camera.zoom);
    g.hit = hit?.id ?? '';
    if (hit !== undefined) {
      const group = selectionFor(core.store, hit.id);
      g.wasSelected = core.selection.has(hit.id);
      if ((mods & MOD_SHIFT) !== 0) {
        // Shift adds an unselected shape now; a selected one leaves on `up` if it was not dragged
        if (!g.wasSelected) core.selection.set([...core.selection.ids, ...group]);
      } else if (!g.wasSelected) {
        core.selection.set(group);
      }
    }
    this.#machine.send('down');
  }

  // ---------------------------------------------------------------------------------------------------------- move

  onMove(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined || this.#machine.is('idle') || this.#machine.is('editing')) return;
    const p = camera.toPage(s.x, s.y);
    const g = this.#gesture;
    g.mods = s.modifiers ?? g.mods;
    if (this.#machine.is('pointing')) {
      if (Math.hypot(s.x - g.sx, s.y - g.sy) < SLOP_PX) return;
      if (g.hit !== '' && this.#ctx.core.selection.has(g.hit)) this.#beginDrag(camera.zoom);
      else this.#machine.send('brush');
    }
    if (!this.#machine.send('move')) return;
    if (this.#machine.is('dragging')) this.#drag(p.x, p.y, camera.zoom);
    else if (this.#machine.is('resizing')) this.#resize(p.x, p.y, camera.zoom);
    else if (this.#machine.is('rotating')) this.#rotate(p.x, p.y);
    else if (this.#machine.is('handling')) this.#handle(p.x, p.y, camera.zoom);
    else if (this.#machine.is('brushing')) this.#brush(p.x, p.y);
    this.#ctx.requestFrame();
  }

  #beginDrag(zoom: number): void {
    const { core } = this.#ctx;
    const g = this.#gesture;
    const frame = frameOf(core, core.selection.ids);
    g.frame = frame;
    g.selected = frame?.shapes ?? [];
    g.originals = withMembers(core, core.selection.ids);
    g.startBox = this.#boxOf(g.selected);
    this.#snapper.begin(this.#neighbours(g.originals, zoom));
    this.#machine.send('dragShape');
  }

  /** The box of the shapes' own boxes together. */
  #boxOf(shapes: readonly ShapeRecord[]): Bounds | undefined {
    let box: Bounds | undefined;
    for (const sh of shapes) {
      const b = layoutBox(this.#ctx.core, sh);
      if (b === undefined) continue;
      box = box === undefined ? b : { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) };
    }
    return box;
  }

  /** The boxes of the shapes near the ones that move: what they snap to. */
  #neighbours(moving: readonly ShapeRecord[], zoom: number): Bounds[] {
    const { core } = this.#ctx;
    const mine = new Set(moving.map((m) => m.id));
    const box = this.#boxOf(moving);
    if (box === undefined) return [];
    const margin = Math.max(400, 900 / zoom);
    const ids = core.index.grid.queryBox({ minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin });
    const out: Bounds[] = [];
    for (const id of ids) {
      if (mine.has(id)) continue;
      const sh = core.index.shape(id);
      if (sh === undefined || sh.kind === 'group') continue;
      const b = layoutBox(core, sh);
      if (b !== undefined) out.push(b);
    }
    return out;
  }

  /** The grid to snap to, or null when the page shows none. */
  #grid(): number | null {
    const { core } = this.#ctx;
    const page = core.pages.current === null ? undefined : core.pages.get(core.pages.current);
    return page?.background === 'grid' || page?.background === 'dots' ? GRID_UNITS : null;
  }

  /** The gesture the writes of this press go through; it begins with the first write. */
  #edits(): EditGesture {
    const g = this.#gesture;
    g.edit ??= beginGesture(this.#ctx.core);
    return g.edit;
  }

  #write(patches: ReadonlyMap<string, ShapePatch>): void {
    patchShapes(this.#ctx.core, patches, { gesture: this.#edits() });
  }

  #drag(x: number, y: number, zoom: number): void {
    const g = this.#gesture;
    let dx = x - g.px;
    let dy = y - g.py;
    if ((g.mods & MOD_SHIFT) !== 0) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (g.startBox !== undefined) {
      const snap = this.#snapper.snapMove(shiftBox(g.startBox, dx, dy), SNAP_PX / zoom, this.#grid());
      dx += snap.dx;
      dy += snap.dy;
    }
    const patches = new Map<string, ShapePatch>();
    for (const o of g.originals) if (!o.locked) patches.set(o.id, { x: o.x + dx, y: o.y + dy });
    this.#write(patches);
    this.#ctx.overlay.guides = this.#snapper.guides;
  }

  #resize(x: number, y: number, zoom: number): void {
    const g = this.#gesture;
    const f = g.frame;
    if (f === undefined) return;
    const h = g.handle;
    const left = h.includes('w');
    const right = h.includes('e');
    const top = h.includes('n');
    const bottom = h.includes('s');
    // the pointer in the frame's own axes, from its middle
    const q = rotateAbout(x, y, f.cx, f.cy, -f.rotation);
    const qx = q.x - f.cx;
    const qy = q.y - f.cy;
    const fromMiddle = (g.mods & MOD_ALT) !== 0;
    let L = -f.w / 2;
    let R = f.w / 2;
    let T = -f.h / 2;
    let B = f.h / 2;
    if (left) L = qx;
    if (right) R = qx;
    if (top) T = qy;
    if (bottom) B = qy;
    if (fromMiddle) {
      if (left) R = -L;
      if (right) L = -R;
      if (top) B = -T;
      if (bottom) T = -B;
    }
    // snap the edges that move to the lines of other shapes, when the frame is not turned
    if (f.rotation === 0 && !fromMiddle) {
      const snapped = this.#snapper.snapResize({ minX: f.cx + L, minY: f.cy + T, maxX: f.cx + R, maxY: f.cy + B }, { left, right, top, bottom }, SNAP_PX / zoom, this.#grid());
      L = snapped.minX - f.cx;
      R = snapped.maxX - f.cx;
      T = snapped.minY - f.cy;
      B = snapped.maxY - f.cy;
    }
    // Shift keeps the shape's proportions: the side that moved less follows the one that moved more
    if ((g.mods & MOD_SHIFT) !== 0 && f.w > 0 && f.h > 0) {
      const sx = (R - L) / f.w;
      const sy = (B - T) / f.h;
      const s = left || right ? (top || bottom ? Math.max(Math.abs(sx), Math.abs(sy)) : Math.abs(sx)) : Math.abs(sy);
      const nw = f.w * s;
      const nh = f.h * s;
      if (left && !fromMiddle) L = R - nw;
      else if (right && !fromMiddle) R = L + nw;
      else if (fromMiddle) {
        L = -nw / 2;
        R = nw / 2;
      }
      if (top && !fromMiddle) T = B - nh;
      else if (bottom && !fromMiddle) B = T + nh;
      else if (fromMiddle) {
        T = -nh / 2;
        B = nh / 2;
      }
    }
    // a side cannot cross the other one: the shape stays at least a unit across
    if (R - L < 1) {
      if (left) L = R - 1;
      else R = L + 1;
    }
    if (B - T < 1) {
      if (top) T = B - 1;
      else B = T + 1;
    }
    this.#ctx.overlay.guides = this.#snapper.guides;
    const patches = new Map<string, ShapePatch>();
    if (f.single !== undefined) {
      const original = g.selected[0];
      const geometry = original === undefined ? undefined : shapeGeometry(original, this.#ctx.core.store.kinds);
      if (original !== undefined && geometry !== undefined && !original.locked) {
        // the frame's own axes are the shape's own axes, and its middle is the middle of the shape's box
        const nb: Bounds = { minX: geometry.cx + L, minY: geometry.cy + T, maxX: geometry.cx + R, maxY: geometry.cy + B };
        const patch = resizePatch(this.#ctx.core, original, nb);
        if (patch !== undefined) patches.set(original.id, patch);
      }
    } else {
      const sx = (R - L) / f.w;
      const sy = (B - T) / f.h;
      // the point that stays put: the side opposite the handle, or the middle when it grows from the middle
      const ax = f.cx + (fromMiddle || (!left && !right) ? 0 : left ? f.w / 2 : -f.w / 2);
      const ay = f.cy + (fromMiddle || (!top && !bottom) ? 0 : top ? f.h / 2 : -f.h / 2);
      for (const [id, patch] of scalePatches(this.#ctx.core, g.originals, ax, ay, left || right ? sx : 1, top || bottom ? sy : 1)) patches.set(id, patch);
    }
    this.#write(patches);
  }

  #rotate(x: number, y: number): void {
    const g = this.#gesture;
    const f = g.frame;
    if (f === undefined) return;
    let delta = wrapAngle(Math.atan2(y - f.cy, x - f.cx) + Math.PI / 2 - g.startAngle);
    if ((g.mods & MOD_SHIFT) !== 0) {
      const base = f.single?.rotation ?? 0;
      delta = Math.round((base + delta) / ROTATE_STEP) * ROTATE_STEP - base;
    }
    turnShapes(this.#ctx.core, g.originals, delta, f.cx, f.cy, { gesture: this.#edits() });
  }

  /** A handle of the kind moves to the pointer. An arrow's end looks for a shape to stick to. */
  #handle(x: number, y: number, zoom: number): void {
    const { core } = this.#ctx;
    const g = this.#gesture;
    const original = g.selected[0];
    if (original === undefined || original.locked || !g.handle.startsWith('k:')) return;
    const def = core.store.kinds.get(original.kind);
    const geometry = shapeGeometry(original, core.store.kinds);
    if (def?.moveHandle === undefined || geometry === undefined) return;
    const id = g.handle.slice(2);
    const isEnd = original.kind === 'arrow' && (id === 'start' || id === 'end');
    if (isEnd && this.#edits().writes === 0) {
      // the end leaves the shape it was stuck to as soon as it moves
      this.#edits().write((tx) => void unbindEnd(tx, core.store, original.id, id as ArrowEnd));
    }
    const local = geometry.toLocal(x, y);
    const props = def.moveHandle(original, id, local.x, local.y) as Record<string, unknown>;
    const checked = def.check({ ...(original.props as object), ...props });
    if (!checked.ok) return;
    const candidate: ShapeRecord = { ...original, props: checked.value };
    const g2 = shapeGeometry(candidate, core.store.kinds);
    const patch: ShapePatch = { props };
    if (g2 !== undefined && original.rotation !== 0) {
      // keep the dragged point under the pointer when the shape is turned
      const h = def.handles?.(candidate)?.find((hh) => hh.id === id);
      if (h !== undefined) {
        const r = rotateAbout(h.x, h.y, g2.cx, g2.cy, original.rotation);
        Object.assign(patch, { x: x - g2.cx - (r.x - g2.cx), y: y - g2.cy - (r.y - g2.cy) });
      }
    }
    this.#write(new Map([[original.id, patch]]));
    if (isEnd) {
      const skip = new Set([original.id]);
      const page = core.pages.current;
      const target = page === null ? undefined : bindTargetAt(core.store, page, x, y, HIT_PX / zoom, skip);
      g.target = target?.id ?? '';
      this.#ctx.overlay.hint = target === undefined ? null : (shapeGeometry(target, core.store.kinds)?.outline ?? null);
    }
  }

  #brush(x: number, y: number): void {
    const { core } = this.#ctx;
    const g = this.#gesture;
    const box: Bounds = { minX: Math.min(g.px, x), minY: Math.min(g.py, y), maxX: Math.max(g.px, x), maxY: Math.max(g.py, y) };
    this.#ctx.overlay.marquee = box;
    const found = pickInBox(core, box).map((sh) => sh.id);
    const base = (g.mods & MOD_SHIFT) !== 0 ? g.selected.map((sh) => sh.id) : [];
    core.selection.set(expandGroups(core.store, [...base, ...found]));
  }

  // ------------------------------------------------------------------------------------------------------------ up

  onUp(s: InputSample): void {
    const camera = this.#ctx.camera();
    const g = this.#gesture;
    const { core } = this.#ctx;
    if (this.#machine.is('idle') || this.#machine.is('editing') || camera === undefined) return;
    const p = camera.toPage(s.x, s.y);
    if (this.#machine.is('pointing')) {
      this.#machine.send('up');
      this.#clicked(s, g);
    } else if (this.#machine.is('dragging')) {
      this.#machine.send('up');
      if (g.edit !== undefined) settleParents(core, g.selected.map((sh) => sh.id), { gesture: g.edit });
    } else if (this.#machine.is('handling')) {
      this.#machine.send('up');
      this.#drop(g, p.x, p.y);
    } else {
      this.#machine.send('up');
    }
    this.#finish();
  }

  /** A press that did not move: select, toggle, or open the text. */
  #clicked(s: InputSample, g: Gesture): void {
    const { core } = this.#ctx;
    const shiftHeld = (g.mods & MOD_SHIFT) !== 0;
    const again = g.hit !== '' && g.hit === this.#click.id && s.time - this.#click.time < DOUBLE_MS && Math.hypot(s.x - this.#click.x, s.y - this.#click.y) < DOUBLE_PX;
    this.#click.time = s.time;
    this.#click.x = s.x;
    this.#click.y = s.y;
    this.#click.id = g.hit;
    if (g.hit === '') {
      if (!shiftHeld) core.selection.clear();
      return;
    }
    if (again) {
      const shape = shapeOf(core.store, g.hit);
      if (shape !== undefined && core.store.kinds.get(shape.kind)?.text !== undefined && !shape.locked) {
        core.selection.set([shape.id]);
        core.editor.open(shape.id);
      } else if (shape !== undefined && core.store.kinds.get(shape.kind)?.text === undefined) {
        core.selection.set([shape.id]);
        this.#ctx.activate?.(shape.id);
      }
      return;
    }
    const group = selectionFor(core.store, g.hit);
    if (shiftHeld) {
      if (g.wasSelected) core.selection.set(core.selection.ids.filter((id) => !group.includes(id)));
    } else if (core.selection.size > 1) {
      // a click on one of several selected shapes keeps only it (and its group)
      core.selection.set(group);
    }
  }

  /** An arrow end let go: it sticks to the shape under it, or stays free. One undo step with the drag. */
  #drop(g: Gesture, x: number, y: number): void {
    const { core } = this.#ctx;
    const original = g.selected[0];
    if (original === undefined || original.kind !== 'arrow' || !g.handle.startsWith('k:') || g.edit === undefined || g.edit.writes === 0) return;
    const end = g.handle.slice(2);
    if (end !== 'start' && end !== 'end') return;
    if (g.target === '') return;
    g.edit.write((tx) => void bindEnd(tx, core.store, original.id, end, g.target, { x, y }));
  }

  /** Common end of a press: the gesture is committed (one undo step), guides and hints go, the history is sealed. */
  #finish(): void {
    const { core, overlay } = this.#ctx;
    this.#gesture.edit?.commit();
    this.#snapper.end();
    overlay.guides = [];
    overlay.marquee = null;
    overlay.hint = null;
    core.history.seal();
    this.#ctx.requestFrame();
  }

  onCancel(): void {
    const g = this.#gesture;
    if (this.#machine.is('idle') || this.#machine.is('editing')) return;
    this.#machine.send('cancel');
    // every record the gesture changed goes back as it was, and its undo step is dropped
    g.edit?.cancel();
    this.#finish();
  }
}

export const selectTool: ToolDef = {
  id: 'select',
  label: 'Select',
  key: 'v',
  cursor: 'default',
  create: (ctx) => new SelectTool(ctx),
};
