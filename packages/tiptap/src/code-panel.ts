/**
 * The lines panel (design 4, ui.md Writing): under the figure, the figure's lines in a text area with one result per
 * line beside it. Typing applies 300 ms after the last key; a batch of edits commits to the node as one transaction.
 */
import { createHeadlessApp } from '@incantly/sdk';
import type { AppModeId, LineResult } from '@incantly/sdk';
import { SCRIPT_LIMIT, SCRIPT_HEADER, scriptFits } from './attrs';
import { tiptapError } from './errors';
import type { TiptapError } from './errors';
import type { FigureNodeView } from './node-view';

/** Wait after the last key before the lines apply. */
export const APPLY_DELAY_MS = 300;

/** What one row beside the text says. */
export interface RowResult {
  readonly ok: boolean;
  readonly text: string;
}

const TYPES_SHOWN_AS_VALUE: ReadonlySet<string> = new Set(['Number', 'Bool', 'Text', 'Point', 'Vector']);

/** The text of a result row: `Type` or the value for a definition, the message and the hint for an error. */
export function rowOf(r: LineResult): RowResult {
  if (r.ok) {
    if (r.type !== undefined && r.summary !== undefined && TYPES_SHOWN_AS_VALUE.has(r.type.replace(/<.*$/, ''))) {
      const eq = r.summary.indexOf('=');
      return { ok: true, text: eq >= 0 ? r.summary.slice(eq + 1).trim() : r.summary };
    }
    return { ok: true, text: r.type ?? r.summary ?? '' };
  }
  const hint = 'hint' in r && typeof r.hint === 'string' && r.hint !== '' ? ` ${r.hint}` : '';
  const message = r.message.endsWith('.') || r.message.endsWith('?') ? r.message : `${r.message}.`;
  return { ok: false, text: `${message}${hint}` };
}

/** The result of each line of a script, from one headless run. `null` for a line with nothing to say (blank, comment). */
export function resultsOf(script: string, mode?: AppModeId): (RowResult | null)[] {
  const lines = script.split('\n');
  const rows: (RowResult | null)[] = lines.map(() => null);
  let app: ReturnType<typeof createHeadlessApp> | undefined;
  try {
    app = createHeadlessApp({ ...(mode !== undefined ? { mode } : {}) });
    const header = SCRIPT_HEADER.exec(script);
    const skip = header ? (header[0].match(/\n/g)?.length ?? 0) : 0;
    const body = lines.map((l, i) => (i < skip || l.trim().startsWith('#') ? '' : l));
    for (const r of app.run(body)) {
      const at = 'line' in r && typeof r.line === 'number' ? r.line : 0;
      if (at >= 1 && at <= rows.length) rows[at - 1] = rowOf(r);
    }
  } catch {
    // the rows stay empty; the figure's own lines still apply
  } finally {
    try {
      app?.destroy();
    } catch {
      // nothing to free
    }
  }
  return rows;
}

export class CodePanel {
  readonly el: HTMLElement;
  private readonly area: HTMLTextAreaElement;
  private readonly gutter: HTMLElement;
  private readonly results: HTMLElement;
  private readonly foot: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private opened = false;
  /** Text typed and not yet committed. */
  private pending: string | undefined;
  /** Lines the writer typed that an outside change replaced (collaboration conflict). */
  private kept: string | undefined;

  constructor(private readonly owner: FigureNodeView, private readonly doc: Document) {
    const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
      const el = doc.createElement(tag);
      el.className = cls;
      return el;
    };
    this.el = h('div', 'inc-tt-panel');
    this.el.hidden = true;
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Figure lines');
    const head = h('div', 'inc-tt-panel-head');
    const title = h('span', 'inc-tt-panel-title');
    title.textContent = 'Lines';
    const close = h('button', 'inc-tt-btn');
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close the lines');
    close.addEventListener('click', () => this.owner.closeLines());
    head.append(title, close);
    const body = h('div', 'inc-tt-panel-body');
    this.gutter = h('ol', 'inc-tt-gutter');
    this.gutter.setAttribute('aria-hidden', 'true');
    this.area = h('textarea', 'inc-tt-lines');
    this.area.spellcheck = false;
    this.area.wrap = 'off';
    this.area.setAttribute('aria-label', 'Lines of the figure');
    this.results = h('ol', 'inc-tt-results');
    this.foot = h('div', 'inc-tt-panel-foot');
    this.foot.setAttribute('role', 'status');
    body.append(this.gutter, this.area, this.results);
    this.el.append(head, body, this.foot);
    this.area.addEventListener('input', () => this.onInput());
    this.area.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.owner.closeLines();
      }
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** True while the writer has typed lines that are not committed yet. */
  get dirty(): boolean {
    return this.pending !== undefined;
  }

  get text(): string {
    return this.area.value;
  }

  /** Shows the panel with the node's script; puts the caret at the start of `line` when one is given. */
  open(script: string, line?: number): void {
    this.opened = true;
    this.el.hidden = false;
    if (!this.dirty) this.setText(script);
    this.refreshRows(this.area.value);
    this.area.focus();
    if (line !== undefined && line >= 1) {
      const lines = this.area.value.split('\n');
      const at = lines.slice(0, Math.min(line - 1, lines.length - 1)).reduce((n, l) => n + l.length + 1, 0);
      this.area.setSelectionRange(at, at);
    }
  }

  close(): void {
    this.flush();
    this.opened = false;
    this.el.hidden = true;
  }

  /** Commits typed lines now (before the panel closes or the figure is destroyed). */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pending !== undefined) this.apply(this.pending);
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.el.remove();
  }

  /** The node's script changed from outside (undo, a collaborator, the AI). */
  outsideScript(script: string): void {
    if (!this.opened) {
      this.setText(script);
      return;
    }
    const mine = this.pending;
    if (mine !== undefined && mine !== script) {
      // the outside script wins; the writer's lines wait in the panel to re-apply or discard
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      this.pending = undefined;
      this.kept = mine;
      this.setText(script);
      this.showConflict(mine);
      this.owner.reportConflict();
      return;
    }
    this.pending = undefined;
    this.setText(script);
    this.refreshRows(script);
  }

  /** Lines that arrive while the AI writes: they show here as they come. */
  showStreamed(script: string): void {
    if (!this.opened) return;
    this.setText(script);
    this.refreshRows(script);
  }

  private setText(script: string): void {
    this.area.value = script;
    this.fit();
  }

  private fit(): void {
    const n = this.area.value.split('\n').length;
    this.area.rows = Math.max(3, n);
    this.area.style.height = `${Math.max(3, n) * 20 + 12}px`;
    const nums = this.gutter.children.length;
    if (nums !== n) {
      const items: HTMLElement[] = [];
      for (let i = 1; i <= n; i++) {
        const li = this.doc.createElement('li');
        li.textContent = String(i);
        items.push(li);
      }
      this.gutter.replaceChildren(...items);
    }
  }

  private onInput(): void {
    this.fit();
    this.pending = this.area.value;
    this.clearConflict();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.pending !== undefined) this.apply(this.pending);
    }, APPLY_DELAY_MS);
  }

  /** Checks every line, applies the lines to the figure and commits the script as one transaction. */
  private apply(text: string): void {
    this.pending = undefined;
    if (!scriptFits(text)) {
      const e: TiptapError = tiptapError('bad_attrs', `The figure's script is over ${SCRIPT_LIMIT / 1024} KB, which is the limit.`, {
        hint: 'Split the figure into two, or remove unused objects.',
        node: this.owner.figureId,
      });
      this.foot.textContent = `${e.message} ${e.hint ?? ''}`;
      this.owner.reportPanelError(e);
      return;
    }
    this.refreshRows(text);
    this.owner.applyScript(text);
    if (text !== this.owner.currentScript()) this.owner.commitScript(text);
  }

  private refreshRows(text: string): void {
    const mode = this.owner.currentMode();
    const rows = resultsOf(text, mode);
    const items: HTMLElement[] = [];
    for (const row of rows) {
      const li = this.doc.createElement('li');
      if (row === null) li.textContent = '';
      else {
        li.className = row.ok ? 'inc-tt-ok' : 'inc-tt-bad-line';
        li.textContent = `${row.ok ? '✓' : '✗'} ${row.text}`;
      }
      items.push(li);
    }
    this.results.replaceChildren(...items);
  }

  private showConflict(mine: string): void {
    this.foot.replaceChildren();
    const msg = this.doc.createElement('span');
    msg.textContent = 'Someone else changed this figure first, so their lines are shown. Your lines are kept below.';
    const label = this.doc.createElement('strong');
    label.textContent = 'Your lines';
    const box = this.doc.createElement('pre');
    box.className = 'inc-tt-kept';
    box.textContent = mine;
    const again = this.doc.createElement('button');
    again.type = 'button';
    again.className = 'inc-tt-btn';
    again.textContent = 'Re-apply my lines';
    again.addEventListener('click', () => {
      const text = this.kept;
      this.clearConflict();
      if (text === undefined) return;
      this.setText(text);
      this.apply(text);
    });
    const drop = this.doc.createElement('button');
    drop.type = 'button';
    drop.className = 'inc-tt-btn';
    drop.textContent = 'Discard my lines';
    drop.addEventListener('click', () => this.clearConflict());
    this.foot.append(msg, label, box, again, drop);
  }

  private clearConflict(): void {
    this.kept = undefined;
    this.foot.replaceChildren();
  }
}
