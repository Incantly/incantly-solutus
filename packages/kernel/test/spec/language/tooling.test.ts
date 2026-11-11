import { describe, expect, it } from 'vitest';
import { analyseLine, complete, preview, signatureHelp, tokenize } from '@incantly/kernel';
import type { Completion, HighlightToken, PreviewResult, SignatureHelp } from '@incantly/kernel';
import { emptyFig, newFig, okValue } from './helpers';

function pv(src: string, fig = newFig()): Extract<PreviewResult, { ok: true }> {
  const r = preview(src, fig);
  if (!r.ok) throw new Error(`preview of "${src}" failed: ${r.error.kind}: ${r.error.message}`);
  return r;
}

function sig(src: string, cursor = src.length, fig = newFig()): SignatureHelp {
  const r = signatureHelp(src, cursor, fig);
  if (!r) throw new Error(`no signature help for "${src}" at ${cursor}`);
  return r;
}

const labels = (cs: readonly Completion[]): string[] => cs.map((c) => c.label);

describe('language/design.md 3.16 previews', () => {
  it('a named line previews its name, type and value; nothing is committed', () => {
    const fig = newFig();
    const before = fig.names().slice();
    const r = pv('q9 = 3 + 4', fig);
    expect(r.name).toBe('q9');
    expect(r.type?.k).toBe('Number');
    expect(r.valueText).toBe('7');
    expect(fig.names()).toEqual(before);
    expect(fig.lookup('q9')).toBeUndefined();
  });

  it('an unnamed line is given the next suggested name', () => {
    const fig = newFig(); // has a, b, A, B, C, P, f, g, L, m, flag, ...
    expect(pv('3 + 4', fig).name).toBe('c');
    expect(pv('(1, 2)', fig).name).toBe('D');
    expect(pv('"hello"', fig).name).toBe('text1');
    expect(pv('1 < 2', fig).name).toBe('cond1');
    expect(pv('Circle(A, 2)', fig).name).toBe('c');
    expect(pv('Midpoint(A, B)', fig).name).toBe('D');
  });

  it('the suggested name does not change between two previews (nothing was created)', () => {
    const fig = newFig();
    expect(pv('(1, 2)', fig).name).toBe(pv('(3, 4)', fig).name);
  });

  it('a preview never changes the figure', () => {
    const fig = newFig();
    const names = fig.names().slice();
    const size = fig.size;
    for (const src of ['q9 = 3', '(1, 2)', 'a = 100', 'f(x) = x^3', 'A with color = red', 'Circle(A, 2)', 'h = 1/0']) {
      preview(src, fig);
    }
    expect(fig.names()).toEqual(names);
    expect(fig.size).toBe(size);
    expect(fig.valueOf('a')).toBe(3);
    expect(okValue(fig.apply('out = f(3)')).defined).toBe(true);
    expect(fig.valueOf('out')).toBe(9);
  });

  it('a redefinition previews the new value without changing the object', () => {
    const fig = newFig();
    const r = pv('a = 100', fig);
    expect(r.name).toBe('a');
    expect(r.valueText).toBe('100');
    expect(fig.valueOf('a')).toBe(3);
  });

  it('the preview of a point has a ghost with the point value', () => {
    const r = pv('Q9 = (1, 2)');
    expect(r.type?.k).toBe('Point');
    expect(r.ghost).not.toBeNull();
    expect(r.ghost?.type.k).toBe('Point');
    expect(r.ghost?.value).toEqual({ x: 1, y: 2 });
  });

  it('the preview of a function has type Function', () => {
    const r = pv('h9(x) = x^2');
    expect(r.type?.k).toBe('Function');
    expect(r.name).toBe('h9');
  });

  it('warnings of the line are reported', () => {
    const r = pv('h9(a) = a + 1');
    expect(r.warnings.map((n) => n.kind)).toContain('shadowed');
    expect(pv('q9 = 1').warnings).toEqual([]);
  });

  it('an undefined result is still a successful preview', () => {
    const r = pv('q9 = 1/0');
    expect(r.ok).toBe(true);
    expect(r.valueText.length).toBeGreaterThan(0);
  });

  it('an incomplete line is not an error the writer should see: incomplete is true', () => {
    for (const src of ['q9 = ', 'q9 = 1 +', 'q9 = (1,', 'q9 = sqrt(', 'c9 = Circle(A, ', 'q9 = [1, 2', 'f9(x) =', 'q9 = "abc', 'q9 = L[']) {
      const r = preview(src, newFig());
      expect(r.ok, src).toBe(false);
      if (!r.ok) expect(r.incomplete, src).toBe(true);
    }
  });

  it('a wrong line is not incomplete', () => {
    for (const src of ['q9 = 3 $ 4', 'q9 = zzz', 'q9 = 2 * A', 'c9 = Circle(A, B, 2)', 'q9 = )']) {
      const r = preview(src, newFig());
      expect(r.ok, src).toBe(false);
      if (!r.ok) {
        expect(r.incomplete, src).toBe(false);
        expect(r.error.kind).toBeTruthy();
      }
    }
  });

  it('the error of a failed preview is the same error analyseLine gives', () => {
    const fig = newFig();
    const r = preview('q9 = zzz', fig);
    const a = analyseLine('q9 = zzz', fig);
    expect(r.ok).toBe(false);
    expect(a.ok).toBe(false);
    if (!r.ok && !a.ok) {
      expect(r.error.kind).toBe(a.kind);
      expect(r.error.col).toBe(a.col);
    }
  });

  it('empty and comment-only lines preview as nothing', () => {
    const r = preview('', newFig());
    // either an ok no-op or an incomplete marker, but never a thrown error
    expect(typeof r.ok).toBe('boolean');
    expect(typeof preview('# just a note', newFig()).ok).toBe('boolean');
  });
});

describe('language/design.md 3.17 signature help', () => {
  it('inside Circle( with nothing typed: all forms match, the first is active, parameter 0', () => {
    const h = sig('c9 = Circle(');
    expect(h.command).toBe('Circle');
    expect(h.forms.length).toBe(3);
    expect(h.forms.every((f) => f.matches)).toBe(true);
    expect(h.forms.filter((f) => f.active).length).toBe(1);
    expect(h.forms[0]?.active).toBe(true);
    expect(h.activeParam).toBe(0);
    expect(h.argsSoFar).toEqual([]);
    expect(h.forms[0]?.text).toBe('Circle(center: Point, radius: Number) -> Circle');
    expect(h.forms[0]?.summary.length).toBeGreaterThan(0);
  });

  it('after the first comma: parameter 1, the first argument is typed with its span', () => {
    const h = sig('c9 = Circle(A, ');
    expect(h.command).toBe('Circle');
    expect(h.activeParam).toBe(1);
    expect(h.argsSoFar.length).toBe(1);
    expect(h.argsSoFar[0]?.type).toBe('Point');
    expect(h.argsSoFar[0]?.span).toEqual({ line: 1, col: 13, endCol: 14 });
    expect(h.forms.every((f) => f.matches)).toBe(true);
  });

  it('forms whose first k parameters accept the typed arguments match; the first match is active', () => {
    const h = sig('c9 = Circle(A, 2, ');
    expect(h.activeParam).toBe(2);
    expect(h.argsSoFar.map((a) => a.type)).toEqual(['Point', 'Number']);
    const byText = (t: string): boolean | undefined => h.forms.find((f) => f.text.startsWith(t))?.matches;
    // (Point, Number) cannot be the start of the through form or of the three-point form.
    expect(byText('Circle(center: Point, through')).toBe(false);
    expect(byText('Circle(a: Point')).toBe(false);
    expect(h.forms.filter((f) => f.active).length).toBe(1);
  });

  it('two typed arguments of (Point, Number) keep the radius form matching while the cursor is on its last parameter', () => {
    const h = sig('c9 = Circle(A, ');
    expect(h.forms.find((f) => f.text.startsWith('Circle(center: Point, radius'))?.matches).toBe(true);
    const h2 = sig('c9 = Circle(A, 2', 'c9 = Circle(A, 2'.length);
    expect(h2.command).toBe('Circle');
    expect(h2.activeParam).toBe(1);
    expect(h2.forms.find((f) => f.text.startsWith('Circle(center: Point, radius'))?.matches).toBe(true);
  });

  it('a second Point argument keeps the point forms and drops the radius form', () => {
    const h = sig('c9 = Circle(A, B, ');
    expect(h.forms.find((f) => f.text.startsWith('Circle(center: Point, radius'))?.matches).toBe(false);
    expect(h.forms.find((f) => f.text.startsWith('Circle(a: Point'))?.matches).toBe(true);
  });

  it('with no form matching, the closest one is active', () => {
    const h = sig('c9 = Circle(s, ');
    expect(h.forms.some((f) => f.matches)).toBe(false);
    expect(h.forms.filter((f) => f.active).length).toBe(1);
  });

  it('a nested call: the innermost open call wins, and commas are counted at its depth', () => {
    const outer = sig('c9 = Circle(Midpoint(A, B), ');
    expect(outer.command).toBe('Circle');
    expect(outer.activeParam).toBe(1);
    expect(outer.argsSoFar.map((a) => a.type)).toEqual(['Point']);
    const inner = sig('c9 = Circle(Midpoint(A, ');
    expect(inner.command).toBe('Midpoint');
    expect(inner.activeParam).toBe(1);
    const innermost = sig('c9 = Circle(Midpoint(');
    expect(innermost.command).toBe('Midpoint');
    expect(innermost.activeParam).toBe(0);
  });

  it('the cursor decides: a cursor inside an earlier argument gives that argument', () => {
    const src = 'c9 = Circle(A, 2)';
    const h = sig(src, src.indexOf('A') + 1);
    expect(h.command).toBe('Circle');
    expect(h.activeParam).toBe(0);
    const h2 = sig(src, src.indexOf('2') + 1);
    expect(h2.activeParam).toBe(1);
  });

  it('built-in functions get help too', () => {
    const h = sig('q9 = max(');
    expect(h.command).toBe('max');
    expect(h.forms.length).toBeGreaterThan(0);
    const h2 = sig('q9 = atan2(1, ');
    expect(h2.command).toBe('atan2');
    expect(h2.activeParam).toBe(1);
  });

  it('a call to an action command', () => {
    const h = sig('Hide(');
    expect(h.command).toBe('Hide');
  });

  it('commas inside a nested list or point do not count for the outer call', () => {
    const h = sig('c9 = Circle((1, 2), ');
    expect(h.command).toBe('Circle');
    expect(h.activeParam).toBe(1);
    const h2 = sig('S9 = Seq(L[1], ');
    expect(h2.command).toBe('Seq');
    expect(h2.activeParam).toBe(1);
  });

  it('a command with a binder: the binder argument is not typed', () => {
    const h = sig('S9 = Seq(k^2, k, ');
    expect(h.command).toBe('Seq');
    expect(h.activeParam).toBe(2);
  });

  it('returns null outside a call', () => {
    expect(signatureHelp('q9 = 3 + ', 9, newFig())).toBeNull();
    expect(signatureHelp('', 0, newFig())).toBeNull();
    expect(signatureHelp('c9 = Circle(A, 2)', 17, newFig())).toBeNull(); // after the closing bracket
    expect(signatureHelp('q9 = (1 + 2', 11, newFig())).toBeNull(); // a plain bracket is not a call
  });

  it('returns null for a call on a name that is neither a command nor a function', () => {
    expect(signatureHelp('c9 = Nope(', 10, newFig())).toBeNull();
  });
});

describe('language/design.md 3.18 autocomplete', () => {
  const fig = newFig();

  it('the best matches come first and scores never increase down the list', () => {
    const cs = complete('M9 = Mid', 8, fig);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs[0]?.label).toBe('Midpoint');
    expect(cs[0]?.kind).toBe('command');
    for (let i = 1; i < cs.length; i++) expect(cs[i - 1]!.score).toBeGreaterThanOrEqual(cs[i]!.score);
  });

  it('a command inserts its name and parameter placeholders ($1, $2)', () => {
    const c = complete('M9 = Mid', 8, fig).find((x) => x.label === 'Midpoint');
    expect(c).toBeDefined();
    expect(c?.insert.startsWith('Midpoint(')).toBe(true);
    expect(c?.insert).toContain('$1');
    expect(c?.insert).toContain('$2');
    expect(c?.detail ?? c?.doc ?? '').not.toBe('');
  });

  it('case-insensitive prefix, subsequence and typo matches find the command', () => {
    expect(labels(complete('M9 = mid', 8, fig))).toContain('Midpoint');
    expect(labels(complete('M9 = mp', 7, fig))).toContain('Midpoint');
    expect(labels(complete('c9 = Cirlce', 11, fig))).toContain('Circle');
    expect(labels(complete('c9 = Circl', 10, fig))).toContain('Circle');
  });

  it('prefix match outranks case-insensitive prefix, which outranks a subsequence match', () => {
    const cs = complete('x9 = Seg', 8, fig);
    const exact = cs.find((c) => c.label === 'Segment');
    expect(exact).toBeDefined();
    const sub = complete('x9 = sgm', 8, fig).find((c) => c.label === 'Segment');
    const ci = complete('x9 = seg', 8, fig).find((c) => c.label === 'Segment');
    expect(sub).toBeDefined();
    expect(ci).toBeDefined();
    expect(exact!.score).toBeGreaterThan(ci!.score);
    expect(ci!.score).toBeGreaterThan(sub!.score);
  });

  it('the limit defaults to 12 and can be set', () => {
    expect(complete('', 0, fig).length).toBeLessThanOrEqual(12);
    expect(complete('q9 = ', 5, fig).length).toBeLessThanOrEqual(12);
    expect(complete('q9 = ', 5, fig, { limit: 3 }).length).toBeLessThanOrEqual(3);
    expect(complete('q9 = ', 5, fig, { limit: 50 }).length).toBeGreaterThan(12);
  });

  it('after = : commands, built-ins, constants and object names are offered', () => {
    const cs = complete('q9 = ', 5, fig, { limit: 200 });
    const kinds = new Set(cs.map((c) => c.kind));
    expect(kinds.has('command')).toBe(true);
    expect(kinds.has('function')).toBe(true);
    expect(kinds.has('constant')).toBe(true);
    expect(kinds.has('object')).toBe(true);
  });

  it('kinds are right: sin is a function, pi a constant, A an object', () => {
    const cs = complete('q9 = ', 5, fig, { limit: 300 });
    expect(cs.find((c) => c.label === 'sin')?.kind).toBe('function');
    expect(cs.find((c) => c.label === 'pi')?.kind).toBe('constant');
    expect(cs.find((c) => c.label === 'A')?.kind).toBe('object');
    expect(cs.find((c) => c.label === 'Circle')?.kind).toBe('command');
  });

  it('a function inserts name and brackets', () => {
    const c = complete('q9 = sq', 7, fig).find((x) => x.label === 'sqrt');
    expect(c).toBeDefined();
    expect(c?.insert.startsWith('sqrt(')).toBe(true);
  });

  it('after a dot: the fields of the left operand type', () => {
    const point = labels(complete('q9 = P.', 7, fig, { limit: 20 }));
    expect(point).toEqual(expect.arrayContaining(['x', 'y']));
    expect(complete('q9 = P.', 7, fig).every((c) => c.kind === 'field')).toBe(true);
    const seg = labels(complete('q9 = s.', 7, fig, { limit: 20 }));
    expect(seg).toEqual(expect.arrayContaining(['length', 'start', 'end']));
    const circle = labels(complete('q9 = c1.', 8, fig, { limit: 20 }));
    expect(circle).toEqual(expect.arrayContaining(['center', 'radius']));
    const vec = labels(complete('q9 = u.', 7, fig, { limit: 20 }));
    expect(vec).toEqual(expect.arrayContaining(['x', 'y', 'length']));
    const poly = labels(complete('q9 = pg.', 8, fig, { limit: 20 }));
    expect(poly).toEqual(expect.arrayContaining(['vertices', 'area', 'perimeter']));
    expect(labels(complete('q9 = m.', 7, fig, { limit: 20 }))).toEqual(['length']);
  });

  it('a field prefix filters', () => {
    expect(labels(complete('q9 = s.le', 9, fig))).toEqual(['length']);
  });

  it('after @: directive names', () => {
    const cs = complete('@', 1, fig, { limit: 100 });
    expect(labels(cs).map((l) => l.replace(/^@/, ''))).toEqual(expect.arrayContaining(['view', 'grid', 'axes', 'beat', 'clock']));
    expect(cs.every((c) => c.kind === 'directive')).toBe(true);
    expect(labels(complete('@vi', 3, fig)).map((l) => l.replace(/^@/, ''))).toContain('view');
  });

  it('after with: property names; after prop =: legal values', () => {
    const props = complete('A with ', 7, fig, { limit: 50 });
    expect(props.every((c) => c.kind === 'property')).toBe(true);
    expect(labels(props)).toEqual(expect.arrayContaining(['color', 'width', 'visible']));
    const vals = labels(complete('A with color = ', 15, fig, { limit: 50 }));
    expect(vals).toContain('red');
    const second = complete('A with color = red, ', 20, fig, { limit: 50 });
    expect(labels(second)).toContain('width');
  });

  it('after in: a lo..hi snippet', () => {
    const cs = complete('q9 = 3 in ', 10, fig);
    expect(cs.some((c) => c.insert.includes('..'))).toBe(true);
  });

  it('start of an empty line: directive start, comment and snippets are offered', () => {
    const cs = complete('', 0, fig, { limit: 30 });
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.some((c) => c.kind === 'snippet' || c.kind === 'directive')).toBe(true);
  });

  it('start of a line with a prefix: action commands and object names', () => {
    const cs = complete('Hi', 2, fig);
    expect(labels(cs)).toContain('Hide');
    const objs = complete('A', 1, fig, { limit: 30 });
    expect(objs.some((c) => c.kind === 'object' && c.label === 'A')).toBe(true);
  });

  it('inside a string {…}: object names', () => {
    const cs = complete('tx = "value = {', 15, fig, { limit: 40 });
    expect(labels(cs)).toEqual(expect.arrayContaining(['a', 'A']));
  });

  it('inside call arguments, objects of the accepted type rank above objects of other types', () => {
    const cs = complete('c9 = Circle(', 12, fig, { limit: 60 });
    const idx = (n: string): number => labels(cs).indexOf(n);
    for (const point of ['A', 'B', 'C', 'P']) {
      expect(idx(point), point).toBeGreaterThanOrEqual(0);
      for (const other of ['a', 'b', 'm', 'flag']) {
        if (idx(other) >= 0) expect(idx(point), `${point} before ${other}`).toBeLessThan(idx(other));
      }
    }
  });

  it('for a Number parameter, Number objects and constants rank above Points', () => {
    const cs = complete('n9 = Round3(', 12, fig, { limit: 300 });
    const idx = (n: string): number => labels(cs).indexOf(n);
    expect(idx('a')).toBeGreaterThanOrEqual(0);
    expect(idx('A')).toBeGreaterThanOrEqual(0);
    expect(idx('a')).toBeLessThan(idx('A'));
    expect(idx('b')).toBeLessThan(idx('B'));
    expect(idx('pi')).toBeGreaterThanOrEqual(0);
  });

  it('a more recently created object ranks above an older one with the same prefix match', () => {
    const f = emptyFig();
    okValue(f.apply('pa = 1'));
    okValue(f.apply('pb = 2'));
    okValue(f.apply('pc = 3'));
    const cs = complete('q9 = p', 6, f, { limit: 60 });
    const idx = (n: string): number => labels(cs).indexOf(n);
    expect(idx('pc')).toBeGreaterThanOrEqual(0);
    expect(idx('pc')).toBeLessThan(idx('pb'));
    expect(idx('pb')).toBeLessThan(idx('pa'));
  });

  it('an object with an exact prefix match is a completion of kind object with its type as detail', () => {
    const c = complete('q9 = fla', 8, fig).find((x) => x.label === 'flag');
    expect(c?.kind).toBe('object');
    expect(c?.detail).toContain('Bool');
  });

  it('nothing in the figure is changed by completing', () => {
    const f = newFig();
    const names = f.names().slice();
    complete('q9 = ', 5, f);
    complete('c9 = Circle(', 12, f);
    expect(f.names()).toEqual(names);
  });

  it('keywords after an expression', () => {
    const cs = complete('q9 = 3 i', 8, fig);
    expect(cs.some((c) => c.label === 'in' || c.label === 'if')).toBe(true);
  });

  it('the cursor is respected: text after it is ignored', () => {
    const cs = complete('M9 = Mid(A, B)', 8, fig);
    expect(cs[0]?.label).toBe('Midpoint');
  });
});

describe('docs/features/language/ui.md 2: syntax colouring', () => {
  const tok = (src: string, f = newFig()): HighlightToken[] => tokenize(src, f).tokens;
  const kindOf = (src: string, text: string, f = newFig()): string | undefined => tok(src, f).find((t) => t.text === text)?.kind;

  it('classes with a figure', () => {
    expect(kindOf('q9 = A.x + sin(1) * pi', 'A')).toBe('object');
    expect(kindOf('q9 = Circle(A, 2)', 'Circle')).toBe('command');
    expect(kindOf('q9 = sin(1)', 'sin')).toBe('function');
    expect(kindOf('q9 = 2 * pi', 'pi')).toBe('constant');
    expect(kindOf('q9 = 2 * pi', '2')).toBe('number');
    expect(kindOf('q9 = 2 * pi', '*')).toBe('operator');
    expect(kindOf('q9 = 2 * pi', '=')).toBe('operator');
    expect(kindOf('q9 = if(true, 1, 2)', 'if')).toBe('keyword');
    expect(kindOf('q9 = 1 and 2 > 1', 'and')).toBe('keyword');
    expect(kindOf('tx = "hi"', '"hi"')).toBe('string');
    expect(kindOf('q9 = zzz', 'zzz')).toBe('unknown');
  });

  it('comments and directives', () => {
    const t = tok('q9 = 3 # note');
    expect(t[t.length - 1]?.kind).toBe('comment');
    expect(t[t.length - 1]?.text).toBe('# note');
    expect(tok('@view -5 5 -3 3')[0]?.kind).toBe('directive');
  });

  it('without a figure, names are plain', () => {
    const t = tokenize('q9 = A + 1').tokens;
    expect(t.find((x) => x.text === 'A')?.kind).toBe('name');
    expect(t.find((x) => x.text === 'q9')?.kind).toBe('name');
  });

  it('columns are 1-based UTF-16 and end exclusive; they are in the text as typed', () => {
    const t = tok('q9 = 3 \u2264 4');
    const le = t.find((x) => x.text === '\u2264');
    expect(le?.col).toBe(8);
    expect(le?.endCol).toBe(9);
    const first = t[0];
    expect(first?.line).toBe(1);
    expect(first?.col).toBe(1);
    expect(first?.endCol).toBe(3);
  });

  it('tokens do not overlap and keep source order', () => {
    const src = 'c9 = Circle(A, 2) # radius two';
    const t = tok(src);
    for (let i = 1; i < t.length; i++) {
      expect(t[i]!.col, `${t[i]!.text}`).toBeGreaterThanOrEqual(t[i - 1]!.endCol);
    }
    for (const x of t) expect(src.slice(x.col - 1, x.endCol - 1), x.text).toBe(x.text);
  });

  it('errors are returned alongside the tokens, and the tokens keep going', () => {
    const r = tokenize('q9 = 3 $ 4 + 5', newFig());
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.kind).toBe('bad_character');
    expect(r.tokens.some((t) => t.text === '5')).toBe(true);
    expect(r.tokens.some((t) => t.kind === 'error')).toBe(true);
  });

  it('a binder or parameter inside a call is not marked unknown', () => {
    const t = tok('S9 = Seq(k^2, k, 1, 5)');
    for (const k of t.filter((x) => x.text === 'k')) expect(k.kind).not.toBe('unknown');
    const f = tok('h9(x) = x^2');
    for (const x of f.filter((y) => y.text === 'x')) expect(x.kind).not.toBe('unknown');
  });
});
