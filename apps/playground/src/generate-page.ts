import { sandboxAdapter } from '@incantly/core';
import { GenerationClient, Telemetry, figureChanger, figureGenerator, figureRepairer, type TelemetryEvent } from '@incantly/generation/client';
import { FigureGeneration, FigureNode, MemoryFigureStore, flushFigures } from '@incantly/tiptap';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

/**
 * A note where the learner asks for figures: the generation service mounted
 * in the dev server, the device probe in the sandbox, the skeleton, the one
 * repair, the fallbacks and background repairs of live figures, as a host
 * would wire them. `fault=<fault>` points
 * at a service whose reference model injects that fault.
 */
export function mountGeneratePage(root: HTMLElement, params: URLSearchParams): void {
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

  const host = document.createElement('div');
  host.className = 'editor-host';
  root.append(form, changeForm, host);

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
    input.value = '';
  });

  changeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = changeInput.value.trim();
    if (prompt && editor.commands.changeFigure({ prompt })) changeInput.value = '';
  });
  remake.addEventListener('click', () => editor.commands.regenerateFigure());

  const handle = {
    ready: true,
    page: 'generate',
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
    setGeneration: async (on: boolean) => fetch(`/api/dev/switch?on=${on ? 1 : 0}`),
  };
  window.__playground = handle as unknown as typeof window.__playground;
  create('<h1>Notes</h1><p>Ask for a figure above, and it appears at the end of the note.</p>');
}
