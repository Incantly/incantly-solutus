/** The SDK app core (.kiro/specs/sdk R1; embed-files-export design 3, errors 1). */
import { describe, expect, it } from 'vitest';
import { createHeadlessApp } from '../../src/index';
import type { AppEvent, LineOk, LineResult, Scheduler, Ticker } from '../../src/index';

/** A scheduler the test drives: microtasks and frames run when asked. */
function manual(): Scheduler & { micro_: (() => void)[]; frame_: (() => void)[]; run(): void } {
  const s = {
    micro_: [] as (() => void)[],
    frame_: [] as (() => void)[],
    micro: (fn: () => void) => void s.micro_.push(fn),
    frame: (fn: () => void) => void s.frame_.push(fn),
    run() {
      while (s.micro_.length > 0) (s.micro_.shift() as () => void)();
      while (s.frame_.length > 0) (s.frame_.shift() as () => void)();
    },
  };
  return s;
}

const ok = (r: LineResult | undefined): LineOk => {
  if (!r || !r.ok) throw new Error(r ? r.message : 'no result');
  return r;
};

describe('run and runBatch (R1.2)', () => {
  it('each line is its own step, with what it created and changed', () => {
    const app = createHeadlessApp({ script: 'a = 2' });
    const [r1, r2, r3] = app.run(['b = a + 1', 'c = b * 2', 'a = 5']);
    expect(ok(r1)).toMatchObject({ name: 'b', type: 'Number', created: ['b'] });
    expect(ok(r2).created).toEqual(['c']);
    expect(ok(r3).changed.sort()).toEqual(['b', 'c']);
    expect(app.value('c')).toBe(12);
  });

  it('a bad line is a kernel error and changes nothing; the others apply', () => {
    const app = createHeadlessApp();
    const rs = app.run('x1 = 3\ny1 = nope + 1\nz1 = x1 * 2');
    expect(rs).toHaveLength(3);
    expect(rs[1]?.ok).toBe(false);
    expect((rs[1] as { kind: string }).kind).toBe('unknown_name');
    expect(app.value('z1')).toBe(6);
  });

  it('runBatch is all or nothing', () => {
    const app = createHeadlessApp();
    const r = app.runBatch(['p = 1', 'q = p + oops']);
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(0);
    expect(app.exists('p')).toBe(false);
    expect(app.runBatch(['p = 1', 'q = p + 1']).ok).toBe(true);
    expect(app.value('q')).toBe(2);
  });

  it('undefined objects are reported', () => {
    const app = createHeadlessApp({ script: 'k = 1' });
    const r = ok(app.run('w = 1 / (k - 1)')[0]);
    expect(r.undefined).toEqual([{ name: 'w', reason: 'division_by_zero' }]);
    expect(app.undefinedObjects()).toEqual([{ name: 'w', reason: 'division_by_zero' }]);
    expect(app.value('w')).toEqual({ kind: 'undefined', reason: 'division_by_zero' });
  });

  it('wrong argument types throw TypeError', () => {
    const app = createHeadlessApp();
    expect(() => app.run(5 as never)).toThrow(TypeError);
    expect(() => app.get(1 as never)).toThrow(TypeError);
  });
});

describe('reads (R1.3)', () => {
  const app = createHeadlessApp({ mode: 'classic', script: 'A = (1, 2)\nB = (4, 6)\ns = Segment(A, B)\nL = Length(s)\nxs = [1, 2, 3]\nt1 = "hi"\nPx = (0, 0) with visible = false' });

  it('values are typed data', () => {
    expect(app.value('A')).toEqual({ x: 1, y: 2 });
    expect(app.value('L')).toBe(5);
    expect(app.value('xs')).toEqual([1, 2, 3]);
    expect(app.value('t1')).toBe('hi');
    expect(app.value('nope')).toBeUndefined();
  });

  it('get gives the definition, inputs, dependents and style', () => {
    const d = app.get('s');
    expect(d).toMatchObject({ name: 's', type: 'Segment', definition: 's = Segment(A, B)', dependsOn: ['A', 'B'], dependents: ['L'], free: false, defined: true });
    expect(app.get('A')?.dependents).toEqual(['s']);
    expect(app.definition('L')).toBe('L = Length(s)');
  });

  it('list filters by type, free, visible, name glob and dependency', () => {
    expect(app.list({ type: 'Point' }).map((o) => o.name)).toEqual(['A', 'B', 'Px']);
    expect(app.list({ free: false }).map((o) => o.name)).toEqual(['s', 'L']);
    expect(app.list({ visible: false }).map((o) => o.name)).toEqual(['Px']);
    expect(app.list({ namePattern: 'P*' }).map((o) => o.name)).toEqual(['Px']);
    expect(app.list({ dependsOn: 'A' }).map((o) => o.name)).toEqual(['s', 'L']);
    expect(app.list()[3]).toMatchObject({ name: 'L', summary: 'L = 5' });
  });

  it('figureSummary for a model or a page', () => {
    const f = app.figureSummary();
    expect(f).toMatchObject({ mode: 'classic', objects: 7, t: 0 });
    expect(f.view).toMatchObject({ widthPx: 800, heightPx: 600 });
  });
});

describe('writes are lines (R1.4)', () => {
  it('set, setStyle, show, hide, rename, remove', () => {
    const app = createHeadlessApp({ mode: 'classic', script: 'a = 1\nP = (0, 0)\nQ = Midpoint(P, (4, 4))' });
    expect(ok(app.set('a', 4)).name).toBe('a');
    expect(app.value('a')).toBe(4);
    app.set('P', [2, 3]);
    expect(app.value('Q')).toEqual({ x: 3, y: 3.5 });
    ok(app.setStyle('P', { color: 'red', pointSize: 6 }));
    expect(app.definition('P')).toBe('P = (2, 3)');
    expect(app.toScript()).toContain('P = (2, 3) with color = red');
    app.hide('Q');
    expect(app.get('Q')?.visible).toBe(false);
    app.show('Q');
    expect(app.get('Q')?.visible).toBe(true);
    ok(app.rename('a', 'k'));
    expect(app.exists('k')).toBe(true);
    const del = app.remove('P');
    expect(del).toEqual({ ok: true, removed: ['P', 'Q'] });
  });

  it('errors are data: not_free, unknown_name with close names, name_taken', () => {
    const app = createHeadlessApp({ script: 'A = (1, 2)\nB = (3, 4)\nM = Midpoint(A, B)' });
    const nf = app.set('M', [0, 0]);
    expect(nf).toMatchObject({ ok: false, area: 'api', kind: 'not_free', detail: { name: 'M', dependsOn: ['A', 'B'] } });
    expect(nf.ok === false && nf.message).toBe('M depends on A and B, so it cannot be set directly.');
    const un = app.set('Mm', 1);
    expect(un).toMatchObject({ kind: 'unknown_name', hint: 'Did you mean M?' });
    expect(app.rename('A', 'B')).toMatchObject({ kind: 'name_taken' });
    expect(app.set('A', Number.NaN)).toMatchObject({ kind: 'bad_argument' });
  });

  it('a read-only app refuses the learner, not the page', () => {
    const app = createHeadlessApp({ script: 'a = 1', readOnly: true });
    expect(app.as('user', () => app.set('a', 2))).toMatchObject({ kind: 'read_only' });
    expect(app.set('a', 3).ok).toBe(true);
  });

  it('clear empties the figure', () => {
    const app = createHeadlessApp({ script: 'a = 1' });
    app.clear();
    expect(app.list()).toEqual([]);
  });
});

describe('undo and saved (R1.5)', () => {
  it('undo, redo, saved flag', () => {
    const app = createHeadlessApp({ script: 'a = 1' });
    expect(app.saved).toBe(true);
    app.run('b = 2');
    expect(app.saved).toBe(false);
    expect(app.undo()).toBe(true);
    expect(app.exists('b')).toBe(false);
    expect(app.redo()).toBe(true);
    app.markSaved();
    expect(app.saved).toBe(true);
  });
});

describe('view and clock without a screen (R1.6)', () => {
  it('the view is the @view line', () => {
    const app = createHeadlessApp({ size: { width: 800, height: 400 } });
    app.view.keepRatio(false);
    expect(app.view.set(-4, 4, -2, 2).ok).toBe(true);
    expect(app.view.get()).toMatchObject({ x0: -4, x1: 4, y0: -2, y1: 2, widthPx: 800, heightPx: 400 });
    expect(app.toScript()).toContain('@view -4 4 -2 2');
    app.view.keepRatio(true);
    app.view.set(-1, 1, -1, 1);
    expect(app.view.get()).toMatchObject({ x0: -2, x1: 2, y0: -1, y1: 1 });
    expect(app.view.set(1, 0, 0, 1)).toMatchObject({ kind: 'bad_argument' });
    app.view.setAxes(false);
    app.view.setGrid('minor');
    expect(app.toScript()).toMatch(/@axes off[\s\S]*@grid minor/);
  });

  it('fit shows the visible points', () => {
    const app = createHeadlessApp({ script: 'A = (0, 0)\nB = (10, 5)', size: { width: 1000, height: 500 } });
    expect(app.view.fit()).toBe(true);
    const v = app.view.get();
    expect(v.x0).toBeLessThan(0);
    expect(v.x1).toBeGreaterThan(10);
    expect(createHeadlessApp().view.fit()).toBe(false);
  });

  it('the clock plays on the ticker, seeks and sets its range', () => {
    let pending: ((ms: number) => void) | undefined;
    const ticker: Ticker = { request: (cb) => ((pending = cb), 1), cancel: () => (pending = undefined) };
    const app = createHeadlessApp({ script: '@clock 0..10\nx2 = t * 2', ticker });
    app.clock.play();
    expect(app.clock.playing).toBe(true);
    pending?.(0);
    pending?.(50);
    pending?.(100);
    expect(app.clock.t).toBeCloseTo(0.1);
    expect(app.value('x2')).toBeCloseTo(0.2);
    app.clock.pause();
    expect(app.clock.playing).toBe(false);
    expect(pending).toBeUndefined();
    app.clock.seek(4);
    expect(app.value('x2')).toBe(8);
    expect(app.clock.setSpeed(50)).toMatchObject({ kind: 'bad_argument' });
    expect(app.clock.setSpeed(2)).toBeUndefined();
    expect(app.clock.setRange(0, 20).ok).toBe(true);
    expect(app.toScript()).toContain('@clock 0..20');
  });
});

describe('events (R1.7)', () => {
  it('typed events after the update pass, with their source', () => {
    const s = manual();
    const app = createHeadlessApp({ scheduler: s });
    const got: AppEvent[] = [];
    app.on('added', (e) => got.push(e));
    app.on('changed', (e) => got.push(e), { coalesce: 'none' });
    app.run('a = 1');
    expect(got).toEqual([]);
    s.run();
    expect(got.map((e) => e.type)).toEqual(['added', 'changed']);
    expect(got[0]).toMatchObject({ type: 'added', name: 'a', objectType: 'Number', source: 'api' });
    app.run('b = a + 1');
    app.set('a', 5);
    s.run();
    const changed = got.filter((e) => e.type === 'changed');
    expect(changed.at(-1)).toMatchObject({ objects: expect.arrayContaining([expect.objectContaining({ name: 'b', value: 6 })]) });
  });

  it('changed is coalesced to one per frame, with every object at its last value', () => {
    const s = manual();
    const app = createHeadlessApp({ scheduler: s, script: 'a = 1\nb = a * 10' });
    const got: AppEvent[] = [];
    app.on('changed', (e) => got.push(e));
    for (let i = 2; i <= 5; i++) app.set('a', i);
    s.run();
    expect(got).toHaveLength(1);
    const objs = (got[0] as Extract<AppEvent, { type: 'changed' }>).objects;
    expect(objs.find((o) => o.name === 'b')?.value).toBe(50);
    expect(objs.find((o) => o.name === 'a')?.value).toBe(5);
  });

  it('filters by object, type and source; once; unsubscribe', () => {
    const s = manual();
    const app = createHeadlessApp({ scheduler: s, script: 'a = 1\nb = 2' });
    const names: string[] = [];
    const off = app.on('changed', (e) => names.push(...e.objects.map((o) => o.name)), { object: 'b' });
    let user = 0;
    app.on('changed', () => user++, { source: 'user' });
    let first = 0;
    app.once('changed', () => first++);
    app.set('a', 3);
    app.set('b', 4);
    s.run();
    expect(names).toEqual(['b']);
    expect(user).toBe(0);
    app.as('user', () => app.set('b', 9));
    s.run();
    expect(user).toBe(1);
    expect(first).toBe(1);
    off();
    app.set('b', 1);
    s.run();
    expect(names).toEqual(['b', 'b']);
  });

  it('a handler that throws becomes an error event; the app goes on', () => {
    const s = manual();
    const app = createHeadlessApp({ scheduler: s });
    const errors: string[] = [];
    app.on('added', () => {
      throw new Error('boom');
    });
    app.on('error', (e) => errors.push(e.error.kind));
    app.run('a = 1');
    s.run();
    expect(errors).toEqual(['listener_failed']);
    expect(app.run('b = 2')[0]?.ok).toBe(true);
  });

  it('a handler that runs a line sees a settled figure and no recursion', () => {
    const s = manual();
    const app = createHeadlessApp({ scheduler: s, script: 'a = 1' });
    app.on('added', (e) => {
      if (e.name === 'b') app.run('c = b + 1');
    });
    app.run('b = a + 1');
    s.run();
    s.run();
    expect(app.value('c')).toBe(3);
  });

  it('renamed, removed, undone, viewChanged, error', () => {
    const s = manual();
    const app = createHeadlessApp({ scheduler: s, script: 'a = 1' });
    const types: string[] = [];
    for (const t of ['renamed', 'removed', 'undone', 'viewChanged', 'error', 'redefined'] as const) app.on(t, (e) => types.push(e.type), { coalesce: 'none' });
    app.rename('a', 'k');
    app.run('k = 2 + 1');
    app.remove('k');
    app.undo();
    app.view.set(-1, 1, -1, 1);
    app.run('bad = ');
    s.run();
    expect(types).toEqual(['renamed', 'redefined', 'removed', 'undone', 'viewChanged', 'error']);
  });
});

describe('modes and lifetime (R1.8)', () => {
  it('the mode gate refuses what the mode forbids; setMode switches', () => {
    const app = createHeadlessApp({ mode: 'scientific' });
    const r = app.run('c = Circle((0, 0), 1)')[0];
    expect(r).toMatchObject({ ok: false, kind: 'mode_forbids' });
    const sw = app.setMode('geometry');
    expect(sw.ok).toBe(true);
    expect(app.mode).toBe('geometry');
    expect(app.run('c = Circle((0, 0), 1)')[0]?.ok).toBe(true);
    expect(app.setMode('nope' as never).ok).toBe(false);
  });

  it('a mode switch that would drop objects needs force', () => {
    const app = createHeadlessApp({ mode: 'graphing', script: 'f(x) = x^2\nc = Circle((0, 0), 1)' });
    const dry = app.setMode('scientific');
    expect(dry.ok).toBe(false);
    expect(app.exists('c')).toBe(true);
  });

  it('after destroy every call is destroyed', () => {
    const app = createHeadlessApp({ script: 'a = 1' });
    app.destroy();
    expect(app.destroyed).toBe(true);
    expect(app.run('b = 1')[0]).toMatchObject({ kind: 'destroyed' });
    expect(app.set('a', 2)).toMatchObject({ kind: 'destroyed' });
    expect(app.value('a')).toBeUndefined();
    expect(app.list()).toEqual([]);
    expect(app.toScript()).toBe('');
  });
});

describe('script (R2.1)', () => {
  it('starts with the incantly header and is deterministic', () => {
    const a = createHeadlessApp({ mode: 'geometry', script: 'A = (1, 2)\nB = (3, 4)' });
    const b = createHeadlessApp({ mode: 'geometry', script: 'A = (1, 2)\nB = (3, 4)' });
    expect(a.toScript()).toBe('# incantly 1 mode=geometry\nA = (1, 2)\nB = (3, 4)\n');
    expect(a.toScript()).toBe(b.toScript());
  });

  it('loadScript replaces the figure and lists failed lines', () => {
    const app = createHeadlessApp({ script: 'old = 1' });
    const r = app.loadScript('# incantly 1 mode=graphing\na = 1\nb = nope\nc = a + 1');
    expect(r.applied).toBe(2);
    expect(app.toScript()).toBe('# incantly 1 mode=graphing\na = 1\nc = a + 1\n');
    expect(r.failed.map((e) => e.kind)).toEqual(['unknown_name']);
    expect(app.exists('old')).toBe(false);
    expect(app.saved).toBe(true);
  });
});
