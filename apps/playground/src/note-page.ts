import { sandboxAdapter } from '@incantly/core';
import { GenerationClient, Telemetry, figureChanger, figureGenerator, figureRepairer, type TelemetryEvent } from '@incantly/generation/client';
import { FigureGeneration, FigureNode, MemoryFigureStore, figureViews, flushFigures, newFigureId, type FigureNodeView } from '@incantly/tiptap';
import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';

/**
 * A note where the learner asks for figures: the generation service mounted
 * in the dev server, the device probe in the sandbox, the skeleton, the one
 * repair, the fallbacks and background repairs of live figures, as a host
 * would wire them. `fault=<fault>` points
 * at a service whose reference model injects that fault.
 */
export function mountNotePage(root: HTMLElement, params: URLSearchParams): void {
  const fault = params.get('fault');
  const baseUrl = fault && /^[a-z-]+$/.test(fault) ? `/api/fault/${fault}/v1` : '/api/v1';

  // Product signals stay on the page, where the tests read them.
  const signals: TelemetryEvent[] = [];
  const telemetry = new Telemetry({ sink: (events) => void signals.push(...events), batchSize: 1 });

  let token: string | null = null;
  const client = new GenerationClient({
    baseUrl,
    token: async () => (token ??= ((await (await fetch('/api/dev/token')).json()) as { token: string }).token),
  });

  const form = document.createElement('form');
  form.className = 'generate-form';
  const label = document.createElement('label');
  label.htmlFor = 'figure-request';
  label.textContent = 'Ask for a figure';
  const input = document.createElement('input');
  input.id = 'figure-request';
  input.name = 'prompt';
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = 'Explain projectile motion';
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Make a figure';
  form.append(label, input, button);

  // A change to the selected figure, in the learner's words (HO-8).
  const changeForm = document.createElement('form');
  changeForm.className = 'generate-form';
  const changeLabel = document.createElement('label');
  changeLabel.htmlFor = 'figure-change';
  changeLabel.textContent = 'Change the selected figure';
  const changeInput = document.createElement('input');
  changeInput.id = 'figure-change';
  changeInput.name = 'change';
  changeInput.type = 'text';
  changeInput.autocomplete = 'off';
  changeInput.placeholder = 'Start with weaker gravity';
  const changeButton = document.createElement('button');
  changeButton.type = 'submit';
  changeButton.textContent = 'Change it';
  const remake = document.createElement('button');
  remake.type = 'button';
  remake.textContent = 'Make it again';
  changeForm.append(changeLabel, changeInput, changeButton, remake);

  // The community gallery (GL-1): publish the selected figure with the request that made it, and add accepted ones to the note.
  const publishForm = document.createElement('form');
  publishForm.className = 'generate-form';
  const publishLabel = document.createElement('label');
  publishLabel.htmlFor = 'figure-publish';
  publishLabel.textContent = 'Publish the selected figure, with what you asked for';
  const publishInput = document.createElement('input');
  publishInput.id = 'figure-publish';
  publishInput.name = 'publish';
  publishInput.type = 'text';
  publishInput.autocomplete = 'off';
  const publishButton = document.createElement('button');
  publishButton.type = 'submit';
  publishButton.textContent = 'Publish';
  const publishStatus = document.createElement('p');
  publishStatus.className = 'gallery-status';
  publishStatus.setAttribute('role', 'status');
  publishForm.append(publishLabel, publishInput, publishButton, publishStatus);

  const gallery = document.createElement('section');
  gallery.className = 'gallery-list';
  gallery.setAttribute('aria-label', 'Gallery');
  const galleryHeading = document.createElement('h2');
  galleryHeading.textContent = 'Gallery';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Show the gallery';
  const cards = document.createElement('ul');
  gallery.append(galleryHeading, refresh, cards);

  const host = document.createElement('div');
  host.className = 'editor-host';
  root.append(form, changeForm, publishForm, gallery, host);

  const store = new MemoryFigureStore();
  let editor: Editor;
  const create = (content: JSONContent | string) => {
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit,
        FigureNode.configure({
          adapter: sandboxAdapter,
          store,
          signals: telemetry.emit,
          // A figure that hits a problem while live is repaired in the background, and swapped in once it passes here.
          repair: figureRepairer({ client, signals: telemetry.emit }),
          onError: (report) =>
            telemetry.emit({
              type: 'figure-failure',
              figureId: report.figureId,
              ...(report.generationId ? { generationId: report.generationId } : {}),
              kind: report.error.phase,
              fatal: report.fatal,
              values: report.values,
            }),
        }),
        FigureGeneration.configure({
          generate: figureGenerator({ client, signals: telemetry.emit }),
          change: figureChanger({ client, signals: telemetry.emit }),
        }),
      ],
      content,
      editorProps: { attributes: { class: 'editor', 'aria-label': 'Note editor' } },
    });
    handle.editor = editor;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!prompt) return;
    editor.commands.generateFigure({ prompt }, editor.state.doc.content.size);
    // What the learner asked for is what they would publish the figure with.
    publishInput.value = prompt;
    input.value = '';
  });

  const selectedView = (): FigureNodeView | undefined => {
    const { selection } = editor.state;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'incantlyFigure') return undefined;
    const dom = editor.view.nodeDOM(selection.from);
    return dom instanceof Element ? figureViews.get(dom) : undefined;
  };

  publishForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = publishInput.value.trim();
    void (async () => {
      const publication = await selectedView()?.publication();
      if (!publication) {
        publishStatus.textContent = 'Select a figure made here to publish it.';
        return;
      }
      try {
        const receipt = await client.publish({ ...publication, prompt });
        publishStatus.textContent = receipt.status === 'pending' ? 'Published: it shows in the gallery once a reviewer accepts it.' : `Already in the gallery (${receipt.status}).`;
        publishStatus.dataset.id = receipt.id;
      } catch (error) {
        publishStatus.textContent = error instanceof Error ? error.message : 'It could not be published.';
      }
    })();
  });

  const showGallery = async () => {
    cards.replaceChildren();
    for (const card of await client.gallery()) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = card.title;
      const asked = document.createElement('span');
      asked.textContent = ` "${card.prompt}"`;
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = `Add ${card.title} to the note`;
      add.addEventListener('click', () => {
        void (async () => {
          const figure = await client.galleryFigure(card.id);
          editor
            .chain()
            .focus('end')
            .insertFigure({
              figureId: newFigureId(),
              fragments: figure.fragments,
              concept: figure.title,
              description: figure.idea,
              meta: figure.ticket ? { ticket: figure.ticket } : {},
            })
            .run();
        })();
      });
      item.append(title, asked, ' ', add);
      cards.append(item);
    }
    if (cards.childElementCount === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'No figures have been accepted yet.';
      cards.append(empty);
    }
  };
  refresh.addEventListener('click', () => void showGallery());

  changeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = changeInput.value.trim();
    if (prompt && editor.commands.changeFigure({ prompt })) changeInput.value = '';
  });
  remake.addEventListener('click', () => editor.commands.regenerateFigure());

  const handle = {
    ready: true,
    page: 'note',
    editor: undefined as Editor | undefined,
    signals,
    /** Closes the note and opens it again from what was saved. */
    reopen: () => {
      // Save what the learner changed but has not been saved yet, then read the note.
      flushFigures(editor);
      const saved = editor.getJSON();
      editor.destroy();
      host.replaceChildren();
      create(saved);
    },
    records: async () => (await fetch('/api/dev/records')).json() as Promise<unknown[]>,
    /** What a reviewer does with the gallery command, here in the dev server. */
    review: async (id: string, status: 'accepted' | 'rejected') => fetch(`/api/dev/gallery/review?id=${encodeURIComponent(id)}&status=${status}`),
    clearGallery: async () => fetch('/api/dev/gallery/clear'),
    setGeneration: async (on: boolean) => fetch(`/api/dev/switch?on=${on ? 1 : 0}`),
  };
  window.__playground = handle as unknown as typeof window.__playground;
  create('<h1>Notes</h1><p>Ask for a figure above, and it appears at the end of the note.</p>');
}
