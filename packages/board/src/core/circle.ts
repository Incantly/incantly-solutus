/**
 * Circle to ask (design 11.1, docs/state-machines.md B33). The user circles part of the board with the Ask tool (or the
 * pen's barrel button held). The core finds what is inside, builds a short description of each item, and offers
 * suggestions at once from the item kinds alone (no server, no wait). Picking one sends agent.md 3's request through the
 * agent service; the answer lands on the board as a card near the circle with an arrow to it. No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { itemsOf } from './agent-read';
import type { FigureHost } from './agent-read';
import { CIRCLE_CHOICES } from './agent-service';
import type { AgentOutcome, AgentService, BoardAgentRequest, CircleChoice } from './agent-service';
import type { AgentItem, Box } from './agent-types';
import type { BoardCore } from './board';
import type { BoardResult } from './errors';
import { boardError, refusedMove } from './errors';
import { isInk, shapeGeometry } from './geometry';
import { pointInPolygon } from './index-grid';
import { mostlyInside } from './ink/geometry';
import { sendIfAble } from './machine';
import type { Bounds, ShapeRecord } from './types';

type CircleState = 'idle' | 'drawing' | 'choosing' | 'asking';
type CircleEvent = 'down' | 'move' | 'up' | 'cancel' | 'pick' | 'dismiss' | 'finish';

export const CIRCLE_MACHINE: MachineTable<CircleState, CircleEvent> = {
  idle: { down: 'drawing' },
  drawing: { move: 'drawing', up: 'choosing', cancel: 'idle' },
  choosing: { pick: 'asking', down: 'drawing', dismiss: 'idle' },
  asking: { finish: 'idle', down: 'drawing', dismiss: 'idle' },
};

/** What a suggestion says on its button. */
export const CIRCLE_LABELS: Readonly<Record<CircleChoice, string>> = Object.freeze({
  graph: 'Graph it',
  formula: 'Find its formula',
  solve: 'Solve it',
  steps: 'Show the steps',
  measure: 'Measure it',
  geometry: 'Make it a geometry figure',
  explain: 'Explain it',
  animate: 'Animate it',
  slider: 'Add a slider',
  ask: 'Ask something else…',
});

export interface Suggestion {
  readonly choice: CircleChoice;
  readonly label: string;
}

const POLYGONS = new Set(['triangle', 'quadrilateral', 'rectangle', 'square', 'pentagon', 'hexagon', 'polygon']);
const POLYGON_KINDS = new Set(['triangle', 'diamond', 'star', 'rect']);
const MATHS = /\$[^$]+\$|[=^]|\d\s*[+\-*/]\s*\d/;
const TEXT_KINDS = new Set(['text', 'sticky']);

/** The suggestions for what is in the circle, from the kinds alone (the table of design 11.1); the last is always `ask`. */
export function suggestionsFor(items: readonly AgentItem[]): readonly Suggestion[] {
  const choices: CircleChoice[] = [];
  const add = (...list: CircleChoice[]): void => {
    for (const c of list) if (!choices.includes(c)) choices.push(c);
  };
  if (items.some((i) => i.kind === 'ink' && i.shape === 'curve')) add('graph', 'formula');
  if (items.some((i) => TEXT_KINDS.has(i.kind) && i.text !== undefined && MATHS.test(i.text))) add('solve', 'steps', 'graph');
  if (items.some((i) => (i.kind === 'ink' && i.shape !== undefined && POLYGONS.has(i.shape)) || POLYGON_KINDS.has(i.kind))) add('measure', 'geometry');
  if (items.some((i) => i.kind === 'figure')) add('explain', 'animate', 'slider');
  add('ask');
  return choices.map((choice) => ({ choice, label: CIRCLE_LABELS[choice] }));
}

/** What the circle found. */
export interface Found {
  readonly items: readonly AgentItem[];
  readonly more: number;
  /** The loop's box in page units, `[x, y, width, height]`. */
  readonly box: Box;
}

const NOTHING: Found = Object.freeze({ items: Object.freeze([]) as readonly AgentItem[], more: 0, box: Object.freeze([0, 0, 0, 0]) as unknown as Box });

export interface CircleOptions {
  /** The SDK, to summarise figure cards. */
  readonly figures?: FigureHost;
  /** A picture of an area as a data URL; given only when the board reads pictures (`agent.vision`). */
  readonly picture?: (area: Bounds) => string | undefined;
  /** Tells the shell that a request began, so the panel can show the answer arriving. */
  readonly onAsk?: () => void;
}

export class CircleAsk {
  readonly core: BoardCore;
  readonly service: AgentService;
  readonly #options: CircleOptions;
  readonly #machine = new StateMachine(CIRCLE_MACHINE, 'idle', refusedMove('circle to ask', () => this.core.store.sink));
  readonly #listeners = new Set<() => void>();
  #xy = new Float32Array(256);
  #count = 0;
  #found: Found = NOTHING;
  #suggestions: readonly Suggestion[] = [];

  constructor(core: BoardCore, service: AgentService, options: CircleOptions = {}) {
    this.core = core;
    this.service = service;
    this.#options = options;
  }

  /** `idle`, `drawing`, `choosing` or `asking`. */
  get state(): CircleState {
    return this.#machine.state;
  }

  /** The loop for the overlay, in page units (`x, y` pairs). */
  view(): { readonly xy: Float32Array; readonly count: number } {
    return { xy: this.#xy, count: this.#count };
  }

  /** What the loop holds, once it is closed. */
  get found(): Found {
    return this.#found;
  }

  get suggestions(): readonly Suggestion[] {
    return this.#suggestions;
  }

  /** Calls `listener` when the state, the loop or the suggestions change. */
  on(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** The pointer went down at a page point: a new loop begins (any loop before it goes). */
  down(x: number, y: number): boolean {
    if (!this.#machine.can('down')) return false;
    this.#machine.send('down');
    this.#empty();
    this.#push(x, y);
    this.#changed();
    return true;
  }

  move(x: number, y: number): void {
    if (!this.#machine.is('drawing')) return;
    this.#push(x, y);
    this.#changed();
  }

  /** The pointer came up: the loop closes. Fewer than 3 points is no loop. */
  up(): void {
    if (!this.#machine.is('drawing')) return;
    if (this.#count < 3) {
      this.cancel();
      return;
    }
    const found = this.#find();
    this.#machine.send('up');
    this.#found = found;
    this.#suggestions = suggestionsFor(found.items);
    this.#changed();
  }

  /** The loop is dropped (a second finger, another tool). */
  cancel(): void {
    if (!sendIfAble(this.#machine, 'cancel')) return;
    this.#empty();
    this.#changed();
  }

  /** The suggestions are put away (Esc, a press elsewhere). The running request is not stopped; Stop is the panel's. */
  dismiss(): void {
    if (!sendIfAble(this.#machine, 'dismiss')) return;
    this.#empty();
    this.#changed();
  }

  /**
   * The user picked a suggestion. The request of agent.md 3 goes to the service and the answer is applied as it
   * streams in. `ask` needs the user's words. Nothing throws.
   */
  async pick(choice: CircleChoice, text?: string): Promise<BoardResult<AgentOutcome>> {
    if (!CIRCLE_CHOICES.includes(choice)) return boardError('bad_argument', `"${String(choice)}" is not a suggestion.`, { detail: { choice } });
    if (!this.#machine.can('pick')) return boardError('bad_argument', 'There is no circle to ask about.', { hint: 'Circle something with the Ask tool first.', detail: { state: this.#machine.state } });
    const words = text?.trim() ?? '';
    if (choice === 'ask' && words === '') return boardError('bad_argument', 'Write what you want to ask.', { detail: { choice } });
    const page = this.core.pages.current;
    if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
    const found = this.#found;
    const area: Bounds = { minX: found.box[0], minY: found.box[1], maxX: found.box[0] + found.box[2], maxY: found.box[1] + found.box[3] };
    const picture = this.#options.picture?.(area);
    const request: BoardAgentRequest = {
      kind: 'circle',
      choice,
      ...(choice === 'ask' ? { text: words } : {}),
      items: found.items,
      more: found.more,
      circle: found.box,
      ...(picture !== undefined ? { picture } : {}),
      page,
    };
    this.#machine.send('pick');
    this.#options.onAsk?.();
    this.#changed();
    const outcome = await this.service.ask(request, choice === 'ask' ? words : CIRCLE_LABELS[choice]);
    // a newer circle may have begun while the answer streamed in; it has the machine now
    if (sendIfAble(this.#machine, 'finish')) {
      this.#empty();
      this.#changed();
    }
    return outcome;
  }

  #push(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if ((this.#count + 1) * 2 > this.#xy.length) {
      const grown = new Float32Array(this.#xy.length * 2);
      grown.set(this.#xy);
      this.#xy = grown;
    }
    this.#xy[this.#count * 2] = x;
    this.#xy[this.#count * 2 + 1] = y;
    this.#count++;
  }

  #empty(): void {
    this.#count = 0;
    this.#found = NOTHING;
    this.#suggestions = [];
  }

  /** The shapes inside the loop, as the lasso counts them, with the locked ones too (the agent may read them). */
  #find(): Found {
    const polygon = Array.from(this.#xy.subarray(0, this.#count * 2));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < polygon.length; i += 2) {
      minX = Math.min(minX, polygon[i] as number);
      maxX = Math.max(maxX, polygon[i] as number);
      minY = Math.min(minY, polygon[i + 1] as number);
      maxY = Math.max(maxY, polygon[i + 1] as number);
    }
    const box: Box = [Math.round(minX), Math.round(minY), Math.round(maxX - minX), Math.round(maxY - minY)];
    const { index, store } = this.core;
    const ids: string[] = [];
    const whole: boolean[] = [];
    index.grid.queryLassoSplit(polygon, ids, whole);
    const inside: ShapeRecord[] = [];
    for (let i = 0; i < ids.length; i++) {
      const shape = index.shape(ids[i] as string);
      if (shape === undefined || shape.kind === 'group') continue;
      if (!isInk(shape)) {
        const g = shapeGeometry(shape, store.kinds);
        if (g !== undefined && pointInPolygon(g.pageCx, g.pageCy, polygon)) inside.push(shape);
        continue;
      }
      if (shape.props.points.length === 0) continue;
      if (whole[i] === true || mostlyInside(shape, polygon)) inside.push(shape);
    }
    const read = itemsOf(this.core, inside, this.#options.figures);
    return { items: read.items, more: read.more, box };
  }

  #changed(): void {
    for (const l of [...this.#listeners]) {
      try {
        l();
      } catch (e) {
        this.core.store.sink(boardError('internal', `A listener of the circle threw: ${e instanceof Error ? e.message : 'unknown'}.`));
      }
    }
  }
}
