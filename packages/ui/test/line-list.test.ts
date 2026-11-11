import { afterEach, describe, expect, it } from 'vitest';
import { defineLanguageElements, rowLabel } from '../src/index';
import type { LineListElement, LineRow } from '../src/index';

const ROWS: LineRow[] = [
  { id: 1, name: 'A', type: 'Point', source: 'A = (1, 2)', state: { defined: true, value: '(1, 2)' } },
  { id: 2, name: 's', type: 'Number', source: 's = 2 + 3', state: { defined: true, value: '5' } },
  { id: 3, name: 'g', type: 'Number', source: 'g = 1/0', state: { defined: false, reason: 'division_by_zero', cause: [] } },
  {
    id: 4,
    name: 'k',
    type: 'Number',
    source: 'k = g + 1',
    state: { defined: false, reason: 'input_undefined', cause: [{ name: 'g', reason: 'division_by_zero' }] },
  },
];

function mount(rows: readonly LineRow[] = ROWS): { el: LineListElement; root: ShadowRoot } {
  defineLanguageElements();
  const el = document.createElement('incantly-line-list') as LineListElement;
  document.body.append(el);
  el.rows = rows;
  return { el, root: el.shadowRoot as ShadowRoot };
}

const items = (root: ShadowRoot): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('li.row')];
const press = (target: Element, key: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

afterEach(() => document.body.replaceChildren());

describe('line list', () => {
  it('is a labelled list whose rows show type, definition and a value only when it adds something', () => {
    const { root } = mount();
    expect(root.querySelector('ul')?.getAttribute('aria-label')).toBe('Lines');
    const rows = items(root);
    expect(rows.length).toBe(4);
    expect(rows[0]?.querySelector('.type')?.textContent).toBe('Point');
    expect(rows[0]?.querySelector('.value')).toBeNull();
    expect(rows[1]?.querySelector('.value')?.textContent).toBe('= 5');
  });

  it('shows an undefined value with its reason and the cause chain, and names it for a screen reader', () => {
    const { root } = mount();
    const [, , g, k] = items(root);
    expect(g?.querySelector('.undef')?.textContent).toContain('division by zero');
    expect(k?.querySelector('.undef')?.textContent).toContain('an input is undefined');
    expect(k?.querySelector('.cause li')?.textContent).toBe('g is undefined: division by zero');
    expect(k?.getAttribute('aria-label')).toBe('k, number, undefined because g is undefined: division by zero');
  });

  it('builds a spoken name with the definition and the value', () => {
    expect(rowLabel(ROWS[1] as LineRow)).toBe('s, number, defined as 2 plus 3, value 5');
  });

  it('moves focus with the arrow keys, Home and End, and keeps one tab stop', () => {
    const { root } = mount();
    const rows = items(root);
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
    rows[0]?.focus();
    press(rows[0] as Element, 'ArrowDown');
    expect(root.activeElement).toBe(rows[1]);
    press(rows[1] as Element, 'End');
    expect(root.activeElement).toBe(rows[3]);
    press(rows[3] as Element, 'Home');
    expect(root.activeElement).toBe(rows[0]);
    expect(items(root).filter((r) => r.tabIndex === 0).length).toBe(1);
  });

  it('asks the host to edit a row on Enter, and jumps to the cause when its name is chosen', () => {
    const { el, root } = mount();
    const seen: string[] = [];
    el.addEventListener('incantly-row-edit', (e) => seen.push((e as CustomEvent<{ name: string; source: string }>).detail.source));
    const rows = items(root);
    rows[1]?.focus();
    press(rows[1] as Element, 'Enter');
    expect(seen).toEqual(['s = 2 + 3']);
    (rows[3]?.querySelector('button[data-goto]') as HTMLButtonElement).click();
    expect(root.activeElement).toBe(rows[2]);
  });

  it('shows a hint when empty and reuses row nodes when only one changes', () => {
    const { el, root } = mount([]);
    expect(root.querySelector('.empty')?.hasAttribute('hidden')).toBe(false);
    el.rows = ROWS;
    const before = items(root);
    el.rows = ROWS.map((r) => (r.id === 2 ? { ...r, state: { defined: true as const, value: '6' } } : r));
    const after = items(root);
    expect(after[0]).toBe(before[0]);
    expect(after[1]?.querySelector('.value')?.textContent).toBe('= 6');
  });
});

describe('line list controls', () => {
  const FREE: LineRow[] = [
    { id: 1, name: 'a', type: 'Number', source: 'a = 3 in 0..8 step 1', free: true, control: { kind: 'slider', min: 0, max: 8, step: 1, value: 3, text: '3' }, state: { defined: true, value: '3' } },
    { id: 2, name: 'P', type: 'Point', source: 'P = (1, 2)', free: true, control: { kind: 'text', text: '(1, 2)' }, state: { defined: true, value: '(1, 2)' } },
    { id: 3, name: 'b', type: 'Bool', source: 'b = true', free: true, locked: true, control: { kind: 'bool', checked: true }, state: { defined: true, value: 'true' } },
    { id: 4, name: 'M', type: 'Point', source: 'M = Midpoint(P, P)', state: { defined: true, value: '(1, 2)' } },
  ];

  it('marks free and pinned rows and gives each free object a labelled control', () => {
    const { root } = mount(FREE);
    const [a, p, b, m] = items(root);
    expect(a?.querySelector('.free')?.hasAttribute('hidden')).toBe(false);
    expect(m?.querySelector('.free')?.hasAttribute('hidden')).toBe(true);
    expect(b?.querySelector('.pinned')?.hasAttribute('hidden')).toBe(false);
    expect(a?.querySelector('input')?.getAttribute('type')).toBe('range');
    expect(a?.querySelector('input')?.getAttribute('aria-label')).toBe('a, slider');
    expect(p?.querySelector('input')?.getAttribute('aria-label')).toBe('Value of P');
    expect((b?.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect(m?.querySelector('input')).toBeNull();
    expect(p?.getAttribute('aria-label')).toContain(', free');
  });

  it('reports a typed value on Enter, a slider as it moves and when it is released', () => {
    const { el, root } = mount(FREE);
    const sets: string[] = [];
    const slides: string[] = [];
    el.addEventListener('incantly-row-set', (e) => sets.push(JSON.stringify((e as CustomEvent).detail)));
    el.addEventListener('incantly-row-slide', (e) => slides.push(JSON.stringify((e as CustomEvent).detail)));
    const [a, p] = items(root);
    const field = p?.querySelector('input') as HTMLInputElement;
    field.value = '(5, 6)';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(sets).toEqual(['{"name":"P","text":"(5, 6)"}']);
    const slider = a?.querySelector('input') as HTMLInputElement;
    slider.value = '4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(slides).toEqual(['{"name":"a","value":4,"done":false}', '{"name":"a","value":4,"done":true}']);
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    expect(slides[2]).toBe('{"name":"a","value":8,"done":true}');
  });

  it('keeps the same control element when a row updates, so a drag is not interrupted', () => {
    const { el, root } = mount(FREE);
    const before = items(root)[0]?.querySelector('input');
    el.rows = FREE.map((r) => (r.id === 1 ? { ...r, control: { kind: 'slider' as const, min: 0, max: 8, step: 1, value: 5, text: '5' }, state: { defined: true as const, value: '5' } } : r));
    const after = items(root)[0]?.querySelector('input') as HTMLInputElement;
    expect(after).toBe(before);
    expect(after.value).toBe('5');
  });

  it('asks the host to rename or delete from the buttons and from F2 and Delete', () => {
    const { el, root } = mount(FREE);
    const seen: string[] = [];
    el.addEventListener('incantly-row-rename', (e) => seen.push(`rename ${(e as CustomEvent).detail.name}`));
    el.addEventListener('incantly-row-delete', (e) => seen.push(`delete ${(e as CustomEvent).detail.name}`));
    const rows = items(root);
    (rows[3]?.querySelector('button[data-act="rename"]') as HTMLButtonElement).click();
    (rows[3]?.querySelector('button[data-act="delete"]') as HTMLButtonElement).click();
    expect(rows[3]?.querySelector('button[data-act="delete"]')?.getAttribute('aria-label')).toBe('Delete M');
    press(rows[1] as Element, 'F2');
    press(rows[1] as Element, 'Delete');
    expect(seen).toEqual(['rename M', 'delete M', 'rename P', 'delete P']);
    // Delete inside a field is the field's own
    press(rows[1]?.querySelector('input') as Element, 'Delete');
    expect(seen.length).toBe(4);
  });

  it('puts the row buttons and fields on the tab stop only for the current row', () => {
    const { root } = mount(FREE);
    const rows = items(root);
    expect(rows[0]?.querySelector('input')?.tabIndex).toBe(0);
    expect(rows[1]?.querySelector('input')?.tabIndex).toBe(-1);
    rows[0]?.focus();
    press(rows[0] as Element, 'ArrowDown');
    expect(rows[0]?.querySelector('button.act')?.getAttribute('tabindex')).toBe('-1');
    expect(rows[1]?.querySelector('input')?.tabIndex).toBe(0);
  });

  it('marks highlighted rows with a text chip as well as a colour', () => {
    const { el, root } = mount(FREE);
    el.highlighted = ['P'];
    const [a, p] = items(root);
    expect(p?.classList.contains('marked')).toBe(true);
    expect(p?.querySelector('.rel')?.hasAttribute('hidden')).toBe(false);
    expect(p?.getAttribute('aria-label')).toContain('related to the error');
    expect(a?.classList.contains('marked')).toBe(false);
    el.highlighted = [];
    expect(p?.classList.contains('marked')).toBe(false);
  });
});
