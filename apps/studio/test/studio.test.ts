import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScratchSession } from '../src/session';
import { EXAMPLE_LINES, mountStudio } from '../src/studio-page';

describe('scratch session', () => {
  it('turns accepted lines into rows with type and value', () => {
    const s = new ScratchSession();
    expect(s.submit('A = (1, 2)').ok).toBe(true);
    expect(s.submit('s = 2 + 3').ok).toBe(true);
    const [a, n] = s.rows();
    expect(a).toMatchObject({ name: 'A', type: 'Point', state: { defined: true, value: '(1, 2)' } });
    expect(n).toMatchObject({ name: 's', type: 'Number', state: { defined: true, value: '5' } });
  });

  it('refuses a bad line with the language error and changes nothing', () => {
    const s = new ScratchSession();
    const r = s.submit('h = nope + 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unknown_name');
    expect(s.rows()).toEqual([]);
  });

  it('gives an undefined row its reason and follows the cause chain to the root, then recovers on redefinition', () => {
    const s = new ScratchSession();
    for (const l of ['g = 1/0', 'k = g + 1', 'm = k * 2']) s.submit(l);
    const m = s.rows().find((r) => r.name === 'm');
    expect(m?.state).toMatchObject({ defined: false, reason: 'input_undefined' });
    if (m && !m.state.defined) expect(m.state.cause.map((c) => [c.name, c.reason])).toEqual([['k', 'input_undefined'], ['g', 'division_by_zero']]);
    expect(s.submit('g = 4').ok).toBe(true);
    expect(s.rows().map((r) => r.state.defined)).toEqual([true, true, true]);
    expect(s.rows().find((r) => r.name === 'm')?.state).toMatchObject({ value: '10' });
  });

  it('keeps a command line undefined with a reason that says the kernel is missing', () => {
    const s = new ScratchSession();
    s.submit('A = (1, 2)');
    s.submit('B = (4, 6)');
    expect(s.submit('M = Midpoint(A, B)').ok).toBe(true);
    const m = s.rows().find((r) => r.name === 'M');
    expect(m?.state).toMatchObject({ defined: false, reason: 'not_set' });
    if (m && !m.state.defined) expect(m.state.detail).toContain('kernel');
  });
});

describe('studio page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('says there is no kernel or drawing, and wires the input to the list', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const m = mountStudio(root);
    expect(root.textContent).toContain('No figure yet');
    expect(root.textContent).toContain('no kernel');
    const ta = m.editor.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'A = (1, 2)';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ta.value).toBe('');
    expect(m.list.rows.map((r) => r.name)).toEqual(['A']);
    expect(m.editor.shadowRoot?.querySelector('[aria-live="polite"]')?.textContent).toBe('A defined as point (1 comma 2)');
  });

  it('loads the example: every line is accepted and the cascade shows in the list', () => {
    const root = document.createElement('main');
    document.body.append(root);
    const m = mountStudio(root);
    m.loadExample();
    expect(m.list.rows.length).toBe(EXAMPLE_LINES.length);
    const k = m.list.rows.find((r) => r.name === 'k');
    expect(k?.state.defined).toBe(false);
    expect(m.list.shadowRoot?.querySelector('.cause li')?.textContent).toContain('g is undefined');
  });
});
