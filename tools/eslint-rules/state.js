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
