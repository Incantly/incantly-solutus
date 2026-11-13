/**
 * Shared evaluation helpers for handler steps, input boxes and area actions.
 *
 * Steps are checked by substituting their local names (self, value, event, k)
 * with literals or refs in the parsed tree, printing the line back, and running
 * it through the kernel's own parse/check/compile pipeline. Nothing here
 * re-implements the language.
 */

import type { ErrorObject } from '../../contracts/errors';
import type { Name, ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import { validKeysFor } from '../../graph/props';
import { numberSource } from '../../graph/values';
import type { CheckedLine } from '../../language/check';
import { checkLine } from '../../language/lines';
import { compileNode, evaluate } from '../../language/compile';
import { createEnv } from '../../language/runtime';
import type { Env } from '../../language/runtime';
import type { Expr, LineNode, ParsedLine } from '../../language/ast';
import { parseLine } from '../../language/parser';
import { printExpr, printLineNode } from '../../language/printer';
import type { TNode } from '../../language/tnode';

/* ------------------------------ substitution ------------------------------ */

/** A local binding: a literal expression, or a live reference to an object. */
export type Binding = { readonly literal: Expr } | { readonly ref: Name };

export function numLiteral(v: number): Expr {
  if (!Number.isFinite(v)) return { k: 'name', name: v > 0 ? 'inf' : 'undefined', s: 0, e: 0 };
  return { k: 'num', v, text: numberSource(v), int: Number.isInteger(v), s: 0, e: 0 };
}

export function boolLiteral(v: boolean): Expr {
  return { k: 'bool', v, s: 0, e: 0 };
}

export function textLiteral(v: string): Expr {
  return { k: 'str', parts: [v], s: 0, e: 0 };
}

export function pointLiteral(x: number, y: number): Expr {
  return { k: 'tuple', items: [numLiteral(x), numLiteral(y)], s: 0, e: 0 };
}

function rewriteExpr(e: Expr, bindings: ReadonlyMap<string, Binding>): Expr {
  if (e.k === 'name') {
    const b = bindings.get(e.name);
    if (!b) return e;
    return 'literal' in b ? b.literal : { k: 'name', name: b.ref, s: e.s, e: e.e };
  }
  switch (e.k) {
    case 'unary':
      return { ...e, arg: rewriteExpr(e.arg, bindings) };
    case 'bin':
      return { ...e, l: rewriteExpr(e.l, bindings), r: rewriteExpr(e.r, bindings) };
    case 'cmp':
      return { ...e, operands: e.operands.map((o) => rewriteExpr(o, bindings)) };
    case 'call':
      return { ...e, args: e.args.map((a) => ({ ...a, value: rewriteExpr(a.value, bindings) })) };
    case 'tick':
      return { ...e, args: e.args.map((a) => rewriteExpr(a, bindings)) };
    case 'index':
      return { ...e, target: rewriteExpr(e.target, bindings), index: rewriteExpr(e.index, bindings) };
    case 'field':
      return { ...e, target: rewriteExpr(e.target, bindings), ...(e.args ? { args: e.args.map((a) => rewriteExpr(a, bindings)) } : {}) };
    case 'fact':
    case 'deg':
      return { ...e, arg: rewriteExpr(e.arg, bindings) };
    case 'tuple':
    case 'list':
      return { ...e, items: e.items.map((o) => rewriteExpr(o, bindings)) };
    case 'polar':
      return { ...e, r: rewriteExpr(e.r, bindings), a: rewriteExpr(e.a, bindings) };
    case 'range':
      return { ...e, from: rewriteExpr(e.from, bindings), to: rewriteExpr(e.to, bindings), ...(e.step ? { step: rewriteExpr(e.step, bindings) } : {}) };
    case 'cond':
      return { ...e, args: e.args.map((o) => rewriteExpr(o, bindings)) };
    case 'str':
      return {
        ...e,
        parts: e.parts.map((p) =>
          typeof p === 'string' ? p : { ...p, expr: rewriteExpr(p.expr, bindings) },
        ),
      };
    default:
      return e;
  }
}

/** Substitute local names everywhere a step line can hold an expression. */
export function substituteLine(node: LineNode, bindings: ReadonlyMap<string, Binding>): LineNode {
  if (bindings.size === 0) return node;
  switch (node.k) {
    case 'define':
      return {
        ...node,
        expr: rewriteExpr(node.expr, bindings),
        ...(node.range
          ? { range: { ...node.range, from: rewriteExpr(node.range.from, bindings), to: rewriteExpr(node.range.to, bindings), ...(node.range.step ? { step: rewriteExpr(node.range.step, bindings) } : {}) } }
          : {}),
        ...(node.style ? { style: node.style.map((s) => ({ ...s, value: rewriteExpr(s.value, bindings) })) } : {}),
      };
    case 'function':
      return { ...node, expr: rewriteExpr(node.expr, bindings) };
    case 'rate':
      return { ...node, expr: rewriteExpr(node.expr, bindings) };
    case 'restyle':
      return { ...node, style: node.style.map((s) => ({ ...s, value: rewriteExpr(s.value, bindings) })) };
    case 'rerange':
      return { ...node, range: { ...node.range, from: rewriteExpr(node.range.from, bindings), to: rewriteExpr(node.range.to, bindings), ...(node.range.step ? { step: rewriteExpr(node.range.step, bindings) } : {}) } };
    case 'action':
      return { ...node, expr: { ...node.expr, args: node.expr.args.map((a) => ({ ...a, value: rewriteExpr(a.value, bindings) })) } };
    default:
      return node;
  }
}

/* ------------------------------ check + eval ------------------------------ */

export interface ProbeOptions {
  /** 1-based line number carried into errors. */
  readonly line?: number;
  /** Override the figure's line limits (learner text allows 2000 nodes). */
  readonly limits?: { readonly exprNodes?: number; readonly depth?: number };
}

/**
 * Parse and check one line against the figure, exactly as the kernel would
 * (same limits, same per-type property keys). Returns the parsed and checked
 * line, or the language error.
 */
export function checkProbeLine(
  figure: Figure,
  source: string,
  opts: ProbeOptions = {},
): { readonly parsed: ParsedLine; readonly checked: CheckedLine } | { readonly error: ErrorObject } {
  const parsed = parseLine(source, { line: opts.line ?? 1 });
  if (!parsed.ok) return { error: parsed };
  const limits = figure.limits;
  const checked = checkLine(parsed.value, figure.view, {
    limits: { objects: limits.objects, exprNodes: opts.limits?.exprNodes ?? limits.exprNodes, lineLength: limits.lineLength, listSize: limits.listSize, depth: opts.limits?.depth ?? limits.depth },
    propertyKeys: validKeysFor,
  });
  if (!checked.ok) return { error: checked };
  return { parsed: parsed.value, checked: checked.value };
}

export type EvalOutcome =
  | { readonly defined: true; readonly value: unknown }
  | { readonly defined: false; readonly reason: string; readonly detail?: string };

/**
 * Evaluate a checked expression against the figure. Staged handler writes are
 * visible through `overlay`; nested object commands evaluate to undefined (the
 * kernel's runCommand hook is not public).
 */
export function evalTNode(figure: Figure, node: TNode, opts: { overlay?: ReadonlyMap<ObjId, unknown>; t?: number; slots?: number } = {}): EvalOutcome {
  const env: Env = createEnv({
    read: (id) => (opts.overlay?.has(id) ? opts.overlay.get(id) : figure.value(id)),
    slots: opts.slots ?? 64,
  });
  if (opts.t !== undefined) env.t = opts.t;
  const compiled = compileNode(node, {});
  const r = evaluate(compiled, env);
  if (r.defined) return { defined: true, value: r.value };
  return { defined: false, reason: r.reason, ...(r.detail !== undefined ? { detail: r.detail } : {}) };
}

/** A runtime value as source text, for frozen handler lines. Undefined when it has no literal. */
export function valueLiteralText(v: unknown): string | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? numberSource(v) : undefined;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') {
    if (v.length > 500) return undefined;
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\n')}"`;
  }
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o['x'] === 'number' && typeof o['y'] === 'number' && Number.isFinite(o['x']) && Number.isFinite(o['y'])) {
      return `(${numberSource(o['x'] as number)}, ${numberSource(o['y'] as number)})`;
    }
    if (typeof o['r'] === 'number' && typeof o['g'] === 'number' && typeof o['b'] === 'number') {
      const a = typeof o['a'] === 'number' ? o['a'] : 1;
      return `rgb(${o['r']}, ${o['g']}, ${o['b']}, ${a})`;
    }
  }
  return undefined;
}

/** A runtime value as a literal expression for substitution. Undefined when it has none. */
export function valueLiteralExpr(v: unknown): Expr | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return numLiteral(v);
  if (typeof v === 'boolean') return boolLiteral(v);
  if (typeof v === 'string' && v.length <= 500) return textLiteral(v);
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o['x'] === 'number' && typeof o['y'] === 'number' && Number.isFinite(o['x']) && Number.isFinite(o['y'])) {
      return pointLiteral(o['x'], o['y']);
    }
  }
  return undefined;
}

export { printExpr, printLineNode };
