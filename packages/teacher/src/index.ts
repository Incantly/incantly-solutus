/** @incantly/teacher: The draw and figure tools, catalogue builder, prompt and turn loop (.kiro/specs/teacher). */
export { toolset, BUILTIN_TOOL_NAMES } from './tools/toolset';
export { drawTool, lineResultOf, DRAW_MAX_LINES } from './tools/draw';
export { figureTool, FIGURE_MAX_OBJECTS } from './tools/figure';
export { boardReadTool, boardTool } from './tools/board';
export { FILM_TOOLS, pauseTool, resumeTool, seekBeatTool, showMeTool } from './tools/film';
export { boardTarget, BOARD_DATA_CHARS } from './tools/board-target';
export type { BoardRequestData, BoardTargetOptions } from './tools/board-target';
export { figureTarget } from './tools/targets';
export type { TargetOptions } from './tools/targets';
export { defineTool, checkSchema, shapeOf, toolInputError } from './tools/schema';
export type { ToolSource } from './tools/schema';
export { ToolGuard, TOOL_MACHINE } from './tools/guard';
export type { ToolState, ToolMove } from './tools/guard';
export type {
  BoardCheck, BoardPort, JsonLike, JsonSchema, Target, TargetClock, ToolDef, ToolOutcome, ToolRun, ToolSpec, ToolValue, Toolset, TurnOutput, UndefinedObject,
} from './tools/types';

export { catalogueFor, ON_DEMAND_TOKENS, ALWAYS_TOKENS } from './prompt/catalogue';
export type { Catalogue, CatalogueGroup, Selection } from './prompt/catalogue';
export { GRAMMAR, LANGUAGE_CARD, FUNCTIONS_LINE, OPERATORS_LINE } from './prompt/grammar';
export { jobInstructions, isJobId, JOB_IDS } from './prompt/jobs';
export type { JobId } from './prompt/jobs';
export { CHOICE_IDS, choiceAsk, choiceMode, isChoiceId } from './prompt/choices';
export type { ChoiceId } from './prompt/choices';
export { buildPrompt, buildSystem, buildMessages, describeTarget, escapeMaterial, materialBlock, PROMPT_LIMIT, TARGET_DATA_TOKENS } from './prompt/build';
export type { BuiltPrompt, HistoryItem, PromptOptions, PromptTokens, SystemPrompt, TurnRequest } from './prompt/build';
export { tokensOf, CHARS_PER_TOKEN } from './prompt/tokens';

export type { ChatEvent, ChatImage, ChatMessage, ChatRequest, ModelClient, ModelToolCall } from './loop/model';
export { fakeModel, FakeModel } from './loop/fake';
export type { RecordedReply, RecordedToolCall, Recording } from './loop/fake';
export { runTurn, presentResult, TURN_LIMITS, TURN_MACHINE } from './loop/turn';
export type { TurnEvent, TurnLimits, TurnMove, TurnOptions, TurnState } from './loop/turn';
export { boardTurn, boardMode, boardAllowsEdit } from './loop/board';
export type { BoardTurnOptions } from './loop/board';
export { liveTurn, liveTarget, liveTools } from './loop/live';
export type { LiveTurnOptions } from './loop/live';
export { RETRY_FAILURES, STREAK_LIMIT, lineKey } from './loop/book';

export { streamFigure, FIGURE_STREAM_MACHINE, FIGURE_LIMITS, PLAN_MIN_OBJECTS } from './stream/apply';
export type { FigureLimits, FigureStreamMove, FigureStreamOptions, FigureStreamState, PlanMode } from './stream/apply';
export { LineSplitter, cleanLine, splitLines } from './stream/split';
export type { SplitEnd } from './stream/split';
export { SentenceSplitter, SENTENCE_MAX, speakable, splitSentences } from './stream/sentences';

export { streamErrorOf, turnLimitError, toolUnknownError, retrySpentError, streamCutError, noticeOf } from './errors';
export type { StreamError, TurnNotice } from './errors';
