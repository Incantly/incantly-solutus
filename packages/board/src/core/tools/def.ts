/**
 * `ToolDef` and the list of tools (design 10): a tool is an id, a label, a key and handlers that turn input into core
 * calls. Built-in tools use the same interface a host's own tool does; `defaultTools` is a list a host filters with
 * `without` and extends with `with`. Each tool's states are a `*_MACHINE` table (docs/state-machines.md B7 to B11).
 */
import type { Camera } from '../camera';
import type { BoardCore } from '../board';
import type { CircleAsk } from '../circle';
import type { GuideLine, OverlayItems, TrailView } from '../draw';
import type { Bounds } from '../types';
import type { InputSample, KeyInput } from '../input';
import type { PenStyle } from '../ink/live';
import type { Dash, FontFamily } from '../paint';

/** What the pen, the highlighter and the eraser draw with. The host or the style bar changes them. */
export interface ToolStyles {
  pen: PenStyle;
  highlighter: PenStyle;
  eraser: { mode: 'whole' | 'partial'; /** Screen pixels. */ radius: number };
  /** What new shapes are made with, and what the style bar shows (round 3). */
  shape: ShapeStyle;
  /** False turns off the pen's hold that fixes a rough shape (design 7.3); default on. */
  fixHold: boolean;
}

/** The style bar's choices for a new shape and for the selection: colour, fill, dash, size and font. */
export interface ShapeStyle {
  color: string;
  /** A colour, or `none`. */
  fill: string;
  dash: Dash;
  /** A line width in page units; text takes a size from it. */
  size: number;
  font: FontFamily;
}

export function defaultStyles(): ToolStyles {
  return {
    pen: { nib: 'pen', size: 3, color: '#1f2430', opacity: 1 },
    highlighter: { nib: 'highlighter', size: 18, color: '#ffd400', opacity: 0.4 },
    eraser: { mode: 'whole', radius: 10 },
    shape: { color: '#1f2430', fill: 'none', dash: 'solid', size: 4, font: 'sans' },
    fixHold: true,
  };
}

/** What the tools put on the overlay; the painter draws it each frame. */
export interface OverlayState {
  laser: TrailView | null;
  loop: OverlayItems['loop'];
  cursor: OverlayItems['cursor'];
  /** Snap guides, the selection box and the arrow target hint (round 3); the select tool writes them. */
  guides: readonly GuideLine[];
  marquee: Bounds | null;
  hint: readonly number[] | null;
}

export const createOverlayState = (): OverlayState => ({ laser: null, loop: null, cursor: null, guides: [], marquee: null, hint: null });

/** What a tool may use. */
export interface ToolContext {
  readonly core: BoardCore;
  readonly styles: ToolStyles;
  readonly overlay: OverlayState;
  /** The camera of the current page; undefined when the board has no page. */
  camera(): Camera | undefined;
  /** Asks for a frame (a tool changed something the painter shows). */
  requestFrame(): void;
  /** A stroke was stored: the live layer holds it until the frame that draws its tile. */
  strokeEnded(): void;
  /** A stroke was dropped. */
  strokeDropped(): void;
  /** Chooses another tool (a shape tool hands back to the select tool when its shape is made). */
  setTool?(id: string): void;
  /**
   * A double click or Enter on a shape that has no text of its own (a figure card): the shell may use it. True when it did,
   * so the key was used.
   */
  activate?(id: string): boolean;
  /** Circle to ask (round 5): the Ask tool feeds it points. Without it the Ask tool says there is no agent. */
  readonly circle?: CircleAsk;
  /** Shows the user a short note (the board's status line). */
  say?(text: string): void;
}

export interface ToolHandlers {
  /** The tool's own state, from its `*_MACHINE` table. */
  readonly state: string;
  onDown(s: InputSample): void;
  onMove(s: InputSample): void;
  onUp(s: InputSample): void;
  /** A pen or mouse over the board with nothing down. */
  onHover?(s: InputSample): void;
  /** A guess of a future sample; drawn on the overlay and never stored. */
  onPredicted?(s: InputSample): void;
  /** The tool is dropped mid-gesture (a second finger, a page change, another tool). */
  onCancel(): void;
  /** True when the tool used the key. */
  onKey?(k: KeyInput): boolean;
  /** Called every frame with the input clock; true while the tool still wants frames (a fading trail). */
  tick?(now: number): boolean;
}

export interface ToolDef {
  readonly id: string;
  /** The words on the button and in the tooltip. */
  readonly label: string;
  /** A key such as `p` or `shift+p`; the host may change it. */
  readonly key?: string;
  /** The CSS cursor over the board while the tool is chosen. */
  readonly cursor?: string;
  create(ctx: ToolContext): ToolHandlers;
}

/** A list of tools. `with` and `without` give a new list, so `defaultTools` is never changed. */
export class ToolList {
  readonly #defs: readonly ToolDef[];

  constructor(defs: readonly ToolDef[]) {
    this.#defs = defs;
  }

  get defs(): readonly ToolDef[] {
    return this.#defs;
  }

  ids(): readonly string[] {
    return this.#defs.map((d) => d.id);
  }

  get(id: string): ToolDef | undefined {
    return this.#defs.find((d) => d.id === id);
  }

  /** The list with `def` added, or replacing the tool of the same id. */
  with(def: ToolDef): ToolList {
    const at = this.#defs.findIndex((d) => d.id === def.id);
    return new ToolList(at < 0 ? [...this.#defs, def] : this.#defs.map((d, i) => (i === at ? def : d)));
  }

  /** The list without the tools of these ids. */
  without(...ids: readonly string[]): ToolList {
    return new ToolList(this.#defs.filter((d) => !ids.includes(d.id)));
  }
}
