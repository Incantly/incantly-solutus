/**
 * The eraser (design 6.4, docs/state-machines.md B8). Whole mode removes every stroke the eraser's path touches;
 * partial mode cuts a stroke at each segment the path touches and keeps the runs of two or more points as new
 * strokes. A drag is one undo step: its writes go through one gesture (`core/edit.ts`, B25), the history is sealed when
 * the pen comes up, and a cancel puts back everything the drag erased.
 * Locked shapes are never erased. The pen's eraser end picks this tool through the tool host.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { beginGesture } from '../edit';
import type { Gesture } from '../edit';
import { cutInk, inkTouches } from '../ink/geometry';
import type { InputSample } from '../input';
import { isInk } from '../geometry';
import type { ToolContext, ToolDef, ToolHandlers } from './def';

type EraserState = 'idle' | 'erasing';
type EraserEvent = 'down' | 'move' | 'up' | 'cancel';

export const ERASER_MACHINE: MachineTable<EraserState, EraserEvent> = {
  idle: { down: 'erasing' },
  erasing: { move: 'erasing', up: 'idle', cancel: 'idle' },
};

class EraserTool implements ToolHandlers {
  readonly #ctx: ToolContext;
  readonly #machine = new StateMachine(ERASER_MACHINE, 'idle');
  readonly #ids: string[] = [];
  #lastX = 0;
  #lastY = 0;
  /** What the drag in progress wrote; it begins with the first stroke erased. */
  readonly #drag: { edit: Gesture | undefined } = { edit: undefined };

  constructor(ctx: ToolContext) {
    this.#ctx = ctx;
  }

  get state(): string {
    return this.#machine.state;
  }

  onDown(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined || !this.#machine.send('down')) return;
    this.#drag.edit = undefined;
    this.#ctx.core.selection.clear();
    const p = camera.toPage(s.x, s.y);
    this.#lastX = p.x;
    this.#lastY = p.y;
    this.#erase(p.x, p.y, p.x, p.y);
    this.#ring(s);
  }

  onMove(s: InputSample): void {
    const camera = this.#ctx.camera();
    if (camera === undefined || !this.#machine.send('move')) return;
    const p = camera.toPage(s.x, s.y);
    this.#erase(this.#lastX, this.#lastY, p.x, p.y);
    this.#lastX = p.x;
    this.#lastY = p.y;
    this.#ring(s);
  }

  onHover(s: InputSample): void {
    this.#ring(s);
  }

  onUp(s: InputSample): void {
    if (this.#machine.state !== 'erasing') return;
    this.onMove(s);
    this.#machine.send('up');
    this.#drag.edit?.commit();
    this.#drag.edit = undefined;
    this.#ctx.core.history.seal();
    this.#ctx.requestFrame();
  }

  onCancel(): void {
    if (this.#machine.send('cancel')) {
      this.#drag.edit?.cancel();
      this.#drag.edit = undefined;
      this.#ctx.core.history.seal();
    }
    this.#ctx.overlay.cursor = null;
    this.#ctx.requestFrame();
  }

  #ring(s: InputSample): void {
    this.#ctx.overlay.cursor = { x: s.x, y: s.y, radius: this.#ctx.styles.eraser.radius, color: '#6b7280' };
    this.#ctx.requestFrame();
  }

  /** Erases along the page segment `a`-`b`. */
  #erase(ax: number, ay: number, bx: number, by: number): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    const { index } = this.#ctx.core;
    const radius = this.#ctx.styles.eraser.radius / camera.zoom;
    this.#ids.length = 0;
    index.grid.queryBox({ minX: Math.min(ax, bx) - radius, minY: Math.min(ay, by) - radius, maxX: Math.max(ax, bx) + radius, maxY: Math.max(ay, by) + radius }, this.#ids);
    if (this.#ids.length === 0) return;
    const partial = this.#ctx.styles.eraser.mode === 'partial';
    const hits: { readonly id: string; readonly pieces: Float32Array[] | null }[] = [];
    for (const id of this.#ids) {
      const shape = index.shape(id);
      if (shape === undefined || shape.locked || !isInk(shape)) continue;
      if (partial) {
        const pieces = cutInk(shape, ax, ay, bx, by, radius);
        if (pieces !== null) hits.push({ id, pieces });
      } else if (inkTouches(shape, ax, ay, bx, by, radius)) {
        hits.push({ id, pieces: null });
      }
    }
    if (hits.length === 0) return;
    // a refused write leaves every stroke as it was; the next move tries again
    this.#drag.edit ??= beginGesture(this.#ctx.core);
    this.#drag.edit.write((tx) => {
      for (const hit of hits) {
        const shape = index.shape(hit.id);
        tx.remove(hit.id);
        if (hit.pieces === null || shape === undefined || !isInk(shape)) continue;
        for (const points of hit.pieces) {
          tx.put({ ...shape, id: tx.newId('shape'), rotation: 0, props: { ...shape.props, points }, meta: { ...shape.meta } });
        }
      }
    });
  }
}

export const eraserTool: ToolDef = {
  id: 'eraser',
  label: 'Eraser',
  key: 'e',
  create: (ctx) => new EraserTool(ctx),
};
