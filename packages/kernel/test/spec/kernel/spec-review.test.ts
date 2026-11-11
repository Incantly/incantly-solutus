/**
 * Spec review round (handoff/kernel/review.md, items A1 to A6). Written from the docs and the public entry only.
 *
 * A1 animation and clock writes are never journalled and never join a gesture   (kernel design 10, 11.2)
 * A2 area types register default styles and `with` keys; registrations merge    (kernel design 9.1, 9.3, rulings K11)
 * A3 a rule can read its argument ids, the tolerance, a work budget, the limits and `slice`
 *                                                                               (README 9, curves-loci 3.8, errors/design 8)
 * A4 stepTo(n) shows the first n steps of the list as listed (aux hidden)       (kernel design 12.1, 12.2)
 * A5 unknown_name repair suggests a define line of the needed type, never `e`    (kernel agent 4, 5.3; errors 1.2)
 * A6 applyBatch(lines, { dryRun: true }) commits nothing                         (README 10, tools-2d T1)
 *
 * ASSUMED NAMES (not in the public API when this file was written; the integrator aligns them):
 *   A1  setFree(name, value, 'anim')                      a sixth WriteWhy
 *   A2  registerTypeStyle(type, { defaults, keys })       exported from the entry; registerPropertyTypes(key, types) must merge
 *   A3  RuleCall.ids / .tol / .work / .limits / .slice    FigureOptions.tolerance, the `@tolerance <n>` directive,
 *       work = { limit, spend(n?) => boolean }            Limits.ruleWork sets the cap
 *   A6  BatchOptions.dryRun
 * A4 and A5 use existing names only.
 */
import { describe, expect, it } from 'vitest';
import * as Kernel from '@incantly/kernel';
import { colorHex, defaultsFor, validKeysFor } from '@incantly/kernel';
import type { CommandSpec, FigureOptions, RuleCall } from '@incantly/kernel';
import { BASIC, TEST_COMMANDS, bad, expectUnchanged, figure, idOf, must, newFigure, ok, p, recordEvents, snap } from './helpers';
import type { Figure } from '@incantly/kernel';

// ---------------------------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------------------------

const API = Kernel as unknown as Record<string, unknown>;
type AnyFn = (...args: unknown[]) => unknown;

const ANIM = 'anim' as never; // assumed sixth WriteWhy
const anim = (f: Figure, name: string, value: unknown): unknown => f.setFree(name, value as never, ANIM);

/** The assumed additions to what a rule is given. */
interface RuleCallExt {
  ids?: readonly (number | undefined)[];
  tol?: number;
  work?: { limit: number; spend: (n?: number) => boolean };
  limits?: Record<string, number>;
  slice?: (source: unknown, target: unknown) => unknown;
}

const ext = (call: RuleCall): RuleCallExt => call as unknown as RuleCallExt;

function spec(name: string, params: ReturnType<typeof p>[], returns: string, run: (call: RuleCall) => unknown): CommandSpec {
  return {
    name,
    kind: 'object',
    group: 'test',
    forms: [{ params, returns, rule: () => ({ run }), summary: `${name} (spec-review command)` }],
  } as CommandSpec;
}

const withCommands = (extra: CommandSpec[], opts: FigureOptions = {}): Figure =>
  newFigure({ ...opts, commands: [...TEST_COMMANDS, ...extra] });

// ---------------------------------------------------------------------------------------------
// A1. Animation and clock writes
// ---------------------------------------------------------------------------------------------

describe('A1: animation writes are not authored edits (design 10, 11.2)', () => {
  const SETUP = [...BASIC, 'h = a * 2', 'b = 1 in 0..10'];

  it('an animation write changes the value and its dependents after flush', () => {
    const f = figure(SETUP);
    anim(f, 'a', 7);
    f.flush();
    expect(f.value('a')).toBe(7);
    expect(f.value('h')).toBe(14);
  });

  it('twenty animation writes add no undo entry', () => {
    const f = figure(SETUP);
    const depth = f.undoInfo().depth;
    for (let i = 0; i < 20; i++) {
      anim(f, 'a', (i % 10) + 0.5);
      f.flush();
    }
    expect(f.value('a')).toBe(9.5);
    expect(f.undoInfo().depth).toBe(depth);
    expect(f.undoInfo().redoDepth).toBe(0);
  });

  it('applying a line after animation adds exactly one entry, for that line', () => {
    const f = figure(SETUP);
    const depth = f.undoInfo().depth;
    for (const v of [1, 2, 3, 4, 5]) anim(f, 'a', v + 0.5);
    f.flush();
    expect(f.value('a')).toBe(5.5);
    ok(f.apply('c = a + 1'));
    expect(f.undoInfo().depth).toBe(depth + 1);
  });

  it('undo after animation takes back the authored line, not a move of the slider', () => {
    const f = figure(SETUP);
    ok(f.apply('P = (1, 1)'));
    for (const v of [1, 2, 3]) anim(f, 'a', v + 0.5);
    f.flush();
    expect(f.value('a')).toBe(3.5);
    ok(f.apply('Q = (2, 2)'));
    ok(f.undo());
    expect(f.get('Q')).toBeUndefined();
    expect(f.get('P')).toBeDefined();
    ok(f.undo());
    expect(f.get('P')).toBeUndefined();
  });

  it('an animation write does not join an open drag gesture', () => {
    const f = figure(SETUP);
    const depth = f.undoInfo().depth;
    f.setFree('A', { x: 1, y: 1 }, 'drag');
    anim(f, 'a', 8);
    f.flush();
    expect(f.commitDrag().committed).toBe(1);
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.value('A')).toEqual({ x: 0, y: 0 });
    expect(f.value('a')).toBe(8);
  });

  it('commitDrag after animation alone commits nothing', () => {
    const f = figure(SETUP);
    const depth = f.undoInfo().depth;
    anim(f, 'a', 6);
    f.flush();
    expect(f.value('a')).toBe(6);
    expect(f.commitDrag().committed).toBe(0);
    expect(f.undoInfo().depth).toBe(depth);
  });

  it('an animation write keeps the redo stack', () => {
    const f = figure(SETUP);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    expect(f.undoInfo().redoDepth).toBe(1);
    anim(f, 'a', 6);
    f.flush();
    expect(f.value('a')).toBe(6);
    expect(f.undoInfo().redoDepth).toBe(1);
    ok(f.redo());
    expect(f.get('Z')).toBeDefined();
  });

  it('clamps to the slider range and snaps to its step, like a slider write', () => {
    const f = figure(SETUP);
    anim(f, 'a', 11);
    f.flush();
    expect(f.value('a')).toBe(10);
    anim(f, 'a', 2.3);
    f.flush();
    expect(f.value('a')).toBe(2.5);
    anim(f, 'a', -4);
    f.flush();
    expect(f.value('a')).toBe(0);
  });

  it('the player may move a fixed slider (the learner may not)', () => {
    const f = figure(SETUP);
    ok(f.apply('a with fixed = true'));
    anim(f, 'a', 6);
    f.flush();
    expect(f.value('a')).toBe(6);
  });

  it('one value event lists the animated object and what depends on it', () => {
    const f = figure(SETUP);
    const rec = recordEvents(f);
    anim(f, 'a', 5);
    f.flush();
    const ids = rec.events.flatMap((e) => (e.ev === 'value' ? [...e.ids] : []));
    expect(ids).toContain(idOf(f, 'a'));
    expect(ids).toContain(idOf(f, 'h'));
  });

});

// ---------------------------------------------------------------------------------------------
// A2. Area types: default styles, valid `with` keys, merged registrations
// ---------------------------------------------------------------------------------------------

describe('A2: base drawable keys on every drawable type (design 9.1, K11)', () => {
  const BASE_KEYS = ['visible', 'label', 'caption', 'aux', 'fixed', 'selectable', 'layer', 'showIf', 'color', 'opacity', 'tags', 'tip', 'animate'];
  const DRAWABLE = ['Point', 'Vector', 'Segment', 'Ray', 'Line', 'Circle', 'Arc', 'Polygon', 'Function', 'Curve', 'Region', 'Conic', 'Sector'];

  it('every drawable type accepts the base keys, including animate', () => {
    for (const type of DRAWABLE) {
      const keys = validKeysFor(type);
      for (const k of BASE_KEYS) expect(keys, `${type} ${k}`).toContain(k);
    }
  });

  it('Conic accepts width, lineStyle and fill', () => {
    const keys = validKeysFor('Conic');
    for (const k of ['width', 'lineStyle', 'fill']) expect(keys, k).toContain(k);
  });

  it('a Conic object takes `with width, lineStyle, fill` and the style reads them back', () => {
    const f = withCommands([spec('MakeConic', [p('k', 'Number')], 'Conic', () => ({ k: 1 }))]);
    ok(f.apply('K = MakeConic(1)'));
    ok(f.apply('K with width = 4, lineStyle = dashed, fill = hatch'));
    const s = must(f.styleOf(idOf(f, 'K') as never));
    expect(s.width).toBe(4);
    expect(s.lineStyle).toBe('dashed');
    expect(s.fill).toBe('hatch');
  });

});

describe('A2: registerTypeStyle (assumed name)', () => {
  const registerTypeStyle = (type: string, entry: { defaults?: Record<string, unknown>; keys?: string[] }): unknown => {
    const fn = API.registerTypeStyle as AnyFn | undefined;
    if (typeof fn !== 'function') throw new Error('registerTypeStyle is not exported from @incantly/kernel');
    return fn(type, entry);
  };
  const maker = (type: string): CommandSpec => spec(`Make${type}`, [p('k', 'Number')], type, () => ({ k: 1 }));

  it('defaultsFor returns the registered width and opacity for both free and dependent use', () => {
    registerTypeStyle('StyleOne', { defaults: { width: 3, opacity: 0.4 } });
    for (const free of [true, false]) {
      const d = defaultsFor('StyleOne', free);
      expect(d.width).toBe(3);
      expect(d.opacity).toBe(0.4);
    }
  });

  it('defaultsFor returns the registered colour', () => {
    registerTypeStyle('StyleColour', { defaults: { color: '#123456' } });
    expect(colorHex(defaultsFor('StyleColour', false).color)).toBe('#123456');
  });

  it('fields the registration does not give keep the generic defaults', () => {
    registerTypeStyle('StylePartial', { defaults: { width: 5 } });
    const d = defaultsFor('StylePartial', false);
    expect(d.visible).toBe(true);
    expect(d.selectable).toBe(true);
    expect(d.layer).toBe(0);
    expect(d.width).toBe(5);
  });

  it('an object of the registered type gets the registered style in the figure', () => {
    registerTypeStyle('StyleFig', { defaults: { width: 3.5, color: '#abcdef' } });
    const f = withCommands([maker('StyleFig')]);
    ok(f.apply('K = MakeStyleFig(1)'));
    const s = must(f.styleOf(idOf(f, 'K') as never));
    expect(s.width).toBe(3.5);
    expect(colorHex(s.color)).toBe('#abcdef');
  });

  it('registered keys are valid keys for that type, next to the base keys', () => {
    registerTypeStyle('StyleKeys', { keys: ['pointSize'] });
    const keys = validKeysFor('StyleKeys');
    expect(keys).toContain('pointSize');
    for (const k of ['visible', 'color', 'opacity', 'layer']) expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('`with` accepts a registered key on the registered type and rejects it on a type without it', () => {
    registerTypeStyle('StyleWith', { keys: ['pointSize'] });
    const f = withCommands([maker('StyleWith')]);
    ok(f.apply('K = MakeStyleWith(1)'));
    ok(f.apply('K with pointSize = 4'));
    expect(must(f.styleOf(idOf(f, 'K') as never)).pointSize).toBe(4);
    const g = figure(['A = (0, 0)', 'B = (1, 1)', 'seg = Segment(A, B)']);
    bad(g.apply('seg with pointSize = 4'), 'unknown_property');
  });

  it('unknown_property on a registered type lists the registered keys', () => {
    registerTypeStyle('StyleHint', { keys: ['pointSize'] });
    const f = withCommands([maker('StyleHint')]);
    ok(f.apply('K = MakeStyleHint(1)'));
    const e = bad(f.apply('K with nonsense = 1'), 'unknown_property');
    expect(JSON.stringify(e)).toContain('pointSize');
  });

  it('a registration for one type does not change another type', () => {
    const before = JSON.stringify(defaultsFor('Segment', false));
    const keysBefore = [...validKeysFor('Segment')];
    registerTypeStyle('StyleIsolated', { defaults: { width: 9 }, keys: ['pointSize'] });
    expect(JSON.stringify(defaultsFor('Segment', false))).toBe(before);
    expect([...validKeysFor('Segment')]).toEqual(keysBefore);
  });

  it('registering the same type twice merges the keys (nothing from the first call is lost)', () => {
    registerTypeStyle('StyleMerge', { keys: ['pointSize'] });
    registerTypeStyle('StyleMerge', { keys: ['pointStyle'] });
    const keys = validKeysFor('StyleMerge');
    expect(keys).toContain('pointSize');
    expect(keys).toContain('pointStyle');
  });

  it('registering the same type twice merges the defaults', () => {
    registerTypeStyle('StyleMergeDef', { defaults: { width: 4 } });
    registerTypeStyle('StyleMergeDef', { defaults: { opacity: 0.3 } });
    const d = defaultsFor('StyleMergeDef', false);
    expect(d.width).toBe(4);
    expect(d.opacity).toBe(0.3);
  });

});

describe('A2: registerPropertyTypes merges (design 9.1)', () => {
  const register = (key: string, types: string[]): void => {
    (API.registerPropertyTypes as AnyFn)(key, types);
  };

  it('a second call for the same key keeps the types of the first call', () => {
    register('pointSize', ['MergeTypeA']);
    register('pointSize', ['MergeTypeB']);
    expect(validKeysFor('MergeTypeA')).toContain('pointSize');
    expect(validKeysFor('MergeTypeB')).toContain('pointSize');
  });

  it('a call for another key does not remove an earlier key', () => {
    register('pointSize', ['MergeTypeC']);
    register('pointStyle', ['MergeTypeC']);
    expect(validKeysFor('MergeTypeC')).toEqual(expect.arrayContaining(['pointSize', 'pointStyle']));
  });

  it('repeating a call does not duplicate the key', () => {
    register('pointSize', ['MergeTypeG']);
    register('pointSize', ['MergeTypeG']);
    expect(validKeysFor('MergeTypeG').filter((k) => k === 'pointSize').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// A3. What a rule can read
// ---------------------------------------------------------------------------------------------

describe('A3: a rule reads the ids of its arguments', () => {
  function idsFigure(): { f: Figure; seen: (readonly (number | undefined)[] | undefined)[] } {
    const seen: (readonly (number | undefined)[] | undefined)[] = [];
    const f = withCommands([
      spec('IdsN', [p('x', 'Number'), p('y', 'Number')], 'Number', (call) => {
        seen.push(ext(call).ids);
        return 0;
      }),
    ]);
    ok(f.apply('a = 3 in 0..10'));
    ok(f.apply('b = 4 in 0..10'));
    return { f, seen };
  }
  const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

  it('an argument that names an object gives that object\'s id', () => {
    const { f, seen } = idsFigure();
    ok(f.apply('r = IdsN(a, b)'));
    expect(last(seen)).toEqual([idOf(f, 'a'), idOf(f, 'b')]);
  });

  it('a literal argument has no id', () => {
    const { f, seen } = idsFigure();
    ok(f.apply('r = IdsN(a, 2)'));
    expect(last(seen)).toEqual([idOf(f, 'a'), undefined]);
  });

  it('an expression argument has no id', () => {
    const { f, seen } = idsFigure();
    ok(f.apply('r = IdsN(a + 1, b)'));
    expect(last(seen)).toEqual([undefined, idOf(f, 'b')]);
  });

  it('the ids are the same after a rename (ids are stable)', () => {
    const { f, seen } = idsFigure();
    ok(f.apply('r = IdsN(a, b)'));
    const id = idOf(f, 'a');
    ok(f.apply('Rename(a, "alpha")'));
    f.setFree('alpha', 5, 'api');
    f.flush();
    expect(last(seen)?.[0]).toBe(id);
  });

  it('the ids are current after the argument is redefined to another object', () => {
    const { f, seen } = idsFigure();
    ok(f.apply('r = IdsN(a, b)'));
    ok(f.apply('r = IdsN(b, a)'));
    expect(last(seen)).toEqual([idOf(f, 'b'), idOf(f, 'a')]);
  });

  it('ids are available on every re-run of the rule, not only the first', () => {
    const { f, seen } = idsFigure();
    ok(f.apply('r = IdsN(a, b)'));
    seen.length = 0;
    f.setFree('a', 6, 'api');
    f.flush();
    expect(seen.length).toBeGreaterThan(0);
    expect(last(seen)).toEqual([idOf(f, 'a'), idOf(f, 'b')]);
  });
});

describe('A3: a rule reads the figure tolerance', () => {
  const tolCommand = spec('Tol', [p('x', 'Number')], 'Number', (call) => ext(call).tol ?? -1);

  it('the default is 1e-9', () => {
    const f = withCommands([tolCommand]);
    ok(f.apply('r = Tol(1)'));
    expect(f.value('r')).toBe(1e-9);
  });

  it('the figure option sets it', () => {
    const f = withCommands([tolCommand], { tolerance: 1e-6 } as never);
    ok(f.apply('r = Tol(1)'));
    expect(f.value('r')).toBe(1e-6);
  });

  it('the @tolerance directive sets it (assumed syntax) and rules see the new value after a re-run', () => {
    const f = withCommands([tolCommand]);
    ok(f.apply('a = 1 in 0..10'));
    ok(f.apply('r = Tol(a)'));
    ok(f.apply('@tolerance 1e-6'));
    f.setFree('a', 2, 'api');
    f.flush();
    expect(f.value('r')).toBe(1e-6);
  });

});

describe('A3: a rule has a work budget (errors/design 8)', () => {
  /** Spins n times, spending one unit each; fails with no_convergence when the budget runs out. */
  const spin = spec('Spin', [p('n', 'Number')], 'Number', (call) => {
    const w = ext(call).work;
    if (w === undefined) return call.fail('internal' as never);
    const n = call.values[0] as number;
    for (let i = 0; i < n; i++) if (!w.spend(1)) return call.fail('no_convergence');
    return n;
  });
  const limitOf = spec('WorkLimit', [p('x', 'Number')], 'Number', (call) => ext(call).work?.limit ?? -1);
  const reasonOf = (f: Figure, name: string): unknown => {
    const c = must(f.cellOf(name));
    return c.defined ? undefined : c.reason;
  };

  it('the budget is a positive finite number by default', () => {
    const f = withCommands([limitOf]);
    ok(f.apply('w = WorkLimit(1)'));
    const w = f.value('w') as number;
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });

  it('a rule within its budget gets its answer', () => {
    const f = withCommands([spin], { limits: { ruleWork: 100 } } as never);
    ok(f.apply('s = Spin(50)'));
    expect(f.value('s')).toBe(50);
  });

  it('a rule over its budget is undefined with no_convergence', () => {
    const f = withCommands([spin], { limits: { ruleWork: 100 } } as never);
    ok(f.apply('s = Spin(500)'));
    expect(reasonOf(f, 's')).toBe('no_convergence');
  });

  it('the limit option is what the rule sees', () => {
    const f = withCommands([limitOf], { limits: { ruleWork: 123 } } as never);
    ok(f.apply('w = WorkLimit(1)'));
    expect(f.value('w')).toBe(123);
  });

  it('the budget is per run: the same rule succeeds again on the next run', () => {
    const f = withCommands([spin], { limits: { ruleWork: 100 } } as never);
    ok(f.apply('n = 60 in 0..1000'));
    ok(f.apply('s = Spin(n)'));
    for (let i = 0; i < 4; i++) {
      f.setFree('n', 60 + i, 'api');
      f.flush();
      expect(f.value('s'), `run ${i}`).toBe(60 + i);
    }
  });

  it('the budget is per rule: two rules that each fit do not share a counter', () => {
    const f = withCommands([spin], { limits: { ruleWork: 100 } } as never);
    ok(f.apply('s1 = Spin(80)'));
    ok(f.apply('s2 = Spin(80)'));
    expect(f.value('s1')).toBe(80);
    expect(f.value('s2')).toBe(80);
  });

  it('the outcome is the same in two figures (no wall clock decides it)', () => {
    const a = withCommands([spin], { limits: { ruleWork: 100 } } as never);
    const b = withCommands([spin], { limits: { ruleWork: 100 } } as never);
    for (const f of [a, b]) {
      ok(f.apply('ok1 = Spin(99)'));
      ok(f.apply('over = Spin(101)'));
    }
    expect(a.value('ok1')).toBe(b.value('ok1'));
    expect(reasonOf(a, 'over')).toBe(reasonOf(b, 'over'));
    expect(reasonOf(a, 'over')).toBe('no_convergence');
  });

});

describe('A3: a rule reads the limits', () => {
  const listLimit = spec('ListLimit', [p('x', 'Number')], 'Number', (call) => ext(call).limits?.listSize ?? -1);

  it('sees the figure\'s limits', () => {
    const f = withCommands([listLimit], { limits: { listSize: 77 } });
    ok(f.apply('w = ListLimit(1)'));
    expect(f.value('w')).toBe(77);
  });

});

describe('A3: a rule can call slice', () => {
  const FIG = ['A = (1, 0)', 'a = 0 in 0..7', 'P = Orbit(1, a)', 'Q = Midpoint(P, A)'];

  /** Slices from the argument ids; falls back to names if the call takes names (the figure method does). */
  function sliceCommands(getFigure: () => Figure): CommandSpec[] {
    const nameOf = (id: unknown): unknown => getFigure().objects().find((o) => (o.id as number) === id)?.name ?? id;
    const run = (call: RuleCall, source: unknown, target: unknown): unknown => {
      const fn = ext(call).slice;
      if (typeof fn !== 'function') return undefined;
      const byId = fn(source, target) as { ok?: boolean } | undefined;
      if (byId !== undefined && byId.ok === false) return fn(nameOf(source), nameOf(target));
      return byId;
    };
    const sweep = (call: RuleCall, source: unknown, target: unknown): number => {
      const s = run(call, source, target) as { run?: (v: unknown[]) => { defined: boolean; value?: { x: number } }[] } | undefined;
      const cell = s?.run?.([Math.PI / 2])[0];
      return cell?.defined === true ? (cell.value?.x ?? -1) : -1;
    };
    return [
      spec('SliceProbe', [p('src', 'Number'), p('tgt', 'Point')], 'Number', (call) => sweep(call, ext(call).ids?.[0], ext(call).ids?.[1])),
      spec('SliceFromT', [p('tgt', 'Point')], 'Number', (call) => sweep(call, 't', ext(call).ids?.[0])),
      spec('SliceBad', [p('src', 'Number')], 'Number', (call) => {
        const r = run(call, 987654, 987655) as { ok?: boolean } | undefined;
        return r !== undefined && r.ok === false ? 1 : 0;
      }),
    ];
  }

  function sliceFigure(lines: string[] = FIG): Figure {
    const holder: { f?: Figure } = {};
    const fig = withCommands(sliceCommands(() => must(holder.f)));
    holder.f = fig;
    for (const l of lines) ok(fig.apply(l));
    return fig;
  }

  it('slice from a mover to a target inside a rule gives the target for a trial value', () => {
    const f = sliceFigure();
    ok(f.apply('S = SliceProbe(a, Q)'));
    expect(f.value('S') as number).toBeCloseTo(0.5, 12);
  });

  it('the clock can be the source', () => {
    const f = sliceFigure(['A = (1, 0)', 'P = Orbit(1, t)', 'Q = Midpoint(P, A)']);
    ok(f.apply('S = SliceFromT(Q)'));
    expect(f.value('S') as number).toBeCloseTo(0.5, 12);
  });

  it('running the slice leaves the real values, the clock and the undo state as they were', () => {
    const f = sliceFigure();
    ok(f.apply('a = 1'));
    const before = snap(f);
    ok(f.apply('S = SliceProbe(a, Q)', { dryRun: true }));
    expectUnchanged(f, before);
    ok(f.apply('S = SliceProbe(a, Q)'));
    expect(f.value('S') as number).toBeCloseTo(0.5, 12);
    expect(f.value('a')).toBe(1);
    expect(f.value('Q')).toEqual({ x: (Math.cos(1) + 1) / 2, y: Math.sin(1) / 2 });
  });

  it('slice works on every re-run, inside a flush after a drag', () => {
    const f = sliceFigure();
    ok(f.apply('S = SliceProbe(a, Q)'));
    f.setFree('A', { x: 3, y: 0 }, 'drag');
    f.flush();
    // P(pi/2) = (0, 1), so Q.x = (0 + 3) / 2
    expect(f.value('S') as number).toBeCloseTo(1.5, 12);
    f.setFree('A', { x: 5, y: 0 }, 'drag');
    f.flush();
    expect(f.value('S') as number).toBeCloseTo(2.5, 12);
  });

  it('a slice call with unknown objects returns an error object and does not throw', () => {
    const f = sliceFigure();
    const r = ok(f.apply('S = SliceBad(a)'));
    expect(r.ok).toBe(true);
    expect(f.value('S')).toBe(1);
  });

});

// ---------------------------------------------------------------------------------------------
// A4. stepTo with helper objects
// ---------------------------------------------------------------------------------------------

describe('A4: stepTo(n) counts the steps as listed (design 12.1, 12.2)', () => {
  const shown = (f: Figure, helpers = false): string[] =>
    f.steps({ helpers }).filter((s) => s.visible).map((s) => s.name);
  /** A, helper h, B, C: the case from the review. */
  const withHelper = (): Figure => {
    const f = figure(['A = (0, 0)', 'h = (1, 1)', 'B = (4, 0)', 'C = (2, 3)']);
    ok(f.apply('h with aux = true'));
    return f;
  };

  it('stepTo(2) shows A and B when a helper sits between them', () => {
    const f = withHelper();
    f.stepTo(2);
    expect(shown(f)).toEqual(['A', 'B']);
  });

  it('stepTo(1) shows only A', () => {
    const f = withHelper();
    f.stepTo(1);
    expect(shown(f)).toEqual(['A']);
  });

  it('stepTo(3) shows everything listed', () => {
    const f = withHelper();
    f.stepTo(3);
    expect(shown(f)).toEqual(['A', 'B', 'C']);
  });

  it('step indexes run 0..n-1 over the rows listed, and stepTo(i + 1) reveals exactly rows 0..i', () => {
    const f = withHelper();
    const rows = f.steps();
    expect(rows.map((s) => s.index)).toEqual([0, 1, 2]);
    rows.forEach((row, i) => {
      f.stepTo(i + 1);
      expect(shown(f), `stepTo(${i + 1})`).toEqual(rows.slice(0, i + 1).map((r) => r.name));
    });
  });

  it('a helper at the start does not use up a step', () => {
    const f = figure(['h = (9, 9)', 'A = (0, 0)', 'B = (4, 0)']);
    ok(f.apply('h with aux = true'));
    f.stepTo(1);
    expect(shown(f)).toEqual(['A']);
  });

  it('two helpers before the cursor', () => {
    const f = figure(['A = (0, 0)', 'h = (1, 1)', 'g = (2, 2)', 'B = (4, 0)', 'C = (2, 3)']);
    ok(f.apply('h with aux = true'));
    ok(f.apply('g with aux = true'));
    f.stepTo(2);
    expect(shown(f)).toEqual(['A', 'B']);
  });

  it('with helpers listed, the same cursor still hides C and shows A and B', () => {
    const f = withHelper();
    f.stepTo(2);
    const rows = f.steps({ helpers: true });
    const vis = (n: string): boolean | undefined => rows.find((r) => r.name === n)?.visible;
    expect(vis('A')).toBe(true);
    expect(vis('B')).toBe(true);
    expect(vis('C')).toBe(false);
  });

  it('sends one step event with the n that was asked for', () => {
    const f = withHelper();
    const rec = recordEvents(f);
    f.stepTo(2);
    expect(rec.events).toEqual([{ ev: 'step', n: 2 }]);
  });
});

// ---------------------------------------------------------------------------------------------
// A5. unknown_name repair
// ---------------------------------------------------------------------------------------------

describe('A5: unknown_name suggests what the argument needs (agent 4, 5.3; errors 1.2)', () => {
  /** What each suggestion would do, by dry run on the same figure. */
  function outcomes(f: Figure, suggest: readonly string[]): { line: string; ok: boolean; name?: string | undefined; type?: string | undefined }[] {
    return suggest.map((line) => {
      const r = f.apply(line, { dryRun: true });
      return r.ok ? { line, ok: true, name: r.name, type: r.type } : { line, ok: false };
    });
  }

  it('Midpoint(A, Bb): the first suggestion is the rewrite with the near name (agent 5.3)', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('M2 = Midpoint(A, Bb)'), 'unknown_name');
    expect(e.suggest[0]).toBe('M2 = Midpoint(A, B)');
  });

  it('Midpoint(A, Bb): the recovery is to use a suggestion, not to create a slider first', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('M2 = Midpoint(A, Bb)'), 'unknown_name');
    expect(['use_suggestion', 'rewrite']).toContain(e.recovery);
  });

  it('Midpoint(A, Bb): a define line for Bb makes a Point', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('M2 = Midpoint(A, Bb)'), 'unknown_name');
    const defines = outcomes(f, e.suggest).filter((o) => o.name === 'Bb');
    expect(defines.length).toBeGreaterThan(0);
    for (const d of defines) expect(d.type, d.line).toBe('Point');
  });

  it('Midpoint(A, Bb): no suggestion is a number slider for Bb', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('M2 = Midpoint(A, Bb)'), 'unknown_name');
    expect(e.suggest.some((s) => /^Bb\s*=\s*1 in 0\.\.10/.test(s))).toBe(false);
    expect(outcomes(f, e.suggest).some((o) => o.name === 'Bb' && o.type === 'Number')).toBe(false);
  });

  it('every suggestion is a line that the kernel accepts as it stands', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('M2 = Midpoint(A, Bb)'), 'unknown_name');
    expect(e.suggest.length).toBeGreaterThan(0);
    for (const o of outcomes(f, e.suggest)) expect(o.ok, o.line).toBe(true);
  });

  it('sending suggest[0] repairs the line in one move', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('M2 = Midpoint(A, Bb)'), 'unknown_name');
    const r = ok(f.apply(must(e.suggest[0])));
    expect(r.name).toBe('M2');
    expect(f.value('M2')).toEqual({ x: 2, y: 0 });
  });

  it('a far name in a Point position is offered as a Point', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('C = Midpoint(A, Zq)'), 'unknown_name');
    const defines = outcomes(f, e.suggest).filter((o) => o.name === 'Zq');
    expect(defines.length).toBeGreaterThan(0);
    expect(defines.every((d) => d.type === 'Point')).toBe(true);
  });

  it('a Vector position is offered a Vector', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('T = Translate(A, wv)'), 'unknown_name');
    const defines = outcomes(f, e.suggest).filter((o) => o.name === 'wv');
    expect(defines.length).toBeGreaterThan(0);
    expect(defines.every((d) => d.type === 'Vector')).toBe(true);
  });

  it('a Number position is still offered a Number slider', () => {
    const f = figure(BASIC);
    const e = bad(f.apply('v = Vector(1, wn)'), 'unknown_name');
    const defines = outcomes(f, e.suggest).filter((o) => o.name === 'wn');
    expect(defines.length).toBeGreaterThan(0);
    expect(defines.every((d) => d.type === 'Number')).toBe(true);
  });

  it('never suggests the constant e, in a line or in the hint', () => {
    for (const line of ['C = Midpoint(A, Q)', 'C = Midpoint(A, E)', 'v = Vector(1, f)']) {
      const f = figure(BASIC);
      const e = bad(f.apply(line), 'unknown_name');
      for (const s of e.suggest) expect(s, `${line}: ${s}`).not.toMatch(/(^|[^A-Za-z0-9_])e([^A-Za-z0-9_]|$)/);
      expect(e.hint ?? '', line).not.toMatch(/\be\b(?!\.)/);
    }
  });

  it('a one-letter name does not get a rewrite to every other one-letter name', () => {
    const f = figure([...BASIC, 'C = (1, 1)', 'D = (2, 2)', 'E1 = (3, 3)']);
    const e = bad(f.apply('K = Midpoint(A, Q)'), 'unknown_name');
    const rewrites = e.suggest.filter((s) => /^K = Midpoint\(A, [A-Za-z]\)$/.test(s));
    expect(rewrites.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------------------------
// A6. applyBatch with dryRun
// ---------------------------------------------------------------------------------------------

describe('A6: applyBatch(lines, { dryRun: true }) (README 10)', () => {
  const LINES = ['M2 = Midpoint(A, B)', 'N2 = Midpoint(A, M2)', 'd = Distance(M2, N2)'];
  const dry = { group: 'g', dryRun: true } as never;
  const wet = { group: 'g' };

  it('commits nothing: names, ids, script, values and journal are as they were', () => {
    const f = figure(BASIC);
    const before = snap(f);
    f.applyBatch(LINES, dry);
    expectUnchanged(f, before);
    expect(f.get('M2')).toBeUndefined();
  });

  it('returns the shape a real batch returns', () => {
    const a = figure(BASIC);
    const b = figure(BASIC);
    const d = a.applyBatch(LINES, dry);
    const r = b.applyBatch(LINES, wet);
    for (const k of Object.keys(r)) expect(k in d, k).toBe(true);
    expect(d.ok).toBe(true);
    expect(d.rolledBack).toBe(r.rolledBack);
    expect(d.applied).toBe(r.applied);
    expect(d.results.length).toBe(r.results.length);
    expect(a.get('M2')).toBeUndefined();
    expect(b.get('M2')).toBeDefined();
  });

  it('every result matches the real line: op, type, summary, line number', () => {
    const a = figure(BASIC);
    const b = figure(BASIC);
    const d = a.applyBatch(LINES, dry);
    const r = b.applyBatch(LINES, wet);
    d.results.forEach((x, i) => {
      const dx = ok(x);
      const rx = ok(must(r.results[i]));
      expect(dx.op).toBe(rx.op);
      expect(dx.type).toBe(rx.type);
      expect(dx.summary).toBe(rx.summary);
      expect(dx.line).toBe(rx.line);
      expect(dx.name).toBe(rx.name);
    });
    expect(a.get('N2')).toBeUndefined();
  });

  it('each result is marked as a dry run', () => {
    const f = figure(BASIC);
    const d = f.applyBatch(LINES, dry);
    for (const x of d.results) expect(ok(x).dryRun).toBe(true);
  });

  it('the last result carries the type and value text of the last line', () => {
    const f = figure(BASIC);
    const d = f.applyBatch(['M2 = Midpoint(A, B)', 'N2 = Midpoint(A, M2)'], dry);
    const last = ok(must(d.results[d.results.length - 1]));
    expect(last.type).toBe('Point');
    expect(last.summary).toBe('N2 = (1, 0)');
    expect(f.get('N2')).toBeUndefined();
  });

  it('later lines see earlier lines of the same dry batch', () => {
    const f = figure(BASIC);
    const d = f.applyBatch(LINES, dry);
    expect(d.ok).toBe(true);
    expect(ok(must(d.results[2])).summary).toBe('d = 1');
    expect(f.get('d')).toBeUndefined();
  });

  it('a failing line gives the same error as the real batch and the figure is unchanged', () => {
    const lines = ['M2 = Midpoint(A, B)', 'N2 = Midpoint(A, Nope)', 'K = (1, 1)'];
    const a = figure(BASIC);
    const b = figure(BASIC);
    const before = snap(a);
    const d = a.applyBatch(lines, dry);
    const r = b.applyBatch(lines, wet);
    expect(d.ok).toBe(false);
    expect(d.rolledBack).toBe(r.rolledBack);
    const de = bad(must(d.results.find((x) => !x.ok)), 'unknown_name');
    const re = bad(must(r.results.find((x) => !x.ok)), 'unknown_name');
    expect(de.line).toBe(re.line);
    expect(de.col).toBe(re.col);
    expect(de.token).toBe(re.token);
    expect(de.fingerprint).toBe(re.fingerprint);
    expectUnchanged(a, before);
  });

  it('emits no events', () => {
    const f = figure(BASIC);
    const rec = recordEvents(f);
    f.applyBatch(LINES, dry);
    f.applyBatch(['A = (9, 9)', 'Delete(M)'], dry);
    expect(rec.events).toEqual([]);
  });

  it('leaves the redo stack and the clock alone', () => {
    const f = figure(BASIC);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    f.setClock(2);
    const info = f.undoInfo();
    f.applyBatch(LINES, dry);
    expect(f.undoInfo()).toEqual(info);
    expect(f.clock().t).toBe(2);
  });

  it('a dry batch of redefinitions and a delete changes no value and removes nothing', () => {
    const f = figure(BASIC);
    const before = snap(f);
    const d = f.applyBatch(['A = (9, 9)', 'Delete(M)'], dry);
    expect(d.ok).toBe(true);
    expect(f.value('A')).toEqual({ x: 0, y: 0 });
    expect(f.get('M')).toBeDefined();
    expectUnchanged(f, before);
  });

  it('independent mode also commits nothing', () => {
    const f = figure(BASIC);
    const before = snap(f);
    const d = f.applyBatch(['M2 = Midpoint(A, B)', 'Q = Midpoint(A, Zed)', 'K = (1, 1)'], { group: 'g', mode: 'independent', dryRun: true } as never);
    expect(d.results.length).toBe(3);
    expectUnchanged(f, before);
  });

  it('does not use up ids: a real line afterwards gets the id it would have had with no dry run', () => {
    const a = figure(BASIC);
    const b = figure(BASIC);
    a.applyBatch(LINES, dry);
    ok(a.apply('Z = (1, 1)'));
    ok(b.apply('Z = (1, 1)'));
    expect(idOf(a, 'Z')).toBe(idOf(b, 'Z'));
  });

  it('a dry run then the real batch gives the same results and one undo step', () => {
    const f = figure(BASIC);
    const d = f.applyBatch(LINES, dry);
    const depth = f.undoInfo().depth;
    const r = f.applyBatch(LINES, wet);
    expect(r.ok).toBe(true);
    expect(r.results.map((x) => ok(x).summary)).toEqual(d.results.map((x) => ok(x).summary));
    expect(f.undoInfo().depth).toBe(depth + 1);
  });

});
