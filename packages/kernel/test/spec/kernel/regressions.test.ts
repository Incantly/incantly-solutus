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
import { TEST_COMMANDS, bad, expectUnchanged, figure, isErr, newFigure, ok, runs, snap } from './helpers';

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

  const OVER = [10_001, 20_000, 1_000_000];
  const WHYS = ['api', 'show_me'] as const;
  for (const why of WHYS) {
    it.each(OVER)(`setFree (${why}) refuses a Text of %i characters and keeps the old value`, (n) => {
      const f = figure(['s = "hi"']);
      const before = snap(f);
      const r = f.setFree('s', 'y'.repeat(n), why);
      expect(r.ok).toBe(false);
      expectUnchanged(f, before);
      expect(f.value('s')).toBe('hi');
    });
  }

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

  for (const [sizeLabel, s] of SIZES) {
    it.each(CALLS)(`${sizeLabel}: %s gives a bounded error`, (_label, call) => {
      const f = figure(['A = (0, 0)', 'B = (1, 1)']);
      const before = snap(f);
      const e = call(f, s);
      expect(isErr(e)).toBe(true);
      expectBounded(e as ErrorObject);
      expectUnchanged(f, before);
    });
  }

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
  it.each(JUNK_WHYS.map((w) => [JSON.stringify(w) ?? String(w), w] as const))('a reason outside the five (%s) is refused with bad_argument', (_label, why) => {
    const f = figure(['A = (1, 1)']);
    const before = snap(f);
    const r = f.setFree('A', { x: 7, y: 7 }, why as never);
    bad(r as TxResult, 'bad_argument');
    expectUnchanged(f, before);
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
    it.each(THROWING)(`setFree (${why}) with %s does not throw and changes nothing`, (_label, make) => {
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
  }

  it('a Number whose valueOf throws is refused without throwing', () => {
    const f = figure(['n = 3 in 0..10']);
    const bomb = { valueOf(): number { throw new Error('v'); } };
    expect(() => f.setFree('n', bomb, 'api')).not.toThrow();
    expect(f.value('n')).toBe(3);
  });
});
