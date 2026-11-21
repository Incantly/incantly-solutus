/**
 * Reading the value of an expression from a figure (design 11) and writing it with a text format word of the
 * text-logic area (`3sf`, `deg`, `pct`, ...). No Tiptap import. The figure is never changed: `preview` of the kernel
 * checks and evaluates a line against a figure without adding an object.
 */
import { DEFAULT_FORMAT, formatNumber, preview, tyStr, valueTextOf } from '@incantly/kernel';
import type { Ty, ValueFormat } from '@incantly/kernel';
import type { App } from '@incantly/sdk';
import { tiptapError } from './errors';
import type { TiptapError } from './errors';

export type FormatSpec =
  | { readonly kind: 'auto' }
  | { readonly kind: 'fixed'; readonly digits: number }
  | { readonly kind: 'sig'; readonly digits: number }
  | { readonly kind: 'deg'; readonly digits: number }
  | { readonly kind: 'pct'; readonly digits: number | null }
  | { readonly kind: 'sci' }
  | { readonly kind: 'frac' };

export const FORMAT_WORDS = '2 (decimals), 3sf, deg, deg2, pct, sci, frac, auto';

/** A format word as a spec, or `undefined` when it is not one. The empty word and `auto` are the figure's own rounding. */
export function parseFormat(word: string): FormatSpec | undefined {
  const w = word.trim();
  if (w === '' || w === 'auto') return { kind: 'auto' };
  let m = /^(\d{1,2})$/.exec(w);
  if (m) return { kind: 'fixed', digits: Math.min(10, Number(m[1])) };
  m = /^(\d{1,2})sf$/.exec(w);
  if (m) return Number(m[1]) >= 1 ? { kind: 'sig', digits: Math.min(15, Number(m[1])) } : undefined;
  m = /^deg(\d{0,2})$/.exec(w);
  if (m) return { kind: 'deg', digits: m[1] === '' || m[1] === undefined ? 0 : Math.min(10, Number(m[1])) };
  m = /^(?:pct|%)(\d{0,2})$/.exec(w);
  if (m) return { kind: 'pct', digits: m[1] === '' || m[1] === undefined ? null : Math.min(10, Number(m[1])) };
  if (w === 'sci') return { kind: 'sci' };
  if (w === 'frac' || w === 'f') return { kind: 'frac' };
  return undefined;
}

const fixedFormat = (digits: number): ValueFormat => ({ decimals: digits, significant: null, notation: 'decimal', trimZeros: false });

function formatWith(type: Ty, value: unknown, spec: FormatSpec): string | undefined {
  const name = tyStr(type);
  if (typeof value === 'number') {
    switch (spec.kind) {
      case 'fixed':
        return formatNumber(value, fixedFormat(spec.digits)).text;
      case 'sig':
        return formatNumber(value, { decimals: 2, significant: spec.digits, notation: 'decimal', trimZeros: true }).text;
      case 'deg':
        return `${formatNumber((value * 180) / Math.PI, fixedFormat(spec.digits)).text}°`;
      case 'pct':
        return `${formatNumber(value * 100, spec.digits === null ? DEFAULT_FORMAT : fixedFormat(spec.digits)).text}%`;
      case 'sci':
        return formatNumber(value, { decimals: 2, significant: null, notation: 'scientific', trimZeros: true }).text;
      case 'frac':
        return formatNumber(value, { ...DEFAULT_FORMAT, notation: 'fraction' }).text;
      default:
        return undefined;
    }
  }
  // a point, a vector or a list takes the same digits in every number it holds
  if (spec.kind === 'fixed') return valueTextOf(name, value, fixedFormat(spec.digits));
  if (spec.kind === 'sig') return valueTextOf(name, value, { decimals: 2, significant: spec.digits, notation: 'decimal', trimZeros: true });
  return undefined;
}

export type FormulaResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: TiptapError };

const BARE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * The kernel reads a lone name as an incomplete definition. A formula of one name reads that name's value, so the
 * name is previewed as the right side of a definition under a temporary name the figure does not use. An unknown name
 * then fails with the kernel's own message and close names.
 */
function readableForm(expr: string, app: App): string {
  const name = expr.trim();
  if (!BARE_NAME.test(name)) return expr;
  const view = app.figure.view;
  let temp = 'pvw1';
  for (let k = 2; view.lookup(temp); k++) temp = `pvw${k}`;
  return `${temp} = ${name}`;
}

/** The value of `expr` in the figure of `app`, written with `format`. Never throws. */
export function evaluateExpr(app: App, expr: string, format: string, node?: string): FormulaResult {
  const fail = (message: string, hint?: string): FormulaResult => ({
    ok: false,
    error: tiptapError('formula_failed', message, { ...(hint !== undefined ? { hint } : {}), ...(node !== undefined ? { node } : {}) }),
  });
  const spec = parseFormat(format);
  if (!spec) return fail(`"${format}" is not a format.`, `Use one of: ${FORMAT_WORDS}.`);
  if (expr.trim() === '') return fail('The formula has no expression.', 'Write an expression such as Area(p).');
  try {
    const p = preview(readableForm(expr, app), app.figure.view);
    if (!p.ok) return fail(p.error.message, p.error.hint);
    const g = p.ghost;
    if (g && spec.kind !== 'auto') {
      const text = formatWith(g.type, g.value, spec);
      if (text !== undefined) return { ok: true, text };
    }
    return { ok: true, text: p.valueText };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The expression could not be read.');
  }
}
