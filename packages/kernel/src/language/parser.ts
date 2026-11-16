/**
 * Step 2: parse. A hand-written recursive descent parser over the token list, one token of
 * lookahead for expressions and a short scan to decide the line kind
 * (docs/features/language/design.md 3.4 to 3.6). Never reads the figure.
 */
import type { Notice, Result } from '../contracts/errors';
import type { Arg, BinOp, CmpOp, DirectiveWord, Expr, LineNode, NameRef, ParsedLine, Pos, RangeClause, StyleItem } from './ast';
import { Diag, buildError, withMore } from './errors';
import type { ErrorExtra, LanguageError } from './errors';
import { MAX_DEPTH, lex } from './lexer';
import { suggestName } from './names';
import { isCellName } from './cells';
import type { Token } from './lexer';
import { SourceMap, splitLogicalLines } from './source';
import type { LangLimits } from './source';

export interface ParseOptions {
  /** 1-based number of the first physical line (default 1). */
  line?: number;
  /** Lets the parser raise `unnamed_object` for object commands itself. Without it the checker does. */
  isObjectCommand?: (name: string) => boolean;
  /** True for a name the figure already uses, so a suggested name for an unnamed line is free. */
  isTaken?: (name: string) => boolean;
  /** Forms of a command, for `forms` on a syntax error inside its call. */
  commandForms?: (name: string) => readonly string[];
  /** Host limits for line length and nesting depth. */
  limits?: LangLimits;
}

const isUpper = (s: string): boolean => s.length > 0 && s[0] !== undefined && s[0] >= 'A' && s[0] <= 'Z';

class Stop extends Error {
  constructor(readonly err: LanguageError) {
    super('parse stop');
  }
}

class Parser {
  pos = 0;
  depth = 0;
  readonly diag: Diag;
  readonly callStack: string[] = [];

  constructor(
    readonly toks: readonly Token[],
    readonly sm: SourceMap,
    readonly opts: ParseOptions,
  ) {
    this.diag = new Diag(sm);
  }

  /* ---------------------------- token helpers ---------------------------- */

  peek(o = 0): Token {
    return this.toks[Math.min(this.pos + o, this.toks.length - 1)] as Token;
  }
  next(): Token {
    const t = this.peek();
    if (this.pos < this.toks.length - 1) this.pos++;
    return t;
  }
  isOp(text: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === 'op' && t.text === text;
  }
  isKw(text: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === 'kw' && t.text === text;
  }
  atEnd(): boolean {
    const k = this.peek().kind;
    return k === 'eof' || k === 'nl' || k === 'comment';
  }
  prevEnd(): number {
    return this.pos > 0 ? (this.toks[this.pos - 1] as Token).e : 0;
  }

  /** Does the token start an operand (so that a missing operator or comma is the likely mistake)? */
  startsOperand(t: Token): boolean {
    return t.kind === 'num' || t.kind === 'name' || t.kind === 'str' || t.kind === 'sqrt' || (t.kind === 'op' && (t.text === '(' || t.text === '[')) || (t.kind === 'kw' && (t.text === 'if' || t.text === 'not'));
  }

  tokenLabel(t: Token): string {
    if (t.kind === 'eof' || t.kind === 'nl') return 'end of line';
    if (t.kind === 'comment') return 'comment';
    return this.sm.span(t.s, t.e).token || t.text;
  }

  /** Raise the right error for an unexpected token. */
  unexpected(expected: readonly string[], opts: { afterOperand?: boolean; hint?: string } = {}): never {
    const t = this.peek();
    const atEnd = t.kind === 'eof' || t.kind === 'nl' || t.kind === 'comment';
    const inCall = this.callStack[this.callStack.length - 1];

    // '=' where an operator should be
    if (t.kind === 'op' && t.text === '=') throw new Stop(this.assignInExpr(t));

    // two operands touching
    if (opts.afterOperand && !atEnd && this.startsOperand(t) && !(t.kind === 'kw')) {
      throw new Stop(this.missingOperator(t, inCall !== undefined));
    }

    const extra: ErrorExtra = { expected: expected.slice(0, 8), fingerprintKey: this.tokenLabel(t) };
    if (opts.hint) extra.hint = opts.hint;
    if (inCall !== undefined && this.opts.commandForms) {
      const forms = this.opts.commandForms(inCall);
      if (forms.length > 0) extra.forms = forms;
    }
    if (atEnd) {
      // the end token of a text interpolation sits on its closing brace, not at the end of the whole line
      const s = t.s;
      throw new Stop(this.diag.at('syntax', s, s, 'lang.syntax_end', { token: '', expected: expected.join(', ') || 'more input' }, { ...extra, fingerprintKey: 'end' }));
    }
    if (inCall !== undefined && isUpper(inCall) && (t.text === ',' || t.text === ')')) {
      const withClose = expected.includes(')') ? expected : [...expected, ')'];
      throw new Stop(
        this.diag.at('syntax', t.s, t.e, 'lang.syntax_call', { token: t.text, command: inCall, why: 'the argument before it is missing', expected: withClose.join(', ') }, {
          ...extra,
          expected: withClose.slice(0, 8),
        }),
      );
    }
    throw new Stop(this.diag.at('syntax', t.s, t.e, 'lang.syntax', { token: this.tokenLabel(t), expected: expected.join(', ') || 'something else' }, extra));
  }

  missingOperator(t: Token, inCall: boolean): LanguageError {
    const text = this.sm.text;
    const star = text.slice(0, t.s).replace(/\s+$/, '') + ' * ' + text.slice(t.s);
    const comma = text.slice(0, t.s).replace(/\s+$/, '') + ', ' + text.slice(t.s);
    const suggest = inCall ? [comma, star] : [star];
    return this.diag.at('missing_operator', t.s, t.e, 'lang.missing_operator', {}, {
      hint: inCall
        ? 'Separate arguments with a comma, or write * to multiply. Adjacent names are not multiplied.'
        : "Write * between the two values. Adjacent names are not multiplied; only a number directly before a name or '(' is (2x, 3(a + b)).",
      suggest,
      expected: inCall ? [',', ')', '*'] : ['*', '+', '-', '/'],
      fingerprintKey: t.text,
    });
  }

  assignInExpr(t: Token): LanguageError {
    const text = this.sm.text;
    const replaced = text.slice(0, t.s) + '==' + text.slice(t.e);
    const node = this.lineHead;
    const suggest: string[] = [];
    let why = "'=' cannot appear inside an expression; equality is written '=='";
    if (node === 'bare' && this.relationLike) {
      const name = 'l';
      suggest.push(`${name} = ${replaced.trim()}`);
      why = "this relation between x and y needs '=='";
    } else if (node === 'define' && this.relationLike) {
      suggest.push(replaced);
      why = "this relation between x and y needs '=='";
    }
    const extra: ErrorExtra = {
      expected: ['=='],
      hint: node === 'bare' && this.relationLike ? 'Name the object on the left: l = 3x + 4y == 12.' : "Use '==' to compare; '=' only defines the object on the left.",
      suggest,
      fingerprintKey: '=',
    };
    return this.diag.at('assign_in_expr', t.s, t.e, 'lang.assign_in_expr', { why }, extra);
  }

  lineHead: 'bare' | 'define' | 'other' = 'other';
  relationLike = false;

  expectOp(text: string, expected?: readonly string[]): Token {
    if (this.isOp(text)) return this.next();
    return this.unexpected(expected ?? [text], { afterOperand: true });
  }

  enter(): void {
    const maxDepth = this.opts.limits?.depth ?? MAX_DEPTH;
    if (++this.depth > maxDepth) {
      const t = this.peek();
      throw new Stop(
        this.diag.at('limit', t.s, t.e, 'lang.limit', { limit: 'depth', max: maxDepth, got: this.depth, what: 'levels of nesting' }, {
          hint: 'Define the inner part as its own object first.',
          limit: { name: 'depth', max: maxDepth, got: this.depth },
          fingerprintKey: 'depth',
        }),
      );
    }
  }
  leave(): void {
    this.depth--;
  }

  /* ------------------------------ lines ------------------------------ */

  parseLine(): LineNode {
    const t = this.peek();
    if (t.kind === 'eof' || t.kind === 'nl') return { k: 'noop' };
    if (t.kind === 'comment') return { k: 'noop', comment: t.text };
    if (t.kind === 'at') return this.parseDirective();

    // a keyword on the left of '=' is a (reserved) name; the checker refuses it with reserved_name
    if (t.kind === 'kw' && this.isOp('=', 1)) return this.parseDefine();

    // `1a = 1`: a number directly followed by a name, then '=' (a name cannot start with a digit)
    if (t.kind === 'num' && t.int === true && /^\d+$/.test(t.text)) {
      const n1 = this.peek(1);
      if (n1.kind === 'name' && n1.s === t.e && this.isOp('=', 2)) {
        const text = this.sm.text;
        const fixed = text.slice(0, t.s) + n1.text + t.text + text.slice(n1.e);
        throw new Stop(
          this.diag.at('bad_name', t.s, n1.e, 'lang.bad_name', { name: t.text + n1.text, why: 'A name cannot start with a digit' }, {
            hint: `Names start with a letter. Write ${n1.text}${t.text} instead.`,
            suggest: [fixed],
            fingerprintKey: t.text + n1.text,
          }),
        );
      }
    }

    if (t.kind === 'name') {
      const n1 = this.peek(1);
      // Name = ...
      if (n1.kind === 'op' && n1.text === '=') return this.parseDefine();
      // Name, Name = Command(...)
      if (n1.kind === 'op' && n1.text === ',' && this.looksLikeDefMany()) return this.parseDefMany();
      // Name(params) = ...
      if (n1.kind === 'op' && n1.text === '(' && this.looksLikeFunctionDef()) return this.parseFunctionDef();
      // Name' = ...
      if (n1.kind === 'op' && n1.text === "'" && this.looksLikeRate()) return this.parseRate();
      // Name with ...
      if (n1.kind === 'kw' && n1.text === 'with') {
        this.pos++;
        return { k: 'restyle', target: this.nameRef(t), style: this.parseStyle() };
      }
      // Name in a..b
      if (n1.kind === 'kw' && n1.text === 'in') {
        this.pos++;
        const range = this.parseRange();
        this.finishLine();
        return { k: 'rerange', target: this.nameRef(t), range };
      }
      // Name: value
      if (n1.kind === 'op' && n1.text === ':') throw new Stop(this.colonLabel(t, n1));
      // a lone name
      if (n1.kind === 'eof' || n1.kind === 'nl' || n1.kind === 'comment') {
        throw new Stop(
          this.diag.at('syntax', n1.kind === 'eof' ? n1.s : n1.s, n1.kind === 'eof' ? n1.s : n1.s, 'lang.syntax_end', { token: '', expected: '=, with, in' }, {
            expected: ['=', 'with', 'in', "'"],
            hint: `A name alone defines nothing. Write ${t.text} = ... to define it; to read its value use the figure tool.`,
            fingerprintKey: 'bare_name',
          }),
        );
      }
    }

    // anything else is a bare expression: an action command, or an unnamed object
    this.lineHead = 'bare';
    const start = this.pos;
    const expr = this.parseExpr();
    this.relationLike = this.containsFreeXY(expr);
    this.finishLine();
    if (expr.k === 'call' && isUpper(expr.callee) && !expr.paren) {
      if (this.opts.isObjectCommand?.(expr.callee)) throw new Stop(this.unnamed(expr, start));
      return { k: 'action', expr };
    }
    throw new Stop(this.unnamed(expr, start));
  }

  unnamed(expr: Expr, startTok: number): LanguageError {
    const first = this.toks[startTok] as Token;
    const text = this.sm.text.slice(first.s, expr.e).trim();
    let type: string;
    switch (expr.k) {
      case 'tuple':
      case 'polar':
        type = 'Point';
        break;
      case 'str':
        type = 'Text';
        break;
      case 'list':
      case 'range':
        type = 'List';
        break;
      case 'cmp':
        type = 'Bool';
        break;
      default:
        type = 'Number';
    }
    const isTaken = this.opts.isTaken;
    const name = suggestName(type, isTaken ? (n: string) => isTaken(n) : new Set<string>());
    return this.diag.at('unnamed_object', first.s, expr.e, 'lang.unnamed_object', { line: text, name }, {
      hint: `Give it a name, for example ${name} = ${text}.`,
      suggest: [`${name} = ${text}`],
      fingerprintKey: expr.k === 'call' ? expr.callee : expr.k,
    });
  }

  colonLabel(nameTok: Token, colon: Token): LanguageError {
    const text = this.sm.text;
    let end = colon.e;
    if (text[end] === '=') end++;
    let rest = text.slice(end).trimStart();
    if (/\b[xy]\b/.test(rest)) rest = rest.replace(/(?<![=!<>])=(?!=)/, '==');
    const fixed = text.slice(0, colon.s).trimEnd() + ' = ' + rest;
    return this.diag.at('syntax', colon.s, end, 'lang.colon_label', { token: text.slice(colon.s, end) }, {
      expected: ['='],
      hint: `Write ${nameTok.text} = ... to name an object.`,
      suggest: [fixed],
      fingerprintKey: 'colon',
    });
  }

  nameRef(t: Token): NameRef {
    return { name: t.name ?? t.text, s: t.s, e: t.e };
  }

  finishLine(): void {
    const t = this.peek();
    if (t.kind === 'eof' || t.kind === 'nl' || t.kind === 'comment') return;
    // `2,5` outside brackets: a decimal written with a comma (app-modes errors 1)
    const before = this.pos > 0 ? (this.toks[this.pos - 1] as Token) : undefined;
    const after = this.peek(1);
    if (t.kind === 'op' && t.text === ',' && before?.kind === 'num' && before.e === t.s && after.kind === 'num' && after.s === t.e && /^\d+$/.test(before.text) && /^\d/.test(after.text)) {
      const text = this.sm.text;
      const fixed = `${text.slice(0, t.s)}.${text.slice(t.e)}`;
      const num = `${before.text}.${/^\d+/.exec(after.text)?.[0] ?? after.text}`;
      throw new Stop(this.diag.at('decimal_comma', before.s, after.e, 'lang.decimal_comma', {}, { suggest: [fixed], hint: `Write ${num}.`, fingerprintKey: 'comma' }));
    }
    this.unexpected(['end of line'], { afterOperand: true });
  }

  looksLikeDefMany(): boolean {
    let o = 0;
    for (;;) {
      if (this.peek(o).kind !== 'name') return false;
      o++;
      if (this.isOp(',', o)) {
        o++;
        continue;
      }
      return this.isOp('=', o);
    }
  }

  parseDefMany(): LineNode {
    const targets: NameRef[] = [];
    for (;;) {
      targets.push(this.nameRef(this.next()));
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      break;
    }
    this.next(); // =
    this.lineHead = 'define';
    const expr = this.parseExpr();
    this.finishLine();
    return { k: 'defmany', targets, expr };
  }

  looksLikeFunctionDef(): boolean {
    // Name ( ident {, ident} ) =
    let o = 2;
    if (this.isOp(')', o)) return false;
    for (;;) {
      if (this.peek(o).kind !== 'name') return false;
      o++;
      if (this.isOp(',', o)) {
        o++;
        continue;
      }
      break;
    }
    return this.isOp(')', o) && this.isOp('=', o + 1);
  }

  parseFunctionDef(): LineNode {
    const nameTok = this.next();
    this.next(); // (
    const params: NameRef[] = [];
    for (;;) {
      params.push(this.nameRef(this.next()));
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      break;
    }
    this.next(); // )
    this.next(); // =
    this.lineHead = 'define';
    const expr = this.parseExpr();
    // `in a..b` restricts a function to an interval; one range per parameter, separated by commas
    let domain: RangeClause[] | undefined;
    if (this.isKw('in')) {
      domain = [];
      const kw = this.next();
      for (;;) {
        const start = domain.length === 0 ? kw.s : this.peek().s;
        const from = this.parseExpr();
        if (!this.isOp('..')) this.unexpected(['..'], { afterOperand: true });
        this.next();
        const to = this.parseExpr();
        domain.push({ s: start, e: this.prevEnd(), from, to });
        if (!this.isOp(',')) break;
        this.next();
      }
    }
    const style = this.maybeStyle();
    this.finishLine();
    return { k: 'function', target: this.nameRef(nameTok), params, expr, ...(domain ? { domain } : {}), ...(style ? { style } : {}) };
  }

  looksLikeRate(): boolean {
    let o = 1;
    while (this.isOp("'", o)) o++;
    return this.isOp('=', o);
  }

  parseRate(): LineNode {
    const nameTok = this.next();
    let order = 0;
    while (this.isOp("'")) {
      this.next();
      order++;
    }
    this.next(); // =
    this.lineHead = 'define';
    const expr = this.parseExpr();
    this.finishLine();
    return { k: 'rate', target: this.nameRef(nameTok), order, expr };
  }

  parseDefine(): LineNode {
    const nameTok = this.next();
    this.next(); // =
    this.lineHead = 'define';
    const exprStart = this.pos;
    const expr = this.parseExpr();
    this.relationLike = expr.k === 'cmp' || this.containsFreeXY(expr);
    let range: RangeClause | undefined;
    if (this.isKw('in')) range = this.parseRange();
    else if (this.isKw('step')) {
      // a step belongs to a range: say so, with the line that has one
      const t = this.peek();
      const rest = this.sm.text.slice(t.s).trim();
      const fixed = `${nameTok.text} = ${this.sm.text.slice(expr.s, expr.e)} in 0..10 ${rest}`;
      throw new Stop(
        this.diag.at('syntax', t.s, t.e, 'lang.syntax', { token: 'step', expected: 'in min..max before step' }, {
          expected: ['in'],
          hint: `step only follows a range. Give the range first: ${fixed}.`,
          suggest: [fixed],
          fingerprintKey: 'step_without_range',
        }),
      );
    }
    const style = this.maybeStyle();
    if (this.isOp('=')) this.unexpected(['end of line']);
    this.finishLine();
    void exprStart;
    return { k: 'define', target: this.nameRef(nameTok), expr, ...(range ? { range } : {}), ...(style ? { style } : {}) };
  }

  containsFreeXY(e: Expr): boolean {
    let found = false;
    const walk = (n: Expr): void => {
      if (found) return;
      switch (n.k) {
        case 'name':
          if (n.name === 'x' || n.name === 'y') found = true;
          break;
        case 'unary':
        case 'fact':
        case 'deg':
          walk(n.arg);
          break;
        case 'bin':
          walk(n.l);
          walk(n.r);
          break;
        case 'cmp':
          n.operands.forEach(walk);
          break;
        case 'call':
          n.args.forEach((a) => walk(a.value));
          break;
        case 'tick':
          n.args.forEach(walk);
          break;
        case 'index':
          walk(n.target);
          walk(n.index);
          break;
        case 'field':
          walk(n.target);
          n.args?.forEach(walk);
          break;
        case 'tuple':
        case 'list':
        case 'cond':
          (n.k === 'cond' ? n.args : n.items).forEach(walk);
          break;
        case 'polar':
          walk(n.r);
          walk(n.a);
          break;
        case 'range':
          walk(n.from);
          walk(n.to);
          if (n.step) walk(n.step);
          break;
        default:
          break;
      }
    };
    walk(e);
    return found;
  }

  parseRange(): RangeClause {
    const kw = this.next(); // in
    const from = this.parseExpr();
    if (!this.isOp('..')) {
      const t = this.peek();
      const atEnd = t.kind === 'eof' || t.kind === 'nl' || t.kind === 'comment';
      // two numbers with a gap between them: the two dots of the range are missing
      if (!atEnd && this.startsOperand(t) && t.kind !== 'kw') {
        throw new Stop(
          this.diag.at('syntax', t.s, t.e, 'lang.syntax', { token: this.tokenLabel(t), expected: '..' }, {
            expected: ['..'],
            hint: `Expected '..' between the two ends of the range: write ${this.sm.text.slice(from.s, from.e)}..${t.text}.`,
            fingerprintKey: 'range_dots',
          }),
        );
      }
      this.unexpected(['..'], { afterOperand: true });
    }
    this.next();
    const to = this.parseExpr();
    let step: Expr | undefined;
    if (this.isKw('step')) {
      this.next();
      const t = this.peek();
      if (t.kind === 'eof' || t.kind === 'nl' || t.kind === 'comment') this.unexpected(['a number after step']);
      step = this.parseExpr();
    }
    return { s: kw.s, e: this.prevEnd(), from, to, ...(step ? { step } : {}) };
  }

  maybeStyle(): StyleItem[] | undefined {
    if (!this.isKw('with')) return undefined;
    this.next();
    return this.parseStyle(true);
  }

  parseStyle(consumed = false): StyleItem[] {
    void consumed;
    const items: StyleItem[] = [];
    // `Name with` leaves `with` as the current token in the restyle path
    if (this.isKw('with')) this.next();
    for (;;) {
      const k = this.peek();
      if (k.kind !== 'name') this.unexpected(['property name']);
      this.next();
      if (!this.isOp('=')) this.unexpected(['='], { afterOperand: true });
      this.next();
      const value = this.parseExpr();
      items.push({ key: k.name ?? k.text, ks: k.s, ke: k.e, value, s: k.s, e: value.e });
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      break;
    }
    this.finishLine();
    return items;
  }

  parseDirective(): LineNode {
    this.next(); // @
    const n = this.peek();
    if (n.kind !== 'name' && n.kind !== 'kw') {
      throw new Stop(this.diag.at('bad_directive', n.s, n.e, 'lang.bad_directive', { directive: '@', need: 'a name after @' }, { expected: ['directive name'], fingerprintKey: 'noname' }));
    }
    if (n.s !== this.prevEnd()) {
      throw new Stop(this.diag.at('bad_directive', n.s, n.e, 'lang.bad_directive', { directive: '@', need: 'a name right after @' }, { expected: ['directive name'], fingerprintKey: 'space' }));
    }
    this.next();
    const words: DirectiveWord[] = [];
    let cur: { s: number; e: number; strs: string | undefined } | undefined;
    const flush = (): void => {
      if (!cur) return;
      const text = this.sm.text.slice(cur.s, cur.e);
      const num = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(text) ? Number(text) : undefined;
      words.push({ text, s: cur.s, e: cur.e, ...(cur.strs !== undefined ? { str: cur.strs } : {}), ...(num !== undefined ? { num } : {}) });
      cur = undefined;
    };
    while (!this.atEnd()) {
      const t = this.next();
      if (cur && t.s === cur.e) {
        cur.e = t.e;
        if (t.kind === 'str') cur.strs = undefined;
      } else {
        flush();
        let strs: string | undefined;
        if (t.kind === 'str') {
          strs = (t.parts ?? []).map((p) => ('lit' in p ? p.lit : '')).join('');
        }
        cur = { s: t.s, e: t.e, strs };
      }
    }
    flush();
    return { k: 'directive', name: n.text, ns: n.s, ne: n.e, words };
  }

  /* --------------------------- expressions --------------------------- */

  parseExpr(): Expr {
    return this.parseOr();
  }

  parseOr(): Expr {
    let l = this.parseXor();
    while (this.isKw('or')) {
      this.next();
      const r = this.parseXor();
      l = { k: 'bin', op: 'or', l, r, s: l.s, e: r.e };
    }
    return l;
  }
  parseXor(): Expr {
    let l = this.parseAnd();
    while (this.isKw('xor')) {
      this.next();
      const r = this.parseAnd();
      l = { k: 'bin', op: 'xor', l, r, s: l.s, e: r.e };
    }
    return l;
  }
  parseAnd(): Expr {
    let l = this.parseNot();
    while (this.isKw('and')) {
      this.next();
      const r = this.parseNot();
      l = { k: 'bin', op: 'and', l, r, s: l.s, e: r.e };
    }
    return l;
  }
  parseNot(): Expr {
    if (this.isKw('not')) {
      const t = this.next();
      this.enter();
      try {
        const arg = this.parseNot();
        return { k: 'unary', op: 'not', arg, s: t.s, e: arg.e };
      } finally {
        this.leave();
      }
    }
    return this.parseRelation();
  }

  parseRelation(): Expr {
    const first = this.parseSum();
    const operands: Expr[] = [first];
    const ops: CmpOp[] = [];
    const opPos: Pos[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && (t.text === '==' || t.text === '!=' || t.text === '<' || t.text === '<=' || t.text === '>' || t.text === '>=')) {
        this.next();
        ops.push(t.text as CmpOp);
        opPos.push({ s: t.s, e: t.e });
        operands.push(this.parseSum());
        continue;
      }
      break;
    }
    if (ops.length === 0) return first;
    if (ops.length > 1) this.checkChain(ops, opPos);
    return { k: 'cmp', ops, opPos, operands, s: first.s, e: (operands[operands.length - 1] as Expr).e };
  }

  checkChain(ops: readonly CmpOp[], opPos: readonly Pos[]): void {
    const asc = ops.every((o) => o === '<' || o === '<=');
    const desc = ops.every((o) => o === '>' || o === '>=');
    if (asc || desc) return;
    // first operator that breaks the chain
    let bad: number;
    if (ops.includes('!=')) bad = ops.indexOf('!=');
    else if (ops.every((o) => o === '==')) bad = 1;
    else if (ops.includes('==')) bad = ops.indexOf('==') === 0 ? 1 : ops.indexOf('==');
    else {
      const dirOf = (o: CmpOp): number => (o === '<' || o === '<=' ? 1 : -1);
      const d0 = dirOf(ops[0] as CmpOp);
      bad = ops.findIndex((o) => dirOf(o) !== d0);
    }
    if (bad < 0) bad = 1;
    const p = opPos[bad] as Pos;
    const why = ops.includes('!=')
      ? "'!=' cannot be chained"
      : ops.every((o) => o === '==')
        ? "Equality cannot be chained: a == b == c"
        : 'A chain must keep one direction: 0 < x <= 5 or 5 > x >= 0';
    throw new Stop(
      this.diag.at('chained_comparison', p.s, p.e, 'lang.chained_comparison', { why }, {
        hint: "Join separate comparisons with 'and', for example a == b and b == c.",
        fingerprintKey: ops.join(''),
      }),
    );
  }

  parseSum(): Expr {
    let l = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && (t.text === '+' || t.text === '-')) {
        this.next();
        const r = this.parseTerm();
        l = { k: 'bin', op: t.text as BinOp, l, r, s: l.s, e: r.e };
        continue;
      }
      return l;
    }
  }

  parseTerm(): Expr {
    let l = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && (t.text === '*' || t.text === '/')) {
        this.next();
        const r = this.parseUnary();
        if (t.text === '/') {
          // look through leading signs: 1/-2x divides by the implicit product 2x as much as 1/2x does
          let q: Expr = r;
          while (q.k === 'unary' && (q.op === '-' || q.op === '+') && !q.paren) q = q.arg;
          if (q.k === 'bin' && q.implicit && !q.paren) this.ambiguousDivision(l, r, q);
        }
        l = { k: 'bin', op: t.text as BinOp, l, r, s: l.s, e: r.e };
        continue;
      }
      return l;
    }
  }

  /** `r` is the right operand as written (it may start with signs); `imp` is the implicit product inside it. */
  ambiguousDivision(l: Expr, r: Expr, imp: Expr & { k: 'bin' }): never {
    const text = this.sm.text;
    const lt = text.slice(l.s, l.e);
    const signs = text.slice(r.s, imp.s);
    const num = signs + text.slice(imp.l.s, imp.l.e);
    const rest = text.slice(imp.r.s, imp.r.e);
    const whole = text.slice(r.s, r.e);
    const before = text.slice(0, l.s);
    const after = text.slice(r.e);
    const a = `(${lt}/${num}) * ${rest}`;
    const b = `${lt}/(${whole})`;
    const lineA = before + a + after;
    const lineB = before + b + after;
    throw new Stop(
      this.diag.at('ambiguous_implicit', r.s, r.e, 'lang.ambiguous_implicit', { text: `${lt}/${whole}`, a, b }, {
        hint: 'Add brackets for the one you mean.',
        quickFixes: [
          { label: a, lines: [lineA] },
          { label: b, lines: [lineB] },
        ],
        suggest: [lineA, lineB],
        recovery: 'choose',
        fingerprintKey: whole,
      }),
    );
  }

  parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.next();
      this.enter();
      try {
        const arg = this.parseUnary();
        return { k: 'unary', op: t.text as '-' | '+', arg, s: t.s, e: arg.e };
      } finally {
        this.leave();
      }
    }
    return this.parseJuxt();
  }

  /** The one implicit multiplication: a number literal directly before a name, `(` or a call. */
  parseJuxt(): Expr {
    const l = this.parsePower();
    if (l.k === 'num' && !l.paren) {
      const t = this.peek();
      const startsOperandHere = t.kind === 'name' || t.kind === 'sqrt' || (t.kind === 'op' && t.text === '(');
      if (startsOperandHere) {
        const r = this.parsePower();
        return { k: 'bin', op: '*', l, r, implicit: true, s: l.s, e: r.e };
      }
    }
    return l;
  }

  parsePower(): Expr {
    const base = this.parsePostfix();
    if (this.isOp('^')) {
      this.next();
      const rhs = this.parseSignedPower();
      return { k: 'bin', op: '^', l: base, r: rhs, s: base.s, e: rhs.e };
    }
    return base;
  }

  parseSignedPower(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.next();
      this.enter();
      try {
        const arg = this.parseSignedPower();
        return { k: 'unary', op: t.text as '-' | '+', arg, s: t.s, e: arg.e };
      } finally {
        this.leave();
      }
    }
    const base = this.parsePostfix();
    if (this.isOp('^')) {
      this.next();
      this.enter();
      try {
        const rhs = this.parseSignedPower();
        return { k: 'bin', op: '^', l: base, r: rhs, s: base.s, e: rhs.e };
      } finally {
        this.leave();
      }
    }
    return base;
  }

  parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op') return e;
      if (t.text === '(' && e.k === 'name' && !e.paren) {
        e = this.parseCall(e);
        continue;
      }
      if (t.text === "'" && e.k === 'name' && !e.paren && this.tickCallAhead()) {
        let ticks = 0;
        while (this.isOp("'")) {
          this.next();
          ticks++;
        }
        const open = this.next(); // (
        const args = this.parseArgList(')', e.name, true);
        const close = this.expectCloser(open, ')');
        e = { k: 'tick', callee: e.name, cs: e.s, ce: e.e, ticks, args: args.map((a) => a.value), s: e.s, e: close.e };
        continue;
      }
      if (t.text === '[' && e.k !== 'num' && e.k !== 'str' && ((e.k !== 'bin' && e.k !== 'unary') || e.paren === true)) {
        this.next();
        const index = this.parseExpr();
        if (this.isOp(',') && e.k === 'name' && isUpper(e.name)) throw new Stop(this.bracketCall(e, t));
        const close = this.expectCloser(t, ']');
        e = { k: 'index', target: e, index, s: e.s, e: close.e };
        continue;
      }
      if (t.text === '.') {
        const n = this.peek(1);
        if (n.kind === 'name' && n.s === t.e) {
          this.next();
          this.next();
          e = { k: 'field', target: e, field: n.name ?? n.text, fs: n.s, fe: n.e, s: e.s, e: n.e };
          // g.value(x): a field that holds a function, called (controls-scripting design 3.1)
          const open = this.peek();
          if (open.text === '(' && open.s === n.e) {
            this.next();
            const args = this.parseArgList(')', n.name ?? n.text, true);
            const close = this.expectCloser(open, ')');
            e = { ...e, args: args.map((a) => a.value), e: close.e };
          }
          continue;
        }
        this.next();
        this.unexpected(['field name']);
      }
      if (t.text === '!') {
        this.next();
        e = { k: 'fact', arg: e, s: e.s, e: t.e };
        continue;
      }
      if (t.text === '°') {
        this.next();
        e = { k: 'deg', arg: e, s: e.s, e: t.e };
        continue;
      }
      return e;
    }
  }

  /** `Circle[A, 2]`: square brackets after a command name. The rewrite to round brackets is mechanical. */
  bracketCall(callee: Expr & { k: 'name' }, open: Token): LanguageError {
    let depth = 1;
    let close: Token | undefined;
    for (let j = this.pos; j < this.toks.length; j++) {
      const k = this.toks[j] as Token;
      if (k.kind !== 'op') continue;
      if (k.text === '(' || k.text === '[') depth++;
      else if (k.text === ')' || k.text === ']') {
        depth--;
        if (depth === 0) {
          close = k;
          break;
        }
      }
    }
    const extra: ErrorExtra = {
      expected: ['('],
      hint: `Commands take round brackets: write ${callee.name}(…), not ${callee.name}[…].`,
      fingerprintKey: '[',
    };
    if (close !== undefined && close.text === ']') {
      const text = this.sm.text;
      extra.suggest = [text.slice(0, open.s) + '(' + text.slice(open.e, close.s) + ')' + text.slice(close.e)];
    }
    return this.diag.at('syntax', open.s, open.e, 'lang.syntax', { token: '[', expected: '(' }, extra);
  }

  tickCallAhead(): boolean {
    let o = 0;
    while (this.isOp("'", o)) o++;
    return this.isOp('(', o);
  }

  parseCall(callee: Expr & { k: 'name' }): Expr {
    const open = this.next(); // (
    this.callStack.push(callee.name);
    this.enter();
    try {
      const args = this.parseArgList(')', callee.name, false);
      const close = this.expectCloser(open, ')');
      return { k: 'call', callee: callee.name, cs: callee.s, ce: callee.e, args, open: open.s, close: close.s, s: callee.s, e: close.e };
    } finally {
      this.leave();
      this.callStack.pop();
    }
  }

  expectCloser(open: Token, close: string): Token {
    if (this.isOp(close)) return this.next();
    // the lexer already reported unbalanced brackets, so this is a different token in the way
    return this.unexpected([close, ','], { afterOperand: true });
  }

  parseArgList(close: string, _callee: string, exprOnly: boolean): Arg[] {
    const args: Arg[] = [];
    if (this.isOp(close)) return args;
    for (;;) {
      const t = this.peek();
      const n1 = this.peek(1);
      if (!exprOnly && t.kind === 'name' && n1.kind === 'op' && n1.text === '=') {
        this.next();
        this.next();
        const value = this.parseExpr();
        args.push({ name: t.name ?? t.text, ns: t.s, ne: t.e, value });
      } else {
        args.push({ value: this.parseExpr() });
      }
      if (this.isOp(',')) {
        this.next();
        if (this.isOp(close)) this.unexpected(['expression']);
        continue;
      }
      return args;
    }
  }

  parsePrimary(): Expr {
    const t = this.peek();
    switch (t.kind) {
      case 'num':
        this.next();
        return { k: 'num', v: t.num as number, text: t.text, int: t.int === true, s: t.s, e: t.e };
      case 'str':
        this.next();
        return this.strNode(t);
      case 'name': {
        this.next();
        const name = t.name ?? t.text;
        if (name === 'true' || name === 'false') return { k: 'bool', v: name === 'true', s: t.s, e: t.e };
        if (name === 'undefined') return { k: 'undef', s: t.s, e: t.e };
        const node: Expr & { k: 'name' } = { k: 'name', name, s: t.s, e: t.e, ...(t.cabs ? { cabs: true } : {}), ...(t.rabs ? { rabs: true } : {}) };
        // `A1:C5` written without spaces is a range of cells (spreadsheet design 3.3)
        const colon = this.peek();
        if (isCellName(name) && colon.kind === 'op' && colon.text === ':' && colon.s === t.e) {
          const end = this.peek(1);
          const endName = end.kind === 'name' ? (end.name ?? end.text) : '';
          if (end.s !== colon.e || end.kind !== 'name' || !isCellName(endName)) {
            throw new Stop(
              this.diag.at('syntax', colon.s, Math.max(colon.e, end.s === colon.e ? end.e : colon.e), 'lang.syntax', { token: end.s === colon.e && end.text !== '' ? end.text : 'the end', expected: 'a cell such as B3' }, {
                expected: ['a cell such as B3'],
                hint: `A range is two cells joined by a colon, such as ${t.text}:B3.`,
                fingerprintKey: 'range_end',
              }),
            );
          }
          this.next();
          this.next();
          const to: Expr & { k: 'name' } = { k: 'name', name: endName, s: end.s, e: end.e, ...(end.cabs ? { cabs: true } : {}), ...(end.rabs ? { rabs: true } : {}) };
          return { k: 'cells', from: node, to, s: t.s, e: end.e };
        }
        return node;
      }
      case 'sqrt': {
        this.next();
        const n = this.peek();
        let arg: Expr;
        if (n.kind === 'num' || n.kind === 'name') {
          arg = this.parsePrimary();
          // allow √x.y and √f(x)
          if (arg.k === 'name' && this.isOp('(')) arg = this.parseCall(arg);
        } else if (this.isOp('(')) {
          arg = this.parsePrimary();
        } else {
          return this.unexpected(['number', 'name', '(']);
        }
        const callee: Expr = {
          k: 'call', callee: 'sqrt', cs: t.s, ce: t.e, args: [{ value: arg }], open: arg.s, close: arg.e, s: t.s, e: arg.e,
        };
        return callee;
      }
      case 'kw':
        if (t.text === 'if') return this.parseCond();
        return this.unexpected(['expression']);
      case 'op':
        if (t.text === '(') return this.parseParen();
        if (t.text === '[') return this.parseList();
        return this.unexpected(['expression']);
      default:
        return this.unexpected(['expression']);
    }
  }

  strNode(t: Token): Expr {
    const parts: (string | { expr: Expr; fmt?: string; s: number; e: number })[] = [];
    for (const p of t.parts ?? []) {
      if ('lit' in p) parts.push(p.lit);
      else {
        const sub = new Parser([...p.toks, { kind: 'eof', text: '', s: p.e - 1, e: p.e - 1 }], this.sm, this.opts);
        sub.lineHead = 'other';
        sub.depth = this.depth;
        if (p.toks.length === 0) {
          throw new Stop(this.diag.at('syntax', p.s, p.e, 'lang.syntax', { token: '{}', expected: 'expression' }, { expected: ['expression'], hint: 'Put an expression inside { }.', fingerprintKey: '{}' }));
        }
        const expr = sub.parseExpr();
        if (sub.peek().kind !== 'eof') sub.unexpected(['}'], { afterOperand: true });
        parts.push({ expr, ...(p.fmt !== undefined ? { fmt: p.fmt } : {}), s: p.s, e: p.e });
      }
    }
    return { k: 'str', parts, s: t.s, e: t.e };
  }

  parseCond(): Expr {
    const kw = this.next(); // if
    if (!this.isOp('(')) return this.unexpected(['(']);
    const open = this.next();
    this.callStack.push('if');
    try {
      const args: Expr[] = [];
      if (this.isOp(')')) this.unexpected(['expression']);
      for (;;) {
        args.push(this.parseExpr());
        if (this.isOp(',')) {
          this.next();
          if (this.isOp(')')) this.unexpected(['expression']);
          continue;
        }
        break;
      }
      const close = this.expectCloser(open, ')');
      return { k: 'cond', args, s: kw.s, e: close.e };
    } finally {
      this.callStack.pop();
    }
  }

  parseParen(): Expr {
    const open = this.next(); // (
    this.callStack.push('');
    try {
      const first = this.parseExpr();
      if (this.isOp(',')) {
        const items: Expr[] = [first];
        while (this.isOp(',')) {
          this.next();
          if (this.isOp(')')) this.unexpected(['expression']);
          items.push(this.parseExpr());
        }
        const close = this.expectCloser(open, ')');
        return { k: 'tuple', items, s: open.s, e: close.e };
      }
      if (this.isOp(';')) {
        this.next();
        const a = this.parseExpr();
        const close = this.expectCloser(open, ')');
        return { k: 'polar', r: first, a, s: open.s, e: close.e };
      }
      const close = this.expectCloser(open, ')');
      return { ...first, paren: true, s: open.s, e: close.e } as Expr;
    } finally {
      this.callStack.pop();
    }
  }

  parseList(): Expr {
    const open = this.next(); // [
    this.callStack.push('');
    try {
      if (this.isOp(']')) {
        const close = this.next();
        return { k: 'list', items: [], s: open.s, e: close.e };
      }
      const first = this.parseExpr();
      if (this.isOp('..')) {
        this.next();
        const to = this.parseExpr();
        let step: Expr | undefined;
        if (this.isKw('step')) {
          this.next();
          step = this.parseExpr();
        }
        const close = this.expectCloser(open, ']');
        return { k: 'range', from: first, to, ...(step ? { step } : {}), s: open.s, e: close.e };
      }
      const items: Expr[] = [first];
      while (this.isOp(',')) {
        this.next();
        if (this.isOp(']')) this.unexpected(['expression']);
        items.push(this.parseExpr());
      }
      const close = this.expectCloser(open, ']');
      return { k: 'list', items, s: open.s, e: close.e };
    } finally {
      this.callStack.pop();
    }
  }
}

/** Parse the tokens of one expression (used for arguments to the left of a cursor). */
export function parseExprTokens(toks: readonly Token[], sm: SourceMap): Result<Expr> {
  const p = new Parser([...toks, { kind: 'eof', text: '', s: sm.text.length, e: sm.text.length }], sm, {});
  try {
    const e = p.parseExpr();
    if (p.peek().kind !== 'eof') p.unexpected(['end of expression'], { afterOperand: true });
    return { ok: true, value: e, notices: [] };
  } catch (err) {
    if (err instanceof Stop) return err.err;
    throw err;
  }
}

/** Parse one logical line (it may span several physical lines while a bracket is open). */
export function parseLine(source: string, opts: ParseOptions = {}): Result<ParsedLine> {
  try {
    return parseLineInner(source, opts);
  } catch (err) {
    return internalFault(source, opts.line ?? 1, err);
  }
}

function internalFault(source: string, line: number, err: unknown): LanguageError {
  void err;
  return buildError('internal', 'lang.internal', { where: 'the parser' }, line, 1, 1, '', source.length <= 200 ? source : undefined, { recovery: 'report', fingerprintKey: 'parser' });
}

function parseLineInner(source: string, opts: ParseOptions): Result<ParsedLine> {
  const logical = splitLogicalLines(source);
  const nonEmpty = logical.filter((l) => l.text.trim() !== '');
  const first = nonEmpty[0] ?? logical[0];
  if (first === undefined || nonEmpty.length === 0) {
    const sm = new SourceMap(source, opts.line ?? 1);
    return { ok: true, value: { line: opts.line ?? 1, source, sm, node: { k: 'noop' } }, notices: [] };
  }
  if (nonEmpty.length > 1) {
    // more than one logical line was sent where exactly one is expected
    const sm = new SourceMap(source, opts.line ?? 1);
    const second = nonEmpty[1] as { text: string; firstLine: number };
    const diag = new Diag(sm);
    // the first character of the second logical line, counted in the normalised text (physical lines match one to one)
    let idx = 0;
    for (let n = 1; n < second.firstLine; n++) idx = sm.text.indexOf('\n', idx) + 1;
    while (idx < sm.text.length && (sm.text[idx] === ' ' || sm.text[idx] === '\t')) idx++;
    return diag.at('syntax', idx, idx + 1, 'lang.syntax', { token: 'a second line', expected: 'one line' }, {
      expected: ['end of input'],
      hint: 'Send one line at a time (a call may continue on the next line only while a bracket is open).',
      fingerprintKey: 'second_line',
    });
  }
  return parseLogical(first.text, { ...opts, line: (opts.line ?? 1) + first.firstLine - 1 });
}

/**
 * `probe` is set when the text is itself a suggestion being tried: its own lexer errors are returned as they are, without
 * trying a suggestion for it, so the check happens once.
 */
function parseLogical(text: string, opts: ParseOptions, probe = false): Result<ParsedLine> {
  const firstLine = opts.line ?? 1;
  const sm = new SourceMap(text, firstLine);
  const lexed = lex(sm, opts.limits ? { limits: opts.limits } : {});
  const errors = lexed.errors;
  const notices: Notice[] = [...lexed.notices];
  const toks = lexed.tokens;

  if (errors.length > 0) {
    let first = errors[0] as LanguageError;
    // An unbalanced opener at end of line: the suggestion only stays if the completed line parses.
    if (!probe && first.kind === 'unbalanced' && first.suggest.length > 0) {
      const cand = parseLogical(first.suggest[0] as string, opts, true);
      if (!cand.ok) first = { ...first, suggest: [], recovery: 'fix_line' } as LanguageError;
    }
    return first;
  }

  const p = new Parser(toks, sm, opts);
  try {
    const node = p.parseLine();
    return { ok: true, value: { line: firstLine, source: text, sm, node }, notices };
  } catch (err) {
    if (err instanceof Stop) return err.err;
    throw err;
  }
}

/** One result per logical line of a program; blank lines and comments give `noop`. */
export function parseProgram(source: string, opts: ParseOptions = {}): { line: number; result: Result<ParsedLine> }[] {
  const out: { line: number; result: Result<ParsedLine> }[] = [];
  const first = opts.line ?? 1;
  for (const l of splitLogicalLines(source)) {
    out.push({ line: first + l.firstLine - 1, result: parseLogical(l.text, { ...opts, line: first + l.firstLine - 1 }) });
  }
  return out;
}

export { withMore };
