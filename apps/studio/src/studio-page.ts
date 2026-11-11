/** The studio screen: line list, input, undo and redo, rename and delete, script files, the clock, and a placeholder for the drawing. */
import { defineLanguageElements, errorNames } from '@incantly/ui';
import type {
  ErrorCardElement, FixDetail, GotoDetail, LineEditorElement, LineListElement, RowActionDetail, RowEditDetail, RowInsertDetail, RowSetDetail, RowSlideDetail,
} from '@incantly/ui';
import type { ErrorObject, PreviewResult } from '@incantly/kernel';
import { tyStr } from '@incantly/kernel';
import { KernelSession } from './session';
import type { Outcome } from './session';

export const EXAMPLE_LINES: readonly string[] = [
  'A = (1, 2)',
  'B = (4, 6)',
  'a = 3 in 0..8 step 1',
  'M = Midpoint(A, B)',
  'c = Circle(M, a)',
  'f(x) = 2x^2 - 3x + 1',
  'h = 2 + sin(t)',
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
  ['Ctrl/Cmd+Z', 'Undo (in the input field, only while it is empty)'],
  ['Shift+Ctrl/Cmd+Z', 'Redo'],
  ['Up / Down / Home / End in the list', 'Move between lines; Enter edits one'],
  ['F2 / Delete in the list', 'Rename / delete the line'],
  ['Shift+arrows on a slider', 'Move ten steps'],
];

function el(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

export interface StudioOptions {
  /** Frame scheduler for the clock; defaults to `requestAnimationFrame`. A test passes its own. */
  readonly raf?: (cb: (now: number) => void) => number;
  readonly caf?: (handle: number) => void;
}

export interface Mounted {
  readonly session: KernelSession;
  readonly editor: LineEditorElement;
  readonly list: LineListElement;
  readonly card: ErrorCardElement;
  readonly ghostNote: HTMLElement;
  readonly status: HTMLElement;
  loadExample(): void;
  undo(): void;
  redo(): void;
  /** Removes the page-wide key handler. */
  dispose(): void;
}

type Pending = { readonly kind: 'rename'; readonly name: string } | { readonly kind: 'delete'; readonly name: string; readonly plan: readonly string[] };

export function mountStudio(root: HTMLElement, opts: StudioOptions = {}): Mounted {
  defineLanguageElements();
  const session = new KernelSession();
  const raf = opts.raf ?? ((cb: (now: number) => void): number => window.requestAnimationFrame(cb));
  const caf = opts.caf ?? ((h: number): void => window.cancelAnimationFrame(h));

  const list = el('incantly-line-list') as LineListElement;
  const editor = el('incantly-line-editor', { placeholder: 'Type a line, e.g. A = (1, 2)', label: 'Input line' }) as LineEditorElement;
  const card = el('incantly-error-card') as ErrorCardElement;
  const status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const ghostNote = el('p', { class: 'ghost' });
  const count = el('p', { class: 'count' });

  const button = (label: string, cls = 'secondary', attrs: Record<string, string> = {}): HTMLButtonElement =>
    el('button', { type: 'button', class: cls, ...attrs }, label) as HTMLButtonElement;
  const undoBtn = button('Undo');
  const redoBtn = button('Redo');
  const example = button('Load example');
  const toolbar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Figure actions' }, undoBtn, redoBtn, example);
  const bar = el('div', { class: 'actionbar', role: 'group' });
  bar.hidden = true;

  // clock
  const playBtn = button('Play');
  const resetBtn = button('Back to start');
  const scrub = el('input', { type: 'range', class: 'scrub', 'aria-label': 'Time', step: 'any' }) as HTMLInputElement;
  const readout = el('output', { class: 'readout', 'aria-label': 'Time in seconds' });
  const clock = el('div', { class: 'clock', role: 'group', 'aria-label': 'Clock' }, playBtn, resetBtn, scrub, readout);
  clock.hidden = true;

  // script
  const script = el('textarea', { class: 'script-text', rows: '6', spellcheck: 'false', 'aria-label': 'Figure script' }) as HTMLTextAreaElement;
  const saveBtn = button('Save script');
  const loadBtn = button('Load script');
  const file = el('input', { type: 'file', accept: '.inc,.txt,text/plain', 'aria-label': 'Choose a script file to load' }) as HTMLInputElement;
  const report = el('div', { class: 'report', role: 'status', 'aria-live': 'polite' });
  const scriptPanel = el(
    'details',
    { class: 'script' },
    el('summary', {}, 'Script (save and load)'),
    el('p', { class: 'note' }, 'The figure as lines of text. Loading replaces the current figure and clears the undo history.'),
    script,
    el('div', { class: 'toolbar' }, saveBtn, loadBtn, file),
    report,
  );

  const keys = el('table', { class: 'keys' }, el('caption', {}, 'Keyboard'));
  for (const [key, what] of KEYS) keys.append(el('tr', {}, el('th', { scope: 'row' }, key), el('td', {}, what)));

  root.replaceChildren(
    el('header', { class: 'top' }, el('h1', {}, 'Incantly Studio'), el('p', {}, 'Kernel preview. The figure is live; there is no drawing yet.')),
    el(
      'div',
      { class: 'layout' },
      el(
        'section',
        { class: 'panel', 'aria-labelledby': 'lines-title' },
        el('div', { class: 'panel-head' }, el('h2', { id: 'lines-title' }, 'Lines'), toolbar),
        bar,
        card,
        status,
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
          el('p', {}, el('strong', {}, 'No drawing yet.')),
          el('p', {}, 'The figure is a live kernel figure. Every line is checked and run, and the list shows each value, its type and whether it is free or computed. The drawing arrives with the renderer.'),
          count,
          ghostNote,
        ),
        clock,
        scriptPanel,
      ),
    ),
    el('details', { class: 'help' }, el('summary', {}, 'Keyboard'), keys),
  );

  /* ------------------------------ state shown ------------------------------ */

  let pending: Pending | undefined;
  let playing = false;
  let frame: number | undefined;
  let last: number | undefined;

  const say = (text: string): void => {
    status.textContent = text;
  };
  const showError = (e: ErrorObject | null): void => {
    card.error = e;
    list.highlighted = e ? errorNames(e) : [];
  };
  const outcome = (o: Outcome): boolean => {
    if (o.ok) {
      showError(null);
      say([o.message, ...o.notices].join('. '));
    } else showError(o.error);
    return o.ok;
  };

  const syncUndo = (): void => {
    const u = session.undoState();
    undoBtn.disabled = !u.canUndo;
    redoBtn.disabled = !u.canRedo;
    const undoName = u.label ? `Undo: ${u.label}` : 'Undo';
    undoBtn.setAttribute('aria-label', undoName);
    undoBtn.title = `${undoName} (Ctrl+Z)`;
    const redoName = u.canRedo ? `Redo (${u.redoDepth} step${u.redoDepth === 1 ? '' : 's'})` : 'Redo';
    redoBtn.setAttribute('aria-label', redoName);
    redoBtn.title = `${redoName} (Shift+Ctrl+Z)`;
  };

  const syncClock = (): void => {
    const has = session.hasClock();
    clock.hidden = !has;
    if (!has && playing) pause();
    if (!has) return;
    const { from, to } = session.range();
    const t = session.time();
    readout.textContent = `t = ${Math.round(t * 1000) / 1000} s`;
    const finite = Number.isFinite(to);
    scrub.hidden = !finite;
    if (finite) {
      scrub.min = String(from);
      scrub.max = String(to);
      scrub.value = String(t);
    }
  };

  const sync = (): void => {
    list.rows = session.rows();
    if (!playing) editor.refresh();
    count.textContent = `${list.rows.length} object${list.rows.length === 1 ? '' : 's'} in the figure.`;
    syncUndo();
    syncClock();
    const warnings = session.figure.takeWarnings();
    if (warnings.length > 0) say(warnings.map((w) => w.message).join('. '));
  };

  /* ------------------------------ clock ------------------------------ */

  function pause(): void {
    playing = false;
    last = undefined;
    if (frame !== undefined) caf(frame);
    frame = undefined;
    playBtn.textContent = 'Play';
    playBtn.setAttribute('aria-pressed', 'false');
  }
  const tick = (now: number): void => {
    if (!playing) return;
    const dt = last === undefined ? 0 : Math.max(0, (now - last) / 1000);
    last = now;
    const { to } = session.range();
    const t = session.time() + dt;
    outcome(session.setTime(t));
    if (t >= to) pause();
    else frame = raf(tick);
  };
  const play = (): void => {
    const { from, to } = session.range();
    if (session.time() >= to) session.setTime(from);
    playing = true;
    last = undefined;
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-pressed', 'true');
    frame = raf(tick);
  };
  playBtn.setAttribute('aria-pressed', 'false');
  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  resetBtn.addEventListener('click', () => {
    pause();
    outcome(session.setTime(session.range().from));
  });
  scrub.addEventListener('input', () => {
    pause();
    session.setTime(Number(scrub.value));
  });

  /* ------------------------------ rename and delete ------------------------------ */

  const closeBar = (focusName?: string): void => {
    pending = undefined;
    bar.hidden = true;
    bar.replaceChildren();
    if (focusName !== undefined && list.focusRow(focusName)) return;
    editor.focus();
  };
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pending) return;
    e.preventDefault();
    const name = pending.name;
    showError(null);
    closeBar(name);
  });

  const openRename = (name: string): void => {
    pending = { kind: 'rename', name };
    const input = el('input', { type: 'text', class: 'rename', spellcheck: 'false', autocomplete: 'off', 'aria-label': `New name for ${name}` }) as HTMLInputElement;
    input.value = name;
    const ok = button('Rename');
    const no = button('Cancel');
    const run = (): void => {
      const to = input.value.trim();
      if (to === name) return closeBar(name);
      if (outcome(session.rename(name, to))) closeBar(to);
      else input.focus();
    };
    ok.addEventListener('click', run);
    no.addEventListener('click', () => closeBar(name));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      run();
    });
    bar.setAttribute('aria-label', `Rename ${name}`);
    bar.replaceChildren(el('label', {}, `Rename ${name} to `, input), ok, no);
    bar.hidden = false;
    input.focus();
    input.select();
  };

  const runDelete = (name: string): void => {
    const rows = list.rows;
    const at = rows.findIndex((r) => r.name === name);
    if (!outcome(session.delete(name))) return;
    const after = list.rows;
    closeBar(after[Math.min(at, after.length - 1)]?.name);
  };

  const openDelete = (name: string): void => {
    const plan = session.deletePlan(name);
    const also = plan.filter((n) => n !== name);
    if (also.length === 0) {
      // a leaf: no confirmation, and Undo brings it back
      runDelete(name);
      return;
    }
    pending = { kind: 'delete', name, plan };
    const ok = button(`Delete ${plan.length} objects`);
    const no = button('Cancel');
    ok.addEventListener('click', () => runDelete(name));
    no.addEventListener('click', () => closeBar(name));
    bar.setAttribute('aria-label', `Delete ${name}`);
    bar.replaceChildren(el('span', {}, `Deleting ${name} also removes ${also.join(', ')}. `), ok, no);
    bar.hidden = false;
    no.focus();
  };

  /* ------------------------------ wiring ------------------------------ */

  editor.figure = session.figure.view;
  editor.onSubmitLine = (line) => {
    const r = session.submit(line);
    if (r.ok) {
      showError(null);
      say('');
    } else list.highlighted = errorNames(r.error);
    return r;
  };
  // the figure object changes when a script is loaded
  session.onChange(() => {
    if (editor.figure !== session.figure.view) editor.figure = session.figure.view;
    sync();
  });
  sync();

  editor.addEventListener('incantly-preview', (e) => {
    const result = (e as CustomEvent<{ result: PreviewResult | null }>).detail.result;
    ghostNote.textContent =
      result && result.ok && result.type ? `Preview: this would draw ${result.name} as a ${tyStr(result.type)} here once drawing exists.` : '';
  });
  list.addEventListener('incantly-row-edit', (e) => {
    editor.insertText((e as CustomEvent<RowEditDetail>).detail.source, { replace: true });
    editor.focus();
  });
  list.addEventListener('incantly-row-insert', (e) => {
    const d = (e as CustomEvent<RowInsertDetail>).detail;
    editor.insertText(d.text, { replace: d.replace });
  });
  list.addEventListener('incantly-row-rename', (e) => openRename((e as CustomEvent<RowActionDetail>).detail.name));
  list.addEventListener('incantly-row-delete', (e) => openDelete((e as CustomEvent<RowActionDetail>).detail.name));
  list.addEventListener('incantly-row-set', (e) => {
    const d = (e as CustomEvent<RowSetDetail>).detail;
    outcome(session.setText(d.name, d.text));
  });
  list.addEventListener('incantly-row-slide', (e) => {
    const d = (e as CustomEvent<RowSlideDetail>).detail;
    const o = session.slide(d.name, d.value, d.done);
    if (d.done || !o.ok) outcome(o);
  });
  card.addEventListener('incantly-fix', (e) => {
    editor.insertText((e as CustomEvent<FixDetail>).detail.line, { replace: true });
    editor.focus();
  });
  card.addEventListener('incantly-goto', (e) => list.focusRow((e as CustomEvent<GotoDetail>).detail.name));

  const undo = (): void => void outcome(session.undo());
  const redo = (): void => void outcome(session.redo());
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  const loadExample = (): void => {
    outcome(session.applyLines(EXAMPLE_LINES, 'Load example'));
  };
  example.addEventListener('click', loadExample);

  /* ------------------------------ script ------------------------------ */

  const showReport = (applied: number, total: number, errors: readonly ErrorObject[], replaced: boolean): void => {
    const head = el('p', {}, replaced ? `Loaded ${applied} of ${total} lines.` : `Nothing was loaded; the current figure is unchanged.`);
    const kids: Node[] = [head];
    if (errors.length > 0) {
      const ul = el('ul', { class: 'problems', 'aria-label': 'Problems' });
      for (const e of errors) {
        const li = el('li', {}, `line ${e.line}: ${e.message}`);
        if (e.hint) li.append(el('span', { class: 'hint' }, ` ${e.hint}`));
        ul.append(li);
      }
      kids.push(ul);
    }
    report.replaceChildren(...kids);
  };
  saveBtn.addEventListener('click', () => {
    const text = session.save();
    script.value = text;
    report.replaceChildren(el('p', {}, `Saved ${text.split('\n').filter((l) => l.trim() !== '').length} lines to the box above.`));
    try {
      if (typeof URL.createObjectURL === 'function') {
        const a = el('a', { download: 'figure.inc' }) as HTMLAnchorElement;
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch {
      // the text is in the box either way
    }
  });
  const loadText = (text: string): void => {
    pause();
    const r = session.load(text);
    showReport(r.applied, r.total, r.errors, r.replaced);
    if (r.replaced) {
      showError(null);
      say('');
    }
  };
  loadBtn.addEventListener('click', () => loadText(script.value));
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.text().then((text) => {
      script.value = text;
      loadText(text);
    });
  });

  /* ------------------------------ keyboard ------------------------------ */

  const onKeydown = (e: KeyboardEvent): void => {
    const origin = e.composedPath()[0];
    const inField = origin instanceof HTMLTextAreaElement || (origin instanceof HTMLInputElement && origin.type === 'text');
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (inField || (origin instanceof HTMLElement && origin.isContentEditable)) return;
      e.preventDefault();
      editor.focus();
      return;
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.altKey) {
      // in a text field with something in it, Ctrl+Z belongs to the field
      if (inField && (origin as HTMLInputElement | HTMLTextAreaElement).value !== '') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
  };
  document.addEventListener('keydown', onKeydown);

  return { session, editor, list, card, ghostNote, status, loadExample, undo, redo, dispose: () => document.removeEventListener('keydown', onKeydown) };
}
