/**
 * The shape tools (docs/state-machines.md B20): rect, ellipse, triangle, diamond, star, frame, line, arrow, text and
 * sticky. Drag to make the shape, click for the default size; Shift makes a square or a circle (or snaps a line to
 * steps of 15 degrees); Alt makes the shape from its middle. The shape is written on the first move past the slop and
 * updated by each move with one merge key, so it is one undo step. One table serves every tool; each tool is one
 * instance with its own state.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
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
  /** The size of a shape made by a click (a line's length for `line`). */
  readonly w: number;
  readonly h: number;
}

const SPECS: readonly ShapeToolSpec[] = [
  { id: 'rect', label: 'Rectangle', key: 'r', kind: 'rect', layout: 'box', w: 120, h: 80 },
  { id: 'ellipse', label: 'Ellipse', key: 'o', kind: 'ellipse', layout: 'box', w: 120, h: 80 },
  { id: 'triangle', label: 'Triangle', key: 'shift+t', kind: 'triangle', layout: 'box', w: 120, h: 100 },
  { id: 'diamond', label: 'Diamond', key: 'd', kind: 'diamond', layout: 'box', w: 120, h: 100 },
  { id: 'star', label: 'Star', key: 'shift+s', kind: 'star', layout: 'box', w: 110, h: 105 },
  { id: 'line', label: 'Line', key: 'shift+l', kind: 'line', layout: 'line', w: 120, h: 0 },
  { id: 'arrow', label: 'Arrow', key: 'a', kind: 'arrow', layout: 'line', w: 120, h: 0 },
  { id: 'text', label: 'Text', key: 't', kind: 'text', layout: 'text', w: 0, h: 0 },
  { id: 'sticky', label: 'Sticky note', key: 'n', kind: 'sticky', layout: 'note', w: 200, h: 200 },
  { id: 'frame', label: 'Frame', key: 'f', kind: 'frame', layout: 'box', w: 400, h: 300 },
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
  serial: number;
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
  readonly #machine = new StateMachine(SHAPE_TOOL_MACHINE, 'idle');
  #gesture: Gesture = { px: 0, py: 0, sx: 0, sy: 0, id: '', serial: 0 };
  #serial = 0;

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
    this.#gesture = { px: p.x, py: p.y, sx: s.x, sy: s.y, id: '', serial: ++this.#serial };
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
    this.#gesture = { ...this.#gesture, id: '' };
    this.#ctx.core.history.seal();
    if (id !== '') this.#done(id);
    this.#ctx.requestFrame();
  }

  onCancel(): void {
    const g = this.#gesture;
    if (!this.#machine.send('cancel')) return;
    if (g.id !== '') {
      // the shape that was started goes; its merged step then holds no change and is dropped
      this.#ctx.core.store.change('user', (tx) => void tx.remove(g.id), { mergeKey: `make:${g.serial}` });
      this.#gesture = { ...g, id: '' };
    }
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
      this.#put({ x: x - spec.w / 2, y: y - spec.h / 2, props: { w: spec.w, h: spec.h } });
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
    const result = core.store.change(
      'user',
      (tx: Tx) => {
        if (g.id !== '') {
          tx.update(g.id, { x: l.x, y: l.y, props: l.props });
          return undefined;
        }
        const made = putNewShape(tx, core.store, { kind: spec.kind, page, x: l.x, y: l.y, props: { ...styledDefaults(this.#ctx, spec.kind), ...l.props } });
        return made.ok ? made.value : undefined;
      },
      { mergeKey: `make:${g.serial}` },
    );
    if (!result.ok) return;
    const made = result.value.value as ShapeRecord | undefined;
    if (made !== undefined) {
      this.#gesture = { ...g, id: made.id };
      // a shape made inside a frame belongs to it
      const geometry = shapeGeometry(made, core.store.kinds);
      const frame = geometry === undefined ? undefined : frameAt(core.store, core.store.kinds, page, geometry.pageCx, geometry.pageCy, new Set([made.id]));
      if (frame !== undefined) core.store.change('user', (tx) => void tx.update(made.id, { parent: frame.id }), { mergeKey: `make:${g.serial}` });
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
