/**
 * Regression tests for the checker's findings KERN-SM-1 to KERN-SM-20 (handoff/kernel/findings.md, pass 1).
 * Each test states the rule the finding broke and checks it on every case the finding names and on the obvious
 * neighbours. Built from the docs (kernel design and errors, errors design, state-machines.md) and the public API only.
 *
 * Tests that could hang run in a child process with a hard time limit (`runChild`), because a synchronous hang cannot
 * be interrupted by a Vitest timeout. The child loads the same public entry (`src/index.ts`) through Vite.
 *
 * Where the docs are silent the test takes the reading closest to the docs and says so in a comment marked "Reading:".
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry,
  COMPACT_LIMIT,
  DEFAULT_LIMITS,
  Figure,
  compactError,
  defaultsFor,
  err,
  makeNotice,
  reasonPhrase,
  validKeysFor,
} from '@incantly/kernel';
import type { ActionCall, CommandSpec, ErrorObject, FigureEvent, RuleCall, TxResult } from '@incantly/kernel';
import { TEST_COMMANDS, bad, expectUnchanged, figure, isErr, newFigure, ok, snap } from './helpers';

// ---------------------------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------------------------

const ENTRY = fileURLToPath(new URL('../../../src/index.ts', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

interface ChildResult {
  timedOut: boolean;
  status: number | null;
  stderr: string;
  out: Record<string, unknown>;
}

/**
 * Runs `body` in a fresh Node process that has `k` (the kernel's public entry) and `f` (a new `Figure`), and returns the
 * `out` object the body filled in. The process is killed after `timeoutMs`, so a hang fails fast and is reported as `timedOut`.
 */
function runChild(body: string, timeoutMs: number): ChildResult {
  const code = [
    "import { runnerImport } from 'vite';",
    `const { module: k } = await runnerImport(${JSON.stringify(ENTRY)}, { configFile: false });`,
    'const f = new k.Figure();',
    'const out = {};',
    'const now = () => performance.now();',
    body,
    'process.stdout.write("\\n@@" + JSON.stringify(out));',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: REPO_ROOT,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const tail = (r.stdout ?? '').split('\n@@').pop() ?? '';
  let out: Record<string, unknown>;
  try {
    out = JSON.parse(tail) as Record<string, unknown>;
  } catch {
    out = {};
  }
  return { timedOut, status: r.status, stderr: r.stderr ?? '', out };
}

const numParam = (name: string) => ({ name, type: 'Number' });

/** An object command `<name>(x)` with a custom rule. */
function objectCommand(name: string, run: (call: RuleCall) => unknown): CommandSpec {
  return {
    name,
    kind: 'object',
    group: 'regression',
    forms: [{ params: [numParam('x')], returns: 'Number', rule: () => ({ run }), summary: `${name} (regression test command)` }],
  };
}

/** An action command `<name>()` with a custom rule. */
function actionCommand(name: string, run: (call: ActionCall) => void): CommandSpec {
  return {
    name,
    kind: 'action',
    group: 'regression',
    forms: [{ params: [], returns: null, rule: () => ({ run }), summary: `${name} (regression test action)` }],
  };
}

function figureWith(extra: CommandSpec[], lines: readonly string[] = [], opts: { limits?: Partial<typeof DEFAULT_LIMITS> } = {}): Figure {
  const f = new Figure({ commands: [...TEST_COMMANDS, ...extra], ...opts });
  for (const line of lines) ok(f.apply(line), line);
  return f;
}

const listOf = (n: number, make: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => make(i));
const scriptLines = (f: Figure): number => f.toScript().split('\n').length;

/** Undoes until nothing is left; returns what `observe` saw after each undo (stops after `max` steps). */
function undoWalk<T>(f: Figure, observe: (f: Figure) => T, max = 40): T[] {
  const seen: T[] = [];
  for (let i = 0; i < max; i++) {
    if (!f.undo().ok) break;
    seen.push(observe(f));
  }
  return seen;
}

const point = (f: Figure, name: string): unknown => f.value(name);

/**
 * Runs `run` on every case and fails once at the end, listing each case that failed with its first message line.
 * Keeps the file to a sharp set of tests while every case in a rule is still checked.
 */
function eachCase<C extends readonly [string, ...unknown[]]>(cases: readonly C[], run: (c: C) => void): void {
  const failures: string[] = [];
  for (const c of cases) {
    try {
      run(c);
    } catch (e) {
      failures.push(`${c[0]}: ${e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)}`);
    }
  }
  expect(failures).toEqual([]);
}

// ---------------------------------------------------------------------------------------------
// KERN-SM-1. Size limits on every path
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-1: size budgets hold on every path into the figure', () => {
  // Reading: the docs give no budget for comments and directives (kernel errors.md 6 lists none). The tests accept any
  // budget that keeps the script under 20,000 lines (four times the default object limit) and report it as `limit`.
  const MAX_SCRIPT_LINES = 20_000;

  it('applyBatch refuses a batch whose text is over fileSize (atomic)', () => {
    const f = newFigure({ limits: { fileSize: 1000 } });
    const before = snap(f);
    const r = f.applyBatch(listOf(2000, (i) => `n${i} = ${i}`), { group: 'g' });
    expect(r.ok).toBe(false);
    expect(r.results.some((x) => !x.ok && x.kind === 'limit')).toBe(true);
    expectUnchanged(f, before);
  });

  it('applyBatch in independent mode never lets the script grow past fileSize', () => {
    const f = newFigure({ limits: { fileSize: 1000 } });
    const r = f.applyBatch(listOf(2000, (i) => `n${i} = ${i}`), { group: 'g', mode: 'independent' });
    expect(r.ok).toBe(false);
    expect(r.results.some((x) => !x.ok && x.kind === 'limit')).toBe(true);
    expect(f.toScript().length).toBeLessThanOrEqual(1000 + 200);
  });

  it('applyBatch with a batch under fileSize is still accepted', () => {
    const f = newFigure({ limits: { fileSize: 1000 } });
    const r = f.applyBatch(listOf(20, (i) => `n${i} = ${i}`), { group: 'g' });
    expect(r.ok).toBe(true);
    expect(f.count).toBe(20);
  });

  it('applyBatch with 100,000 comment lines is refused or cut short (not stored whole)', () => {
    const f = newFigure();
    const r = f.applyBatch(listOf(100_000, (i) => `# comment ${i}`), { group: 'g', mode: 'independent' });
    expect(r.ok).toBe(false);
    expect(r.results.some((x) => !x.ok && x.kind === 'limit')).toBe(true);
    expect(scriptLines(f)).toBeLessThanOrEqual(MAX_SCRIPT_LINES + 10);
  });

  it('the same batch in atomic mode leaves the figure as it was', () => {
    const f = figure(['a = 1']);
    const before = snap(f);
    const r = f.applyBatch(listOf(100_000, (i) => `# comment ${i}`), { group: 'g' });
    expect(r.ok).toBe(false);
    expectUnchanged(f, before);
  });

  it('a batch of ordinary size with comments is still accepted', () => {
    const f = newFigure();
    const r = f.applyBatch(['# a', 'a = 1', '# b', 'b = 2'], { group: 'g' });
    expect(r.ok).toBe(true);
    expect(f.toScript()).toContain('# b');
  });

  const REPEATED: [string, (i: number) => string][] = [
    ['comments', (i) => `# c ${i}`],
    ['@step titles', (i) => `@step "t${i}"`],
    ['@beat', (i) => `@beat ${i}`],
    ['@cell', () => '@cell A1 = 3'],
    ['@colwidth', (i) => `@colwidth A ${i % 90}`],
    ['@limit', () => '@limit objects 5000'],
  ];

  it.each(REPEATED)('repeated apply of %s hits a limit before the script is unbounded', (_label, make) => {
    const f = newFigure();
    let firstRefused = -1;
    for (let i = 0; i < 25_000; i++) {
      const r = f.apply(make(i));
      if (!r.ok) {
        expect(r.kind).toBe('limit');
        firstRefused = i;
        break;
      }
    }
    expect(firstRefused).toBeGreaterThan(0);
    expect(scriptLines(f)).toBeLessThanOrEqual(MAX_SCRIPT_LINES + 10);
  });

  it('fromScript of a file of 100,000 comment lines (under fileSize) does not keep them all', () => {
    const text = listOf(100_000, (i) => `# comment ${i}`).join('\n');
    expect(text.length).toBeLessThan(DEFAULT_LIMITS.fileSize);
    const { figure: f, report } = Figure.fromScript(text);
    expect(report.ok).toBe(false);
    expect(scriptLines(f)).toBeLessThanOrEqual(MAX_SCRIPT_LINES + 10);
  });

  it('append of the same file is bounded too', () => {
    const f = figure(['a = 1']);
    const report = f.append(listOf(100_000, (i) => `# comment ${i}`).join('\n'));
    expect(report.ok).toBe(false);
    expect(scriptLines(f)).toBeLessThanOrEqual(MAX_SCRIPT_LINES + 10);
  });

  const TEXT_CASES = (['api', 'show_me'] as const).flatMap((why) => [10_001, 20_000, 1_000_000].map((n) => [`${why} ${n}`, why, n] as const));
  it('setFree refuses a Text over 10,000 characters (api and show_me writes) and keeps the old value', () => {
    eachCase(TEXT_CASES, ([, why, n]) => {
      const f = figure(['s = "hi"']);
      const before = snap(f);
      expect(f.setFree('s', 'y'.repeat(n), why).ok).toBe(false);
      expectUnchanged(f, before);
      expect(f.value('s')).toBe('hi');
    });
  });

  it('setFree with a Text of 10,000 characters is refused or can be read back', () => {
    const f = figure(['s = "hi"']);
    const text = 'z'.repeat(10_000);
    const r = f.setFree('s', text, 'api');
    if (r.ok) {
      const { figure: g, report } = Figure.fromScript(f.toScript());
      expect(report.ok).toBe(true);
      expect(g.value('s')).toBe(text);
    } else {
      expect(f.value('s')).toBe('hi');
    }
  });

  it('many large writes cannot pile up in the journal: writes stop being accepted', () => {
    const f = figure(['s = "hi"']);
    let accepted = 0;
    for (let i = 0; i < 30; i++) {
      const r = f.setFree('s', `${i}`.repeat(400_000), 'api');
      if (r.ok) accepted++;
    }
    expect(accepted).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-2. Errors do not echo unbounded caller text
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-2: error text stays short whatever the caller sends', () => {
  const SIZES: [string, string][] = [
    ['5,000 characters', 'x'.repeat(5000)],
    ['100,000 characters', 'Q'.repeat(100_000)],
  ];

  const CALLS: [string, (f: Figure, s: string) => unknown][] = [
    ['delete', (f, s) => f.delete(s)],
    ['rename (old name)', (f, s) => f.rename(s, 'Z')],
    ['rename (new name)', (f, s) => f.rename('A', s)],
    ['setFree', (f, s) => f.setFree(s, 1, 'api')],
    ['describe', (f, s) => f.describe(s)],
    ['slice (source)', (f, s) => f.slice(s, 'A')],
    ['slice (target)', (f, s) => f.slice('A', s)],
    ['move', (f, s) => f.move(s, 0)],
    ['apply of an action naming it', (f, s) => f.apply(`Delete(${s})`)],
    ['apply of a long line', (f, s) => f.apply(`${s} = 1`)],
    ['insertAt of a long line', (f, s) => f.insertAt(0, `${s} = 1`)],
  ];

  /** The shape every error must have: short message, token and params, and a compact form that fits the budget. */
  function expectBounded(e: ErrorObject): void {
    expect(e.message.length).toBeLessThanOrEqual(400);
    expect(e.token.length).toBeLessThanOrEqual(200);
    expect(e.fingerprint.length).toBeLessThanOrEqual(300);
    for (const v of Object.values(e.params)) if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(200);
    for (const s of e.suggest) expect(s.length).toBeLessThanOrEqual(400);
    expect((e.hint ?? '').length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(e).length).toBeLessThanOrEqual(4000);
    expect(JSON.stringify(compactError(e)).length).toBeLessThanOrEqual(COMPACT_LIMIT);
    expect(JSON.stringify(compactError(e, { limit: 400 })).length).toBeLessThanOrEqual(400);
  }

  it.each(CALLS)('%s gives a bounded error for 5,000 and 100,000 characters', (_label, call) => {
    eachCase(SIZES, ([sizeLabel, s]) => {
      const f = figure(['A = (0, 0)', 'B = (1, 1)']);
      const before = snap(f);
      const e = call(f, s);
      expect(isErr(e), sizeLabel).toBe(true);
      expectBounded(e as ErrorObject);
      expectUnchanged(f, before);
    });
  });

  it('compactError fits the budget for an error built directly with a huge token, name and hint', () => {
    const big = 'k'.repeat(100_000);
    const e = err('unknown_name', { line: 1, col: 1, endCol: 2 }, { name: big }, { token: big, hint: big, source: big, suggest: [big, big, big] });
    expect(JSON.stringify(compactError(e)).length).toBeLessThanOrEqual(COMPACT_LIMIT);
    expect(JSON.stringify(compactError(e, { limit: 300 })).length).toBeLessThanOrEqual(300);
  });

  it('compactError keeps the kind, code and recovery when it has to shorten the message', () => {
    const big = 'k'.repeat(100_000);
    const e = err('unknown_name', { line: 1, col: 1, endCol: 2 }, { name: big }, { token: big });
    const c = compactError(e);
    expect(c.kind).toBe('unknown_name');
    expect(c.code).toBe(e.code);
    expect(c.recovery).toBe(e.recovery);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-3. A host's CommandRegistry is not mutated by the figures built on it
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-3: figures built on a shared CommandRegistry do not change or share it', () => {
  const LEAK = objectCommand('Leak', () => 1);

  it('building figures leaves the registry as it was', () => {
    const reg = new CommandRegistry(TEST_COMMANDS);
    const specs = reg.all().length;
    const problems = reg.problems().length;
    for (let i = 0; i < 3; i++) new Figure({ commands: reg });
    expect(reg.all().length).toBe(specs);
    expect(reg.problems().length).toBe(problems);
  });

  it('the spec list of the registry is the same list of names after many figures', () => {
    const reg = new CommandRegistry(TEST_COMMANDS);
    const names = reg.all().map((s) => s.name);
    for (let i = 0; i < 5; i++) new Figure({ commands: reg });
    expect(reg.all().map((s) => s.name)).toEqual(names);
  });

  it('a figure built on a registry still runs the host commands and the kernel actions', () => {
    const reg = new CommandRegistry(TEST_COMMANDS);
    const f = new Figure({ commands: reg });
    ok(f.apply('A = (0, 0)'));
    ok(f.apply('B = (4, 0)'));
    ok(f.apply('M = Midpoint(A, B)'));
    expect(f.value('M')).toEqual({ x: 2, y: 0 });
    ok(f.apply('Delete(M)'));
    expect(f.get('M')).toBeUndefined();
  });

  it('a command registered on one figure is not available in another figure of the same registry', () => {
    const reg = new CommandRegistry(TEST_COMMANDS);
    const figures = [new Figure({ commands: reg }), new Figure({ commands: reg })];
    figures[0]?.registry.register(LEAK);
    const r = figures[1]?.apply('k = Leak(1)');
    expect(r).toBeDefined();
    if (r !== undefined) bad(r, 'unknown_command');
  });

  it('a command registered on a figure does not reach the host registry', () => {
    const reg = new CommandRegistry(TEST_COMMANDS);
    const f = new Figure({ commands: reg });
    f.registry.register(LEAK);
    expect(reg.all().some((s) => s.name === 'Leak')).toBe(false);
    expect(new Figure({ commands: reg }).apply('k = Leak(1)').ok).toBe(false);
  });

  it('two figures built from the same spec array do not share a registry', () => {
    const specs = [...TEST_COMMANDS];
    const a = new Figure({ commands: specs });
    const b = new Figure({ commands: specs });
    a.registry.register(LEAK);
    expect(specs.length).toBe(TEST_COMMANDS.length);
    bad(b.apply('k = Leak(1)'), 'unknown_command');
  });

  it('registry.problems() of the host registry does not report duplicates after figures are built on it', () => {
    const reg = new CommandRegistry(TEST_COMMANDS);
    for (let i = 0; i < 4; i++) new Figure({ commands: reg });
    expect(reg.problems()).toEqual(new CommandRegistry(TEST_COMMANDS).problems());
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-4. setFree does not trust its caller
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-4: setFree guards fixed objects, reasons, aliasing and throwing values', () => {
  it("the 'solver' reason does not write a fixed free object", () => {
    const f = figure(['A = (1, 1) with fixed = true']);
    const before = snap(f);
    const r = f.setFree('A', { x: 5, y: 5 }, 'solver');
    expect(r.ok).toBe(false);
    expectUnchanged(f, before);
    expect(f.value('A')).toEqual({ x: 1, y: 1 });
  });

  it("the 'solver' reason does not write an unfixed free object either (the solver writes states, not free objects)", () => {
    // Reading: state-machines.md K9: "only free (or, for the solver, state) records are written".
    const f = figure(['A = (1, 1)', 'n = 3 in 0..10']);
    const before = snap(f);
    expect(f.setFree('A', { x: 5, y: 5 }, 'solver').ok).toBe(false);
    expect(f.setFree('n', 7, 'solver').ok).toBe(false);
    expectUnchanged(f, before);
  });

  it("a fixed object is still written with force for the user reasons, and the write is undoable", () => {
    const f = figure(['A = (1, 1) with fixed = true']);
    expect(f.setFree('A', { x: 2, y: 2 }, 'api').ok).toBe(false);
    const r = f.setFree('A', { x: 2, y: 2 }, 'api', { force: true });
    expect(r.ok).toBe(true);
    expect(f.value('A')).toEqual({ x: 2, y: 2 });
    ok(f.undo());
    expect(f.value('A')).toEqual({ x: 1, y: 1 });
  });

  const JUNK_WHYS: unknown[] = ['bogus', '', 'API', 'solver ', 'Drag', 42, {}, null, ['api']];
  it('a reason outside the five is refused with bad_argument', () => {
    eachCase(JUNK_WHYS.map((w) => [JSON.stringify(w) ?? String(w), w] as const), ([, why]) => {
      const f = figure(['A = (1, 1)']);
      const before = snap(f);
      bad(f.setFree('A', { x: 7, y: 7 }, why as never) as TxResult, 'bad_argument');
      expectUnchanged(f, before);
    });
  });

  it.each(['api', 'show_me', 'drag'] as const)("a write with reason '%s' is not changed afterwards by the caller", (why) => {
    const f = figure(['A = (1, 1)']);
    const v = { x: 2, y: 2 };
    expect(f.setFree('A', v, why).ok).toBe(true);
    v.x = 99;
    v.y = 99;
    f.commitDrag();
    f.flush();
    expect(point(f, 'A')).toEqual({ x: 2, y: 2 });
    expect(f.toScript()).not.toContain('99');
  });

  it('the journal keeps a copy too: undo then redo gives the value that was written', () => {
    const f = figure(['A = (1, 1)']);
    const v = { x: 2, y: 2 };
    expect(f.setFree('A', v, 'api').ok).toBe(true);
    v.x = 99;
    ok(f.undo());
    expect(point(f, 'A')).toEqual({ x: 1, y: 1 });
    ok(f.redo());
    expect(point(f, 'A')).toEqual({ x: 2, y: 2 });
  });

  it('a second free Point is copied as well, and a later write does not alias the first', () => {
    const f = figure(['A = (1, 1)', 'P = (3, 3)']);
    const w = { x: 5, y: 6 };
    expect(f.setFree('P', w, 'api').ok).toBe(true);
    expect(f.setFree('A', w, 'api').ok).toBe(true);
    w.x = -1;
    expect(point(f, 'P')).toEqual({ x: 5, y: 6 });
    expect(point(f, 'A')).toEqual({ x: 5, y: 6 });
  });

  const THROWING: [string, () => unknown][] = [
    ['a getter on x', () => ({ get x(): number { throw new Error('g'); }, y: 1 })],
    ['a getter on y', () => ({ x: 1, get y(): number { throw new Error('g'); } })],
    ['a proxy that throws on every read', () => new Proxy({}, { get() { throw new Error('p'); }, has() { throw new Error('p'); }, ownKeys() { throw new Error('p'); }, getOwnPropertyDescriptor() { throw new Error('p'); } })],
  ];
  for (const why of ['api', 'show_me', 'drag'] as const) {
    it(`setFree (${why}) with a throwing getter or proxy does not throw and changes nothing`, () => {
      eachCase(THROWING, ([, make]) => {
        const f = figure(['A = (1, 1)']);
        const before = snap(f);
        let r: unknown;
        expect(() => {
          r = f.setFree('A', make(), why);
        }).not.toThrow();
        expect((r as { ok: boolean }).ok).toBe(false);
        f.commitDrag();
        expectUnchanged(f, before);
      });
    });
  }

  it('a Number whose valueOf throws is refused without throwing', () => {
    const f = figure(['n = 3 in 0..10']);
    const bomb = { valueOf(): number { throw new Error('v'); } };
    expect(() => f.setFree('n', bomb, 'api')).not.toThrow();
    expect(f.value('n')).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-5. A seek has a step budget; a non-finite or huge time cannot hang
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-5: setClock with states always returns', () => {
  const CHILD_LIMIT_MS = 10_000;
  const SEEKS: [string, string, string][] = [
    ['Infinity', 'Infinity', ''],
    ['-Infinity', '-Infinity', ''],
    ['NaN', 'NaN', ''],
    ['1e6', '1e6', ''],
    ['1e9', '1e9', ''],
    ['1e15', '1e15', ''],
    ['1e12 inside @clock 0..1e12', '1e12', "f.apply('@clock 0..1e12');"],
  ];

  it.each(SEEKS)('setClock(%s) returns within the time limit and leaves a finite clock', (_label, target, prelude) => {
    const r = runChild(
      `${prelude}
f.apply('s1 = state(1)'); f.apply("s1' = 1");
const t0 = now(); let threw = null;
try { f.setClock(${target}); } catch (e) { threw = String(e); }
out.ms = now() - t0; out.threw = threw; out.t = f.clock().t; out.cell = f.cellOf('s1');`,
      CHILD_LIMIT_MS,
    );
    expect(r.timedOut, 'the seek did not return').toBe(false);
    expect(r.status).toBe(0);
    expect(r.out.threw).toBeNull();
    expect(Number.isFinite(r.out.t as number)).toBe(true);
    expect(r.out.ms as number).toBeLessThan(5000);
    // Either the state is undefined with `timeout` (the budget ran out) or its value is right.
    const cell = r.out.cell as { defined: boolean; value?: number; reason?: string };
    const t = r.out.t as number;
    if (cell.defined) expect(Math.abs((cell.value as number) - (1 + t))).toBeLessThan(1e-6 * (1 + t) + 1e-6);
    else expect(cell.reason).toBe('timeout');
  }, CHILD_LIMIT_MS + 10_000);

  it('after a budgeted seek far ahead, a seek back to a small time gives the exact value', () => {
    const r = runChild(
      `f.apply('s1 = state(1)'); f.apply("s1' = 1");
f.setClock(1e9);
f.setClock(5); out.v5 = f.value('s1'); out.t5 = f.clock().t;
f.setClock(120); out.v120 = f.value('s1');
f.setClock(0); out.v0 = f.value('s1');`,
      CHILD_LIMIT_MS,
    );
    expect(r.timedOut).toBe(false);
    expect(r.out.t5).toBe(5);
    expect(r.out.v5 as number).toBeCloseTo(6, 6);
    expect(r.out.v120 as number).toBeCloseTo(121, 6);
    expect(r.out.v0 as number).toBeCloseTo(1, 9);
  }, CHILD_LIMIT_MS + 10_000);

  it('repeated large seeks do not grow without bound (ten seeks to 1e9 finish in time)', () => {
    const r = runChild(
      `f.apply('s1 = state(1)'); f.apply("s1' = -s1");
const t0 = now();
for (let i = 1; i <= 10; i++) f.setClock(1e9 + i);
out.ms = now() - t0;`,
      CHILD_LIMIT_MS,
    );
    expect(r.timedOut).toBe(false);
    expect(r.out.ms as number).toBeLessThan(10_000);
  }, CHILD_LIMIT_MS + 10_000);

  it('a second order state (a pendulum) is bounded too', () => {
    const r = runChild(
      `for (const l of ['th = state(0.6)', 'w = state(0)', "th' = w", "w' = -9.8 * sin(th)"]) f.apply(l);
f.setClock(1e8); out.t = f.clock().t;`,
      CHILD_LIMIT_MS,
    );
    expect(r.timedOut).toBe(false);
    expect(r.out.t).toBe(1e8);
  }, CHILD_LIMIT_MS + 10_000);

  it('setClock with a non-finite time in a figure without states is harmless', () => {
    const f = figure(['x1 = t']);
    for (const t of [Infinity, -Infinity, NaN]) {
      expect(() => f.setClock(t)).not.toThrow();
      expect(Number.isFinite(f.clock().t)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-6. Lazy reads of long chains do not overflow the stack
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-6: reading a stale value is iterative', () => {
  function chain(n: number, limit = n + 10): Figure {
    const f = newFigure({ limits: { objects: limit } });
    const lines = ['h = 1', 'c1 = h + 1'];
    for (let i = 2; i < n; i++) lines.push(`c${i} = c${i - 1} + 1`);
    const r = f.applyBatch(lines, { group: 'build' });
    if (!r.ok) throw new Error('could not build the chain');
    return f;
  }

  it('a 5,000-object chain read in lazy mode after a write upstream (the default object limit)', () => {
    const f = chain(5000, DEFAULT_LIMITS.objects);
    f.setDemand([]);
    expect(f.setFree('h', 2, 'api').ok).toBe(true);
    f.flush();
    expect(() => f.value('c4999')).not.toThrow();
    expect(f.value('c4999')).toBe(5001);
  });

  it('a 20,000-object chain with a raised object limit', () => {
    const f = chain(20_000);
    f.setDemand([]);
    f.setFree('h', 2, 'api');
    f.flush();
    expect(() => f.value('c19999')).not.toThrow();
    expect(f.value('c19999')).toBe(20_001);
  });

  it('cellOf, get, objects and describe on the stale end of the chain do not throw', () => {
    const f = chain(5000, DEFAULT_LIMITS.objects);
    f.setDemand([]);
    f.setFree('h', 2, 'api');
    f.flush();
    expect(() => f.cellOf('c4999')).not.toThrow();
    expect(() => f.get('c4999')).not.toThrow();
    expect(() => f.describe('c4999')).not.toThrow();
    expect(() => f.objects()).not.toThrow();
    expect(f.cellOf('c4999')).toEqual({ defined: true, value: 5001 });
  });

  it('a read of the middle first, then the end, gives right values', () => {
    const f = chain(5000, DEFAULT_LIMITS.objects);
    f.setDemand([]);
    f.setFree('h', 3, 'api');
    f.flush();
    expect(f.value('c2500')).toBe(2503);
    expect(f.value('c4999')).toBe(5002);
    expect(f.value('c1')).toBe(4);
  });

  it('after a slow write the whole chain is consistent when read from the top down and the bottom up', () => {
    const f = chain(3000, DEFAULT_LIMITS.objects);
    f.setDemand([]);
    f.setFree('h', 10, 'api');
    f.flush();
    for (const i of [2999, 1, 1500, 2, 2998]) expect(f.value(`c${i}`)).toBe(10 + i);
  });

  it('two writes before one read still read right', () => {
    const f = chain(4000, DEFAULT_LIMITS.objects);
    f.setDemand([]);
    f.setFree('h', 2, 'api');
    f.flush();
    f.setFree('h', 5, 'api');
    f.flush();
    expect(f.value('c3999')).toBe(4004);
  });

  it('an undefined link in a long stale chain is read as undefined, not as a crash', () => {
    const f = newFigure({ limits: { objects: 5010 } });
    const lines = ['h = 1', 'r1 = Reciprocal(h)'];
    for (let i = 2; i < 4000; i++) lines.push(`r${i} = r${i - 1} + 1`);
    expect(f.applyBatch(lines, { group: 'build' }).ok).toBe(true);
    f.setDemand([]);
    f.setFree('h', 0, 'api');
    f.flush();
    expect(() => f.value('r3999')).not.toThrow();
    expect(f.value('r3999')).toBeUndefined();
    expect(f.cellOf('r3999')?.defined).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-7. Directive replacement is linear
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-7: a big file of comments and directives loads in bounded time', () => {
  const CHILD_LIMIT_MS = 10_000;
  const BUILD = `const n = 50000; const lines = [];
for (let i = 0; i < n; i++) lines.push('# c' + i);
for (let i = 0; i < n; i++) lines.push('@view -' + (i + 1) + ' ' + (i + 1) + ' -3 3');
const text = lines.join('\\n'); out.len = text.length;`;

  it('fromScript of 50,000 comments and 50,000 @view lines (under fileSize) returns within the time limit', () => {
    const r = runChild(`${BUILD}\nconst t0 = now(); const res = k.Figure.fromScript(text); out.ms = now() - t0; out.views = res.figure.toScript().split('\\n').filter((l) => l.startsWith('@view')).length;`, CHILD_LIMIT_MS);
    expect(r.out.len as number).toBeLessThan(DEFAULT_LIMITS.fileSize);
    expect(r.timedOut, 'the load did not return').toBe(false);
    expect(r.out.ms as number).toBeLessThan(9000);
    expect(r.out.views as number).toBeLessThanOrEqual(1);
  }, CHILD_LIMIT_MS + 10_000);

  it('applyBatch (independent) of the same lines returns within the time limit', () => {
    const r = runChild(`${BUILD}\nconst t0 = now(); f.applyBatch(lines, { group: 'g', mode: 'independent' }); out.ms = now() - t0;`, CHILD_LIMIT_MS);
    expect(r.timedOut, 'the batch did not return').toBe(false);
    expect(r.out.ms as number).toBeLessThan(9000);
  }, CHILD_LIMIT_MS + 10_000);

  it('repeated apply of one non-repeatable directive after many comments returns within the time limit', () => {
    const r = runChild(
      `for (let i = 0; i < 4000; i++) f.apply('# c' + i);
const t0 = now();
for (let i = 0; i < 20000; i++) f.apply('@view -' + (i + 1) + ' ' + (i + 1) + ' -3 3');
out.ms = now() - t0;`,
      CHILD_LIMIT_MS,
    );
    expect(r.timedOut).toBe(false);
    expect(r.out.ms as number).toBeLessThan(8000);
  }, CHILD_LIMIT_MS + 10_000);

  it('a non-repeatable directive written twice stays one line, in the place of the first', () => {
    const f = figure(['# top', 'a = 1', '@view -1 1 -1 1', 'b = 2']);
    ok(f.apply('@view -2 2 -2 2'));
    const lines = f.toScript().split('\n');
    expect(lines.filter((l) => l.startsWith('@view'))).toEqual(['@view -2 2 -2 2']);
    expect(lines.indexOf('@view -2 2 -2 2')).toBeGreaterThan(lines.indexOf('a = 1'));
    expect(lines.indexOf('@view -2 2 -2 2')).toBeLessThan(lines.indexOf('b = 2'));
  });

  it('@clock and @solver are replaced in place as well, among many comments', () => {
    const f = newFigure();
    for (let i = 0; i < 300; i++) ok(f.apply(`# c${i}`));
    ok(f.apply('@clock 0..10'));
    ok(f.apply('@solver step 1/240'));
    ok(f.apply('@clock 0..20'));
    ok(f.apply('@solver step 1/480'));
    const lines = f.toScript().split('\n');
    expect(lines.filter((l) => l.startsWith('@clock'))).toEqual(['@clock 0..20']);
    expect(lines.filter((l) => l.startsWith('@solver'))).toEqual(['@solver step 1/480']);
    expect(f.clockRange()).toEqual({ from: 0, to: 20 });
  });

  it('repeatable directives are appended, not replaced', () => {
    const f = figure(['a = 1']);
    ok(f.apply('@step "one"'));
    ok(f.apply('@step "two"'));
    ok(f.apply('@beat 1'));
    ok(f.apply('@beat 2'));
    const lines = f.toScript().split('\n');
    expect(lines.filter((l) => l.startsWith('@step'))).toEqual(['@step "one"', '@step "two"']);
    expect(lines.filter((l) => l.startsWith('@beat'))).toEqual(['@beat 1', '@beat 2']);
  });

  it('undo of a replacement brings the earlier directive back, and the index stays right', () => {
    const f = figure(['a = 1']);
    ok(f.apply('@view -1 1 -1 1'));
    ok(f.apply('@view -2 2 -2 2'));
    ok(f.undo());
    expect(f.toScript()).toContain('@view -1 1 -1 1');
    expect(f.toScript()).not.toContain('@view -2 2 -2 2');
    ok(f.undo());
    expect(f.toScript()).not.toContain('@view');
    ok(f.apply('@view -3 3 -3 3'));
    expect(f.toScript().split('\n').filter((l) => l.startsWith('@view'))).toEqual(['@view -3 3 -3 3']);
    ok(f.undo());
    ok(f.redo());
    expect(f.toScript().split('\n').filter((l) => l.startsWith('@view'))).toEqual(['@view -3 3 -3 3']);
  });

  it('after the object that anchors the directive is deleted, a new @view still replaces it', () => {
    const f = figure(['a = 1', '@view -1 1 -1 1', 'b = 2']);
    ok(f.delete('a'));
    ok(f.apply('@view -4 4 -4 4'));
    expect(f.toScript().split('\n').filter((l) => l.startsWith('@view'))).toEqual(['@view -4 4 -4 4']);
    ok(f.undo());
    ok(f.undo());
    expect(f.toScript().split('\n').filter((l) => l.startsWith('@view'))).toEqual(['@view -1 1 -1 1']);
  });

  it('a directive replaced inside a batch that rolls back is as it was', () => {
    const f = figure(['a = 1', '@view -1 1 -1 1']);
    const before = snap(f);
    const r = f.applyBatch(['@view -9 9 -9 9', 'c = nope + 1'], { group: 'g' });
    expect(r.rolledBack).toBe(true);
    expectUnchanged(f, before);
    ok(f.apply('@view -5 5 -5 5'));
    expect(f.toScript().split('\n').filter((l) => l.startsWith('@view'))).toEqual(['@view -5 5 -5 5']);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-8. A rule that re-enters the figure does not make the pass throw
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-8: re-entrant calls during a pass never throw across the boundary', () => {
  const ACTIONS: [string, (fig: Figure) => unknown][] = [
    ['apply Delete(k)', (fig) => fig.apply('Delete(k)')],
    ['delete(n)', (fig) => fig.delete('n')],
    ['delete(a)', (fig) => fig.delete('a')],
    ['apply of a new line', (fig) => fig.apply('q = 5')],
    ['redefine a', (fig) => fig.apply('a = 7')],
    ['rename k', (fig) => fig.rename('k', 'kk')],
    ['undo', (fig) => fig.undo()],
    ['redo', (fig) => fig.redo()],
    ['setFree a', (fig) => fig.setFree('a', 5, 'api')],
    ['setClock', (fig) => fig.setClock(3)],
    ['flush', (fig) => fig.flush()],
    ['applyBatch', (fig) => fig.applyBatch(['q = 1', 'r = q + a'], { group: 'g' })],
    ['insertAt', (fig) => fig.insertAt(0, 'z = 1')],
    ['move', (fig) => fig.move('n', 0, { withDependencies: true })],
    ['append', (fig) => fig.append('p1 = 1')],
    ['commitDrag', (fig) => fig.commitDrag()],
    ['setDemand', (fig) => fig.setDemand([])],
  ];

  function reentrant(action: (fig: Figure) => unknown): { f: Figure; arm: () => void } {
    const holder: { fig?: Figure } = {};
    let armed = false;
    const spec = objectCommand('Sneaky', (call) => {
      if (armed && holder.fig !== undefined) {
        armed = false;
        action(holder.fig);
      }
      return call.values[0] as number;
    });
    const f = figureWith([spec], ['a = 1', 'k = a + 1', 'm = Sneaky(a)', 'n = k + m']);
    holder.fig = f;
    return { f, arm: () => void (armed = true) };
  }

  it('a rule that calls back into the figure (any operation) does not make setFree and flush throw', () => {
    eachCase(ACTIONS, ([, action]) => {
      const { f, arm } = reentrant(action);
      arm();
      expect(() => {
        f.setFree('a', 2, 'api');
        f.flush();
      }).not.toThrow();
    });
  });

  it('after such a pass the figure can be read and used', () => {
    eachCase(ACTIONS, ([, action]) => {
      const { f, arm } = reentrant(action);
      arm();
      f.setFree('a', 2, 'api');
      f.flush();
      expect(() => {
        for (const name of f.names()) {
          expect(f.get(name)).toBeDefined();
          f.value(name);
          f.cellOf(name);
        }
        f.toScript();
        f.objects();
      }).not.toThrow();
      expect(f.apply('zz = 1').ok).toBe(true);
      expect(f.value('zz')).toBe(1);
    });
  });

  it('a rule calling Delete during setClock does not throw either', () => {
    const { f, arm } = reentrant((fig) => fig.apply('Delete(k)'));
    ok(f.apply('u = Sneaky(t)'));
    arm();
    expect(() => f.setClock(4)).not.toThrow();
  });

  it('a rule that throws on every frame does not make the list of faults grow', () => {
    const f = figure(['a = 1', 'u = Unlucky(a + 0 * t)']);
    f.setFree('a', 13, 'api');
    for (let i = 0; i < 1000; i++) f.setClock(i);
    // Reading: `faults` is protected, so the test only checks it through a cast and only when it is there.
    const faults = (f as unknown as { faults?: unknown[] }).faults;
    if (Array.isArray(faults)) expect(faults.length).toBeLessThanOrEqual(10);
    expect(f.apply('q = 5').ok).toBe(true);
  });

  it('a fault in an earlier frame does not make a later correct line fail', () => {
    const f = figure(['a = 1', 'u = Unlucky(a)']);
    f.setFree('a', 13, 'api');
    f.flush();
    const r = f.apply('q = 5');
    expect(r.ok).toBe(true);
    expect(f.value('q')).toBe(5);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-9. History inside an open journal group
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-9: Undo, Redo and nested batches act inside the open group, never outside it', () => {
  const MACRO = actionCommand('Macro', (call) => void call.figure.applyBatch(['m1 = 1'], { group: 'inner', mode: 'independent' }));
  const MACRO_FAIL = actionCommand('MacroFail', (call) => void call.figure.applyBatch(['m1 = 1', 'm2 = nope + 1'], { group: 'inner' }));
  const REWIND = actionCommand('Rewind', (call) => void call.figure.undo());
  const FORWARD = actionCommand('Forward', (call) => void call.figure.redo());
  const EXTRA = [MACRO, MACRO_FAIL, REWIND, FORWARD];

  const names = (f: Figure): string[] => [...f.names()];

  /** Undo everything, then redo everything: the script after the redo walk equals the one before. */
  function expectHistoryRoundTrips(f: Figure): void {
    const start = f.toScript();
    let guard = 0;
    while (f.undo().ok && guard++ < 50);
    expect(f.count).toBe(0);
    guard = 0;
    while (f.redo().ok && guard++ < 50);
    expect(f.toScript()).toBe(start);
  }

  describe('Undo() as a line of a batch (evidence 1 to 3)', () => {
    it.each(['independent', 'atomic'] as const)('%s: a line written before the batch survives Undo() inside it', (mode) => {
      const f = figure(['a = 1']);
      f.applyBatch(['b = 2', 'Undo()'], { group: 'g', mode });
      expect(names(f)).toContain('a');
    });

    it('independent: Undo() takes back the batch\'s own last line, or is refused and the line stays', () => {
      // Reading: kernel design 11.2 says the teacher's Undo() takes back one line. Refusing it inside a group is the
      // other reading in findings.md; both keep the earlier lines.
      const f = figure(['a = 1']);
      const r = f.applyBatch(['b = 2', 'Undo()'], { group: 'g', mode: 'independent' });
      if (names(f).includes('b')) expect(r.results[1]?.ok).toBe(false);
      else expect(names(f)).toEqual(['a']);
    });

    it('independent: after the batch, the undo and redo stacks are consistent (history round trip)', () => {
      const f = figure(['a = 1']);
      f.applyBatch(['b = 2', 'Undo()'], { group: 'g', mode: 'independent' });
      expectHistoryRoundTrips(f);
    });

    it('independent: undo() of the batch leaves the earlier line, and a second undo() takes that one', () => {
      const f = figure(['a = 1']);
      f.applyBatch(['b = 2', 'Undo()'], { group: 'g', mode: 'independent' });
      const seen = undoWalk(f, names);
      expect(seen[seen.length - 1]).toEqual([]);
      expect(seen.some((n) => n.length === 1 && n[0] === 'a') || seen.length === 1).toBe(true);
    });

    it.each([
      ['Undo() then a failing line', ['b = 2', 'Undo()', 'c = nope + 1']],
      ['two Undo() then a failing line', ['b = 2', 'Undo()', 'Undo()', 'c = nope + 1']],
      ['Undo() first', ['Undo()', 'b = 2', 'c = nope + 1']],
      ['Undo() and Redo() then a failing line', ['b = 2', 'Undo()', 'Redo()', 'c = nope + 1']],
      ['a lone Undo() and a failing line', ['Undo()', 'c = nope + 1']],
    ])('atomic rollback after %s leaves the figure and both stacks exactly as they were', (_label, lines) => {
      const f = figure(['a = 1']);
      const before = snap(f);
      const r = f.applyBatch(lines, { group: 'g' });
      expect(r.ok).toBe(false);
      expect(r.rolledBack).toBe(true);
      expectUnchanged(f, before);
    });

    it('atomic rollback keeps a non-empty redo stack as it was', () => {
      const f = figure(['a = 1', 'b = 2']);
      ok(f.undo());
      const before = snap(f);
      expect(before.redo).toBe(1);
      const r = f.applyBatch(['c = 3', 'Undo()', 'Redo()', 'd = nope + 1'], { group: 'g' });
      expect(r.rolledBack).toBe(true);
      expectUnchanged(f, before);
      ok(f.redo());
      expect(names(f)).toEqual(['a', 'b']);
    });

    it('a figure whose last batch had two lines keeps both when the next batch calls Undo()', () => {
      const f = figure([]);
      f.applyBatch(['a = 1', 'b = 2'], { group: 'g1' });
      f.applyBatch(['c = 3', 'Undo()'], { group: 'g2' });
      expect(names(f)).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('a lone Undo() in a batch does not take back the figure\'s earlier history', () => {
      const f = figure(['a = 1', 'b = 2']);
      f.applyBatch(['Undo()'], { group: 'g', mode: 'independent' });
      expect(names(f)).toEqual(['a', 'b']);
      expect(f.undoInfo().depth).toBe(2);
    });

    it('a lone Undo() in an atomic batch is refused and nothing changes', () => {
      const f = figure(['a = 1', 'b = 2']);
      const before = snap(f);
      const r = f.applyBatch(['Undo()'], { group: 'g' });
      if (!r.ok) expectUnchanged(f, before);
      else expect(names(f)).toEqual(['a', 'b']);
    });
  });

  describe('Redo() as a line of a batch', () => {
    it('a batch that calls Redo() first does not replay an entry taken back before the batch', () => {
      const f = figure(['a = 1', 'b = 2']);
      ok(f.undo());
      const r = f.applyBatch(['Redo()', 'c = 3'], { group: 'g', mode: 'independent' });
      expect(names(f)).not.toContain('b');
      expect(r.results[0]?.ok).toBe(false);
    });

    it('atomic: Redo() of something outside the batch fails the batch and leaves the figure as it was', () => {
      const f = figure(['a = 1', 'b = 2']);
      ok(f.undo());
      const before = snap(f);
      const r = f.applyBatch(['c = 3', 'Redo()'], { group: 'g' });
      expect(names(f)).not.toContain('b');
      if (!r.ok) expectUnchanged(f, before);
    });

    it('Undo() then Redo() inside a batch gives back what the Undo() took', () => {
      const f = figure(['a = 1']);
      f.applyBatch(['c = 3', 'Undo()', 'Redo()'], { group: 'g', mode: 'independent' });
      expect(names(f)).toEqual(['a', 'c']);
    });
  });

  describe('append and fromScript (evidence 4)', () => {
    it('append of a file with Undo() lines does not take back the host\'s own lines', () => {
      const f = figure(['a = 1', 'b = 2']);
      f.append('c = 3\nUndo()\nUndo()');
      expect(names(f)).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('append of a file with Undo() lines in strict mode does not take back the host\'s own lines', () => {
      const f = figure(['a = 1', 'b = 2']);
      f.append('c = 3\nUndo()\nUndo()\nUndo()', { mode: 'strict' });
      expect(names(f)).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('append of a file with a Redo() line does not replay what the host took back', () => {
      const f = figure(['a = 1', 'b = 2']);
      ok(f.undo());
      f.append('c = 3\nRedo()');
      expect(names(f)).not.toContain('b');
    });

    it('a strict append that fails after Undo() lines leaves the figure and both stacks as they were', () => {
      const f = figure(['a = 1', 'b = 2']);
      const before = snap(f);
      const rep = f.append('c = 3\nUndo()\nd = nope + 1', { mode: 'strict' });
      expect(rep.ok).toBe(false);
      expectUnchanged(f, before);
    });

    it('fromScript of a file with more Undo() lines than lines does not throw and keeps a usable figure', () => {
      let result: ReturnType<typeof Figure.fromScript> | undefined;
      expect(() => {
        result = Figure.fromScript('a = 1\nb = 2\nUndo()\nUndo()\nUndo()\nUndo()');
      }).not.toThrow();
      expect(result?.figure.apply('z = 1').ok).toBe(true);
    });
  });

  describe('re-entrant history calls from an action', () => {
    it('undo() called by an action inside a batch does not take back the earlier line', () => {
      const f = figureWith(EXTRA, ['a = 1']);
      f.applyBatch(['b = 2', 'Rewind()'], { group: 'g', mode: 'independent' });
      expect(names(f)).toContain('a');
    });

    it('redo() called by an action inside a batch does not replay an earlier entry', () => {
      const f = figureWith(EXTRA, ['a = 1', 'b = 2']);
      ok(f.undo());
      f.applyBatch(['c = 3', 'Forward()'], { group: 'g', mode: 'independent' });
      expect(names(f)).not.toContain('b');
    });

    it('an atomic batch with Rewind() and a failing line is rolled back completely', () => {
      const f = figureWith(EXTRA, ['a = 1']);
      const before = snap(f);
      const r = f.applyBatch(['b = 2', 'Rewind()', 'c = nope + 1'], { group: 'g' });
      expect(r.rolledBack).toBe(true);
      expectUnchanged(f, before);
    });
  });

  describe('nested batches (evidence 5)', () => {
    it('an atomic outer batch that fails after a nested batch is rolled back completely', () => {
      const f = figureWith(EXTRA, ['a = 1']);
      const before = snap(f);
      const r = f.applyBatch(['Macro()', 'b = 2', 'c = nope'], { group: 'outer' });
      expect(r.rolledBack).toBe(true);
      expectUnchanged(f, before);
      expect(names(f)).toEqual(['a']);
      expect(f.undoInfo().depth).toBe(1);
    });

    it('an outer batch that succeeds is one undo step including the nested lines', () => {
      const f = figureWith(EXTRA, ['a = 1']);
      const r = f.applyBatch(['Macro()', 'b = 2'], { group: 'outer' });
      expect(r.ok).toBe(true);
      expect(names(f)).toEqual(['a', 'm1', 'b']);
      expect(f.undoInfo().depth).toBe(2);
      ok(f.undo());
      expect(names(f)).toEqual(['a']);
    });

    it('an independent outer batch keeps collecting into its own group after a nested batch', () => {
      const f = figureWith(EXTRA, ['a = 1']);
      f.applyBatch(['Macro()', 'b = 2', 'c = nope'], { group: 'outer', mode: 'independent' });
      expect(names(f)).toEqual(['a', 'm1', 'b']);
      expect(f.undoInfo().depth).toBe(2);
    });

    it('a failing nested atomic batch rolls back only its own lines', () => {
      const f = figureWith(EXTRA, ['a = 1']);
      const r = f.applyBatch(['b = 2', 'MacroFail()', 'c = 3'], { group: 'outer', mode: 'independent' });
      expect(r.results.length).toBe(3);
      expect(names(f)).toEqual(['a', 'b', 'c']);
      expect(f.undoInfo().depth).toBe(2);
    });

    it('history round trip after nested batches', () => {
      const f = figureWith(EXTRA, ['a = 1']);
      f.applyBatch(['Macro()', 'b = 2', 'MacroFail()', 'c = 3'], { group: 'outer', mode: 'independent' });
      expectHistoryRoundTrips(f);
    });

    it('a nested append keeps the outer group open', () => {
      const f = figure(['a = 1']);
      const APPENDER = actionCommand('Appender', (call) => void call.figure.append('m1 = 1'));
      const g = figureWith([APPENDER], ['a = 1']);
      g.applyBatch(['Appender()', 'b = 2'], { group: 'outer', mode: 'independent' });
      expect(names(g)).toEqual(['a', 'm1', 'b']);
      expect(g.undoInfo().depth).toBe(2);
      expect(f.count).toBe(1);
    });
  });

  describe('neighbours that already work and must keep working', () => {
    it('Undo() as a single line takes back the last line', () => {
      const f = figure(['a = 1', 'b = 2']);
      ok(f.apply('Undo()'));
      expect(names(f)).toEqual(['a']);
    });

    it('undo({ unit: "line" }) takes back one line of the last group', () => {
      const f = figure(['a = 1']);
      f.applyBatch(['b = 2', 'c = 3'], { group: 'g' });
      ok(f.undo({ unit: 'line' }));
      expect(names(f)).toEqual(['a', 'b']);
      ok(f.undo());
      expect(names(f)).toEqual(['a']);
    });

    it('a batch is one undo step', () => {
      const f = figure(['a = 1']);
      f.applyBatch(['b = 2', 'c = 3', 'd = 4'], { group: 'g' });
      expect(f.undoInfo().depth).toBe(2);
      ok(f.undo());
      expect(names(f)).toEqual(['a']);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-10. A rejected line changes nothing
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-10: committed: false is always true', () => {
  const MUTATIONS: [string, (fig: Figure) => unknown][] = [
    ['adds an object', (fig) => fig.apply('Z = 1')],
    ['deletes an object', (fig) => fig.delete('a')],
    ['writes a free value', (fig) => fig.setFree('a', 5, 'api')],
    ['renames an object', (fig) => fig.rename('a', 'a2')],
    ['redefines an object', (fig) => fig.apply('a = 9')],
    ['adds a comment', (fig) => fig.apply('# hello')],
  ];

  it.each(MUTATIONS)('an action that %s and then throws: a rejected line leaves the figure unchanged', (_label, mutate) => {
    const spawn = actionCommand('Spawn', (call) => {
      mutate(call.figure);
      throw new Error('x');
    });
    const f = figureWith([spawn], ['a = 1', 'b = a + 1']);
    const before = snap(f);
    const r = f.apply('Spawn()');
    if (!r.ok) {
      expect(r.committed).toBe(false);
      expectUnchanged(f, before);
    } else {
      // The other reading (findings.md): the change is reported as committed.
      expect(snap(f)).not.toEqual(before);
    }
  });

  it('an atomic batch with a throwing action rolls back what the action did', () => {
    const spawn = actionCommand('Spawn', (call) => {
      call.figure.apply('Z = 1');
      throw new Error('x');
    });
    const f = figureWith([spawn], ['a = 1']);
    const before = snap(f);
    const r = f.applyBatch(['b = 2', 'Spawn()'], { group: 'g' });
    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(true);
    expectUnchanged(f, before);
  });

  it('an independent batch: a rejected Spawn() line leaves no Z behind', () => {
    const spawn = actionCommand('Spawn', (call) => {
      call.figure.apply('Z = 1');
      throw new Error('x');
    });
    const f = figureWith([spawn], ['a = 1']);
    const r = f.applyBatch(['b = 2', 'Spawn()', 'c = 3'], { group: 'g', mode: 'independent' });
    if (r.results[1]?.ok === false) expect(f.names()).not.toContain('Z');
    expect(f.names()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('Undo() whose replay makes a rule throw: rejected means unchanged, committed means consistent', () => {
    const f = figure(['a = 1', 'u = Unlucky(a)']);
    expect(f.setFree('a', 13, 'api').ok).toBe(true);
    f.flush();
    ok(f.apply('a = 2'));
    const before = snap(f);
    const r = f.apply('Undo()');
    if (!r.ok) {
      expectUnchanged(f, before);
    } else {
      expect(f.value('a')).toBe(13);
      expect(f.undoInfo().redoDepth).toBe(1);
    }
  });

  it('undo() whose replay makes a rule throw: rejected means unchanged, committed means consistent', () => {
    const f = figure(['a = 1', 'u = Unlucky(a)']);
    f.setFree('a', 13, 'api');
    f.flush();
    ok(f.apply('a = 2'));
    const before = snap(f);
    const r = f.undo();
    if (!r.ok) expectUnchanged(f, before);
    else {
      expect(f.value('a')).toBe(13);
      expect(f.undoInfo().redoDepth).toBe(1);
    }
  });

  it('redo() whose replay makes a rule throw: rejected means unchanged, committed means consistent', () => {
    const f = figure(['a = 1', 'u = Unlucky(a)']);
    f.setFree('a', 13, 'api');
    f.flush();
    ok(f.undo());
    expect(f.value('a')).toBe(1);
    const before = snap(f);
    const r = f.redo();
    if (!r.ok) expectUnchanged(f, before);
    else {
      expect(f.value('a')).toBe(13);
      expect(f.undoInfo().redoDepth).toBe(0);
    }
  });

  it('a line whose own rule throws (Boom) is rejected and changes nothing (already true: stays true)', () => {
    const f = figure(['a = 1']);
    const before = snap(f);
    const r = f.apply('x = Boom(a)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.committed).toBe(false);
    expectUnchanged(f, before);
  });

  it('a redefinition that makes a dependent rule throw is rejected and changes nothing', () => {
    const f = figure(['a = 1', 'u = Unlucky(a)']);
    const before = snap(f);
    const r = f.apply('a = 13');
    expect(r.ok).toBe(false);
    expectUnchanged(f, before);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-11. A gesture is ordered with the lines made during it
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-11: a gesture is journalled before the next journalled write', () => {
  const START = ['A = (0, 0)', 'C = (2, 2)', 'D = (3, 3)'];
  const P = (x: number) => ({ x, y: x });

  /** What each operation does while a drag on A is open, and how to tell that it was undone. */
  const OPS: [string, (f: Figure) => unknown, (f: Figure) => boolean][] = [
    ['apply of a new object', (f) => f.apply('B = (1, 1)'), (f) => f.get('B') === undefined],
    ['insertAt', (f) => f.insertAt(0, 'B = (1, 1)'), (f) => f.get('B') === undefined],
    ['delete', (f) => f.delete('C'), (f) => f.get('C') !== undefined],
    ['rename', (f) => f.rename('C', 'E'), (f) => f.get('C') !== undefined && f.get('E') === undefined],
    ['move', (f) => f.move('D', 1), (f) => f.names().join(',') === 'A,C,D'],
    ['setFree show_me on another object', (f) => f.setFree('C', P(9), 'show_me'), (f) => point(f, 'C') !== undefined && (point(f, 'C') as { x: number }).x === 2],
    ['setFree api on another object', (f) => f.setFree('C', P(9), 'api'), (f) => (point(f, 'C') as { x: number }).x === 2],
    ['redefinition of another object', (f) => f.apply('C = (7, 7)'), (f) => (point(f, 'C') as { x: number }).x === 2],
    ['a comment', (f) => f.apply('# note'), (f) => !f.toScript().includes('# note')],
    ['append', (f) => f.append('B = (1, 1)'), (f) => f.get('B') === undefined],
  ];

  it('during an open drag, every journalled write is undone before the gesture', () => {
    eachCase(OPS, ([, op, undone]) => {
      const f = figure(START);
      expect(f.setFree('A', P(5), 'drag').ok).toBe(true);
      f.flush();
      op(f);
      f.commitDrag();
      ok(f.undo());
      expect(undone(f), 'the later write is undone first').toBe(true);
      expect(point(f, 'A')).toEqual(P(5));
      ok(f.undo());
      expect(point(f, 'A')).toEqual(P(0));
    });
  });

  it('redo replays the gesture first, then the later write', () => {
    eachCase(OPS, ([, op, undone]) => {
      const f = figure(START);
      f.setFree('A', P(5), 'drag');
      f.flush();
      op(f);
      f.commitDrag();
      const after = f.toScript();
      ok(f.undo());
      ok(f.undo());
      ok(f.redo());
      expect(point(f, 'A')).toEqual(P(5));
      expect(undone(f)).toBe(true);
      ok(f.redo());
      expect(f.toScript()).toBe(after);
    });
  });

  it('the evidence: a redefinition of A during the drag, then commit: values go (1,1), (5,5), (0,0), removed', () => {
    const f = figure(['A = (0, 0)']);
    f.setFree('A', P(5), 'drag');
    f.flush();
    ok(f.apply('A = (1, 1)'));
    f.commitDrag();
    expect(point(f, 'A')).toEqual(P(1));
    expect(undoWalk(f, (g) => point(g, 'A'))).toEqual([P(5), P(0), undefined]);
  });

  it('slider writes around a show_me write: values go 8, 7, 5, 1, removed', () => {
    const f = figure(['a = 1 in 0..10']);
    f.setFree('a', 5, 'slider');
    f.setFree('a', 7, 'show_me');
    f.setFree('a', 8, 'slider');
    f.commitDrag();
    expect(f.value('a')).toBe(8);
    expect(undoWalk(f, (g) => g.value('a'))).toEqual([7, 5, 1, undefined]);
  });

  it('the same sequence with an api write in the middle', () => {
    const f = figure(['a = 1 in 0..10']);
    f.setFree('a', 5, 'slider');
    f.setFree('a', 7, 'api');
    f.setFree('a', 8, 'slider');
    f.commitDrag();
    expect(undoWalk(f, (g) => g.value('a'))).toEqual([7, 5, 1, undefined]);
  });

  it('a gesture whose end equals its start leaves no entry, and the later write is one step', () => {
    const f = figure(START);
    const depth = f.undoInfo().depth;
    f.setFree('A', P(5), 'drag');
    f.setFree('A', P(0), 'drag');
    f.apply('B = (1, 1)');
    f.commitDrag();
    expect(f.undoInfo().depth).toBe(depth + 1);
  });

  it('two lines during one drag: undo goes line 2, line 1, gesture', () => {
    const f = figure(START);
    f.setFree('A', P(5), 'drag');
    f.apply('B = (1, 1)');
    f.apply('B2 = (2, 2)');
    f.commitDrag();
    ok(f.undo());
    expect(f.get('B2')).toBeUndefined();
    expect(f.get('B')).toBeDefined();
    expect(point(f, 'A')).toEqual(P(5));
    ok(f.undo());
    expect(f.get('B')).toBeUndefined();
    expect(point(f, 'A')).toEqual(P(5));
    ok(f.undo());
    expect(point(f, 'A')).toEqual(P(0));
  });

  it('the gesture is committed once: a second commitDrag after a line records nothing more', () => {
    const f = figure(START);
    f.setFree('A', P(5), 'drag');
    f.apply('B = (1, 1)');
    const depth = f.undoInfo().depth;
    expect(f.commitDrag().committed).toBe(0);
    expect(f.undoInfo().depth).toBe(depth);
  });

  it('a drag that starts after the line is a separate, later entry', () => {
    const f = figure(START);
    f.apply('B = (1, 1)');
    f.setFree('A', P(5), 'drag');
    f.commitDrag();
    ok(f.undo());
    expect(point(f, 'A')).toEqual(P(0));
    expect(f.get('B')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-12. Every free Text is saved in a form that loads back
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-12: fromScript(toScript(f)) gives the same free Texts', () => {
  // Reading: kernel design 13.3 asks for the same free values after a round trip. A Text that cannot be written so that it
  // loads back may be refused by setFree instead; a Text that setFree accepts must round-trip.
  /** True when the Text was accepted (and then checked to round-trip); false when setFree refused it. */
  function roundTrips(text: string): boolean {
    const f = figure(['s = "hi"']);
    const r = f.setFree('s', text, 'api');
    if (!r.ok) {
      expect(f.value('s')).toBe('hi');
      return false;
    }
    const saved = f.toScript();
    for (const mode of ['strict', 'lenient'] as const) {
      const { figure: g, report } = Figure.fromScript(saved, { mode });
      expect(report.errors.map((e) => `${e.kind}: ${e.message}`)).toEqual([]);
      expect(report.ok).toBe(true);
      expect(g.value('s')).toBe(f.value('s'));
      expect(g.toScript()).toBe(saved);
    }
    return true;
  }

  const SPECIAL: [string, string][] = [
    ['carriage return', 'a\rb'],
    ['CRLF', 'a\r\nb'],
    ['carriage return at the end', 'abc\r'],
    ['left double quote', 'say “hi” now'],
    ['right double quote', 'x”y'],
    ['low double quote', 'x„y'],
    ['left single quote', 'x‘y'],
    ['right single quote', 'x’y'],
    ['low single quote', 'x‚y'],
    ['high reversed double quote', 'x‟y'],
    ['guillemets', '«x»'],
    ['next line (U+0085)', 'a\u0085b'],
    ['vertical tab', 'a\vb'],
    ['form feed', 'a\fb'],
    ['no-break space', 'a\u00a0b'],
    ['multiplication sign', '2 × 3'],
    ['division sign', '6 ÷ 3'],
    ['minus sign', 'a − b'],
    ['en dash', 'a – b'],
    ['pi', 'π and τ'],
    ['degree sign', '90°'],
    ['superscript', 'x²'],
    ['square root', '√x'],
    ['decomposed accent', 'e\u0301'],
    ['emoji', '😀 ok'],
    ['zero width joiner', 'a\u200db'],
    ['byte order mark', '\ufeffa'],
    ['NUL', 'a\u0000b'],
    ['empty text', ''],
    ['leading and trailing spaces', '  a  '],
    ['every special at once', '“\r„”\u2028\\"{}#\t‘’'],
  ];

  it('every special character: an accepted Text round-trips, a refused Text leaves the value alone', () => {
    eachCase(SPECIAL, ([, text]) => void roundTrips(text));
  });

  it('typographic quotes and line ends, the characters the finding names, are not left unescaped', () => {
    // Reading: the language normaliser turns “ ” „ into " and \r into a line end, so a saved Text must not hold them raw.
    for (const text of ['a\rb', 'say “hi” now', 'x„y']) {
      const f = figure(['s = "hi"']);
      if (!f.setFree('s', text, 'api').ok) continue;
      const saved = f.toScript();
      expect(saved).not.toMatch(/[\r“”„]/);
    }
  });

  // These loaded back before and must keep loading back (and be accepted).
  const KEEP: [string, string][] = [
    ['tab', 'a\tb'],
    ['newline', 'a\nb'],
    ['backslash', 'a\\b'],
    ['double quote', 'say "hi"'],
    ['open brace', '{'],
    ['close brace', '}'],
    ['interpolation look-alike', '{a} and {1 + 1}'],
    ['hash', 'a # b'],
    ['line separator (U+2028)', 'a\u2028b'],
    ['paragraph separator (U+2029)', 'a\u2029b'],
    ['plain text', 'hello world'],
  ];
  it('tab, newline, backslash, quote, braces, hash, U+2028 and U+2029 are accepted and round-trip unchanged', () => {
    eachCase(KEEP, ([, text]) => {
      expect(roundTrips(text)).toBe(true);
      const f = figure(['s = "hi"']);
      f.setFree('s', text, 'api');
      expect(f.value('s')).toBe(text);
    });
  });

  const LONG: [string, number][] = [
    ['x', 1999],
    ['x', 2000],
    ['x', 2001],
    ['x', 5000],
    ['x', 9999],
    ['"', 1500],
    ['\n', 1500],
    ['\\', 1500],
    ['{', 1500],
    ['“', 1500],
  ];
  it('long Texts (around the 2,000-character line limit, also when escaping doubles them) are refused or round-trip', () => {
    eachCase(LONG.map(([ch, n]) => [`${JSON.stringify(ch)} x ${n}`, ch, n] as const), ([, ch, n]) => void roundTrips(ch.repeat(n)));
  });

  it('several special Texts in one figure all load back, in a strict load', () => {
    const f = figure(['s1 = "a"', 'A = (1, 2)', 's2 = "b"', 'n = 3 in 0..10', 's3 = "c"']);
    const wanted: [string, string][] = [['s1', 'a\rb'], ['s2', 'say “hi”'], ['s3', 'x„y']];
    const accepted = wanted.filter(([name, text]) => f.setFree(name, text, 'api').ok);
    const { figure: g, report } = Figure.fromScript(f.toScript(), { mode: 'strict' });
    expect(report.ok).toBe(true);
    for (const [name] of accepted) expect(g.value(name)).toBe(f.value(name));
    expect(g.value('A')).toEqual({ x: 1, y: 2 });
    expect(g.value('n')).toBe(3);
  });

  it('a Text written with show_me and undone is still saved in a loadable form', () => {
    const f = figure(['s = "hi"']);
    f.setFree('s', 'a\rb“', 'show_me');
    ok(f.undo());
    ok(f.redo());
    const { report } = Figure.fromScript(f.toScript(), { mode: 'strict' });
    expect(report.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-13. @step breakpoints stay with the object they mark
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-13: insertAt and move keep a @step title on its object', () => {
  const titles = (f: Figure): string[] => f.steps().map((s) => `${s.name}:${s.group?.title ?? '-'}`);
  const BASE = ['a = 1', '@step "two"', 'b = 2'];

  it('insertAt right after the object before the @step keeps the title on the marked object', () => {
    const f = figure(BASE);
    ok(f.insertAt(1, 'w = a + 1'));
    expect(titles(f)).toEqual(['a:-', 'w:-', 'b:two']);
  });

  it('the script still writes the @step directly before the marked object', () => {
    const f = figure(BASE);
    ok(f.insertAt(1, 'w = a + 1'));
    const s = f.toScript();
    expect(s.indexOf('w = a + 1')).toBeLessThan(s.indexOf('@step "two"'));
    expect(s.indexOf('@step "two"')).toBeLessThan(s.indexOf('b = 2'));
  });

  it('apply with the insertAt option does the same', () => {
    const f = figure(BASE);
    ok(f.apply('w = a + 1', { insertAt: 1 }));
    expect(titles(f)).toEqual(['a:-', 'w:-', 'b:two']);
  });

  it('insertAt at the top keeps a title that marks the first object', () => {
    const f = figure(['@step "one"', 'a = 1', 'b = 2']);
    ok(f.insertAt(0, 'w = 5'));
    expect(titles(f)).toEqual(['w:-', 'a:one', 'b:-']);
  });

  it('insertAt at the end and in the middle of an untitled stretch leave titles alone', () => {
    const f = figure(['a = 1', '@step "two"', 'b = 2', 'c = 3']);
    ok(f.insertAt(3, 'w = 5'));
    ok(f.insertAt(4, 'v = 6'));
    expect(titles(f)).toEqual(['a:-', 'b:two', 'c:-', 'w:-', 'v:-']);
  });

  it('insertAt between two titled objects keeps both titles', () => {
    const f = figure(['@step "one"', 'a = 1', '@step "two"', 'b = 2']);
    ok(f.insertAt(1, 'w = a + 1'));
    expect(titles(f)).toEqual(['a:one', 'w:-', 'b:two']);
  });

  it('undo of insertAt gives back the same steps and the same script', () => {
    const f = figure(BASE);
    const before = f.toScript();
    ok(f.insertAt(1, 'w = a + 1'));
    ok(f.undo());
    expect(titles(f)).toEqual(['a:-', 'b:two']);
    expect(f.toScript()).toBe(before);
    ok(f.redo());
    expect(titles(f)).toEqual(['a:-', 'w:-', 'b:two']);
  });

  it('moving another object into the place before the marked one keeps the title on the marked one', () => {
    const f = figure(['a = 1', '@step "two"', 'b = 2', 'c = 3']);
    ok(f.move('c', 1));
    expect(f.names().join(',')).toBe('a,c,b');
    expect(titles(f)).toEqual(['a:-', 'c:-', 'b:two']);
  });

  it('moving the marked object takes its title with it', () => {
    // Reading: state-machines.md K12: "a @step title stays next to the object it was written after", also after move.
    const f = figure(['a = 1', 'c = 3', '@step "two"', 'b = 2']);
    ok(f.move('b', 0));
    expect(titles(f)).toEqual(['b:two', 'a:-', 'c:-']);
  });

  it('deleting the object before the marked one leaves the title on the marked one', () => {
    const f = figure(BASE);
    ok(f.delete('a'));
    expect(titles(f)).toEqual(['b:two']);
  });

  it('a save and load after insertAt gives the same steps', () => {
    const f = figure(BASE);
    ok(f.insertAt(1, 'w = a + 1'));
    const { figure: g, report } = Figure.fromScript(f.toScript(), { mode: 'strict' });
    expect(report.ok).toBe(true);
    expect(titles(g)).toEqual(titles(f));
  });

  it('a comment before the marked object stays with it too', () => {
    const f = figure(['a = 1', '# about b', '@step "two"', 'b = 2']);
    ok(f.insertAt(1, 'w = a + 1'));
    expect(titles(f)).toEqual(['a:-', 'w:-', 'b:two']);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-14. A dry run matches the commit
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-14: a dry run returns the summary, report and notices of the commit', () => {
  const view = (r: TxResult): unknown => {
    const t = ok(r);
    const { warnings: _w, ...changed } = t.changed;
    return { summary: t.summary, notices: t.notices.map((n) => `${n.kind}: ${n.message}`), changed };
  };

  const CASES: [string, string[], string, ((f: Figure) => void)?][] = [
    ['a slider value above its range', [], 'a = 20 in 0..10'],
    ['a slider value below its range', [], 'a = -5 in 0..10'],
    ['a slider value inside its range', [], 'a = 3.3 in 0..10 step 0.5'],
    ['a new object that is undefined from the start', [], 'r = Reciprocal(0)'],
    ['a new object undefined because of an input', ['p = 1'], 'q = Reciprocal(p - 1)'],
    ['a name that differs by one letter case', ['r = 1'], 'R = 1'],
    ['a longer name that differs only by case', ['abc = 1'], 'ABC = 2'],
    ['a redefinition that makes a dependent undefined', ['p = 1', 'q = Reciprocal(p)'], 'p = 0'],
    ['a redefinition that makes a dependent defined again', ['p = 0', 'q = Reciprocal(p)'], 'p = 2'],
    ['a redefinition that narrows a slider range', ['a = 8 in 0..10'], 'a = 8 in 0..3'],
    ['a new object added after the step being viewed', ['A = (0, 0)', 'B = (1, 1)'], 'C = (2, 2)', (f) => f.stepTo(1)],
    ['a plain new object', ['A = (0, 0)'], 'B = (1, 1)'],
  ];

  it('on twelve lines (clamps, undefined objects, confusable names, redefinitions, a hidden step) the dry run equals the commit', () => {
    eachCase(CASES, ([, setup, line, prep]) => {
      const a = figure(setup);
      const b = figure(setup);
      prep?.(a);
      prep?.(b);
      const before = snap(a);
      const dry = a.apply(line, { dryRun: true });
      expectUnchanged(a, before, 'a dry run changes nothing');
      expect(view(dry)).toEqual(view(b.apply(line)));
    });
  });

  it('the three lines of the finding', () => {
    expect(ok(figure([]).apply('a = 20 in 0..10', { dryRun: true })).summary).toBe('a = 10');
    expect(ok(figure([]).apply('r = Reciprocal(0)', { dryRun: true })).changed.becameUndefined).toEqual([{ name: 'r', reason: 'division_by_zero' }]);
    expect(ok(figure(['r = 1']).apply('R = 1', { dryRun: true })).notices.map((n) => n.kind)).toEqual(['confusable_name']);
  });

  it('a dry run of a line that fails gives the same error as the commit', () => {
    const a = figure(['p = 1']);
    const b = figure(['p = 1']);
    const dry = a.apply('q = nope + 1', { dryRun: true });
    const real = b.apply('q = nope + 1');
    expect(dry.ok).toBe(false);
    expect(real.ok).toBe(false);
    if (!dry.ok && !real.ok) expect([dry.kind, dry.code, dry.message]).toEqual([real.kind, real.code, real.message]);
  });

  it('a dry run of a comment and of a directive matches the commit', () => {
    for (const line of ['# note', '@view -5 5 -3 3']) {
      const dry = figure(['A = (0, 0)']).apply(line, { dryRun: true });
      const real = figure(['A = (0, 0)']).apply(line);
      expect(view(dry)).toEqual(view(real));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-15. Rollbacks restore both stacks and the listeners' view; events keep their order
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-15: a rejected strict load is invisible, and listeners see one order', () => {
  function listen(f: Figure): { seq: string[]; stop: () => void } {
    const seq: string[] = [];
    const stop = f.on((ev: FigureEvent) => {
      seq.push('id' in ev ? `${ev.ev}:${ev.id}` : 'ids' in ev ? `${ev.ev}:${ev.ids.join('+')}` : ev.ev);
    });
    return { seq, stop };
  }

  it('a rejected strict append keeps the redo stack', () => {
    const f = figure(['a = 1', 'b = 2']);
    ok(f.undo());
    const before = snap(f);
    expect(before.redo).toBe(1);
    const rep = f.append('c = 3\nd = nope + 1', { mode: 'strict' });
    expect(rep.ok).toBe(false);
    expectUnchanged(f, before);
    ok(f.redo());
    expect(f.names()).toEqual(['a', 'b']);
  });

  it('a rejected strict append sends listeners no events at all', () => {
    const f = figure(['a = 1', 'b = 2']);
    ok(f.undo());
    const { seq } = listen(f);
    f.append('c = 3\nd = nope + 1', { mode: 'strict' });
    expect(seq).toEqual([]);
  });

  it('a rejected strict append in a figure with nothing to redo sends no events either', () => {
    const f = figure(['a = 1']);
    const { seq } = listen(f);
    f.append('c = 3\nd = nope + 1', { mode: 'strict' });
    expect(seq).toEqual([]);
  });

  it('a strict append refused for its size leaves the figure, the stacks and the listeners alone', () => {
    const f = newFigure({ limits: { fileSize: 50 } });
    ok(f.apply('a = 1'));
    ok(f.apply('b = 2'));
    ok(f.undo());
    const before = snap(f);
    const { seq } = listen(f);
    const rep = f.append(listOf(30, (i) => `n${i} = ${i}`).join('\n'), { mode: 'strict' });
    expect(rep.ok).toBe(false);
    expectUnchanged(f, before);
    expect(seq).toEqual([]);
  });

  it('an atomic batch that fails keeps the redo stack and sends no events (already true: stays true)', () => {
    const f = figure(['a = 1', 'b = 2']);
    ok(f.undo());
    const before = snap(f);
    const { seq } = listen(f);
    const r = f.applyBatch(['c = 3', 'd = nope + 1'], { group: 'g' });
    expect(r.rolledBack).toBe(true);
    expectUnchanged(f, before);
    expect(seq).toEqual([]);
  });

  it('a lenient append that succeeds still clears the redo stack and sends events', () => {
    const f = figure(['a = 1', 'b = 2']);
    ok(f.undo());
    const { seq } = listen(f);
    expect(f.append('c = 3').ok).toBe(true);
    expect(f.undoInfo().redoDepth).toBe(0);
    expect(seq.some((s) => s.startsWith('add'))).toBe(true);
  });

  it('listeners see the same events in the same order when the first one changes the figure', () => {
    const f = newFigure();
    const first = listen(f);
    f.on((ev) => {
      if (ev.ev === 'add' && f.get('X') !== undefined && ev.id === f.get('X')?.id) f.apply('Delete(X)');
    });
    const second = listen(f);
    ok(f.apply('X = 1'));
    expect(second.seq).toEqual(first.seq);
    const addAt = second.seq.findIndex((s) => s.startsWith('add:'));
    const removeAt = second.seq.findIndex((s) => s.startsWith('remove:'));
    expect(addAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeGreaterThan(addAt);
  });

  it('an event raised inside a listener is delivered after the current one, to every listener', () => {
    const f = figure(['a = 1 in 0..10', 'b = a + 1']);
    const first = listen(f);
    let acted = false;
    f.on((ev) => {
      if (ev.ev === 'value' && !acted) {
        acted = true;
        f.setFree('a', 7, 'api');
        f.flush();
      }
    });
    const second = listen(f);
    f.setFree('a', 2, 'slider');
    f.flush();
    expect(second.seq).toEqual(first.seq);
    expect(f.value('b')).toBe(8);
  });

  it('three listeners that all re-enter see one sequence', () => {
    const f = newFigure();
    const seqs = [0, 1, 2].map(() => listen(f).seq);
    let n = 0;
    f.on((ev) => {
      if (ev.ev === 'add' && n++ < 2) f.apply(`Y${n} = ${n}`);
    });
    const tail = listen(f);
    ok(f.apply('X = 1'));
    for (const s of seqs) expect(s).toEqual(tail.seq);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-16. A change that does not touch a state does not restart the integration
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-16: the solver keeps its checkpoints when the states are not affected', () => {
  const RUN_LIMIT = 2000; // a restart at t = 100 costs 96,000 rule runs; one line should cost about none

  function ticking(): { f: Figure; counter: { n: number } } {
    const counter = { n: 0 };
    const tick = objectCommand('Tick', (call) => {
      counter.n++;
      return (call.values[0] as number) + 0 * call.t;
    });
    const f = figureWith([tick], ['k = 1', 's1 = state(1)', "s1' = Tick(k)"]);
    f.setClock(100);
    expect(f.value('s1')).toBeCloseTo(101, 6);
    return { f, counter };
  }

  const UNRELATED: [string, (f: Figure) => unknown][] = [
    ['a new number', (f) => f.apply('q = 5')],
    ['a new point', (f) => f.apply('P = (1, 2)')],
    ['a comment', (f) => f.apply('# note')],
    ['a directive', (f) => f.apply('@view -5 5 -3 3')],
    ['a new object that reads the state', (f) => f.apply('r = s1 + 1')],
    ['a free write', (f) => f.setFree('k', 1, 'api')],
    ['insertAt at the top', (f) => f.insertAt(0, 'z = 2')],
    ['a batch of five lines', (f) => f.applyBatch(listOf(5, (i) => `bb${i} = ${i}`), { group: 'g' })],
    ['an appended file of ten lines', (f) => f.append(listOf(10, (i) => `ap${i} = ${i}`).join('\n'))],
  ];

  it('an unrelated line, batch, append, free write or insertAt does not re-integrate from the start', () => {
    eachCase(UNRELATED, ([, op]) => {
      const { f, counter } = ticking();
      counter.n = 0;
      op(f);
      f.flush();
      expect(counter.n).toBeLessThan(RUN_LIMIT);
      expect(f.value('s1')).toBeCloseTo(101, 6);
    });
  });

  it('deleting, renaming and undoing unrelated objects does not re-integrate either', () => {
    const { f, counter } = ticking();
    ok(f.apply('q = 5'));
    ok(f.apply('P = (1, 2)'));
    counter.n = 0;
    ok(f.rename('q', 'q2'));
    ok(f.delete('P'));
    ok(f.undo());
    ok(f.redo());
    ok(f.undo());
    f.flush();
    expect(counter.n).toBeLessThan(RUN_LIMIT);
    expect(f.value('s1')).toBeCloseTo(101, 6);
  });

  it('twenty unrelated lines in a row cost less than one restart in total', () => {
    const { f, counter } = ticking();
    counter.n = 0;
    for (let i = 0; i < 20; i++) ok(f.apply(`u${i} = ${i}`));
    expect(counter.n).toBeLessThan(RUN_LIMIT);
  });

  it('a seek forward after unrelated lines continues from the checkpoints and is right', () => {
    const { f, counter } = ticking();
    ok(f.apply('q = 5'));
    counter.n = 0;
    f.setClock(110);
    expect(counter.n).toBeLessThan(RUN_LIMIT);
    expect(f.value('s1')).toBeCloseTo(111, 6);
    f.setClock(50);
    expect(f.value('s1')).toBeCloseTo(51, 6);
  });

  it('a change that does reach the rate still re-integrates, and the value is right', () => {
    const { f, counter } = ticking();
    counter.n = 0;
    ok(f.apply('k = 3'));
    f.flush();
    expect(counter.n).toBeGreaterThan(RUN_LIMIT);
    expect(f.value('s1')).toBeCloseTo(301, 6);
    ok(f.undo());
    expect(f.value('s1')).toBeCloseTo(101, 6);
  });

  it('redefining the rate gives the new answer at once', () => {
    const { f } = ticking();
    ok(f.apply("s1' = Tick(2)"));
    f.flush();
    expect(f.value('s1')).toBeCloseTo(201, 6);
  });

  it('a new state added later is integrated correctly and the old one is kept', () => {
    const { f } = ticking();
    ok(f.apply('s2 = state(0)'));
    ok(f.apply("s2' = 2"));
    f.flush();
    expect(f.value('s1')).toBeCloseTo(101, 6);
    expect(f.value('s2')).toBeCloseTo(200, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-17. The cost of adding an object does not grow with the figure
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-17: loading is linear', () => {
  const loadMs = (n: number): number => {
    const text = listOf(n, (i) => `v${i} = ${i}`).join('\n');
    const t0 = performance.now();
    const { figure: f } = Figure.fromScript(text);
    const ms = performance.now() - t0;
    expect(f.count).toBe(n);
    return ms;
  };
  const best = (n: number, times = 4): number => Math.min(...Array.from({ length: times }, () => loadMs(n)));

  it('the cost per line at 4,500 lines is under 2.2 times the cost per line at 500 lines', () => {
    loadMs(500);
    loadMs(4500);
    const small = best(500) / 500;
    const large = best(4500) / 4500;
    expect(large / small).toBeLessThan(2.2);
  });

  it('appending 200 objects to a 4,000-object figure costs about what it costs on a 500-object one', () => {
    const grow = (base: number): number => {
      const f = Figure.fromScript(listOf(base, (i) => `v${i} = ${i}`).join('\n')).figure;
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) f.apply(`w${i} = ${i}`);
      return performance.now() - t0;
    };
    grow(500);
    grow(4000);
    const small = Math.min(grow(500), grow(500), grow(500));
    const large = Math.min(grow(4000), grow(4000), grow(4000));
    expect(large / Math.max(small, 0.05)).toBeLessThan(2.5);
  });

  it('adding an object still reports a name that differs only by case, and keeps the order right', () => {
    const f = figure(['abc = 1', 'Q1 = 2']);
    const r = ok(f.apply('ABC = 3'));
    expect(r.notices.map((n) => n.kind)).toContain('confusable_name');
    expect(ok(f.apply('q1 = 4')).notices.map((n) => n.kind)).toContain('confusable_name');
    expect(f.objects().map((o) => o.order)).toEqual([0, 1, 2, 3]);
    ok(f.insertAt(1, 'mid = 9'));
    expect(f.objects().map((o) => `${o.name}:${o.order}`)).toEqual(['abc:0', 'mid:1', 'Q1:2', 'ABC:3', 'q1:4']);
  });

  it('the case-insensitive name index follows rename, delete and undo', () => {
    const f = figure(['abc = 1']);
    ok(f.rename('abc', 'xyz'));
    expect(ok(f.apply('ABC = 2')).notices.map((n) => n.kind)).not.toContain('confusable_name');
    ok(f.rename('ABC', 'Xyz'));
    ok(f.delete('Xyz'));
    expect(ok(f.apply('XYZ = 3')).notices.map((n) => n.kind)).toContain('confusable_name');
    ok(f.undo());
    ok(f.undo());
    expect(ok(f.apply('qqq = 3')).notices.map((n) => n.kind)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-18. A listener failure is reported on the operation it happened in
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-18: listener_failed does not leak to the next line', () => {
  const kinds = (r: TxResult): string[] => ok(r).notices.map((n) => n.kind);

  function failingOnce(f: Figure): { arm: () => void } {
    let armed = false;
    f.on((ev) => {
      if (armed && ev.ev === 'value') {
        armed = false;
        throw new Error('listener bug');
      }
    });
    return { arm: () => void (armed = true) };
  }

  it('a failure during a slider frame is not reported on the next apply', () => {
    const f = figure(['a = 1 in 0..10', 'b = a + 1']);
    const l = failingOnce(f);
    l.arm();
    f.setFree('a', 2, 'slider');
    expect(() => f.flush()).not.toThrow();
    expect(kinds(f.apply('c = 5'))).not.toContain('listener_failed');
  });

  it('a failure during a seek is not reported on the next apply', () => {
    const f = figure(['x1 = t', 'x2 = x1 + 1']);
    const l = failingOnce(f);
    l.arm();
    f.setClock(3);
    expect(kinds(f.apply('c = 5'))).not.toContain('listener_failed');
  });

  it('a failure during a frame is not reported on the next batch either', () => {
    const f = figure(['a = 1 in 0..10', 'b = a + 1']);
    const l = failingOnce(f);
    l.arm();
    f.setFree('a', 2, 'slider');
    f.flush();
    const r = f.applyBatch(['c = 5', 'd = 6'], { group: 'g' });
    expect(r.notices.map((n) => n.kind)).not.toContain('listener_failed');
  });

  it('a failure during one apply is reported on that apply and not on the next one', () => {
    const f = figure(['a = 1']);
    const l = failingOnce(f);
    l.arm();
    expect(kinds(f.apply('c = 5'))).toContain('listener_failed');
    expect(kinds(f.apply('d = 6'))).not.toContain('listener_failed');
  });

  it('a failure during an undo is not reported on the next line', () => {
    const f = figure(['a = 1', 'b = 2']);
    const l = failingOnce(f);
    l.arm();
    f.undo();
    expect(kinds(f.apply('c = 5'))).not.toContain('listener_failed');
  });

  it('a failure in a frame does not make the frame throw', () => {
    const f = figure(['a = 1 in 0..10']);
    f.on(() => {
      throw new Error('always');
    });
    f.setFree('a', 3, 'slider');
    expect(() => f.flush()).not.toThrow();
    expect(() => f.setClock(1)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-19. Exported tables ignore names that Object.prototype owns
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-19: exported helpers never throw on Object.prototype member names', () => {
  const PROTO_NAMES = [...Object.getOwnPropertyNames(Object.prototype), 'prototype', 'length', 'name'];

  const NAMES = PROTO_NAMES.map((n) => [n] as const);

  it('validKeysFor returns a list', () => {
    eachCase(NAMES, ([n]) => {
      let keys: unknown;
      expect(() => {
        keys = validKeysFor(n);
      }).not.toThrow();
      expect(Array.isArray(keys)).toBe(true);
    });
  });

  it('defaultsFor returns the default properties', () => {
    eachCase(NAMES, ([n]) => {
      for (const free of [true, false]) {
        let props: unknown;
        expect(() => {
          props = defaultsFor(n, free);
        }).not.toThrow();
        expect(typeof (props as { visible?: unknown }).visible).toBe('boolean');
      }
    });
  });

  it('makeNotice returns a notice with a message', () => {
    eachCase(NAMES, ([n]) => {
      let notice: { message?: unknown } | undefined;
      expect(() => {
        notice = makeNotice(n as never);
      }).not.toThrow();
      expect(typeof notice?.message).toBe('string');
    });
  });

  it('reasonPhrase gives a phrase with text, not a function', () => {
    eachCase(NAMES, ([n]) => {
      const p = reasonPhrase(n);
      expect(typeof p).toBe('object');
      expect(typeof p.noun).toBe('string');
      expect(typeof p.sentence).toBe('string');
    });
  });

  it('err with such a kind falls back to an error object', () => {
    eachCase(NAMES, ([n]) => {
      let e: ErrorObject | undefined;
      expect(() => {
        e = err(n as never, { line: 1, col: 1, endCol: 1 });
      }).not.toThrow();
      expect(e?.ok).toBe(false);
      expect(e?.committed).toBe(false);
      expect(typeof e?.message).toBe('string');
    });
  });

  it('the figure treats these names as ordinary missing names', () => {
    const f = figure(['A = (0, 0)']);
    for (const n of PROTO_NAMES) {
      expect(f.get(n)).toBeUndefined();
      expect(f.value(n)).toBeUndefined();
      expect(f.cellOf(n)).toBeUndefined();
      expect(isErr(f.describe(n))).toBe(true);
      expect(isErr(f.delete(n))).toBe(true);
    }
  });

  it('Object.prototype is not changed by any of these calls', () => {
    for (const n of PROTO_NAMES) {
      validKeysFor(n);
      defaultsFor(n, true);
      makeNotice(n as never);
      reasonPhrase(n);
    }
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// KERN-SM-20. One notice per fact
// ---------------------------------------------------------------------------------------------

describe('KERN-SM-20: a clamped slider gets one clamped notice', () => {
  const clamped = (r: TxResult): number => ok(r).notices.filter((n) => n.kind === 'clamped').length;

  it('a new slider above, below, far outside or on a stepped range gets one', () => {
    eachCase(
      [
        ['above the range', 'a = 20 in 0..10'],
        ['below the range', 'a = -5 in 0..10'],
        ['above a stepped range', 'a = 99 in 0..10 step 0.5'],
        ['far outside', 'a = 1e9 in 0..10'],
      ] as const,
      ([, line]) => expect(clamped(newFigure().apply(line))).toBe(1),
    );
  });

  it('a dry run of the same line gives one too', () => {
    expect(clamped(newFigure().apply('a = 20 in 0..10', { dryRun: true }))).toBe(1);
  });

  it('a redefinition that narrows the range around the value', () => {
    const f = figure(['a = 8 in 0..10']);
    expect(clamped(f.apply('a = 8 in 0..3'))).toBe(1);
  });

  it('two clamped sliders in one batch give one notice each', () => {
    const f = newFigure();
    const r = f.applyBatch(['a = 20 in 0..10', 'b = 30 in 0..10'], { group: 'g' });
    expect(r.notices.filter((n) => n.kind === 'clamped').length).toBe(2);
  });

  it('a slider inside its range gets none', () => {
    expect(clamped(newFigure().apply('a = 5 in 0..10'))).toBe(0);
  });

  it('the notice is still there and says the final value', () => {
    const r = ok(newFigure().apply('a = 20 in 0..10'));
    const n = r.notices.find((x) => x.kind === 'clamped');
    expect(n?.message).toMatch(/10/);
    expect(r.summary).toBe('a = 10');
  });
});
