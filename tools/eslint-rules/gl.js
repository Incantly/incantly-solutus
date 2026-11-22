/**
 * `gl-clear-masks` (BR-83, handoff/board/findings.md). A WebGL clear writes only what the depth and colour masks let
 * through, and the masks are state of the context that the last draw left: a clear after a draw with depth writes off
 * keeps the old depth, and the next picture loses the parts that fail the test against it. So a `clear` of the depth
 * buffer must come after `depthMask(true)` in the same function, and a clear of the colour buffer after
 * `colorMask(true, true, true, true)`.
 */
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** The names of the `*_BUFFER_BIT` members an expression mentions. */
function bitsOf(node, out = new Set()) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (node.type === 'MemberExpression' && node.property.type === 'Identifier' && node.property.name.endsWith('_BUFFER_BIT')) out.add(node.property.name);
  else if (node.type === 'BinaryExpression') {
    bitsOf(node.left, out);
    bitsOf(node.right, out);
  }
  return out;
}

const calleeName = (call) => (call.callee.type === 'MemberExpression' && call.callee.property.type === 'Identifier' ? call.callee.property.name : undefined);
const isTrue = (arg) => arg?.type === 'Literal' && arg.value === true;

export const glClearMasks = {
  meta: {
    type: 'problem',
    docs: { description: 'A WebGL clear sets the depth and colour masks it needs first: the last draw may have left them off.' },
    schema: [],
    messages: {
      depth: 'Call `depthMask(true)` before this clear in the same function: a draw with depth writes off leaves the mask off, and the clear then keeps the old depth (BR-83).',
      color: 'Call `colorMask(true, true, true, true)` before this clear in the same function: a masked draw leaves colour writes off, and the clear then keeps the old picture (BR-83).',
    },
  },
  create(context) {
    /** For each function, the start of each `depthMask(true)` and full `colorMask` call in it. */
    const masks = new Map();
    const fnOf = (node) => {
      const anc = context.sourceCode.getAncestors(node);
      for (let i = anc.length - 1; i >= 0; i--) if (FUNCTIONS.has(anc[i].type)) return anc[i];
      return context.sourceCode.ast;
    };
    const clears = [];
    return {
      CallExpression(node) {
        const name = calleeName(node);
        if (name === 'depthMask' && isTrue(node.arguments[0])) {
          const m = masks.get(fnOf(node)) ?? { depth: [], color: [] };
          m.depth.push(node.range[0]);
          masks.set(fnOf(node), m);
        } else if (name === 'colorMask' && node.arguments.length === 4 && node.arguments.every(isTrue)) {
          const m = masks.get(fnOf(node)) ?? { depth: [], color: [] };
          m.color.push(node.range[0]);
          masks.set(fnOf(node), m);
        } else if (name === 'clear' && node.arguments.length === 1) {
          const bits = bitsOf(node.arguments[0]);
          if (bits.size > 0) clears.push({ node, fn: fnOf(node), bits });
        }
      },
      'Program:exit'() {
        for (const { node, fn, bits } of clears) {
          const m = masks.get(fn) ?? { depth: [], color: [] };
          const before = (list) => list.some((at) => at < node.range[0]);
          if (bits.has('DEPTH_BUFFER_BIT') && !before(m.depth)) context.report({ node, messageId: 'depth' });
          if (bits.has('COLOR_BUFFER_BIT') && !before(m.color)) context.report({ node, messageId: 'color' });
        }
      },
    };
  },
};
