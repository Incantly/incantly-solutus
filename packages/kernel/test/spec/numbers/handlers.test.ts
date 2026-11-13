/**
 * The `on` line: grammar, definition-time checks, step limits, cycles, storage (controls-scripting/design.md 3.3, 3.7, 3.9, 5;
 * errors.md 2).
 *
 * Silent-doc choices (written down):
 *  - The docs list `a = expr` under both handler_structure (definitions) and handler_define (a bare assignment). A bare
 *    `name = expr` is handler_define (every example uses it); a function definition `f(x) = ...` is handler_structure.
 *  - `showIf` is the property spelling (language rulings); `min`, `max` and `step` follow the numbers design.
 *  - Actions owned by other areas (Highlight, Trace, Untrace, Play, Pause, View, Axes, Grid) must be accepted as steps.
 */
import { describe, expect, it } from 'vitest';
import { addHandler, brokenSteps, clearHandler, handlersToScript, listHandlers, loadHandlers, parseHandlerLine, stepsMentioning } from '@incantly/kernel';
import type { ErrorObject, ParsedHandler } from '@incantly/kernel';
import { CTRL_BASE as BASE, T, bad, build, each, fig, newFigure, ok } from './helpers';

const parsed = (line: string): ParsedHandler => {
  const p = parseHandlerLine(line);
  if ('ok' in p) throw new Error(`parse failed: ${p.message}`);
  return p;
};
const add = (f: ReturnType<typeof fig>, line: string) => addHandler(f, line);
const kindOf = (r: { readonly ok: boolean }): string => String((r as { kind?: unknown }).kind);
const steps = (f: ReturnType<typeof fig>, target = 'go', event = 'click'): string[] => (listHandlers(f).find((h) => h.target === target && h.event === event)?.steps ?? []).map((s) => s.source);

describe('3.3 grammar: parseHandlerLine', () => {
  it('reads target, event and step', () => {
    const p = parsed('on go click: SetValue(a, 0)');
    expect(p).toMatchObject({ target: 'go', event: 'click', step: 'SetValue(a, 0)' });
    expect(p.stepIndex).toBeUndefined();
    expect(p.guard).toBeUndefined();
    expect(p.loop).toBeUndefined();
  });
  it('reads the guard', () => {
    expect(parsed('on a change if a > 5: Hide(P)')).toMatchObject({ target: 'a', event: 'change', guard: 'a > 5', step: 'Hide(P)' });
  });
  it('reads the loop', () => {
    expect(parsed('on go click for k in 1..5: SetValue(L, k, 0)').loop).toMatchObject({ variable: 'k', from: '1', to: '5' });
  });
  it('reads the step index', () => {
    expect(parsed('on go click #2: SetValue(a, 1)').stepIndex).toBe(2);
  });
  it('the step column is 1-based and points at the step text', () => {
    const line = 'on go click: SetValue(a, 0)';
    expect(parsed(line).stepCol).toBe(line.indexOf('SetValue') + 1);
  });
  it('figure is a target', () => {
    expect(parsed('on figure load: Animate(true)')).toMatchObject({ target: 'figure', event: 'load' });
  });
  it('a missing colon is a syntax error', () => {
    expect(kindOf(parseHandlerLine('on go click SetValue(a, 0)') as ErrorObject)).toBe('syntax');
  });
  it('an unknown event is unknown_event, lists the accepted events and suggests the closest', () => {
    const e = parseHandlerLine('on go clik: SetValue(a, 0)') as ErrorObject;
    expect(kindOf(e)).toBe('unknown_event');
    expect(JSON.stringify(e.params) + (e.hint ?? '')).toContain('click');
  });
});

describe('3.3 which events a target has (bad_event)', () => {
  const rows: [string, 'ok' | 'bad_event'][] = [
    ['on go click: SetValue(c, 1)', 'ok'],
    ['on go change: SetValue(c, 1)', 'bad_event'],
    ['on go input: SetValue(c, 1)', 'bad_event'],
    ['on go dragend: SetValue(c, 1)', 'bad_event'],
    ['on a change: SetValue(c, 1)', 'ok'],
    ['on a dragend: SetValue(c, 1)', 'ok'],
    ['on a click: SetValue(c, 1)', 'bad_event'],
    ['on chk change: SetValue(c, 1)', 'ok'],
    ['on chk click: SetValue(c, 1)', 'bad_event'],
    ['on d change: SetValue(c, 1)', 'ok'],
    ['on q input: SetValue(c, 1)', 'ok'],
    ['on q change: SetValue(c, 1)', 'ok'],
    ['on q click: SetValue(c, 1)', 'bad_event'],
    ['on P change: SetValue(c, 1)', 'ok'],
    ['on P dragend: SetValue(c, 1)', 'ok'],
    ['on P click: SetValue(c, 1)', 'bad_event'],
    ['on figure load: SetValue(c, 1)', 'ok'],
    ['on figure change: SetValue(c, 1)', 'ok'],
    ['on figure click: SetValue(c, 1)', 'bad_event'],
    ['on figure input: SetValue(c, 1)', 'bad_event'],
  ];
  each(rows)('the event table: %s is %s', (line, want) => {
    const r = add(fig(BASE), line);
    expect(r.ok ? 'ok' : kindOf(r)).toBe(want);
  });
  it('with clickable = true a point takes a click handler', () => {
    const f = fig(BASE);
    ok(f.apply('P with clickable = true'));
    expect(add(f, 'on P click: SetValue(c, 1)').ok).toBe(true);
  });
  it('bad_event names the target type and the events it does have', () => {
    const e = bad(add(fig(BASE), 'on a click: SetValue(c, 1)'), 'bad_event');
    expect(e.params['target_type']).toBe('Number');
    expect(String(e.params['allowed'])).toContain('change');
    expect(String(e.params['allowed'])).toContain('dragend');
  });
  it('an unknown target is unknown_name', () => {
    bad(add(fig(BASE), 'on zz click: SetValue(c, 1)'), 'unknown_name');
  });
});

describe('3.3 steps: append, replace, list', () => {
  it('each on line adds one step to the end and returns the whole list', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    const r = add(f, 'on go click: SetValue(c, 1)');
    expect(r.ok && r.value.steps).toEqual(['1: SetValue(a, 0)', '2: SetValue(c, 1)']);
    expect(r.ok && r.value.summary).toBe('go click: 2 steps');
  });
  it('one handler per target and event: a second line appends to it', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    add(f, 'on go click: SetValue(c, 1)');
    expect(listHandlers(f).filter((h) => h.target === 'go' && h.event === 'click')).toHaveLength(1);
  });
  it('#n replaces step n', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    add(f, 'on go click: SetValue(c, 1)');
    add(f, 'on go click #2: SetValue(c, 5)');
    expect(steps(f)).toEqual(['SetValue(a, 0)', 'SetValue(c, 5)']);
  });
  it('#n at steps + 1 appends', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    expect(add(f, 'on go click #2: SetValue(c, 1)').ok).toBe(true);
    expect(steps(f)).toHaveLength(2);
  });
  it('#n beyond steps + 1 is bad_step_index and lists the steps', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    const e = bad(add(f, 'on go click #9: SetValue(c, 1)'), 'bad_step_index');
    expect(e.params['steps']).toBeDefined();
    expect(steps(f)).toHaveLength(1);
  });
  it('a loop and a guard are shown in the step list', () => {
    const f = fig(BASE);
    const r1 = add(f, 'on go click for k in 1..3: SetValue(L, k, 0)');
    const r2 = add(f, 'on a change if a > 5: Hide(P)');
    expect(r1.ok && r1.value.steps[0]).toContain('for k in 1..3');
    expect(r2.ok && r2.value.steps[0]).toContain('if a > 5');
  });
  it('a failed line leaves the handlers as they were', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    const before = JSON.stringify(listHandlers(f));
    add(f, 'on go click: a = 5');
    expect(JSON.stringify(listHandlers(f))).toBe(before);
  });
  it('an on line is accepted by Figure.apply, as the core line kind it is', () => {
    const f = fig(BASE);
    ok(f.apply('on go click: SetValue(a, 0)'));
    expect(steps(f)).toEqual(['SetValue(a, 0)']);
  });
  it('toScript prints the on lines', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    expect(f.toScript()).toContain('on go click: SetValue(a, 0)');
  });
});

describe('3.3 what a step may be', () => {
  const allowed = [
    'SetValue(a, 0)',
    'Toggle(chk)',
    'Animate(a)',
    'Animate(false)',
    'Show(P)',
    'Hide(P)',
    'Reset()',
    'Reset(a)',
    'Click(go2)',
    'Highlight(P, 1)',
    'Trace(P)',
    'Untrace(P)',
    'Play()',
    'Pause()',
    'View(-5, 5, -5, 5)',
    'Axes(true)',
    'Grid(false)',
  ];
  each(allowed)('the action %s is a valid step', (step) => {
    const r = add(fig(BASE), `on go click: ${step}`);
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
  });
  const restyles = ['P with color = red', 'P with visible = false', 'P with showIf = true', 'P with showIf = none', 'a with min = 3', 'a with step = 1'];
  each(restyles)('the restyle %s with a constant is a valid step', (step) => {
    const r = add(fig(BASE), `on go click: ${step}`);
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
  });
  const formulas = ['P with showIf = a > 3', 'a with max = c', 'a with min = c + 1', 'a with step = c'];
  each(formulas)('the restyle %s with a formula is handler_graph_change', (step) => {
    expect(kindOf(add(fig(BASE), `on go click: ${step}`))).toBe('handler_graph_change');
  });
  it('handler_graph_change names the property', () => {
    const e = bad(add(fig(BASE), 'on go click: P with showIf = a > 3'), 'handler_graph_change');
    expect(String(e.params['property']).toLowerCase()).toBe('showif');
  });
  it('a bare assignment is handler_define with the suggestion SetValue(a, 0)', () => {
    const e = bad(add(fig(BASE), 'on go click: a = 0'), 'handler_define');
    expect(e.params['suggestion']).toBe('SetValue(a, 0)');
    expect(e.suggest).toContain('on go click: SetValue(a, 0)');
  });
  const structure = ['Delete(P)', 'Rename(a, z)', 'f(x) = x', '@digits 3', "w' = 1", 'on a change: SetValue(c, 1)'];
  each(structure)('the step %s is handler_structure', (step) => {
    expect(kindOf(add(fig(BASE), `on go click: ${step}`))).toBe('handler_structure');
  });
  it('handler_structure says what kind of step it was', () => {
    const e = bad(add(fig(BASE), 'on go click: Delete(P)'), 'handler_structure');
    expect(String(e.params['step_kind'])).toMatch(/delete/i);
    expect(e.hint ?? '').toContain('Hide');
  });
});

describe('3.3 steps are checked when the line is applied', () => {
  it('an unknown name is unknown_name with the column inside the step', () => {
    const line = 'on go click: SetValue(zz, 1)';
    const e = bad(add(fig(BASE), line), 'unknown_name');
    expect(e.col).toBe(line.indexOf('zz') + 1);
  });
  it('a wrong value type is refused now, not at the first press', () => {
    const e = add(fig(BASE), 'on go click: SetValue(a, "t")');
    expect(['no_matching_form', 'type_mismatch']).toContain(kindOf(e));
  });
  it('a dependent target is not_free and names its input', () => {
    const e = bad(add(fig(BASE), 'on go click: SetValue(b, 1)'), 'not_free');
    expect(JSON.stringify(e.params)).toContain('a');
  });
  it('a constant index outside the choice is bad_index', () => {
    bad(add(fig(BASE), 'on go click: SetValue(d, 9)'), 'bad_index');
  });
  it('self, value, event and the loop variable are known names in steps', () => {
    const f = fig(BASE);
    expect(add(f, 'on a change: SetValue(c, value)').ok).toBe(true);
    expect(add(f, 'on a change: SetValue(c, self)').ok).toBe(true);
    expect(add(f, 'on go click: SetValue(s, event)').ok).toBe(true);
    expect(add(f, 'on go click for k in 1..3: SetValue(L, k, k)').ok).toBe(true);
  });
  it('the loop variable is known in the guard too', () => {
    expect(add(fig(BASE), 'on go click for k in 1..5 if k > 2: SetValue(L, k, 0)').ok).toBe(true);
  });
});

describe('3.3 and errors.md handler_cycle', () => {
  it('a button that clicks itself is handler_cycle', () => {
    const e = bad(add(fig(BASE), 'on go click: Click(go)'), 'handler_cycle');
    expect(e.params['cycle']).toBeDefined();
  });
  it('two buttons that click each other are handler_cycle on the second line', () => {
    const f = fig(BASE);
    expect(add(f, 'on go click: Click(go2)').ok).toBe(true);
    bad(add(f, 'on go2 click: Click(go)'), 'handler_cycle');
  });
  it('a chain with no cycle is accepted', () => {
    const f = fig([...BASE, 'go3 = Button("Three")']);
    add(f, 'on go click: Click(go2)');
    expect(add(f, 'on go2 click: Click(go3)').ok).toBe(true);
  });
});

describe('3.9 and errors.md handler_limit at definition', () => {
  it('50 steps are accepted and the 51st is handler_limit with the limit and the actual count', () => {
    const f = fig(BASE);
    for (let i = 0; i < 50; i++) expect(add(f, 'on go click: SetValue(c, 1)').ok).toBe(true);
    const e = bad(add(f, 'on go click: SetValue(c, 2)'), 'handler_limit');
    expect(e.params['limit']).toBe(50);
    expect(e.params['actual']).toBe(51);
    expect(steps(f)).toHaveLength(50);
  });
  it('200 handlers are accepted and the 201st is handler_limit', () => {
    const f = newFigure();
    const lines: string[] = [];
    for (let i = 0; i < 201; i++) lines.push(`s${i} = 1 in 0..5`);
    build(f, lines);
    for (let i = 0; i < 200; i++) expect(addHandler(f, `on s${i} change: SetValue(s${i}, 1)`).ok).toBe(true);
    const e = bad(addHandler(f, 'on s200 change: SetValue(s200, 1)'), 'handler_limit');
    expect(e.params['limit']).toBe(200);
  }, T);
  it('a loop range literal of 1000 is accepted and 1001 is handler_limit', () => {
    const f = fig(BASE);
    expect(add(f, 'on go click for k in 1..1000: SetValue(c, 1)').ok).toBe(true);
    const e = bad(add(f, 'on go click for k in 1..1001: SetValue(c, 1)'), 'handler_limit');
    expect(e.params['limit']).toBe(1000);
  });
});

describe('3.3 ClearHandler', () => {
  it('removes the whole handler', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    expect(clearHandler(f, 'go', 'click').ok).toBe(true);
    expect(listHandlers(f)).toEqual([]);
  });
  it('removes one step and renumbers the rest', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    add(f, 'on go click: SetValue(c, 1)');
    add(f, 'on go click: Toggle(chk)');
    expect(clearHandler(f, 'go', 'click', 2).ok).toBe(true);
    expect(steps(f)).toEqual(['SetValue(a, 0)', 'Toggle(chk)']);
  });
  it('works through a draw line too: ClearHandler(go, click)', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    ok(f.apply('ClearHandler(go, click)'));
    expect(listHandlers(f)).toEqual([]);
  });
});

describe('3.7 handlers and the rest of the figure', () => {
  it('renaming an object rewrites the steps that name it', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    ok(f.rename('a', 'alpha'));
    expect(steps(f)).toEqual(['SetValue(alpha, 0)']);
  });
  it('deleting an object marks the steps that used it as broken', () => {
    const f = fig([...BASE.filter((l) => !l.startsWith('b =')), 'k = 4']);
    add(f, 'on go click: SetValue(c, 1)');
    add(f, 'on go click: SetValue(k, 0)');
    ok(f.delete('k'));
    expect(brokenSteps(f, 'go', 'click')).toEqual([2]);
  });
  it('deleting an object reports the handlers that used it', () => {
    const f = fig([...BASE, 'k = 4']);
    add(f, 'on go click: SetValue(k, 0)');
    expect(stepsMentioning(f, 'k')).toEqual([{ target: 'go', event: 'click', steps: [1] }]);
    expect(JSON.stringify(f.delete('k'))).toMatch(/handler|go/);
  });
  it('deleting the target removes its handlers', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    ok(f.delete('go'));
    expect(listHandlers(f)).toEqual([]);
  });
  it('handlersToScript and loadHandlers round-trip, with guards and loops', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)');
    add(f, 'on go click for k in 1..3 if k > 1: SetValue(L, k, 0)');
    add(f, 'on a change if a > 5: Hide(P)');
    const text = handlersToScript(f);
    const g = fig(BASE);
    const rep = loadHandlers(g, text);
    expect(rep.errors).toEqual([]);
    expect(JSON.stringify(listHandlers(g))).toBe(JSON.stringify(listHandlers(f)));
  });
  it('an on line costs one undo entry like any line', () => {
    const f = fig(BASE);
    const depth = f.undoInfo().depth;
    ok(f.apply('on go click: SetValue(a, 0)'));
    expect(f.undoInfo().depth).toBe(depth + 1);
  });
});
