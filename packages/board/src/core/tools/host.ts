/**
 * The tool host (docs/state-machines.md B12): which tool answers the input. The chosen tool answers, except while a
 * pen's eraser end is down (the eraser answers) and while Space is held or the middle button is down (the hand
 * answers); then the chosen tool comes back. It also owns the keys that choose a tool, undo and redo, and deleting the
 * selection, and gives wheel and two-finger input to the camera.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { boardError, DONE } from '../errors';
import type { BoardResult } from '../errors';
import { BUTTON_ERASER, BUTTON_MIDDLE } from '../input';
import type { GestureInput, InputSample, KeyInput, WheelInput } from '../input';
import { deleteShapes } from '../edit';
import type { ToolContext, ToolDef, ToolHandlers, ToolList } from './def';
import { editKey } from './keys';
import { defaultKeyTable, KeyMap } from '../keymap';

type HostState = 'chosen' | 'eraserEnd' | 'handHeld';
type HostEvent = 'eraserDown' | 'eraserUp' | 'handDown' | 'handUp';

export const TOOLS_MACHINE: MachineTable<HostState, HostEvent> = {
  chosen: { eraserDown: 'eraserEnd', handDown: 'handHeld' },
  eraserEnd: { eraserUp: 'chosen' },
  handHeld: { handUp: 'chosen' },
};

/** One wheel notch is about this many pixels; the zoom is `2^(-dy / ZOOM_PX)`. */
const ZOOM_PX = 240;

export class ToolHost {
  readonly #ctx: ToolContext;
  readonly #list: ToolList;
  readonly #machine = new StateMachine(TOOLS_MACHINE, 'chosen');
  readonly #instances = new Map<string, ToolHandlers>();
  readonly #listeners: ((id: string) => void)[] = [];
  /** Actions the shell carries out (zoom, pages, a figure card): the key map names them, the shell registers them. */
  readonly #actions = new Map<string, () => boolean>();
  #keys: KeyMap;
  #current: string;
  /** What holds the hand: a key or a button. */
  #heldBy: 'none' | 'space' | 'middle' = 'none';
  /** The pointer that is down, or -1. */
  #down = -1;

  constructor(ctx: ToolContext, list: ToolList, initial = 'pen', keys?: KeyMap) {
    this.#keys = keys ?? KeyMap.from(defaultKeyTable(list));
    // a tool may ask for another one (a shape tool hands back to the select tool); the host answers
    this.#ctx = ctx.setTool !== undefined ? ctx : { ...ctx, setTool: (id: string) => void this.setTool(id) };
    this.#list = list;
    this.#current = list.get(initial) !== undefined ? initial : (list.ids()[0] ?? initial);
  }

  /** The chosen tool's id. */
  get tool(): string {
    return this.#current;
  }

  /** `chosen`, `eraserEnd` or `handHeld`. */
  get state(): HostState {
    return this.#machine.state;
  }

  /** The id of the tool that answers input now. */
  get active(): string {
    return this.#machine.is('eraserEnd') ? 'eraser' : this.#machine.is('handHeld') ? 'hand' : this.#current;
  }

  get tools(): readonly ToolDef[] {
    return this.#list.defs;
  }

  /** The key map the host reads (design 10, B30). */
  get keys(): KeyMap {
    return this.#keys;
  }

  /** Gives the host another key map (a host changed its `keys`). */
  setKeys(keys: KeyMap): void {
    this.#keys = keys;
  }

  /** Registers what a named action does when its key is pressed; returns the function that takes it away. */
  setAction(action: string, run: () => boolean): () => void {
    this.#actions.set(action, run);
    return () => {
      if (this.#actions.get(action) === run) this.#actions.delete(action);
    };
  }

  /** Calls `listener` when the chosen tool changes. */
  onTool(listener: (id: string) => void): void {
    this.#listeners.push(listener);
  }

  /** Chooses a tool. An id that is not in the list is `tool_unknown`. A stroke in progress is cancelled first. */
  setTool(id: string): BoardResult<undefined> {
    if (this.#list.get(id) === undefined) {
      const close = this.#list.ids().filter((t) => t.startsWith(id.slice(0, 1)));
      return boardError('tool_unknown', `There is no tool "${id}".`, { hint: close.length > 0 ? `Did you mean ${close.join(', ')}?` : `The tools are ${this.#list.ids().join(', ')}.`, detail: { tool: id } });
    }
    if (id === this.#current) return DONE;
    this.#instance(this.active)?.onCancel();
    this.#current = id;
    this.#ctx.overlay.cursor = null;
    this.#ctx.requestFrame();
    for (const l of this.#listeners) l(id);
    return DONE;
  }

  /** Sends one sample to the tool that answers. */
  sample(s: InputSample): void {
    if (s.phase === 'down') {
      this.#down = s.pointer;
      if (this.#machine.is('chosen')) {
        if ((s.buttons & BUTTON_ERASER) !== 0 && this.#list.get('eraser') !== undefined) {
          this.#instance(this.#current)?.onCancel();
          this.#machine.send('eraserDown');
        } else if ((s.buttons & BUTTON_MIDDLE) !== 0 && this.#list.get('hand') !== undefined) {
          this.#instance(this.#current)?.onCancel();
          this.#machine.send('handDown');
          this.#heldBy = 'middle';
        }
      }
    }
    const tool = this.#instance(this.active);
    if (tool === undefined) return;
    switch (s.phase) {
      case 'down':
        tool.onDown(s);
        break;
      case 'move':
        if (s.predicted) tool.onPredicted?.(s);
        else tool.onMove(s);
        break;
      case 'hover':
        tool.onHover?.(s);
        break;
      case 'up':
        tool.onUp(s);
        this.#release(s.pointer);
        break;
      case 'cancel':
        tool.onCancel();
        this.#release(s.pointer);
        break;
    }
  }

  /** Cancels what the answering tool is doing (a second finger came down). */
  cancel(): void {
    this.#instance(this.active)?.onCancel();
    this.#down = -1;
    if (this.#heldBy === 'middle') this.#endHand();
    this.#machine.send('eraserUp');
  }

  /** Moves the camera by a wheel step: a pan, or a zoom about the pointer for Ctrl or a trackpad pinch. */
  wheel(w: WheelInput): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    if (w.zoom) camera.zoomBy(Math.pow(2, -w.dy / ZOOM_PX), w.x, w.y, w.time);
    else camera.panBy(-w.dx, -w.dy);
    this.#ctx.requestFrame();
  }

  /** Moves the camera by the change of a two-finger gesture. */
  gesture(g: GestureInput): void {
    const camera = this.#ctx.camera();
    if (camera === undefined) return;
    camera.panBy(g.dx, g.dy);
    if (g.scale > 0 && g.scale !== 1) camera.zoomBy(g.scale, g.x, g.y, g.time);
    this.#ctx.requestFrame();
  }

  /** A key. Returns true when the host used it. */
  key(k: KeyInput): boolean {
    if (!k.down) {
      if (k.key === ' ' && this.#heldBy === 'space') {
        this.#endHand();
        return true;
      }
      return false;
    }
    if (k.key === ' ' && !k.repeat) {
      if (this.#machine.is('chosen') && this.#down < 0 && this.#list.get('hand') !== undefined) {
        this.#machine.send('handDown');
        this.#heldBy = 'space';
      }
      return true;
    }
    const action = this.#keys.actionOf(k);
    if (action === 'undo' || action === 'redo') {
      if (action === 'redo') this.#ctx.core.history.redo();
      else this.#ctx.core.history.undo();
      this.#ctx.requestFrame();
      return true;
    }
    if (this.#instance(this.active)?.onKey?.(k) === true) return true;
    if (editKey(this.#ctx, k, this.#keys)) return true;
    if (action === 'delete') return this.#deleteSelection();
    if (k.key === 'Escape') {
      this.#ctx.core.selection.clear();
      this.cancel();
      this.#ctx.requestFrame();
      return true;
    }
    if (action === undefined) return false;
    const run = this.#actions.get(action);
    if (run !== undefined) return (!k.repeat || action.startsWith('zoom')) && run();
    if (k.repeat || this.#down >= 0 || this.#list.get(action) === undefined) return false;
    this.setTool(action);
    return true;
  }

  /** Called every frame with the input clock. True while a tool still wants frames. */
  tick(now: number): boolean {
    let more = false;
    for (const tool of this.#instances.values()) if (tool.tick?.(now) === true) more = true;
    return more;
  }

  #instance(id: string): ToolHandlers | undefined {
    const known = this.#instances.get(id);
    if (known !== undefined) return known;
    const def = this.#list.get(id);
    if (def === undefined) return undefined;
    const made = def.create(this.#ctx);
    this.#instances.set(id, made);
    return made;
  }

  #release(pointer: number): void {
    if (pointer === this.#down) this.#down = -1;
    if (this.#machine.is('eraserEnd')) this.#machine.send('eraserUp');
    else if (this.#heldBy === 'middle') this.#endHand();
  }

  #endHand(): void {
    this.#instance('hand')?.onCancel();
    this.#machine.send('handUp');
    this.#heldBy = 'none';
  }

  #deleteSelection(): boolean {
    const { selection } = this.#ctx.core;
    if (selection.size === 0) return false;
    if (this.#ctx.core.editor.state !== 'closed') return false;
    const ids = [...selection.ids];
    selection.clear();
    deleteShapes(this.#ctx.core, ids);
    this.#ctx.requestFrame();
    return true;
  }
}
