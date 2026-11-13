/**
 * The input language: lexing, parsing, checking, compiling, previews, signature help and
 * autocomplete (docs/features/language/). Pure functions; nothing throws across this boundary.
 */

// Steps 1 and 2: text to syntax tree
export { parseLine, parseProgram, parseExprTokens } from './parser';
export type { ParseOptions } from './parser';
export { lex } from './lexer';
export type { LexResult, StrPart, Token, TokKind } from './lexer';
export { SourceMap, normalise, splitLogicalLines, MAX_LINE_LENGTH } from './source';
export type { LogicalLine, Normalised, LineSpan } from './source';
export type { Arg, BinOp, CmpOp, DirectiveWord, Expr, LineKind, LineNode, NameRef, ParsedLine, RangeClause, StyleItem } from './ast';
export { printExpr, printLineNode } from './printer';

// Steps 3 and 4: names and types
export { checkLine, } from './lines';
export { OverlayFigure, FIELDS } from './check';
export type { CheckOptions, CheckedLine, CheckedRange, CheckedStyle } from './check';
export type { TNode, TArg, RelTree, RelationShape } from './tnode';
export { T, listOf, fnOf, tyEq, tyStr, typeSet, parseTy, accepts, binaryOp, TYPE_ALIASES, CORE_TYPE_NAMES, typeTextProblem, registerSchemaType, isSchemaType } from './types';
export type { Ty, TypeSet, OpVariant } from './types';
export { analyseLine, preview, signatureHelp, complete, tokenize } from './tooling';
export type { PreviewResult, GhostSpec, SignatureHelp, Completion, CompletionKind, HighlightToken, HighlightKind } from './tooling';

// Step 5: compile target
export { compileLine, compileNode, evaluate } from './compile';
export type { Compiled, CompiledLine, CompiledArg, CompileOptions, EvalResult } from './compile';
export { createEnv, resetEnv, fail, formatNumber, valueText } from './runtime';
export type {
  Env, EnvInit, FunctionValue, RelationValue, RuntimeValue, SegmentValue, RayValue, LineValue, CircleValue, ArcValue, PolygonValue, ColorValue,
} from './runtime';

// Commands and functions as data
export { createCommandTable, createFunctionTable, checkTable, checkFunctionTable, formText, EMPTY_COMMANDS, SELF_ID } from './table';
export type {
  CommandForm, CommandSpec, CommandTable, FigureView, FormLike, FunctionForm, FunctionSpec, FunctionTable, ObjectInfo, ParamKind, ParamSpec,
  BoundArg, RuleFactory, TableProblem, TableProblemKind, CheckTableOptions, DuplicateName, ConstValue,
  ArgFacts, CallCheck, FormCheck, Refusal,
} from './table';
export { BUILTIN_FUNCTIONS, BUILTIN_FUNCTION_SPECS, BUILTIN_CONSTANTS, setMathLib, getMathLib, PLATFORM_MATH } from './builtins';
export type { MathLib, ConstantSpec } from './builtins';

// Names
export { suggestName, nameProblem, reservedGroup, MAX_NAME_LENGTH } from './names';
export type { ReservedGroup, SuggestOptions, Taken } from './names';
export { PROPERTIES, DIRECTIVES, COLOR_WORDS } from './props';
export type { PropSpec, PropKind } from './props';

// Errors
export { closestNames, editDistance, ERROR_KINDS, MESSAGE_TEMPLATES } from './errors';
export type { LanguageError, ArgProblem, QuickFix } from './errors';

// A small in-memory figure for tools and experiments (not the kernel)
export { ScratchFigure, targetNamesOf } from './figure';
export type { Applied, DefineOptions } from './figure';
