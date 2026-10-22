import { parse, type AnyNode, type ArrowFunctionExpression, type Expression, type Pattern, type Program } from 'acorn';
import {
  ALLOWED_GLOBALS,
  ALLOWED_MATH,
  ALLOWED_NUMBER,
  BLOCKED_PROPERTIES,
  HANDLES,
  INC_FUNCTIONS,
  INC_NAMESPACES,
  TONES,
  type HandleKind,
  type Returns,
} from '../api/surface';
import { isKitCall, kitsFor, type KitName } from '../runtime/kits';
import { isColourLiteral, NAMED_COLOURS } from './colours';
import { LineIndex, type Diagnostic } from './diagnostics';
import { SCENE_LIMITS, type SceneLimits } from './limits';

/**
 * The JavaScript validator: an explicit allow-list over acorn's syntax tree
 * (ADR 001, ADR 003). Any node type this file does not handle is rejected, so
 * new syntax stays out of scenes until it is reviewed here. It also tracks the
 * SDK handle each `const` holds, so a misspelled method gets a precise message.
 */

export interface StageReference {
  readonly selector: string;
  readonly line: number;
  readonly column: number;
}

export interface JsInfo {
  readonly paramCount: number;
  readonly stages: readonly StageReference[];
  /** Part names registered with a literal name. */
  readonly parts: readonly string[];
  /** Number of steps when inc.steps receives an array literal. */
  readonly stepCount: number | null;
  readonly hasIdea: boolean;
  readonly hasDescribe: boolean;
  readonly hasExplain: boolean;
  /** Kits the scene calls, which the host loads before it runs. */
  readonly kits: readonly KitName[];
}

export interface JsValidation {
  readonly diagnostics: Diagnostic[];
  /** The syntax tree, when the source parsed. */
  readonly program: Program | null;
  readonly info: JsInfo;
}

// ---------------------------------------------------------------------------
// What the subset knows about
// ---------------------------------------------------------------------------

/** Free names that exist in a browser or Worker but are outside the scene subset, by why. */
const FORBIDDEN_GLOBALS: Readonly<Record<string, string>> = (() => {
  const groups: Record<string, string[]> = {
    'reaches outside the figure; scenes only see inc and Math': [
      'window',
      'self',
      'globalThis',
      'document',
      'parent',
      'top',
      'opener',
      'frames',
      'frameElement',
      'location',
      'history',
      'navigator',
      'screen',
      'console',
      'alert',
      'confirm',
      'prompt',
      'open',
      'close',
      'print',
      'postMessage',
      'performance',
      'crypto',
      'customElements',
      'Image',
      'Audio',
      'Option',
      'Notification',
      'process',
      'require',
      'module',
      'exports',
      'Buffer',
    ],
    'creates listeners, timers or a second animation loop; use inc.onFrame and the controls the engine builds': [
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'clearTimeout',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'queueMicrotask',
      'onmessage',
    ],
    'uses the network; figures work offline and never make requests': [
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'WebTransport',
      'EventSource',
      'RTCPeerConnection',
      'importScripts',
    ],
    'uses storage; the host stores the learner values for you': [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'caches',
      'cookieStore',
    ],
    'runs dynamic code; write the scene directly or use inc.formula for maths': [
      'eval',
      'Function',
      'WebAssembly',
      'arguments',
    ],
    'starts other threads or channels': [
      'Worker',
      'SharedWorker',
      'ServiceWorker',
      'BroadcastChannel',
      'MessageChannel',
      'MessagePort',
      'Atomics',
      'SharedArrayBuffer',
    ],
    'is not part of the scene subset': [
      'Object',
      'Array',
      'String',
      'Boolean',
      'Symbol',
      'BigInt',
      'JSON',
      'Date',
      'RegExp',
      'Promise',
      'Proxy',
      'Reflect',
      'Map',
      'Set',
      'WeakMap',
      'WeakSet',
      'WeakRef',
      'Error',
      'TypeError',
      'RangeError',
      'Intl',
      'parseInt',
      'parseFloat',
      'encodeURIComponent',
      'decodeURIComponent',
      'escape',
      'unescape',
      'Blob',
      'URL',
      'FileReader',
      'TextEncoder',
      'TextDecoder',
    ],
  };
  const out: Record<string, string> = Object.create(null);
  for (const [why, names] of Object.entries(groups)) for (const name of names) out[name] = why;
  return out;
})();

const ALLOWED_GLOBAL_SET: ReadonlySet<string> = new Set(ALLOWED_GLOBALS);
const MATH_MEMBERS: ReadonlySet<string> = new Set(ALLOWED_MATH);
const NUMBER_MEMBERS: ReadonlySet<string> = new Set(ALLOWED_NUMBER);
const TONE_SET: ReadonlySet<string> = new Set(TONES);


/** inc calls that declare the scene, so they belong at the top level. */
const MOUNT_ONLY: ReadonlySet<string> = new Set([
  'param',
  'toggle',
  'choice',
  'color',
  'button',
  'presets',
  'link',
  'model',
  'onFrame',
  'simulate',
  'timeline',
  'onReset',
  'onParamChange',
  'onStep',
  'readout',
  'table',
  'idea',
  'steps',
  'explain',
  'describe',
  'predict',
  'compare',
  'svg',
  'graph2d',
  'space3d',
  'graph3d',
  'physics2d',
  'chart',
  'flow',
  'chemistry',
  'biology',
  'formula',
  'idle',
]);

/** Handle methods that create a new element. Created once, then moved. */
const CREATES_ELEMENTS: Readonly<Partial<Record<HandleKind, ReadonlySet<string>>>> = {
  Stage: new Set(['group', 'path', 'line', 'circle', 'rect', 'text', 'equation', 'polyline', 'part', 'connector', 'callout', 'repeat', 'dots', 'fluid']),
  Space3D: new Set(['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus', 'tube', 'mesh', 'lathe', 'model', 'group', 'line', 'arrow', 'coil', 'arc', 'point', 'label', 'grid', 'axes', 'fieldLines', 'part', 'drag']),
  Graph3D: new Set(['surface', 'parametric', 'curve', 'point', 'vector', 'line', 'plane', 'label', 'part']),
  Surface3D: new Set(['section']),
  Chemistry: new Set(['atom', 'bond', 'molecule', 'shells', 'reaction', 'profile']),
  Biology: new Set(['cell', 'membrane', 'helix', 'stream']),
  World2D: new Set(['ball', 'box', 'polygon', 'ramp', 'spring', 'rope', 'rod', 'hinge', 'pulley', 'tank', 'field', 'forces', 'onHit', 'onTouch']),
  Chart: new Set(['series', 'points', 'rule']),
  Flow: new Set(['node', 'edge']),
  Graph: new Set([
    'plot',
    'plotX',
    'polar',
    'parametric',
    'scatter',
    'bars',
    'histogram',
    'area',
    'between',
    'field',
    'slopes',
    'implicit',
    'point',
    'segment',
    'arrow',
    'trail',
    'label',
    'equation',
    'bracket',
    'dimension',
    'trace',
    'handle',
    'marks',
    'crossings',
  ]),
};

/** inc calls whose text callbacks are checked for numbers typed into prose. */
const TEXT_INC_CALLS: ReadonlySet<string> = new Set(['readout', 'explain', 'describe']);

const ARRAY_METHODS = [
  'at',
  'concat',
  'every',
  'fill',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'lastIndexOf',
  'map',
  'pop',
  'push',
  'reduce',
  'reduceRight',
  'reverse',
  'shift',
  'slice',
  'some',
  'sort',
  'splice',
  'unshift',
];
const STRING_METHODS = [
  'charAt',
  'endsWith',
  'padEnd',
  'padStart',
  'replace',
  'replaceAll',
  'split',
  'startsWith',
  'substring',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
];
const NUMBER_METHODS = ['toFixed', 'toPrecision', 'toString'];

/** Every method name a scene may call on a value whose type the validator could not follow. */
const KNOWN_METHODS: ReadonlySet<string> = (() => {
  const names = new Set<string>([...ARRAY_METHODS, ...STRING_METHODS, ...NUMBER_METHODS]);
  for (const name of Object.keys(INC_FUNCTIONS)) names.add(name);
  for (const ns of Object.values(INC_NAMESPACES)) for (const name of Object.keys(ns)) names.add(name);
  for (const spec of Object.values(HANDLES)) for (const name of Object.keys(spec.methods)) names.add(name);
  return names;
})();

const ARRAY_RETURNING: ReadonlySet<string> = new Set([
  'concat',
  'filter',
  'flat',
  'flatMap',
  'map',
  'reverse',
  'slice',
  'sort',
  'splice',
  'split',
]);

// ---------------------------------------------------------------------------
// Static types and scopes
// ---------------------------------------------------------------------------

type NamespaceName = keyof typeof INC_NAMESPACES;

type ValueType =
  | { readonly t: 'inc' }
  | { readonly t: 'ns'; readonly ns: NamespaceName }
  /** A helper of a namespace, such as inc.calc.normal: a function, not an object. */
  | { readonly t: 'ns-fn'; readonly ns: NamespaceName; readonly name: string }
  | { readonly t: 'math' }
  | { readonly t: 'number-ns' }
  | { readonly t: 'handle'; readonly kind: HandleKind }
  | { readonly t: 'array' | 'string' | 'number' | 'boolean' | 'function' | 'object' | 'unknown' };

const UNKNOWN: ValueType = { t: 'unknown' };
const NUMBER: ValueType = { t: 'number' };
const STRING: ValueType = { t: 'string' };
const BOOLEAN: ValueType = { t: 'boolean' };
const ARRAY: ValueType = { t: 'array' };
const OBJECT: ValueType = { t: 'object' };
const FUNCTION: ValueType = { t: 'function' };

interface Binding {
  readonly name: string;
  readonly kind: 'const' | 'let' | 'param';
  type: ValueType;
  /** Value of a const bound to a number literal, for loop bounds. */
  constNumber?: number;
  /** Set while the body of the for loop that declared it is walked. */
  lockedLoopVariable?: boolean;
  /** Whether this binding holds an arrow function (for recursion checks). */
  holdsFunction?: boolean;
}

class Scope {
  readonly bindings = new Map<string, Binding>();
  constructor(readonly parent: Scope | null) {}

  lookup(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.lookup(name);
  }
}

interface Context {
  readonly scope: Scope;
  /** Nearest enclosing function, or null at the top level. */
  readonly inFunction: boolean;
  /** Nearest enclosing function that is bound to a name, for the call graph. */
  readonly owner: Binding | null;
  /** Inside a callback that runs every frame or on every change. */
  readonly callback: string | null;
  /** The SDK call whose arguments these are: a function among them becomes that call's callback. */
  readonly pending: string | null;
  /** Inside a readout, explain or describe callback. */
  readonly text: boolean;
  readonly depth: number;
}

function handleType(returns: Returns, self: ValueType, firstArgument: ValueType): ValueType {
  if (returns === null) return UNKNOWN;
  if (returns === 'self') return self;
  if (returns === 'argument') return firstArgument;
  return { t: 'handle', kind: returns };
}

function describeType(type: ValueType): string {
  switch (type.t) {
    case 'inc':
      return 'inc';
    case 'ns':
      return `inc.${type.ns}`;
    case 'ns-fn':
      return `inc.${type.ns}.${type.name}`;
    case 'math':
      return 'Math';
    case 'number-ns':
      return 'Number';
    case 'handle':
      return `a ${type.kind} handle`;
    default:
      return type.t;
  }
}

function listOf(names: Iterable<string>): string {
  return [...names].sort().join(', ');
}

/** Closest name by edit distance, to suggest a fix for a typo. */
function closest(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best !== null && bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** Why a construct is rejected, by syntax node type. */
const FORBIDDEN_NODES: Readonly<Record<string, string>> = {
  ThisExpression: '`this` is not available in scenes',
  NewExpression: '`new` is not allowed in scenes; SDK calls create everything a scene needs',
  ClassDeclaration: 'Classes are not allowed in scenes',
  ClassExpression: 'Classes are not allowed in scenes',
  TryStatement: 'try/catch is not allowed; the engine catches errors and keeps the figure alive',
  ThrowStatement: '`throw` is not allowed in scenes',
  WithStatement: '`with` is not allowed in scenes',
  DebuggerStatement: '`debugger` is not allowed in scenes',
  ImportExpression: 'Dynamic import is not allowed in scenes',
  MetaProperty: '`import.meta` and `new.target` are not available in scenes',
  AwaitExpression: '`await` is not allowed in scenes',
  YieldExpression: '`yield` is not allowed in scenes',
  TaggedTemplateExpression: 'Tagged templates are not allowed in scenes',
  FunctionDeclaration: '`function` declarations are not allowed; use an arrow function: const f = (x) => ...',
  FunctionExpression: '`function` expressions are not allowed; use an arrow function',
  Super: '`super` is not available in scenes',
  LabeledStatement: 'Labels are not allowed in scenes',
  ForInStatement: 'for...in loops are not allowed; use for...of over an array',
  WhileStatement: 'while loops are not allowed; use a for loop with a fixed bound',
  DoWhileStatement: 'do...while loops are not allowed; use a for loop with a fixed bound',
};

const LOOP_NODES: ReadonlySet<string> = new Set(['ForInStatement', 'WhileStatement', 'DoWhileStatement']);

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

export function validateSceneJs(source: string, limits: SceneLimits = SCENE_LIMITS): JsValidation {
  return new JsValidator(source, limits).run();
}

class JsValidator {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly index: LineIndex;
  private nodes = 0;
  private reportedAstBudget = false;
  private reportedDepth = false;
  private paramCount = 0;
  private readonly stages: StageReference[] = [];
  private readonly kitCalls = new Set<string>();
  private readonly parts: string[] = [];
  private stepCount: number | null = null;
  private hasIdea = false;
  private hasDescribe = false;
  private hasExplain = false;
  /** Call graph between named functions: owner -> referenced function -> first reference. */
  private readonly calls = new Map<Binding, Map<Binding, AnyNode>>();

  constructor(
    private readonly source: string,
    private readonly limits: SceneLimits,
  ) {
    this.index = new LineIndex(source);
  }

  run(): JsValidation {
    let program: Program | null = null;
    if (this.source.length > this.limits.jsChars) {
      this.report(
        'budget-size',
        `The scene script is ${this.source.length} characters; the limit is ${this.limits.jsChars}`,
        Math.min(this.limits.jsChars, this.source.length - 1),
      );
    }
    try {
      program = parse(this.source, {
        ecmaVersion: 2020,
        sourceType: 'script',
        locations: true,
        allowReturnOutsideFunction: false,
        allowHashBang: false,
        allowReserved: false,
      });
    } catch (error) {
      const e = error as { message?: string; pos?: number };
      const message = (e.message ?? 'Syntax error').replace(/\s*\(\d+:\d+\)$/, '');
      this.report('syntax', message, typeof e.pos === 'number' ? e.pos : 0);
    }
    if (program) {
      const scope = new Scope(null);
      const ctx: Context = { scope, inFunction: false, owner: null, callback: null, pending: null, text: false, depth: 0 };
      this.declareBlock(program.body, scope);
      for (const statement of program.body) this.statement(statement, ctx);
      this.checkRecursion();
    }
    return {
      diagnostics: this.diagnostics,
      program,
      info: {
        paramCount: this.paramCount,
        stages: this.stages,
        parts: this.parts,
        stepCount: this.stepCount,
        hasIdea: this.hasIdea,
        hasDescribe: this.hasDescribe,
        hasExplain: this.hasExplain,
        kits: kitsFor(this.kitCalls),
      },
    };
  }

  private report(rule: string, message: string, offset: number, severity: 'error' | 'warning' = 'error'): void {
    const { line, column } = this.index.position(offset);
    this.diagnostics.push({ fragment: 'js', rule, message, line, column, severity });
  }

  private count(node: AnyNode): void {
    this.nodes++;
    if (this.nodes > this.limits.astNodes && !this.reportedAstBudget) {
      this.reportedAstBudget = true;
      this.report('budget-ast', `The scene script has more than ${this.limits.astNodes} syntax nodes`, node.start);
    }
  }

  private deeper(ctx: Context, node: AnyNode, changes: Partial<Context> = {}): Context {
    const depth = ctx.depth + 1;
    if (depth > this.limits.depth && !this.reportedDepth) {
      this.reportedDepth = true;
      this.report('budget-depth', `Blocks and functions nest more than ${this.limits.depth} levels deep`, node.start);
    }
    return { ...ctx, ...changes, depth };
  }

  private forbidden(node: AnyNode): void {
    const message = FORBIDDEN_NODES[node.type] ?? `${node.type} is not part of the scene subset`;
    this.report(LOOP_NODES.has(node.type) ? 'unbounded-loop' : 'forbidden-syntax', message, node.start);
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  /** Declares every let and const of a block up front, so closures can refer to later names. */
  private declareBlock(statements: readonly AnyNode[], scope: Scope): void {
    for (const statement of statements) {
      if (statement.type !== 'VariableDeclaration' || (statement.kind !== 'const' && statement.kind !== 'let')) continue;
      const kind = statement.kind;
      for (const declarator of statement.declarations) {
        for (const id of patternIdentifiers(declarator.id)) {
          const binding = this.declare(scope, id.name, kind, id.start);
          // Marked before any body is walked, so calls to later functions are seen too.
          if (declarator.id.type === 'Identifier' && declarator.init?.type === 'ArrowFunctionExpression') {
            binding.holdsFunction = true;
          }
        }
      }
    }
  }

  private declare(scope: Scope, name: string, kind: Binding['kind'], offset: number): Binding {
    if (name.startsWith('__inc')) {
      this.report('reserved-name', `Names starting with __inc are reserved for the engine`, offset);
    } else if (ALLOWED_GLOBAL_SET.has(name)) {
      this.report('reserved-name', `"${name}" is provided by the engine and cannot be redeclared`, offset);
    }
    const existing = scope.bindings.get(name);
    if (existing) return existing;
    const binding: Binding = { name, kind, type: UNKNOWN };
    scope.bindings.set(name, binding);
    return binding;
  }

  // -------------------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------------------

  private statement(node: AnyNode, ctx: Context): void {
    this.count(node);
    switch (node.type) {
      case 'ExpressionStatement':
        if (node.directive !== undefined) return; // "use strict"
        this.expression(node.expression, ctx);
        return;
      case 'VariableDeclaration': {
        if (node.kind !== 'const' && node.kind !== 'let') {
          this.report('forbidden-syntax', 'Use const or let instead of var', node.start);
          return;
        }
        for (const declarator of node.declarations) {
          this.count(declarator);
          const binding = declarator.id.type === 'Identifier' ? ctx.scope.lookup(declarator.id.name) : undefined;
          const type = declarator.init
            ? this.expression(declarator.init, ctx, binding?.holdsFunction ? binding : undefined)
            : UNKNOWN;
          if (declarator.id.type === 'Identifier' && binding) {
            binding.type = node.kind === 'const' ? type : UNKNOWN;
            const literal = declarator.init ? numericLiteral(declarator.init) : null;
            if (node.kind === 'const' && literal !== null) binding.constNumber = literal;
          } else {
            this.pattern(declarator.id, ctx, type);
          }
        }
        return;
      }
      case 'BlockStatement': {
        const inner = this.deeper(ctx, node, { scope: new Scope(ctx.scope) });
        this.declareBlock(node.body, inner.scope);
        for (const statement of node.body) this.statement(statement, inner);
        return;
      }
      case 'EmptyStatement':
        return;
      case 'IfStatement':
        this.expression(node.test, ctx);
        this.statement(node.consequent, ctx);
        if (node.alternate) this.statement(node.alternate, ctx);
        return;
      case 'SwitchStatement': {
        this.expression(node.discriminant, ctx);
        const inner = this.deeper(ctx, node, { scope: new Scope(ctx.scope) });
        for (const switchCase of node.cases) {
          this.count(switchCase);
          this.declareBlock(switchCase.consequent, inner.scope);
        }
        for (const switchCase of node.cases) {
          if (switchCase.test) this.expression(switchCase.test, inner);
          for (const statement of switchCase.consequent) this.statement(statement, inner);
        }
        return;
      }
      case 'ReturnStatement':
        if (node.argument) this.expression(node.argument, ctx);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
        if (node.label) this.report('forbidden-syntax', FORBIDDEN_NODES.LabeledStatement!, node.start);
        return;
      case 'ForStatement':
        this.forStatement(node, ctx);
        return;
      case 'ForOfStatement': {
        if (node.await) {
          this.report('forbidden-syntax', FORBIDDEN_NODES.AwaitExpression!, node.start);
          return;
        }
        this.expression(node.right, ctx);
        const inner = this.deeper(ctx, node, { scope: new Scope(ctx.scope) });
        const left = node.left;
        if (left.type === 'VariableDeclaration' && (left.kind === 'const' || left.kind === 'let')) {
          this.count(left);
          const kind = left.kind;
          for (const declarator of left.declarations) {
            for (const id of patternIdentifiers(declarator.id)) this.declare(inner.scope, id.name, kind, id.start);
            this.pattern(declarator.id, inner, UNKNOWN);
          }
        } else {
          this.report('forbidden-syntax', 'Declare the loop variable with const or let: for (const item of items)', node.left.start);
        }
        this.statement(node.body, inner);
        return;
      }
      default:
        this.forbidden(node);
    }
  }

  /** for (let i = a; i < bound; i++) with a bound the validator can see. */
  private forStatement(node: Extract<AnyNode, { type: 'ForStatement' }>, ctx: Context): void {
    const inner = this.deeper(ctx, node, { scope: new Scope(ctx.scope) });
    const fail = (message: string, at: AnyNode = node) => this.report('unbounded-loop', message, at.start);
    const init = node.init;
    if (!init || init.type !== 'VariableDeclaration' || init.kind !== 'let' || init.declarations.length !== 1) {
      fail('A for loop must declare one counter: for (let i = 0; i < 10; i++)', init ?? node);
      this.statement(node.body, inner);
      return;
    }
    this.count(init);
    const declarator = init.declarations[0]!;
    this.count(declarator);
    if (declarator.id.type !== 'Identifier' || !declarator.init) {
      fail('A for loop counter needs a name and a starting value', declarator);
      this.statement(node.body, inner);
      return;
    }
    const counter = declarator.id.name;
    this.expression(declarator.init, ctx);
    const binding = this.declare(inner.scope, counter, 'let', declarator.id.start);
    binding.type = NUMBER;

    const test = node.test;
    let direction: 'up' | 'down' | null = null;
    if (
      test &&
      test.type === 'BinaryExpression' &&
      test.left.type === 'Identifier' &&
      test.left.name === counter &&
      ['<', '<=', '>', '>='].includes(test.operator)
    ) {
      this.count(test);
      direction = test.operator === '<' || test.operator === '<=' ? 'up' : 'down';
      this.expression(test.right, inner);
      const problem = this.loopBound(test.right, inner.scope);
      if (problem) fail(problem, test.right);
    } else {
      fail(`A for loop must compare its counter with a bound, as in ${counter} < 10`, test ?? node);
      if (test) this.expression(test, inner);
    }

    const update = node.update;
    const step = update ? loopStep(update, counter) : null;
    if (!update || step === null) {
      fail(`A for loop must step its counter by a fixed amount, as in ${counter}++ or ${counter} += 2`, update ?? node);
    } else if (direction && (step > 0) !== (direction === 'up')) {
      fail(`This loop steps ${counter} away from its bound, so it would never end`, update);
    }
    if (update) {
      this.count(update);
      if (update.type === 'AssignmentExpression') this.expression(update.right, inner);
    }

    binding.lockedLoopVariable = true;
    this.statement(node.body, inner);
    binding.lockedLoopVariable = false;
  }

  /** Why a loop bound is not visibly finite and small, or null when it is. */
  private loopBound(bound: Expression, scope: Scope): string | null {
    const limit = this.limits.loopBound;
    const literal = numericLiteral(bound);
    if (literal !== null) return Math.abs(literal) <= limit ? null : `Loop bound ${literal} is above the limit of ${limit}`;
    if (bound.type === 'Identifier') {
      const binding = scope.lookup(bound.name);
      if (binding?.constNumber !== undefined) {
        return Math.abs(binding.constNumber) <= limit ? null : `Loop bound ${bound.name} = ${binding.constNumber} is above the limit of ${limit}`;
      }
      return `Bound the loop by a number, a const number, an array's length or Math.min(value, ${limit})`;
    }
    if (bound.type === 'MemberExpression' && !bound.computed && bound.property.type === 'Identifier' && bound.property.name === 'length') {
      return null;
    }
    if (bound.type === 'BinaryExpression' && (bound.operator === '+' || bound.operator === '-') && numericLiteral(bound.right) !== null) {
      return this.loopBound(bound.left as Expression, scope);
    }
    if (
      bound.type === 'CallExpression' &&
      bound.callee.type === 'MemberExpression' &&
      bound.callee.object.type === 'Identifier' &&
      bound.callee.object.name === 'Math' &&
      !bound.callee.computed &&
      bound.callee.property.type === 'Identifier'
    ) {
      const fn = bound.callee.property.name;
      if (fn === 'min' && bound.arguments.some((a) => a.type !== 'SpreadElement' && this.loopBound(a, scope) === null)) return null;
      if ((fn === 'floor' || fn === 'ceil' || fn === 'round') && bound.arguments.length === 1) {
        const [argument] = bound.arguments;
        return argument && argument.type !== 'SpreadElement' ? this.loopBound(argument, scope) : 'Unexpected loop bound';
      }
    }
    return `Bound the loop by a number, a const number, an array's length or Math.min(value, ${limit})`;
  }

  // -------------------------------------------------------------------------
  // Patterns and assignment targets
  // -------------------------------------------------------------------------

  /** Destructuring in declarations and parameters: names are already declared. */
  private pattern(node: Pattern | AnyNode, ctx: Context, source: ValueType): void {
    this.count(node as AnyNode);
    switch (node.type) {
      case 'Identifier':
        return;
      case 'ObjectPattern':
        for (const property of node.properties) {
          this.count(property);
          if (property.type === 'RestElement') {
            this.pattern(property.argument, ctx, UNKNOWN);
            continue;
          }
          if (property.computed) {
            this.report('forbidden-syntax', 'Computed names in destructuring are not allowed; read the property directly', property.key.start);
            continue;
          }
          const key = propertyName(property.key);
          if (key !== null) this.checkMember(source, key, property.key, false);
          this.pattern(property.value, ctx, UNKNOWN);
        }
        return;
      case 'ArrayPattern':
        for (const element of node.elements) if (element) this.pattern(element, ctx, UNKNOWN);
        return;
      case 'AssignmentPattern':
        this.expression(node.right, ctx);
        this.pattern(node.left, ctx, source);
        return;
      case 'RestElement':
        this.pattern(node.argument, ctx, UNKNOWN);
        return;
      default:
        this.forbidden(node as AnyNode);
    }
  }

  private assignTarget(node: Pattern | AnyNode, ctx: Context): void {
    this.count(node as AnyNode);
    switch (node.type) {
      case 'Identifier': {
        const binding = ctx.scope.lookup(node.name);
        if (!binding) {
          this.report(
            'assign-global',
            ALLOWED_GLOBAL_SET.has(node.name) || node.name in FORBIDDEN_GLOBALS
              ? `"${node.name}" cannot be reassigned`
              : `"${node.name}" is not declared; declare it with let first`,
            node.start,
          );
        } else if (binding.kind === 'const') {
          this.report('assign-const', `"${node.name}" is a const and cannot be reassigned; declare it with let`, node.start);
        } else if (binding.lockedLoopVariable) {
          this.report('loop-variable-assigned', `The loop counter "${node.name}" is changed inside the loop, so the loop may never end`, node.start);
        }
        return;
      }
      case 'MemberExpression': {
        const type = this.expression(node.object as Expression, ctx);
        if (type.t === 'handle' || type.t === 'inc' || type.t === 'ns' || type.t === 'ns-fn' || type.t === 'math' || type.t === 'number-ns') {
          this.report('assign-sdk', `${describeType(type)} is read-only; use its methods instead`, node.start);
        }
        if (node.computed) this.expression(node.property as Expression, ctx);
        else if (node.property.type === 'Identifier' && BLOCKED_PROPERTIES.has(node.property.name)) {
          this.report('blocked-property', `"${node.property.name}" is not available in scenes`, node.property.start);
        }
        return;
      }
      case 'ObjectPattern':
      case 'ArrayPattern': {
        const targets = node.type === 'ObjectPattern' ? node.properties : node.elements;
        for (const target of targets) {
          if (!target) continue;
          if (target.type === 'Property') {
            this.count(target);
            if (target.computed) {
              this.report('forbidden-syntax', 'Computed names in destructuring are not allowed; read the property directly', target.key.start);
              continue;
            }
            const key = propertyName(target.key);
            if (key !== null && BLOCKED_PROPERTIES.has(key)) {
              this.report('blocked-property', `"${key}" is not available in scenes`, target.key.start);
            }
            this.assignTarget(target.value, ctx);
          } else this.assignTarget(target, ctx);
        }
        return;
      }
      case 'AssignmentPattern':
        this.expression(node.right, ctx);
        this.assignTarget(node.left, ctx);
        return;
      case 'RestElement':
        this.assignTarget(node.argument, ctx);
        return;
      default:
        this.forbidden(node as AnyNode);
    }
  }

  // -------------------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------------------

  /** Walks an expression and returns what the validator knows about its value. */
  private expression(node: Expression | AnyNode, ctx: Context, owner?: Binding): ValueType {
    this.count(node as AnyNode);
    switch (node.type) {
      case 'Literal':
        return this.literal(node, ctx);
      case 'Identifier':
        return this.identifier(node.name, node as AnyNode, ctx);
      case 'TemplateLiteral':
        for (const quasi of node.quasis) {
          this.count(quasi);
          this.checkString(quasi.value.cooked ?? quasi.value.raw, quasi.start, ctx);
        }
        for (const expression of node.expressions) this.expression(expression, ctx);
        return STRING;
      case 'ArrayExpression':
        for (const element of node.elements) {
          if (!element) continue;
          if (element.type === 'SpreadElement') {
            this.count(element);
            this.expression(element.argument, ctx);
          } else this.expression(element, ctx);
        }
        return ARRAY;
      case 'ObjectExpression':
        for (const property of node.properties) {
          this.count(property);
          if (property.type === 'SpreadElement') {
            this.expression(property.argument, ctx);
            continue;
          }
          if (property.kind !== 'init' || property.method) {
            this.report('forbidden-syntax', 'Getters, setters and methods in objects are not allowed; use a property with an arrow function', property.start);
            continue;
          }
          let key: string | null = null;
          if (property.computed) this.expression(property.key as Expression, ctx);
          else {
            key = propertyName(property.key);
            this.count(property.key);
            if (key !== null && BLOCKED_PROPERTIES.has(key)) {
              this.report('blocked-property', `"${key}" cannot be used as a property name`, property.key.start);
            }
          }
          const value = property.value as Expression;
          if (key !== null && value.type === 'Literal' && typeof value.value === 'string') {
            this.checkStyleValue(key, value.value, value.start);
          }
          if (!property.shorthand) this.expression(value, ctx);
          else this.identifier((value as { name: string }).name, value as AnyNode, ctx);
        }
        return OBJECT;
      case 'ArrowFunctionExpression':
        this.arrow(node, ctx, owner ?? null);
        return FUNCTION;
      case 'UnaryExpression':
        if (node.operator === 'delete' || node.operator === 'void') {
          this.report('forbidden-syntax', `The ${node.operator} operator is not allowed in scenes`, node.start);
        }
        this.expression(node.argument, ctx);
        return node.operator === '!' ? BOOLEAN : node.operator === 'typeof' ? STRING : NUMBER;
      case 'UpdateExpression':
        this.assignTarget(node.argument, ctx);
        return NUMBER;
      case 'BinaryExpression': {
        if (node.operator === 'in' || node.operator === 'instanceof') {
          this.report('forbidden-syntax', `The ${node.operator} operator is not allowed in scenes`, node.start);
        }
        const left = this.expression(node.left as Expression, ctx);
        const right = this.expression(node.right, ctx);
        if (['==', '!=', '===', '!==', '<', '<=', '>', '>='].includes(node.operator)) return BOOLEAN;
        if (node.operator === '+' && (left.t === 'string' || right.t === 'string')) return STRING;
        return node.operator === '+' ? UNKNOWN : NUMBER;
      }
      case 'LogicalExpression': {
        const left = this.expression(node.left, ctx);
        const right = this.expression(node.right, ctx);
        return left.t === right.t ? left : UNKNOWN;
      }
      case 'ConditionalExpression': {
        this.expression(node.test, ctx);
        const a = this.expression(node.consequent, ctx);
        const b = this.expression(node.alternate, ctx);
        return a.t === b.t && a.t !== 'handle' ? a : UNKNOWN;
      }
      case 'AssignmentExpression': {
        this.assignTarget(node.left, ctx);
        return this.expression(node.right, ctx);
      }
      case 'SequenceExpression': {
        let last: ValueType = UNKNOWN;
        for (const expression of node.expressions) last = this.expression(expression, ctx);
        return last;
      }
      case 'ChainExpression':
        return this.expression(node.expression, ctx);
      case 'MemberExpression':
        return this.member(node, ctx, false);
      case 'CallExpression':
        return this.call(node, ctx);
      case 'ParenthesizedExpression':
        return this.expression(node.expression, ctx);
      default:
        this.forbidden(node as AnyNode);
        return UNKNOWN;
    }
  }

  private literal(node: Extract<AnyNode, { type: 'Literal' }>, ctx: Context): ValueType {
    if ('regex' in node && node.regex) {
      this.report('forbidden-syntax', 'Regular expressions are not available in scenes', node.start);
      return UNKNOWN;
    }
    if ('bigint' in node && node.bigint !== undefined) {
      this.report('forbidden-syntax', 'BigInt is not available in scenes', node.start);
      return UNKNOWN;
    }
    if (typeof node.value === 'string') {
      this.checkString(node.value, node.start, ctx);
      return STRING;
    }
    if (typeof node.value === 'number') return NUMBER;
    if (typeof node.value === 'boolean') return BOOLEAN;
    return UNKNOWN;
  }

  private checkString(text: string, offset: number, ctx: Context): void {
    if (text.length > this.limits.stringChars) {
      this.report('budget-string', `A string is ${text.length} characters; the limit is ${this.limits.stringChars}`, offset);
    }
    if (isColourLiteral(text)) {
      this.report('hard-coded-colour', `"${text}" is a literal colour; use a tone (${TONES.join(', ')})`, offset);
    }
    if (ctx.text && /\d+\.\d+/.test(text)) {
      this.report(
        'number-in-text',
        'This text contains a typed decimal number; compute numbers from the model so the words stay true',
        offset,
        'warning',
      );
    }
  }

  /** Object properties that set a colour or tone. */
  private checkStyleValue(key: string, value: string, offset: number): void {
    if (key === 'tone' && !TONE_SET.has(value)) {
      this.report('unknown-tone', `"${value}" is not a tone; use one of ${TONES.join(', ')}`, offset);
    } else if (['fill', 'stroke', 'color', 'colour', 'background'].includes(key) && NAMED_COLOURS.has(value.toLowerCase())) {
      this.report('hard-coded-colour', `"${value}" is a literal colour; use a tone (${TONES.join(', ')})`, offset);
    }
  }

  private identifier(name: string, node: AnyNode, ctx: Context): ValueType {
    const binding = ctx.scope.lookup(name);
    if (binding) {
      if (binding.holdsFunction && ctx.owner) this.callEdge(ctx.owner, binding, node);
      return binding.type;
    }
    if (ALLOWED_GLOBAL_SET.has(name)) {
      if (name === 'inc') return { t: 'inc' };
      if (name === 'Math') return { t: 'math' };
      if (name === 'Number') return { t: 'number-ns' };
      if (name === 'isFinite' || name === 'isNaN') return FUNCTION;
      return NUMBER;
    }
    const why = FORBIDDEN_GLOBALS[name];
    if (why) this.report('forbidden-global', `${name} ${why}`, node.start);
    else {
      const suggestion = closest(name, [...ALLOWED_GLOBAL_SET, ...allNames(ctx.scope)]);
      this.report(
        'unknown-global',
        `"${name}" is not defined${suggestion ? `; did you mean ${suggestion}?` : '. Scenes can use their own names, inc, Math and Number'}`,
        node.start,
      );
    }
    return UNKNOWN;
  }

  private arrow(node: ArrowFunctionExpression, ctx: Context, owner: Binding | null): void {
    if (node.async) {
      this.report('forbidden-syntax', 'Async functions are not allowed in scenes', node.start);
      return;
    }
    const inner = this.deeper(ctx, node, {
      scope: new Scope(ctx.scope),
      inFunction: true,
      owner: owner ?? ctx.owner,
      // A function handed to the SDK runs later, on a frame, a change, a drag or a button.
      callback: ctx.pending ?? ctx.callback,
      pending: null,
    });
    for (const param of node.params) {
      for (const id of patternIdentifiers(param)) this.declare(inner.scope, id.name, 'param', id.start);
    }
    for (const param of node.params) this.pattern(param, inner, UNKNOWN);
    if (node.body.type === 'BlockStatement') {
      this.count(node.body);
      const body = { ...inner, scope: new Scope(inner.scope) };
      this.declareBlock(node.body.body, body.scope);
      for (const statement of node.body.body) this.statement(statement, body);
    } else {
      this.expression(node.body, inner);
    }
  }

  // -------------------------------------------------------------------------
  // Members and calls
  // -------------------------------------------------------------------------

  private member(node: Extract<AnyNode, { type: 'MemberExpression' }>, ctx: Context, called: boolean): ValueType {
    if (node.object.type === 'Super') {
      this.forbidden(node.object as AnyNode);
      return UNKNOWN;
    }
    const object = this.expression(node.object, ctx);
    if (node.computed) {
      const key = node.property as Expression;
      if (key.type === 'Literal' && typeof key.value === 'string') {
        this.count(key);
        return this.checkMember(object, key.value, key as AnyNode, called);
      }
      this.expression(key, ctx);
      if (object.t === 'inc' || object.t === 'ns' || object.t === 'math' || object.t === 'number-ns') {
        this.report('computed-sdk-member', `Name ${describeType(object)} members directly, as in Math.sin`, key.start);
      }
      return UNKNOWN;
    }
    this.count(node.property as AnyNode);
    const name = (node.property as { name: string }).name;
    return this.checkMember(object, name, node.property as AnyNode, called);
  }

  /** Checks one property or method name against what the receiver is known to have. */
  private checkMember(object: ValueType, name: string, at: AnyNode, called: boolean): ValueType {
    if (BLOCKED_PROPERTIES.has(name)) {
      this.report('blocked-property', `"${name}" is not available in scenes`, at.start);
      return UNKNOWN;
    }
    switch (object.t) {
      case 'inc': {
        if (Object.hasOwn(INC_NAMESPACES, name)) return { t: 'ns', ns: name as NamespaceName };
        if (name in INC_FUNCTIONS) return FUNCTION;
        const suggestion = closest(name, [...Object.keys(INC_FUNCTIONS), ...Object.keys(INC_NAMESPACES)]);
        this.report(
          'unknown-sdk-call',
          `inc.${name} is not part of the SDK${suggestion ? `; did you mean inc.${suggestion}?` : `. Available: ${listOf([...Object.keys(INC_FUNCTIONS), ...Object.keys(INC_NAMESPACES)])}`}`,
          at.start,
        );
        return UNKNOWN;
      }
      case 'ns': {
        const members = INC_NAMESPACES[object.ns];
        if (name in members) return { t: 'ns-fn', ns: object.ns, name };
        const suggestion = closest(name, Object.keys(members));
        this.report(
          'unknown-sdk-call',
          `inc.${object.ns}.${name} is not part of the SDK${suggestion ? `; did you mean inc.${object.ns}.${suggestion}?` : '.'} Available: ${listOf(Object.keys(members))}`,
          at.start,
        );
        return UNKNOWN;
      }
      case 'ns-fn': {
        // inc.calc.normal.cdf: a helper is a function; a related one may join the two names.
        const members = INC_NAMESPACES[object.ns];
        const joined = `${object.name}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
        this.report(
          'unknown-sdk-call',
          `inc.${object.ns}.${object.name} is a function, not an object of helpers${joined in members ? `; did you mean inc.${object.ns}.${joined}?` : `: call it as inc.${object.ns}.${object.name}(...)`}`,
          at.start,
        );
        return UNKNOWN;
      }
      case 'math':
        if (name === 'random') {
          this.report('forbidden-member', 'Math.random is not allowed: use inc.random(), which is seeded so every learner and the probe see the same figure', at.start);
          return UNKNOWN;
        }
        if (!MATH_MEMBERS.has(name)) {
          const suggestion = closest(name, MATH_MEMBERS);
          this.report('unknown-member', `Math.${name} is not available${suggestion ? `; did you mean Math.${suggestion}?` : ''}`, at.start);
          return UNKNOWN;
        }
        return called ? NUMBER : NUMBER;
      case 'number-ns':
        if (!NUMBER_MEMBERS.has(name)) {
          this.report('unknown-member', `Number.${name} is not available. Available: ${listOf(NUMBER_MEMBERS)}`, at.start);
          return UNKNOWN;
        }
        return called ? UNKNOWN : NUMBER;
      case 'handle': {
        const spec = HANDLES[object.kind];
        if (name in spec.methods) return FUNCTION;
        if (name in spec.properties) {
          const returns = spec.properties[name]!;
          return returns === null ? UNKNOWN : handleType(returns, object, UNKNOWN);
        }
        if (spec.open) return UNKNOWN;
        if (spec.callable && called) break;
        const names = [...Object.keys(spec.methods), ...Object.keys(spec.properties)];
        const suggestion = closest(name, names);
        this.report(
          called ? 'unknown-method' : 'unknown-property',
          `${object.kind} handles have no ${called ? 'method' : 'property'} "${name}"${suggestion ? `; did you mean ${suggestion}?` : `. Available: ${listOf(names)}`}`,
          at.start,
        );
        return UNKNOWN;
      }
      default:
        break;
    }
    if (called && !KNOWN_METHODS.has(name)) {
      const suggestion = closest(name, KNOWN_METHODS);
      this.report(
        'unknown-method',
        `.${name}() is not an SDK, array, string or number method${suggestion ? `; did you mean .${suggestion}()?` : ''}`,
        at.start,
      );
    }
    if (name === 'length') return NUMBER;
    return UNKNOWN;
  }

  private call(node: Extract<AnyNode, { type: 'CallExpression' }>, ctx: Context): ValueType {
    const callee = node.callee;
    let receiver: ValueType = UNKNOWN;
    let method: string | null = null;
    let calleeType: ValueType;
    if (callee.type === 'MemberExpression') {
      this.count(callee);
      if (callee.object.type === 'Super') {
        this.forbidden(callee.object as AnyNode);
        return UNKNOWN;
      }
      receiver = this.expression(callee.object, ctx);
      if (!callee.computed) {
        this.count(callee.property as AnyNode);
        method = (callee.property as { name: string }).name;
        calleeType = this.checkMember(receiver, method, callee.property as AnyNode, true);
      } else {
        const key = callee.property as Expression;
        if (key.type === 'Literal' && typeof key.value === 'string') {
          this.count(key);
          method = key.value;
          calleeType = this.checkMember(receiver, key.value, key as AnyNode, true);
        } else {
          this.expression(key, ctx);
          calleeType = UNKNOWN;
        }
      }
    } else if (callee.type === 'Super') {
      this.forbidden(callee as AnyNode);
      return UNKNOWN;
    } else {
      calleeType = this.expression(callee, ctx);
      const notCallable =
        calleeType.t === 'inc' ||
        calleeType.t === 'math' ||
        calleeType.t === 'number-ns' ||
        calleeType.t === 'ns' ||
        (calleeType.t === 'handle' && !HANDLES[calleeType.kind].callable);
      if (notCallable) this.report('not-a-function', `${describeType(calleeType)} is not a function`, callee.start);
    }

    // Context for the arguments: a function handed to the SDK runs later, on a
    // frame, a change, a drag or a button, so it must not create elements.
    // Other arguments are evaluated now, in the caller's own context.
    let argumentContext = ctx;
    if (receiver.t === 'inc' && method !== null) {
      this.incCall(method, node, ctx);
      argumentContext = { ...ctx, pending: `inc.${method}`, text: ctx.text || TEXT_INC_CALLS.has(method) };
    }
    if (receiver.t === 'ns' && method !== null) argumentContext = { ...ctx, pending: `inc.${receiver.ns}.${method}` };
    if (receiver.t === 'handle' && method !== null) {
      argumentContext = { ...ctx, pending: `${receiver.kind.charAt(0).toLowerCase()}${receiver.kind.slice(1)}.${method}` };
      const creates = CREATES_ELEMENTS[receiver.kind];
      if (creates?.has(method) && ctx.callback) {
        this.report(
          'element-in-frame',
          `${method}() creates a new element each time ${ctx.callback} runs; create it once at the top level and update it inside the callback`,
          callee.start,
        );
      }
      if (method === 'part') {
        const [name] = node.arguments;
        if (name && name.type === 'Literal' && typeof name.value === 'string') this.parts.push(name.value);
      }
      if (method === 'tone') {
        const [tone] = node.arguments;
        if (tone && tone.type === 'Literal' && typeof tone.value === 'string' && !TONE_SET.has(tone.value)) {
          this.report('unknown-tone', `"${tone.value}" is not a tone; use one of ${TONES.join(', ')}`, tone.start);
        }
      }
    }

    const argumentTypes: ValueType[] = [];
    for (const argument of node.arguments) {
      if (argument.type === 'SpreadElement') {
        this.count(argument);
        this.expression(argument.argument, argumentContext);
        argumentTypes.push(UNKNOWN);
      } else argumentTypes.push(this.expression(argument, argumentContext));
    }

    // What the call returns.
    if (receiver.t === 'inc' && method !== null && method in INC_FUNCTIONS) {
      return handleType(INC_FUNCTIONS[method as keyof typeof INC_FUNCTIONS], receiver, argumentTypes[0] ?? UNKNOWN);
    }
    if (receiver.t === 'ns' && method !== null) {
      const members = INC_NAMESPACES[receiver.ns] as Readonly<Record<string, Returns>>;
      return method in members ? handleType(members[method]!, receiver, UNKNOWN) : UNKNOWN;
    }
    if (receiver.t === 'handle' && method !== null) {
      const returns = HANDLES[receiver.kind].methods[method];
      return returns === undefined ? UNKNOWN : handleType(returns, receiver, argumentTypes[0] ?? UNKNOWN);
    }
    if (receiver.t === 'math') return NUMBER;
    if (method !== null && ARRAY_RETURNING.has(method) && (receiver.t === 'array' || receiver.t === 'string' || receiver.t === 'unknown')) {
      return method === 'split' || receiver.t === 'array' ? ARRAY : UNKNOWN;
    }
    if (method === 'toFixed' || method === 'toPrecision') return STRING;
    if (calleeType.t === 'handle' && calleeType.kind === 'Formula') return NUMBER;
    return UNKNOWN;
  }

  /** Rules for the inc calls themselves. */
  private incCall(method: string, node: Extract<AnyNode, { type: 'CallExpression' }>, ctx: Context): void {
    if (MOUNT_ONLY.has(method) && ctx.inFunction) {
      this.report(
        'mount-only',
        `inc.${method} declares the scene, so call it once at the top level, not inside a function`,
        node.callee.start,
      );
    }
    switch (method) {
      case 'param':
      case 'toggle':
      case 'choice':
      case 'color':
        this.paramCount++;
        if (this.paramCount > this.limits.params) {
          this.report('too-many-params', `A figure has at most ${this.limits.params} controls (parameters, toggles, choices and colours)`, node.start);
        }
        break;
      case 'svg':
      case 'graph2d':
      case 'space3d':
      case 'graph3d':
      case 'physics2d':
      case 'chart':
      case 'flow':
      case 'chemistry':
      case 'biology': {
        if (isKitCall(method)) this.kitCalls.add(method);
        const [selector] = node.arguments;
        const value =
          selector?.type === 'Literal' && typeof selector.value === 'string'
            ? selector.value
            : selector?.type === 'TemplateLiteral' && selector.expressions.length === 0
              ? selector.quasis[0]!.value.cooked ?? ''
              : null;
        if (value === null || !/^#[A-Za-z][\w-]*$/.test(value)) {
          this.report('stage-selector', `inc.${method} needs the id of an element in the scene HTML, written as a literal like '#stage'`, (selector ?? node).start);
        } else {
          const { line, column } = this.index.position(selector!.start);
          this.stages.push({ selector: value, line, column });
        }
        break;
      }
      case 'steps': {
        const [list] = node.arguments;
        if (list?.type === 'ArrayExpression') this.stepCount = list.elements.length;
        break;
      }
      case 'idea':
        this.hasIdea = true;
        break;
      case 'describe':
        this.hasDescribe = true;
        break;
      case 'explain':
        this.hasExplain = true;
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Recursion
  // -------------------------------------------------------------------------

  private callEdge(owner: Binding, target: Binding, at: AnyNode): void {
    let edges = this.calls.get(owner);
    if (!edges) this.calls.set(owner, (edges = new Map()));
    if (!edges.has(target)) edges.set(target, at);
  }

  private checkRecursion(): void {
    const reported = new Set<Binding>();
    const state = new Map<Binding, 'visiting' | 'done'>();
    const stack: Binding[] = [];
    const visit = (binding: Binding) => {
      state.set(binding, 'visiting');
      stack.push(binding);
      for (const [target, at] of this.calls.get(binding) ?? []) {
        const s = state.get(target);
        if (s === 'visiting') {
          const cycle = stack.slice(stack.indexOf(target)).map((b) => b.name);
          if (!reported.has(target)) {
            reported.add(target);
            const path = cycle.length === 1 ? `${cycle[0]} calls itself` : `${[...cycle, cycle[0]].join(' calls ')}`;
            this.report('recursion', `Recursion is not allowed in scenes (${path}); use a for loop`, at.start);
          }
        } else if (s === undefined) visit(target);
      }
      stack.pop();
      state.set(binding, 'done');
    };
    for (const binding of this.calls.keys()) if (!state.has(binding)) visit(binding);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function patternIdentifiers(node: Pattern | AnyNode): Array<{ name: string; start: number }> {
  switch (node.type) {
    case 'Identifier':
      return [{ name: node.name, start: node.start }];
    case 'ObjectPattern':
      return node.properties.flatMap((p) => patternIdentifiers(p.type === 'RestElement' ? p.argument : p.value));
    case 'ArrayPattern':
      return node.elements.flatMap((e) => (e ? patternIdentifiers(e) : []));
    case 'AssignmentPattern':
      return patternIdentifiers(node.left);
    case 'RestElement':
      return patternIdentifiers(node.argument);
    default:
      return [];
  }
}

function propertyName(key: AnyNode | Expression): string | null {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) return String(key.value);
  return null;
}

function numericLiteral(node: Expression | AnyNode): number | null {
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
  if (node.type === 'UnaryExpression' && (node.operator === '-' || node.operator === '+')) {
    const inner = numericLiteral(node.argument);
    return inner === null ? null : node.operator === '-' ? -inner : inner;
  }
  return null;
}

/** The fixed step of a for-loop update, or null when it is not fixed. */
function loopStep(update: Expression, counter: string): number | null {
  if (update.type === 'UpdateExpression' && update.argument.type === 'Identifier' && update.argument.name === counter) {
    return update.operator === '++' ? 1 : -1;
  }
  if (
    update.type === 'AssignmentExpression' &&
    update.left.type === 'Identifier' &&
    update.left.name === counter &&
    (update.operator === '+=' || update.operator === '-=')
  ) {
    const amount = numericLiteral(update.right);
    if (amount === null || amount === 0 || !Number.isFinite(amount)) return null;
    return update.operator === '+=' ? amount : -amount;
  }
  return null;
}

function allNames(scope: Scope | null): string[] {
  return scope ? [...scope.bindings.keys(), ...allNames(scope.parent)] : [];
}
