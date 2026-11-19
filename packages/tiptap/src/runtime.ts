/** What one editor owns: its scheduler and its figure store, made on first use and freed with the editor. */
import type { Editor } from '@tiptap/core';
import { EditorScheduler } from './scheduler';
import { FigureStore } from './store';
import type { IncantlyTiptapOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

export class EditorRuntime {
  readonly store = new FigureStore();
  readonly scheduler: EditorScheduler;

  constructor(
    readonly editor: Editor,
    readonly options: IncantlyTiptapOptions,
  ) {
    let doc: Document = document;
    try {
      doc = editor.view.dom.ownerDocument;
    } catch {
      // the editor has no view yet: the page's own document
    }
    this.scheduler = new EditorScheduler(options.liveLimit ?? DEFAULT_OPTIONS.liveLimit, doc);
  }

  dispose(): void {
    this.scheduler.dispose();
    this.store.dispose();
  }
}

const runtimes = new WeakMap<Editor, EditorRuntime>();

/** The editor's runtime, made on first use. */
export function runtimeOf(editor: Editor, options: IncantlyTiptapOptions): EditorRuntime {
  let r = runtimes.get(editor);
  if (!r) {
    r = new EditorRuntime(editor, options);
    runtimes.set(editor, r);
  }
  return r;
}

/** The editor's runtime if it exists. */
export const peekRuntime = (editor: Editor): EditorRuntime | undefined => runtimes.get(editor);

export function disposeRuntime(editor: Editor): void {
  const r = runtimes.get(editor);
  if (!r) return;
  runtimes.delete(editor);
  r.dispose();
}
