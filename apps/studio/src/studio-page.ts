/** The language screen: a line list, the line editor, and a placeholder where the figure will go. */
import { defineLanguageElements } from '@incantly/ui';
import type { LineEditorElement, LineListElement, RowEditDetail, RowInsertDetail } from '@incantly/ui';
import type { PreviewResult } from '@incantly/kernel';
import { tyStr } from '@incantly/kernel';
import { ScratchSession } from './session';

export const EXAMPLE_LINES: readonly string[] = [
  'A = (1, 2)',
  'B = (4, 6)',
  'a = 3.5',
  'M = Midpoint(A, B)',
  'f(x) = 2x^2 - 3x + 1',
  'g = 1/0',
  'k = g + 1',
];

const KEYS: readonly (readonly [string, string])[] = [
  ['Enter', 'Submit the line; accept the selected completion'],
  ['Shift+Enter', 'New line (several lines are applied in order)'],
  ['Ctrl+Space', 'Open completion'],
  ['Ctrl+Shift+Space', 'Show the forms of the command at the caret'],
  ['Up / Down', 'Earlier lines when the field is empty; completion list when open'],
  ['Tab / Shift+Tab', 'Next / previous placeholder'],
  ['Ctrl+/', 'Comment or uncomment the line'],
  ['Esc', 'Close completion, then the strip; then ask before clearing the line'],
  ['/', 'Focus the input from anywhere on the page'],
  ['Up / Down / Home / End in the list', 'Move between lines; Enter edits one'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

export interface Mounted {
  readonly session: ScratchSession;
  readonly editor: LineEditorElement;
  readonly list: LineListElement;
  readonly ghostNote: HTMLElement;
  loadExample(): void;
}

export function mountStudio(root: HTMLElement): Mounted {
  defineLanguageElements();
  const session = new ScratchSession();

  const list = el('incantly-line-list') as LineListElement;
  const editor = el('incantly-line-editor', { placeholder: 'Type a line, e.g. A = (1, 2)', label: 'Input line' }) as LineEditorElement;
  const example = el('button', { type: 'button', class: 'secondary' }, 'Load example');
  const ghostNote = el('p', { class: 'ghost' });

  const keys = el('table', { class: 'keys' }, el('caption', {}, 'Keyboard'));
  for (const [key, what] of KEYS) keys.append(el('tr', {}, el('th', { scope: 'row' }, key), el('td', {}, what)));

  root.replaceChildren(
    el('header', { class: 'top' }, el('h1', {}, 'Incantly Studio'), el('p', {}, 'Language preview. There is no kernel or drawing yet.')),
    el(
      'div',
      { class: 'layout' },
      el(
        'section',
        { class: 'panel', 'aria-labelledby': 'lines-title' },
        el('div', { class: 'panel-head' }, el('h2', { id: 'lines-title' }, 'Lines'), example),
        el('div', { class: 'scroll' }, list),
        el('div', { class: 'input-bar' }, editor),
      ),
      el(
        'section',
        { class: 'figure', 'aria-labelledby': 'figure-title' },
        el('h2', { id: 'figure-title' }, 'Figure'),
        el(
          'div',
          { class: 'placeholder', role: 'note' },
          el('p', {}, el('strong', {}, 'No figure yet.')),
          el(
            'p',
            {},
            'Lines are read, checked and evaluated by the input language only. Numbers, points, lists and functions get values. ' +
              'A line that uses a command is accepted and typed, but its value stays undefined until a kernel runs it.',
          ),
          ghostNote,
        ),
      ),
    ),
    el('details', { class: 'help' }, el('summary', {}, 'Keyboard'), keys),
  );

  editor.figure = session.figure;
  editor.onSubmitLine = (line) => session.submit(line);
  const sync = (): void => {
    list.rows = session.rows();
    editor.refresh();
  };
  session.onChange(sync);
  sync();

  editor.addEventListener('incantly-preview', (e) => {
    const result = (e as CustomEvent<{ result: PreviewResult | null }>).detail.result;
    ghostNote.textContent =
      result && result.ok && result.type ? `Preview: this would draw ${result.name} as a ${tyStr(result.type)} here once the kernel and drawing exist.` : '';
  });
  list.addEventListener('incantly-row-edit', (e) => {
    const d = (e as CustomEvent<RowEditDetail>).detail;
    editor.insertText(d.source, { replace: true });
    editor.focus();
  });
  list.addEventListener('incantly-row-insert', (e) => {
    const d = (e as CustomEvent<RowInsertDetail>).detail;
    editor.insertText(d.text, { replace: d.replace });
  });

  const loadExample = (): void => {
    let applied = 0;
    for (const line of EXAMPLE_LINES) if (session.submit(line).ok) applied += 1;
    editor.announce(`Example loaded: ${applied} lines`);
  };
  example.addEventListener('click', loadExample);

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const origin = e.composedPath()[0];
    if (origin instanceof HTMLInputElement || origin instanceof HTMLTextAreaElement || (origin instanceof HTMLElement && origin.isContentEditable)) return;
    e.preventDefault();
    editor.focus();
  });

  return { session, editor, list, ghostNote, loadExample };
}
