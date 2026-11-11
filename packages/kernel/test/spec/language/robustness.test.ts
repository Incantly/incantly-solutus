import { describe, expect, it } from 'vitest';
import { analyseLine, complete, lex, parseLine, parseProgram, preview, signatureHelp, SourceMap, tokenize } from '@incantly/kernel';
import type { LanguageError, Result } from '@incantly/kernel';
import { emptyFig, expectWellFormed, newFig, prng } from './helpers';

const PIECES = [
  'a', 'b', 'A', 'x', 'y', 't', 'f', 'k', '1', '2.5', '1e3', '0', '(', ')', '[', ']', ',', ';', '+', '-', '*', '/', '^', '!', '\u00b0', '=', '==', '!=', '<', '>', '<=', '>=',
  '"', '{', '}', '\\', ' ', '  ', '#', '@', "'", ':', '.', '..', 'with', 'in', 'step', 'if', 'and', 'or', 'not', 'xor', 'true', 'undefined', 'Circle', 'Midpoint', 'Seq', 'Hide', 'sin', 'sqrt',
  'pi', 'inf', 'deg', '\u{1F600}', '\u00e9', '\u0301', '\u03b8', '\u0430', '\u2212', '\u00d7', '\u221a', '\u00b2', '\u200b', '\u0001', '\u00a0', '\t', '$', '`', '~', '?', '|', '&', '%',
];

function junk(rand: () => number, maxPieces = 18): string {
  const n = 1 + Math.floor(rand() * maxPieces);
  let s = '';
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(rand() * PIECES.length)] ?? '';
  return s;
}

const SEEDS = [
  'A = (1, 2)',
  'B = (4, 6)',
  's = Segment(A, B)',
  'm = (B.y - A.y) / (B.x - A.x)',
  'f(x) = m * (x - A.x) + A.y',
  'a = 3 in 0..10 step 0.5',
  'c = Circle(A, 2)',
  'l = y == 2x + 1',
  'r = x^2 + y^2 < 4',
  'L = [1..10]',
  'S = Seq(k^2, k, 1, 5)',
  'tx = "m = {m:2}"',
  'A with color = red, width = 3',
  'a in 0..20',
  "v' = -9.8",
  '@view -5 5 -3 3',
  'P = (2; 30\u00b0)',
  'n = if(a > 1, 2, a == 1, 3, 4)',
  'b = 0 < a <= 5 and not (a == 2)',
  'h(x, y) = x * y + sin(x) # a comment',
];

function mutate(rand: () => number, s: string): string {
  const chars = Array.from(s);
  const pick = (): number => Math.floor(rand() * (chars.length + 1));
  const piece = (): string => PIECES[Math.floor(rand() * PIECES.length)] ?? '';
  switch (Math.floor(rand() * 5)) {
    case 0:
      chars.splice(pick(), 1);
      break;
    case 1:
      chars.splice(pick(), 0, piece());
      break;
    case 2:
      chars.splice(pick(), 1, piece());
      break;
    case 3: {
      const i = pick();
      chars.splice(i, 0, ...chars.slice(i, i + 3));
      break;
    }
    default:
      chars.length = Math.min(chars.length, pick());
  }
  return chars.join('');
}

function checkError(src: string, e: LanguageError): string[] {
  const problems: string[] = [];
  const add = (m: string): void => {
    problems.push(`${JSON.stringify(src)}: ${m}`);
  };
  try {
    expectWellFormed(e);
  } catch (x) {
    add(`not well formed: ${(x as Error).message.split('\n')[0] ?? ''}`);
  }
  const lines = src.split('\n');
  const lineText = lines[e.line - 1];
  if (lineText === undefined) {
    add(`line ${e.line} is outside the ${lines.length} lines`);
    return problems;
  }
  if (e.col > lineText.length + 1) add(`col ${e.col} is past the end of the line (${lineText.length})`);
  if (e.endCol > lineText.length + 1) add(`endCol ${e.endCol} is past the end of the line (${lineText.length})`);
  if (e.endCol > e.col && lines.length === 1 && lineText.slice(e.col - 1, e.endCol - 1) !== e.token) {
    add(`token ${JSON.stringify(e.token)} is not the text at [${e.col}, ${e.endCol}) = ${JSON.stringify(lineText.slice(e.col - 1, e.endCol - 1))}`);
  }
  if (e.expected.length > 8) add('expected has more than 8 entries');
  if (e.suggest.length > 3) add('suggest has more than 3 entries');
  if (e.forms.length > 6) add('forms has more than 6 entries');
  if ((e.more?.length ?? 0) > 7) add('more has more than 7 entries');
  return problems;
}

describe('docs: empty and trivial input', () => {
  const fig = newFig();
  it.each(['', ' ', '\t', '\n', '\r\n', '   \n  \n', '#', '# only a comment', '   # indented comment'])('%j is a no-op for every entry point', (src) => {
    const p = parseLine(src);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.value.node.k).toBe('noop');
    expect(parseProgram(src).every((r) => r.result.ok)).toBe(true);
    const a = analyseLine(src, fig);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.op).toBe('noop');
    expect(tokenize(src, fig).errors).toEqual([]);
    expect(() => preview(src, fig)).not.toThrow();
    expect(() => complete(src, 0, fig)).not.toThrow();
    expect(() => complete(src, src.length, fig)).not.toThrow();
    expect(signatureHelp(src, src.length, fig)).toBeNull();
  });

  it('an empty program has no logical lines or only no-ops', () => {
    expect(parseProgram('').every((r) => r.result.ok && r.result.value.node.k === 'noop')).toBe(true);
  });

  it('whitespace around a line is ignored', () => {
    expect(analyseLine('   a2 = 3   ', fig).ok).toBe(true);
    expect(analyseLine('\ta2 = 3\t', fig).ok).toBe(true);
  });
});

describe('docs: very long and very deep input never throws', () => {
  it('a one-million-character line is a limit error, not a crash', () => {
    const src = `n = ${'1 + '.repeat(250_000)}1`;
    const r = analyseLine(src, newFig());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('limit');
    expect(() => lex(new SourceMap(src))).not.toThrow();
    expect(() => preview(src, newFig())).not.toThrow();
    expect(() => tokenize(src, newFig())).not.toThrow();
    expect(() => complete(src, src.length, newFig())).not.toThrow();
    expect(() => signatureHelp(src, src.length, newFig())).not.toThrow();
  });

  it('100,000 nested brackets are a limit error, not a stack overflow', () => {
    const src = `n = ${'('.repeat(100_000)}1${')'.repeat(100_000)}`;
    const r = analyseLine(src, newFig());
    expect(r.ok).toBe(false);
    expect(() => tokenize(src, newFig())).not.toThrow();
  });

  it('1,000 nested calls and lists', () => {
    for (const src of [`n = ${'abs('.repeat(1000)}1${')'.repeat(1000)}`, `L9 = ${'['.repeat(1000)}1${']'.repeat(1000)}`, `n = ${'-'.repeat(5000)}1`, `n = ${'not '.repeat(1000)}true`]) {
      expect(() => analyseLine(src, newFig())).not.toThrow();
      const r = analyseLine(src, newFig());
      expect(r.ok, src.slice(0, 20)).toBe(false);
    }
  });

  it('a long chain of + within the limits is fine', () => {
    const src = `n = ${'1+'.repeat(300)}1`;
    expect(analyseLine(src, newFig()).ok).toBe(true);
  });

  it('a long string text and many arguments', () => {
    expect(analyseLine(`tx = "${'a'.repeat(1500)}"`, newFig()).ok).toBe(true);
    const args = Array(20).fill('A').join(', ');
    expect(() => analyseLine(`Hide(${args})`, newFig())).not.toThrow();
  });

  it('a long program of 10,000 lines is parsed', () => {
    const prog = Array.from({ length: 10_000 }, (_, i) => `n${i} = ${i} + 1`).join('\n');
    const rs = parseProgram(prog);
    expect(rs.length).toBe(10_000);
    expect(rs.every((r) => r.result.ok)).toBe(true);
    expect(rs[9999]?.line).toBe(10_000);
  });

  it('a program with an unclosed bracket on the first line does not swallow the rest silently', () => {
    const rs = parseProgram('A9 = (1, 2\nB9 = 3\nC9 = 4');
    expect(rs.length).toBeGreaterThanOrEqual(1);
    expect(rs.some((r) => !r.result.ok)).toBe(true);
  });
});

describe('docs: random junk never throws and every error is well formed', () => {
  it('parseLine, analyseLine, preview, tokenize on 4,000 random lines', () => {
    const rand = prng(20240607);
    const fig = newFig();
    const problems: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const src = junk(rand);
      let r1: Result<unknown>;
      let r2: Result<unknown>;
      try {
        r1 = parseLine(src);
        r2 = analyseLine(src, fig);
        preview(src, fig);
        tokenize(src, fig);
        tokenize(src);
      } catch (x) {
        problems.push(`${JSON.stringify(src)} threw ${(x as Error).message}`);
        continue;
      }
      for (const r of [r1, r2]) {
        if (!r.ok) problems.push(...checkError(src, r as LanguageError));
      }
    }
    expect(problems.slice(0, 8)).toEqual([]);
  });

  it('complete and signatureHelp at every cursor of 600 random lines', () => {
    const rand = prng(99);
    const fig = newFig();
    for (let i = 0; i < 600; i++) {
      const src = junk(rand, 12);
      for (let c = 0; c <= src.length; c += 1 + Math.floor(rand() * 3)) {
        expect(() => complete(src, c, fig), JSON.stringify(src) + '@' + c).not.toThrow();
        expect(() => signatureHelp(src, c, fig), JSON.stringify(src) + '@' + c).not.toThrow();
      }
    }
  });

  it('cursor positions outside the text do not throw', () => {
    const fig = newFig();
    for (const c of [-1, -100, 1000, 1e9, Number.MAX_SAFE_INTEGER]) {
      expect(() => complete('q = Circ', c, fig)).not.toThrow();
      expect(() => signatureHelp('q = Circle(A,', c, fig)).not.toThrow();
    }
  });

  it('parseProgram on 600 random multi-line blobs: one result per logical line, numbered in order', () => {
    const rand = prng(7);
    const problems: string[] = [];
    for (let i = 0; i < 600; i++) {
      const n = 1 + Math.floor(rand() * 5);
      const src = Array.from({ length: n }, () => junk(rand, 8)).join(rand() < 0.2 ? '\r\n' : '\n');
      let rs: ReturnType<typeof parseProgram>;
      try {
        rs = parseProgram(src);
      } catch (x) {
        problems.push(`${JSON.stringify(src)} threw ${(x as Error).message}`);
        continue;
      }
      let last = 0;
      for (const r of rs) {
        if (r.line <= last) problems.push(`${JSON.stringify(src)}: line ${r.line} after ${last}`);
        last = r.line;
        if (!r.result.ok && r.result.line < r.line) problems.push(`${JSON.stringify(src)}: error line ${r.result.line} < logical line ${r.line}`);
      }
    }
    expect(problems.slice(0, 8)).toEqual([]);
  });

  it('mutating valid lines (delete, insert, replace, duplicate, truncate) never throws and failures are atomic', () => {
    const rand = prng(31337);
    const problems: string[] = [];
    for (let i = 0; i < 1500; i++) {
      const fig = newFig();
      const seed = SEEDS[Math.floor(rand() * SEEDS.length)] ?? '';
      const src = mutate(rand, seed);
      const names = fig.names().slice();
      const before = JSON.stringify(names.map((n) => [n, fig.valueOf(n)]));
      let r: Result<unknown>;
      try {
        r = fig.apply(src);
      } catch (x) {
        problems.push(`${JSON.stringify(src)} threw ${(x as Error).message}`);
        continue;
      }
      if (!r.ok) {
        if ((r as LanguageError).committed !== false) problems.push(`${JSON.stringify(src)}: committed is not false`);
        const after = JSON.stringify(fig.names().map((n) => [n, fig.valueOf(n)]));
        if (after !== before) problems.push(`${JSON.stringify(src)}: a failing line changed the figure`);
        problems.push(...checkError(src, r as LanguageError));
      }
    }
    expect(problems.slice(0, 8)).toEqual([]);
  });

  it('applyAll on a batch of mutated lines: one result per line, each error carries its batch line', () => {
    const rand = prng(5);
    for (let i = 0; i < 100; i++) {
      const fig = emptyFig();
      const lines = Array.from({ length: 6 }, () => mutate(rand, SEEDS[Math.floor(rand() * SEEDS.length)] ?? ''));
      const rs = fig.applyAll(lines);
      expect(rs.length).toBe(lines.length);
      rs.forEach((r, idx) => {
        if (!r.ok) expect((r as LanguageError).line, JSON.stringify(lines)).toBe(idx + 1);
      });
    }
  });
});

describe('docs: purity and determinism', () => {
  it('analyseLine, preview, complete and signatureHelp never change the figure', () => {
    const rand = prng(11);
    const fig = newFig();
    const snapshot = (): string => JSON.stringify([fig.size, fig.names().map((n) => [n, fig.lookup(n)?.id, fig.valueOf(n)])]);
    const before = snapshot();
    for (let i = 0; i < 800; i++) {
      const src = rand() < 0.5 ? junk(rand) : mutate(rand, SEEDS[Math.floor(rand() * SEEDS.length)] ?? '');
      analyseLine(src, fig);
      preview(src, fig);
      complete(src, Math.floor(rand() * (src.length + 1)), fig);
      signatureHelp(src, Math.floor(rand() * (src.length + 1)), fig);
      tokenize(src, fig);
    }
    expect(snapshot()).toBe(before);
  });

  it('the same input gives the same output every time', () => {
    const rand = prng(3);
    for (let i = 0; i < 300; i++) {
      const src = rand() < 0.5 ? junk(rand) : mutate(rand, SEEDS[Math.floor(rand() * SEEDS.length)] ?? '');
      const a = JSON.stringify(analyseLine(src, newFig()));
      const b = JSON.stringify(analyseLine(src, newFig()));
      expect(b, JSON.stringify(src)).toBe(a);
      const c = JSON.stringify(preview(src, newFig()));
      expect(JSON.stringify(preview(src, newFig())), JSON.stringify(src)).toBe(c);
      const k = Math.floor(rand() * (src.length + 1));
      expect(JSON.stringify(complete(src, k, newFig())), JSON.stringify(src)).toBe(JSON.stringify(complete(src, k, newFig())));
    }
  });

  it('applying a script twice to two fresh figures gives identical values (determinism)', () => {
    const script = SEEDS.filter((s) => !s.startsWith('@') && !s.startsWith("v'") && !s.includes(' in 0..20') && !s.includes('with'));
    const run = (): string => {
      const fig = emptyFig();
      const results = fig.applyAll(script);
      return JSON.stringify([results.map((r) => r.ok), fig.names().map((n) => [n, fig.valueOf(n)])]);
    };
    expect(run()).toBe(run());
  });

  it('rand(seed) and noise are pure: the same arguments give the same value across figures', () => {
    const a = emptyFig();
    const b = emptyFig();
    a.apply('r1 = rand(7) + noise(1.5, 2.5) + noise(0.2)');
    b.apply('r1 = rand(7) + noise(1.5, 2.5) + noise(0.2)');
    expect(a.valueOf('r1')).toBe(b.valueOf('r1'));
  });
});

describe('docs: invariants of the public results', () => {
  it('success results carry notices as an array and a checked line', () => {
    const rand = prng(17);
    const fig = newFig();
    let oks = 0;
    for (let i = 0; i < 1500; i++) {
      const src = mutate(rand, SEEDS[Math.floor(rand() * SEEDS.length)] ?? '');
      const r = analyseLine(src, fig);
      if (r.ok) {
        oks++;
        expect(Array.isArray(r.notices)).toBe(true);
        expect(['noop', 'add', 'redefine', 'restyle', 'rerange', 'rate', 'action', 'directive']).toContain(r.value.op);
        expect(r.value.source.length).toBeGreaterThanOrEqual(0);
        expect(r.value.line).toBeGreaterThanOrEqual(1);
      }
    }
    expect(oks).toBeGreaterThan(50);
  });

  it('a line is atomic: only the first physical line failing does not hide a later error in a batch', () => {
    const fig = emptyFig();
    const rs = fig.applyAll(['A = (1, 2)', 'B = (', 'C = $', 'D = A']);
    expect(rs[0]?.ok).toBe(true);
    expect(rs[1]?.ok).toBe(false);
    expect(rs[2]?.ok).toBe(false);
    expect(rs[3]?.ok).toBe(true);
    expect(fig.lookup('B')).toBeUndefined();
    expect(fig.lookup('D')).toBeDefined();
  });
});
