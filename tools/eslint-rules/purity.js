/** `no-imported-mutation` and `state-refusal-reported` (AGENTS.md: Rules are checked by code). */

/** The identifier a member chain starts from: `a` in `a.b.c`, `a!.b` or `a[b].c`; undefined when it starts from a call or `this`. */
function rootIdentifier(node) {
  let n = node;
  while (n) {
    if (n.type === 'Identifier') return n;
    if (n.type === 'MemberExpression') n = n.object;
    else if (n.type === 'TSNonNullExpression' || n.type === 'TSAsExpression' || n.type === 'TSTypeAssertion' || n.type === 'TSSatisfiesExpression') n = n.expression;
    else return undefined;
  }
  return undefined;
}

/** True when the name, seen from the node, is a binding made by an `import`. */
function isImportBinding(sourceCode, node, name) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable.defs.some((d) => d.type === 'ImportBinding');
  }
  return false;
}

export const noImportedMutation = {
  meta: {
    type: 'problem',
    docs: { description: 'Code does not write into an object it imported: every importer shares it (AGENTS.md).' },
    schema: [],
    messages: {
      mutated:
        'a module\'s object is shared by everyone who imports it; pass state in, or give each owner its own. `{{name}}` is imported, so do not write to it.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    /** Reports a write whose target is a member of an imported binding. */
    const check = (target, report) => {
      if (target.type !== 'MemberExpression') return;
      const root = rootIdentifier(target);
      if (root && isImportBinding(sourceCode, root, root.name)) context.report({ node: report, messageId: 'mutated', data: { name: root.name } });
    };
    return {
      AssignmentExpression(node) {
        check(node.left, node);
      },
      UpdateExpression(node) {
        check(node.argument, node);
      },
      CallExpression(node) {
        const c = node.callee;
        if (c.type !== 'MemberExpression' || c.computed || c.property.type !== 'Identifier') return;
        if (c.object.type !== 'Identifier' || c.object.name !== 'Object') return;
        if (c.property.name !== 'assign' && c.property.name !== 'defineProperty' && c.property.name !== 'setPrototypeOf') return;
        const first = node.arguments[0];
        if (!first) return;
        const root = rootIdentifier(first);
        if (root && isImportBinding(sourceCode, root, root.name)) context.report({ node, messageId: 'mutated', data: { name: root.name } });
      },
    };
  },
};

export const stateRefusalReported = {
  meta: {
    type: 'problem',
    docs: { description: 'A StateMachine is given the function that hears a refused move, so a refusal is reported, never silent.' },
    schema: [],
    messages: {
      silent: '`new StateMachine(table, initial)` needs a third argument, `onRefused`, so a refused move is reported (the board through its `onError` as `internal`, tiptap through `reportError`).',
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'StateMachine') return;
        if (node.arguments.length < 3) context.report({ node, messageId: 'silent' });
      },
    };
  },
};
