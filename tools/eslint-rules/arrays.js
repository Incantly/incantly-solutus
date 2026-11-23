/**
 * `no-length-reset` (BR-77, handoff/board/findings.md). `list.length = 0` empties an array by dropping its storage, so the
 * next `push` makes a new one: a list emptied and filled again every frame makes garbage every frame. A list that is filled
 * again is written by index and cut to its count (`list[n++] = x; ... list.length = n`), or keeps a count of its own. The
 * rule reports `X.length = 0` when the same `X` is also pushed to in the same class (for `this.x` and `this.#x`) or the
 * same function (for anything else). A list that is only ever emptied (history, errors) is not reported.
 */
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const isThisMember = (node) => node.type === 'MemberExpression' && node.object.type === 'ThisExpression';

export const noLengthReset = {
  meta: {
    type: 'problem',
    docs: { description: 'A list filled again is not emptied with `length = 0`: that drops its storage, and the next push makes new storage.' },
    schema: [],
    messages: {
      reset:
        '`{{name}}.length = 0` drops the array\'s storage, and the `push` that fills it again makes new storage every time (BR-77). Write it by index and cut it to the count (`{{name}}[n++] = x; … {{name}}.length = n`), or keep a count.',
    },
  },
  create(context) {
    const src = context.sourceCode;
    const scopeOf = (node, member) => {
      const anc = src.getAncestors(node);
      for (let i = anc.length - 1; i >= 0; i--) {
        const a = anc[i];
        if (member ? a.type === 'ClassBody' : FUNCTIONS.has(a.type)) return a;
      }
      return src.ast;
    };
    /** `scope node -> name -> nodes` of the resets and of the pushes. */
    const resets = new Map();
    const pushes = new Map();
    const note = (map, scope, name, node) => {
      const byName = map.get(scope) ?? new Map();
      byName.set(name, [...(byName.get(name) ?? []), node]);
      map.set(scope, byName);
    };
    return {
      AssignmentExpression(node) {
        const left = node.left;
        if (node.operator !== '=' || left.type !== 'MemberExpression' || left.computed || left.property.type !== 'Identifier' || left.property.name !== 'length') return;
        if (node.right.type !== 'Literal' || node.right.value !== 0) return;
        const target = left.object;
        if (target.type !== 'Identifier' && !isThisMember(target)) return;
        note(resets, scopeOf(node, isThisMember(target)), src.getText(target), node);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier' || callee.property.name !== 'push') return;
        const target = callee.object;
        if (target.type !== 'Identifier' && !isThisMember(target)) return;
        note(pushes, scopeOf(node, isThisMember(target)), src.getText(target), node);
      },
      'Program:exit'() {
        for (const [scope, byName] of resets) {
          const pushed = pushes.get(scope);
          if (pushed === undefined) continue;
          for (const [name, nodes] of byName) {
            if (!pushed.has(name)) continue;
            for (const node of nodes) context.report({ node, messageId: 'reset', data: { name } });
          }
        }
      },
    };
  },
};
