/**
 * Rules for explicit state (docs/state-machines.md). A part's states live in one field with a table of moves, never in
 * a handful of flags that must agree with each other.
 */

const STATE_NAMES = ['state', 'phase', 'status'];

/** The name of `this.x` or `this.#x`, or undefined. */
function thisField(node) {
  if (node?.type !== 'MemberExpression' || node.computed || node.object.type !== 'ThisExpression') return undefined;
  if (node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'PrivateIdentifier') return `#${node.property.name}`;
  return undefined;
}

/** The name of `x.name` (not computed), or undefined. */
function memberName(node) {
  if (node?.type !== 'MemberExpression' || node.computed) return undefined;
  if (node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'PrivateIdentifier') return node.property.name;
  return undefined;
}

function keyName(def) {
  if (def.computed) return undefined;
  if (def.key.type === 'Identifier') return def.key.name;
  if (def.key.type === 'PrivateIdentifier') return `#${def.key.name}`;
  return undefined;
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** The nearest function around `node`. */
function nearestFunction(context, node) {
  const anc = context.sourceCode.getAncestors(node);
  for (let i = anc.length - 1; i >= 0; i--) if (FUNCTIONS.has(anc[i].type)) return anc[i];
  return undefined;
}

/** True when the nearest function is a class constructor (callbacks made inside it do not count). */
function inConstructor(context, node) {
  const fn = nearestFunction(context, node);
  return fn?.type === 'FunctionExpression' && fn.parent?.type === 'MethodDefinition' && fn.parent.kind === 'constructor';
}

function isBooleanField(def) {
  if (def.type !== 'PropertyDefinition' || def.static || def.readonly) return false;
  if (def.value?.type === 'Literal' && typeof def.value.value === 'boolean') return true;
  const t = def.typeAnnotation?.typeAnnotation;
  if (!t) return false;
  if (t.type === 'TSBooleanKeyword') return true;
  if (t.type === 'TSUnionType') return t.types.some((u) => u.type === 'TSBooleanKeyword') && t.types.every((u) => ['TSBooleanKeyword', 'TSUndefinedKeyword', 'TSNullKeyword'].includes(u.type));
  return false;
}

const isTransitionCall = (node) =>
  node?.type === 'CallExpression' && (node.callee.type === 'Identifier' ? node.callee.name === 'transition' : memberName(node.callee) === 'transition');

export const noFlagSoup = {
  meta: {
    type: 'problem',
    docs: { description: 'A class may hold at most `max` boolean fields that change after construction; use one state field and a table.' },
    schema: [{ type: 'object', properties: { max: { type: 'integer', minimum: 0 } }, additionalProperties: false }],
    messages: {
      soup: 'This class changes {{count}} true/false fields ({{names}}) after it is made. Put its states in one field with a *_MACHINE table (StateMachine from @incantly/kernel); docs/state-machines.md.',
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? 2;
    const stack = [];
    return {
      ClassBody(node) {
        const fields = new Set();
        for (const def of node.body) {
          const name = isBooleanField(def) ? keyName(def) : undefined;
          if (name) fields.add(name);
        }
        stack.push({ node, fields, changed: new Set() });
      },
      'ClassBody:exit'() {
        const top = stack.pop();
        if (top.changed.size > max) {
          const names = [...top.changed].sort();
          context.report({ node: top.node.parent.id ?? top.node.parent, messageId: 'soup', data: { count: String(names.length), names: names.join(', ') } });
        }
      },
      AssignmentExpression(node) {
        const top = stack[stack.length - 1];
        const name = thisField(node.left);
        if (!top || !name || !top.fields.has(name) || inConstructor(context, node)) return;
        top.changed.add(name);
      },
    };
  },
};

export const transitionOnly = {
  meta: {
    type: 'problem',
    docs: { description: 'A state field changes only through transition() or a StateMachine.' },
    schema: [{ type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
    messages: {
      direct: 'Set `{{name}}` through transition(TABLE_MACHINE, from, event) or a StateMachine, so only moves in the table can happen.',
    },
  },
  create(context) {
    const names = new Set(context.options[0]?.names ?? STATE_NAMES);
    return {
      AssignmentExpression(node) {
        const name = memberName(node.left);
        if (!name || !names.has(name) || inConstructor(context, node)) return;
        const r = node.right;
        if (isTransitionCall(r)) return;
        if (r.type === 'LogicalExpression' && r.operator === '??' && isTransitionCall(r.left)) return;
        context.report({ node, messageId: 'direct', data: { name } });
      },
    };
  },
};

const LOOSE = new Set(['TSStringKeyword', 'TSNumberKeyword', 'TSAnyKeyword', 'TSUnknownKeyword']);

export const unionType = {
  meta: {
    type: 'problem',
    docs: { description: 'A state field has a union of named states as its type.' },
    schema: [{ type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
    messages: {
      loose: 'Give `{{name}}` a type that lists its states, such as `\'idle\' | \'live\'` or a named type, not {{what}}.',
    },
  },
  create(context) {
    const names = new Set(context.options[0]?.names ?? STATE_NAMES);
    return {
      PropertyDefinition(node) {
        const name = keyName(node)?.replace(/^#/, '');
        if (!name || !names.has(name) || node.static) return;
        const t = node.typeAnnotation?.typeAnnotation;
        if (t) {
          if (LOOSE.has(t.type)) context.report({ node, messageId: 'loose', data: { name, what: context.sourceCode.getText(t) } });
          return;
        }
        // a read-only field holding a machine, or a value TypeScript types narrowly, needs no annotation
        if (node.readonly) return;
        if (node.value?.type === 'NewExpression') return;
        if (node.value?.type === 'TSAsExpression') return;
        context.report({ node, messageId: 'loose', data: { name, what: 'no type (TypeScript widens it to string)' } });
      },
    };
  },
};

export const tableRequired = {
  meta: {
    type: 'problem',
    docs: { description: 'transition(), canTransition() and StateMachine take a table named *_MACHINE.' },
    schema: [],
    messages: { table: 'Pass a table named *_MACHINE (a const at module level), so the states and moves are written down in one place.' },
  },
  create(context) {
    const ok = (arg) => {
      if (!arg) return false;
      if (arg.type === 'Identifier') return /_MACHINE$/.test(arg.name);
      const n = memberName(arg);
      return n !== undefined && /_MACHINE$/.test(n);
    };
    const check = (node, callee) => {
      const name = callee.type === 'Identifier' ? callee.name : memberName(callee);
      if (name !== 'transition' && name !== 'canTransition' && name !== 'StateMachine') return;
      if (!ok(node.arguments[0])) context.report({ node, messageId: 'table' });
    };
    return {
      CallExpression(node) {
        const name = node.callee.type === 'Identifier' ? node.callee.name : memberName(node.callee);
        if (name === 'transition' || name === 'canTransition') check(node, node.callee);
      },
      NewExpression(node) {
        check(node, node.callee);
      },
    };
  },
};

/** The table's object literal, through `as`, `satisfies` and `Object.freeze(...)`, or undefined. */
function tableObject(init) {
  let node = init;
  for (;;) {
    if (!node) return undefined;
    if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TSNonNullExpression') node = node.expression;
    else if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && memberName(node.callee) === 'freeze' && node.arguments.length === 1) node = node.arguments[0];
    else break;
  }
  return node.type === 'ObjectExpression' ? node : undefined;
}

export const tableRefuses = {
  meta: {
    type: 'problem',
    docs: { description: 'A *_MACHINE table must refuse some move: its rows may not all be the same.' },
    schema: [],
    messages: {
      same: '`{{name}}` has the same row in every state, so it refuses nothing. A table that refuses nothing is a value: derive it, or write only the moves that may happen.',
    },
  },
  create(context) {
    const text = (node) => context.sourceCode.getText(node);
    /** The row as sorted `event: target` texts, or undefined when it is not an object literal. */
    const shapeOf = (value) => (value.type === 'ObjectExpression' ? value.properties.map(text).sort().join(',') : undefined);
    return {
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !/_MACHINE$/.test(node.id.name)) return;
        const table = tableObject(node.init);
        if (!table) return;
        const rows = table.properties.filter((p) => p.type === 'Property');
        if (rows.length < 2 || rows.length !== table.properties.length) return;
        const values = rows.map((p) => p.value);
        const same =
          values.every((v) => v.type === 'Identifier') ? values.every((v) => v.name === values[0].name)
            : values.every((v) => v.type === 'ObjectExpression') ? values.every((v) => shapeOf(v) === shapeOf(values[0]))
              : false;
        if (same) context.report({ node: node.id, messageId: 'same', data: { name: node.id.name } });
      },
    };
  },
};

/** An event name that starts something: the machine leaves its resting state for a state that holds data. */
const BEGIN_LIKE = /^(begin|start|down|open|enter|press|grab|arm|activate|engage)/i;

/** True for `null`, `undefined` and `void 0`: the value that clears a field. */
const isNullish = (node) =>
  (node.type === 'Literal' && node.value === null && node.raw === 'null') ||
  (node.type === 'Identifier' && node.name === 'undefined') ||
  (node.type === 'UnaryExpression' && node.operator === 'void');

/** True when the type is a union of something with `null` or `undefined`. */
function isNullableUnion(def) {
  const t = def.typeAnnotation?.typeAnnotation;
  if (t?.type !== 'TSUnionType') return false;
  const isNil = (u) => u.type === 'TSNullKeyword' || u.type === 'TSUndefinedKeyword';
  return t.types.some(isNil) && t.types.some((u) => !isNil(u));
}

const isMachineField = (def) =>
  def.type === 'PropertyDefinition' && !def.static && def.value?.type === 'NewExpression' && def.value.callee.type === 'Identifier' && def.value.callee.name === 'StateMachine';

export const noShadowNull = {
  meta: {
    type: 'problem',
    docs: { description: 'A nullable field that is set when a machine begins must be cleared when the machine leaves the state, or live in the state data.' },
    schema: [],
    messages: {
      shadow:
        '`{{name}}` is set when `{{machine}}` begins and never set back to null or undefined: this field holds part of the state; clear it when the machine leaves the state, or keep it in the state\'s data.',
    },
  },
  create(context) {
    const classes = [];
    const methods = [];
    return {
      ClassBody(node) {
        const machines = new Set();
        const nullable = new Map();
        for (const def of node.body) {
          if (def.type !== 'PropertyDefinition' || def.static) continue;
          const name = keyName(def);
          if (!name) continue;
          if (isMachineField(def)) machines.add(name);
          else if (isNullableUnion(def)) nullable.set(name, def);
        }
        // a class with no machine or no nullable field has nothing to check
        classes.push(machines.size > 0 && nullable.size > 0 ? { machines, nullable, cleared: new Set(), begun: new Map() } : undefined);
      },
      'ClassBody:exit'() {
        const info = classes.pop();
        if (!info) return;
        for (const [name, machine] of info.begun) {
          if (info.cleared.has(name)) continue;
          context.report({ node: info.nullable.get(name), messageId: 'shadow', data: { name: name.replace(/^#/, ''), machine: machine.replace(/^#/, '') } });
        }
      },
      MethodDefinition(node) {
        methods.push({ kind: node.kind, machine: undefined, assigns: [] });
      },
      'MethodDefinition:exit'() {
        const method = methods.pop();
        const info = classes[classes.length - 1];
        if (!method || !info || method.kind === 'constructor' || method.machine === undefined) return;
        for (const name of method.assigns) if (!info.begun.has(name)) info.begun.set(name, method.machine);
      },
      CallExpression(node) {
        const info = classes[classes.length - 1];
        const method = methods[methods.length - 1];
        if (!info || !method || node.callee.type !== 'MemberExpression' || memberName(node.callee) !== 'send') return;
        const machine = thisField(node.callee.object);
        const event = node.arguments[0];
        if (machine !== undefined && info.machines.has(machine) && event?.type === 'Literal' && typeof event.value === 'string' && BEGIN_LIKE.test(event.value)) method.machine = machine;
      },
      AssignmentExpression(node) {
        const info = classes[classes.length - 1];
        const method = methods[methods.length - 1];
        const name = thisField(node.left);
        if (!info || !method || method.kind === 'constructor' || name === undefined || !info.nullable.has(name)) return;
        if (isNullish(node.right)) info.cleared.add(name);
        else method.assigns.push(name);
      },
    };
  },
};

/** Flags an I/O object keeps about itself: an answer's head sent, a stream ended, a connection closed. */
const IO_FLAGS = new Set(['headersSent', 'writableEnded', 'writableFinished', 'destroyed', 'readyState']);
/** `destroyed` is the flag of a Node stream, socket or response; in a file that imports no `node:` module it is a part's own state (an app handle, a view). */
const NODE_ONLY_FLAGS = new Set(['destroyed']);

/** The name a function is known by: its declaration, its method or property key, or the variable it is assigned to. */
function functionName(fn) {
  if (fn.type === 'FunctionDeclaration') return fn.id?.name;
  const p = fn.parent;
  if (p?.type === 'MethodDefinition' || p?.type === 'Property' || p?.type === 'PropertyDefinition') return keyName(p);
  if (p?.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  return undefined;
}

export const noIoFlags = {
  meta: {
    type: 'problem',
    docs: { description: 'A file that makes a state machine does not read the flags of an I/O object outside its low-level writers.' },
    schema: [],
    messages: {
      io: '`{{name}}` is a second record of whether an answer or a stream is over, next to this file\'s state machine, and the two can disagree. Ask the machine; only a function whose name starts with `write` may read it, as a last guard before a write.',
    },
  },
  create(context) {
    let makesMachine = false;
    let importsNode = false;
    const reads = [];
    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string' && node.source.value.startsWith('node:')) importsNode = true;
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'StateMachine') makesMachine = true;
      },
      MemberExpression(node) {
        const name = memberName(node) ?? (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : undefined);
        if (name === undefined || !IO_FLAGS.has(name)) return;
        // a getter of the class itself (`this.destroyed`) is derived from the machine, not a second record
        if (node.object.type === 'ThisExpression') return;
        // `x.destroyed = true` is a write, not a read of the flag
        const parent = node.parent;
        if (parent.type === 'AssignmentExpression' && parent.left === node) return;
        const allowed = context.sourceCode.getAncestors(node).some((a) => FUNCTIONS.has(a.type) && /^write/.test(functionName(a) ?? ''));
        if (!allowed) reads.push({ node, name });
      },
      'Program:exit'() {
        if (!makesMachine) return;
        for (const { node, name } of reads) {
          if (NODE_ONLY_FLAGS.has(name) && !importsNode) continue;
          context.report({ node, messageId: 'io', data: { name } });
        }
      },
    };
  },
};

export const noStaleAfterAwait = {
  meta: {
    type: 'problem',
    docs: { description: 'A copy of a state field made before an await is not read after it.' },
    schema: [{ type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
    messages: {
      stale: '`{{local}}` copies `{{name}}` before an await and is read after it; the state may have moved. Read the state again after the await.',
    },
  },
  create(context) {
    const names = new Set(context.options[0]?.names ?? STATE_NAMES);
    const stack = [];
    const enter = () => stack.push({ awaits: [], copies: [] });
    const exit = () => {
      const top = stack.pop();
      if (!top || top.awaits.length === 0) return;
      for (const { declarator, name } of top.copies) {
        const after = top.awaits.filter((a) => a.range[0] > declarator.range[1]);
        if (after.length === 0) continue;
        for (const v of context.sourceCode.getDeclaredVariables(declarator)) {
          for (const ref of v.references) {
            if (!ref.isRead() || ref.init) continue;
            const at = ref.identifier.range[0];
            if (after.some((a) => a.range[1] <= at)) {
              context.report({ node: ref.identifier, messageId: 'stale', data: { local: v.name, name } });
              break;
            }
          }
        }
      }
    };
    return {
      FunctionDeclaration: enter,
      FunctionExpression: enter,
      ArrowFunctionExpression: enter,
      'FunctionDeclaration:exit': exit,
      'FunctionExpression:exit': exit,
      'ArrowFunctionExpression:exit': exit,
      AwaitExpression(node) {
        stack[stack.length - 1]?.awaits.push(node);
      },
      VariableDeclarator(node) {
        const name = memberName(node.init);
        if (name && names.has(name)) stack[stack.length - 1]?.copies.push({ declarator: node, name });
      },
    };
  },
};
