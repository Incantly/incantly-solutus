import { inThreadAdapter, sandboxAdapter } from '@incantly/core';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { FigureNode, MemoryFigureStore, countFigures, createFixtureDocument, figureScheduler } from '@incantly/tiptap';
import { Editor, type JSONContent } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';

/** One store for the page, so a reopened note finds the snapshots it saved. */
const store = new MemoryFigureStore();

/** The fixture's sections cycle through these concepts, in this order. */
const SCENE_ORDER = ['sine-wave', 'projectile', 'thin-lens'];

/** The reference scenes as stored figures, matching the fixture's section headings. */
function figureAttributes(index: number) {
  const scene = REFERENCE_SCENES[SCENE_ORDER[index % SCENE_ORDER.length]!]!;
  const defaults = Object.fromEntries(scene.plan.parameters.map((p) => [p.name, p.default]));
  return {
    concept: scene.plan.concept,
    fragments: { html: scene.html, css: scene.css, js: scene.js },
    defaults,
    description: scene.plan.idea,
  };
}

/**
 * A TipTap host with a fixture document of `size` stored figures. With
 * `live=1` the figures run through the sandbox adapter (or `adapter=in-thread`),
 * scheduled and persisted by the TipTap integration.
 */
export function mountEditorPage(root: HTMLElement, params: URLSearchParams): void {
  const size = Math.max(0, Math.min(1000, Number(params.get('size') ?? '10') || 0));
  const live = params.get('live') === '1';
  const adapter = params.get('adapter') === 'in-thread' ? inThreadAdapter : sandboxAdapter;
  const element = document.createElement('div');
  element.className = 'editor-host';
  root.append(element);

  const transactions: Record<string, number> = {};
  let editor: Editor;

  const create = (content: JSONContent) => {
    const start = performance.now();
    editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Image,
        FigureNode.configure(
          live
            ? {
                adapter,
                store,
                scheduler: {
                  limit: Number(params.get('limit') ?? 3),
                  suspendAfterMs: Number(params.get('suspendAfter') ?? 8000),
                },
              }
            : {},
        ),
      ],
      content,
      editorProps: { attributes: { class: 'editor', 'aria-label': 'Note editor' } },
    });
    editor.on('transaction', ({ transaction }) => {
      const cause = transaction.getMeta('incantlyFigure') ?? (transaction.docChanged ? 'edit' : 'selection');
      transactions[cause] = (transactions[cause] ?? 0) + 1;
    });
    handle.editor = editor;
    handle.editorReadyMs = performance.now() - start;
  };

  const handle = {
    ready: true,
    page: 'editor',
    editor: undefined as Editor | undefined,
    editorReadyMs: 0,
    transactions,
    figureCount: () => countFigures(editor.getJSON()),
    scheduler: () => (editor ? figureScheduler(editor)?.stats : undefined),
    /** Closes the note and opens it again from what was saved. */
    reopen: () => {
      const saved = editor.getJSON();
      editor.destroy();
      element.replaceChildren();
      create(saved);
    },
    /** Destroys the editor and builds a fresh one with the same fixture. */
    recreate: () => {
      editor.destroy();
      element.replaceChildren();
      create(createFixtureDocument({ figures: size, ...(live ? { figure: figureAttributes } : {}) }));
    },
  };
  window.__playground = handle as unknown as typeof window.__playground;
  create(createFixtureDocument({ figures: size, ...(live ? { figure: figureAttributes } : {}) }));

  // Open the note at a position, as a link into the middle of a note would.
  const at = Number(params.get('at'));
  if (at > 0 && at <= 1) {
    const figures = element.querySelectorAll('figure.incantly-figure');
    figures[Math.min(figures.length - 1, Math.floor(at * figures.length))]?.scrollIntoView({ block: 'start' });
  }
}
