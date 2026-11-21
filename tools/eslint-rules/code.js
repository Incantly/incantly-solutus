/** `no-throw-export` and `no-ai-credit` (AGENTS.md: Code, Attribution). */

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function isExported(fn) {
  const p = fn.parent;
  if (!p) return false;
  // export function f() {} / export default function () {}
  if (fn.type === 'FunctionDeclaration') return p.type === 'ExportNamedDeclaration' || p.type === 'ExportDefaultDeclaration';
  // export const f = () => {}
  if (p.type === 'VariableDeclarator') return p.parent?.parent?.type === 'ExportNamedDeclaration';
  if (p.type === 'ExportDefaultDeclaration') return true;
  // a public method of an exported class
  if (p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') {
    if (p.key.type === 'PrivateIdentifier' || p.accessibility === 'private' || p.accessibility === 'protected') return false;
    if (p.kind === 'constructor') return false;
    const cls = p.parent?.parent;
    const outer = cls?.parent;
    return outer?.type === 'ExportNamedDeclaration' || outer?.type === 'ExportDefaultDeclaration';
  }
  return false;
}

export const noThrowExport = {
  meta: {
    type: 'problem',
    docs: { description: 'Exported functions return a Result instead of throwing across a package boundary.' },
    schema: [],
    messages: { thrown: 'An exported function must not throw; return a Result (packages/kernel/src/contracts/errors.ts) in the format of docs/features/errors/design.md.' },
  },
  create(context) {
    return {
      ThrowStatement(node) {
        const anc = context.sourceCode.getAncestors(node);
        for (let i = anc.length - 1; i >= 0; i--) {
          const a = anc[i];
          // a throw caught in the same function never leaves it
          if (a.type === 'TryStatement' && a.block === (anc[i + 1] ?? node) && a.handler) return;
          if (FUNCTIONS.has(a.type)) {
            if (isExported(a)) context.report({ node, messageId: 'thrown' });
            return;
          }
        }
      },
    };
  },
};

// `.kiro/specs/...` is a path in this repository, not a credit
const CREDIT = /(?<![.\w/-])(claude|anthropic|chatgpt|openai|copilot|gemini|kiro)\b|co-authored-by|generated (?:with|by) (?:an? )?ai\b/i;

export const noAiCredit = {
  meta: {
    type: 'problem',
    docs: { description: 'Code never credits an AI assistant (AGENTS.md, Attribution).' },
    schema: [],
    messages: { credit: 'Do not credit an AI tool in code ("{{word}}"). The usage log and the README are the only places for it.' },
  },
  create(context) {
    const look = (node, text) => {
      const m = CREDIT.exec(text);
      if (m) context.report({ node, messageId: 'credit', data: { word: m[0] } });
    };
    return {
      Program() {
        for (const c of context.sourceCode.getAllComments()) look(c, c.value);
      },
      Literal(node) {
        if (typeof node.value === 'string') look(node, node.value);
      },
      TemplateElement(node) {
        look(node, node.value.raw);
      },
    };
  },
};
