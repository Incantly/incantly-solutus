/**
 * Shared helpers of the lesson round 1 teacher specs (docs/features/lesson/*). Public exports only: `@incantly/teacher`,
 * `@incantly/board/core` types, the kernel's contracts. No network, no DOM.
 */
import type { AgentItem } from '@incantly/board/core';
import { fakeModel, lessonTools, lessonTurn, newMemory, toolset } from '../../src/index';
import type { LessonMemory, RecordedReply, TurnEvent, Toolset, ToolOutcome } from '../../src/index';
import { PAGE, boardTools, makeBoard } from './board-helpers';
import { collect } from './helpers';

export { PAGE };

export const PLAN_5 = ['Vectors', 'Adding vectors', 'Scaling', 'Matrices as moves', 'Solving systems'];

/** The lesson tools plus the board tools, as the lesson job offers them. */
export function lessonToolset(memory: LessonMemory): Toolset {
  const r = toolset(['board_read', 'board'], lessonTools(memory));
  if (!r.ok) throw new Error(`toolset failed: ${r.message}`);
  return r.value;
}

/** A target to call the lesson tools on (they ignore it; the guard still needs one). */
export const aTarget = () => makeBoard([]);

export function call(set: Toolset, name: string, input: unknown): ToolOutcome {
  return set.call(aTarget(), name, input);
}

export function errorKind(o: ToolOutcome): { kind: string; code: string } | undefined {
  const r = o.result;
  return r.ok ? undefined : { kind: r.kind, code: r.code };
}

export const valueOfOk = (o: ToolOutcome): Record<string, unknown> => {
  if (!o.result.ok) throw new Error(`tool failed: ${o.result.kind}: ${o.result.message}`);
  return o.result.value as Record<string, unknown>;
};

/** A reply that calls the lesson tools and the board tool in one go. */
export const planReply = (text: string, steps: readonly string[], actions: readonly unknown[] = []): RecordedReply => ({
  text,
  toolCalls: [{ name: 'lesson_plan', args: { steps } }, ...(actions.length > 0 ? [{ name: 'board', args: { actions } }] : [])],
});

export const textReply = (text: string): RecordedReply => ({ text });

export const write = (text: string, x = 40, y = 40, style: 'hand' | 'typed' = 'typed') => ({ op: 'write', text, at: { x, y }, style });
export const newPage = (name: string) => ({ op: 'page', to: 'new', name });

export interface LessonRun {
  readonly events: TurnEvent[];
  readonly model: ReturnType<typeof fakeModel>;
  readonly memory: LessonMemory;
}

export interface RunOptions {
  readonly memory?: LessonMemory;
  readonly items?: readonly AgentItem[];
  readonly signal?: AbortSignal;
  readonly mode?: string;
  readonly limits?: { ms?: number; modelCalls?: number; toolCalls?: number };
}

/** Runs one lesson turn over a recording. */
export async function runLesson(text: string, replies: readonly RecordedReply[], o: RunOptions = {}): Promise<LessonRun> {
  const model = fakeModel(replies);
  const memory = o.memory ?? newMemory();
  const events = await collect(
    lessonTurn({
      client: model,
      memory,
      board: { page: PAGE, items: o.items ?? [], more: 0 },
      text,
      now: () => 0,
      ...(o.signal !== undefined ? { signal: o.signal } : {}),
      ...(o.mode !== undefined ? { mode: o.mode } : {}),
      ...(o.limits !== undefined ? { limits: o.limits } : {}),
    }),
  );
  return { events, model, memory };
}

export const says = (events: readonly TurnEvent[]): string[] => events.flatMap((e) => ('say' in e ? [e.say] : []));
export const sentActions = (events: readonly TurnEvent[]): Record<string, unknown>[] => events.flatMap((e) => ('actions' in e ? (e.actions as Record<string, unknown>[]) : []));
export const lessonEvents = (events: readonly TurnEvent[]) => events.flatMap((e) => ('lesson' in e ? [e.lesson] : []));
export const finalOf = (events: readonly TurnEvent[]): TurnEvent => events[events.length - 1] as TurnEvent;

export { boardTools };

/** A memory with every part full: 8 steps of 80 characters, a 1,200 character summary, 10 hard notes of 80, 6 turns. */
export function fullMemory(): LessonMemory {
  const m = newMemory('T'.repeat(120));
  m.plan = Array.from({ length: 8 }, (_v, i) => `${i + 1}`.padEnd(80, 's'));
  m.step = 4;
  m.summary = 'S'.repeat(1200);
  m.hard = Array.from({ length: 10 }, (_v, i) => `${i}`.padEnd(80, 'h'));
  m.turns = Array.from({ length: 6 }, (_v, i) => ({ learner: `L${i}`.padEnd(800, 'l'), teacher: `T${i}`.padEnd(800, 't') }));
  return m;
}
