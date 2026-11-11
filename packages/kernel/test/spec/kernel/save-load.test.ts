/**
 * Saving and loading: toScript / fromScript / append, versions, strict and lenient modes, the round-trip guarantee.
 * Docs: kernel/design.md 13 and 15 (edge cases); kernel rulings K7; kernel/errors.md 1 (load_failed), 4 and 6;
 * errors/errors.md 1.5 (load_failed K041, version K042), 7.
 */
import { describe, expect, it } from 'vitest';
import { Figure, SCRIPT_VERSION, sameValue } from '@incantly/kernel';
import type { Cell } from '@incantly/kernel';
import { TEST_COMMANDS, bad, figure, idOf, must, newFigure, ok, prng, snap, timed } from './helpers';

const load = (text: string, opts: { mode?: 'lenient' | 'strict' } = {}) => Figure.fromScript(text, { commands: TEST_COMMANDS, ...opts });

const DOC_EXAMPLE = [
  '@fig 1',
  '@view -5 5 -3 3',
  '# Triangle and its midpoints',
  'A = (0, 0)',
  'B = (4, 0)',
  'C = (1, 3) with color = red',
  'a = 2 in 0..5 step 0.5',
  'M = Midpoint(A, B)',
  '@step "Bisect AC"',
  'N = Midpoint(A, C) with showIf = (a < 3), layer = 2',
  '',
].join('\n');

describe('the format (design 13.1)', () => {
  it('starts with @fig and the version', () => {
    expect(figure(['A = (0, 0)']).toScript().split('\n')[0]).toBe(`@fig ${SCRIPT_VERSION}`);
  });

  it('writes one object per line in order, dependent objects as their rule text, never their values', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'd = Distance(A, B)']);
    expect(f.toScript()).toBe('@fig 1\nA = (0, 0)\nB = (4, 0)\nM = Midpoint(A, B)\nd = Distance(A, B)\n');
  });

  it('writes the current value of a free object', () => {
    const f = figure(['A = (0, 0)', 'a = 3 in 0..10 step 0.5']);
    f.setFree('A', { x: 1.5, y: -2 }, 'api');
    f.setFree('a', 7, 'api');
    f.flush();
    const s = f.toScript();
    expect(s).toContain('A = (1.5, -2)');
    expect(s).toContain('a = 7 in 0..10 step 0.5');
  });

  it('writes numbers as the shortest text that reads back the same', () => {
    const f = figure(['a = 0.1', 'b = 1 / 3', 'c = 1e21', 'd = 123456789.123456789', 'e1 = 5e-324', 'g1 = -0.5']);
    for (const n of ['a', 'c', 'd', 'e1', 'g1']) {
      const g = load(f.toScript()).figure;
      expect(g.value(n)).toBe(f.value(n));
    }
    expect(f.toScript()).toContain('a = 0.1');
    expect(f.toScript()).not.toContain('0.1000000000000000055');
  });

  it('writes `with` only for properties that differ from the type default', () => {
    const f = figure(['A = (0, 0)', 'B = (1, 1)']);
    ok(f.apply('B with color = red, layer = 2'));
    ok(f.apply('A with layer = 0')); // the default
    const s = f.toScript();
    expect(s).toContain('B = (1, 1) with color = red, layer = 2');
    expect(s).toContain('A = (0, 0)\n');
    expect(s).not.toMatch(/A = \(0, 0\) with/);
  });

  it('keeps comments and directives in place', () => {
    const f = figure(['# the start', 'A = (0, 0)', '@view -5 5 -3 3', '# in the middle', 'B = (1, 1)', '@step "end"']);
    const lines = f.toScript().split('\n');
    expect(lines).toEqual(['@fig 1', '# the start', 'A = (0, 0)', '@view -5 5 -3 3', '# in the middle', 'B = (1, 1)', '@step "end"', '']);
  });

  it('the clock position is not saved, and neither is the cursor', () => {
    const f = figure(['A = (0, 0)', 'x1 = t']);
    f.setClock(7.25);
    f.stepTo(1);
    const s = f.toScript();
    expect(s).not.toContain('7.25');
    const g = load(s).figure;
    expect(g.clock().t).toBe(0);
    expect(g.cursor).toBe(g.count);
  });

  it('header: false leaves out @fig', () => {
    const f = figure(['A = (0, 0)']);
    expect(f.toScript({ header: false })).toBe('A = (0, 0)\n');
  });

  it('a `#` inside text is not a comment, and unicode names survive', () => {
    const f = figure(['s = "a # b"', 'θ = 0.5', 'ω = 2']);
    const g = load(f.toScript()).figure;
    expect(g.value('s')).toBe('a # b');
    expect(g.value('θ')).toBe(0.5);
    expect(g.names()).toEqual(['s', 'θ', 'ω']);
  });

  it('writes a free undefined Number as `undefined`', () => {
    const f = figure(['u = undefined', 'v = u + 1']);
    const s = f.toScript();
    expect(s).toContain('u = undefined');
    const g = load(s).figure;
    expect(g.cellOf('u')?.defined).toBe(false);
    expect(g.cellOf('v')?.defined).toBe(false);
  });

  it('states and rate rules are saved like any other line and replay the same motion', () => {
    const f = figure(['g = 9.8', 'th = state(0.6)', 'w = state(0)', "th' = w", "w' = -g * sin(th)"]);
    const g = load(f.toScript()).figure;
    f.setClock(2);
    g.setClock(2);
    expect(g.value('th')).toBe(f.value('th'));
    expect(g.value('w')).toBe(f.value('w'));
    expect(g.problems()).toEqual([]);
  });

  it('the `animate` property of design 10 is accepted on a slider', () => {
    // Design 10 and the 13.1 example use `with animate = oscillate`; design 9.1's key table does not list it.
    const f = newFigure();
    const r = f.apply('a = 2 in 0..5 step 0.5 with animate = oscillate');
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
  });
});

describe('the example file of design 13.1', () => {
  it('loads strictly with no errors', () => {
    const { figure: f, report } = load(DOC_EXAMPLE, { mode: 'strict' });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(f.names()).toEqual(['A', 'B', 'C', 'a', 'M', 'N']);
  });

  it('writes back the same text: comments, directives, order and every line (expressions may be re-printed)', () => {
    const { figure: f } = load(DOC_EXAMPLE, { mode: 'strict' });
    const out = f.toScript().split('\n');
    const want = DOC_EXAMPLE.split('\n');
    expect(out.length).toBe(want.length);
    out.forEach((line, i) => {
      if (!(want[i] as string).startsWith('N = ')) expect(line).toBe(want[i]);
    });
    const n = out.find((l) => l.startsWith('N = ')) as string;
    expect(n).toMatch(/^N = Midpoint\(A, C\) with showIf = \(?a < 3\)?, layer = 2$/);
    // and saving what was loaded is stable
    expect(load(f.toScript(), { mode: 'strict' }).figure.toScript()).toBe(f.toScript());
  });

  it('rebuilds the same figure: style and rules', () => {
    const { figure: f } = load(DOC_EXAMPLE);
    expect(must(f.styleOf(idOf(f, 'C') as never)).color).toEqual({ r: 220, g: 38, b: 38, a: 1 });
    expect(must(f.styleOf(idOf(f, 'N') as never)).layer).toBe(2);
    expect(must(f.styleOf(idOf(f, 'N') as never)).shown).toBe(true);
    f.setFree('a', 4, 'api');
    f.flush();
    expect(must(f.styleOf(idOf(f, 'N') as never)).shown).toBe(false);
    expect(must(f.steps().find((s) => s.name === 'N')).group?.title).toBe('Bisect AC');
  });
});

describe('versions (ruling K7)', () => {
  it('a file with a larger version fails with kind version (K042), listing the supported ones', () => {
    const { report, figure: f } = load('@fig 99\nA = (1, 2)\n');
    expect(report.ok).toBe(false);
    const e = report.errors[0];
    expect(e?.kind).toBe('version');
    expect(e?.code).toBe('K042');
    expect(e?.recovery).toBe('report');
    expect(e?.message).toContain('99');
    expect(e?.message).toContain('1');
    expect(f.count).toBe(0);
  });

  it('is not load_failed: the version kind is its own (K7)', () => {
    const { report } = load('@fig 2\nA = (1, 2)\n');
    expect(report.errors.map((e) => e.kind)).not.toContain('load_failed');
    expect(report.errors.map((e) => e.kind)).toContain('version');
  });

  it('the same in strict mode', () => {
    const { report } = load('@fig 99\nA = (1, 2)\n', { mode: 'strict' });
    expect(report.errors.some((e) => e.kind === 'version')).toBe(true);
  });

  it('version 1 loads', () => {
    expect(load('@fig 1\nA = (1, 2)\n').report.ok).toBe(true);
  });

  it('a file with no header is read as the current version', () => {
    // Docs are silent. A hand-written script without @fig is friendlier read as version 1 than refused.
    const { figure: f, report } = load('A = (1, 2)\nB = (3, 4)\n');
    expect(report.errors).toEqual([]);
    expect(f.count).toBe(2);
  });
});

describe('lenient mode (the default)', () => {
  const BAD = '@fig 1\nA = (1, 2)\nM = Midpoint(A, Q)\nN = Midpoint(M, A)\n# a note\nB = (2, 2)\n';

  it('applies each line on its own; a failed line is recorded and skipped; the figure is usable', () => {
    const { figure: f, report } = load(BAD);
    expect(report.ok).toBe(false);
    expect(f.names()).toEqual(['A', 'B']);
    expect(report.skipped).toBe(2);
    expect(report.errors.length).toBe(2);
    expect(report.applied).toBeGreaterThanOrEqual(2);
    ok(f.apply('C = Midpoint(A, B)'));
  });

  it('every error carries its line number in the file (comments and blank lines count)', () => {
    const { report } = load(BAD);
    expect(report.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it('a later line that read a failed name gets unknown_name with blockedBy, so the real fault is not hidden in copies', () => {
    const { report } = load(BAD);
    const [first, second] = report.errors;
    expect(first?.kind).toBe('unknown_name');
    expect(first?.token).toBe('Q');
    expect(first?.blockedBy).toBeUndefined();
    expect(second?.kind).toBe('unknown_name');
    expect(second?.blockedBy).toEqual({ line: 3, kind: 'unknown_name' });
    expect(second?.recovery).toBe('fix_earlier');
  });

  it('lines after a failed one still load', () => {
    const { figure: f } = load(BAD);
    expect(f.value('B')).toEqual({ x: 2, y: 2 });
  });

  it('a syntax error in one line does not stop the rest', () => {
    const { figure: f, report } = load('@fig 1\nA = * 2\nB = (3, 4)\nC = Midpoint(A, B)\n');
    expect(report.errors.length).toBe(2); // A fails, so C is blocked
    expect(report.errors[0]?.kind).toBe('syntax');
    expect(report.errors[0]?.line).toBe(2);
    expect(report.errors[1]?.blockedBy?.line).toBe(2);
    expect(f.names()).toEqual(['B']);
  });

  it('a line over the length limit is a limit error with its file line, and the rest load', () => {
    const long = `s = "${'x'.repeat(2100)}"`;
    const { figure: f, report } = load(`@fig 1\nA = (1, 1)\n${long}\nB = (2, 2)\n`);
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]?.kind).toBe('limit');
    expect(report.errors[0]?.line).toBe(3);
    expect(f.names()).toEqual(['A', 'B']);
  });

  it('the report errors are well-formed error objects', () => {
    const { report } = load(BAD);
    for (const e of report.errors) {
      expect(e.ok).toBe(false);
      expect(e.committed).toBe(false);
      expect(e.code).toMatch(/^[A-Z]\d{3}$/);
    }
  });

  it('CRLF line endings load, with the same line numbers', () => {
    const { report, figure: f } = load(BAD.replace(/\n/g, '\r\n'));
    expect(f.names()).toEqual(['A', 'B']);
    expect(report.errors.map((e) => e.line)).toEqual([3, 4]);
  });
});

describe('strict mode: all or nothing', () => {
  const BAD = '@fig 1\nA = (1, 2)\nM = Midpoint(A, Q)\nB = (2, 2)\n';

  it('any error discards the new figure', () => {
    const { figure: f, report } = load(BAD, { mode: 'strict' });
    expect(report.ok).toBe(false);
    expect(f.count).toBe(0);
    expect(f.toScript()).toBe('@fig 1\n');
  });

  it('reports a load_failed error (K041) and the per-line list', () => {
    const { report } = load(BAD, { mode: 'strict' });
    const lf = report.errors.find((e) => e.kind === 'load_failed');
    expect(lf).toBeDefined();
    expect(lf?.code).toBe('K041');
    expect(lf?.recovery).toBe('report');
    expect(lf?.message).toContain('1');
    expect(report.errors.some((e) => e.kind === 'unknown_name' && e.line === 3)).toBe(true);
  });

  it('loads a good file exactly as lenient does', () => {
    const text = figure(['A = (1, 2)', 'M = Midpoint(A, A)']).toScript();
    const a = load(text, { mode: 'strict' }).figure;
    const b = load(text).figure;
    expect(a.toScript()).toBe(b.toScript());
  });
});

describe('append: a load into an existing figure is one undo group', () => {
  it('adds the objects, keeps the old ones, and one undo takes the whole load back', () => {
    const f = figure(['A = (0, 0)']);
    const depth = f.undoInfo().depth;
    const report = f.append('B = (1, 1)\nC = Midpoint(A, B)\nD = Distance(A, C)\n');
    expect(report.ok).toBe(true);
    expect(f.names()).toEqual(['A', 'B', 'C', 'D']);
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.names()).toEqual(['A']);
  });

  it('lenient append keeps the good lines and reports the bad ones with file line numbers', () => {
    const f = figure(['A = (0, 0)']);
    const report = f.append('B = (1, 1)\nC = Midpoint(A, Nope)\nD = (2, 2)\n');
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.line).toBe(2);
    expect(f.names()).toEqual(['A', 'B', 'D']);
  });

  it('strict append changes nothing when a line fails', () => {
    const f = figure(['A = (0, 0)']);
    const before = snap(f);
    const report = f.append('B = (1, 1)\nC = Midpoint(A, Nope)\n', { mode: 'strict' });
    expect(report.ok).toBe(false);
    expect(snap(f)).toEqual(before);
  });
});

describe('size limits on load', () => {
  it('a file over the size limit is refused with a limit error naming file_size', () => {
    const { report, figure: f } = Figure.fromScript('@fig 1\nA = (1, 2)\n', { commands: TEST_COMMANDS, limits: { fileSize: 10 } });
    expect(report.ok).toBe(false);
    const e = report.errors.find((x) => x.kind === 'limit');
    expect(e?.params.limit).toBe('file_size');
    expect(e?.params.max).toBe(10);
    expect(f.count).toBe(0);
  });

  it('the default limit is 2 MB', () => {
    const text = `@fig 1\n# ${'x'.repeat(2 * 1024 * 1024)}\nA = (1, 2)\n`;
    const { report } = load(text);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.kind === 'limit' && e.params.limit === 'file_size')).toBe(true);
  });

  it('limits passed to fromScript apply to the loaded figure (objects)', () => {
    const { figure: f, report } = Figure.fromScript('@fig 1\na = 1\nb = 2\nc = 3\n', { commands: TEST_COMMANDS, limits: { objects: 2 } });
    expect(f.count).toBe(2);
    expect(report.errors.some((e) => e.kind === 'limit' && e.params.limit === 'objects')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The round-trip guarantee (design 13.3): random figures
// ---------------------------------------------------------------------------------------------

function randomFigureLines(seed: number, n: number): string[] {
  const rnd = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const num = (): string => String(Math.round((rnd() * 20 - 10) * 8) / 8);
  const pts: string[] = [];
  const nums: string[] = [];
  const lines: string[] = [];
  const lns: string[] = [];
  const styles = ['color = red', 'color = blue', 'layer = 3', 'width = 4', 'visible = false', 'opacity = 0.5', 'aux = true', 'label = none'];
  for (let i = 0; i < n; i++) {
    const kind = Math.floor(rnd() * 12);
    let line: string;
    if (pts.length < 2 || kind < 2) {
      const name = `P${i}`;
      line = `${name} = (${num()}, ${num()})`;
      pts.push(name);
    } else if (kind === 2) {
      const name = `n${i}`;
      line = `${name} = ${num()} in -10..10 step 0.125`;
      nums.push(name);
    } else if (kind === 3) {
      const name = `n${i}`;
      line = nums.length ? `${name} = ${pick(nums)} * 2 + ${num()}` : `${name} = ${num()}`;
      nums.push(name);
    } else if (kind === 4 || kind === 5) {
      const name = `P${i}`;
      line = `${name} = Midpoint(${pick(pts)}, ${pick(pts)})`;
      pts.push(name);
    } else if (kind === 6) {
      const name = `n${i}`;
      line = `${name} = Distance(${pick(pts)}, ${pick(pts)})`;
      nums.push(name);
    } else if (kind === 7) {
      const name = `l${i}`;
      line = `${name} = Line(${pick(pts)}, ${pick(pts)})`;
      lns.push(name);
    } else if (kind === 8 && lns.length >= 2) {
      const name = `P${i}`;
      line = `${name} = Intersect(${pick(lns)}, ${pick(lns)})`;
      pts.push(name);
    } else if (kind === 9 && nums.length) {
      const name = `n${i}`;
      line = `${name} = Reciprocal(${pick(nums)})`;
      nums.push(name);
    } else if (kind === 10) {
      line = `s${i} = "text ${i} # not a comment"`;
    } else {
      line = `b${i} = ${rnd() < 0.5 ? 'true' : 'false'}`;
    }
    lines.push(line);
    if (rnd() < 0.3) lines.push(`# note ${i}`);
    if (rnd() < 0.15) lines.push(`@step "stop ${i}"`);
  }
  // restyle a few objects
  const names = lines.filter((l) => /^[A-Za-z]\w* = /.test(l)).map((l) => l.split(' ')[0] as string);
  for (let i = 0; i < Math.min(6, names.length); i++) lines.push(`${pick(names)} with ${pick(styles)}`);
  return lines;
}

function applyLines(f: Figure, lines: readonly string[]): void {
  for (const l of lines) f.apply(l); // some random lines are rejected (e.g. a style on a type); that is fine
}

function cellsEqual(a: Cell, b: Cell): boolean {
  if (a.defined !== b.defined) return false;
  if (a.defined && b.defined) return sameValue(a.value, b.value);
  return !a.defined && !b.defined && a.reason === b.reason;
}

describe('round trip: fromScript(toScript(f)) gives the same figure', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`random figure, seed ${seed}`, () => {
      const f = newFigure();
      applyLines(f, randomFigureLines(seed, 40));
      expect(f.count).toBeGreaterThan(10);
      const script = f.toScript();
      const { figure: g, report } = load(script, { mode: 'strict' });
      expect(report.errors).toEqual([]);
      // same names, in order
      expect(g.names()).toEqual(f.names());
      // same definitions, free flags and types
      for (const o of f.objects()) {
        const p = must(g.get(o.name));
        expect(p.definition, o.name).toBe(o.definition);
        expect(p.free, o.name).toBe(o.free);
        expect(p.type, o.name).toBe(o.type);
        expect(p.range, o.name).toEqual(o.range);
        // same values at the same t
        expect(cellsEqual(p.cell, o.cell), `${o.name}: ${JSON.stringify(p.cell)} vs ${JSON.stringify(o.cell)}`).toBe(true);
        // same props
        const sf = must(f.styleOf(o.id));
        const sg = must(g.styleOf(p.id));
        expect(sg, o.name).toEqual(sf);
      }
      // ids are renumbered in order (they are not part of the file)
      const gids = g.objects().map((o) => o.id as number);
      expect([...gids].sort((x, y) => x - y)).toEqual(gids);
      // steps and comments survive
      expect(g.steps().map((s) => s.group?.title)).toEqual(f.steps().map((s) => s.group?.title));
      // and the text is stable: saving the loaded figure gives the same file
      expect(g.toScript()).toBe(script);
    });
  }

  it('after a sequence of edits, deletes and undos the saved script still loads to the same figure', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'N = Midpoint(M, B)', 'a = 3 in 0..10']);
    bad(f.apply('A = Midpoint(N, B)'), 'cycle'); // rejected, must not leave residue
    ok(f.apply('B = (9, 9)'));
    ok(f.apply('Delete(M)'));
    ok(f.undo());
    ok(f.apply('Rename(N, "K")'));
    const g = load(f.toScript(), { mode: 'strict' }).figure;
    expect(g.names()).toEqual(f.names());
    expect(g.toScript()).toBe(f.toScript());
  });

  it('values agree at a later t too (the clock is not part of the file)', () => {
    const f = figure(['A = (0, 0)', 'a = 2 in 0..5', 'x1 = a * t', "y1 = state(1)", "y1' = a"]);
    const g = load(f.toScript(), { mode: 'strict' }).figure;
    f.setClock(1.3);
    g.setClock(1.3);
    expect(g.value('x1')).toBe(f.value('x1'));
    expect(g.value('y1')).toBe(f.value('y1'));
  });

  it('every free value kind round-trips: Number, slider, Bool, Text, Point, List', () => {
    const f = figure(['a = 0.1', 'k = 3 in 0..10 step 0.5', 'flag = false', 's = "hi there"', 'P = (1.25, -3)', 'L = [1, 2, 3]']);
    const g = load(f.toScript(), { mode: 'strict' }).figure;
    for (const o of f.objects()) expect(cellsEqual(must(g.get(o.name)).cell, o.cell), o.name).toBe(true);
  });
});

describe('speed (design 13.2 and 15)', () => {
  const thousand = (): string => {
    const lines = ['@fig 1', 'A = (0, 0)', 'B = (10, 0)'];
    for (let i = 0; i < 998; i++) lines.push(`P${i} = Midpoint(${i === 0 ? 'A' : `P${i - 1}`}, B)`);
    return `${lines.join('\n')}\n`;
  };

  it('loads a 1,000-line script (target 100 ms; limit 1500 ms)', () => {
    const text = thousand();
    const { ms, value } = timed(() => load(text, { mode: 'strict' }));
    expect(value.report.errors).toEqual([]);
    expect(value.figure.count).toBe(1000);
    expect(ms).toBeLessThan(1500);
  });

  it('toScript for 1,000 objects (target 20 ms; limit 300 ms)', () => {
    const f = load(thousand()).figure;
    const { ms, value } = timed(() => f.toScript());
    expect(value.split('\n').length).toBe(1002);
    expect(ms).toBeLessThan(300);
  });
});
