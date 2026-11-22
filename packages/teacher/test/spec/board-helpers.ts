/**
 * Shared helpers of the round-3 teacher specs (board on the real AI). Only public exports: `@incantly/teacher`,
 * `@incantly/board/core` types, the SDK and the kernel. No network, no DOM.
 */
import type { AgentItem, BoardAgentRequest } from '@incantly/board/core';
import { boardTarget, boardTurn, fakeModel, toolset } from '../../src/index';
import type { BoardRequestData, BoardTargetOptions, ModelClient, RecordedReply, Target, ToolOutcome, Toolset, TurnEvent } from '../../src/index';
import { collect } from './helpers';

export const PAGE = 'page:1';

/** An item the user made: no `madeBy`. */
export const userItem = (id: string, over: Partial<AgentItem> = {}): AgentItem => ({ id, kind: 'rect', box: [0, 0, 100, 50], ...over });

/** An item the agent made. */
export const modelItem = (id: string, over: Partial<AgentItem> = {}): AgentItem => ({ id, kind: 'text', box: [0, 100, 100, 30], text: 'made by the agent', madeBy: 'model', ...over });

/** `n` items in a column, ids `shape:i1..in`. */
export const manyItems = (n: number, over: (i: number) => Partial<AgentItem> = () => ({})): AgentItem[] =>
  Array.from({ length: n }, (_v, i) => ({ id: `shape:i${i + 1}`, kind: 'rect', box: [0, i * 60, 100, 50] as const, ...over(i + 1) }));

/** A board target over `items`, page `PAGE`. */
export function makeBoard(items: readonly AgentItem[] = [], options: BoardTargetOptions = {}, more = 0, extra: Partial<BoardRequestData> = {}): Target {
  return boardTarget({ page: PAGE, items, more, ...extra }, options);
}

/** The built-in board tools. */
export function boardTools(): Toolset {
  const r = toolset(['board_read', 'board']);
  if (!r.ok) throw new Error(`toolset failed: ${r.message}`);
  return r.value;
}

/** The value of a tool outcome (fails the test on an error). */
export function valueOf(o: ToolOutcome): Record<string, unknown> {
  if (!o.result.ok) throw new Error(`tool failed: ${o.result.kind}: ${o.result.message}`);
  return o.result.value as Record<string, unknown>;
}

/** The per-action results of a `board` call. */
export function results(o: ToolOutcome): Record<string, unknown>[] {
  const list = valueOf(o)['results'];
  if (!Array.isArray(list)) throw new Error('the board result has no "results" list');
  return list as Record<string, unknown>[];
}

/** The actions a `board` call sent on (the `actions` events of its outputs), flattened. */
export function sentActions(o: ToolOutcome): Record<string, unknown>[] {
  return o.outputs.flatMap((x) => ('actions' in x ? (x.actions as Record<string, unknown>[]) : []));
}

/** Calls a board tool on a target. */
export function callBoard(target: Target, actions: unknown): ToolOutcome {
  return boardTools().call(target, 'board', { actions });
}
export function callRead(target: Target, input: unknown = {}): ToolOutcome {
  return boardTools().call(target, 'board_read', input);
}

/** A reply that calls `board` with these actions. */
export const boardReply = (actions: readonly unknown[], text?: string): RecordedReply => ({ ...(text !== undefined ? { text } : {}), toolCalls: [{ name: 'board', args: { actions } }] });
export const readReply = (input: Record<string, unknown> = {}): RecordedReply => ({ toolCalls: [{ name: 'board_read', args: input }] });

export const circleRequest = (over: Partial<Extract<BoardAgentRequest, { kind: 'circle' }>> = {}): Extract<BoardAgentRequest, { kind: 'circle' }> => ({
  kind: 'circle',
  choice: 'graph',
  items: [userItem('shape:a1', { kind: 'ink', shape: 'curve', box: [120, 40, 300, 180] })],
  more: 0,
  circle: [100, 20, 340, 220],
  page: PAGE,
  ...over,
});

export const talkRequest = (over: Partial<Extract<BoardAgentRequest, { kind: 'talk' }>> = {}): Extract<BoardAgentRequest, { kind: 'talk' }> => ({
  kind: 'talk',
  text: 'Write the formula under the triangle',
  items: [userItem('shape:t1', { kind: 'triangle' })],
  more: 0,
  page: PAGE,
  allowEdit: false,
  ...over,
});

export interface BoardRun {
  readonly events: TurnEvent[];
  readonly model: ReturnType<typeof fakeModel>;
}

/** Runs `boardTurn` over a recording. */
export async function runBoard(request: BoardAgentRequest, replies: readonly RecordedReply[], options: { client?: ModelClient; signal?: AbortSignal; limits?: { ms?: number; modelCalls?: number; toolCalls?: number }; image?: { mime: 'image/png'; data: string } } = {}): Promise<BoardRun> {
  const model = fakeModel(replies);
  const events = await collect(
    boardTurn({
      client: options.client ?? model,
      request,
      now: () => 0,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.limits !== undefined ? { limits: options.limits } : {}),
      ...(options.image !== undefined ? { image: options.image } : {}),
    }),
  );
  return { events, model };
}

export const actionsOf = (events: readonly TurnEvent[]): Record<string, unknown>[] => events.flatMap((e) => ('actions' in e ? (e.actions as Record<string, unknown>[]) : []));
export const lastEvent = (events: readonly TurnEvent[]): TurnEvent => events[events.length - 1] as TurnEvent;

/** The material blocks of a message, and the text outside them. */
export function splitMaterial(text: string): { inside: string[]; outside: string } {
  const inside: string[] = [];
  const outside = text.replace(/<material>\n?([\s\S]*?)\n?<\/material>/g, (_m, body: string) => {
    inside.push(body);
    return '';
  });
  return { inside, outside };
}
