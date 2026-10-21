import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { FigureNode, countFigures, createFixtureDocument } from '@incantly/tiptap';

/** A TipTap host with a fixture document of `size` stored figures. */
export function mountEditorPage(root: HTMLElement, params: URLSearchParams): void {
  const size = Math.max(0, Math.min(1000, Number(params.get('size') ?? '10') || 0));
  const element = document.createElement('div');
  element.className = 'editor-host';
  root.append(element);

  const editor = new Editor({
    element,
    extensions: [StarterKit, Image, FigureNode],
    content: createFixtureDocument({ figures: size }),
    editorProps: { attributes: { class: 'editor', 'aria-label': 'Note editor' } },
  });

  window.__playground = {
    ready: true,
    page: 'editor',
    editor,
    editorReadyMs: performance.now(),
    figureCount: () => countFigures(editor.getJSON()),
  };
}
