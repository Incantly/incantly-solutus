/**
 * The job `live` (teacher agent.md 1 and 3): the voice lesson. One request (what the learner said, the figure, and on a
 * board the board in view) in, a stream of turn events out. The model says one sentence and calls `draw` (or `board`) in the
 * same reply; the film tools `pause`, `resume`, `seek_beat` and `show_me` move the figure while it talks.
 *
 * What differs from the other jobs: the `say` events are whole sentences (`SentenceSplitter`), so the voice never gets a
 * raw piece of the stream, and the toolset depends on what the request carries. On a figure the tools are `draw`, `figure`
 * and the film tools. On a board they are `board_read`, `board` and the film tools, plus `draw` and `figure` when the request
 * carries the script of the card in focus (the target then holds that figure as well as the board).
 */
import type { App } from '@incantly/sdk';
import { streamErrorOf } from '../errors';
import type { HistoryItem, TurnRequest } from '../prompt/build';
import { SentenceSplitter } from '../stream/sentences';
import { boardTarget } from '../tools/board-target';
import type { BoardRequestData } from '../tools/board-target';
import { toolset } from '../tools/toolset';
import { figureTarget } from '../tools/targets';
import type { TargetOptions } from '../tools/targets';
import type { Target } from '../tools/types';
import type { ModelClient } from './model';
import { runTurn } from './turn';
import type { TurnEvent, TurnLimits } from './turn';

/** The film tools every live lesson has. */
const FILM = ['pause', 'resume', 'seek_beat', 'show_me'] as const;

export interface LiveTurnOptions {
  readonly client: ModelClient;
  /** The figure the lesson draws on: a headless app of the request's mode, loaded with its script and set to its film time. */
  readonly app: App;
  /** The board in view, when the lesson is on a board. */
  readonly board?: BoardRequestData;
  /** What the learner said or typed. */
  readonly text: string;
  /** The last turns, oldest first. */
  readonly history?: readonly HistoryItem[];
  readonly signal?: AbortSignal;
  readonly now: () => number;
  readonly limits?: Partial<TurnLimits>;
  /** Hears a refused move of the target's machines (a bug). */
  readonly onFault?: TargetOptions['onFault'];
}

/**
 * The target of a live lesson. On a figure it is the figure's own. On a board it is the figure of the card in focus with the
 * board's port added, so `board_read` and `board` read the request and the film tools reach the figure's clock.
 */
export function liveTarget(app: App, board: BoardRequestData | undefined, options: TargetOptions = {}): Target {
  const figure = figureTarget(app, options);
  if (board === undefined) return figure;
  const port = boardTarget(board, { mode: app.mode, ...options }).board;
  return port === undefined ? figure : { ...figure, kind: 'board', board: port };
}

/** The tool names of a live lesson (see the file's head). */
export function liveTools(board: boolean, focusHasFigure: boolean): readonly string[] {
  if (!board) return ['draw', 'figure', ...FILM];
  return ['board_read', 'board', ...(focusHasFigure ? ['draw', 'figure'] : []), ...FILM];
}

async function* run(o: LiveTurnOptions): AsyncGenerator<TurnEvent> {
  const target = liveTarget(o.app, o.board, o.onFault !== undefined ? { onFault: o.onFault } : {});
  const tools = toolset(liveTools(o.board !== undefined, target.figureSummary().objects > 0));
  if (!tools.ok) {
    yield { error: streamErrorOf(tools) };
    return;
  }
  const request: TurnRequest = { text: o.text, ...(o.history !== undefined && o.history.length > 0 ? { history: o.history } : {}) };
  const splitter = new SentenceSplitter();
  for await (const ev of runTurn({
    job: 'live',
    client: o.client,
    toolset: tools.value,
    target,
    request,
    now: o.now,
    ...(o.signal !== undefined ? { signal: o.signal } : {}),
    ...(o.limits !== undefined ? { limits: o.limits } : {}),
  })) {
    if ('say' in ev) {
      for (const sentence of splitter.push(ev.say)) yield { say: sentence };
      continue;
    }
    // anything but words ends the sentence being written: a reply's text comes before its tool calls
    for (const sentence of splitter.flush()) yield { say: sentence };
    yield ev;
  }
  for (const sentence of splitter.flush()) yield { say: sentence };
}

/**
 * Runs a live lesson turn. Every `say` is a whole sentence, ready for the voice; `lines`, `actions` and `control` events
 * come between them as the tools run. Never throws; the last event is `done` or `error`.
 */
export function liveTurn(options: LiveTurnOptions): AsyncIterable<TurnEvent> {
  return run(options);
}
