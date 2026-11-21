/**
 * The slash menu (ui.md Writing): a small ProseMirror plugin. In a paragraph that holds only `/` and a query, a menu
 * offers the four ways to start a figure. No extra package: the menu is a few lines of DOM.
 */
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { AppModeId } from '@incantly/sdk';
import { newFigureId } from './attrs';
import { canWrite } from './figure-node';
import { runtimeOf } from './runtime';
import { ensureStyles } from './styles';
import type { IncantlyTiptapOptions } from './types';

export interface SlashItem {
  readonly id: string;
  readonly label: string;
  readonly keywords: string;
  readonly mode?: AppModeId;
  /** Opens the AI box on the new figure. */
  readonly ask?: boolean;
}

export const SLASH_ITEMS: readonly SlashItem[] = [
  { id: 'figure', label: 'Incantly figure', keywords: 'figure incantly' },
  { id: 'graph', label: 'Incantly graph', keywords: 'graph graphing incantly', mode: 'graphing' },
  { id: '3d', label: 'Incantly 3D', keywords: '3d space incantly', mode: 'graphing3d' },
  { id: 'ask', label: 'Ask AI for a figure', keywords: 'ask ai figure', ask: true },
];

export const slashKey = new PluginKey('incantlySlash');

interface Match {
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly text: string;
}

/** The slash text under the cursor: the whole paragraph is `/` and a query, and the cursor is at its end. */
export function slashMatch(view: EditorView): Match | null {
  const sel = view.state.selection;
  if (!sel.empty) return null;
  const $from = sel.$from;
  const parent = $from.parent;
  if (parent.type.name !== 'paragraph') return null;
  const text = parent.textContent;
  if (!/^\/[\w ]*$/.test(text) || $from.parentOffset !== text.length) return null;
  return { from: $from.start(), to: $from.pos, query: text.slice(1), text };
}

export const filterItems = (query: string): SlashItem[] => {
  const q = query.trim().toLowerCase();
  return SLASH_ITEMS.filter((i) => q === '' || i.label.toLowerCase().includes(q) || i.keywords.includes(q));
};

export function slashPlugin(editor: Editor, options: IncantlyTiptapOptions): Plugin {
  let menu: HTMLElement | undefined;
  let items: SlashItem[] = [];
  let index = 0;
  let dismissed = '';

  const hide = (): void => {
    if (menu) menu.hidden = true;
    items = [];
  };

  const choose = (view: EditorView, item: SlashItem, m: Match): void => {
    const id = newFigureId();
    if (item.ask) runtimeOf(editor, options).askOnNext = id;
    editor
      .chain()
      .focus()
      .deleteRange({ from: m.from, to: m.to })
      .insertIncantlyFigure({ id, ...(item.mode !== undefined ? { mode: item.mode } : {}) })
      .run();
    hide();
    view.focus();
  };

  const draw = (view: EditorView, m: Match): void => {
    const doc = view.dom.ownerDocument;
    if (!menu) {
      ensureStyles(doc);
      menu = doc.createElement('div');
      menu.className = 'inc-tt-slash';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', 'Insert a figure');
      doc.body.append(menu);
    }
    index = Math.min(index, Math.max(0, items.length - 1));
    menu.replaceChildren(
      ...items.map((item, i) => {
        const el = doc.createElement('div');
        el.className = 'inc-tt-slash-item';
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', String(i === index));
        el.textContent = item.label;
        // the mouse must not take focus from the editor
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const now = slashMatch(view);
          if (now) choose(view, item, now);
        });
        return el;
      }),
    );
    let c: { left: number; bottom: number } = { left: 0, bottom: 0 };
    try {
      c = view.coordsAtPos(m.to);
    } catch {
      // not laid out: the menu sits at the corner
    }
    menu.style.left = `${Math.round(c.left)}px`;
    menu.style.top = `${Math.round(c.bottom + 4)}px`;
    menu.hidden = false;
  };

  const refresh = (view: EditorView): void => {
    if (!canWrite(editor, options) || !view.hasFocus()) return hide();
    const m = slashMatch(view);
    if (!m || m.text === dismissed) return hide();
    const next = filterItems(m.query);
    if (next.length === 0) return hide();
    if (next.map((i) => i.id).join() !== items.map((i) => i.id).join()) index = 0;
    items = next;
    draw(view, m);
  };

  return new Plugin({
    key: slashKey,
    view: () => ({
      update: (v) => refresh(v),
      destroy: () => {
        menu?.remove();
        menu = undefined;
      },
    }),
    props: {
      handleKeyDown: (view, event) => {
        if (!menu || menu.hidden || items.length === 0) return false;
        const m = slashMatch(view);
        if (!m) return false;
        if (event.key === 'ArrowDown') index = (index + 1) % items.length;
        else if (event.key === 'ArrowUp') index = (index - 1 + items.length) % items.length;
        else if (event.key === 'Enter') {
          const item = items[index];
          if (item) choose(view, item, m);
          return true;
        } else if (event.key === 'Escape') {
          dismissed = m.text;
          hide();
          return true;
        } else return false;
        draw(view, m);
        return true;
      },
    },
  });
}
