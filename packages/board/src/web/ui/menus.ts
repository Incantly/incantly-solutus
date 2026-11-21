/**
 * The menus a host can change (design 10, "Menus"; docs/state-machines.md B29): the main menu, the menu of a page and the
 * context menu are lists of `MenuItem`, built when the menu opens by a function the host can wrap. One menu is open at a
 * time. A function that throws or returns a bad list gives the default list and is reported.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { boardError } from '../../core/errors';
import type { BoardError } from '../../core/errors';
import { describeKey } from '../../core/keymap';
import { defaultIcon } from './icons';

type MenuState = 'closed' | 'main' | 'page' | 'context';
type MenuEvent = 'openMain' | 'openPage' | 'openContext' | 'close';

export const MENU_MACHINE: MachineTable<MenuState, MenuEvent> = {
  closed: { openMain: 'main', openPage: 'page', openContext: 'context' },
  main: { close: 'closed', openPage: 'page', openContext: 'context' },
  page: { close: 'closed', openMain: 'main', openContext: 'context' },
  context: { close: 'closed', openMain: 'main', openPage: 'page' },
};

/** What a menu is about: the page a page menu is for, the shapes and the point a context menu was opened on. */
export interface MenuTarget {
  readonly kind: 'main' | 'page' | 'shape' | 'board';
  /** The page of a page menu. */
  readonly page?: string;
  /** The selected shapes a context menu acts on. */
  readonly shapes?: readonly string[];
  /** Where the menu was opened, in page units (a context menu). */
  readonly at?: { readonly x: number; readonly y: number };
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** An icon id of the board (`image`, `figure`, …) or SVG text; none for a text-only item. */
  readonly icon?: string;
  /** The key to show beside the label, `mod+z` form. */
  readonly key?: string;
  /** False greys the item out and never runs it; default true. */
  enabled?(target: MenuTarget): boolean;
  run(target: MenuTarget): void;
}

/** What a host gives for a menu: the default items in, the items to show out. */
export type MenuFn = (items: readonly MenuItem[], target: MenuTarget) => readonly MenuItem[];

export interface MenuFns {
  readonly main?: MenuFn;
  readonly page?: MenuFn;
  readonly context?: MenuFn;
}

const isItem = (x: unknown): x is MenuItem => {
  if (typeof x !== 'object' || x === null) return false;
  const i = x as Record<string, unknown>;
  return typeof i['id'] === 'string' && typeof i['label'] === 'string' && typeof i['run'] === 'function';
};

export interface MenuHostOptions {
  readonly root: HTMLElement;
  readonly fns: MenuFns;
  readonly label: (key: string) => string;
  readonly onError: (error: BoardError) => void;
  readonly requestFrame: () => void;
  readonly mac: boolean;
}

export class MenuHost {
  readonly #machine = new StateMachine(MENU_MACHINE, 'closed');
  readonly #opts: MenuHostOptions;
  readonly #root: HTMLElement;
  #element: HTMLElement | undefined;
  readonly #onPress = (e: Event): void => {
    const el = this.#element;
    if (el !== undefined && !el.contains(e.target as Node) && !this.#anchors.some((a) => a.contains(e.target as Node))) this.close();
  };
  /** The buttons that open menus: a press on one is theirs to handle, so it does not close the menu first. */
  readonly #anchors: HTMLElement[] = [];

  constructor(options: MenuHostOptions) {
    this.#opts = options;
    this.#root = options.root;
    this.#root.addEventListener('pointerdown', this.#onPress, true);
  }

  /** `closed`, `main`, `page` or `context`. */
  get state(): MenuState {
    return this.#machine.state;
  }

  /** A button that opens a menu: pressing it while its menu is open closes it, and the press is not a press "elsewhere". */
  addAnchor(el: HTMLElement): void {
    this.#anchors.push(el);
  }

  /** Opens a menu of `kind` with the default `items`, below `anchor` (a button) or at a point in the board's own pixels. */
  open(kind: 'main' | 'page' | 'context', items: readonly MenuItem[], target: MenuTarget, anchor: HTMLElement | { readonly x: number; readonly y: number }): void {
    const event = kind === 'main' ? 'openMain' : kind === 'page' ? 'openPage' : 'openContext';
    // the button of the open menu closes it; a context menu opened again moves
    if (this.#machine.is(kind) && kind !== 'context') {
      this.close();
      return;
    }
    if (this.#machine.is('context') && kind === 'context') this.close();
    this.#remove();
    if (!this.#machine.send(event)) return;
    const shown = this.#build(kind, items, target);
    const el = this.#root.ownerDocument.createElement('div');
    el.className = 'ib-menu';
    el.setAttribute('role', 'menu');
    el.dataset['menu'] = kind;
    for (const item of shown) el.append(this.#row(item, target));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
    const box = this.#root.getBoundingClientRect();
    if ('x' in anchor) {
      el.style.left = `${Math.max(0, anchor.x)}px`;
      el.style.top = `${Math.max(0, anchor.y)}px`;
    } else {
      const at = anchor.getBoundingClientRect();
      el.style.left = `${Math.max(0, at.left - box.left)}px`;
      el.style.top = `${Math.max(0, at.bottom - box.top + 4)}px`;
    }
    this.#root.append(el);
    this.#element = el;
    el.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  /** The items to show: the host's function over the defaults; the defaults when it throws or answers badly. */
  #build(kind: 'main' | 'page' | 'context', items: readonly MenuItem[], target: MenuTarget): readonly MenuItem[] {
    const fn = this.#opts.fns[kind];
    if (fn === undefined) return items;
    try {
      const out = fn(items, target);
      if (Array.isArray(out) && out.every(isItem)) return out;
      this.#opts.onError(boardError('bad_argument', `The ${kind} menu function must return a list of menu items.`, { hint: 'Each item has an id, a label and a run function. The default menu is shown.', detail: { menu: kind } }));
    } catch (e) {
      this.#opts.onError(boardError('internal', `The ${kind} menu function threw: ${e instanceof Error ? e.message : String(e)}.`, { detail: { menu: kind } }));
    }
    return items;
  }

  #row(item: MenuItem, target: MenuTarget): HTMLElement {
    const doc = this.#root.ownerDocument;
    let enabled: boolean;
    try {
      enabled = item.enabled === undefined ? true : item.enabled(target) !== false;
    } catch {
      enabled = false;
    }
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.dataset['item'] = item.id;
    b.disabled = !enabled;
    const svg = item.icon === undefined ? undefined : item.icon.startsWith('<svg') ? item.icon : defaultIcon(item.icon);
    const icon = doc.createElement('span');
    icon.className = 'ib-menu-icon';
    if (svg !== undefined) icon.innerHTML = svg;
    b.append(icon);
    const label = doc.createElement('span');
    label.className = 'ib-menu-label';
    label.textContent = item.label;
    b.append(label);
    if (item.key !== undefined) {
      const key = doc.createElement('kbd');
      key.textContent = describeKey(item.key, this.#opts.mac);
      b.append(key);
    }
    b.addEventListener('click', () => {
      this.close();
      try {
        item.run(target);
      } catch (e) {
        this.#opts.onError(boardError('internal', `The menu item "${item.id}" threw: ${e instanceof Error ? e.message : String(e)}.`, { detail: { item: item.id } }));
      }
      this.#opts.requestFrame();
    });
    return b;
  }

  #remove(): void {
    this.#element?.remove();
    this.#element = undefined;
  }

  /** Closes the open menu (an item, Esc, a press elsewhere). */
  close(): void {
    if (!this.#machine.send('close')) return;
    this.#remove();
  }

  dispose(): void {
    this.#root.removeEventListener('pointerdown', this.#onPress, true);
    this.#remove();
  }
}
