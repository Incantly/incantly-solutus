/**
 * The board target (teacher design 9, board agent.md): what `board_read` and `board` act on when the board is a request.
 * On the server the board is not here: the request carries the items in view, the page and whether the user lets the agent
 * change their work. `board_read` answers from those items (at most 60, the rest counted), and `board` checks every action
 * as the board would (the board core's `readAction`, the `agent_refused` rules, a figure's lines on a headless app). Ids and
 * placing stay with the client, which holds the whole board and checks again as it applies.
 *
 * Nothing here throws. No DOM, timers, network or `Date`.
 */
import { ITEMS_MAX, boardError, boundsOfBox, readAction, sdkMode } from '@incantly/board/core';
import type { AgentItem, BoardAction, BoardError, Box } from '@incantly/board/core';
import { DEFAULT_LIMITS } from '@incantly/kernel';
import type { Result } from '@incantly/kernel';
import { createHeadlessApp } from '@incantly/sdk';
import type { AppModeId, FigureSummary, LineResult } from '@incantly/sdk';
import { faultError } from '../errors';
import { lineResultOf } from './draw';
import { ToolGuard } from './guard';
import { toolInputError } from './schema';
import type { TargetOptions } from './targets';
import { figureTarget } from './targets';
import type { BoardCheck, BoardPort, Target } from './types';

/** The part of a board request the target holds. */
export interface BoardRequestData {
  /** The page the items are from. */
  readonly page: string;
  /** What is in view, or inside the circle, in reading order. */
  readonly items: readonly AgentItem[];
  /** How many more items the area holds than are listed. */
  readonly more: number;
  /** A circle's area, so the answer can be placed near it. */
  readonly circle?: Box;
}

export interface BoardTargetOptions extends TargetOptions {
  /** The app mode the catalogue is for (default `graphing`). */
  readonly mode?: string;
  /** The user lets the agent change their work (default false). */
  readonly allowEdit?: boolean;
}

/** `board_read` schema, for the message of a bad input. */
const READ_SHAPE = { type: 'object' as const, properties: { area: { type: 'array' as const }, page: { type: 'string' as const } } };

/** The most characters of the first message's list of items: 1,200 tokens (4 characters a token). */
export const BOARD_DATA_CHARS = 1200 * 4;

const LAST = '$last';
const isBox = (v: unknown): v is Box => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The shape ids an action names (a shape, `near` something), without `$last`. */
function refsOf(a: BoardAction): string[] {
  const ids: string[] = [];
  const target = (t: unknown): void => {
    if (typeof t === 'string' && t !== LAST && t !== 'all') ids.push(t);
  };
  const place = (p: unknown): void => {
    if (isObject(p) && 'near' in p) target(p['near']);
  };
  switch (a.op) {
    case 'write':
    case 'shape':
    case 'stroke':
    case 'figure':
      place(a.at);
      break;
    case 'arrow':
      target(a.from);
      target(a.to);
      break;
    case 'mark':
    case 'point':
    case 'camera':
      target(a.target);
      break;
    case 'move':
      target(a.id);
      place(a.at);
      break;
    case 'edit':
    case 'delete':
      target(a.id);
      break;
    case 'page':
      break;
  }
  return ids;
}

const gone = (id: string): BoardError => boardError('agent_refused', `There is no shape "${id}" on this page.`, { hint: 'Read the board again with board_read.', detail: { record: id } });

const notModel = (id: string): BoardError =>
  boardError('agent_refused', `The shape "${id}" is the user's, and this request did not ask to change it.`, {
    hint: 'Add a new shape beside it, or ask the user.',
    detail: { record: id, reason: 'not_model' },
  });

/** The kernel's own words for a mode the SDK does not have, in the shape of a line error. */
const badMode = (mode: string, line: number): LineResult => ({
  ok: false,
  kind: 'bad_mode',
  line,
  message: `There is no figure mode "${mode}".`,
  hint: 'Use graphing, geometry or another mode of the app.',
}) as unknown as LineResult;

/** Runs `lines` on a fresh headless figure of `mode`, each on its own as `draw` does; the app is always destroyed. */
function runOnFresh(mode: string, lines: readonly string[]): readonly LineResult[] {
  let app: ReturnType<typeof createHeadlessApp> | undefined;
  try {
    app = createHeadlessApp({ mode: mode as AppModeId });
    return figureTarget(app).run(lines);
  } catch {
    // an unknown mode throws in the SDK: every line then failed
    return lines.map((_l, i) => badMode(mode, i + 1));
  } finally {
    try {
      app?.destroy();
    } catch {
      // nothing to free
    }
  }
}

/** A figure's lines as the board takes them: split at newlines, blanks dropped. */
const flatLines = (lines: readonly string[]): string[] => lines.flatMap((l) => l.split('\n')).filter((l) => l.trim() !== '');

class RequestBoard implements BoardPort {
  readonly page: string;
  /** What changes while an answer is checked: how many `page` actions it made (the items then describe another page). */
  private readonly seen = { pageActions: 0 };

  constructor(
    private readonly data: BoardRequestData,
    private readonly allowEdit: boolean,
  ) {
    this.page = data.page;
  }

  read(input: unknown): Result<Readonly<Record<string, unknown>>> {
    const o = isObject(input) ? input : {};
    if (o['page'] !== undefined && o['page'] !== this.page) {
      return toolInputError('board_read', READ_SHAPE, `Only the page "${this.page}" is in this request.`);
    }
    const area = o['area'];
    if (area !== undefined && !isBox(area)) return toolInputError('board_read', READ_SHAPE, 'area must be [x, y, width, height].');
    let inside = this.data.items;
    if (area !== undefined) {
      const a = boundsOfBox(area);
      inside = this.data.items.filter((i) => {
        const b = boundsOfBox(i.box);
        return b.minX <= a.maxX && b.maxX >= a.minX && b.minY <= a.maxY && b.maxY >= a.minY;
      });
    }
    const items = inside.slice(0, ITEMS_MAX);
    const more = (area === undefined ? this.data.more : 0) + inside.length - items.length;
    return { ok: true, value: { page: this.page, items, more }, notices: [] };
  }

  check(actions: readonly unknown[]): readonly BoardCheck[] {
    return actions.map((raw) => {
      try {
        return this.checkOne(raw);
      } catch (e) {
        return { result: boardError('internal', `The action could not be checked: ${e instanceof Error ? e.message : 'unknown reason'}.`) };
      }
    });
  }

  describe(): { readonly head: string; readonly items: string } {
    const { items, more, circle } = this.data;
    const head = `page: ${this.page}; items listed: ${items.length}${more > 0 ? ` (${more} more not listed)` : ''}${circle !== undefined ? `; the circle's area: [${circle.join(', ')}]` : ''}`;
    const lines = items.map((i) => {
      const text = i.text === undefined ? '' : ` "${i.text.replace(/\s+/g, ' ')}"`;
      return `${i.id} ${i.kind} [${i.box.join(', ')}]${i.shape !== undefined ? ` ${i.shape}` : ''}${i.madeBy === 'model' ? ' (made by you)' : ''}${i.summary !== undefined ? `: ${i.summary}` : ''}${text}`;
    });
    const text = lines.join('\n');
    return { head, items: text.length <= BOARD_DATA_CHARS ? text : `${text.slice(0, BOARD_DATA_CHARS - 1)}…` };
  }

  private checkOne(raw: unknown): BoardCheck {
    const read = readAction(raw);
    if (!read.ok) return { result: read };
    const a = read.value;
    // after a `page` action the items describe another page: the board, which holds it, makes these checks
    if (this.seen.pageActions === 0) {
      const refused = this.refusal(a);
      if (refused !== undefined) return { result: refused };
    }
    switch (a.op) {
      case 'figure':
        return this.checkFigure(a);
      case 'page':
        this.seen.pageActions += 1;
        return { result: { ok: true }, send: a };
      default:
        return { result: { ok: true }, send: a };
    }
  }

  /** The `agent_refused` rules that the request alone can decide: a shape that is not there, and one the user made. */
  private refusal(a: BoardAction): BoardError | undefined {
    const known = new Map(this.data.items.map((i) => [i.id, i]));
    // a shape beyond the listed items cannot be told gone
    if (this.data.more === 0) {
      for (const id of refsOf(a)) if (!known.has(id)) return gone(id);
    }
    if (!this.allowEdit && (a.op === 'edit' || a.op === 'move' || a.op === 'delete') && a.id !== LAST) {
      if (known.get(a.id)?.madeBy !== 'model') return notModel(a.id);
    }
    return undefined;
  }

  private checkFigure(a: Extract<BoardAction, { op: 'figure' }>): BoardCheck {
    const mode = sdkMode(a.mode ?? 'graphing');
    const lines = flatLines(a.lines);
    const results = runOnFresh(mode, lines);
    const good = lines.filter((_l, i) => results[i]?.ok === true);
    const errors = results.filter((r) => !r.ok);
    if (good.length === 0) {
      return { result: boardError('figure_failed', "None of the figure's lines ran.", { hint: 'Fix the lines and send the figure again.', detail: { lines: errors } }) };
    }
    return { result: { ok: true, lines: results.map(lineResultOf), applied: good.length }, send: { ...a, lines: good } };
  }
}

/** The figure summary of a board target: the board holds no figure of its own. */
function emptySummary(mode: string): FigureSummary {
  return { mode: mode as AppModeId, objects: 0, undefined: [], view: { x0: -10, x1: 10, y0: -10, y1: 10, widthPx: 800, heightPx: 600 }, t: 0, sample: [] };
}

/**
 * A board target over the request's items. The tools `board_read` and `board` use `target.board`; a figure tool has no
 * figure here (a figure card's lines go through the `figure` action, which reports each line).
 */
export function boardTarget(data: BoardRequestData, options: BoardTargetOptions = {}): Target {
  const mode = options.mode ?? 'graphing';
  return {
    kind: 'board',
    mode,
    guard: new ToolGuard(options.onFault),
    lineLimit: DEFAULT_LIMITS.lineLength,
    run: (lines) => lines.map(() => faultError('boardTarget', 'This target has no figure to run lines on; send a figure action with the board tool.')),
    objects: () => ({ list: [], truncated: false }),
    figureSummary: () => emptySummary(mode),
    undefinedObjects: () => [],
    clock: { t: 0, play: () => undefined, pause: () => undefined, seek: () => undefined },
    board: new RequestBoard(data, options.allowEdit === true),
  };
}
