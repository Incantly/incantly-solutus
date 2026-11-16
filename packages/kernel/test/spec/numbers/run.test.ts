/**
 * Running a handler: order, atomic commit, budgets, events, safety (controls-scripting/design.md 3.3 to 3.6, 5, 6, 7;
 * errors.md 3 and 6).
 *
 * Silent-doc choices (written down):
 *  - A reversed loop range (5..1) runs zero iterations.
 *  - A guard that is undefined skips the step (guard_false or undefined_argument both read as skipped).
 *  - `trigger` is the value the host asked for through `by`; a run started with `by: 'host'` reports 'host'.
 *  - A pause in a hung run cannot be interrupted in-process; every test here has a vitest timeout and, where the run is bounded
 *    by a counted budget, a wall-clock limit.
 */
import { describe, expect, it } from 'vitest';
import { addHandler, clickButton, commitInputText, lastRuns, onControlEvent, runHandler, runLoadHandlers, setChoiceIndex, setValue, toggleCheckbox } from '@incantly/kernel';
import type { ControlEvent, FigureEvent, HandlerRun } from '@incantly/kernel';
import { CTRL_BASE as BASE, T, build, fig, newFigure, num, oid, ok, snapshot, within } from './helpers';

const add = (f: ReturnType<typeof fig>, ...lines: string[]): void => {
  for (const l of lines) {
    const r = addHandler(f, l);
    if (!r.ok) throw new Error(`handler line "${l}" failed: ${String(r.kind)}: ${r.message}`);
  }
};
const click = (f: ReturnType<typeof fig>, name = 'go', by: 'learner' | 'host' = 'learner'): HandlerRun => {
  const r = clickButton(f, name, { by });
  if (!r.ok) throw new Error(`click ${name} failed: ${String(r.kind)}: ${r.message}`);
  return r.value;
};
const list = (f: ReturnType<typeof fig>, name: string): number[] => Array.from(f.value(name) as ArrayLike<number>);

describe('3.4 a run in order, as one transaction', () => {
  it('later steps see earlier steps: SetValue(a, 0) then SetValue(c, a + 1) gives c = 1', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)', 'on go click: SetValue(c, a + 1)');
    click(f);
    expect(num(f, 'a')).toBe(0);
    expect(num(f, 'c')).toBe(1);
  });
  it('the run record lists each step as done with the values it wrote, as text', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 7)');
    const run = click(f);
    expect(run).toMatchObject({ ok: true, stepsUsed: 1, handler: { target: 'go', event: 'click' } });
    expect(run.results[0]).toMatchObject({ step: 1, status: 'done', wrote: [{ name: 'a', from: '3', to: '7' }] });
  });
  it('the whole run is one undo entry named after the trigger: click go', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)', 'on go click: SetValue(c, 5)', 'on go click: Toggle(chk)');
    const depth = f.undoInfo().depth;
    click(f);
    expect(f.undoInfo().depth).toBe(depth + 1);
    expect(f.undoInfo().next).toBe('click go');
    ok(f.undo());
    expect(num(f, 'a')).toBe(3);
    expect(num(f, 'c')).toBe(1);
    expect(f.value('chk')).toBe(true);
  });
  it('the run makes one update pass: listeners see one value event', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 0)', 'on go click: SetValue(c, 5)');
    const evs: FigureEvent[] = [];
    f.on((e) => evs.push(e));
    click(f);
    expect(evs.filter((e) => e.ev === 'value')).toHaveLength(1);
  });
  it('the trigger is reported as learner or host', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(c, 5)');
    expect(click(f, 'go', 'learner').trigger).toBe('learner');
    expect(click(f, 'go', 'host').trigger).toBe('host');
  });
  it('a hidden button still runs its handler (the code path)', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(c, 5)');
    ok(f.apply('go with visible = false'));
    click(f);
    expect(num(f, 'c')).toBe(5);
  });
  it('Click(go) in a draw line runs the handler', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(c, 5)');
    ok(f.apply('Click(go)'));
    expect(num(f, 'c')).toBe(5);
  });
  it('the same run from the same state gives the same state (determinism)', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, c + 2)', 'on go click: Toggle(chk)');
    click(f);
    const first = snapshot(f).replace(/undo=\d+/, '');
    ok(f.undo());
    click(f);
    expect(snapshot(f).replace(/undo=\d+/, '')).toBe(first);
  });
  it('a restyle step changes appearance at run time', () => {
    const f = fig(BASE);
    add(f, 'on go click: P with color = red');
    const before = JSON.stringify(f.get('P')?.style.color);
    click(f);
    ok(f.apply('Q with color = red'));
    expect(JSON.stringify(f.get('P')?.style.color)).not.toBe(before);
    expect(JSON.stringify(f.get('P')?.style.color)).toBe(JSON.stringify(f.get('Q')?.style.color));
  });
  it('Reset() in a handler restores the value the object was defined with', () => {
    const f = fig(BASE);
    ok(f.apply('SetValue(a, 9)'));
    add(f, 'on go click: Reset()');
    click(f);
    expect(num(f, 'a')).toBe(3);
  });
});

describe('3.4 steps: guards, loops, skipped steps', () => {
  it('a false guard skips the step with reason guard_false and the run goes on', () => {
    const f = fig(BASE);
    add(f, 'on go click if a > 5: SetValue(c, 5)', 'on go click: SetValue(c, 6)');
    const run = click(f);
    expect(run.results[0]).toMatchObject({ status: 'skipped', reason: 'guard_false' });
    expect(num(f, 'c')).toBe(6);
  });
  it('an undefined guard skips the step', () => {
    const f = fig([...BASE, 'm = 0', 'u1 = 1 / m > 1']);
    add(f, 'on go click if u1: SetValue(c, 5)');
    const run = click(f);
    expect(run.results[0]?.status).toBe('skipped');
    expect(num(f, 'c')).toBe(1);
  });
  it('an undefined argument skips the step with reason undefined_argument and the run goes on', () => {
    const f = fig([...BASE, 'm = 0', 'u1 = 1 / m']);
    add(f, 'on go click: SetValue(c, u1)', 'on go click: SetValue(a, 8)');
    const run = click(f);
    expect(run.results[0]).toMatchObject({ status: 'skipped', reason: 'undefined_argument' });
    expect(num(f, 'a')).toBe(8);
  });
  it('a computed choice index out of range skips the step with reason out_of_range', () => {
    const f = fig([...BASE, 'i = 9']);
    add(f, 'on go click: SetValue(d, i)');
    const run = click(f);
    expect(run.results[0]).toMatchObject({ status: 'skipped', reason: 'out_of_range' });
  });
  it('for k in 1..5 runs the step five times and counts five steps', () => {
    const f = fig(BASE);
    add(f, 'on go click for k in 1..5: SetValue(L, k, 0)');
    const run = click(f);
    expect(run.stepsUsed).toBe(5);
    expect(list(f, 'L').slice(0, 3)).toEqual([0, 0, 0]);
  });
  it('the loop variable k is the whole number of the iteration', () => {
    const f = fig(BASE);
    add(f, 'on go click for k in 1..3: SetValue(L, k, k * 10)');
    click(f);
    expect(list(f, 'L')).toEqual([10, 20, 30]);
  });
  it('a guard on a loop step sees k', () => {
    const f = fig(BASE);
    add(f, 'on go click for k in 1..3 if k > 1: SetValue(L, k, 0)');
    click(f);
    expect(list(f, 'L')).toEqual([1, 0, 0]);
  });
  it('the example form SetValue(L[k], 0) works in a loop', () => {
    const f = fig(BASE);
    add(f, 'on go click for k in 1..3: SetValue(L[k], 0)');
    click(f);
    expect(list(f, 'L')).toEqual([0, 0, 0]);
  });
  it('loop ends that are not whole skip the step with reason loop_range', () => {
    const f = fig([...BASE, 'm = 2.5']);
    add(f, 'on go click for k in 1..m: SetValue(c, k)');
    expect(click(f).results[0]).toMatchObject({ status: 'skipped', reason: 'loop_range' });
    expect(num(f, 'c')).toBe(1);
  });
  it('a loop beyond 1000 iterations skips the step with reason loop_range', () => {
    const f = fig([...BASE, 'm = 2000']);
    add(f, 'on go click for k in 1..m: SetValue(c, 2)');
    expect(click(f).results[0]).toMatchObject({ status: 'skipped', reason: 'loop_range' });
  });
  it('a loop of exactly 1000 iterations runs', () => {
    const f = fig([...BASE, 'm = 1000']);
    add(f, 'on go click for k in 1..m: SetValue(c, 2)');
    const run = click(f);
    expect(run.stepsUsed).toBe(1000);
    expect(num(f, 'c')).toBe(2);
  });
  it('a reversed loop range runs zero iterations', () => {
    const f = fig([...BASE, 'm = 0']);
    add(f, 'on go click for k in 5..m: SetValue(c, 2)');
    const run = click(f);
    expect(run.ok).toBe(true);
    expect(num(f, 'c')).toBe(1);
  });
  it('a step that names a deleted object is skipped with reason broken and the run goes on', () => {
    const f = fig([...BASE, 'k = 4']);
    add(f, 'on go click: SetValue(k, 0)', 'on go click: SetValue(c, 5)');
    ok(f.delete('k'));
    const run = click(f);
    expect(run.results[0]).toMatchObject({ status: 'skipped', reason: 'broken' });
    expect(num(f, 'c')).toBe(5);
  });
});

describe('3.4 and 3.9 budgets: counted, not timed', () => {
  const loop3000 = (f: ReturnType<typeof fig>) => {
    add(f, 'on go click for k in 1..1000: SetValue(a, 7)', 'on go click for k in 1..1000: SetValue(c, 7)', 'on go click for k in 1..1000: SetValue(r, 4)');
  };
  it('2000 step executions are allowed', () => {
    const f = fig(BASE);
    add(f, 'on go click for k in 1..1000: SetValue(a, 7)', 'on go click for k in 1..1000: SetValue(c, 7)');
    const run = click(f);
    expect(run.ok).toBe(true);
    expect(run.stepsUsed).toBe(2000);
  }, T);
  it('2001 aborts the run with handler_limit, limit 2000 and actual 2001', () => {
    const f = fig(BASE);
    loop3000(f);
    const run = click(f);
    expect(run.ok).toBe(false);
    expect(String(run.error?.kind)).toBe('handler_limit');
    expect(run.error?.params['limit']).toBe(2000);
    expect(run.error?.params['actual']).toBe(2001);
    expect(run.stepsUsed).toBe(2001);
  }, T);
  it('an aborted run applies nothing', () => {
    const f = fig(BASE);
    loop3000(f);
    const before = snapshot(f);
    click(f);
    expect(snapshot(f)).toBe(before);
  }, T);
  it('an aborted run reports what it discarded', () => {
    const f = fig(BASE);
    loop3000(f);
    const run = click(f);
    expect(JSON.stringify(run.error?.params['discarded'] ?? '')).toContain('a');
  }, T);
  it('Click nesting of 8 is allowed', () => {
    const f = newFigure();
    build(f, ['a = 3 in 0..10', ...Array.from({ length: 10 }, (_, i) => `go${i} = Button("B${i}")`)]);
    for (let i = 0; i < 8; i++) add(f, `on go${i} click: Click(go${i + 1})`);
    add(f, 'on go8 click: SetValue(a, 9)');
    const run = click(f, 'go0');
    expect(run.ok).toBe(true);
    expect(num(f, 'a')).toBe(9);
  }, T);
  it('Click nesting of 9 aborts with handler_limit and applies nothing', () => {
    const f = newFigure();
    build(f, ['a = 3 in 0..10', ...Array.from({ length: 10 }, (_, i) => `go${i} = Button("B${i}")`)]);
    for (let i = 0; i < 9; i++) add(f, `on go${i} click: Click(go${i + 1})`);
    add(f, 'on go9 click: SetValue(a, 9)');
    const run = click(f, 'go0');
    expect(run.ok).toBe(false);
    expect(String(run.error?.kind)).toBe('handler_limit');
    expect(num(f, 'a')).toBe(3);
  }, T);
  it('Click(other) runs the other handler in the same transaction', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(a, 1)', 'on go click: Click(go2)', 'on go2 click: SetValue(c, 6)');
    const depth = f.undoInfo().depth;
    click(f);
    expect(num(f, 'a')).toBe(1);
    expect(num(f, 'c')).toBe(6);
    expect(f.undoInfo().depth).toBe(depth + 1);
  });
  it('only the last 20 runs are kept, newest last', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(c, 5)');
    for (let i = 0; i < 25; i++) click(f);
    expect(lastRuns(f)).toHaveLength(20);
  });
  it('a typical 3-step handler on a figure of 500 objects runs fast', { retry: 2, timeout: T }, () => {
    const f = newFigure();
    const lines = ['a = 3 in 0..10', 'c = 1 in 0..10', 'go = Button("Go")'];
    for (let i = 0; i < 497; i++) lines.push(`p${i} = a + ${i}`);
    build(f, lines);
    add(f, 'on go click: SetValue(a, 0)', 'on go click: SetValue(c, 5)', 'on go click: SetValue(a, 6)');
    within(500, () => {
      for (let i = 0; i < 50; i++) click(f);
    });
  });
});

describe('3.3 events come from learner gestures only, so handlers cannot loop', () => {
  const loopFigure = () => {
    const f = fig(BASE);
    add(f, 'on a change: SetValue(c, 2 * a)', 'on c change: SetValue(a, c / 2)');
    return f;
  };
  it('a learner change runs the handler of that object', () => {
    const f = loopFigure();
    setValue(f, 'a', 4, { by: 'learner' });
    expect(num(f, 'c')).toBe(8);
  });
  it('the handler write does not raise the other handler: a stays where the learner put it', () => {
    const f = loopFigure();
    setValue(f, 'a', 4, { by: 'learner' });
    expect(num(f, 'a')).toBe(4);
    expect(lastRuns(f)).toHaveLength(1);
  });
  it('a write from a draw line raises no event and runs no handler', () => {
    const f = loopFigure();
    ok(f.apply('SetValue(a, 4)'));
    expect(num(f, 'c')).toBe(1);
    expect(lastRuns(f)).toHaveLength(0);
  });
  it('value is the new value of the target (host runs the change handler with the payload)', () => {
    const f = fig(BASE);
    add(f, 'on a change: SetValue(c, value * 2)');
    runHandler(f, 'a', 'change', { value: 3.5, by: 'learner' }, 'learner');
    expect(num(f, 'c')).toBe(7);
  });
  it('self is the object that raised the event (host payload)', () => {
    const f = fig(BASE);
    add(f, 'on figure change: SetValue(c, self)');
    runHandler(f, 'figure', 'change', { changedName: 'a', by: 'learner' }, 'learner');
    expect(num(f, 'c')).toBe(3);
  });
  it('a learner change of the value runs the handler: value is the new value', () => {
    const f = fig(BASE);
    add(f, 'on a change: SetValue(c, value * 2)');
    setValue(f, 'a', 3.5, { by: 'learner' });
    expect(num(f, 'c')).toBe(7);
  });
  it('event is the name of the event as text', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(s, event)');
    click(f);
    expect(f.value('s')).toBe('click');
  });
  it('a checkbox toggle by the learner raises change', () => {
    const f = fig(BASE);
    add(f, 'on chk change: SetValue(c, 7)');
    toggleCheckbox(f, 'chk', { by: 'learner' });
    expect(num(f, 'c')).toBe(7);
  });
  it('a dropdown pick by the learner raises change with the chosen value', () => {
    const f = fig(BASE);
    add(f, 'on d change: SetValue(c, value / 10)');
    setChoiceIndex(f, oid(f, 'd'), 2, { by: 'learner' });
    expect(num(f, 'c')).toBe(2);
  });
  it('an input commit by the learner raises change on the target', () => {
    const f = fig(BASE);
    add(f, 'on r change: SetValue(c, value)');
    commitInputText(f, 'q', '4', { by: 'learner' });
    expect(num(f, 'c')).toBe(4);
  });
  it('on figure change runs for a change of any object, once, and its own write does not repeat it', () => {
    const f = fig(BASE);
    add(f, 'on figure change: SetValue(c, c + 1)');
    setValue(f, 'a', 5, { by: 'learner' });
    expect(num(f, 'c')).toBe(2);
  });
  it('on figure load runs once when the host asks, and not when lines are applied', () => {
    const f = fig(BASE);
    add(f, 'on figure load: SetValue(c, 9)');
    expect(num(f, 'c')).toBe(1);
    const run = runLoadHandlers(f);
    expect(run?.ok).toBe(true);
    expect(num(f, 'c')).toBe(9);
  });
  it('on figure load is skipped when the host sets autorun false', () => {
    const f = fig(BASE);
    add(f, 'on figure load: SetValue(c, 9)');
    expect(runLoadHandlers(f, { autorun: false })).toBeUndefined();
    expect(num(f, 'c')).toBe(1);
  });
});

describe('3.6 and 7 host listeners', () => {
  it('a button press tells the host: click, the name, learner', () => {
    const f = fig(BASE);
    const seen: ControlEvent[] = [];
    onControlEvent(f, (e) => seen.push(e));
    click(f);
    expect(seen).toContainEqual(expect.objectContaining({ event: 'click', name: 'go', by: 'learner' }));
  });
  it('a finished run tells the host: handlerRun', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(c, 5)');
    const seen: ControlEvent[] = [];
    onControlEvent(f, (e) => seen.push(e));
    click(f);
    expect(seen.some((e) => e.event === 'handlerRun')).toBe(true);
  });
  it('a listener that throws does not break the run or the other listeners', () => {
    const f = fig(BASE);
    add(f, 'on go click: SetValue(c, 5)');
    const seen: ControlEvent[] = [];
    onControlEvent(f, () => {
      throw new Error('bad listener');
    });
    onControlEvent(f, (e) => seen.push(e));
    expect(() => click(f)).not.toThrow();
    expect(num(f, 'c')).toBe(5);
    expect(seen.length).toBeGreaterThan(0);
  });
  it('a click on a slider (no click event) is refused', () => {
    expect(clickButton(fig(BASE), 'a').ok).toBe(false);
  });
});
