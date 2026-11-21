/**
 * The shape tools (docs/state-machines.md B20): rect, ellipse, triangle, diamond, star, frame, line, arrow, text and
 * sticky. Drag to make the shape, click for the default size; Shift makes a square or a circle (or snaps a line to
 * steps of 15 degrees); Alt makes the shape from its middle. The shape is written on the first move past the slop and
 * updated by each move through one gesture (`core/edit.ts`, B25), so it is one undo step and a cancel removes it. One
 * table serves every tool; each tool is one instance with its own state.
 */
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from '../machine';
import { refusedMove } from '../errors';
import type { MachineTable } from '@incantly/kernel';
import { beginGesture } from '../edit';
import type { Gesture as EditGesture } from '../edit';
import { shapeGeometry } from '../geometry';
import { MOD_ALT, MOD_SHIFT } from '../input';
import type { InputSample } from '../input';
import { frameAt, putNewShape } from '../shapes';
import type { Tx } from '../store';
import type { ShapeRecord } from '../types';
import type { StylePatch } from '../kinds/def';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

type ShapeToolState = 'idle' | 'making';
type ShapeToolEvent = 'down' | 'move' | 'up' | 'cancel';

export const SHAPE_TOOL_MACHINE: MachineTable<ShapeToolState, ShapeToolEvent> = {
  idle: { down: 'making' },
  making: { move: 'making', up: 'idle', cancel: 'idle' },
};

/** How a tool lays its shape out from the drag. */
type Layout = 'box' | 'line' | 'text' | 'note';

interface ShapeToolSpec {
  readonly id: string;
  readonly label: string;
  readonly key: string;
  readonly kind: string;
  readonly layout: Layout;
  /** The size of a shape made by a click, for the layouts whose kind has no size of its own (a line's length for `line`, a note). A box takes the size of its kind's defaults. */
  readonly w: number;
  readonly h: number;
}

const SPECS: readonly ShapeToolSpec[] = [
  { id: 'rect', label: 'Rectangle', key: 'r', kind: 'rect', layout: 'box', w: 0, h: 0 },
  { id: 'ellipse', label: 'Ellipse', key: 'o', kind: 'ellipse', layout: 'box', w: 0, h: 0 },
  { id: 'triangle', label: 'Triangle', key: 'shift+t', kind: 'triangle', layout: 'box', w: 0, h: 0 },
  { id: 'diamond', label: 'Diamond', key: 'd', kind: 'diamond', layout: 'box', w: 0, h: 0 },
  { id: 'star', label: 'Star', key: 'shift+s', kind: 'star', layout: 'box', w: 0, h: 0 },
  { id: 'line', label: 'Line', key: 'shift+l', kind: 'line', layout: 'line', w: 120, h: 0 },
  { id: 'arrow', label: 'Arrow', key: 'a', kind: 'arrow', layout: 'line', w: 120, h: 0 },
  { id: 'text', label: 'Text', key: 't', kind: 'text', layout: 'text', w: 0, h: 0 },
  { id: 'sticky', label: 'Sticky note', key: 'n', kind: 'sticky', layout: 'note', w: 200, h: 200 },
  { id: 'frame', label: 'Frame', key: 'f', kind: 'frame', layout: 'box', w: 0, h: 0 },
];

/** The pointer moves this many screen pixels before a press is a drag. */
const SLOP_PX = 4;
const STEP = Math.PI / 12;

/** What a gesture holds: where it began and the shape it made (an empty id until the first move). */
interface Gesture {
  px: number;
  py: number;
  sx: number;
  sy: number;
  id: string;
  /** The writes of the gesture; a cancel puts them all back. */
  edit: EditGesture | undefined;
}

/** The props a new shape of the kind starts with: the kind's defaults with the style bar's choices on top. */
export function styledDefaults(ctx: ToolContext, kind: string): Record<string, unknown> {
  const def = ctx.core.store.kinds.get(kind);
  if (def === undefined) return {};
  const s = ctx.styles.shape;
  // a note keeps its paper colour and a frame its white; the colour and fill of the style bar are for lines and shapes
  const style: StylePatch = kind === 'sticky' ? { size: s.size, font: s.font } : { color: s.color, dash: s.dash, size: s.size, font: s.font, ...(kind === 'frame' ? {} : { fill: s.fill }) };
  return { ...(def.applyStyle?.(def.defaults, style) ?? {}) } as Record<string, unknown>;
}

class ShapeTool implements ToolHandlers {
  readonly #ctx: ToolContext;
  readonly #spec: ShapeToolSpec;
  readonly #machine = new StateMachine(SHAPE_TOOL_MACHINE, 'idle', refusedMove('shape tool', () => this.#ctx.core.store.sink));
  #gesture: Gesture = { px: 0, py: 0, sx: 0, sy: 0, id: '', edit: undefined };

  constructor(ctx: ToolContext, spec: ShapeToolSpec) {
    this.#ctx = ctx;
    this.#spec = spec;
  }

  get state(): string {
    return this.#machine.state;
  }

  onDown(s: InputSample): void {
    const camera = this.#ctx.camera();
    const { core } = this.#ctx;
    if (camera === undefined || core.pages.current === null) return;
    if (core.editor.state !== 'closed') core.editor.commit();
    if (!this.#machine.send('down')) return;
    const p = camera.toPage(s.x, s.y);
    this.#gesture = { px: p.x, py: p.y, sx: s.x, sy: s.y, id: '', edit: undefined };
    core.selection.clear();
  }

  onMove(s: InputSample): void {
    const camera = this.#ctx.camera();
    const g = this.#gesture;
    if (camera === undefined || !this.#machine.is('making')) return;
    if (g.id === '' && Math.hypot(s.x - g.sx, s.y - g.sy) < SLOP_PX) return;
    this.#machine.send('move');
    const p = camera.toPage(s.x, s.y);
    this.#write(p.x, p.y, s.modifiers ?? 0);
    this.#ctx.requestFrame();
  }

  onUp(s: InputSample): void {
    const camera = this.#ctx.camera();
    const g = this.#gesture;
    if (camera === undefined || !this.#machine.is('making')) return;
    const p = camera.toPage(s.x, s.y);
    const dragged = g.id !== '' || Math.hypot(s.x - g.sx, s.y - g.sy) >= SLOP_PX;
    if (dragged) this.#write(p.x, p.y, s.modifiers ?? 0);
    else this.#click(p.x, p.y);
    const id = this.#gesture.id;
    this.#machine.send('up');
    this.#gesture.edit?.commit();
    this.#gesture = { ...this.#gesture, id: '', edit: undefined };
    this.#ctx.core.history.seal();
    if (id !== '') this.#done(id);
    this.#ctx.requestFrame();
  }

  onCancel(): void {
    const g = this.#gesture;
    if (!sendIfAble(this.#machine, 'cancel')) return;
    // everything the gesture wrote goes, and its undo step with it
    g.edit?.cancel();
    this.#gesture = { ...g, id: '', edit: undefined };
    this.#ctx.core.history.seal();
    this.#ctx.requestFrame();
  }

  /** The shape is made: it is selected, the select tool takes over, and a text shape opens for typing. */
  #done(id: string): void {
    const { core } = this.#ctx;
    core.selection.set([id]);
    this.#ctx.setTool?.('select');
    if (this.#spec.layout === 'text' || this.#spec.layout === 'note') core.editor.open(id);
  }

  /** The props and place of the shape for a drag from the start to the page point. */
  #layout(x: number, y: number, mods: number): { readonly x: number; readonly y: number; readonly props: Record<string, unknown> } {
    const g = this.#gesture;
    const spec = this.#spec;
    let dx = x - g.px;
    let dy = y - g.py;
    if (spec.layout === 'line') {
      if ((mods & MOD_SHIFT) !== 0) {
        const len = Math.hypot(dx, dy);
        const a = Math.round(Math.atan2(dy, dx) / STEP) * STEP;
        dx = Math.cos(a) * len;
        dy = Math.sin(a) * len;
      }
      return { x: g.px, y: g.py, props: spec.kind === 'arrow' ? { start: [0, 0], end: [dx, dy] } : { points: [0, 0, dx, dy] } };
    }
    if (spec.layout === 'note') return { x: x - spec.w / 2, y: y - spec.h / 2, props: {} };
    if ((mods & MOD_SHIFT) !== 0 && spec.layout === 'box') {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * side;
      dy = Math.sign(dy || 1) * side;
    }
    if (spec.layout === 'text') return { x: dx < 0 ? x : g.px, y: g.py, props: { w: Math.max(12, Math.abs(dx)) } };
    if ((mods & MOD_ALT) !== 0) {
      const w = Math.max(1, Math.abs(dx) * 2);
      const h = Math.max(1, Math.abs(dy) * 2);
      return { x: g.px - w / 2, y: g.py - h / 2, props: { w, h } };
    }
    return { x: Math.min(g.px, g.px + dx), y: Math.min(g.py, g.py + dy), props: { w: Math.max(1, Math.abs(dx)), h: Math.max(1, Math.abs(dy)) } };
  }

  #click(x: number, y: number): void {
    const spec = this.#spec;
    const g = this.#gesture;
    if (spec.layout === 'line') {
      const props = spec.kind === 'arrow' ? { start: [0, 0], end: [spec.w, 0] } : { points: [0, 0, spec.w, 0] };
      this.#put({ x: g.px - spec.w / 2, y: g.py, props });
    } else if (spec.layout === 'text') {
      this.#put({ x: x, y: y - 16, props: {} });
    } else if (spec.layout === 'note') {
      this.#put({ x: x - spec.w / 2, y: y - spec.h / 2, props: {} });
    } else {
      // the size is the kind's own: a host's kind in a shape tool gets the same rule (design 7.2); 120 by 80 when it has none
      const d = this.#ctx.core.store.kinds.get(spec.kind)?.defaults as { w?: unknown; h?: unknown } | undefined;
      const w = typeof d?.w === 'number' ? d.w : 120;
      const h = typeof d?.h === 'number' ? d.h : 80;
      this.#put({ x: x - w / 2, y: y - h / 2, props: { w, h } });
    }
  }

  #write(x: number, y: number, mods: number): void {
    const l = this.#layout(x, y, mods);
    this.#put(l);
  }

  /** Adds the shape, or changes the one this gesture added. */
  #put(l: { readonly x: number; readonly y: number; readonly props: Record<string, unknown> }): void {
    const { core } = this.#ctx;
    const g = this.#gesture;
    const page = core.pages.current;
    if (page === null) return;
    const spec = this.#spec;
    const edit = g.edit ?? beginGesture(core);
    g.edit = edit;
    const result = edit.write((tx: Tx) => {
      if (g.id !== '') {
        tx.update(g.id, { x: l.x, y: l.y, props: l.props });
        return undefined;
      }
      const made = putNewShape(tx, core.store, { kind: spec.kind, page, x: l.x, y: l.y, props: { ...styledDefaults(this.#ctx, spec.kind), ...l.props } });
      return made.ok ? made.value : undefined;
    });
    if (!result.ok) return;
    const made = result.value as ShapeRecord | undefined;
    if (made !== undefined) {
      this.#gesture = { ...g, id: made.id };
      // a shape made inside a frame belongs to it
      const geometry = shapeGeometry(made, core.store.kinds);
      const frame = geometry === undefined ? undefined : frameAt(core.store, core.store.kinds, page, geometry.pageCx, geometry.pageCy, new Set([made.id]));
      if (frame !== undefined) edit.write((tx) => void tx.update(made.id, { parent: frame.id }));
    }
  }
}

/** The tool of one kind of shape. */
function shapeTool(spec: ShapeToolSpec): ToolDef {
  return { id: spec.id, label: spec.label, key: spec.key, cursor: 'crosshair', create: (ctx) => new ShapeTool(ctx, spec) };
}

export const rectTool = shapeTool(SPECS[0] as ShapeToolSpec);
export const ellipseTool = shapeTool(SPECS[1] as ShapeToolSpec);
export const triangleTool = shapeTool(SPECS[2] as ShapeToolSpec);
export const diamondTool = shapeTool(SPECS[3] as ShapeToolSpec);
export const starTool = shapeTool(SPECS[4] as ShapeToolSpec);
export const lineTool = shapeTool(SPECS[5] as ShapeToolSpec);
export const arrowTool = shapeTool(SPECS[6] as ShapeToolSpec);
export const textTool = shapeTool(SPECS[7] as ShapeToolSpec);
export const stickyTool = shapeTool(SPECS[8] as ShapeToolSpec);
export const frameTool = shapeTool(SPECS[9] as ShapeToolSpec);

/** The shape tools, in toolbar order. */
export const SHAPE_TOOLS: readonly ToolDef[] = [rectTool, ellipseTool, triangleTool, diamondTool, starTool, lineTool, arrowTool, textTool, stickyTool, frameTool];
