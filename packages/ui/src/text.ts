/**
 * Pure text helpers for the line editor and the line list: positions, spoken text, typeset text,
 * form parsing and placeholders. No DOM.
 */
import { splitLogicalLines } from '@incantly/kernel';

/* ------------------------------- positions ------------------------------- */

/** One logical line of the editor text with its offsets (a call may continue over several physical lines). */
export interface LogicalSpan {
  readonly text: string;
  /** Offset of the first character in the editor text. */
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  /** 1-based number of the first physical line. */
  readonly firstLine: number;
}

export function logicalLines(text: string): LogicalSpan[] {
  const out: LogicalSpan[] = [];
  let pos = 0;
  for (const l of splitLogicalLines(text)) {
    out.push({ text: l.text, start: pos, end: pos + l.text.length, firstLine: l.firstLine });
    pos += l.text.length + 1;
  }
  return out;
}

/** The logical line that holds `offset` (the last one when the offset is past the end). */
export function logicalAt(text: string, offset: number): LogicalSpan {
  const all = logicalLines(text);
  for (const l of all) if (offset <= l.end) return l;
  return all[all.length - 1] as LogicalSpan;
}

export function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1);
  return out;
}

/** Offset of a 1-based line and column of `text`, clamped to the text. */
export function offsetOf(text: string, line: number, col: number): number {
  const starts = lineStarts(text);
  const base = starts[Math.min(Math.max(line, 1), starts.length) - 1] ?? 0;
  return Math.min(text.length, Math.max(0, base + col - 1));
}

/** 1-based column of `offset` within its physical line. */
export function columnOf(text: string, offset: number): number {
  const nl = text.lastIndexOf('\n', offset - 1);
  return offset - (nl + 1) + 1;
}

/* ------------------------------- spoken text ------------------------------- */

const SPOKEN_OPS: readonly (readonly [RegExp, string])[] = [
  [/<=/g, ' at most '],
  [/>=/g, ' at least '],
  [/!=/g, ' is not equal to '],
  [/==/g, ' equals '],
  [/=/g, ' equals '],
  [/</g, ' is less than '],
  [/>/g, ' is greater than '],
  [/\*/g, ' times '],
  [/\//g, ' over '],
  [/\+/g, ' plus '],
  [/,/g, ' comma '],
];

/** Operators in words, for the accessible name of a preview or a row: `x^2 - 2` reads as `x squared minus 2`. */
export function speak(text: string): string {
  let t = text.replace(/\bsqrt\s*\(/g, 'square root of (');
  t = t.replace(/(^|[(,=<>+*/^[]\s*)[-−]\s*(?=[\w(.])/g, '$1 negative ');
  t = t.replace(/\^\s*2(?![\d.])/g, ' squared ').replace(/\^\s*3(?![\d.])/g, ' cubed ');
  t = t.replace(/\^\s*(-?[\w.]+)/g, ' to the power $1 ').replace(/\^/g, ' caret ');
  for (const [re, word] of SPOKEN_OPS) t = t.replace(re, word);
  t = t.replace(/[-−]/g, ' minus ');
  return t.replace(/\s+/g, ' ').replace(/\s+([)\]])/g, '$1').replace(/([([])\s+/g, '$1').trim();
}

/* ------------------------------- typeset text ------------------------------- */

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

/** The line as the preview strip shows it: real superscripts, true minus, `≤ ≥ ≠`, `√`, `π`. Strings are left alone. */
export function typeset(text: string): string {
  return text
    .split(/("(?:[^"\\]|\\.)*")/)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/\^(-?\d+)(?![\d.])/g, (_m, d: string) => [...d].map((c) => SUPERSCRIPT[c] ?? c).join(''))
        .replace(/(?<=\s)-(?=\s)/g, '−')
        .replace(/<=/g, '≤')
        .replace(/>=/g, '≥')
        .replace(/!=/g, '≠')
        .replace(/\bsqrt\(/g, '√(')
        .replace(/\bpi\b/g, 'π')
        .replace(/\*/g, '·');
    })
    .join('');
}

/** `x²` typed with superscript digits becomes `x^2`. Returns the new text and the caret mapped onto it. */
export function plainSuperscripts(text: string, caret: number): { text: string; caret: number } {
  if (!/[⁰¹²³⁴-⁹]/.test(text)) return { text, caret };
  const PLAIN: Readonly<Record<string, string>> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  let out = '';
  let newCaret = caret;
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (PLAIN[c] !== undefined) {
      let j = i;
      let digits = '';
      while (j < text.length && PLAIN[text[j] as string] !== undefined) {
        digits += PLAIN[text[j] as string];
        j++;
      }
      out += '^' + digits;
      if (caret > i) newCaret += 1;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return { text: out, caret: newCaret };
}

/* ----------------------------- undefined reasons ----------------------------- */

const REASONS: Readonly<Record<string, string>> = {
  parallel: 'the lines are parallel',
  coincident: 'the objects coincide',
  no_intersection: 'the objects do not meet',
  out_of_domain: 'an input is outside the domain',
  division_by_zero: 'division by zero',
  no_root: 'no root was found',
  not_finite: 'the result is not a finite number',
  overflow: 'the result is too large',
  degenerate: 'the shape is degenerate',
  index_out_of_range: 'the index is out of range',
  empty_list: 'the list is empty',
  no_convergence: 'the search did not converge',
  timeout: 'it took too long',
  input_undefined: 'an input is undefined',
  not_set: 'no value has been set',
  limit: 'a limit was reached',
  condition_false: 'no condition was true',
  explicit: 'it is set to undefined',
  not_integer: 'an input must be a whole number',
  no_value_yet: 'there is no value yet',
};

/** An undefined reason code in plain words. An unknown code is shown as its own words. */
export function reasonText(reason: string): string {
  return REASONS[reason] ?? reason.replace(/_/g, ' ');
}

/* ------------------------------ forms and holes ------------------------------ */

export interface FormParam {
  readonly text: string;
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
}

export interface FormParts {
  readonly name: string;
  readonly params: readonly FormParam[];
  /** Text before, between and after: the form with its parameters cut out, for rendering. */
  readonly pieces: readonly string[];
  /** Offsets of each parameter within the form text. */
  readonly spans: readonly { readonly start: number; readonly end: number }[];
  readonly returns: string;
  readonly rest: boolean;
}

/** Splits `Circle(center: Point, [radius: Number]) -> Circle` into its name, parameters and result. */
export function parseForm(text: string): FormParts {
  const open = text.indexOf('(');
  if (open < 0) return { name: text, params: [], pieces: [text], spans: [], returns: '', rest: false };
  const name = text.slice(0, open);
  const params: FormParam[] = [];
  const spans: { start: number; end: number }[] = [];
  let depth = 0;
  let start = open + 1;
  let close = text.length;
  let rest = false;
  const push = (from: number, to: number): void => {
    const raw = text.slice(from, to);
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const lead = raw.length - raw.trimStart().length;
    if (trimmed === '…' || trimmed === '...') {
      rest = true;
      return;
    }
    const optional = trimmed.startsWith('[') || trimmed.endsWith('?');
    const clean = trimmed.replace(/^\[|\]$/g, '').replace(/\?$/, '').replace(/=.*$/, '').trim();
    const colon = clean.indexOf(':');
    params.push({
      text: trimmed,
      name: (colon < 0 ? clean : clean.slice(0, colon)).trim(),
      type: colon < 0 ? '' : clean.slice(colon + 1).trim(),
      optional,
    });
    spans.push({ start: from + lead, end: from + lead + trimmed.length });
  };
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '(' || c === '[' || c === '<') depth++;
    else if ((c === ')' || c === ']' || c === '>') && !(c === '>' && text[i - 1] === '-')) {
      if (depth === 0 && c === ')') {
        push(start, i);
        close = i;
        break;
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      push(start, i);
      start = i + 1;
    }
  }
  const arrow = text.indexOf('->', close);
  const returns = arrow < 0 ? '' : text.slice(arrow + 2).trim();
  const pieces: string[] = [];
  let at = 0;
  for (const s of spans) {
    pieces.push(text.slice(at, s.start));
    at = s.end;
  }
  pieces.push(text.slice(at));
  return { name, params, pieces, spans, returns, rest };
}

export interface Hole {
  start: number;
  end: number;
}

/** Fills `$1`, `$2`, … of an insert text. Returns the text and the offsets of the filled holes, in order. */
export function expandInsert(insert: string, fill: (n: number) => string): { text: string; holes: Hole[] } {
  let text = '';
  const holes: Hole[] = [];
  let last = 0;
  const re = /\$(\d+)/g;
  for (let m = re.exec(insert); m; m = re.exec(insert)) {
    text += insert.slice(last, m.index);
    const n = Number(m[1]);
    if (n === 0) {
      last = m.index + m[0].length;
      continue;
    }
    const value = fill(n);
    holes.push({ start: text.length, end: text.length + value.length });
    text += value;
    last = m.index + m[0].length;
  }
  text += insert.slice(last);
  return { text, holes };
}

/** The text that a fix changes: what is inserted, or `remove …` when it only deletes. */
export function changedText(original: string, fixed: string): { added: string; removed: string } {
  let p = 0;
  while (p < original.length && p < fixed.length && original[p] === fixed[p]) p++;
  let s = 0;
  while (s < original.length - p && s < fixed.length - p && original[original.length - 1 - s] === fixed[fixed.length - 1 - s]) s++;
  return { added: fixed.slice(p, fixed.length - s), removed: original.slice(p, original.length - s) };
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

/** Number of top-level arguments in the text of a call such as `Circle(A, 2, 3)`. */
export function countArgs(call: string): number {
  const open = call.indexOf('(');
  if (open < 0) return 0;
  let depth = 0;
  let n = 0;
  let any = false;
  for (let i = open + 1; i < call.length; i++) {
    const c = call[i] as string;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) n++;
    else if (!/\s/.test(c)) any = true;
  }
  return any ? n + 1 : 0;
}
