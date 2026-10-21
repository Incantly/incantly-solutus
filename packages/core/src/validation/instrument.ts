import { parse, type AnyNode, type Program } from 'acorn';

/**
 * Prepares validated scene JavaScript to run in the Worker:
 *
 * - every loop body and function body first burns one unit of fuel, so a loop
 *   or call chain that runs away fails with a precise message instead of
 *   freezing the Worker until the watchdog kills it;
 * - every computed property key passes through a guard, so `obj[name]` cannot
 *   reach `constructor` or `__proto__` with a key built at run time.
 *
 * Text is only inserted, never on a new line, so line numbers stay the
 * agent's own and columns map back through `originalColumn`.
 */

import type { ColumnShift, InstrumentedScene } from './instrument-map';
import { FUEL_FUNCTION, KEY_FUNCTION } from './names';

export { FUEL_FUNCTION, KEY_FUNCTION };
export { originalColumn } from './instrument-map';
export type { ColumnShift, InstrumentedScene } from './instrument-map';

interface Insertion {
  readonly offset: number;
  readonly text: string;
  /** Closing text goes before opening text at the same offset, inner first. */
  readonly closing: boolean;
  readonly depth: number;
}


export function instrumentSceneJs(source: string, program: Program): InstrumentedScene {
  const insertions: Insertion[] = [];
  const add = (offset: number, text: string, closing: boolean, depth: number) => insertions.push({ offset, text, closing, depth });
  const fuelBlock = (body: AnyNode, depth: number) => {
    if (body.type === 'BlockStatement') add(body.start + 1, `${FUEL_FUNCTION}();`, false, depth);
    else {
      add(body.start, `{${FUEL_FUNCTION}();`, false, depth);
      add(body.end, '}', true, depth);
    }
  };

  const visit = (node: AnyNode, depth: number) => {
    switch (node.type) {
      case 'ForStatement':
      case 'ForOfStatement':
        fuelBlock(node.body, depth);
        break;
      case 'ArrowFunctionExpression':
        if (node.body.type === 'BlockStatement') add(node.body.start + 1, `${FUEL_FUNCTION}();`, false, depth);
        else {
          add(node.body.start, `(${FUEL_FUNCTION}(),`, false, depth);
          add(node.body.end, ')', true, depth);
        }
        break;
      case 'MemberExpression':
        if (node.computed && !isLiteralKey(node.property as AnyNode)) {
          add(node.property.start, `${KEY_FUNCTION}(`, false, depth);
          add(node.property.end, ')', true, depth);
        }
        break;
      default:
        break;
    }
    for (const child of children(node)) visit(child, depth + 1);
  };
  visit(program, 0);

  insertions.sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset;
    if (a.closing !== b.closing) return a.closing ? -1 : 1;
    return a.closing ? b.depth - a.depth : a.depth - b.depth;
  });

  let code = '';
  let last = 0;
  const shifts: Record<number, ColumnShift[]> = {};
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  for (const insertion of insertions) {
    code += source.slice(last, insertion.offset) + insertion.text;
    last = insertion.offset;
    const line = lineOf(insertion.offset);
    (shifts[line + 1] ??= []).push({ column: insertion.offset - lineStarts[line]! + 1, length: insertion.text.length });
  }
  code += source.slice(last);

  // The result must still be valid script: anything else is an engine bug.
  parse(code, { ecmaVersion: 2020, sourceType: 'script' });
  return { code, shifts };
}

function isLiteralKey(node: AnyNode): boolean {
  return node.type === 'Literal' && (typeof node.value === 'number' || typeof node.value === 'string');
}

/** Child nodes of any syntax node, in source order. */
function children(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === 'object' && typeof (item as AnyNode).type === 'string') out.push(item as AnyNode);
    } else if (value && typeof value === 'object' && typeof (value as AnyNode).type === 'string') {
      out.push(value as AnyNode);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
