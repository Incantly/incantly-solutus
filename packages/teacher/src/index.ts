/** @incantly/teacher: The draw and figure tools, catalogue builder, prompt and turn loop (.kiro/specs/teacher). */
export { toolset, BUILTIN_TOOL_NAMES } from './tools/toolset';
export { drawTool, lineResultOf, DRAW_MAX_LINES } from './tools/draw';
export { figureTool, FIGURE_MAX_OBJECTS } from './tools/figure';
export { figureTarget } from './tools/targets';
export type { TargetOptions } from './tools/targets';
export { defineTool, checkSchema, shapeOf, toolInputError } from './tools/schema';
export type { ToolSource } from './tools/schema';
export { ToolGuard, TOOL_MACHINE } from './tools/guard';
export type { ToolState, ToolMove } from './tools/guard';
export type {
  JsonLike, JsonSchema, Target, TargetClock, ToolDef, ToolOutcome, ToolRun, ToolSpec, ToolValue, Toolset, TurnOutput, UndefinedObject,
} from './tools/types';

export { catalogueFor, ON_DEMAND_TOKENS, ALWAYS_TOKENS } from './prompt/catalogue';
export type { Catalogue, CatalogueGroup, Selection } from './prompt/catalogue';
export { GRAMMAR, LANGUAGE_CARD, FUNCTIONS_LINE, OPERATORS_LINE } from './prompt/grammar';
export { jobInstructions, isJobId, JOB_IDS } from './prompt/jobs';
export type { JobId } from './prompt/jobs';
export { buildPrompt, buildSystem, buildMessages, describeTarget, escapeMaterial, materialBlock, PROMPT_LIMIT, TARGET_DATA_TOKENS } from './prompt/build';
export type { BuiltPrompt, HistoryItem, PromptOptions, PromptTokens, SystemPrompt, TurnRequest } from './prompt/build';
export { tokensOf, CHARS_PER_TOKEN } from './prompt/tokens';

export type { ChatEvent, ChatMessage, ChatRequest, ModelClient, ModelToolCall } from './loop/model';
export { fakeModel, FakeModel } from './loop/fake';
export type { RecordedReply, RecordedToolCall, Recording } from './loop/fake';
export { runTurn, presentResult, TURN_LIMITS, TURN_MACHINE } from './loop/turn';
export type { TurnEvent, TurnLimits, TurnMove, TurnOptions, TurnState } from './loop/turn';
export { RETRY_FAILURES, STREAK_LIMIT, lineKey } from './loop/book';

export { streamErrorOf, turnLimitError, toolUnknownError, retrySpentError, streamCutError, noticeOf } from './errors';
export type { StreamError, TurnNotice } from './errors';
