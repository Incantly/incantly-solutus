/**
 * Shared set-up for the Tiptap spec tests: a minimal editor (doc, paragraph, text, history), a controllable
 * IntersectionObserver, and small waiting helpers. Uses only the package's public API.
 */
import { Editor, Extension, Node } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { history, undo, undoDepth } from '@tiptap/pm/history';
import { Incantly, figuresIn } from '../../src/index';
import type { IncantlyFigureAttrs, IncantlyStorage, IncantlyTiptapOptions, TiptapError } from '../../src/index';

export const Doc = Node.create({ name: 'doc', topNode: true, content: 'block+' });
export const Paragraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML: () => [{ tag: 'p' }],
  renderHTML: () => ['p', 0],
});
export const Text = Node.create({ name: 'text', group: 'inline' });
export const History = Extension.create({ name: 'history', addProseMirrorPlugins: () => [history()] });

export interface Opened {
  readonly editor: Editor;
  readonly errors: TiptapError[];
}

const open: Editor[] = [];

/** An editor with the extension. Every editor made here is destroyed by `destroyAll`. */
export function makeEditor(content: JSONContent | string = { type: 'doc', content: [{ type: 'paragraph' }] }, options: Partial<IncantlyTiptapOptions> = {}): Opened {
  const errors: TiptapError[] = [];
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [Doc, Paragraph, Text, History, Incantly.configure({ ...options, onError: (e) => { errors.push(e); options.onError?.(e); } })],
    content,
  });
  open.push(editor);
  return { editor, errors };
}

export function destroyAll(): void {
  for (const e of open.splice(0)) {
    const el = e.options.element as HTMLElement | undefined;
    try {
      e.destroy();
    } catch {
      // already gone
    }
    el?.remove();
  }
  document.body.replaceChildren();
}

export const para = (text: string): JSONContent => ({ type: 'paragraph', content: text === '' ? [] : [{ type: 'text', text }] });

export const figureJson = (attrs: Partial<Record<string, unknown>> = {}): JSONContent => ({
  type: 'incantlyFigure',
  attrs: { id: 'fig_one', script: '', mode: 'figure', width: 'full', height: 360, caption: '', picture: null, version: 1, ...attrs },
});

export const docOf = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

export const attrsOf = (editor: Editor): Record<string, unknown>[] => figuresIn(editor.state.doc).map((f) => ({ ...f.node.attrs }));
export const figureAttrs = (editor: Editor, id: string): IncantlyFigureAttrs | undefined =>
  figuresIn(editor.state.doc).find((f) => f.node.attrs['id'] === id)?.node.attrs as IncantlyFigureAttrs | undefined;
export const posOf = (editor: Editor, id: string): number => {
  const f = figuresIn(editor.state.doc).find((x) => x.node.attrs['id'] === id);
  if (!f) throw new Error(`no figure ${id}`);
  return f.pos;
};

export const undoSteps = (editor: Editor): number => undoDepth(editor.state);
export const undoOnce = (editor: Editor): boolean => undo(editor.state, editor.view.dispatch);

export const real = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Polls (real timers) until `fn` is truthy. */
export async function until<T>(fn: () => T | undefined | null | false, what: string, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await real(10);
  }
}

/** The `.inc-tt-box` elements of the editor, in document order. */
export const boxes = (editor: Editor): HTMLElement[] => Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.inc-tt-box'));
export const liveBoxes = (editor: Editor): HTMLElement[] => boxes(editor).filter((b) => b.dataset['state'] === 'live');
/** The figure's box, found by the id on its node view. */
export const boxOf = (editor: Editor, id: string): HTMLElement | undefined =>
  editor.view.dom.querySelector<HTMLElement>(`[data-id="${id}"] .inc-tt-box`) ?? undefined;

/** A controllable IntersectionObserver: everything starts in view; `Viewport.set` moves a figure. */
export class Viewport {
  private static hidden = new WeakSet<Element>();
  private static instances = new Set<Viewport>();
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: (entries: unknown[]) => void) {
    Viewport.instances.add(this);
  }

  private static entry(target: Element): unknown {
    const on = !Viewport.hidden.has(target);
    return { target, isIntersecting: on, intersectionRatio: on ? 1 : 0 };
  }

  observe(target: Element): void {
    this.targets.add(target);
    queueMicrotask(() => {
      if (this.targets.has(target)) this.callback([Viewport.entry(target)]);
    });
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
    Viewport.instances.delete(this);
  }
  takeRecords(): unknown[] {
    return [];
  }

  /** Puts the figure whose box is `box` in or out of view. */
  static set(box: Element, visible: boolean): void {
    for (const inst of Viewport.instances) {
      for (const t of inst.targets) {
        if (t === box || t.contains(box) || box.contains(t)) {
          if (visible) Viewport.hidden.delete(t);
          else Viewport.hidden.add(t);
          inst.callback([Viewport.entry(t)]);
        }
      }
    }
  }

  static reset(): void {
    Viewport.instances.clear();
    Viewport.hidden = new WeakSet();
  }
}

/** A real `paste` event carrying plain text only, as the browser sends it for copied text. */
export function pastePlain(editor: Editor, text: string): void {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  const data: Record<string, string> = { 'text/plain': text };
  Object.defineProperty(ev, 'clipboardData', { value: { types: ['text/plain'], files: [], items: [], getData: (t: string) => data[t] ?? '' } });
  editor.view.dom.dispatchEvent(ev);
}

/** What `editor.storage.incantly.lastError` holds. */
export const lastError = (editor: Editor): TiptapError | null => (editor.storage as unknown as { incantly: IncantlyStorage }).incantly.lastError;
