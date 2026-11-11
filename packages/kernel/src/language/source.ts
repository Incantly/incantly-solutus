/**
 * Step 1a: normalisation and the offset map (docs/features/language/design.md 3.2).
 * The lexer works on the normalised text; every position shown to a writer is converted back
 * to UTF-16 columns of the text the writer sent.
 */

export const MAX_LINE_LENGTH = 2000;

/** Host limits the line checks honour; each falls back to the language's own value. Names follow kernel/errors.md section 6. */
export interface LangLimits {
  readonly objects?: number;
  readonly exprNodes?: number;
  readonly lineLength?: number;
  readonly listSize?: number;
  readonly depth?: number;
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

/** One-for-one replacements (typed -> becomes). Word-like results are padded when glued to a name. */
const REPLACE: Readonly<Record<string, string>> = {
  '−': '-', '–': '-', '—': '-', '×': '*', '·': '*', '⋅': '*', '∙': '*', '÷': '/',
  '≤': '<=', '≥': '>=', '≠': '!=', '∧': ' and ', '∨': ' or ', '¬': ' not ',
  π: 'pi', τ: 'tau', '∞': 'inf', '√': '√',
  '\u00A0': ' ', '\t': ' ', '\u2009': ' ', '\u202F': ' ', '\u2003': ' ', '\u2002': ' ',
  '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'",
};

export interface Normalised {
  /** The text the lexer reads. */
  readonly text: string;
  /** `start[i]` is the original UTF-16 index where the character at normalised index i begins. */
  readonly start: Int32Array;
  /** `end[i]` is the exclusive original index where the character at normalised index i ends. */
  readonly end: Int32Array;
}

/** Every character that `normalise` rewrites to a single space; `hexColourLength` skips exactly these (and the space itself). */
const BLANKS: ReadonlySet<string> = new Set([' ', ...Object.keys(REPLACE).filter((k) => REPLACE[k] === ' ')]);

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_\u0370-\u03FF]/.test(c);

/**
 * Length of the hex colour that starts at `text[i]` (a `#`), or 0. A colour is a `#` and 3, 4, 6 or 8 hex digits not
 * followed by a name character, directly after a single `=` (blanks may lie between). Anything else starting with `#`
 * is a comment. The normaliser, the line splitter and the lexer all ask this one function, so they cut the line at
 * the same place.
 */
export function hexColourLength(text: string, i: number): number {
  if (text[i] !== '#') return 0;
  let j = i - 1;
  while (j >= 0 && BLANKS.has(text[j] as string)) j--;
  if (j < 0 || text[j] !== '=') return 0;
  const before = text[j - 1];
  if (before === '=' || before === '<' || before === '>' || before === '!' || before === '\u2260' || before === '\u2264' || before === '\u2265') return 0;
  const m = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_])/.exec(text.slice(i, i + 10));
  return m ? m[0].length : 0;
}

/** Rewrites typographic variants. Strings and comments are copied verbatim, except for smart quotes. */
export function normalise(raw: string): Normalised {
  // NFC, chunked at combining marks so the map stays exact.
  let src = raw;
  let srcStart: Int32Array | undefined;
  if (raw.normalize('NFC') !== raw) {
    const chunks: string[] = [];
    const starts: number[] = [];
    let i = 0;
    while (i < raw.length) {
      let j = i + 1;
      while (j < raw.length && /\p{M}/u.test(raw[j] as string)) j++;
      const piece = raw.slice(i, j).normalize('NFC');
      chunks.push(piece);
      for (let k = 0; k < piece.length; k++) starts.push(i);
      i = j;
    }
    src = chunks.join('');
    srcStart = Int32Array.from(starts);
  }
  const origIdx = (i: number): number => (srcStart ? (srcStart[i] as number) : i);
  const origEnd = (i: number): number => {
    if (!srcStart) return i + 1;
    // Exclusive end: the next different start, or the raw length.
    const s = srcStart[i] as number;
    let k = i + 1;
    while (k < src.length && srcStart[k] === s) k++;
    return k < src.length ? (srcStart[k] as number) : raw.length;
  };

  const out: string[] = [];
  const st: number[] = [];
  const en: number[] = [];
  const push = (s: string, a: number, b: number): void => {
    for (let k = 0; k < s.length; k++) {
      out.push(s[k] as string);
      st.push(a);
      en.push(b);
    }
  };

  type Mode = 'code' | 'string' | 'comment';
  let mode: Mode = 'code';
  let braceDepth = 0; // inside {..} of a string, code rules apply
  let stringOpen = '"';
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const a = origIdx(i);
    const b = origEnd(i);
    if (c === '\r') {
      // \r\n -> \n, lone \r -> \n
      const isCrLf = src[i + 1] === '\n';
      push('\n', a, isCrLf ? origEnd(i + 1) : b);
      i += isCrLf ? 2 : 1;
      mode = 'code';
      braceDepth = 0;
      continue;
    }
    if (c === '\n') {
      push('\n', a, b);
      i++;
      mode = 'code';
      braceDepth = 0;
      continue;
    }
    if (mode === 'comment') {
      push(c === '\u00A0' ? ' ' : c, a, b);
      i++;
      continue;
    }
    if (mode === 'string' && braceDepth === 0) {
      if (c === '\\' && i + 1 < src.length) {
        push(c, a, b);
        push(src[i + 1] as string, origIdx(i + 1), origEnd(i + 1));
        i += 2;
        continue;
      }
      if (c === '{') {
        braceDepth = 1;
        push(c, a, b);
        i++;
        continue;
      }
      if (c === '"' || c === '”' || c === '“' || c === '„') {
        // a straight or smart quote closes the string
        push('"', a, b);
        mode = 'code';
        i++;
        continue;
      }
      push(c, a, b);
      i++;
      continue;
    }
    // code mode (or inside {..} in a string)
    if (mode === 'string' && braceDepth > 0) {
      if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      else if (c === '"' || c === '”' || c === '“' || c === '„') {
        // closes the string (the lexer reports the unbalanced brace)
        push('"', a, b);
        mode = 'code';
        braceDepth = 0;
        i++;
        continue;
      }
    }
    if (mode === 'code' && c === '#') {
      const colour = hexColourLength(src, i);
      if (colour > 0) {
        // a hex colour after `=` is a value, copied as it is; the rest of the line stays code
        for (let k = 0; k < colour; k++) push(src[i + k] as string, origIdx(i + k), origEnd(i + k));
        i += colour;
        continue;
      }
      mode = 'comment';
      push(c, a, b);
      i++;
      continue;
    }
    if (mode === 'code' && (c === '"' || c === '“' || c === '”' || c === '„')) {
      mode = 'string';
      stringOpen = c;
      braceDepth = 0;
      push('"', a, b);
      i++;
      continue;
    }
    // superscript runs: x² -> x^2, x⁻¹ -> x^-1
    if (SUPERSCRIPT[c] !== undefined || (c === '⁻' && SUPERSCRIPT[src[i + 1] ?? ''] !== undefined)) {
      let j = i;
      let neg = false;
      if (src[j] === '⁻') {
        neg = true;
        j++;
      }
      let digits = '';
      while (j < src.length && SUPERSCRIPT[src[j] as string] !== undefined) {
        digits += SUPERSCRIPT[src[j] as string];
        j++;
      }
      push('^' + (neg ? '-' : '') + digits, a, origEnd(j - 1));
      i = j;
      continue;
    }
    const rep = REPLACE[c];
    if (rep !== undefined) {
      let r = rep;
      if (c === 'π' || c === 'τ' || c === '∞') {
        // keep `2π` readable and stop `rπ` from fusing into one name
        if (isWordChar(out[out.length - 1])) r = ' ' + r;
        if (isWordChar(src[i + 1])) r = r + ' ';
      }
      push(r, a, b);
      i++;
      continue;
    }
    push(c, a, b);
    i++;
  }
  void stringOpen;
  return { text: out.join(''), start: Int32Array.from(st), end: Int32Array.from(en) };
}

export interface LineSpan {
  readonly line: number;
  readonly col: number;
  readonly endCol: number;
  readonly token: string;
}

/** Converts normalised offsets to line, column and the token as typed. */
export class SourceMap {
  readonly raw: string;
  readonly norm: Normalised;
  readonly firstLine: number;
  private readonly lineStarts: number[];

  constructor(raw: string, firstLine = 1) {
    this.raw = raw;
    this.norm = normalise(raw);
    this.firstLine = firstLine;
    this.lineStarts = [0];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\n') this.lineStarts.push(i + 1);
    }
  }

  get text(): string {
    return this.norm.text;
  }

  /** Original index of the start of the normalised range. */
  origStart(s: number): number {
    const n = this.norm;
    if (n.text.length === 0) return 0;
    if (s >= n.text.length) return this.raw.length;
    return n.start[s] as number;
  }

  origEnd(e: number): number {
    const n = this.norm;
    if (n.text.length === 0 || e <= 0) return 0;
    if (e > n.text.length) return this.raw.length;
    return n.end[e - 1] as number;
  }

  private lineOf(origIdx: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= origIdx) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Span for the normalised range [s, e). A zero-width range gives endCol === col. */
  span(s: number, e: number): LineSpan {
    const os = this.origStart(s);
    let oe = e <= s ? os : this.origEnd(e);
    const li = this.lineOf(os);
    const lineStart = this.lineStarts[li] as number;
    const nextStart = this.lineStarts[li + 1];
    const lineEnd = nextStart === undefined ? this.raw.length : nextStart - 1;
    if (oe > lineEnd) oe = Math.max(os, lineEnd);
    const token = e <= s ? '' : this.raw.slice(os, this.origEnd(e));
    return { line: this.firstLine + li, col: os - lineStart + 1, endCol: oe - lineStart + 1, token };
  }

  /** Text of a normalised range (as normalised, for building suggestions). */
  slice(s: number, e: number): string {
    return this.norm.text.slice(s, e);
  }
}

/**
 * Splits a program into logical lines. A line continues onto the next physical line while a
 * bracket is open (README decision 17). Strings and comments are skipped when counting brackets.
 */
export interface LogicalLine {
  readonly text: string;
  /** 1-based number of the first physical line. */
  readonly firstLine: number;
  readonly lineCount: number;
}

/** The four characters that open or close a text; `normalise` turns each into a straight quote. */
const isQuote = (c: string): boolean => c === '"' || c === '“' || c === '”' || c === '„';

/**
 * Scans `text[from, to)`, one physical line, and returns the round and square bracket depth at its end, starting from
 * `depth`. A text never spans a newline and a comment ends at one, so only the depth crosses lines. Texts follow the same
 * boundaries as `normalise` and the lexer: a backslash escapes the next character, `{` opens an interpolation (whose
 * brackets belong to the text), and a closing quote ends the text even inside an interpolation. Never negative.
 */
export function scanLineDepth(text: string, from: number, to: number, depth: number): number {
  let inString = false;
  let braces = 0;
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    // a lone carriage return ends a text and a comment, as in `normalise`
    if (c === 13) {
      inString = false;
      braces = 0;
      continue;
    }
    const ch = text[i] as string;
    if (inString) {
      if (braces === 0) {
        if (ch === '\\') i++;
        else if (ch === '{') braces = 1;
        else if (isQuote(ch)) inString = false;
      } else if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (isQuote(ch)) {
        inString = false;
        braces = 0;
      }
      continue;
    }
    if (ch === '#') {
      const colour = hexColourLength(text, i);
      if (colour > 0) {
        i += colour - 1;
        continue;
      }
      // a comment runs to the end of the line
      while (i + 1 < to && text.charCodeAt(i + 1) !== 13) i++;
    } else if (isQuote(ch)) {
      inString = true;
      braces = 0;
    } else if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
  }
  return depth;
}

export function splitLogicalLines(program: string): LogicalLine[] {
  const text = program.replace(/\r\n?/g, '\n');
  const result: LogicalLine[] = [];
  const n = text.length;
  let pos = 0;
  let lineNo = 1;
  while (pos <= n) {
    // One forward pass: the depth carries over from physical line to physical line, so each character is scanned once.
    const first = lineNo;
    const startPos = pos;
    let depth = 0;
    let count = 0;
    let end: number;
    for (;;) {
      const nl = text.indexOf('\n', pos);
      end = nl < 0 ? n : nl;
      depth = scanLineDepth(text, pos, end, depth);
      count++;
      pos = end + 1;
      if (depth === 0 || nl < 0) break;
    }
    result.push({ text: text.slice(startPos, end), firstLine: first, lineCount: count });
    lineNo += count;
  }
  return result;
}

/**
 * Offset of the start of the logical line that holds the end of `program` (used for the cursor context). One forward
 * pass over the physical lines before the last one, with the same rule as `splitLogicalLines`.
 */
export function lastLogicalStart(program: string): number {
  let depth = 0;
  let start = 0;
  let pos = 0;
  for (;;) {
    const nl = program.indexOf('\n', pos);
    if (nl < 0) return start;
    depth = scanLineDepth(program, pos, nl, depth);
    pos = nl + 1;
    if (depth === 0) start = pos;
  }
}
