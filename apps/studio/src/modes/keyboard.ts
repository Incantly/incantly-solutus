/**
 * The on-screen maths keyboard (app-modes design 3.10; ui 7, 8): keys from the mode's layout, filtered by its command
 * policy, typing into the focused maths field. Docked at the bottom, at most 36% of the height; the figure area shrinks
 * instead of being covered. Every key is a button with a spoken name; arrows move between keys.
 */
import { applyKey, compilePolicy, layoutFor } from '@incantly/modes';
import type { I18n, Key, KeyAction, KeyboardLayout, ModeConfig, CommandRef } from '@incantly/modes';

export interface MathKeyboard {
  readonly element: HTMLElement;
  readonly toggleButton: HTMLButtonElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Builds the keys again for a mode (a forbidden command has no key). */
  setMode(mode: ModeConfig): void;
  /** The field keys type into when nothing is focused. */
  setDefaultTarget(input: HTMLInputElement | undefined): void;
  /** Presses a key by id, as a click would (tests and the physical shortcut layer). */
  press(id: string): void;
  /** Toggles from the keyboard reach the host: `exact` (S↔D) and `angle` (deg/rad). */
  onToggle(fn: (what: 'exact' | 'angle') => void): void;
  dispose(): void;
}

export function mountKeyboard(opts: { readonly i18n: I18n; readonly catalogue: readonly CommandRef[]; readonly mode: ModeConfig; readonly onLayout?: () => void }): MathKeyboard {
  const { i18n } = opts;
  const element = document.createElement('div');
  element.className = 'math-keyboard';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', i18n.t('kb.open'));
  element.hidden = true;
  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'icon-btn kb-toggle';
  toggleButton.textContent = '⌨';
  toggleButton.title = i18n.t('kb.open');
  toggleButton.setAttribute('aria-label', i18n.t('kb.open'));
  toggleButton.setAttribute('aria-expanded', 'false');

  let layout: KeyboardLayout = layoutFor(opts.mode.keyboard, compilePolicy(opts.mode), opts.catalogue).layout;
  let tab = layout.tabs[0]?.id ?? '';
  let shift = false;
  let lastField: HTMLInputElement | undefined;
  let fallback: HTMLInputElement | undefined;
  let toggle: ((what: 'exact' | 'angle') => void) | undefined;

  const isField = (n: Element | null): n is HTMLInputElement => n instanceof HTMLInputElement && (n.type === 'text' || n.type === 'search' || n.type === '') && !n.readOnly && !n.disabled;
  const onFocus = (e: FocusEvent): void => {
    const t = e.target as Element | null;
    if (isField(t) && (t.classList.contains('expr-input') || t.classList.contains('sci-input') || t.classList.contains('cas-input'))) {
      lastField = t;
      // touch screens with no keyboard open it on focus (`keyboard: auto`)
      if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !api.isOpen()) api.open();
    }
  };
  document.addEventListener('focusin', onFocus);

  const target = (): HTMLInputElement | undefined => (lastField && lastField.isConnected ? lastField : fallback);

  const run = (action: KeyAction): void => {
    if (action.kind === 'shift') {
      shift = !shift;
      render();
      return;
    }
    if (action.kind === 'switch') {
      tab = action.tab;
      render();
      return;
    }
    if (action.kind === 'toggle') {
      toggle?.(action.what);
      return;
    }
    const field = target();
    if (!field) return;
    const caret = field.selectionStart ?? field.value.length;
    const sel = (field.selectionEnd ?? caret) - caret;
    const r = applyKey(action, field.value, caret, sel);
    if (!r) return;
    if ('done' in r) {
      if (r.done === 'enter') field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      else api.close();
      return;
    }
    field.value = r.text;
    field.setSelectionRange?.(r.caret, r.caret);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus({ preventScroll: true });
    if (shift) {
      shift = false;
      render();
    }
  };

  const keyButton = (k: Key): HTMLButtonElement => {
    const face = shift && k.shifted ? k.shifted : k;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `key key-${k.style ?? 'normal'}${k.action.kind === 'shift' && shift ? ' on' : ''}`;
    b.dataset['key'] = k.id;
    b.textContent = face.label;
    b.setAttribute('aria-label', i18n.t(face.aria, face.ariaParams ?? {}));
    if (k.action.kind === 'shift') b.setAttribute('aria-pressed', String(shift));
    if (k.width) b.style.flexGrow = String(k.width);
    // keep the caret in the field: a key press must not take focus
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => run(face.action));
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (k.longPress && k.longPress.length > 0) {
      b.addEventListener('pointerdown', () => {
        timer = setTimeout(() => run((k.longPress as readonly KeyAction[])[0] as KeyAction), 500);
      });
      b.addEventListener('pointerup', () => clearTimeout(timer));
      b.addEventListener('pointerleave', () => clearTimeout(timer));
    }
    return b;
  };

  const render = (): void => {
    element.replaceChildren();
    if (layout.tabs.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'kb-tabs';
      tabs.setAttribute('role', 'tablist');
      for (const t of layout.tabs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `kb-tab${t.id === tab ? ' on' : ''}`;
        b.textContent = t.label;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(t.id === tab));
        b.setAttribute('aria-label', i18n.t(t.aria));
        b.addEventListener('pointerdown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          tab = t.id;
          render();
        });
        tabs.append(b);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'kb-close';
      close.textContent = '▾';
      close.setAttribute('aria-label', i18n.t('kb.close'));
      close.addEventListener('click', () => api.close());
      tabs.append(close);
      element.append(tabs);
    }
    const t = layout.tabs.find((x) => x.id === tab) ?? layout.tabs[0];
    const grid = document.createElement('div');
    grid.className = 'kb-rows';
    for (const row of t?.rows ?? []) {
      const r = document.createElement('div');
      r.className = 'kb-row';
      for (const k of row) r.append(keyButton(k));
      grid.append(r);
    }
    // arrow keys move between keys in reading order (ui 8)
    grid.addEventListener('keydown', (e) => {
      const keys = [...grid.querySelectorAll<HTMLButtonElement>('.key')];
      const i = keys.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      keys[(i + step + keys.length) % keys.length]?.focus();
    });
    element.append(grid);
  };

  const api: MathKeyboard = {
    element,
    toggleButton,
    open() {
      render();
      element.hidden = false;
      toggleButton.setAttribute('aria-expanded', 'true');
      toggleButton.classList.add('on');
      opts.onLayout?.();
    },
    close() {
      element.hidden = true;
      toggleButton.setAttribute('aria-expanded', 'false');
      toggleButton.classList.remove('on');
      opts.onLayout?.();
    },
    isOpen: () => !element.hidden,
    setMode(mode) {
      layout = layoutFor(mode.keyboard, compilePolicy(mode), opts.catalogue).layout;
      if (!layout.tabs.some((x) => x.id === tab)) tab = layout.tabs[0]?.id ?? '';
      if (!element.hidden) render();
    },
    setDefaultTarget(input) {
      fallback = input;
    },
    press(id) {
      for (const t of layout.tabs) {
        for (const row of t.rows) {
          const k = row.find((x) => x.id === id);
          if (k) {
            run(shift && k.shifted ? k.shifted.action : k.action);
            return;
          }
        }
      }
    },
    onToggle(fn) {
      toggle = fn;
    },
    dispose() {
      document.removeEventListener('focusin', onFocus);
    },
  };
  toggleButton.addEventListener('click', () => (api.isOpen() ? api.close() : api.open()));
  return api;
}
