/**
 * The board tools a model uses (agent.md 1): `board_read` and `board`. This file has their definitions (names and plain
 * JSON input schemas, for the teacher package to put in its prompt) and the runner that carries them out
 * (docs/state-machines.md B31). A `board` call is 1 to 20 actions, applied in order in one gesture with origin `model`:
 * each action is one transaction, a failed action changes nothing and does not stop the rest, and one undo takes the whole
 * call back. No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { applyAction } from './agent-actions';
import type { CallState } from './agent-actions';
import type { HandPlayer } from './agent-hand';
import { readBoard } from './agent-read';
import type { FigureHost } from './agent-read';
import { ACTIONS_MAX, ITEMS_MAX, OPS, SHAPE_KINDS, MARK_HOWS, SIDES, readActions } from './agent-types';
import type { ActionResult, ReadResult } from './agent-types';
import type { BoardCore } from './board';
import { beginGesture } from './edit';
import type { Gesture } from './edit';
import type { BoardError, BoardResult } from './errors';
import { boardError, ok, refusedMove } from './errors';
import { sendIfAble } from './machine';
import type { Bounds } from './types';

/** A tool as a model's prompt wants it: a name, a description and a plain JSON schema. */
export interface AgentToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

const BOX = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '[x, y, width, height] in page units' };
const TARGET = { description: 'A shape id, "$last" (the shape the previous action made) or an area [x, y, width, height].', oneOf: [{ type: 'string' }, BOX] };
const PLACE = {
  description: 'Where it goes: { x, y } (the top left of its box), { near, side } (the board finds a free spot on that side and never covers other shapes), or "free" (the nearest empty spot in view).',
  oneOf: [
    { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    { type: 'object', properties: { near: TARGET, side: { type: 'string', enum: [...SIDES] } }, required: ['near', 'side'] },
    { type: 'string', enum: ['free'] },
  ],
};

export const BOARD_READ_TOOL: AgentToolDef = Object.freeze({
  name: 'board_read',
  description: `Reads the board: the items in an area (default: what is in view) in reading order, each { id, kind, box, text?, summary?, shape?, madeBy? } ("madeBy" is "model" on what the agent made). At most ${ITEMS_MAX} items are listed; "more" counts the rest. Read before you write when the request names something on the board.`,
  inputSchema: { type: 'object', properties: { area: BOX, page: { type: 'string', description: 'A page id; default the current page.' } }, additionalProperties: false },
});

export const BOARD_TOOL: AgentToolDef = Object.freeze({
  name: 'board',
  description: `Changes the board with ${ACTIONS_MAX} actions at most, in order. Each action is one undoable change; one that fails changes nothing and the rest still run. Results: { ok: true, id } or an error. Place new things near what they explain; do not change the user's work unless asked.`,
  inputSchema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        minItems: 1,
        maxItems: ACTIONS_MAX,
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: [...OPS] },
            text: { type: 'string', description: 'write, edit. $…$ is maths. For a figure card, edit takes its lines.' },
            style: { type: 'string', enum: ['hand', 'typed'], description: 'write: hand is the handwriting font (the default); typed is a plain font and appears at once.' },
            kind: { type: 'string', enum: [...SHAPE_KINDS] },
            at: PLACE,
            w: { type: 'number' },
            h: { type: 'number' },
            size: { type: 'number' },
            color: { type: 'string', description: '#rgb or #rrggbb' },
            label: { type: 'string' },
            from: TARGET,
            to: { description: 'arrow: a Target. page: a page id, "new", "next" or "previous".', oneOf: [{ type: 'string' }, BOX] },
            points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
            lines: { type: 'array', items: { type: 'string' }, description: 'figure: lines of an Incantly script.' },
            mode: { type: 'string', description: 'figure: graphing, geometry, …' },
            target: { description: 'mark, point, camera: a Target, or "all" for camera.', oneOf: [{ type: 'string' }, BOX] },
            how: { type: 'string', enum: [...MARK_HOWS] },
            id: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['op'],
        },
      },
    },
    required: ['actions'],
    additionalProperties: false,
  },
});

/** The board tools, for the prompt. */
export const boardTools: readonly AgentToolDef[] = Object.freeze([BOARD_READ_TOOL, BOARD_TOOL]);

type RunnerState = 'idle' | 'running' | 'stopping';
type RunnerEvent = 'run' | 'done' | 'stop';

export const RUNNER_MACHINE: MachineTable<RunnerState, RunnerEvent> = {
  idle: { run: 'running' },
  running: { done: 'idle', stop: 'stopping' },
  stopping: { done: 'idle' },
};

export interface AgentOptions {
  /** The part of the current page on screen, in page units; default 1280 by 720 units at the camera. */
  readonly view?: () => Bounds;
  /** The size of the screen in pixels, for the `camera` action; default 1280 by 720. */
  readonly viewSize?: () => { readonly w: number; readonly h: number };
  /** The input layer's time in milliseconds, for the camera; default 0. */
  readonly clock?: () => number;
  /** True when the user asked for reduced motion: hand-style actions then appear at once. */
  readonly reducedMotion?: () => boolean;
  /** The SDK: runs a figure's lines and tells what a figure shows. Without it every line is accepted. */
  readonly figures?: FigureHost;
  /** Draws hand-style actions on the live layer. Without it they appear at once. */
  readonly hand?: HandPlayer;
  /** A `point` action: show the laser over this box. Nothing is stored. */
  readonly onPoint?: (box: Bounds) => void;
  /** Where the agent is working now (the hand icon of the panel). */
  readonly onHand?: (at: { readonly x: number; readonly y: number }) => void;
}

export interface RunOptions {
  /** The call may edit, move and delete shapes the model did not make (the user asked for it). Default false. */
  readonly allowForeign?: boolean;
  /**
   * The gesture of a whole answer (the service gives one to each job, so every call of a streamed answer is one undo
   * step). The caller commits it. Without one the call makes its own and commits it when it ends.
   */
  readonly gesture?: Gesture;
}

const DEFAULT_SIZE = { w: 1280, h: 720 };

/** The runner of the board tools for one board. */
export class BoardAgent {
  readonly core: BoardCore;
  readonly #options: AgentOptions;
  readonly #machine = new StateMachine(RUNNER_MACHINE, 'idle', refusedMove('agent runner', () => this.core.store.sink));
  /** Raised by `stop`; a call that began before it is stopped, one that begins after it is not. */
  #epoch = 0;
  /** The calls wait for each other here. */
  #queue: Promise<unknown> = Promise.resolve();
  /** The shape the previous action made: `$last` carries over from one call of a streamed answer to the next. */
  #last: string | undefined;

  constructor(core: BoardCore, options: AgentOptions = {}) {
    this.core = core;
    this.#options = options;
  }

  /** `idle`, `running` or `stopping`. */
  get state(): RunnerState {
    return this.#machine.state;
  }

  /** `board_read`. */
  read(input?: unknown): BoardResult<ReadResult> {
    return readBoard(this.core, input, { view: () => this.#view(), ...(this.#options.figures !== undefined ? { figures: this.#options.figures } : {}) });
  }

  /**
   * `board`: applies the actions in order. The answer has one result for each action. Nothing throws; a call that cannot
   * be read (not a list, none, more than 20) is an error and changes nothing.
   */
  run(input: unknown, request: RunOptions = {}): Promise<BoardResult<readonly ActionResult[]>> {
    const list = readActions(input);
    if (!list.ok) return Promise.resolve(list);
    const epoch = this.#epoch;
    const call = this.#queue.then(() => this.#apply(list.value, request, epoch));
    this.#queue = call.catch(() => undefined);
    return call;
  }

  /** Runs the tool of this name (`board_read` or `board`), as a model's tool call arrives. */
  async tool(name: string, input: unknown, request: RunOptions = {}): Promise<BoardResult<unknown>> {
    if (name === BOARD_READ_TOOL.name) return this.read(input);
    if (name === BOARD_TOOL.name) return this.run(input, request);
    return boardError('bad_argument', `There is no board tool "${name}".`, { hint: `The tools are ${boardTools.map((t) => t.name).join(' and ')}.`, detail: { tool: name } });
  }

  /** `$last` names nothing until an action makes a shape (a new request begins). */
  forget(): void {
    this.#last = undefined;
  }

  /** Ends the call that is running at once (what it made stays) and drops the calls waiting. */
  stop(): void {
    sendIfAble(this.#machine, 'stop');
    this.#epoch++;
    this.#options.hand?.cancel();
  }

  #view(): Bounds {
    if (this.#options.view !== undefined) return this.#options.view();
    const camera = this.core.camera;
    return camera === undefined ? { minX: 0, minY: 0, maxX: DEFAULT_SIZE.w, maxY: DEFAULT_SIZE.h } : camera.visibleBounds(DEFAULT_SIZE.w, DEFAULT_SIZE.h);
  }

  async #apply(actions: readonly unknown[], request: RunOptions, epoch: number): Promise<BoardResult<readonly ActionResult[]>> {
    const stoppedNow = (): boolean => epoch !== this.#epoch;
    const results: ActionResult[] = [];
    const notRun = (): BoardError => boardError('agent_partial', 'The agent was stopped before this action ran.', { detail: { stopped: true } });
    if (stoppedNow() || !this.#machine.send('run')) {
      for (let i = 0; i < actions.length; i++) results.push(notRun());
      return ok(results);
    }
    const own = request.gesture === undefined;
    const gesture = request.gesture ?? beginGesture(this.core, 'model');
    const call: CallState = { gesture, allowForeign: request.allowForeign === true, last: this.#last, stopped: stoppedNow };
    const o = this.#options;
    const env = {
      view: () => this.#view(),
      viewSize: () => o.viewSize?.() ?? DEFAULT_SIZE,
      clock: () => o.clock?.() ?? 0,
      reducedMotion: () => o.reducedMotion?.() === true,
      ...(o.figures !== undefined ? { figures: o.figures } : {}),
      ...(o.hand !== undefined ? { hand: o.hand } : {}),
      ...(o.onPoint !== undefined ? { onPoint: o.onPoint } : {}),
      ...(o.onHand !== undefined ? { onHand: o.onHand } : {}),
    };
    try {
      for (const action of actions) {
        if (stoppedNow()) {
          results.push(notRun());
          continue;
        }
        results.push(await applyAction(this.core, action, call, env));
      }
    } finally {
      this.#last = call.last;
      if (own) gesture.commit();
      sendIfAble(this.#machine, 'done');
    }
    return ok(results);
  }
}
