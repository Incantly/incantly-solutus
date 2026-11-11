import { afterEach, describe, expect, it } from 'vitest';
import { Figure } from '@incantly/kernel';
import { defineLanguageElements, errorNames } from '../src/index';
import type { ErrorCardElement } from '../src/index';

function mount(): ErrorCardElement {
  defineLanguageElements();
  const el = document.createElement('incantly-error-card') as ErrorCardElement;
  document.body.append(el);
  return el;
}

afterEach(() => document.body.replaceChildren());

describe('error card', () => {
  it('is hidden until it has an error, and is a polite live region', () => {
    const el = mount();
    expect(el.hidden).toBe(true);
    expect(el.shadowRoot?.querySelector('[aria-live="polite"]')?.getAttribute('role')).toBe('status');
  });

  it('shows the message, the hint, the related objects and a button per suggestion', () => {
    const f = new Figure();
    f.apply('M = (3, 4)');
    f.apply('N = (1, 1)');
    const r = f.rename('N', 'M');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const el = mount();
    el.error = r;
    expect(el.hidden).toBe(false);
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain(r.message);
    expect(text).toContain(r.hint ?? '');
    expect(el.shadowRoot?.querySelector('button[data-goto="M"]')?.getAttribute('aria-label')).toBe('Go to M');
    expect(errorNames(r)).toEqual(['M']);
  });

  it('offers each suggestion as a button that asks the host to put it in the input', () => {
    const f = new Figure();
    f.apply('A = (1, 2)');
    f.apply('B = (3, 4)');
    const bad = f.rename('A', 'B');
    expect(bad.ok).toBe(false);
    const el = mount();
    const fixes: string[] = [];
    el.addEventListener('incantly-fix', (e) => fixes.push((e as CustomEvent).detail.line));
    el.error = { ...(bad as object), suggest: ['Rename(A, "A2")'] } as never;
    (el.shadowRoot?.querySelector('button[data-fix]') as HTMLButtonElement).click();
    expect(fixes).toEqual(['Rename(A, "A2")']);
  });

  it('shows the kind and code only when asked, and can be dismissed', () => {
    const f = new Figure();
    const r = f.apply('q = Nope(1)');
    expect(r.ok).toBe(false);
    const el = mount();
    el.error = r as never;
    expect(el.shadowRoot?.querySelector('.msg')?.textContent).not.toContain(' K');
    el.technical = true;
    expect(el.shadowRoot?.querySelector('.msg')?.textContent).toMatch(/^unknown_command K\d{3}: /);
    (el.shadowRoot?.querySelector('button.close') as HTMLButtonElement).click();
    expect(el.hidden).toBe(true);
    expect(el.error).toBeNull();
  });
});
