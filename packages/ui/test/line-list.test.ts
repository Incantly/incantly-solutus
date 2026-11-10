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
