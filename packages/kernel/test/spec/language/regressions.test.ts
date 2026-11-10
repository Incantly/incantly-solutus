/**
 * Regression tests for the checker's findings LANG-SM-1 to LANG-SM-21 (handoff/language/findings.md).
 * Every test goes through the public entry `@incantly/kernel` only. A test fails on the bug and
 * passes when it is fixed. Tests that guard a hang or a memory blow-up assert a time or size bound
 * and carry a test timeout.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  PLATFORM_MATH,
  ScratchFigure,
  SourceMap,
  analyseLine,
  complete,
  compileLine,
  createEnv,
  evaluate,
  getMathLib,
  lex,
  parseLine,
  parseProgram,
  preview,
  setMathLib,
  splitLogicalLines,
  tokenize,
} from '@incantly/kernel';
import type { CommandSpec, FunctionValue, LanguageError, MathLib, ObjId, RelationValue } from '@incantly/kernel';
import { emptyFig, errOf, form, okValue, p } from './helpers';

const now = (): number => performance.now();

/** Apply a line that must pass, and return what the figure made of it. */
function applyOk(fig: ScratchFigure, src: string) {
  return okValue(fig.apply(src));
}

/** The compact text of everything an error says to a writer, used to look for leaked internals. */
function allText(e: LanguageError): string {
  return JSON.stringify(e);
}

// ---------------------------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------------------------

describe('LANG-SM-1: registry lookups answer only their own keys', () => {
  const PROTO_KEYS = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'toLocaleString', 'propertyIsEnumerable'];

  function figWithObjects(): ScratchFigure {
    const fig = emptyFig();
    for (const line of ['A = (1, 2)', 'm = "hi"', 'L = [1, 2, 3]', 'k = 4']) applyOk(fig, line);
    return fig;
  }

  it('LANG-SM-1: a field named like an Object.prototype member is refused', () => {
    const fig = figWithObjects();
    for (const owner of ['A', 'm', 'L', 'k']) {
      for (const key of PROTO_KEYS) {
        const r = fig.apply(`out = ${owner}.${key}`);
        expect(r.ok, `out = ${owner}.${key} must be refused`).toBe(false);
        expect(fig.lookup('out'), `out = ${owner}.${key} must not create an object`).toBeUndefined();
      }
    }
  });

  it('LANG-SM-1: a refused prototype field leaves the name free to be defined later', () => {
    const fig = figWithObjects();
    expect(fig.apply('b = A.constructor').ok).toBe(false);
    expect(fig.apply('b = A.toString').ok).toBe(false);
    const later = fig.apply('b = 3');
    expect(later.ok).toBe(true);
    expect(fig.valueOf('b')).toBe(3);
    expect(fig.apply('b = 5').ok).toBe(true);
    expect(fig.valueOf('b')).toBe(5);
  });

  it('LANG-SM-1: real fields still work', () => {
    const fig = figWithObjects();
    expect(fig.apply('b = A.x').ok).toBe(true);
    expect(fig.valueOf('b')).toBe(1);
    expect(fig.apply('c = A.y').ok).toBe(true);
    expect(fig.valueOf('c')).toBe(2);
  });

  it('LANG-SM-1: a property named like an Object.prototype member is unknown_property', () => {
    const fig = figWithObjects();
    for (const key of PROTO_KEYS) {
      const r = analyseLine(`A with ${key} = 1`, fig);
      expect(r.ok, `A with ${key} = 1`).toBe(false);
      expect(errOf(r).kind).toBe('unknown_property');
    }
    const several = analyseLine('A with toString = red, hasOwnProperty = 3', fig);
    expect(several.ok).toBe(false);
    expect(errOf(several).kind).toBe('unknown_property');
  });

  it('LANG-SM-1: a property in a definition clause named like an Object.prototype member is refused', () => {
    const fig = figWithObjects();
    const r = analyseLine('B = (3, 4) with constructor = 1', fig);
    expect(r.ok).toBe(false);
    expect(errOf(r).kind).toBe('unknown_property');
  });

  it('LANG-SM-1: a directive named like an Object.prototype member is unknown_directive', () => {
    const fig = figWithObjects();
    for (const key of PROTO_KEYS) {
      const r = analyseLine(`@${key} x`, fig);
      expect(r.ok, `@${key} x`).toBe(false);
      expect(errOf(r).kind).toBe('unknown_directive');
    }
    const bare = analyseLine('@toString', fig);
    expect(bare.ok).toBe(false);
    expect(errOf(bare).kind).toBe('unknown_directive');
  });

  it('LANG-SM-1: completion after a dot, a `with` and an @ does not offer prototype members', () => {
    const fig = figWithObjects();
    const labels = (src: string): string[] => complete(src, src.length, fig).map((c) => c.label);
    for (const src of ['q = A.', 'A with ', '@']) {
      const got = labels(src);
      for (const key of PROTO_KEYS) expect(got, `${src} must not offer ${key}`).not.toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Hangs and crashes
// ---------------------------------------------------------------------------------------------

describe('LANG-SM-2: ncr and npr stop early', () => {
  it('LANG-SM-2: preview of ncr(1e8, 5e7) returns within 50 ms and shows overflow', { timeout: 10_000 }, () => {
    const fig = emptyFig();
    preview('k1 = ncr(10, 5)', fig); // warm up
    const t0 = now();
    const r = preview('k2 = ncr(100000000, 50000000)', fig);
    const ms = now() - t0;
    expect(ms).toBeLessThan(50);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valueText).toBe('undefined (overflow)');
  });

  it('LANG-SM-2: preview of npr(1e8, 1e8) returns within 50 ms and shows overflow', { timeout: 10_000 }, () => {
    const fig = emptyFig();
    preview('k1 = npr(10, 5)', fig); // warm up
    const t0 = now();
    const r = preview('k3 = npr(100000000, 100000000)', fig);
    const ms = now() - t0;
    expect(ms).toBeLessThan(50);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valueText).toBe('undefined (overflow)');
  });

  it('LANG-SM-2: applying ncr and npr with huge arguments is fast and undefined with reason overflow', { timeout: 10_000 }, () => {
    const fig = emptyFig();
    fig.apply('w = ncr(10, 5)'); // warm up
    const t0 = now();
    const a = applyOk(fig, 'k2 = ncr(100000000, 50000000)');
    const b = applyOk(fig, 'k3 = npr(100000000, 100000000)');
    const c = applyOk(fig, 'n = 100000000');
    const d = applyOk(fig, 'k4 = ncr(n, 50000000)');
    expect(now() - t0).toBeLessThan(100);
    for (const r of [a, b, d]) {
      expect(r.defined).toBe(false);
      expect(r.reason).toBe('overflow');
    }
    expect(c.defined).toBe(true);
  });

  it('LANG-SM-2: ordinary ncr and npr values are unchanged', () => {
    const fig = emptyFig();
    expect(applyOk(fig, 'a = ncr(5, 2)').defined).toBe(true);
    expect(fig.valueOf('a')).toBe(10);
    applyOk(fig, 'b = npr(5, 2)');
    expect(fig.valueOf('b')).toBe(20);
    applyOk(fig, 'c = ncr(52, 5)');
    expect(fig.valueOf('c')).toBe(2598960);
    applyOk(fig, 'd = npr(10, 10)');
    expect(fig.valueOf('d')).toBe(3628800);
    applyOk(fig, 'q = ncr(1000, 500)');
    // 1000 choose 500 is about 2.7e299: finite, below the 1.8e308 limit
    const e = fig.valueOf('q') as number;
    expect(Number.isFinite(e)).toBe(true);
    expect(e / 2.7e299).toBeGreaterThan(0.99);
    expect(e / 2.7e299).toBeLessThan(1.02);
  });
});

describe('LANG-SM-3: text length is bounded at run time', () => {
  it('LANG-SM-3: doubling a 1,000 character text stops at the 10,000 character limit with reason limit', { timeout: 20_000 }, () => {
    const fig = emptyFig();
    applyOk(fig, `t0 = "${'x'.repeat(1000)}"`);
    expect(applyOk(fig, 't1 = t0 + t0').defined).toBe(true);
    expect(applyOk(fig, 't2 = t1 + t1').defined).toBe(true);
    const t3 = applyOk(fig, 't3 = t2 + t2');
    expect(t3.defined).toBe(true);
    expect((fig.valueOf('t3') as string).length).toBe(8000);
    const t4 = applyOk(fig, 't4 = t3 + t3');
    expect(t4.defined).toBe(false);
    expect(t4.reason).toBe('limit');
    expect(fig.valueOf('t4')).toBeUndefined();
  });

  it('LANG-SM-3: the same limit holds for text with interpolations', { timeout: 20_000 }, () => {
    const fig = emptyFig();
    applyOk(fig, `t0 = "${'x'.repeat(1000)}"`);
    applyOk(fig, 't1 = t0 + t0');
    applyOk(fig, 't2 = t1 + t1');
    applyOk(fig, 't3 = t2 + t2');
    const r = applyOk(fig, 'j = "{t3}{t3}"');
    expect(r.defined).toBe(false);
    expect(r.reason).toBe('limit');
    const ok = applyOk(fig, 'j2 = "{t0}{t0}"');
    expect(ok.defined).toBe(true);
    expect((fig.valueOf('j2') as string).length).toBe(2000);
  });

  it('LANG-SM-3: a text of exactly 10,000 characters is allowed', () => {
    const fig = emptyFig();
    applyOk(fig, `t0 = "${'x'.repeat(1000)}"`);
    applyOk(fig, 't1 = t0 + t0 + t0 + t0 + t0');
    const r = applyOk(fig, 't2 = t1 + t1');
    expect(r.defined).toBe(true);
    expect((fig.valueOf('t2') as string).length).toBe(10000);
    const over = applyOk(fig, 't3 = t2 + "y"');
    expect(over.defined).toBe(false);
    expect(over.reason).toBe('limit');
  });
});

describe('LANG-SM-4: the cycle test runs in bounded stack on a long chain', () => {
  const CHAIN = 5000;

  function chain(): ScratchFigure {
    const fig = emptyFig();
    fig.define('a0', 'Number', 1, { source: 'a0 = 1' });
    for (let i = 1; i < CHAIN; i++) {
      fig.define(`a${i}`, 'Number', i + 1, { source: `a${i} = a${i - 1} + 1`, inputs: [`a${i - 1}`] });
    }
    return fig;
  }

  it('LANG-SM-4: redefining the end of a 5,000 object chain without a cycle is accepted', { timeout: 30_000 }, () => {
    const fig = chain();
    expect(fig.size).toBe(CHAIN);
    const t0 = now();
    const r = analyseLine(`a${CHAIN - 1} = a${CHAIN - 2} + 2`, fig);
    const ms = now() - t0;
    if (!r.ok) throw new Error(`acyclic redefinition refused: ${r.kind}: ${r.message}`);
    expect(r.value.op).toBe('redefine');
    expect(ms).toBeLessThan(2000);
  });

  it('LANG-SM-4: a real cycle through the whole chain is still found', { timeout: 30_000 }, () => {
    const fig = chain();
    const r = analyseLine(`a0 = a${CHAIN - 1} + 1`, fig);
    expect(r.ok).toBe(false);
    const e = errOf(r);
    expect(e.kind).toBe('cycle');
    expect(e.path?.length ?? 0).toBeGreaterThan(2);
  });

  it('LANG-SM-4: the middle of the chain can be redefined too', { timeout: 30_000 }, () => {
    const fig = chain();
    const r = analyseLine('a2500 = a2499 * 2', fig);
    if (!r.ok) throw new Error(`refused: ${r.kind}: ${r.message}`);
    expect(r.value.op).toBe('redefine');
  });
});

describe('LANG-SM-5: splitting and cursor context are linear', () => {
  it('LANG-SM-5: a program with one never-closed bracket splits in linear time', { timeout: 20_000 }, () => {
    splitLogicalLines('a = max(1,\n2,\n3)\nb = 2'); // warm up
    const src = 'a = max(1,\n' + '2,\n'.repeat(20000);
    const t0 = now();
    const lines = splitLogicalLines(src);
    const ms = now() - t0;
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(ms).toBeLessThan(500);
  });

  it('LANG-SM-5: parseProgram on that text is bounded and reports the first line as an error', { timeout: 20_000 }, () => {
    parseProgram('a = max(1,\n2,\n3)\nb = 2'); // warm up
    const src = 'a = max(1,\n' + '2,\n'.repeat(20000);
    const t0 = now();
    const out = parseProgram(src);
    const ms = now() - t0;
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.result.ok).toBe(false);
    expect(ms).toBeLessThan(500);
  });

  it('LANG-SM-5: splitting still joins a normal multi-line call into one logical line', () => {
    const lines = splitLogicalLines('a = max(1,\n2,\n3)\nb = 2');
    expect(lines.length).toBe(2);
    expect(lines[1]!.text).toBe('b = 2');
    expect(lines[0]!.firstLine).toBe(1);
    expect(lines[0]!.lineCount).toBe(3);
    expect(lines[1]!.firstLine).toBe(4);
  });

  it('LANG-SM-5: completion at the end of 10,000 lines under one open bracket stays fast', { timeout: 20_000 }, () => {
    const fig = emptyFig();
    const small = 'a = max(1,\n2,\n';
    complete(small, small.length, fig); // warm up
    const src = 'a = max(1,\n' + '2,\n'.repeat(10000);
    const t0 = now();
    const got = complete(src, src.length, fig);
    const ms = now() - t0;
    expect(Array.isArray(got)).toBe(true);
    expect(ms).toBeLessThan(300);
  });
});

describe('LANG-SM-6: the unbalanced-line suggestion is made once', () => {
  it('LANG-SM-6: a line with an open bracket and a trailing comment parses quickly', () => {
    parseLine('a = max(1, 2 # note'); // warm up
    const t0 = now();
    for (let i = 0; i < 5; i++) parseLine('a = max(1, 2 # note');
    const per = (now() - t0) / 5;
    expect(per).toBeLessThan(20);
  });

  it('LANG-SM-6: the fix closes the bracket and keeps the comment as a comment', () => {
    const r = parseLine('a = max(1, 2 # note');
    expect(r.ok).toBe(false);
    const e = errOf(r);
    expect(e.kind).toBe('unbalanced');
    const fix = e.fix ?? e.suggest[0];
    expect(fix).toBeDefined();
    const reparsed = parseLine(fix!);
    expect(reparsed.ok, `suggestion "${fix}" must parse`).toBe(true);
    expect(fix!.indexOf(')')).toBeLessThan(fix!.indexOf('#'));
  });

  it('LANG-SM-6: a line without a comment still gets the closers at its end', () => {
    const e = errOf(parseLine('A = (1, 2'));
    expect(e.kind).toBe('unbalanced');
    expect(e.fix).toBe('A = (1, 2)');
    const e2 = errOf(parseLine('b = max(1, min(2, 3'));
    expect(e2.fix).toBe('b = max(1, min(2, 3))');
  });
});

describe('LANG-SM-7: token and nesting limits cover text interpolations', () => {
  const ones = (n: number): string => '1' + '+1'.repeat(n - 1);

  it('LANG-SM-7: 1,801 tokens inside a text interpolation are over the token limit', () => {
    const body = ones(901); // 901 numbers and 900 plus signs
    const control = parseLine(`s = ${body}`);
    expect(control.ok).toBe(false);
    expect(errOf(control).kind).toBe('limit');
    const inText = parseLine(`s = "{${body}}"`);
    expect(inText.ok).toBe(false);
    expect(errOf(inText).kind).toBe('limit');
  });

  it('LANG-SM-7: tokens in several interpolations add up', () => {
    const body = ones(250); // 499 tokens
    const src = `s = "{${body}}{${body}}"`; // about 1,000 tokens in all
    const r = parseLine(src);
    expect(r.ok).toBe(false);
    expect(errOf(r).kind).toBe('limit');
  });

  it('LANG-SM-7: a small interpolation is still fine', () => {
    const r = parseLine('s = "a{1+2}b{3*4}c"');
    expect(r.ok).toBe(true);
  });

  it('LANG-SM-7: brackets around a text and inside its interpolation add up to the depth limit', () => {
    const control = parseLine(`s = ${'('.repeat(126)}1${')'.repeat(126)}`);
    expect(control.ok).toBe(false);
    expect(errOf(control).kind).toBe('limit');
    const src = `s = ${'('.repeat(62)}"{${'('.repeat(64)}1${')'.repeat(64)}}"${')'.repeat(62)}`;
    const r = parseLine(src);
    expect(r.ok).toBe(false);
    expect(errOf(r).kind).toBe('limit');
  });

  it('LANG-SM-7: nesting that stays within 64 levels across the text boundary is accepted', () => {
    const src = `s = ${'('.repeat(20)}"{${'('.repeat(20)}1${')'.repeat(20)}}"${')'.repeat(20)}`;
    expect(parseLine(src).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Wrong results
// ---------------------------------------------------------------------------------------------

describe('LANG-SM-8: the splitter and the lexer agree where a text ends', () => {
  it('LANG-SM-8: an unfinished text inside a call does not swallow the lines after it', () => {
    const out = parseProgram('s = max(len("abc\n), 1)\nA = (1, 2)\nB = (3, 4)');
    const first = out[0]!;
    expect(first.line).toBe(1);
    expect(first.result.ok).toBe(false);
    expect(errOf(first.result).kind).toBe('unterminated_string');
    const byLine = new Map(out.map((o) => [o.line, o.result]));
    expect(byLine.get(3)?.ok, 'A = (1, 2) on line 3 must be parsed').toBe(true);
    expect(byLine.get(4)?.ok, 'B = (3, 4) on line 4 must be parsed').toBe(true);
  });

  it('LANG-SM-8: a string never spans a newline in the splitter', () => {
    const lines = splitLogicalLines('a = "abc\nB = (1, 2)\nC = (3, 4)');
    expect(lines.length).toBe(3);
    expect(lines.map((l) => l.firstLine)).toEqual([1, 2, 3]);
  });

  it('LANG-SM-8: a text closed with a low double quote ends there for the splitter too', () => {
    const lines = splitLogicalLines('s = len("x„)\nB = (1, 2)');
    expect(lines.length).toBe(2);
    expect(lines[1]!.text).toBe('B = (1, 2)');
    expect(lines[1]!.firstLine).toBe(2);
  });

  it('LANG-SM-8: a closed text with brackets in it still hides them from the splitter', () => {
    const lines = splitLogicalLines('s = len("a(b")\nB = (1, 2)');
    expect(lines.length).toBe(2);
    const joined = splitLogicalLines('s = max(len("a)b"),\n1)\nB = (1, 2)');
    expect(joined.length).toBe(2);
    expect(joined[0]!.lineCount).toBe(2);
  });
});

describe('LANG-SM-9: style and range reads do not make a free object dependent', () => {
  function figure(): ScratchFigure {
    const fig = emptyFig();
    applyOk(fig, 'n = 10');
    applyOk(fig, 'B = (1, 1)');
    return fig;
  }

  it('LANG-SM-9: a slider whose range reads a variable is free', () => {
    const fig = figure();
    const r = analyseLine('a = 3 in 0..n', fig);
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    expect(r.value.free).toBe(true);
  });

  it('LANG-SM-9: after such a slider is made, its range can be changed', () => {
    const fig = figure();
    applyOk(fig, 'a = 3 in 0..n');
    expect(fig.lookup('a')?.free).toBe(true);
    const r = analyseLine('a in 0..20', fig);
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    expect(r.value.op).toBe('rerange');
  });

  it('LANG-SM-9: a number whose style value reads a variable is free', () => {
    const fig = figure();
    const r = analyseLine('a = 3 with opacity = n / 20', fig);
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    expect(r.value.free).toBe(true);
  });

  it('LANG-SM-9: a point with a showIf rule is free and is stored as free', () => {
    const fig = figure();
    const r = analyseLine('P = (1, 2) with showIf = B.x > 0', fig);
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    expect(r.value.free).toBe(true);
    applyOk(fig, 'P = (1, 2) with showIf = B.x > 0');
    expect(fig.lookup('P')?.free).toBe(true);
  });

  it('LANG-SM-9: a value that reads another object is still not free', () => {
    const fig = figure();
    const r = analyseLine('c = n + 1', fig);
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    expect(r.value.free).toBe(false);
    const withStyle = analyseLine('d = n + 1 with opacity = 0.5', fig);
    if (!withStyle.ok) throw new Error(`${withStyle.kind}: ${withStyle.message}`);
    expect(withStyle.value.free).toBe(false);
  });
});

describe('LANG-SM-10: function and relation values keep their own locals in a shared Env', () => {
  it('LANG-SM-10: functions sharing an Env keep their own parameters', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = 10 * x');
    const fInfo = fig.lookup('f')!;
    const lineF = okValue(analyseLine('f(x) = 10 * x', fig));
    const lineG = okValue(analyseLine('g(x, y) = f(y) + x', fig));
    const cf = okValue(compileLine(lineF));
    const cg = okValue(compileLine(lineG));
    const env = createEnv({ slots: 8, read: (id) => (id === fInfo.id ? fValue : undefined) });
    const first = evaluate(cf, env);
    if (!first.defined) throw new Error('f did not evaluate');
    const fValue = first.value as FunctionValue;
    const second = evaluate(cg, env);
    if (!second.defined) throw new Error('g did not evaluate');
    const g = second.value as FunctionValue;
    expect(fValue.call(3)).toBe(30);
    // g(1, 2) = f(2) + 1 = 21
    expect(g.call(1, 2)).toBe(21);
    expect(g.call(1, 2)).toBe(21);
    expect(g.call(5, 7)).toBe(75);
    // f is unchanged by being called from g
    expect(fValue.call(4)).toBe(40);
  });

  it('LANG-SM-10: a relation value keeps x and y while it calls a function in the same Env', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = 10 * x');
    const fInfo = fig.lookup('f')!;
    const lineF = okValue(analyseLine('f(x) = 10 * x', fig));
    const lineK = okValue(analyseLine('k = f(y) + x == 0', fig));
    const cf = okValue(compileLine(lineF));
    const ck = okValue(compileLine(lineK));
    const env = createEnv({ slots: 8, read: (id) => (id === fInfo.id ? fValue : undefined) });
    const first = evaluate(cf, env);
    if (!first.defined) throw new Error('f did not evaluate');
    const fValue = first.value as FunctionValue;
    const second = evaluate(ck, env);
    if (!second.defined) throw new Error('k did not evaluate');
    const rel = second.value as RelationValue;
    // residual = f(y) + x = 10 * 2 + 1
    expect(rel.residual(1, 2)).toBe(21);
    expect(rel.residual(1, 2)).toBe(21);
    expect(rel.residual(3, -1)).toBe(-7);
  });

  it('LANG-SM-10: the figure gives the same answers', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = 10 * x');
    applyOk(fig, 'g(x, y) = f(y) + x');
    const g = fig.valueOf('g') as FunctionValue;
    expect(g.call(1, 2)).toBe(21);
  });
});

describe('LANG-SM-11: an infinity is allowed per value, not per line', () => {
  it('LANG-SM-11: exp(1000) beside an unrelated inf in a condition stays undefined with reason overflow', () => {
    const fig = emptyFig();
    const w0 = applyOk(fig, 'w0 = if(1 < 2, exp(1000), 0)');
    expect(w0.defined).toBe(false);
    expect(w0.reason).toBe('overflow');
    const w1 = applyOk(fig, 'w1 = if(1 < inf, exp(1000), 0)');
    expect(w1.defined).toBe(false);
    expect(w1.reason).toBe('overflow');
  });

  it('LANG-SM-11: an earlier object holding inf does not make later overflow infinite', () => {
    const fig = emptyFig();
    const big = applyOk(fig, 'big = inf');
    expect(big.defined).toBe(true);
    expect(fig.valueOf('big')).toBe(Infinity);
    const w2 = applyOk(fig, 'w2 = if(big > 0, exp(1000), 0)');
    expect(w2.defined).toBe(false);
    expect(w2.reason).toBe('overflow');
  });

  it('LANG-SM-11: a function of an infinite input still gives an infinite result (ruling Q4)', () => {
    const fig = emptyFig();
    applyOk(fig, 'big = inf');
    const a = applyOk(fig, 'a = exp(big)');
    expect(a.defined).toBe(true);
    expect(fig.valueOf('a')).toBe(Infinity);
    const b = applyOk(fig, 'b = max(big, 3)');
    expect(b.defined).toBe(true);
    expect(fig.valueOf('b')).toBe(Infinity);
    const c = applyOk(fig, 'c = exp(1000)');
    expect(c.defined).toBe(false);
    expect(c.reason).toBe('overflow');
  });

  it('LANG-SM-11: the stored value of inf itself is unchanged', () => {
    const fig = emptyFig();
    expect(applyOk(fig, 'hi = inf').defined).toBe(true);
    expect(fig.valueOf('hi')).toBe(Infinity);
    expect(applyOk(fig, 'lo = -inf').defined).toBe(true);
    expect(fig.valueOf('lo')).toBe(-Infinity);
  });

  it('LANG-SM-11: an inf in a style value does not change the overflow of the value', () => {
    const fig = emptyFig();
    const r = fig.apply('w3 = exp(1000) with opacity = inf');
    // The style value may be refused as out of range; when the line is accepted, the value is overflow.
    if (r.ok) {
      expect(r.value.defined).toBe(false);
      expect(r.value.reason).toBe('overflow');
    }
    const q = fig.apply('big = inf');
    expect(q.ok).toBe(true);
    const s = fig.apply('w4 = exp(1000) with opacity = if(big > 0, 1, 0)');
    if (s.ok) {
      expect(s.value.defined).toBe(false);
      expect(s.value.reason).toBe('overflow');
    }
  });
});

describe('LANG-SM-12: an undefined text stays undefined when added to a text', () => {
  it('LANG-SM-12: undefined + "x" is undefined with a reason', () => {
    const fig = emptyFig();
    const u = applyOk(fig, 'u = if(1 > 2, "a")');
    expect(u.defined).toBe(false);
    const s = applyOk(fig, 's = u + "x"');
    expect(s.defined).toBe(false);
    expect(s.reason).toBeDefined();
    expect(fig.valueOf('s')).toBeUndefined();
  });

  it('LANG-SM-12: "x" + undefined is undefined with a reason', () => {
    const fig = emptyFig();
    applyOk(fig, 'u = if(1 > 2, "a")');
    const s = applyOk(fig, 's = "x" + u');
    expect(s.defined).toBe(false);
    expect(s.reason).toBeDefined();
    expect(fig.valueOf('s')).toBeUndefined();
  });

  it('LANG-SM-12: two defined texts still join', () => {
    const fig = emptyFig();
    applyOk(fig, 'u = "a"');
    const s = applyOk(fig, 's = u + "x"');
    expect(s.defined).toBe(true);
    expect(fig.valueOf('s')).toBe('ax');
  });
});

describe('LANG-SM-13: one MathLib for every result', () => {
  const original = getMathLib();
  afterEach(() => {
    setMathLib(PLATFORM_MATH);
  });

  /** A library whose results are visibly different from the platform's. */
  const marked = (): MathLib => ({
    ...PLATFORM_MATH,
    sin: () => 42,
    pow: (x: number, y: number) => PLATFORM_MATH.pow(x, y) + 1000,
    exp: (x: number) => PLATFORM_MATH.exp(x) + 1000,
    log: (x: number) => PLATFORM_MATH.log(x) + 1000,
    sqrt: (x: number) => PLATFORM_MATH.sqrt(x) + 1000,
  });

  /** Result of one line applied in a fresh figure. */
  function numberOf(src: string, name = 'out'): number | undefined {
    const fig = emptyFig();
    const r = fig.apply(src);
    if (!r.ok) throw new Error(`${src}: ${r.kind}: ${r.message}`);
    return r.value.defined ? (fig.valueOf(name) as number) : undefined;
  }

  it('LANG-SM-13: the platform library is installed at the start', () => {
    expect(original).toBe(PLATFORM_MATH);
  });

  it('LANG-SM-13: a folded constant call and a recompiled one agree after the library changes', () => {
    const fig = emptyFig();
    const compile = (src: string) => okValue(compileLine(okValue(analyseLine(src, fig))));
    const old = compile('m = sin(1)');
    const oldFn = compile('m2(x) = sin(1) + 0 * x');
    const env = createEnv({ slots: 4 });
    const before = evaluate(old, env);
    expect(before.defined && (before.value as number)).toBeCloseTo(0.841471, 5);

    setMathLib(marked());
    const fresh = compile('m = sin(1)');
    const freshFn = compile('m2(x) = sin(1) + 0 * x');
    const env2 = createEnv({ slots: 4 });
    const f = evaluate(fresh, env2);
    expect(f.defined && (f.value as number)).toBe(42);

    // the line compiled earlier must give the answer of the library that is installed now
    const after = evaluate(old, createEnv({ slots: 4 }));
    expect(after.defined && (after.value as number)).toBe(42);
    const oldFnValue = evaluate(oldFn, createEnv({ slots: 4 }));
    const freshFnValue = evaluate(freshFn, createEnv({ slots: 4 }));
    if (!oldFnValue.defined || !freshFnValue.defined) throw new Error('function lines did not evaluate');
    expect((oldFnValue.value as FunctionValue).call(0)).toBe((freshFnValue.value as FunctionValue).call(0));
    expect((oldFnValue.value as FunctionValue).call(0)).toBe(42);
  });

  it('LANG-SM-13: gamma, beta, erf and erfc use the installed library', () => {
    const platform = {
      gamma: numberOf('out = gamma(5.5)'),
      beta: numberOf('out = beta(2.5, 3.5)'),
      erf: numberOf('out = erf(0.5)'),
      erfc: numberOf('out = erfc(0.5)'),
    };
    for (const v of Object.values(platform)) expect(Number.isFinite(v)).toBe(true);
    expect(platform.gamma).toBeCloseTo(52.34277778, 5);
    expect(platform.erf).toBeCloseTo(0.5204998778, 8);

    setMathLib(marked());
    expect(numberOf('out = gamma(5.5)'), 'gamma').not.toBe(platform.gamma);
    expect(numberOf('out = beta(2.5, 3.5)'), 'beta').not.toBe(platform.beta);
    expect(numberOf('out = erf(0.5)'), 'erf').not.toBe(platform.erf);
    expect(numberOf('out = erfc(0.5)'), 'erfc').not.toBe(platform.erfc);
  });

  it('LANG-SM-13: a power of a function uses the installed library', () => {
    setMathLib(marked());
    const fig = emptyFig();
    applyOk(fig, 'h(x) = x^2.5');
    applyOk(fig, 'hh = h^1.5');
    applyOk(fig, 'direct = h(3)^1.5');
    const hh = fig.valueOf('hh') as FunctionValue;
    const direct = fig.valueOf('direct') as number;
    expect(Number.isFinite(direct)).toBe(true);
    expect(hh.call(3)).toBe(direct);
  });

  it('LANG-SM-13: folding a range bound uses the installed library', () => {
    setMathLib(marked());
    const fig = emptyFig();
    const expected = numberOf('out = 2^3.5');
    const r = analyseLine('d = 3 in 0..2^3.5', fig);
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    expect(r.value.range?.max).toBe(expected);
  });

  it('LANG-SM-13: under the platform library the answers are the usual ones', () => {
    expect(numberOf('out = 2^3')).toBe(8);
    expect(numberOf('out = sin(0)')).toBe(0);
    expect(numberOf('out = gamma(5)')).toBeCloseTo(24, 8);
  });
});

describe('LANG-SM-14: a division by a signed implicit product is ambiguous too', () => {
  it('LANG-SM-14: 1/2x is ambiguous (control)', () => {
    const e = errOf(parseLine('q(x) = 1/2x'));
    expect(e.kind).toBe('ambiguous_implicit');
  });

  it('LANG-SM-14: 1/-2x is ambiguous_implicit', () => {
    const r = parseLine('q(x) = 1/-2x');
    expect(r.ok).toBe(false);
    expect(errOf(r).kind).toBe('ambiguous_implicit');
  });

  it('LANG-SM-14: 1/+2x is ambiguous_implicit', () => {
    const r = parseLine('q(x) = 1/+2x');
    expect(r.ok).toBe(false);
    expect(errOf(r).kind).toBe('ambiguous_implicit');
  });

  it('LANG-SM-14: a/-2x is ambiguous_implicit', () => {
    const r = parseLine('q(x, a) = a/-2x');
    expect(r.ok).toBe(false);
    expect(errOf(r).kind).toBe('ambiguous_implicit');
  });

  it('LANG-SM-14: clear spellings are accepted', () => {
    for (const src of ['q(x) = 1/(-2x)', 'q(x) = 1/-(2x)', 'q(x) = 1/-2*x', 'q(x) = 1/-2', 'q(x) = (1/-2)*x', 'q(x) = 1/-x']) {
      const r = parseLine(src);
      expect(r.ok, src).toBe(true);
    }
  });
});

describe('LANG-SM-15: a form is matched with its own typing of each argument', () => {
  const commands: CommandSpec[] = [
    {
      name: 'Fz',
      kind: 'object',
      group: 'test',
      forms: [
        form([p('a', 'List<Point>'), p('b', 'Number')], 'Number', 'list of points and a number'),
        form([p('a', 'List<Number>'), p('b', 'Point')], 'Number', 'list of numbers and a point'),
      ],
    },
  ];

  function figure(): ScratchFigure {
    const fig = emptyFig(commands);
    applyOk(fig, 'A = (1, 2)');
    return fig;
  }

  it('LANG-SM-15: Fz([], 1) fits the first form (control)', () => {
    const r = analyseLine('n = Fz([], 1)', figure());
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
  });

  it('LANG-SM-15: Fz([], A) fits the second form', () => {
    const r = analyseLine('n = Fz([], A)', figure());
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    expect(r.value.type?.k).toBe('Number');
  });

  it('LANG-SM-15: the order of the forms does not decide', () => {
    const swapped: CommandSpec[] = [{ ...commands[0]!, forms: [commands[0]!.forms[1]!, commands[0]!.forms[0]!] }];
    const fig = emptyFig(swapped);
    applyOk(fig, 'A = (1, 2)');
    for (const src of ['n = Fz([], A)', 'n = Fz([], 1)']) {
      const r = analyseLine(src, fig);
      if (!r.ok) throw new Error(`${src}: ${r.kind}: ${r.message}`);
    }
  });

  it('LANG-SM-15: a call that fits no form is still refused', () => {
    const r = analyseLine('n = Fz([], "x")', figure());
    expect(r.ok).toBe(false);
    expect(errOf(r).kind).toBe('no_matching_form');
  });
});

// ---------------------------------------------------------------------------------------------
// Wrong errors
// ---------------------------------------------------------------------------------------------

describe('LANG-SM-16: errors inside a body argument are reported when several forms compete', () => {
  const commands: CommandSpec[] = [
    {
      name: 'Sq',
      kind: 'object',
      group: 'test',
      forms: [
        form(
          [p('body', 'Number', { kind: 'body' }), p('k', 'Number', { kind: 'binder' }), p('from', 'Number'), p('to', 'Number')],
          'List<Number>',
          'numbers',
        ),
        form(
          [p('body', 'Point', { kind: 'body' }), p('k', 'Number', { kind: 'binder' }), p('from', 'Number'), p('to', 'Number')],
          'List<Point>',
          'points',
        ),
      ],
    },
  ];

  it('LANG-SM-16: an unknown name in the body is reported as unknown_name', () => {
    const fig = emptyFig(commands);
    const r = analyseLine('L9 = Sq(k^2 + qq, k, 1, 5)', fig);
    expect(r.ok).toBe(false);
    const e = errOf(r);
    const kinds = [e.kind, ...(e.more ?? []).map((m) => m.kind)];
    expect(e.kind, `got ${kinds.join(', ')}: ${e.message}`).toBe('unknown_name');
    expect(e.token).toBe('qq');
    expect(e.col).toBe(15);
  });

  it('LANG-SM-16: the same mistake in a body with a point result is reported too', () => {
    const fig = emptyFig(commands);
    const e = errOf(analyseLine('L9 = Sq((k, qq), k, 1, 5)', fig));
    expect(e.kind).toBe('unknown_name');
    expect(e.token).toBe('qq');
  });

  it('LANG-SM-16: a good body picks its form', () => {
    const fig = emptyFig(commands);
    const numbers = analyseLine('L9 = Sq(k^2, k, 1, 5)', fig);
    if (!numbers.ok) throw new Error(`${numbers.kind}: ${numbers.message}`);
    expect(numbers.value.type?.k).toBe('List');
    const points = analyseLine('L9 = Sq((k, k^2), k, 1, 5)', fig);
    if (!points.ok) throw new Error(`${points.kind}: ${points.message}`);
  });
});

describe('LANG-SM-17: ScratchFigure.define does not throw', () => {
  it('LANG-SM-17: an unknown input name is ignored or reported, not thrown', () => {
    const fig = emptyFig();
    expect(() => fig.define('zz', 'Number', 1, { inputs: ['nope'] })).not.toThrow();
    expect(fig.lookup('zz')).toBeDefined();
    expect(fig.valueOf('zz')).toBe(1);
  });

  it('LANG-SM-17: known and unknown inputs together', () => {
    const fig = emptyFig();
    fig.define('a', 'Number', 1);
    expect(() => fig.define('zz', 'Number', 1, { inputs: ['a', 'nope', 'also_missing'] })).not.toThrow();
    const zz = fig.lookup('zz')!;
    const a = fig.lookup('a')!;
    expect(fig.inputsOf(zz.id)).toContain(a.id);
    expect(fig.inputsOf(zz.id).every((id) => fig.byId(id) !== undefined)).toBe(true);
  });

  it('LANG-SM-17: the figure stays usable after the call', () => {
    const fig = emptyFig();
    fig.define('zz', 'Number', 1, { inputs: ['nope'] });
    expect(fig.apply('q = zz + 1').ok).toBe(true);
    expect(fig.valueOf('q')).toBe(2);
    expect(() => fig.recompute()).not.toThrow();
  });
});

describe('LANG-SM-18: errors point at the text the writer typed', () => {
  it('LANG-SM-18: leading blank lines count in the line number', () => {
    const e = errOf(parseLine('\n\nA = (1, 2'));
    expect(e.kind).toBe('unbalanced');
    expect(e.line).toBe(3);
    expect(e.col).toBe(5);
  });

  it('LANG-SM-18: an error on a second line points at that line', () => {
    const e = errOf(parseLine('A = (1, 2)\n2'));
    expect(e.line).toBe(2);
    expect(e.col).toBe(1);
    expect(e.endCol).toBe(2);
  });

  it('LANG-SM-18: an error at the end of an interpolation points at the closing brace', () => {
    const r = parseLine('s = "{1+}" + "abc"');
    const e = errOf(r);
    expect(e.line).toBe(1);
    expect(e.col).toBe(9);
  });

  it('LANG-SM-18: preview of an unnamed line reports columns of the text typed', () => {
    const fig = emptyFig();
    const r = preview('(1, qq)', fig);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unknown_name');
    expect(r.error.token).toBe('qq');
    expect(r.error.col).toBe(5);
    expect(r.error.endCol).toBe(7);
  });

  it('LANG-SM-18: preview of an unnamed line keeps the typed columns when it starts with spaces', () => {
    const fig = emptyFig();
    const r = preview('   (1, qq)', fig);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.token).toBe('qq');
    expect(r.error.col).toBe(8);
  });

  it('LANG-SM-18: the temporary name of a preview never reaches the writer', () => {
    const fig = emptyFig();
    for (const src of ['(x, 1)', '(1, qq)', 'x + 1', '2 +']) {
      const r = preview(src, fig);
      if (r.ok) continue;
      expect(allText(r.error), `preview(${JSON.stringify(src)})`).not.toMatch(/pvw/);
    }
  });
});

describe('LANG-SM-19: a character outside the Basic Multilingual Plane gives one error', () => {
  it('LANG-SM-19: lex reports one bad_character for an emoji', () => {
    const { errors } = lex(new SourceMap('a😀'));
    expect(errors.length).toBe(1);
    expect(errors[0]!.kind).toBe('bad_character');
    expect(errors[0]!.col).toBe(2);
    expect(errors[0]!.endCol).toBe(4);
  });

  it('LANG-SM-19: tokenize reports one error and one error token covering the whole character', () => {
    const { tokens, errors } = tokenize('a😀');
    expect(errors.length).toBe(1);
    const bad = tokens.filter((t) => t.kind === 'error');
    expect(bad.length).toBeLessThanOrEqual(1);
    for (const t of bad) {
      expect(t.col).toBe(2);
      expect(t.endCol).toBe(4);
    }
  });

  it('LANG-SM-19: parseLine gives one error for an emoji in a line', () => {
    const r = parseLine('a = 1 😀 + 2');
    expect(r.ok).toBe(false);
    const e = errOf(r);
    expect(e.kind).toBe('bad_character');
    expect((e.more ?? []).length).toBe(0);
  });

  it('LANG-SM-19: two emoji give two errors', () => {
    const { errors } = lex(new SourceMap('a😀😀'));
    expect(errors.length).toBe(2);
  });
});

describe('LANG-SM-20: blockedBy covers names written with braced subscripts', () => {
  it('LANG-SM-20: a reader of P_1 is blocked by a failed P_{1} line', () => {
    const fig = emptyFig();
    const out = fig.applyAll(['P_{1} = (1, ', 'Q = P_1 + (1, 1)']);
    expect(out[0]!.ok).toBe(false);
    expect(out[1]!.ok).toBe(false);
    const e = errOf(out[1]!);
    expect(e.blockedBy).toEqual({ line: 1, kind: 'unbalanced' });
  });

  it('LANG-SM-20: a reader of P_{1} is blocked by a failed P_1 line', () => {
    const fig = emptyFig();
    const out = fig.applyAll(['P_1 = (1, ', 'Q = P_{1} + (1, 1)']);
    const e = errOf(out[1]!);
    expect(e.blockedBy).toEqual({ line: 1, kind: 'unbalanced' });
  });

  it('LANG-SM-20: plain subscripts keep working (control)', () => {
    const fig = emptyFig();
    const out = fig.applyAll(['R_1 = (1, ', 'S = R_1 + (1, 1)']);
    const e = errOf(out[1]!);
    expect(e.blockedBy).toEqual({ line: 1, kind: 'unbalanced' });
  });
});

// ---------------------------------------------------------------------------------------------
// Cosmetic
// ---------------------------------------------------------------------------------------------

describe('LANG-SM-21: tokenize colours a long script', () => {
  const script = 'a = 1\n'.repeat(400); // 2,400 characters

  it('LANG-SM-21: tokens are returned for every line of a script over 2,000 characters', () => {
    const { tokens, errors } = tokenize(script);
    expect(errors.filter((e) => e.kind === 'limit').length).toBe(0);
    expect(tokens.filter((t) => t.kind === 'number').length).toBe(400);
    expect(Math.max(...tokens.map((t) => t.line))).toBe(400);
    expect(tokens.filter((t) => t.line === 400).length).toBeGreaterThan(0);
  });

  it('LANG-SM-21: columns restart on every line', () => {
    const { tokens } = tokenize(script);
    const second = tokens.filter((t) => t.line === 2);
    expect(second.map((t) => [t.text, t.col, t.endCol])).toEqual([
      ['a', 1, 2],
      ['=', 3, 4],
      ['1', 5, 6],
    ]);
  });

  it('LANG-SM-21: a single line over 2,000 characters is still reported as a limit', () => {
    const { errors } = tokenize('a = ' + '1+'.repeat(1100) + '1');
    expect(errors.some((e) => e.kind === 'limit')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Round 2: LANG-SM-9 (reopened), LANG-SM-22, LANG-SM-23, LANG-SM-24
// ---------------------------------------------------------------------------------------------

describe('LANG-SM-9 (reopened): a command call in a range bound or a style value does not make an object dependent', () => {
  /** The command table of the helpers holds `Distance(Point, Point) -> Number`. */
  function figure(): ScratchFigure {
    const fig = emptyFig();
    applyOk(fig, 'A = (1, 1)');
    applyOk(fig, 'B = (4, 5)');
    return fig;
  }

  function checkedOk(src: string, fig: ScratchFigure) {
    const r = analyseLine(src, fig);
    if (!r.ok) throw new Error(`${src}: ${r.kind}: ${r.message}`);
    return r.value;
  }

  it('LANG-SM-9: a style value that calls a command leaves the number free', () => {
    const fig = figure();
    expect(checkedOk('a = 3 with opacity = Distance(A, B) / 10', fig).free).toBe(true);
    applyOk(fig, 'a = 3 with opacity = Distance(A, B) / 10');
    expect(fig.lookup('a')?.free).toBe(true);
  });

  it('LANG-SM-9: a number with a command in its style value can be given a new range', () => {
    const fig = figure();
    applyOk(fig, 'a = 3 with opacity = Distance(A, B) / 10');
    const r = checkedOk('a in 0..20', fig);
    expect(r.op).toBe('rerange');
  });

  it('LANG-SM-9: a slider whose range bound calls a command is free and stays a slider', () => {
    const fig = figure();
    const r = checkedOk('k = 3 in 0..Distance(A, B)', fig);
    expect(r.free).toBe(true);
    expect(r.range).toBeDefined();
    applyOk(fig, 'k = 3 in 0..Distance(A, B)');
    expect(fig.lookup('k')?.free).toBe(true);
    expect(fig.lookup('k')?.slider).toBe(true);
  });

  it('LANG-SM-9: a command in the lower bound behaves the same way', () => {
    const fig = figure();
    const r = checkedOk('k = 3 in -Distance(A, B)..20', fig);
    expect(r.free).toBe(true);
    applyOk(fig, 'k = 3 in -Distance(A, B)..20');
    expect(fig.lookup('k')?.free).toBe(true);
    expect(fig.lookup('k')?.slider).toBe(true);
  });

  it('LANG-SM-9: after such a slider is made, its range can be changed', () => {
    const fig = figure();
    applyOk(fig, 'k = 3 in 0..Distance(A, B)');
    const r = checkedOk('k in 0..20', fig);
    expect(r.op).toBe('rerange');
  });

  it('LANG-SM-9: a point with a showIf rule that calls a command is free and stays draggable', () => {
    const fig = figure();
    const r = checkedOk('P = (1, 2) with showIf = Distance(A, B) > 1', fig);
    expect(r.free).toBe(true);
    applyOk(fig, 'P = (1, 2) with showIf = Distance(A, B) > 1');
    expect(fig.lookup('P')?.free).toBe(true);
  });

  it('LANG-SM-9: a command in the value itself still makes the object dependent', () => {
    const fig = figure();
    expect(checkedOk('d = Distance(A, B)', fig).free).toBe(false);
    expect(checkedOk('d = Distance(A, B) with opacity = 0.5', fig).free).toBe(false);
    expect(checkedOk('d = 3 + Distance(A, B) in 0..20', fig).free).toBe(false);
  });

  it('LANG-SM-9: a command in a style value does not add the command inputs to the value reads', () => {
    const fig = figure();
    const r = checkedOk('a = 3 with opacity = Distance(A, B) / 10', fig);
    expect(r.reads).toEqual([]);
  });
});

describe('LANG-SM-22: list and function arithmetic follow the overflow rule of ruling Q4', () => {
  /** True when the list holds an infinity anywhere. */
  const hasInfinity = (v: unknown): boolean =>
    v !== null && typeof v === 'object' && Array.from(v as ArrayLike<number>).some((x) => x === Infinity || x === -Infinity);
  const items = (v: unknown): number[] => Array.from(v as ArrayLike<number>);

  it('LANG-SM-22: [1, 2] * 1e308 does not store an infinity made from finite numbers', () => {
    const fig = emptyFig();
    applyOk(fig, 'L = [1, 2]');
    const r = applyOk(fig, 'L2 = L * 1e308');
    if (r.defined) {
      expect(hasInfinity(fig.valueOf('L2')), 'an overflowed item must not be stored as inf').toBe(false);
    } else {
      expect(r.reason).toBe('overflow');
    }
  });

  it('LANG-SM-22: the list literal on the left gives the same answer', () => {
    const fig = emptyFig();
    const r = applyOk(fig, 'L2 = [1, 2] * 1e308');
    if (r.defined) {
      expect(hasInfinity(fig.valueOf('L2'))).toBe(false);
    } else {
      expect(r.reason).toBe('overflow');
    }
  });

  it('LANG-SM-22: every list-with-number operator guards its result', () => {
    const fig = emptyFig();
    applyOk(fig, 'big = 1e308');
    applyOk(fig, 'M = [1, 1e308]');
    applyOk(fig, 'N = [1, -1e308]');
    applyOk(fig, 'T = [1, 2]');
    const cases: [string, string][] = [
      ['plus', 'R = M + big'],
      ['minus', 'R = N - big'],
      ['times', 'R = M * 10'],
      ['divide', 'R = T / 1e-320'],
    ];
    for (const [what, line] of cases) {
      const r = applyOk(fig, line);
      if (r.defined) {
        expect(hasInfinity(fig.valueOf('R')), `${what}: ${line} stored an infinity`).toBe(false);
      } else {
        expect(r.reason, `${what}: ${line}`).toBe('overflow');
      }
    }
  });

  it('LANG-SM-22: the single-number line gives overflow, and the list agrees with it', () => {
    const fig = emptyFig();
    applyOk(fig, 'm = 1e308');
    const single = applyOk(fig, 'q = m + m');
    expect(single.defined).toBe(false);
    expect(single.reason).toBe('overflow');
    applyOk(fig, 'T = [m, 1]');
    const list = applyOk(fig, 'T2 = T + m');
    if (list.defined) {
      expect(hasInfinity(fig.valueOf('T2'))).toBe(false);
    } else {
      expect(list.reason).toBe('overflow');
    }
  });

  it('LANG-SM-22: an infinity that follows from an infinite input stays a value in a list', () => {
    const fig = emptyFig();
    applyOk(fig, 'big = inf');
    applyOk(fig, 'L = [1, 2]');
    const r = applyOk(fig, 'L3 = L * big');
    expect(r.defined).toBe(true);
    expect(items(fig.valueOf('L3'))).toEqual([Infinity, Infinity]);
    const s = applyOk(fig, 'L4 = L + big');
    expect(s.defined).toBe(true);
    expect(items(fig.valueOf('L4'))).toEqual([Infinity, Infinity]);
  });

  it('LANG-SM-22: ordinary list arithmetic is unchanged', () => {
    const fig = emptyFig();
    applyOk(fig, 'L = [1, 2]');
    expect(applyOk(fig, 'L5 = L * 3').defined).toBe(true);
    expect(items(fig.valueOf('L5'))).toEqual([3, 6]);
    expect(applyOk(fig, 'L6 = L + 1').defined).toBe(true);
    expect(items(fig.valueOf('L6'))).toEqual([2, 3]);
  });

  it('LANG-SM-22: a product of two functions that overflows gives overflow, as the same product written by hand', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = x');
    const byHand = applyOk(fig, 'byhand = f(1e200) * f(1e200)');
    expect(byHand.defined).toBe(false);
    expect(byHand.reason).toBe('overflow');
    applyOk(fig, 'g = f * f');
    const viaFunction = applyOk(fig, 'h = g(1e200)');
    expect(viaFunction.defined).toBe(false);
    expect(viaFunction.reason).toBe('overflow');
  });

  it('LANG-SM-22: a power of a function that overflows gives overflow', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = x');
    applyOk(fig, 'g3 = f^2');
    const r = applyOk(fig, 'h3 = g3(1e200)');
    expect(r.defined).toBe(false);
    expect(r.reason).toBe('overflow');
  });

  it('LANG-SM-22: the other function operators overflow the same way', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = x');
    applyOk(fig, 'k(x) = 1e308');
    applyOk(fig, 'gs = f + k');
    const sum = applyOk(fig, 'hs = gs(1e308)');
    expect(sum.defined).toBe(false);
    expect(sum.reason).toBe('overflow');
    applyOk(fig, 'gd = f - k');
    const diff = applyOk(fig, 'hd = gd(-1e308)');
    expect(diff.defined).toBe(false);
    expect(diff.reason).toBe('overflow');
  });

  it('LANG-SM-22: a function of an infinite input still gives an infinite result', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = x');
    applyOk(fig, 'big = inf');
    applyOk(fig, 'g = f * f');
    const r = applyOk(fig, 'h = g(big)');
    expect(r.defined).toBe(true);
    expect(fig.valueOf('h')).toBe(Infinity);
    applyOk(fig, 'g3 = f^2');
    const s = applyOk(fig, 'h3 = g3(big)');
    expect(s.defined).toBe(true);
    expect(fig.valueOf('h3')).toBe(Infinity);
  });

  it('LANG-SM-22: ordinary function arithmetic is unchanged', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = x');
    applyOk(fig, 'g = f * f');
    expect(applyOk(fig, 'h = g(3)').defined).toBe(true);
    expect(fig.valueOf('h')).toBe(9);
    applyOk(fig, 'g3 = f^2');
    expect(applyOk(fig, 'h3 = g3(4)').defined).toBe(true);
    expect(fig.valueOf('h3')).toBe(16);
  });
});

describe('LANG-SM-23: a slider range may not read the slider or anything downstream of it (ruling SM-23)', () => {
  function figure(): ScratchFigure {
    const fig = emptyFig();
    applyOk(fig, 'a = 3 in 0..20');
    applyOk(fig, 'b = a + 1');
    return fig;
  }

  function expectCycle(src: string, fig: ScratchFigure, through: readonly string[]): void {
    const r = fig.apply(src);
    expect(r.ok, `${src} must be refused`).toBe(false);
    const e = errOf(r, `for "${src}"`);
    expect(e.kind, `${src}`).toBe('cycle');
    for (const name of through) expect(JSON.stringify([e.path, e.related, e.message]), `${src} path names ${name}`).toContain(name);
    expect(e.path, `${src} gives a path`).toBeDefined();
    expect((e.path ?? []).length).toBeGreaterThanOrEqual(2);
  }

  it('LANG-SM-23: a = 3 in 0..b is a cycle with a path', () => {
    expectCycle('a = 3 in 0..b', figure(), ['a', 'b']);
  });

  it('LANG-SM-23: changing the range of a with a in 0..b is a cycle too', () => {
    expectCycle('a in 0..b', figure(), ['a', 'b']);
  });

  it('LANG-SM-23: the lower bound counts as well', () => {
    expectCycle('a in b..30', figure(), ['a', 'b']);
  });

  it('LANG-SM-23: a range that reads the slider itself is a cycle', () => {
    expectCycle('a = 3 in 0..a', figure(), ['a']);
    expectCycle('a in 0..a', figure(), ['a']);
    expectCycle('a in 0..a + 1', figure(), ['a']);
  });

  it('LANG-SM-23: a longer chain of dependents is found, and the path shows the chain', () => {
    const fig = figure();
    applyOk(fig, 'c = b * 2');
    applyOk(fig, 'd = c - 1');
    expectCycle('a in 0..d', fig, ['a', 'b', 'c', 'd']);
  });

  it('LANG-SM-23: a refused range leaves the slider as it was', () => {
    const fig = figure();
    expect(fig.apply('a in 0..b').ok).toBe(false);
    expect(fig.apply('a = 3 in 0..b').ok).toBe(false);
    expect(fig.lookup('a')?.free).toBe(true);
    expect(fig.lookup('a')?.slider).toBe(true);
    expect(fig.valueOf('a')).toBe(3);
    expect(fig.valueOf('b')).toBe(4);
    expect(fig.apply('a in 0..30').ok).toBe(true);
  });

  it('LANG-SM-23: a style value that reads a dependent of the object is not a cycle (ruling SM-23: only range edges join the test)', () => {
    const fig = figure();
    const r = fig.apply('a = 3 with opacity = b / 10');
    expect(r.ok, r.ok ? '' : `${errOf(r).kind}: ${errOf(r).message}`).toBe(true);
    expect(fig.lookup('a')?.free).toBe(true);
  });

  it('LANG-SM-23: a range cycle is still a cycle when the same line also has a style', () => {
    expectCycle('a = 3 in 0..b with opacity = 0.5', figure(), ['a', 'b']);
  });

  it('LANG-SM-23: a range that reads something that does not depend on the slider is accepted', () => {
    const fig = figure();
    applyOk(fig, 'n = 10');
    applyOk(fig, 'u = n + 1');
    expect(fig.apply('a in 0..n').ok).toBe(true);
    expect(fig.apply('a = 3 in 0..u').ok).toBe(true);
    expect(fig.apply('a in n..30').ok).toBe(true);
    expect(fig.lookup('a')?.free).toBe(true);
    expect(fig.lookup('a')?.slider).toBe(true);
  });

  it('LANG-SM-23: a new slider whose range reads an existing object is accepted', () => {
    const fig = figure();
    expect(fig.apply('s2 = 1 in 0..b').ok).toBe(true);
    expect(fig.lookup('s2')?.free).toBe(true);
  });

  it('LANG-SM-23: a new name that reads itself in its range is refused (cycle or unknown name)', () => {
    const fig = emptyFig();
    const r = fig.apply('zz = 3 in 0..zz');
    expect(r.ok).toBe(false);
    expect(['cycle', 'unknown_name']).toContain(errOf(r).kind);
  });
});

describe('LANG-SM-24: a #rrggbb colour after = is a value for the normaliser, the splitter and the lexer', () => {
  function figure(): ScratchFigure {
    const fig = emptyFig();
    applyOk(fig, 'P = (1, 2)');
    return fig;
  }

  it('LANG-SM-24: a colour followed by a property with a Unicode minus is accepted', () => {
    const fig = figure();
    const r = analyseLine('P with color = #ff0000, opacity = 1 − 0.5', fig);
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    expect(r.value.op).toBe('restyle');
  });

  it('LANG-SM-24: the colour last is accepted (control), and the colour first gives the same answer', () => {
    const fig = figure();
    expect(analyseLine('P with opacity = 1 − 0.5, color = #ff0000', fig).ok).toBe(true);
    expect(analyseLine('P with color = #ff0000, opacity = 1 − 0.5', fig).ok).toBe(true);
  });

  it('LANG-SM-24: a definition with a colour and a later Unicode minus is accepted', () => {
    const fig = figure();
    const r = fig.apply('Q = (3, 4) with color = #ff0000, opacity = 1 − 0.5');
    expect(r.ok, r.ok ? '' : `${r.kind}: ${r.message}`).toBe(true);
  });

  it('LANG-SM-24: a Unicode minus after the colour is not reported as bad_character, for every colour length', () => {
    const fig = figure();
    for (const colour of ['#f00', '#f00f', '#ff0000', '#ff000080']) {
      const src = `P with color = ${colour}, opacity = 1 − 0.5`;
      const r = analyseLine(src, fig);
      expect(r.ok, `${src}: ${r.ok ? '' : `${r.kind}: ${r.message}`}`).toBe(true);
    }
  });

  it('LANG-SM-24: a colour, then several properties with a Unicode minus', () => {
    const fig = figure();
    const r = analyseLine('P with color = #ff0000, opacity = 1 − 0.5, pointSize = 3 − 1', fig);
    expect(r.ok, r.ok ? '' : `${r.kind}: ${r.message}`).toBe(true);
  });

  it('LANG-SM-24: a continuation line after a colour joins the line', () => {
    const lines = splitLogicalLines('P = (1, 2) with color = #ff0000, opacity = (1 +\n 2) / 4\nQ = (1, 1)');
    expect(lines.length).toBe(2);
    expect(lines[0]!.firstLine).toBe(1);
    expect(lines[0]!.lineCount).toBe(2);
    expect(lines[1]!.firstLine).toBe(3);
    expect(lines[1]!.text).toBe('Q = (1, 1)');
  });

  it('LANG-SM-24: parseProgram gives two good entries for that script and no bracket error', () => {
    const out = parseProgram('P = (1, 2) with color = #ff0000, opacity = (1 +\n 2) / 4\nQ = (1, 1)');
    expect(out.map((o) => o.line)).toEqual([1, 3]);
    for (const o of out) expect(o.result.ok, o.result.ok ? '' : `${errOf(o.result).kind}: ${errOf(o.result).message}`).toBe(true);
  });

  it('LANG-SM-24: a colour on a later physical line of a continued line also works', () => {
    const out = parseProgram('P = (1,\n 2) with color = #00ff00, opacity = 1 − 0.5\nQ = (1, 1)');
    for (const o of out) expect(o.result.ok, o.result.ok ? '' : `line ${o.line}: ${errOf(o.result).kind}`).toBe(true);
    expect(out.map((o) => o.line)).toEqual([1, 3]);
  });

  it('LANG-SM-24: a # that does not follow = is still a comment', () => {
    const fig = figure();
    expect(analyseLine('a9 = 3 #ff0000 − (', fig).ok).toBe(true);
    expect(analyseLine('a9 = 3 # note − (', fig).ok).toBe(true);
    const lines = splitLogicalLines('a9 = 3 #ff0000 (\nB9 = (1, 2)');
    expect(lines.length).toBe(2);
  });

  it('LANG-SM-24: a comment after a colour stays a comment', () => {
    const fig = figure();
    const r = analyseLine('P with color = #ff0000 # a red point (', fig);
    expect(r.ok, r.ok ? '' : `${r.kind}: ${r.message}`).toBe(true);
    const lines = splitLogicalLines('P with color = #ff0000 # a red point (\nQ = (1, 1)');
    expect(lines.length).toBe(2);
  });

  it('LANG-SM-24: tokenize reports no error for a colour followed by a Unicode minus', () => {
    const { errors } = tokenize('P with color = #ff0000, opacity = 1 − 0.5', figure());
    expect(errors).toEqual([]);
  });

  it('LANG-SM-24: completion on a continuation line after a colour does not offer start-of-line snippets', () => {
    const fig = figure();
    const src = 'P with color = #ff0000, opacity = (1 +\n  ';
    const got = complete(src, src.length, fig);
    expect(got.length).toBeGreaterThan(0);
    expect(got.filter((c) => c.kind === 'snippet')).toEqual([]);
    expect(got.map((c) => c.label)).not.toContain('@');
    expect(got.map((c) => c.label)).not.toContain('#');
    expect(got.some((c) => c.kind === 'object' || c.kind === 'function' || c.kind === 'constant')).toBe(true);
  });

  it('LANG-SM-24: the offers after a colour match the offers without it (control)', () => {
    const fig = figure();
    const withColour = 'P with color = #ff0000, opacity = (1 +\n  ';
    const without = 'P with opacity = (1 +\n  ';
    const kinds = (s: string): string[] => [...new Set(complete(s, s.length, fig).map((c) => c.kind))].sort();
    expect(kinds(withColour)).toEqual(kinds(without));
  });
});

// ---------------------------------------------------------------------------------------------
// Round 3: LANG-SM-24 (reopened), LANG-SM-25, LANG-SM-26, LANG-SM-27
// ---------------------------------------------------------------------------------------------

describe('LANG-SM-27: style edges never form a cycle (ruling SM-23, kernel design 9.2)', () => {
  function figure(): ScratchFigure {
    const fig = emptyFig();
    applyOk(fig, 'P = (1, 2)');
    applyOk(fig, 'Q = (P.x + 1, P.y)');
    applyOk(fig, 'a = 3 in 0..20');
    applyOk(fig, 'b = a + 1');
    return fig;
  }

  function accepted(src: string, fig: ScratchFigure): void {
    const c = analyseLine(src, fig);
    expect(c.ok, c.ok ? '' : `analyseLine ${src}: ${errOf(c).kind}: ${errOf(c).message}`).toBe(true);
    const r = fig.apply(src);
    expect(r.ok, r.ok ? '' : `${src}: ${errOf(r).kind}: ${errOf(r).message}`).toBe(true);
  }

  it('LANG-SM-27: P with showIf = P.x > 0 is accepted', () => {
    accepted('P with showIf = P.x > 0', figure());
  });

  it('LANG-SM-27: P with opacity = if(P.x > 0, 1, 0.5) is accepted', () => {
    accepted('P with opacity = if(P.x > 0, 1, 0.5)', figure());
  });

  it('LANG-SM-27: P = (1, 2) with showIf = P.x > 0 is accepted (a definition that styles itself)', () => {
    accepted('P = (1, 2) with showIf = P.x > 0', figure());
  });

  it('LANG-SM-27: P with showIf = Q.x > 0, with Q reading P, is accepted', () => {
    accepted('P with showIf = Q.x > 0', figure());
  });

  it('LANG-SM-27: P = (1, 2) with opacity = Q.x / 10, with Q reading P, is accepted', () => {
    accepted('P = (1, 2) with opacity = Q.x / 10', figure());
  });

  it('LANG-SM-27: a = 3 in 0..20 with opacity = a / 20 is accepted (a slider that fades with its own value)', () => {
    const fig = figure();
    accepted('a = 3 in 0..20 with opacity = a / 20', fig);
    expect(fig.lookup('a')?.slider).toBe(true);
    expect(fig.lookup('a')?.free).toBe(true);
  });

  it('LANG-SM-27: a with opacity = a / 20 is accepted on an existing slider', () => {
    accepted('a with opacity = a / 20', figure());
  });

  it('LANG-SM-27: a style that reads a dependent of its object is accepted (slider and value)', () => {
    accepted('a with opacity = b / 20', figure());
    accepted('a = 3 in 0..20 with opacity = b / 20', figure());
  });

  it('LANG-SM-27: a style that reads its own object leaves the object free (only value edges decide)', () => {
    const fig = figure();
    accepted('P with showIf = P.x > 0', fig);
    expect(fig.lookup('P')?.free).toBe(true);
    accepted('P with showIf = Q.x > 0', fig);
    expect(fig.lookup('P')?.free).toBe(true);
  });

  it('LANG-SM-27: the checked line keeps style reads out of the value reads', () => {
    const c = analyseLine('P = (1, 2) with showIf = Q.x > 0', figure());
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.value.reads).toEqual([]);
  });

  it('LANG-SM-27: range cycles are still cycles (control)', () => {
    const fig = figure();
    for (const src of ['a = 3 in 0..a', 'a = 3 in 0..b', 'a in 0..b', 'a in b..30', 'a in 0..a + 1']) {
      const r = fig.apply(src);
      expect(r.ok, `${src} must be refused`).toBe(false);
      expect(errOf(r, src).kind, src).toBe('cycle');
    }
  });

  it('LANG-SM-27: value cycles are still cycles (control)', () => {
    const fig = figure();
    const r = fig.apply('P = (Q.x, 1)');
    expect(r.ok).toBe(false);
    expect(errOf(r).kind).toBe('cycle');
    const s = fig.apply('a = b + 1');
    expect(s.ok).toBe(false);
    expect(errOf(s).kind).toBe('cycle');
  });

  it('LANG-SM-27: a style on the slider does not change the range cycle answer', () => {
    const fig = figure();
    expect(errOf(fig.apply('a in 0..b')).kind).toBe('cycle');
    accepted('a with opacity = a / 20', fig);
    expect(errOf(fig.apply('a in 0..b')).kind).toBe('cycle');
  });
});

describe('LANG-SM-24 (reopened): a #rrggbb colour after = and any blank between them', () => {
  const BLANKS: [string, string][] = [
    ['plain space', ' '],
    ['tab', '\t'],
    ['U+00A0 no-break space', '\u00A0'],
    ['U+2009 thin space', '\u2009'],
    ['U+202F narrow no-break space', '\u202F'],
    ['U+2003 em space', '\u2003'],
    ['U+2002 en space', '\u2002'],
  ];

  function figure(): ScratchFigure {
    const fig = emptyFig();
    applyOk(fig, 'P = (1, 2)');
    return fig;
  }

  function good(src: string, fig: ScratchFigure): void {
    const r = analyseLine(src, fig);
    expect(r.ok, r.ok ? '' : `${JSON.stringify(src)}: ${errOf(r).kind}: ${errOf(r).message}`).toBe(true);
  }

  describe.each(BLANKS)('%s between = and #', (what, blank) => {
    it(`LANG-SM-24: ${what}: a property with a Unicode minus after the colour is accepted`, () => {
      const fig = figure();
      good(`P with color =${blank}#ff0000, opacity = 1 − 0.5`, fig);
      good(`P with color =${blank}#f00, opacity = 1 − 0.5`, fig);
      good(`P with color =${blank}#ff000080, opacity = 1 − 0.5, pointSize = 3 − 1`, fig);
    });

    it(`LANG-SM-24: ${what}: a definition with the colour first and a Unicode minus later is accepted`, () => {
      const fig = figure();
      const r = fig.apply(`Q = (3, 4) with color =${blank}#ff0000, opacity = 1 − 0.5`);
      expect(r.ok, r.ok ? '' : `${errOf(r).kind}: ${errOf(r).message}`).toBe(true);
    });

    it(`LANG-SM-24: ${what}: the colour last is accepted as well`, () => {
      good(`P with opacity = 1 − 0.5, color =${blank}#ff0000`, figure());
    });

    it(`LANG-SM-24: ${what}: a continuation line after the colour joins the line`, () => {
      const lines = splitLogicalLines(`P = (1, 2) with color =${blank}#ff0000, opacity = (1 +\n 2) / 4\nQ = (1, 1)`);
      expect(lines.length).toBe(2);
      expect(lines[0]!.firstLine).toBe(1);
      expect(lines[0]!.lineCount).toBe(2);
      expect(lines[1]!.firstLine).toBe(3);
      expect(lines[1]!.text).toBe('Q = (1, 1)');
    });

    it(`LANG-SM-24: ${what}: parseProgram gives two good entries and no bracket error`, () => {
      const out = parseProgram(`P = (1, 2) with color =${blank}#ff0000, opacity = (1 +\n 2) / 4\nQ = (1, 1)`);
      expect(out.map((o) => o.line)).toEqual([1, 3]);
      for (const o of out) expect(o.result.ok, o.result.ok ? '' : `${errOf(o.result).kind}: ${errOf(o.result).message}`).toBe(true);
    });

    it(`LANG-SM-24: ${what}: tokenize reports no error and agrees with the plain-space line`, () => {
      const fig = figure();
      const plain = tokenize('P with color = #ff0000, opacity = 1 − 0.5', fig);
      const got = tokenize(`P with color =${blank}#ff0000, opacity = 1 − 0.5`, fig);
      expect(got.errors).toEqual([]);
      expect(plain.errors).toEqual([]);
      expect(got.tokens.map((t) => t.kind)).toEqual(plain.tokens.map((t) => t.kind));
    });

    it(`LANG-SM-24: ${what}: completion on the continuation line offers what it offers without the colour`, () => {
      const fig = figure();
      const src = `P with color =${blank}#ff0000, opacity = (1 +\n  `;
      const got = complete(src, src.length, fig);
      expect(got.length).toBeGreaterThan(0);
      expect(got.filter((c) => c.kind === 'snippet')).toEqual([]);
      expect(got.map((c) => c.label)).not.toContain('@');
      expect(got.map((c) => c.label)).not.toContain('#');
      const kinds = (s: string): string[] => [...new Set(complete(s, s.length, fig).map((c) => c.kind))].sort();
      expect(kinds(src)).toEqual(kinds('P with opacity = (1 +\n  '));
    });

    it(`LANG-SM-24: ${what}: a comment after the colour stays a comment`, () => {
      good(`P with color =${blank}#ff0000 # a red point (`, figure());
      expect(splitLogicalLines(`P with color =${blank}#ff0000 # a red point (\nQ = (1, 1)`).length).toBe(2);
    });
  });

  it('LANG-SM-24: a # that follows a blank after a value is still a comment', () => {
    const fig = figure();
    for (const [, blank] of BLANKS) {
      good(`a9 =${blank}3 # note − (`, fig);
      expect(splitLogicalLines(`a9 = 3${blank}# (\nB9 = (1, 2)`).length).toBe(2);
    }
  });

  it('LANG-SM-24: normaliser, splitter, tokenize and completion agree for every blank and every colour length', () => {
    const fig = figure();
    for (const [what, blank] of BLANKS) {
      for (const colour of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) {
        const one = `P with color =${blank}${colour}, opacity = 1 − 0.5`;
        good(one, fig);
        expect(tokenize(one, fig).errors, `${what} ${colour}`).toEqual([]);
        const two = `P with color =${blank}${colour}, opacity = (1 +\n  2) / 4\nQ = (1, 1)`;
        expect(splitLogicalLines(two).length, `${what} ${colour}`).toBe(2);
        const open = `P with color =${blank}${colour}, opacity = (1 +\n  `;
        expect(complete(open, open.length, fig).filter((c) => c.kind === 'snippet'), `${what} ${colour}`).toEqual([]);
      }
    }
  });
});

describe('LANG-SM-25 and LANG-SM-26: numeric failures are the same on every value kind', () => {
  type Want = { readonly undef: string } | { readonly inf: true };

  interface Row {
    readonly id: 'LANG-SM-25' | 'LANG-SM-26';
    readonly kind: 'Number' | 'List' | 'Function' | 'Point' | 'Vector';
    readonly what: string;
    /** Lines applied after the shared set-up; the last one is the one that is judged. */
    readonly lines: readonly string[];
    readonly want: Want;
  }

  const SETUP = [
    'f(x) = x',
    'k(x) = 1e308',
    'w(x) = 0 * x',
    'big = inf',
    'un = undefined',
    'L = [1, 2]',
    'M = [1e308, 1]',
    'V = (1, 1) - (0, 0)',
    'VB = (1e308, 0) - (0, 0)',
    'NVB = -VB',
    'P = (1, 2)',
    'PB = (1e308, 0)',
  ];

  const undef = (reason: string): Want => ({ undef: reason });
  const INF: Want = { inf: true };
  const DZ = undef('division_by_zero');
  const OV = undef('overflow');
  const NF = undef('not_finite');
  const IU = undef('input_undefined');

  const row = (id: Row['id'], kind: Row['kind'], what: string, lines: string[], want: Want): Row => ({ id, kind, what, lines, want });

  const ROWS: readonly Row[] = [
    // Division by zero
    row('LANG-SM-25', 'Number', '1 / 0', ['out = 1 / 0'], DZ),
    row('LANG-SM-25', 'Number', '0 / 0', ['out = 0 / 0'], DZ),
    row('LANG-SM-25', 'Number', '0 ^ -1', ['out = 0 ^ -1'], DZ),
    row('LANG-SM-25', 'List', 'L / 0', ['out = L / 0'], DZ),
    row('LANG-SM-25', 'List', '[0, 5] / 0', ['out = [0, 5] / 0'], DZ),
    row('LANG-SM-25', 'List', 'L / (1 - 1)', ['out = L / (1 - 1)'], DZ),
    row('LANG-SM-25', 'Function', 'f / 0 at 1', ['q = f / 0', 'out = q(1)'], DZ),
    row('LANG-SM-25', 'Function', 'f / w at 0', ['q = f / w', 'out = q(0)'], DZ),
    row('LANG-SM-25', 'Function', 'f / w at 1', ['q = f / w', 'out = q(1)'], DZ),
    row('LANG-SM-25', 'Function', 'f ^ -1 at 0', ['q = f ^ -1', 'out = q(0)'], DZ),
    row('LANG-SM-25', 'Vector', 'V / 0', ['out = V / 0'], DZ),
    row('LANG-SM-25', 'Vector', 'V / (1 - 1)', ['out = V / (1 - 1)'], DZ),
    row('LANG-SM-25', 'Point', 'P + V / 0', ['out = P + V / 0'], DZ),
    row('LANG-SM-25', 'Point', 'P - V / 0', ['out = P - V / 0'], DZ),

    // Finite overflow (LANG-SM-22 for lists and functions, LANG-SM-26 for points and vectors)
    row('LANG-SM-26', 'Number', '1e308 * 10', ['out = 1e308 * 10'], OV),
    row('LANG-SM-26', 'Number', '10 ^ 400', ['out = 10 ^ 400'], OV),
    row('LANG-SM-26', 'List', 'M * 10', ['out = M * 10'], OV),
    row('LANG-SM-26', 'List', 'M + 1e308', ['out = M + 1e308'], OV),
    row('LANG-SM-26', 'List', 'L / 1e-320', ['out = L / 1e-320'], OV),
    row('LANG-SM-26', 'Function', 'f * f at 1e200', ['q = f * f', 'out = q(1e200)'], OV),
    row('LANG-SM-26', 'Function', 'f ^ 2 at 1e200', ['q = f ^ 2', 'out = q(1e200)'], OV),
    row('LANG-SM-26', 'Function', 'f + k at 1e308', ['q = f + k', 'out = q(1e308)'], OV),
    row('LANG-SM-26', 'Vector', 'VB * 10', ['out = VB * 10'], OV),
    row('LANG-SM-26', 'Vector', '10 * VB', ['out = 10 * VB'], OV),
    row('LANG-SM-26', 'Vector', 'VB / 1e-10', ['out = VB / 1e-10'], OV),
    row('LANG-SM-26', 'Vector', 'VB + VB', ['out = VB + VB'], OV),
    row('LANG-SM-26', 'Vector', 'VB - NVB', ['out = VB - NVB'], OV),
    row('LANG-SM-26', 'Vector', 'PB - (-1e308, 0)', ['out = PB - (-1e308, 0)'], OV),
    row('LANG-SM-26', 'Point', 'PB + VB', ['out = PB + VB'], OV),
    row('LANG-SM-26', 'Point', 'PB - NVB', ['out = PB - NVB'], OV),

    // An infinite input may give an infinite result (ruling Q4)
    row('LANG-SM-26', 'Number', 'big * 2', ['out = big * 2'], INF),
    row('LANG-SM-26', 'List', 'L * big', ['out = L * big'], INF),
    row('LANG-SM-26', 'Function', 'f * f at big', ['q = f * f', 'out = q(big)'], INF),
    row('LANG-SM-26', 'Vector', 'V * big', ['out = V * big'], INF),
    row('LANG-SM-26', 'Point', 'P + V * big', ['out = P + V * big'], INF),

    // inf - inf
    row('LANG-SM-26', 'Number', 'big - big', ['out = big - big'], NF),
    row('LANG-SM-26', 'List', 'L * big - big', ['out = L * big - big'], NF),
    row('LANG-SM-26', 'Function', 'f - f at big', ['q = f - f', 'out = q(big)'], NF),
    row('LANG-SM-26', 'Vector', 'V * big - V * big', ['out = V * big - V * big'], NF),
    row('LANG-SM-26', 'Point', 'P + V * big - V * big', ['out = P + V * big - V * big'], NF),

    // An undefined input
    row('LANG-SM-25', 'Number', 'un + 1', ['out = un + 1'], IU),
    row('LANG-SM-25', 'List', 'L + un', ['out = L + un'], IU),
    row('LANG-SM-25', 'List', 'an undefined list, plus 1', ['Lu = L * un', 'out = Lu + 1'], IU),
    row('LANG-SM-25', 'Function', 'f * f at un', ['q = f * f', 'out = q(un)'], IU),
    row('LANG-SM-25', 'Vector', 'V * un', ['out = V * un'], IU),
    row('LANG-SM-25', 'Vector', 'an undefined vector, plus V', ['Vu = V * un', 'out = Vu + V'], IU),
    row('LANG-SM-25', 'Point', 'P + V * un', ['out = P + V * un'], IU),
    row('LANG-SM-25', 'Point', 'an undefined point, plus V', ['Pu = P + V * un', 'out = Pu + V'], IU),
  ];

  /** Every number held by a stored value (a Number, a list, a point or a vector). */
  function parts(v: unknown): number[] {
    if (typeof v === 'number') return [v];
    if (v !== null && typeof v === 'object') {
      if (typeof (v as ArrayLike<number>).length === 'number') return Array.from(v as ArrayLike<number>).flatMap((x) => parts(x));
      const o = v as { x?: unknown; y?: unknown };
      if ('x' in o && 'y' in o) return [...parts(o.x), ...parts(o.y)];
    }
    return [];
  }

  function run(r: Row) {
    const fig = emptyFig();
    for (const line of SETUP) applyOk(fig, line);
    let last = applyOk(fig, r.lines[0]!);
    for (const line of r.lines.slice(1)) last = applyOk(fig, line);
    return { fig, last };
  }

  it.each(ROWS.map((r) => [`${r.id}: ${r.kind}: ${r.what}`, r] as const))('%s', (_title, r) => {
    const { fig, last } = run(r);
    // A value is undefined exactly when its reason is set.
    expect(last.defined, `${r.what}: defined and reason must agree (${last.summary})`).toBe(last.reason === undefined);
    if ('undef' in r.want) {
      expect(last.defined, `${r.what} must be undefined, got ${last.summary}`).toBe(false);
      expect(last.reason, `${r.what}: ${last.summary}`).toBe(r.want.undef);
    } else if (last.defined) {
      const ps = parts(fig.valueOf(last.name));
      expect(ps.length, `${r.what}: the stored value has numbers`).toBeGreaterThan(0);
      expect(ps.some((x) => Number.isNaN(x)), `${r.what}: a defined value has no undefined part`).toBe(false);
      expect(ps.some((x) => x === Infinity || x === -Infinity), `${r.what}: ${last.summary}`).toBe(true);
    } else {
      expect(['overflow', 'division_by_zero'], `${r.what}: an infinite input must not give ${String(last.reason)}`).not.toContain(last.reason);
    }
    // A list, point or vector with an undefined part is never a defined value.
    if (last.defined) {
      expect(parts(fig.valueOf(last.name)).some((x) => Number.isNaN(x)), `${r.what}: defined value with an undefined part`).toBe(false);
    }
  });

  it('LANG-SM-25: a list divided by zero is not stored as a defined list, and feeds nothing defined', () => {
    const fig = emptyFig();
    applyOk(fig, 'L = [1, 2]');
    const r = applyOk(fig, 'L5 = L / 0');
    expect(r.defined).toBe(false);
    expect(r.reason).toBe('division_by_zero');
    const s = applyOk(fig, 'L6 = L5 + 1');
    expect(s.defined).toBe(false);
    expect(s.reason).toBe('input_undefined');
  });

  it('LANG-SM-25: Number, List and Function agree on the reason for a division by zero', () => {
    const fig = emptyFig();
    applyOk(fig, 'f(x) = x');
    applyOk(fig, 'L = [1, 2]');
    applyOk(fig, 'q = f / 0');
    const reasons = [applyOk(fig, 'n1 = 1 / 0').reason, applyOk(fig, 'l1 = L / 0').reason, applyOk(fig, 'fq = q(1)').reason];
    expect(reasons).toEqual(['division_by_zero', 'division_by_zero', 'division_by_zero']);
  });

  it('LANG-SM-26: an overflowing point or vector is undefined overflow, never a defined (inf, 0)', () => {
    const fig = emptyFig();
    applyOk(fig, 'VB = (1e308, 0) - (0, 0)');
    applyOk(fig, 'NVB = -VB');
    for (const line of ['V1 = VB * 10', 'V2 = 10 * VB', 'V3 = VB / 1e-10', 'V4 = VB + VB', 'P1 = (1e308, 0) + VB', 'P2 = (1e308, 0) - NVB']) {
      const r = applyOk(fig, line);
      expect(r.defined, `${line}: ${r.summary}`).toBe(false);
      expect(r.reason, line).toBe('overflow');
    }
  });

  it('LANG-SM-26: the Number line and the vector line agree on overflow', () => {
    const fig = emptyFig();
    applyOk(fig, 'VB = (1e308, 0) - (0, 0)');
    const n = applyOk(fig, 'n1 = 1e308 * 10');
    const v = applyOk(fig, 'v1 = VB * 10');
    expect(n.reason).toBe('overflow');
    expect(v.reason).toBe(n.reason);
  });

  it('LANG-SM-26: ordinary list, function, point and vector arithmetic is unchanged', () => {
    const fig = emptyFig();
    for (const line of ['f(x) = x', 'L = [1, 2]', 'V = (1, 1) - (0, 0)', 'P = (1, 2)']) applyOk(fig, line);
    expect(applyOk(fig, 'a1 = L / 2').defined).toBe(true);
    expect(Array.from(fig.valueOf('a1') as ArrayLike<number>)).toEqual([0.5, 1]);
    applyOk(fig, 'q = f * f');
    expect(applyOk(fig, 'a2 = q(3)').defined).toBe(true);
    expect(fig.valueOf('a2')).toBe(9);
    expect(applyOk(fig, 'a3 = V * 3').defined).toBe(true);
    expect(fig.valueOf('a3')).toEqual({ x: 3, y: 3 });
    expect(applyOk(fig, 'a4 = P + V').defined).toBe(true);
    expect(fig.valueOf('a4')).toEqual({ x: 2, y: 3 });
  });
});

// =============================================================================================
// Round 5: LANG-SM-28 to LANG-SM-32 and the ruling Q-R4-1 (option a)
// =============================================================================================

describe('LANG-SM-28: comparisons with an infinity (design 3.5 tolerance is for finite numbers)', () => {
  // Readings where the docs are silent (also in handoff/language/test-report.md, "Round 5"):
  // - An infinite side is compared exactly: inf equals inf, nothing else equals an infinity, and the
  //   order operators follow the real order (-inf < every finite number < inf).
  // - Design 3.10's operator table has `== !=` for Number, Bool, Text, Point and Vector, and
  //   `< <= > >=` for Number only. Lists, functions and points with `<` have no row, so they stay
  //   type_mismatch, which is also the answer for an infinite list.
  const SETUP = [
    'big = inf',
    'L = [1, 2]',
    'Lb = L * big',
    'f(x) = x',
    'P = (1, 2)',
    'Pi = (big, 0)',
    'Pn = (-big, 0)',
    'V = (1, 1) - (0, 0)',
    'Vi = (big, 0) - (0, 0)',
    'Vn = (-big, 0) - (0, 0)',
  ];

  function figure(): ScratchFigure {
    const fig = emptyFig();
    for (const line of SETUP) applyOk(fig, line);
    return fig;
  }

  /** Evaluate `out = <expr>` on a fresh figure; the value is a boolean (or the number for `if`). */
  function value(expr: string): unknown {
    const fig = figure();
    const r = applyOk(fig, `out = ${expr}`);
    expect(r.defined, `${expr}: ${r.summary}`).toBe(true);
    return fig.valueOf('out');
  }

  const OPS = ['==', '!=', '<', '<=', '>', '>='] as const;
  type Op = (typeof OPS)[number];
  const compare = (a: number, op: Op, b: number): boolean => {
    switch (op) {
      case '==':
        return a === b;
      case '!=':
        return a !== b;
      case '<':
        return a < b;
      case '<=':
        return a <= b;
      case '>':
        return a > b;
      default:
        return a >= b;
    }
  };

  const NUMBERS: readonly (readonly [string, number])[] = [
    ['5', 5],
    ['-5', -5],
    ['1e308', 1e308],
    ['-1e308', -1e308],
    ['big', Infinity],
    ['-big', -Infinity],
  ];

  describe('Number against Number, every operator and every order', () => {
    const rows: [string, string, boolean][] = [];
    for (const [sa, a] of NUMBERS) {
      for (const [sb, b] of NUMBERS) {
        for (const op of OPS) rows.push([`${sa} ${op} ${sb}`, sa, compare(a, op, b)] as [string, string, boolean]);
      }
    }
    it.each(rows.map((r) => [r[0], r[2]] as const))('LANG-SM-28: %s is %s', (expr, want) => {
      expect(value(expr)).toBe(want);
    }, 10_000);
  });

  it('LANG-SM-28: the cases named in the finding', () => {
    expect(value('5 == big')).toBe(false);
    expect(value('5 != big')).toBe(true);
    expect(value('1e308 == big')).toBe(false);
    expect(value('-big == big')).toBe(false);
    expect(value('5 == -big')).toBe(false);
    expect(value('5 >= big')).toBe(false);
    expect(value('5 <= -big')).toBe(false);
    expect(value('5 < big')).toBe(true);
    expect(value('big > 5')).toBe(true);
    expect(value('if(5 == big, 1, 2)')).toBe(2);
    expect(value('if(5 >= big, 1, 2)')).toBe(2);
    expect(value('if(5 != big, 1, 2)')).toBe(1);
  });

  it('LANG-SM-28: an infinity equals itself and nothing else', () => {
    expect(value('big == big')).toBe(true);
    expect(value('-big == -big')).toBe(true);
    expect(value('big != big')).toBe(false);
    expect(value('big == inf')).toBe(true);
    expect(value('inf == inf')).toBe(true);
    expect(value('big <= big')).toBe(true);
    expect(value('big >= big')).toBe(true);
    expect(value('big < big')).toBe(false);
    expect(value('big > big')).toBe(false);
  });

  it('LANG-SM-28: the tolerance of 3.5 is unchanged for finite numbers (control)', () => {
    expect(value('1 == 1 + 1e-13')).toBe(true);
    expect(value('0.1 + 0.2 == 0.3')).toBe(true);
    expect(value('1e308 == 1e308')).toBe(true);
    expect(value('1 == 1.001')).toBe(false);
    expect(value('1 != 1 + 1e-13')).toBe(false);
    expect(value('1 <= 1 + 1e-13')).toBe(true);
    expect(value('1 + 1e-13 >= 1')).toBe(true);
    expect(value('1e300 == 1e300 * (1 + 1e-13)')).toBe(true);
  });

  describe('a Number that comes from a function, a list, a point or a vector', () => {
    // Each source holds an infinity; the finite sources are on the other side.
    const INFINITE = [
      ['a Number object', 'big'],
      ['a function call', 'f(big)'],
      ['a list item', 'Lb[1]'],
      ['a point coordinate', 'Pi.x'],
      ['a vector coordinate', 'Vi.x'],
      ['a product', 'big * 2'],
    ] as const;
    const FINITE = ['5', 'f(5)', 'L[2]', 'P.y', 'V.x', '1e308', 'f(1e308)'] as const;

    it.each(INFINITE.map((s) => [...s] as [string, string]))('LANG-SM-28: %s', (_kind, inf) => {
      const wrong: string[] = [];
      for (const sign of ['', '-']) {
        const infinite = `${sign}(${inf})`;
        const iv = sign === '' ? Infinity : -Infinity;
        for (const fin of FINITE) {
          const fv = Number(value(`${fin} + 0`));
          for (const op of OPS) {
            for (const [lhs, rhs, want] of [
              [fin, infinite, compare(fv, op, iv)],
              [infinite, fin, compare(iv, op, fv)],
            ] as const) {
              const expr = `${lhs} ${op} ${rhs}`;
              if (value(expr) !== want) wrong.push(`${expr} should be ${want}`);
            }
          }
        }
        // The infinity against itself, from a different source.
        if (value(`${infinite} == ${sign}big`) !== true) wrong.push(`${infinite} == ${sign}big should be true`);
        if (value(`${infinite} == ${sign === '' ? '-' : ''}big`) !== false) wrong.push(`${infinite} == the opposite infinity should be false`);
      }
      expect(wrong).toEqual([]);
    }, 30_000);
  });

  describe('chained comparisons (3.5 rules: a chain of n operators is n comparisons joined by and)', () => {
    const CHAINS: [string, boolean][] = [
      ['0 < big <= big', true],
      ['0 < big < big', false],
      ['5 <= big <= big', true],
      ['5 <= big <= 5', false],
      ['0 <= 5 <= big', true],
      ['0 <= 5 <= -big', false],
      ['-big < 5 < big', true],
      ['-big <= 5 <= -big', false],
      ['big >= 5 >= 0', true],
      ['big >= 5 >= big', false],
      ['big >= big >= big', true],
      ['big > big > 0', false],
      ['-big < -big', false],
      ['-big <= -big <= 5', true],
      ['5 < big < big', false],
      ['5 >= big >= 0', false],
      ['1e308 < big <= big', true],
      ['1e308 >= big >= -big', false],
      ['f(5) <= f(big) <= Lb[1]', true],
      ['f(big) >= f(5) >= Pi.x', false],
    ];
    it.each(CHAINS)('LANG-SM-28: %s is %s', (expr, want) => {
      expect(value(expr)).toBe(want);
    }, 10_000);
  });

  describe('points and vectors: equality is per coordinate, exact when a coordinate is infinite', () => {
    const ROWS: [string, boolean][] = [
      // Points
      ['(5, 0) == (big, 0)', false],
      ['(5, 0) != (big, 0)', true],
      ['(big, 0) == (5, 0)', false],
      ['(1e308, 0) == (big, 0)', false],
      ['(big, 0) == (-big, 0)', false],
      ['(big, 0) != (-big, 0)', true],
      ['(big, 0) == (big, 0)', true],
      ['(big, 0) != (big, 0)', false],
      ['(1, big) == (1, big)', true],
      ['(1, big) == (1, 5)', false],
      ['(1, 5) == (1, big)', false],
      ['(1, -big) == (1, big)', false],
      ['(big, big) == (big, big)', true],
      ['(big, big) == (big, 5)', false],
      ['P == Pi', false],
      ['Pi == P', false],
      ['P != Pi', true],
      ['Pi == Pi', true],
      ['Pi == Pn', false],
      ['Pi != Pn', true],
      ['Pi == (big, 0)', true],
      ['P == (1, 2)', true],
      ['(1, 2 + 1e-13) == P', true],
      ['(1, 2.001) == P', false],
      ['Pi.x == big', true],
      ['P.x == Pi.x', false],
      // Vectors
      ['(1, 0) - (0, 0) == (big, 0) - (0, 0)', false],
      ['V == Vi', false],
      ['Vi == V', false],
      ['V != Vi', true],
      ['Vi == Vi', true],
      ['Vi != Vi', false],
      ['Vi == Vn', false],
      ['Vi != Vn', true],
      ['Vi == -Vn', true],
      ['Vi * 2 == Vi', true],
      ['V * big == (big, big) - (0, 0)', true],
      ['V * big == Vi', false],
      ['V == (1, 1) - (0, 0)', true],
      ['V * 2 == V', false],
    ];
    it.each(ROWS)('LANG-SM-28: %s is %s', (expr, want) => {
      expect(value(expr)).toBe(want);
    }, 10_000);

    it('LANG-SM-28: a point or vector with an infinity is not equal to a point whose coordinate overflows to a finite number', () => {
      expect(value('Pi == (1e308, 0)')).toBe(false);
      expect(value('Vi == (1e308, 0) - (0, 0)')).toBe(false);
    });
  });

  describe('Bool and Text compare exactly, also with text made from an infinity', () => {
    it('LANG-SM-28: Bool and Text rows', () => {
      expect(value('(5 == big) == false')).toBe(true);
      expect(value('(5 != big) == true')).toBe(true);
      expect(value('(5 >= big) != (5 < big)')).toBe(true);
      expect(value('"{big}" == "inf"')).toBe(true);
      expect(value('"{-big}" == "-inf"')).toBe(true);
      expect(value('"{big}" == "{5}"')).toBe(false);
      expect(value('"{big}" != "{5}"')).toBe(true);
    });
  });

  describe('lists and functions have no comparison (design 3.10 operator table): type_mismatch, also with an infinity inside', () => {
    const SIDES: [string, string][] = [
      ['L', 'L'],
      ['L', 'Lb'],
      ['Lb', 'Lb'],
      ['[big, 1]', 'L'],
      ['f', 'f'],
      ['f', 'g'],
      ['L', 'big'],
      ['Lb', 'big'],
      ['f', 'big'],
      ['f', 'L'],
      ['P', 'big'],
      ['Pi', 'big'],
      ['Vi', 'Pi'],
    ];
    const cases: [string, string][] = [];
    for (const [a, b] of SIDES) for (const op of OPS) cases.push([`${a} ${op} ${b}`, op]);
    cases.push(['P < P', '<'], ['Pi <= Pi', '<='], ['Vi > Vi', '>'], ['"a" < "b"', '<'], ['true < false', '<']);

    it.each(cases)('LANG-SM-28: %s is type_mismatch', (expr) => {
      const fig = figure();
      applyOk(fig, 'g(x) = x + 1');
      const r = fig.apply(`out = ${expr}`);
      expect(r.ok, `${expr} must be refused`).toBe(false);
      expect(errOf(r, expr).kind, expr).toBe('type_mismatch');
      expect(fig.lookup('out'), `${expr} must not make an object`).toBeUndefined();
    }, 10_000);

    it('LANG-SM-28: a chain over a list is type_mismatch, and the numbers beside it still compare', () => {
      const fig = figure();
      const r = fig.apply('out = 0 < L <= big');
      expect(r.ok).toBe(false);
      expect(errOf(r).kind).toBe('type_mismatch');
      expect(value('0 < L[1] <= big')).toBe(true);
    });
  });

  describe('a relation compares its two sides the same way (design 3.5 tolerance, relation test)', () => {
    /** Compile a relation line on its own (no object reads) and return the relation value. */
    function relation(rhs: string): RelationValue {
      const fig = emptyFig();
      const line = okValue(analyseLine(`rel = ${rhs}`, fig));
      const compiled = okValue(compileLine(line));
      const env = createEnv({ slots: 8 });
      const r = evaluate(compiled, env);
      if (!r.defined) throw new Error(`${rhs} did not evaluate: ${String(r.reason)}`);
      return r.value as RelationValue;
    }

    const ROWS: [string, number, number, boolean][] = [
      ['x == inf', 5, 0, false],
      ['x == inf', 1e308, 0, false],
      ['x == -inf', 5, 0, false],
      ['inf == x', 5, 0, false],
      ['y == inf', 0, 5, false],
      ['x + y == inf', 1, 2, false],
      ['x - y == -inf', 1, 2, false],
      ['x <= inf', 5, 0, true],
      ['x >= inf', 5, 0, false],
      ['x < inf', 5, 0, true],
      ['x > inf', 5, 0, false],
      ['x >= -inf', 5, 0, true],
      ['x <= -inf', 5, 0, false],
      ['x > -inf', 5, 0, true],
      ['x < -inf', 5, 0, false],
      ['inf >= x', 5, 0, true],
      ['inf <= x', 5, 0, false],
      ['-inf <= x', 5, 0, true],
      ['-inf >= x', 5, 0, false],
      // Controls: a finite relation is unchanged
      ['x + y == 1', 0.5, 0.5, true],
      ['x + y == 1', 1, 1, false],
      ['x + y == 1', 0.5, 0.5 + 1e-12, true],
      ['x <= 1', 0.5, 0, true],
      ['x <= 1', 2, 0, false],
      ['x >= 1', 0.5, 0, false],
      ['x^2 + y^2 == 4', 2, 0, true],
      ['x^2 + y^2 == 4', 1, 1, false],
    ];
    it.each(ROWS)('LANG-SM-28: %s at (%s, %s) is %s', (rhs, x, y, want) => {
      const rel = relation(rhs);
      expect(rel.test(x, y), `${rhs} at (${x}, ${y})`).toBe(want);
    }, 10_000);
  });
});

describe('LANG-SM-29: relation coefficients and sampling follow the overflow rule (ruling Q4, L8, L9)', () => {
  // Readings where the docs are silent:
  // - A relation whose coefficient is not a number while its inputs were finite is an undefined value
  //   with the reason the coefficient had (overflow, division_by_zero, out_of_domain). The same rule
  //   as every other value kind (pipeline: "Fix every case of a rule").
  // - A coefficient that is infinite because an input was infinite (`big * x + y == 1`) stays a value.
  // - Sampling a relation at a point where the formula overflows gives NaN from `residual` and no
  //   `true` from `test`. Either call leaves reason, via and detail on the caller's Env as they were.
  const SETUP = [
    'r = 1e200',
    'big = inf',
    'un = 1 / 0',
    'f(x) = x^2',
    'L = [1e200, 1]',
    'P = (1e200, 0)',
    'V = (1e200, 0) - (0, 0)',
    'Q = (1, 2)',
    'W = (1, 2) - (0, 0)',
  ];

  function figure(): ScratchFigure {
    const fig = emptyFig();
    for (const line of SETUP) applyOk(fig, line);
    return fig;
  }

  type Want = 'overflow' | 'division_by_zero' | 'out_of_domain' | 'input_undefined';
  /** [value kind, relation text, reason] */
  const UNDEFINED_ROWS: [string, string, Want][] = [
    ['Number', 'x^2 + y^2 == r^2', 'overflow'],
    ['Number', '1e308 * 10 * x + y == 1', 'overflow'],
    ['Number', 'r * r * x + y == 1', 'overflow'],
    ['Number', 'x^2 + y == r * r', 'overflow'],
    ['Number', 'y == r * r * x^2', 'overflow'],
    ['Number', 'r * r * x * y == 1', 'overflow'],
    ['Number', 'r * r * x + y <= 1', 'overflow'],
    ['Number', 'r * r * x + y >= 1', 'overflow'],
    ['Number', 'r * r * x + y < 1', 'overflow'],
    ['Number', 'x * (1 / 0) + y == 1', 'division_by_zero'],
    ['Number', 'sqrt(-1) * x + y == 1', 'out_of_domain'],
    ['Number', 'un * x + y == 1', 'input_undefined'],
    ['Function', 'f(r) * x + y == 1', 'overflow'],
    ['Function', 'f(1e200) * x^2 + y == 1', 'overflow'],
    ['Function', 'x^2 + y^2 == f(r)', 'overflow'],
    ['List', 'L[1] * L[1] * x + y == 1', 'overflow'],
    ['List', 'x^2 + y^2 == L[1]^2', 'overflow'],
    ['Point', 'P.x * P.x * x + y == 1', 'overflow'],
    ['Point', 'x^2 + y^2 == P.x^2', 'overflow'],
    ['Vector', 'V.x * V.x * x + y == 1', 'overflow'],
    ['Vector', 'x^2 + y^2 == V.x^2', 'overflow'],
  ];

  it.each(UNDEFINED_ROWS)('LANG-SM-29: %s: "%s" is undefined (%s), not stored as a fine relation', (_kind, text, reason) => {
    const fig = figure();
    const r = applyOk(fig, `rel = ${text}`);
    expect(r.defined, `${text}: ${r.summary}`).toBe(false);
    expect(r.reason, text).toBe(reason);
    expect(fig.valueOf('rel'), 'an undefined relation stores no value').toBeUndefined();
  }, 10_000);

  it('LANG-SM-29: the cases of the finding', () => {
    const fig = figure();
    const c = applyOk(fig, 'c = x^2 + y^2 == r^2');
    expect(c.defined).toBe(false);
    expect(c.reason).toBe('overflow');
    const l = applyOk(fig, 'ln2 = 1e308 * 10 * x + y == 1');
    expect(l.defined).toBe(false);
    expect(l.reason).toBe('overflow');
    const ok = applyOk(fig, 'c3 = x^2 + y^2 == 4');
    expect(ok.defined).toBe(true);
    expect(ok.reason).toBeUndefined();
    expect((fig.valueOf('c3') as RelationValue).poly).toBeDefined();
  });

  it('LANG-SM-29: defined and reason always agree, for every row', () => {
    for (const [, text] of UNDEFINED_ROWS) {
      const fig = figure();
      const r = applyOk(fig, `rel = ${text}`);
      expect(r.defined, `${text}: ${r.summary}`).toBe(r.reason === undefined);
    }
  });

  it('LANG-SM-29: an undefined relation can be redefined to a defined one, and back', () => {
    const fig = figure();
    expect(applyOk(fig, 'c = x^2 + y^2 == r^2').defined).toBe(false);
    expect(applyOk(fig, 'c = x^2 + y^2 == 4').defined).toBe(true);
    expect((fig.valueOf('c') as RelationValue).poly).toBeDefined();
    expect(applyOk(fig, 'c = x^2 + y^2 == r^2').defined).toBe(false);
    expect(fig.valueOf('c')).toBeUndefined();
  });

  const FINITE_ROWS: [string, string][] = [
    ['Number', 'r * x + y == 1'],
    ['Number', 'x^2 + y^2 == 4'],
    ['Number', 'x^2 + y^2 == r'],
    ['Function', 'f(2) * x + y == 1'],
    ['Function', 'f(1e100) * x + y == 1'],
    ['List', 'L[2] * x + y == 1'],
    ['List', 'L[1] * x + y == 1'],
    ['Point', 'Q.y * x + y == 1'],
    ['Point', 'P.y * x + y == 1'],
    ['Vector', 'W.y * x + y == 1'],
    ['Vector', 'V.y * x + y == 1'],
  ];

  it.each(FINITE_ROWS)('LANG-SM-29: %s: "%s" keeps its coefficients (control)', (_kind, text) => {
    const fig = figure();
    const r = applyOk(fig, `rel = ${text}`);
    expect(r.defined, `${text}: ${r.summary}`).toBe(true);
    expect(r.reason).toBeUndefined();
    const rel = fig.valueOf('rel') as RelationValue;
    expect(rel.poly, `${text} has polynomial coefficients`).toBeDefined();
    for (const k of ['xx', 'xy', 'yy', 'x', 'y', 'c'] as const) expect(Number.isFinite(rel.poly?.[k]), `${text}: ${k}`).toBe(true);
  }, 10_000);

  const INFINITE_ROWS: [string, string][] = [
    ['Number', 'big * x + y == 1'],
    ['Number', 'x + y == big'],
    ['Number', 'x^2 + y^2 == big'],
    ['Number', 'x * (big * 2) + y == 1'],
    ['Function', 'f(big) * x + y == 1'],
    ['List', '([1, 2] * big)[1] * x + y == 1'],
    ['Point', '(big, 0).x * x + y == 1'],
    ['Vector', '((big, 0) - (0, 0)).x * x + y == 1'],
  ];

  it.each(INFINITE_ROWS)('LANG-SM-29: %s: "%s" has an infinite coefficient from an infinite input, so it stays a value (ruling Q4)', (_kind, text) => {
    const fig = figure();
    const r = applyOk(fig, `rel = ${text}`);
    expect(r.defined, `${text}: ${r.summary} (${String(r.reason)})`).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(fig.valueOf('rel')).toBeDefined();
  }, 10_000);

  it('LANG-SM-29: an infinity made from finite inputs is not hidden by an infinity elsewhere in the line', () => {
    const fig = figure();
    const r = applyOk(fig, 'rel = r * r * x + y == big');
    expect(r.defined).toBe(false);
    expect(r.reason).toBe('overflow');
  });

  describe('sampling a relation leaves the caller reason, via and detail as they were', () => {
    /** The relation, and the Env it was made in. */
    function made(text: string): { rel: RelationValue; env: ReturnType<typeof createEnv> } {
      const fig = emptyFig();
      const line = okValue(analyseLine(`rel = ${text}`, fig));
      const compiled = okValue(compileLine(line));
      const env = createEnv({ slots: 8 });
      const r = evaluate(compiled, env);
      if (!r.defined) throw new Error(`${text} did not evaluate: ${String(r.reason)}`);
      return { rel: r.value as RelationValue, env };
    }

    const VIA = 7 as ObjId;

    /** [relation, point that overflows the formula, a finite point] */
    const SAMPLES: [string, number, number, number, number][] = [
      ['x^2 + y^2 == 4', 1e200, 0, 1, 1],
      ['x + y == 1', 1.7e308, 1.7e308, 0.5, 0.5],
      ['y == x^2', 1e200, 0, 2, 4],
      ['x^3 + y == 0', 1e200, 0, 1, -1],
      ['1e300 * x + y == 1', 1e300, 0, 0, 1],
      ['x^2 + y^2 <= 4', 1e200, 0, 1, 1],
      ['x^2 + y^2 >= 4', 1e200, 1e200, 1, 1],
    ];

    for (const [text, bx, by, gx, gy] of SAMPLES) {
      it(`LANG-SM-29: "${text}" at an overflowing point gives no value and no reason on a clean Env`, () => {
        const { rel, env } = made(text);
        expect(env.reason, 'making the relation set no reason').toBeUndefined();
        const res = rel.residual(bx, by);
        expect(Number.isNaN(res), `${text} at (${bx}, ${by}): ${res}`).toBe(true);
        expect(rel.test(bx, by), `${text} at (${bx}, ${by})`).not.toBe(true);
        expect(env.reason).toBeUndefined();
        expect(env.via).toBeUndefined();
        expect(env.detail).toBeUndefined();
      }, 10_000);

      it(`LANG-SM-29: "${text}" at an overflowing point keeps the reason the caller already had`, () => {
        const { rel, env } = made(text);
        env.reason = 'division_by_zero';
        env.via = VIA;
        env.detail = 'caller detail';
        rel.residual(bx, by);
        rel.test(bx, by);
        expect(env.reason).toBe('division_by_zero');
        expect(env.via).toBe(VIA);
        expect(env.detail).toBe('caller detail');
      }, 10_000);

      it(`LANG-SM-29: "${text}" sampled at a finite point is right after an overflowing sample`, () => {
        const { rel, env } = made(text);
        const before = rel.residual(gx, gy);
        rel.residual(bx, by);
        rel.test(bx, by);
        expect(rel.residual(gx, gy)).toBe(before);
        expect(Number.isFinite(before)).toBe(true);
        expect(env.reason).toBeUndefined();
      }, 10_000);
    }

    it('LANG-SM-29: the same holds for a relation that reads a function value in the shared Env', () => {
      const fig = emptyFig();
      applyOk(fig, 'f(x) = x^2');
      const fInfo = fig.lookup('f')!;
      const lineF = okValue(analyseLine('f(x) = x^2', fig));
      const lineK = okValue(analyseLine('k = f(x) + y == 0', fig));
      const cf = okValue(compileLine(lineF));
      const ck = okValue(compileLine(lineK));
      const env = createEnv({ slots: 8, read: (id) => (id === fInfo.id ? fValue : undefined) });
      const first = evaluate(cf, env);
      if (!first.defined) throw new Error('f did not evaluate');
      const fValue = first.value as FunctionValue;
      const second = evaluate(ck, env);
      if (!second.defined) throw new Error('k did not evaluate');
      const rel = second.value as RelationValue;
      expect(rel.residual(2, 1)).toBe(5);
      env.reason = 'limit';
      env.via = VIA;
      env.detail = 'before';
      expect(Number.isNaN(rel.residual(1e200, 0))).toBe(true);
      expect(rel.test(1e200, 0)).not.toBe(true);
      expect(env.reason).toBe('limit');
      expect(env.via).toBe(VIA);
      expect(env.detail).toBe('before');
      env.reason = undefined;
      env.via = undefined;
      env.detail = undefined;
      expect(Number.isNaN(rel.residual(1e200, 0))).toBe(true);
      expect(env.reason).toBeUndefined();
      expect(rel.residual(2, 1)).toBe(5);
    });

    it('LANG-SM-29: a function value called with an overflowing argument also leaves the caller reason alone (L9 for functions)', () => {
      const fig = emptyFig();
      applyOk(fig, 'f(x) = x^2');
      const lineF = okValue(analyseLine('f(x) = x^2', fig));
      const env = createEnv({ slots: 8 });
      const r = evaluate(okValue(compileLine(lineF)), env);
      if (!r.defined) throw new Error('f did not evaluate');
      const fn = r.value as FunctionValue;
      env.reason = 'limit';
      env.via = VIA;
      env.detail = 'before';
      expect(Number.isNaN(fn.call(1e200))).toBe(true);
      expect(env.reason).toBe('limit');
      expect(env.via).toBe(VIA);
      expect(env.detail).toBe('before');
    });
  });
});
