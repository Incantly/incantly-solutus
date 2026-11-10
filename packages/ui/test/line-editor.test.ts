import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScratchFigure, createCommandTable } from '@incantly/kernel';
import type { CommandSpec, LanguageError } from '@incantly/kernel';
import { ERROR_DELAY_MS, PREVIEW_DELAY_MS, defineLanguageElements } from '../src/index';
import type { LineEditorElement, SubmitResult } from '../src/index';

const rule = (): unknown => ({});
const COMMANDS: CommandSpec[] = [
  {
    name: 'Midpoint',
    kind: 'object',
    group: 'geometry',
    forms: [
      { params: [{ name: 'a', type: 'Point' }, { name: 'b', type: 'Point' }], returns: 'Point', rule, summary: 'midpoint of two points' },
      { params: [{ name: 's', type: 'Segment' }], returns: 'Point', rule, summary: 'midpoint of a segment' },
    ],
  },
  {
    name: 'Circle',
    kind: 'object',
    group: 'geometry',
    forms: [
      { params: [{ name: 'center', type: 'Point' }, { name: 'radius', type: 'Number' }], returns: 'Circle', rule, summary: 'circle by centre and radius' },
      { params: [{ name: 'center', type: 'Point' }, { name: 'through', type: 'Point' }], returns: 'Circle', rule, summary: 'circle through a point' },
    ],
  },
];

function makeFigure(): ScratchFigure {
  const fig = new ScratchFigure({ commands: createCommandTable(COMMANDS) });
  fig.applyAll(['A = (1, 2)', 'B = (4, 6)']);
  return fig;
}

interface Harness {
  readonly el: LineEditorElement;
  readonly ta: HTMLTextAreaElement;
  readonly root: ShadowRoot;
  type(text: string, caret?: number): void;
  key(key: string, init?: KeyboardEventInit): KeyboardEvent;
}

function mount(fig = makeFigure()): Harness {
  defineLanguageElements();
  const el = document.createElement('incantly-line-editor') as LineEditorElement;
  document.body.append(el);
  el.figure = fig;
  const root = el.shadowRoot as ShadowRoot;
  const ta = root.querySelector('textarea') as HTMLTextAreaElement;
  return {
    el,
    ta,
    root,
    type(text, caret = text.length) {
      ta.value = text;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    },
    key(key, init = {}) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      ta.dispatchEvent(e);
      return e;
    },
  };
}

const text = (root: ShadowRoot, sel: string): string => root.querySelector(sel)?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('line editor: colouring and live checking', () => {
  it('colours tokens as you type, with the command in bold class and the number in its own class', () => {
    const h = mount();
    h.type('M = Midpoint(A, 3)');
    const cls = (c: string): string[] => [...h.root.querySelectorAll(`.mirror .${c}`)].map((n) => n.textContent ?? '');
    expect(cls('tok-command')).toEqual(['Midpoint']);
    expect(cls('tok-number')).toEqual(['3']);
    expect(cls('tok-object')).toContain('A');
  });

  it('does not call the name being defined unknown, but does mark an unknown name that is read', () => {
    const h = mount();
    h.type('c = 1');
    vi.advanceTimersByTime(ERROR_DELAY_MS + 10);
    expect(h.root.querySelector('.mirror .tok-unknown')).toBeNull();
    expect(h.root.querySelector('.mirror .squiggle')).toBeNull();
    h.type('c = zz + 1');
    vi.advanceTimersByTime(ERROR_DELAY_MS + 10);
    expect(h.root.querySelector('.mirror .tok-unknown.squiggle')?.textContent).toBe('zz');
  });

  it('shows no error while typing, then the message, a wavy mark and a live-region announcement after the pause', () => {
    const h = mount();
    h.type('c = Circle(A, 2, 3)');
    vi.advanceTimersByTime(PREVIEW_DELAY_MS + 10);
    expect(h.root.querySelector('.strip .error')).toBeNull();
    expect(h.root.querySelector('.mirror .squiggle')).toBeNull();
    vi.advanceTimersByTime(ERROR_DELAY_MS);
    expect(text(h.root, '.strip .msg')).toContain('Circle takes 2 arguments');
    expect(h.root.querySelector('.mirror .squiggle')).not.toBeNull();
    expect(h.root.querySelector('.gutter')?.textContent).toBe('✗');
    expect(h.ta.getAttribute('aria-invalid')).toBe('true');
    const live = h.root.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/^Error in column \d+: Circle takes 2 arguments/);
  });

  it('offers form chips and a one-click fix that changes the field and then checks clean', () => {
    const h = mount();
    h.type('c = Circle(A, 2, 3)');
    vi.advanceTimersByTime(ERROR_DELAY_MS + 10);
    expect(h.root.querySelectorAll('.chips button.form-chip').length).toBe(2);
    const fix = h.root.querySelector('.chips button.fix') as HTMLButtonElement;
    expect(fix.getAttribute('aria-label')).toBe('Suggested fix: c = Circle(A, 3)');
    fix.click();
    expect(h.ta.value).toBe('c = Circle(A, 3)');
    vi.advanceTimersByTime(ERROR_DELAY_MS + 10);
    expect(h.root.querySelector('.strip .error')).toBeNull();
    expect(text(h.root, '.strip .preview')).toContain('Circle');
  });

  it('treats an unfinished call as incomplete input, not as an error', () => {
    const h = mount();
    h.type('c = Circle(A, ');
    vi.advanceTimersByTime(ERROR_DELAY_MS + 10);
    expect(h.root.querySelector('.strip .error')).toBeNull();
    expect(text(h.root, '.strip .expects')).toMatch(/^expects:/);
  });

  it('Esc clears the strip but keeps the text', () => {
    const h = mount();
    h.type('c = Circle(A, 2, 3)');
    vi.advanceTimersByTime(ERROR_DELAY_MS + 10);
    h.key('Escape');
    expect(h.root.querySelector('.strip .error')).toBeNull();
    expect(h.ta.value).toBe('c = Circle(A, 2, 3)');
  });
});

describe('line editor: completion and signature help', () => {
  it('opens a labelled listbox after two letters and accepts a command with placeholders pre-filled by type', () => {
    const h = mount();
    h.type('M = Mid');
    const list = h.root.querySelector('[role="listbox"]') as HTMLElement;
    expect(list.hidden).toBe(false);
    expect(h.ta.getAttribute('aria-autocomplete')).toBe('list');
    expect(h.ta.getAttribute('aria-controls')).toBe(list.id);
    const first = list.querySelector('[role="option"]') as HTMLElement;
    expect(first.textContent).toContain('Midpoint');
    expect(h.ta.getAttribute('aria-activedescendant')).toBe(first.id);

    h.key('Enter');
    expect(h.ta.value).toBe('M = Midpoint(B, A)');
    expect((h.root.querySelector('[role="listbox"]') as HTMLElement).hidden).toBe(true);
    expect(h.ta.value.slice(h.ta.selectionStart, h.ta.selectionEnd)).toBe('B');
    h.key('Tab');
    expect(h.ta.value.slice(h.ta.selectionStart, h.ta.selectionEnd)).toBe('A');
    h.key('Tab', { shiftKey: true });
    expect(h.ta.value.slice(h.ta.selectionStart, h.ta.selectionEnd)).toBe('B');
  });

  it('closes the list on Esc without touching the text', () => {
    const h = mount();
    h.type('M = Mid');
    h.key('Escape');
    expect((h.root.querySelector('[role="listbox"]') as HTMLElement).hidden).toBe(true);
    expect(h.ta.value).toBe('M = Mid');
  });

  it('shows the forms of the command at the caret and underlines the current parameter', () => {
    const h = mount();
    h.type('c = Circle(A, ');
    const forms = [...h.root.querySelectorAll('.sig .form')];
    expect(forms.length).toBe(2);
    expect(forms[0]?.classList.contains('active')).toBe(true);
    expect(forms[0]?.querySelector('u')?.textContent).toBe('radius: Number');
  });
});

describe('line editor: submit and history', () => {
  it('applies pasted lines in order, clears the field and announces the count', () => {
    const h = mount();
    const seen: string[] = [];
    h.el.onSubmitLine = (line): SubmitResult => {
      seen.push(line);
      return { ok: true };
    };
    h.type('a = 1\nb = 2');
    h.key('Enter');
    expect(seen).toEqual(['a = 1', 'b = 2']);
    expect(h.ta.value).toBe('');
    expect(text(h.root, '[aria-live="polite"]')).toBe('2 lines applied');
  });

  it('on a failing line keeps it and the rest, selects the bad span and shows the error at once', () => {
    const h = mount();
    h.el.onSubmitLine = (line): SubmitResult => {
      if (line.includes('bad')) {
        const error = { ok: false, committed: false, kind: 'unknown_name', code: 'K001', phase: 'resolve', message: 'bad is not defined.', messageKey: 'x', params: {}, line: 1, col: 5, endCol: 8, token: 'bad', expected: [], forms: [], suggest: [], recovery: 'fix_line', fingerprint: 'f', severity: 'error' } as LanguageError;
        return { ok: false, error };
      }
      return { ok: true };
    };
    h.type('a = 1\nb = bad\nc = 3');
    h.key('Enter');
    expect(h.ta.value).toBe('b = bad\nc = 3');
    expect(h.ta.value.slice(h.ta.selectionStart, h.ta.selectionEnd)).toBe('bad');
    expect(text(h.root, '.strip .msg')).toBe('bad is not defined.');
  });

  it('Up in an empty field brings back the last submitted line', () => {
    const h = mount();
    h.el.onSubmitLine = (): SubmitResult => ({ ok: true });
    h.type('a = 1');
    h.key('Enter');
    expect(h.ta.value).toBe('');
    h.key('ArrowUp');
    expect(h.ta.value).toBe('a = 1');
    h.key('ArrowDown');
    expect(h.ta.value).toBe('');
  });

  it('auto-closes a bracket, steps over the closer and removes an empty pair with Backspace', () => {
    const h = mount();
    h.ta.value = '';
    h.ta.setSelectionRange(0, 0);
    const e = h.key('(');
    expect(e.defaultPrevented).toBe(true);
    expect(h.ta.value).toBe('()');
    expect(h.ta.selectionStart).toBe(1);
    h.key(')');
    expect(h.ta.value).toBe('()');
    expect(h.ta.selectionStart).toBe(2);
    h.ta.setSelectionRange(1, 1);
    h.key('Backspace');
    expect(h.ta.value).toBe('');
  });
});
