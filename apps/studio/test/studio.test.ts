import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KernelSession, parseFree } from '../src/session';
import { EXAMPLE_LINES, mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

function lines(s: KernelSession, ...src: string[]): void {
  for (const l of src) expect(s.submit(l).ok).toBe(true);
}

describe('kernel session', () => {
  it('turns kernel objects into rows with type, value and free or dependent state', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (4, 6)', 'M = Midpoint(A, B)', 'd = Distance(A, B)');
    const [a, , m, d] = s.rows();
    expect(a).toMatchObject({ name: 'A', type: 'Point', free: true, control: { kind: 'text', text: '(1, 2)' }, state: { defined: true, value: '(1, 2)' } });
    expect(m).toMatchObject({ name: 'M', type: 'Point', state: { defined: true, value: '(2.5, 4)' } });
    expect(m?.free).toBeUndefined();
    expect(d?.state).toMatchObject({ defined: true, value: '5' });
  });

  it('gives a slider row for a ranged free number', () => {
    const s = new KernelSession();
    lines(s, 'a = 3 in 0..8 step 2');
    expect(s.rows()[0]?.control).toEqual({ kind: 'slider', min: 0, max: 8, step: 2, value: 3, text: '3' });
  });

  it('refuses a bad line with the unified error and changes nothing', () => {
    const s = new KernelSession();
    const r = s.submit('q = Midpoint(A, Bb)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unknown_name');
    expect(s.rows()).toEqual([]);
  });

  it('follows the cause chain to the root and recovers when the root is redefined', () => {
    const s = new KernelSession();
    lines(s, 'g = 1/0', 'k = g + 1', 'm = k * 2');
    const m = s.rows().find((r) => r.name === 'm');
    expect(m?.state).toMatchObject({ defined: false, reason: 'input_undefined' });
    if (m && !m.state.defined) expect(m.state.cause.map((c) => [c.name, c.reason])).toEqual([['k', 'input_undefined'], ['g', 'division_by_zero']]);
    lines(s, 'g = 4');
    expect(s.rows().map((r) => r.state.defined)).toEqual([true, true, true]);
    expect(s.rows().find((r) => r.name === 'm')?.state).toMatchObject({ value: '10' });
  });

  it('reports a command reason from a rule (parallel lines)', () => {
    const s = new KernelSession();
    lines(s, 'A = (0, 0)', 'B = (1, 0)', 'C = (0, 1)', 'D = (1, 1)', 'l1 = Line(A, B)', 'l2 = Line(C, D)', 'I = Intersect(l1, l2)');
    expect(s.rows().find((r) => r.name === 'I')?.state).toMatchObject({ defined: false, reason: 'parallel' });
  });

  it('labels undo with the line and redo restores it', () => {
    const s = new KernelSession();
    expect(s.undoState()).toMatchObject({ canUndo: false, canRedo: false });
    lines(s, 'A = (1, 2)');
    expect(s.undoState()).toMatchObject({ canUndo: true, label: 'A = (1, 2)' });
    const u = s.undo();
    expect(u).toMatchObject({ ok: true, message: 'Undid: A = (1, 2)' });
    expect(s.rows()).toEqual([]);
    expect(s.undoState().canRedo).toBe(true);
    expect(s.redo().ok).toBe(true);
    expect(s.rows().map((r) => r.name)).toEqual(['A']);
    expect(s.undo().ok && s.undo().ok).toBe(false);
  });

  it('renames, and refuses a taken name with the object it clashes with', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)');
    const bad = s.rename('B', 'A');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatchObject({ kind: 'name_taken', related: ['A'] });
    expect(s.rename('B', 'Q').ok).toBe(true);
    expect(s.rows().find((r) => r.name === 'M')?.source).toBe('M = Midpoint(A, Q)');
  });

  it('shows the delete plan, deletes with the cascade and undo brings it all back', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)', 'N = Midpoint(A, M)');
    expect(s.deletePlan('A')).toEqual(['A', 'M', 'N']);
    expect(s.deletePlan('N')).toEqual(['N']);
    expect(s.delete('A')).toMatchObject({ ok: true, message: 'Deleted A, M, N' });
    expect(s.rows().map((r) => r.name)).toEqual(['B']);
    s.undo();
    expect(s.rows().map((r) => r.name)).toEqual(['A', 'B', 'M', 'N']);
  });

  it('writes a free value in place, and falls back to a line for other text', () => {
    const s = new KernelSession();
    lines(s, 'a = 2', 'P = (1, 1)', 'b = a * 2');
    expect(s.setText('a', '5').ok).toBe(true);
    expect(s.setText('P', '(3, -1)').ok).toBe(true);
    expect(s.rows().map((r) => r.state)).toMatchObject([{ value: '5' }, { value: '(3, -1)' }, { value: '10' }]);
    const bad = s.setText('a', '(1, 2)');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.kind).toBe('type_change');
    expect(s.setText('a', '1 +').ok).toBe(false);
  });

  it('makes a slider drag one undo step', () => {
    const s = new KernelSession();
    lines(s, 'a = 3 in 0..8 step 1', 'b = a * 2');
    s.slide('a', 4, false);
    s.slide('a', 5, false);
    s.slide('a', 6, true);
    expect(s.rows()[1]?.state).toMatchObject({ value: '12' });
    expect(s.undo().ok).toBe(true);
    expect(s.rows()[1]?.state).toMatchObject({ value: '6' });
  });

  it('refuses a write to a computed object', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)');
    const r = s.slide('M', 1, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_free');
  });

  it('saves a script and loads it into a new figure; a script with no usable line keeps the figure', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)');
    const text = s.save();
    expect(text).toContain('M = Midpoint(A, B)');
    const t = new KernelSession();
    lines(t, 'q = 1');
    const ok = t.load(text);
    expect(ok).toMatchObject({ applied: 4, total: 4, errors: [], replaced: true });
    expect(t.rows().map((r) => r.name)).toEqual(['A', 'B', 'M']);
    const part = t.load('A = (1, 2)\nM = Midpont(A, A)\nN = Midpoint(A, M)');
    expect(part.replaced).toBe(true);
    expect(part.errors.map((e) => e.kind)).toEqual(['unknown_command', 'unknown_name']);
    expect(part.applied).toBe(1);
    expect(part.total).toBe(3);
    const none = t.load('@fig 99\nA = 1');
    expect(none.replaced).toBe(false);
    expect(none.errors[0]?.kind).toBe('version');
    expect(t.rows().map((r) => r.name)).toEqual(['A']);
  });

  it('knows when the figure has a clock and moves it', () => {
    const s = new KernelSession();
    lines(s, 'f(x) = x^2', 'a = 2');
    expect(s.hasClock()).toBe(false);
    lines(s, 'w = a * t');
    expect(s.hasClock()).toBe(true);
    expect(s.setTime(1.5).ok).toBe(true);
    expect(s.time()).toBe(1.5);
    expect(s.rows().find((r) => r.name === 'w')?.state).toMatchObject({ value: '3' });
  });

  it('parses plain values by the type of the object', () => {
    expect(parseFree('Number', ' −2.5 ')).toBe(-2.5);
    expect(parseFree('Number', '2+3')).toBeUndefined();
    expect(parseFree('Point', '(1, -2)')).toEqual({ x: 1, y: -2 });
    expect(parseFree('Bool', 'true')).toBe(true);
    expect(parseFree('Text', '"a"')).toBeUndefined();
  });
});

describe('studio page', () => {
  let root: HTMLElement;
  let m: Mounted;
  let frames: ((now: number) => void)[];

  const mount = (): Mounted => {
    root = document.createElement('main');
    document.body.append(root);
    frames = [];
    return mountStudio(root, { raf: (cb) => frames.push(cb), caf: () => void (frames = []) });
  };
  const type = (text: string): void => {
    const ta = m.editor.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  const btn = (label: string): HTMLButtonElement => [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
  const row = (name: string): HTMLElement => m.list.shadowRoot?.querySelector(`li.row[data-name="${name}"]`) as HTMLElement;
  const key = (k: string, init: KeyboardEventInit = {}): void => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    m = mount();
  });
  afterEach(() => {
    m.dispose();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('says there is no drawing yet, and wires the input to the kernel figure and the list', () => {
    expect(root.textContent).toContain('No drawing yet');
    type('A = (1, 2)');
    expect(m.list.rows.map((r) => r.name)).toEqual(['A']);
    expect(m.session.figure.get('A')).toBeDefined();
    expect(m.editor.shadowRoot?.querySelector('[aria-live="polite"]')?.textContent).toBe('A = (1, 2)');
    expect(root.querySelector('.count')?.textContent).toBe('1 object in the figure.');
  });

  it('shows the kernel error under the input and marks the related objects in the list', () => {
    m.loadExample();
    type('Q = Midpoint(A, Bb)');
    expect(m.editor.shadowRoot?.querySelector('.strip')?.textContent).toContain('Bb is not defined');
    expect(m.session.figure.count).toBe(EXAMPLE_LINES.length);
  });

  it('loads the example as one undo step and shows the cascade', () => {
    m.loadExample();
    expect(m.list.rows.length).toBe(EXAMPLE_LINES.length);
    expect(m.session.figure.count).toBe(EXAMPLE_LINES.length);
    expect(m.list.shadowRoot?.querySelector('.cause li')?.textContent).toContain('g is undefined');
    expect(btn('Undo').getAttribute('aria-label')).toBe('Undo: Load example');
    btn('Undo').click();
    expect(m.list.rows.length).toBe(0);
    expect(btn('Undo').disabled).toBe(true);
    expect(root.querySelector('.status')?.textContent).toBe('Undid: Load example');
    btn('Redo').click();
    expect(m.list.rows.length).toBe(EXAMPLE_LINES.length);
  });

  it('undoes and redoes with the keyboard, leaving the input field its own undo while it has text', () => {
    type('A = (1, 2)');
    type('B = (3, 4)');
    key('z', { ctrlKey: true });
    expect(m.list.rows.map((r) => r.name)).toEqual(['A']);
    key('z', { ctrlKey: true, shiftKey: true });
    expect(m.list.rows.map((r) => r.name)).toEqual(['A', 'B']);
    const ta = m.editor.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'x';
    const e = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true, composed: true });
    ta.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(m.list.rows.length).toBe(2);
    ta.value = '';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true, composed: true }));
    expect(m.list.rows.length).toBe(1);
  });

  it('says so when there is nothing to undo', () => {
    m.undo();
    expect(m.card.hidden).toBe(false);
    expect(m.card.shadowRoot?.textContent).toContain('There is nothing to undo');
  });

  it('deletes a leaf at once, and shows the plan before a delete that cascades', () => {
    for (const l of ['A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)']) type(l);
    (row('A').querySelector('button[data-act="delete"]') as HTMLButtonElement).click();
    const bar = root.querySelector('.actionbar') as HTMLElement;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain('also removes M');
    expect(m.list.rows.length).toBe(3);
    btn('Cancel').click();
    expect(bar.hidden).toBe(true);
    expect(m.list.rows.length).toBe(3);
    // the Delete key on a row does the same
    row('A').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    btn('Delete 2 objects').click();
    expect(m.list.rows.map((r) => r.name)).toEqual(['B']);
    expect(root.querySelector('.status')?.textContent).toContain('Deleted A, M');
    row('B').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(bar.hidden).toBe(true);
    expect(m.list.rows.length).toBe(0);
    m.undo();
    expect(m.list.rows.map((r) => r.name)).toEqual(['B']);
  });

  it('closes the delete plan with Escape', () => {
    for (const l of ['A = (1, 2)', 'M = Midpoint(A, A)']) type(l);
    row('A').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const bar = root.querySelector('.actionbar') as HTMLElement;
    expect(bar.hidden).toBe(false);
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(bar.hidden).toBe(true);
    expect(m.list.rows.length).toBe(2);
  });

  it('renames with F2, and shows a taken name as an error that marks the other object', () => {
    for (const l of ['A = (1, 2)', 'B = (3, 4)']) type(l);
    row('B').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    const input = root.querySelector('.rename') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('New name for B');
    input.value = 'A';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(m.card.shadowRoot?.textContent).toContain('A is already used by a Point');
    expect(m.list.highlighted).toEqual(['A']);
    expect(row('A').classList.contains('marked')).toBe(true);
    expect(row('A').querySelector('.rel')?.hasAttribute('hidden')).toBe(false);
    input.value = 'C';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(m.list.rows.map((r) => r.name)).toEqual(['A', 'C']);
    expect(m.card.hidden).toBe(true);
    expect(m.list.highlighted).toEqual([]);
    expect((root.querySelector('.actionbar') as HTMLElement).hidden).toBe(true);
  });

  it('puts a suggested fix from an error into the input without running it', () => {
    type('A = (1, 2)');
    type('B = (3, 4)');
    type('M = Midpoint(A, B)');
    const e = m.session.figure.setFree('M', { x: 1, y: 1 }, 'api');
    expect(e.ok).toBe(false);
    if (!e.ok) m.card.error = e;
    const fix = m.card.shadowRoot?.querySelector('button[data-fix]') as HTMLButtonElement;
    expect(fix.textContent).toBe('M = (1, 1)');
    fix.click();
    const ta = m.editor.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('M = (1, 1)');
  });

  it('edits a free value and a slider in the list, each a step to undo', () => {
    type('a = 3 in 0..8 step 1');
    type('P = (1, 1)');
    type('b = a * 2');
    const slider = row('a').querySelector('input[type="range"]') as HTMLInputElement;
    slider.value = '5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.value = '6';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(m.list.rows.find((r) => r.name === 'b')?.state).toMatchObject({ value: '12' });
    expect(row('a').querySelector('input[type="range"]')).toBe(slider);
    const field = row('P').querySelector('input[type="text"]') as HTMLInputElement;
    field.value = '(2, 3)';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(m.list.rows.find((r) => r.name === 'P')?.state).toMatchObject({ value: '(2, 3)' });
    m.undo();
    expect(m.list.rows.find((r) => r.name === 'P')?.state).toMatchObject({ value: '(1, 1)' });
    m.undo();
    expect(m.list.rows.find((r) => r.name === 'b')?.state).toMatchObject({ value: '6' });
  });

  it('shows the clock only when the figure reads t, and plays and pauses it', () => {
    const clock = root.querySelector('.clock') as HTMLElement;
    type('a = 2');
    expect(clock.hidden).toBe(true);
    type('w = a * t');
    expect(clock.hidden).toBe(false);
    expect(root.querySelector('.readout')?.textContent).toBe('t = 0 s');
    btn('Play').click();
    expect(btn('Pause').getAttribute('aria-pressed')).toBe('true');
    frames.shift()?.(1000);
    frames.shift()?.(1500);
    expect(root.querySelector('.readout')?.textContent).toBe('t = 0.5 s');
    expect(m.list.rows.find((r) => r.name === 'w')?.state).toMatchObject({ value: '1' });
    btn('Pause').click();
    expect(frames.length).toBe(0);
    btn('Back to start').click();
    expect(root.querySelector('.readout')?.textContent).toBe('t = 0 s');
  });

  it('saves the figure as script lines and loads them back, listing the problems', () => {
    type('A = (1, 2)');
    type('B = (3, 4)');
    btn('Save script').click();
    const box = root.querySelector('.script-text') as HTMLTextAreaElement;
    expect(box.value).toBe('@fig 1\nA = (1, 2)\nB = (3, 4)\n');
    m.undo();
    m.undo();
    expect(m.list.rows.length).toBe(0);
    btn('Load script').click();
    expect(m.list.rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(root.querySelector('.report')?.textContent).toBe('Loaded 3 of 3 lines.');
    box.value = 'A = (1, 2)\nM = Midpont(A, A)';
    btn('Load script').click();
    expect(root.querySelector('.report')?.textContent).toContain('line 2:');
    expect(root.querySelector('.report')?.textContent).toContain('Loaded 1 of 2 lines.');
    expect(m.editor.figure).toBe(m.session.figure.view);
  });
});
