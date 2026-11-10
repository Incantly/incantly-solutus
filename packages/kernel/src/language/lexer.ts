/**
 * Step 1: lex. Pure function of the text; never reads the figure (docs/features/language/design.md 3.1, 3.3).
 * Errors are collected (the lexer keeps going so highlighting works); the parser uses the first one.
 */
import type { Notice } from '../contracts/errors';
import { Diag, notice } from './errors';
import type { LanguageError } from './errors';
import { MAX_LINE_LENGTH, SourceMap } from './source';

export type TokKind = 'num' | 'name' | 'kw' | 'str' | 'op' | 'sqrt' | 'at' | 'comment' | 'nl' | 'bad' | 'eof';

export const KEYWORDS: ReadonlySet<string> = new Set(['and', 'or', 'not', 'xor', 'if', 'in', 'step', 'with']);

export type StrPart =
  | { readonly lit: string; readonly s: number; readonly e: number }
  | { readonly toks: readonly Token[]; readonly fmt?: string; readonly s: number; readonly e: number };

export interface Token {
  readonly kind: TokKind;
  readonly text: string;
  /** Normalised start and exclusive end. */
  readonly s: number;
  readonly e: number;
  /** Value of a number token. */
  readonly num?: number;
  /** Canonical name (subscript braces removed) of a name token. */
  readonly name?: string;
  /** Pieces of a text token. */
  readonly parts?: readonly StrPart[];
  /** True when the number literal has no '.', exponent or '_' (an integer literal). */
  readonly int?: boolean;
}

export const MAX_TOKENS = 800;
export const MAX_DEPTH = 64;

export interface LexResult {
  readonly tokens: Token[];
  readonly errors: LanguageError[];
  readonly notices: Notice[];
}

const GREEK = /[\u0370-\u03FF]/;
const LETTER = /\p{L}/u;

export const isAsciiLetter = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
export const isDigit = (c: string): boolean => c >= '0' && c <= '9';
export const isGreekLetter = (c: string): boolean => GREEK.test(c) && LETTER.test(c);
export const isNameStart = (c: string): boolean => isAsciiLetter(c) || isGreekLetter(c);
const isNameChar = (c: string): boolean => isNameStart(c) || isDigit(c) || c === '_';

/** Latin look-alikes of letters from other scripts. */
const LOOKALIKE: Readonly<Record<string, string>> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', к: 'k', ѕ: 's', һ: 'h',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y',
};

const FORMAT_RE = /^(?:\d+|\.\d+|d|f|%)$/;
export const TEXT_FORMATS: readonly string[] = ['2', '.3', 'd', 'f', '%'];

function codePointLabel(c: string): string {
  const cp = c.codePointAt(0) ?? 0;
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

function scriptOf(c: string): string {
  const scripts = ['Latin', 'Cyrillic', 'Greek', 'Arabic', 'Hebrew', 'Han', 'Hiragana', 'Katakana', 'Devanagari', 'Thai', 'Hangul'];
  for (const s of scripts) {
    if (new RegExp(`\\p{Script=${s}}`, 'u').test(c)) return s;
  }
  return 'non-Latin';
}

const CLOSER_OF: Readonly<Record<string, string>> = { '(': ')', '[': ']' };

export function lex(sm: SourceMap, opts: { maxTokens?: number } = {}): LexResult {
  const text = sm.text;
  const diag = new Diag(sm);
  const errors: LanguageError[] = [];
  const notices: Notice[] = [];
  const maxTokens = opts.maxTokens ?? MAX_TOKENS;

  if (sm.raw.length > MAX_LINE_LENGTH) {
    errors.push(
      diag.at('limit', 0, 0, 'lang.limit', { limit: 'line_length', max: MAX_LINE_LENGTH, got: sm.raw.length, what: 'characters in a line' }, {
        hint: 'Split the line into shorter lines.',
        limit: { name: 'line_length', max: MAX_LINE_LENGTH, got: sm.raw.length },
        fingerprintKey: 'line_length',
      }),
    );
    return { tokens: [{ kind: 'eof', text: '', s: 0, e: 0 }], errors, notices };
  }

  const tokens = lexRange(0, text.length, true);
  tokens.push({ kind: 'eof', text: '', s: text.length, e: text.length });
  if (tokens.length > maxTokens && errors.length === 0) {
    errors.push(
      diag.at('limit', 0, text.length, 'lang.limit', { limit: 'tokens', max: maxTokens, got: tokens.length, what: 'tokens in a line' }, {
        hint: 'Split the line into shorter lines.',
        limit: { name: 'tokens', max: maxTokens, got: tokens.length },
        fingerprintKey: 'tokens',
      }),
    );
  }
  return { tokens, errors, notices };

  function lexRange(from: number, to: number, top: boolean): Token[] {
    const out: Token[] = [];
    const stack: { ch: string; at: number }[] = [];
    let i = from;
    const push = (t: Token): void => {
      out.push(t);
    };

    while (i < to) {
      const c = text[i] as string;
      if (c === ' ') {
        i++;
        continue;
      }
      if (c === '\n') {
        // A newline only reaches here inside an open bracket (a continuation line) or at top level
        // between logical lines; the latter ends the line.
        if (stack.length === 0 && top) push({ kind: 'nl', text: '\n', s: i, e: i + 1 });
        i++;
        continue;
      }
      if (c === '#') {
        // a hex colour after `=` in a style list is a value, not a comment
        const prevTok = out[out.length - 1];
        if (prevTok && prevTok.kind === 'op' && prevTok.text === '=') {
          const m = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_])/.exec(text.slice(i, i + 10));
          if (m) {
            push({ kind: 'name', text: m[0], s: i, e: i + m[0].length, name: m[0] });
            i += m[0].length;
            continue;
          }
        }
        let j = i;
        while (j < to && text[j] !== '\n') j++;
        push({ kind: 'comment', text: text.slice(i, j), s: i, e: j });
        i = j;
        continue;
      }
      if (c === '"') {
        const r = lexString(i, to);
        push(r.tok);
        i = r.next;
        continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''))) {
        const r = lexNumber(i, to);
        push(r.tok);
        i = r.next;
        continue;
      }
      if (isNameStart(c)) {
        const r = lexName(i, to);
        push(r.tok);
        i = r.next;
        continue;
      }
      // operators
      const two = text.slice(i, i + 2);
      if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '..') {
        push({ kind: 'op', text: two, s: i, e: i + 2 });
        i += 2;
        continue;
      }
      if (c === '.') {
        // a '.' is a field access only right after a name or a closing bracket; elsewhere it is a malformed number
        const prev = out[out.length - 1];
        const afterOperand = prev !== undefined && prev.e === i && (prev.kind === 'name' || (prev.kind === 'op' && (prev.text === ')' || prev.text === ']')));
        if (!afterOperand) {
          errors.push(
            diag.at('bad_number', i, i + 1, 'lang.bad_number', { token: '.', why: 'a decimal point needs digits after it' }, {
              hint: 'Write numbers like 12, 0.5, .5 or 1e3.',
              fingerprintKey: '.',
            }),
          );
          push({ kind: 'bad', text: '.', s: i, e: i + 1 });
          i++;
          continue;
        }
      }
      if ('+-*/^!\'°=<>,;.:'.includes(c)) {
        push({ kind: 'op', text: c, s: i, e: i + 1 });
        i++;
        continue;
      }
      if (c === '√') {
        push({ kind: 'sqrt', text: c, s: i, e: i + 1 });
        i++;
        continue;
      }
      if (c === '@') {
        push({ kind: 'at', text: c, s: i, e: i + 1 });
        i++;
        continue;
      }
      if (c === '(' || c === '[') {
        if (stack.length >= MAX_DEPTH) {
          errors.push(
            diag.at('limit', i, i + 1, 'lang.limit', { limit: 'nesting_depth', max: MAX_DEPTH, got: stack.length + 1, what: 'levels of nesting' }, {
              hint: 'Define the inner part as its own object first.',
              limit: { name: 'nesting_depth', max: MAX_DEPTH, got: stack.length + 1 },
              fingerprintKey: 'nesting_depth',
            }),
          );
          break;
        }
        stack.push({ ch: c, at: i });
        push({ kind: 'op', text: c, s: i, e: i + 1 });
        i++;
        continue;
      }
      if (c === ')' || c === ']') {
        const top1 = stack[stack.length - 1];
        if (top1 === undefined) {
          errors.push(
            diag.at('unbalanced', i, i + 1, 'lang.unbalanced_close', { close: c }, {
              expected: [],
              hint: `Remove the extra ${c}, or add a matching ${c === ')' ? '(' : '['} earlier.`,
              fingerprintKey: c,
            }),
          );
        } else if (CLOSER_OF[top1.ch] !== c) {
          const want = CLOSER_OF[top1.ch] as string;
          const openSpan = sm.span(top1.at, top1.at + 1);
          errors.push(
            diag.at('unbalanced', i, i + 1, 'lang.unbalanced_mismatch', { open: top1.ch, col: openSpan.col, close: c, want }, {
              expected: [want],
              hint: `Close the ${top1.ch} on column ${openSpan.col} with ${want}.`,
              related: [`${top1.ch} on line ${openSpan.line}, column ${openSpan.col}`],
              fingerprintKey: top1.ch + c,
            }),
          );
          stack.pop();
        } else {
          stack.pop();
        }
        push({ kind: 'op', text: c, s: i, e: i + 1 });
        i++;
        continue;
      }
      // anything else is not part of the language
      push({ kind: 'bad', text: c, s: i, e: i + (c.length > 0 && c.codePointAt(0)! > 0xffff ? 2 : 1) });
      errors.push(badChar(i));
      i += c.codePointAt(0)! > 0xffff ? 2 : 1;
    }

    if (top && stack.length > 0) {
      // report the innermost unclosed opener first (nearest to where the writer stopped)
      const opener = stack[stack.length - 1] as { ch: string; at: number };
      const closers = stack
        .slice()
        .reverse()
        .map((x) => CLOSER_OF[x.ch] as string)
        .join('');
      const sp = sm.span(opener.at, opener.at + 1);
      const sugg = sm.text.replace(/\s+$/, '') + closers;
      errors.push(
        diag.at('unbalanced', opener.at, opener.at + 1, 'lang.unbalanced_open', { open: opener.ch, col: sp.col }, {
          expected: [CLOSER_OF[opener.ch] as string],
          hint: `Add ${closers} at the end of the line.`,
          suggest: [sugg],
          fingerprintKey: opener.ch,
        }),
      );
    }
    return out;
  }

  function badChar(i: number): LanguageError {
    const cp = text.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    const label = codePointLabel(ch);
    const end = i + ch.length;
    if (/\p{Nd}/u.test(ch) && !isDigit(ch)) {
      return diag.at('bad_character', i, end, 'lang.bad_character_digit', { token: ch, cp: label }, {
        hint: 'Use ASCII digits 0 to 9.',
        fingerprintKey: ch,
      });
    }
    if (LETTER.test(ch)) {
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const look = LOOKALIKE[ch] ?? (/^[A-Za-z]$/.test(base) ? base : undefined);
      const script = scriptOf(ch);
      const hint = look
        ? `It looks like the plain letter '${look}'. Names use the letters A to Z, Greek letters, digits and _.`
        : 'Names use Latin letters, Greek letters, digits and _.';
      const extra: Parameters<Diag['at']>[5] = { hint, fingerprintKey: ch };
      if (look) {
        extra.suggest = [text.slice(0, i) + look + text.slice(end)];
      }
      return diag.at('bad_character', i, end, 'lang.bad_character_look', { token: ch, cp: label, script }, extra);
    }
    let hint = 'Remove it, or write it with the characters the language uses.';
    if (ch === '|') hint = 'Absolute value is written abs(x).';
    else if (ch === '{' || ch === '}') hint = 'Curly brackets are only used in subscripts like P_{1,2} and in text.';
    else if (ch === '%') hint = 'There is no percent operator; write x / 100.';
    return diag.at('bad_character', i, end, 'lang.bad_character', { token: ch, cp: label }, { hint, fingerprintKey: ch });
  }

  function lexName(i: number, to: number): { tok: Token; next: number } {
    let j = i;
    while (j < to && isNameChar(text[j] as string)) j++;
    if (text[j] === '{' && text[j - 1] === '_') {
      // subscript P_{1,2}
      let k = j + 1;
      while (k < to && /[A-Za-z0-9,]/.test(text[k] as string)) k++;
      if (text[k] === '}') j = k + 1;
    }
    const raw = text.slice(i, j);
    let name = raw;
    const m = /^(.*)_\{([A-Za-z0-9]+)\}$/.exec(raw);
    if (m) name = `${m[1]}_${m[2]}`;
    const isStepCall = raw === 'step' && text[j] === '(';
    if (KEYWORDS.has(raw) && !isStepCall) return { tok: { kind: 'kw', text: raw, s: i, e: j, name: raw }, next: j };
    return { tok: { kind: 'name', text: raw, s: i, e: j, name }, next: j };
  }

  function lexNumber(i: number, to: number): { tok: Token; next: number } {
    let j = i;
    let isInt = true;
    let why: string | undefined;
    let bad = false;
    const digits = (): void => {
      while (j < to) {
        const c = text[j] as string;
        if (isDigit(c)) j++;
        else if (c === '_' && isDigit(text[j - 1] ?? '') && isDigit(text[j + 1] ?? '')) {
          isInt = false;
          j++;
        } else if (c === '_' && (text[j + 1] === '_' || isDigit(text[j - 1] ?? ''))) {
          // doubled or trailing underscore inside a number
          bad = true;
          why = 'an underscore must sit between two digits';
          j++;
        } else break;
      }
    };
    if (text[j] !== '.') digits();
    if (text[j] === '.' && text[j + 1] !== '.') {
      isInt = false;
      if (isDigit(text[j + 1] ?? '')) {
        j++;
        digits();
        if (text[j] === '.' && isDigit(text[j + 1] ?? '')) {
          bad = true;
          why = 'two decimal points';
          j++;
          digits();
          while (text[j] === '.' && isDigit(text[j + 1] ?? '')) {
            j++;
            digits();
          }
        }
      } else {
        bad = true;
        why = 'a decimal point needs digits after it';
        j++;
      }
    }
    // exponent only when digits follow
    if (!bad && (text[j] === 'e' || text[j] === 'E')) {
      let k = j + 1;
      if (text[k] === '+' || text[k] === '-') k++;
      if (isDigit(text[k] ?? '')) {
        while (isDigit(text[k] ?? '')) k++;
        j = k;
        isInt = false;
      }
    }
    const raw = text.slice(i, j);
    const clean = raw.replace(/_/g, '');
    if (bad) {
      errors.push(
        diag.at('bad_number', i, j, 'lang.bad_number', { token: raw, why: why ?? 'bad format' }, {
          hint: why === 'two decimal points' ? 'A number has at most one decimal point.' : 'Write numbers like 12, 0.5, .5 or 1e3.',
          fingerprintKey: raw,
        }),
      );
      return { tok: { kind: 'bad', text: raw, s: i, e: j }, next: j };
    }
    const value = Number(clean);
    if (!Number.isFinite(value)) {
      errors.push(
        diag.at('bad_number', i, j, 'lang.bad_number', { token: raw, why: 'out of range' }, {
          hint: 'The largest number is about 1.8e308.',
          fingerprintKey: raw,
        }),
      );
      return { tok: { kind: 'bad', text: raw, s: i, e: j }, next: j };
    }
    if (value === 0 && /[1-9]/.test(clean.replace(/[eE].*$/, ''))) {
      const sp = sm.span(i, j);
      notices.push(
        notice('precision_loss', 'warning', `${raw} is too small to store and became 0.`, { token: raw, line: sp.line, col: sp.col, endCol: sp.endCol }),
      );
    } else if (isInt && value >= 9007199254740992) {
      let exact: boolean;
      try {
        exact = BigInt(value).toString() === clean.replace(/^0+(?=\d)/, '');
      } catch {
        exact = false;
      }
      if (!exact) {
        const sp = sm.span(i, j);
        notices.push(
          notice('precision_loss', 'warning', `${raw} is above 2^53 and was rounded.`, { token: raw, line: sp.line, col: sp.col, endCol: sp.endCol }),
        );
      }
    }
    return { tok: { kind: 'num', text: raw, s: i, e: j, num: value, int: isInt }, next: j };
  }

  function lexString(i: number, to: number): { tok: Token; next: number } {
    const parts: StrPart[] = [];
    let lit = '';
    let litStart = i + 1;
    let j = i + 1;
    let closed = false;
    const flush = (end: number): void => {
      if (lit.length > 0) parts.push({ lit, s: litStart, e: end });
      lit = '';
    };
    while (j < to) {
      const c = text[j] as string;
      if (c === '\n') break;
      if (c === '"') {
        closed = true;
        break;
      }
      if (c === '\\') {
        const n = text[j + 1];
        const map: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', '{': '{', '}': '}' };
        if (n === undefined || map[n] === undefined) {
          errors.push(
            diag.at('bad_escape', j, Math.min(to, j + 2), 'lang.bad_escape', { ch: n ?? '' }, {
              expected: ['\\"', '\\\\', '\\n', '\\{', '\\}'],
              hint: 'Write a backslash as \\\\ and a quote as \\".',
              fingerprintKey: n ?? '',
            }),
          );
          j += n === undefined ? 1 : 2;
          continue;
        }
        lit += map[n] as string;
        j += 2;
        continue;
      }
      if (c === '{') {
        flush(j);
        // find the matching }
        let depth = 1;
        let k = j + 1;
        let colonAt = -1;
        let inner = 0;
        while (k < to && text[k] !== '\n' && text[k] !== '"') {
          const d = text[k] as string;
          if (d === '(' || d === '[') inner++;
          else if (d === ')' || d === ']') inner--;
          else if (d === '{') depth++;
          else if (d === '}') {
            depth--;
            if (depth === 0) break;
          } else if (d === ':' && inner === 0 && depth === 1 && colonAt < 0) colonAt = k;
          k++;
        }
        if (depth !== 0) {
          errors.push(
            diag.at('unbalanced', j, j + 1, 'lang.unbalanced_open', { open: '{', col: sm.span(j, j + 1).col }, {
              expected: ['}'],
              hint: 'Close the { with } or write \\{ for a literal brace.',
              fingerprintKey: '{',
            }),
          );
          j = k;
          litStart = j;
          continue;
        }
        const exprEnd = colonAt >= 0 ? colonAt : k;
        const toks = lexRange(j + 1, exprEnd, false);
        const part: { toks: Token[]; fmt?: string; s: number; e: number } = { toks, s: j, e: k + 1 };
        if (colonAt >= 0) {
          const fmt = text.slice(colonAt + 1, k).trim();
          if (!FORMAT_RE.test(fmt)) {
            errors.push(
              diag.at('bad_format', colonAt + 1, k, 'lang.bad_format', { fmt }, {
                expected: [...TEXT_FORMATS],
                hint: 'Formats: 2 (decimals), .3 (significant figures), d (degrees), f (fraction), % (percent).',
                fingerprintKey: fmt,
              }),
            );
          } else part.fmt = fmt;
        }
        parts.push(part);
        j = k + 1;
        litStart = j;
        continue;
      }
      lit += c;
      j++;
    }
    if (!closed) {
      const sp = sm.span(i, i + 1);
      errors.push(
        diag.at('unterminated_string', i, i + 1, 'lang.unterminated_string', { col: sp.col }, {
          expected: ['"'],
          hint: 'Add a closing " at the end of the text.',
          suggest: [text.slice(0, j).replace(/\s+$/, '') + '"'],
          fingerprintKey: '"',
        }),
      );
      flush(j);
      return { tok: { kind: 'str', text: text.slice(i, j), s: i, e: j, parts }, next: j };
    }
    flush(j);
    return { tok: { kind: 'str', text: text.slice(i, j + 1), s: i, e: j + 1, parts }, next: j + 1 };
  }
}
