/**
 * Fuzz and robustness: random truncations and single-character mutations of valid lines, junk text, huge input.
 * Docs: errors/errors.md 7 ("no exception escapes, every result is ok or an ErrorObject, and col lies within the line (+1)");
 * AGENTS.md ("nothing throws across a package boundary"); kernel/errors.md 5 rule 1 (atomic lines).
 */
import { describe, expect, it } from 'vitest';
import { Figure } from '@incantly/kernel';
import { TEST_COMMANDS, expectUnchanged, expectWellFormedError, figure, prng, snap, timed } from '../kernel/helpers';

const VALID = [
  'A = (1, 2)',
  'B2 = (4, 0)',
  'M2 = Midpoint(A, B2)',
  'a1 = 3 in 0..10 step 0.5',
  'h = sqrt(a1^2 + 16)',
  'l1 = Line(A, B2)',
  'c1 = Circle(A, a1)',
  'f(x) = x^2 - 2*x + 1',
  's1 = "hello world"',
  'L1 = [1, 2, 3]',
  'flag1 = a1 > 2',
  'A with color = red, layer = 2',
  'M2 with showIf = (a1 < 5)',
  'Rename(M2, "K2")',
  'Hide(A)',
  'Delete(c1)',
  '@view -5 5 -3 3',
  '# a comment',
  'th = state(0.5)',
  "th' = -th",
  'a1 = a1 + 1',
  'Describe(A)',
  'Undo()',
];

const ALPHABET = ['(', ')', '[', ']', ',', '"', "'", '=', '+', '-', '*', '/', '^', '.', ' ', '0', '9', 'a', 'A', 'x', '_', '#', '@', ';', '{', '}', '<', '>', '!', '|', '\\', '°', 'θ', 'é', '😀', '\t', '\u0000', '\u202e'];

function mutations(seed: number, count: number): string[] {
  const rnd = prng(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const line = VALID[Math.floor(rnd() * VALID.length)] as string;
    const kind = Math.floor(rnd() * 5);
    const pos = Math.floor(rnd() * (line.length + 1));
    const ch = ALPHABET[Math.floor(rnd() * ALPHABET.length)] as string;
    if (kind === 0) out.push(line.slice(0, pos)); // truncate
    else if (kind === 1) out.push(line.slice(0, pos) + ch + line.slice(pos)); // insert
    else if (kind === 2) out.push(line.slice(0, pos) + line.slice(pos + 1)); // delete
    else if (kind === 3) out.push(line.slice(0, pos) + ch + line.slice(pos + 1)); // replace
    else out.push(line.slice(0, pos) + line.slice(pos).split('').reverse().join('')); // scramble the tail
  }
  return out;
}

describe('single-character mutations and truncations of valid lines', () => {
  it('600 mutated lines: nothing throws, every result is ok or a well-formed error, columns are inside the line', () => {
    const f = figure(['A = (1, 2)', 'B2 = (4, 0)', 'a1 = 3 in 0..10 step 0.5', 'M2 = Midpoint(A, B2)', 'c1 = Circle(A, a1)']);
    let errors = 0;
    let oks = 0;
    for (const line of mutations(20260101, 600)) {
      let r;
      expect(() => {
        r = f.apply(line);
      }, JSON.stringify(line)).not.toThrow();
      const res = r as unknown as ReturnType<Figure['apply']>;
      if (res.ok) {
        oks++;
        continue;
      }
      errors++;
      expectWellFormedError(res);
      expect(res.col, JSON.stringify(line)).toBeGreaterThanOrEqual(1);
      expect(res.col, JSON.stringify(line)).toBeLessThanOrEqual(line.length + 1);
      expect(res.endCol, JSON.stringify(line)).toBeLessThanOrEqual(line.length + 1);
      expect(res.endCol).toBeGreaterThanOrEqual(res.col);
      expect(res.line).toBeGreaterThanOrEqual(0);
    }
    expect(errors).toBeGreaterThan(100); // the fuzz really does produce errors
    expect(oks).toBeGreaterThan(20); // and some mutations are still valid lines
  });

  it('every failing mutation leaves the figure exactly as it was (atomic line)', () => {
    const f = figure(['A = (1, 2)', 'B2 = (4, 0)', 'a1 = 3 in 0..10 step 0.5', 'M2 = Midpoint(A, B2)', 'c1 = Circle(A, a1)']);
    for (const line of mutations(77, 400)) {
      const before = snap(f);
      const r = f.apply(line);
      if (!r.ok) expectUnchanged(f, before, JSON.stringify(line));
    }
  });

  it('the figure stays consistent after a long fuzz: valid order, script reloads, undo returns to the start', () => {
    const f = figure(['A = (1, 2)', 'B2 = (4, 0)', 'a1 = 3 in 0..10 step 0.5', 'M2 = Midpoint(A, B2)']);
    for (const line of mutations(5, 500)) f.apply(line);
    for (const o of f.objects()) for (const i of o.inputs) expect(f.get(i as never)?.order ?? 1e9).toBeLessThan(o.order);
    const script = f.toScript();
    const { report, figure: g } = Figure.fromScript(script, { commands: TEST_COMMANDS, mode: 'strict' });
    expect(report.errors).toEqual([]);
    expect(g.names()).toEqual(f.names());
    while (f.undoInfo().depth > 0) {
      const u = f.undo();
      expect(u.ok).toBe(true);
    }
    expect(f.names()).toEqual([]);
  });

  it('the same mutation seed gives the same sequence of results (determinism)', () => {
    const run = (): string[] => {
      const f = figure(['A = (1, 2)', 'B2 = (4, 0)', 'a1 = 3 in 0..10 step 0.5']);
      return mutations(9, 150).map((l) => {
        const r = f.apply(l);
        return r.ok ? `ok:${r.summary}` : `${r.kind}:${r.col}:${r.endCol}:${r.fingerprint}`;
      });
    };
    expect(run()).toEqual(run());
  });

  it('mutations through dry run give the same verdict as the real line', () => {
    const f = figure(['A = (1, 2)', 'B2 = (4, 0)', 'a1 = 3 in 0..10 step 0.5', 'M2 = Midpoint(A, B2)']);
    for (const line of mutations(31, 200)) {
      const dry = f.apply(line, { dryRun: true });
      const real = f.apply(line);
      expect(dry.ok, JSON.stringify(line)).toBe(real.ok);
      if (!dry.ok && !real.ok) {
        expect(dry.kind).toBe(real.kind);
        expect([dry.col, dry.endCol]).toEqual([real.col, real.endCol]);
      }
    }
  });

  it('every prefix of every valid line is handled (the progressive typing case)', () => {
    for (const line of VALID) {
      for (let n = 0; n <= line.length; n++) {
        const f = figure(['A = (1, 2)', 'B2 = (4, 0)', 'a1 = 3 in 0..10 step 0.5', 'M2 = Midpoint(A, B2)', 'c1 = Circle(A, a1)', 'th = state(0.5)']);
        const r = f.apply(line.slice(0, n));
        if (!r.ok) {
          expectWellFormedError(r);
          expect(r.col).toBeLessThanOrEqual(n + 1);
        }
      }
    }
  });
});

describe('junk and hostile input never throws or hangs', () => {
  const big = (s: string, n: number): string => s.repeat(n);
  const JUNK: [string, string][] = [
    ['empty', ''],
    ['spaces', '     '],
    ['only a quote', '"'],
    ['only a bracket', '('],
    ['5,000 open brackets', big('(', 5000)],
    ['5,000 close brackets', big(')', 5000)],
    ['2,000 open square brackets', big('[', 2000)],
    ['deep nesting with a value', `x2 = ${big('(', 3000)}1${big(')', 3000)}`],
    ['10,000 plus signs', `x2 = ${big('1+', 5000)}1`],
    ['100,000 letters', big('a', 100_000)],
    ['5,000 quotes', big('"', 5000)],
    ['5,000 at signs', big('@', 5000)],
    ['long comment', `# ${big('x', 50_000)}`],
    ['long number', `x2 = ${big('9', 5000)}`],
    ['long decimal', `x2 = 1.${big('9', 5000)}`],
    ['control characters', 'x2 = \u0000\u0001\u0002'],
    ['bidi override', 'x2 = \u202e1\u202c'],
    ['lone surrogate', 'x2 = \ud800'],
    ['emoji soup', big('😀', 500)],
    ['NUL byte name', 'a\u0000b = 3'],
    ['a million nested parens limit', `${big('f(', 2000)}1${big(')', 2000)}`],
    ['name that is a prototype key', '__proto__ = 3'],
    ['constructor', 'constructor = (1, 2)'],
    ['toString call', 'x2 = toString(3)'],
    ['hasOwnProperty', 'hasOwnProperty = 1'],
    ['range with huge step count', 'r2 = 1 in 0..1e300 step 1e-300'],
    ['huge power', 'x2 = 9^9^9^9'],
    ['huge list range', 'L2 = [1..1e9]'],
    ['a Seq-like huge range', 'L2 = [1..99999999999]'],
    ['newline inside', 'x2 = 1\nx3 = 2'],
    ['only a comment marker', '#'],
    ['directive junk', '@view ' + big('9 ', 3000)],
    ['rename junk', `Rename(A, "${big('x', 5000)}")`],
  ];

  it.each(JUNK)('%s', (_name, line) => {
    const f = figure(['A = (1, 2)', 'B2 = (4, 0)', 'a1 = 3 in 0..10 step 0.5']);
    const before = snap(f);
    const t = timed(() => {
      let r: ReturnType<Figure['apply']> | undefined;
      expect(() => {
        r = f.apply(line);
      }).not.toThrow();
      return r;
    });
    expect(t.ms, 'a hostile line must be answered quickly').toBeLessThan(2000);
    const r = t.value as ReturnType<Figure['apply']>;
    if (!r.ok) {
      expectWellFormedError(r);
      expect(r.col).toBeLessThanOrEqual(Math.max(line.length, 1) + 1);
      expectUnchanged(f, before, _name);
    }
    // `__proto__`, `constructor` and friends must not poison anything
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'x2')).toBe(false);
  });

  it('applyBatch and fromScript also take junk without throwing', () => {
    const f = figure(['A = (1, 2)']);
    const lines = JUNK.map(([, l]) => l);
    expect(() => f.applyBatch(lines, { group: 'junk', mode: 'independent' })).not.toThrow();
    expect(() => f.applyBatch(lines, { group: 'junk' })).not.toThrow();
    const text = `@fig 1\n${lines.join('\n')}\n`;
    expect(() => Figure.fromScript(text, { commands: TEST_COMMANDS })).not.toThrow();
    expect(() => Figure.fromScript(text, { commands: TEST_COMMANDS, mode: 'strict' })).not.toThrow();
  });

  it('script text that is not a script at all', () => {
    for (const text of ['', '\n\n\n', 'not a script', '\u0000\u0001', '{"json": true}', '<html></html>', '@fig', '@fig x', '@fig -1', '@fig 1.5', '@fig 1 2']) {
      let out: ReturnType<typeof Figure.fromScript> | undefined;
      expect(() => {
        out = Figure.fromScript(text, { commands: TEST_COMMANDS });
      }, JSON.stringify(text)).not.toThrow();
      const { report } = out as ReturnType<typeof Figure.fromScript>;
      for (const e of report.errors) expectWellFormedError(e);
    }
  });

  it('API calls with junk arguments return errors or do nothing; they never throw', () => {
    const f = figure(['A = (1, 2)', 'B2 = (4, 0)', 'M2 = Midpoint(A, B2)', 'a1 = 3 in 0..10 step 0.5']);
    const junk: unknown[] = [undefined, null, NaN, Infinity, -1, 1e9, '', 'nope', {}, [], () => 1, Symbol.iterator, { x: 'a', y: 'b' }];
    const thrown: string[] = [];
    const call = (label: string, fn: () => unknown): void => {
      try {
        fn();
      } catch (e) {
        thrown.push(`${label}: ${String(e)}`);
      }
    };
    junk.forEach((j, idx) => {
      call(`#${idx} f.get`, () => f.get(j as never));
      call(`#${idx} f.cellOf`, () => f.cellOf(j as never));
      call(`#${idx} f.value`, () => f.value(j as never));
      call(`#${idx} f.rootCause`, () => f.rootCause(j as never));
      call(`#${idx} f.describe`, () => f.describe(j as never));
      call(`#${idx} f.dependentsOf`, () => f.dependentsOf(j as never));
      call(`#${idx} f.ancestorsOf`, () => f.ancestorsOf(j as never));
      call(`#${idx} f.deletePlan`, () => f.deletePlan(j as never));
      call(`#${idx} f.dragPlan`, () => f.dragPlan(j as never, j));
      call(`#${idx} f.setFree`, () => f.setFree(j as never, j, 'api'));
      call(`#${idx} f.setFree`, () => f.setFree('A', j, 'api'));
      call(`#${idx} f.setFree`, () => f.setFree('a1', j, 'drag'));
      call(`#${idx} f.setClock`, () => f.setClock(j as never));
      call(`#${idx} f.stepTo`, () => f.stepTo(j as never));
      call(`#${idx} f.slice`, () => f.slice(j as never, j as never));
      call(`#${idx} f.rename`, () => f.rename(j as never, j as never));
      call(`#${idx} f.delete`, () => f.delete(j as never));
      call(`#${idx} f.insertAt`, () => f.insertAt(j as never, 'Z = (1, 1)'));
      call(`#${idx} f.move`, () => f.move(j as never, j as never));
      call(`#${idx} f.movePlan`, () => f.movePlan(j as never, j as never));
      call(`#${idx} f.apply`, () => f.apply(j as never));
      call(`#${idx} f.suggestName`, () => f.suggestName(j as never));
    });
    expect(thrown).toEqual([]);
    // and the figure still works
    expect(f.value('M2')).toEqual({ x: 2.5, y: 1 });
    expect(f.count).toBe(4);
  });

  it('events from listeners that misbehave: a listener that throws a non-Error', () => {
    const f = figure(['A = (1, 2)']);
    f.on(() => {
      throw 'a string';
    });
    f.on(() => {
      // eslint-disable-next-line no-throw-literal
      throw undefined;
    });
    expect(() => f.apply('B2 = (1, 1)')).not.toThrow();
    expect(f.get('B2')).toBeDefined();
  });
});
