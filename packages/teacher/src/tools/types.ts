/**
 * The shapes tools share (docs/features/teacher/design.md 4 and 9): a tool, a toolset, the target a tool acts on, and
 * what a tool run gives the turn loop. All plain data and functions; no DOM, timers, network or `Date`.
 */
import type { Result } from '@incantly/kernel';
import type { FigureSummary, LineResult, ObjectSummary } from '@incantly/sdk';
import type { ToolGuard } from './guard';

/** Plain data that survives JSON. */
export type JsonLike = null | boolean | number | string | readonly JsonLike[] | { readonly [key: string]: JsonLike };

/** The subset of JSON Schema the tools use (the model reads it; `checkSchema` enforces it). */
export interface JsonSchema {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly (string | number)[];
}

/** What a successful tool returns: a plain object the model reads as JSON. */
export type ToolValue = Readonly<Record<string, unknown>>;

/** The lesson as the learner's screen shows it: the plan, the step now (1 based, 0 with no plan) and what the lesson is doing. */
export interface LessonView {
  readonly plan: readonly string[];
  readonly step: number;
  readonly state: string;
}

/** What a tool run asks the turn to send out besides its result. */
export type TurnOutput =
  | { readonly lines: readonly string[] }
  | { readonly actions: readonly unknown[] }
  | { readonly control: { readonly op: 'pause' | 'resume' | 'seek'; readonly t?: number } }
  | { readonly lesson: LessonView };

export type ToolRun = (target: Target, input: unknown) => Result<ToolValue>;

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonSchema;
  /** Never throws; a bad input is `tool_input` (T001). */
  readonly run: ToolRun;
  /** The events a successful run adds to the turn (the lines that passed, a film control). */
  readonly outputs?: (input: unknown, value: ToolValue) => readonly TurnOutput[];
}

/** What the model is told about a tool. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonSchema;
}

export interface ToolOutcome {
  readonly result: Result<ToolValue>;
  readonly outputs: readonly TurnOutput[];
}

export interface Toolset {
  /** The tool names, in the order the toolset was built. */
  readonly names: readonly string[];
  specs(): readonly ToolSpec[];
  has(name: string): boolean;
  /**
   * Runs one tool call. `args` is the call's arguments as JSON text or as parsed data. Never throws. A call while
   * another runs on the same target is `tool_busy` (T002), an unknown tool is `tool_unknown` (T004).
   */
  call(target: Target, name: string, args: unknown): ToolOutcome;
}

export interface UndefinedObject {
  readonly name: string;
  readonly reason: string;
}

export interface TargetClock {
  readonly t: number;
  play(): void;
  pause(): void;
  seek(t: number): void;
}

/** What the tools act on (design 9). A figure, or a board (the request's items on the server). */
export interface Target {
  readonly kind: 'figure' | 'board';
  /** The app mode id, for the catalogue and the mode card. */
  readonly mode: string;
  /** One tool call at a time per target (`TOOL_MACHINE`). */
  readonly guard: ToolGuard;
  /** The most characters a line may have. */
  readonly lineLimit: number;
  /** Runs each line on its own, in order: a good line commits, a bad one changes nothing. */
  run(lines: readonly string[]): readonly LineResult[];
  objects(): { readonly list: readonly ObjectSummary[]; readonly truncated: boolean };
  figureSummary(): FigureSummary;
  undefinedObjects(): readonly UndefinedObject[];
  readonly clock: TargetClock;
  /** What `board_read` and `board` use; set on a board target only. */
  readonly board?: BoardPort;
}

/** What a board target gives the board tools (design 9): the board as the request describes it, and the checks of an answer. */
export interface BoardPort {
  /** The page the items are from. */
  readonly page: string;
  /** `board_read`: the items of an area, at most 60, and how many were left out. Never throws. */
  read(input: unknown): Result<ToolValue>;
  /** `board`: checks each action as the board would, one result each, in order. Never throws. */
  check(actions: readonly unknown[]): readonly BoardCheck[];
  /** The board as the first message shows it: a head line and the items, one a line (user text inside; the prompt fences it). */
  describe(): { readonly head: string; readonly items: string };
}

/** One checked action: what the model is told, and the action to send on (the checked form) when it passed. */
export interface BoardCheck {
  readonly result: object;
  readonly send?: unknown;
}
