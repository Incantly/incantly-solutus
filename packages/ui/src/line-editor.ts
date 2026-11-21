/**
 * `<incantly-line-editor>`: the line editor of docs/features/language/ui.md. A plain text field with syntax colouring,
 * live checking, error marks with message, hint and one-click fixes, completion with placeholders, signature help,
 * history and a live region. It uses only the language's public API; the host supplies the figure it checks against
 * and applies each accepted line.
 */
import { StateMachine, accepts, complete, preview, signatureHelp, tokenize, tyStr, typeSet } from '@incantly/kernel';
import type { Completion, FigureView, LanguageError, MachineTable, PreviewResult, SignatureHelp } from '@incantly/kernel';
import { emit, h, styleEl, uid } from './dom';
import { bracketInfo, buildRuns, markDefinitionTargets, placeTokens } from './highlight';
import type { Mark, Placed } from './highlight';
import { EDITOR_CSS, THEME_CSS } from './styles';
import {
  changedText, columnOf, countArgs, expandInsert, logicalAt, logicalLines, offsetOf, parseForm, plainSuperscripts, reasonText, speak, truncate, typeset,
} from './text';
import type { Hole, LogicalSpan } from './text';

export const PREVIEW_DELAY_MS = 100;
export const ERROR_DELAY_MS = 400;
export const HISTORY_LIMIT = 200;

export type SubmitResult = { readonly ok: true; readonly announcement?: string } | { readonly ok: false; readonly error: LanguageError };

/** Applies one logical line to the figure. Called in order for pasted text; the first failure stops the run. */
export type SubmitHandler = (line: string, info: { readonly index: number; readonly total: number }) => SubmitResult;

export interface SubmittedDetail {
  readonly applied: number;
  readonly failed: boolean;
}

const ICONS: Readonly<Record<string, string>> = {
  command: '⌘', function: 'ƒ', object: '•', constant: 'π', field: '.', property: '≡', directive: '≡', keyword: 'k', snippet: '+',
};

const WORD_BEFORE = /[\p{L}_][\p{L}\p{N}_]*$/u;
const PAIRS: Readonly<Record<string, string>> = { '(': ')', '[': ']' };

/**
 * The line's errors (docs ui.md section 3): hidden while the learner types, shown once they pause.
 * `typing`: no error shows. `quiet`: paused, no error. `error`: paused, the error shows.
 */
type ErrorState = 'typing' | 'quiet' | 'error';
type ErrorEvent = 'type' | 'settleQuiet' | 'settleError' | 'fail';
const ERROR_MACHINE: MachineTable<ErrorState, ErrorEvent> = {
  typing: { type: 'typing', settleQuiet: 'quiet', settleError: 'error', fail: 'error' },
  quiet: { type: 'typing', fail: 'error' },
  error: { type: 'typing', fail: 'error' },
};

/**
 * What covers the strip under the field. Esc first hides the strip (`dismissed`), then asks to clear the line
 * (`confirm`, or `confirmDismissed` when the strip was hidden first); a key other than Enter keeps the line.
 */
type CoverState = 'open' | 'dismissed' | 'confirm' | 'confirmDismissed';
type CoverEvent = 'reset' | 'dismiss' | 'askClear' | 'keep' | 'show';
const COVER_MACHINE: MachineTable<CoverState, CoverEvent> = {
  open: { reset: 'open', dismiss: 'dismissed', askClear: 'confirm', show: 'open' },
  dismissed: { reset: 'open', askClear: 'confirmDismissed', show: 'open' },
  confirm: { reset: 'open', keep: 'open' },
  confirmDismissed: { reset: 'open', keep: 'dismissed' },
};

export class LineEditorElement extends HTMLElement {
  static observedAttributes = ['placeholder', 'label'];

  /** The figure to check against (the kernel's `FigureView`). Set it before the first keystroke; call `refresh()` after the figure changes. */
  get figure(): FigureView | undefined {
    return this.fig;
  }
  set figure(f: FigureView | undefined) {
    this.fig = f;
    this.refresh();
  }

  onSubmitLine: SubmitHandler | undefined;

  private fig: FigureView | undefined;
  private readonly uidBase = uid('lang');
  private readonly mirror = h('pre', { class: 'mirror', 'aria-hidden': 'true' });
  private readonly input = h('textarea', {
    class: 'input', rows: 1, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
    'aria-multiline': 'true', 'aria-autocomplete': 'list', 'aria-label': 'Input line',
  });
  private readonly gutter = h('span', { class: 'gutter', 'aria-hidden': 'true' });
  private readonly strip = h('div', { class: 'strip' });
  private readonly listbox = h('ul', { class: 'list', role: 'listbox', 'aria-label': 'Completions', hidden: true });
  private readonly live = h('div', { class: 'vh', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  private readonly submitBtn = h('button', { class: 'submit', type: 'button', 'aria-label': 'Submit line' }, '↵');

  private tokens: Placed[] = [];
  private lexMarks: Mark[] = [];
  private result: PreviewResult | null = null;
  private resultBlock: LogicalSpan | null = null;
  private readonly errors = new StateMachine(ERROR_MACHINE, 'typing');
  private readonly cover = new StateMachine(COVER_MACHINE, 'open');
  private get paused(): boolean {
    return !this.errors.is('typing');
  }
  private get errorShown(): boolean {
    return this.errors.is('error');
  }
  private get dismissed(): boolean {
    return this.cover.is('dismissed', 'confirmDismissed');
  }
  private get confirmClear(): boolean {
    return this.cover.is('confirm', 'confirmDismissed');
  }
  private sig: SignatureHelp | null = null;

  private items: Completion[] = [];
  private active = 0;
  private range: { start: number; end: number } = { start: 0, end: 0 };
  private isOpen = false;

  private holes: Hole[] = [];
  private holeIdx = -1;
  private lastLen = 0;
  private silent = false;

  private history: string[] = [];
  private histIdx = -1;
  private lastAnnounce = '';
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.listbox.id = this.uidBase + '-list';
    this.strip.id = this.uidBase + '-strip';
    this.input.setAttribute('aria-controls', this.listbox.id);
    this.input.setAttribute('aria-describedby', this.strip.id);
    const field = h('div', { class: 'field' }, this.mirror, this.input);
    const bar = h('div', { class: 'bar' }, this.gutter, field, this.submitBtn);
    root.append(styleEl(THEME_CSS + EDITOR_CSS), bar, this.listbox, this.strip, this.live);

    this.input.addEventListener('input', this.onInput);
    this.input.addEventListener('keydown', this.onKeyDown);
    this.input.addEventListener('keyup', this.onCaret);
    this.input.addEventListener('pointerup', this.onCaret);
    this.input.addEventListener('focus', this.onCaret);
    this.input.addEventListener('blur', this.onBlur);
    this.input.addEventListener('scroll', () => {
      this.mirror.scrollTop = this.input.scrollTop;
    });
    this.submitBtn.addEventListener('click', () => this.submit());
    this.listbox.addEventListener('mousedown', (e) => e.preventDefault());
    this.strip.addEventListener('mousedown', (e) => e.preventDefault());
    this.paint();
  }

  connectedCallback(): void {
    this.syncAttributes();
  }

  disconnectedCallback(): void {
    clearTimeout(this.previewTimer);
    clearTimeout(this.errorTimer);
  }

  attributeChangedCallback(): void {
    this.syncAttributes();
  }

  private syncAttributes(): void {
    const ph = this.getAttribute('placeholder');
    if (ph !== null) this.input.setAttribute('placeholder', ph);
    const label = this.getAttribute('label');
    if (label !== null) this.input.setAttribute('aria-label', label);
  }

  /* ------------------------------ public API ------------------------------ */

  get value(): string {
    return this.input.value;
  }
  set value(v: string) {
    this.input.value = v.replace(/\r\n?/g, '\n');
    this.holes = [];
    this.histIdx = -1;
    this.afterEdit(false);
  }

  /** Submitted lines of this figure, newest first (the host saves them with the figure's UI state). */
  get lines(): readonly string[] {
    return this.history;
  }
  set lines(v: readonly string[]) {
    this.history = v.slice(0, HISTORY_LIMIT);
  }

  override focus(_options?: FocusOptions): void {
    this.input.focus();
  }

  /** Inserts text at the caret, or replaces the whole field. */
  insertText(text: string, opts: { replace?: boolean } = {}): void {
    this.input.focus();
    if (opts.replace) this.edit(0, this.input.value.length, text);
    else this.edit(this.input.selectionStart ?? 0, this.input.selectionEnd ?? 0, text);
  }

  /** Re-checks the text against the figure (call it when the figure changed). */
  refresh(): void {
    this.afterEdit(false);
  }

  /** Says something through the polite live region. */
  announce(message: string): void {
    this.lastAnnounce = this.lastAnnounce === message ? message + '\u00a0' : message;
    this.live.textContent = this.lastAnnounce;
  }

  /* ------------------------------- checking ------------------------------- */

  private firstBlock(): LogicalSpan | null {
    return logicalLines(this.input.value).find((b) => b.text.trim() !== '') ?? null;
  }

  private retokenize(): void {
    const text = this.input.value;
    const r = tokenize(text, this.fig);
    this.tokens = markDefinitionTargets(text, placeTokens(text, r.tokens));
    this.lexMarks = [];
    for (const e of r.errors) {
      if (e.kind !== 'bad_character') continue;
      const a = offsetOf(text, e.line, e.col);
      const b = offsetOf(text, e.line, e.endCol);
      this.lexMarks.push({ start: a, end: Math.max(b, a + 1), cls: 'squiggle' });
    }
  }

  private runPreview(): void {
    const block = this.firstBlock();
    this.resultBlock = block;
    this.result = block && this.fig ? preview(block.text, this.fig) : null;
    emit(this, 'incantly-preview', { result: this.result });
  }

  private updateSignature(): void {
    const text = this.input.value;
    const caret = this.input.selectionStart ?? 0;
    const block = logicalAt(text, caret);
    this.sig = this.fig ? signatureHelp(block.text, caret - block.start, this.fig) : null;
  }

  /** The text changed (typed, completed, fixed or set): everything that depends on it is recomputed. */
  private afterEdit(typed: boolean): void {
    const ta = this.input;
    const fixed = plainSuperscripts(ta.value, ta.selectionStart ?? ta.value.length);
    if (fixed.text !== ta.value) {
      ta.value = fixed.text;
      ta.setSelectionRange(fixed.caret, fixed.caret);
    }
    this.lastLen = ta.value.length;
    this.cover.send('reset');
    this.errors.send('type');
    clearTimeout(this.previewTimer);
    clearTimeout(this.errorTimer);
    this.retokenize();
    this.updateSignature();
    if (typed) this.maybeComplete(false);
    else this.closeCompletion();
    this.paint();
    this.renderStrip();
    this.previewTimer = setTimeout(() => {
      this.runPreview();
      this.paint();
      this.renderStrip();
    }, PREVIEW_DELAY_MS);
    this.errorTimer = setTimeout(() => this.settle(), ERROR_DELAY_MS);
  }

  /** The learner paused: errors may now show (docs ui.md section 3). */
  private settle(): void {
    if (!this.result && this.firstBlock()) this.runPreview();
    const r = this.result;
    this.errors.send(!!r && !r.ok && !r.incomplete ? 'settleError' : 'settleQuiet');
    this.paint();
    this.renderStrip();
    if (this.errorShown && r && !r.ok) this.announce(this.errorAnnouncement(r.error));
  }

  private errorAnnouncement(e: LanguageError): string {
    const fix = e.fix ?? e.suggest[0];
    return `Error in column ${e.col}: ${e.message}${fix ? `. Suggested fix: ${fix}` : ''}`;
  }

  /* ------------------------------- painting ------------------------------- */

  private errorMarks(): Mark[] {
    const r = this.result;
    const block = this.resultBlock;
    if (!this.errorShown || !r || r.ok || r.incomplete || !block) return [];
    const text = this.input.value;
    const marks: Mark[] = [];
    const spanOf = (line: number, col: number, endCol: number): void => {
      const a = block.start + offsetOf(block.text, line, col);
      const b = block.start + offsetOf(block.text, line, endCol);
      const start = a >= text.length ? Math.max(0, text.length - 1) : a;
      marks.push({ start, end: Math.max(b, start + 1), cls: 'squiggle' });
    };
    const add = (e: LanguageError): void => {
      if (e.problems && e.problems.length > 0) for (const p of e.problems) spanOf(e.line, p.col, p.endCol);
      else spanOf(e.line, e.col, e.endCol);
    };
    add(r.error);
    for (const m of r.error.more ?? []) add(m);
    return marks;
  }

  private paint(): void {
    const text = this.input.value;
    const caret = this.input.selectionStart ?? 0;
    const collapsed = caret === (this.input.selectionEnd ?? caret);
    const brackets = bracketInfo(this.tokens, caret);
    const marks: Mark[] = [...brackets.unmatched, ...(collapsed ? brackets.boxed : []), ...this.lexMarks, ...this.errorMarks()];
    if (this.paused) for (const t of this.tokens) if (t.kind === 'unknown') marks.push({ start: t.start, end: t.end, cls: 'squiggle' });
    const runs = buildRuns(text, this.tokens, marks);
    const nodes: (Node | string)[] = runs.map((r) => (r.cls ? h('span', { class: r.cls }, r.text) : document.createTextNode(r.text)));
    nodes.push('\u200b');
    this.mirror.replaceChildren(...nodes);
    this.mirror.scrollTop = this.input.scrollTop;
    this.gutter.textContent = this.errorShown ? '✗' : '';
    this.input.setAttribute('aria-invalid', this.errorShown ? 'true' : 'false');
  }

  /** The strip under the field: an error, else signature help and the preview (docs ui.md sections 3, 5 and 6). */
  private renderStrip(): void {
    const s = this.strip;
    s.replaceChildren();
    if (this.confirmClear) {
      s.append(h('div', { class: 'expects' }, 'Clear the line? Press Enter to clear it, Esc to keep it.'));
      return;
    }
    if (this.dismissed) return;
    const r = this.result;
    if (this.errorShown && r && !r.ok && !r.incomplete) {
      s.append(this.errorEl(r.error));
      return;
    }
    if (this.sig) s.append(this.signatureEl(this.sig));
    if (r && r.ok) s.append(this.previewEl(r));
    else if (r && !r.ok && r.incomplete && this.input.value.trim() !== '') {
      const exp = r.error.expected.length > 0 ? r.error.expected.join(' or ') : 'more';
      s.append(h('div', { class: 'expects' }, `expects: ${exp}`));
    }
  }

  private previewEl(r: Extract<PreviewResult, { ok: true }>): HTMLElement {
    const type = r.type ? tyStr(r.type) : '';
    const undef = /^(.*?)\s*=?\s*undefined \((\w+)\)$/.exec(r.valueText);
    let body: string;
    if (undef) body = `${r.name} is undefined: ${reasonText(undef[2] as string)}`;
    else if (r.valueText.includes('=')) body = r.valueText;
    else if (r.ghost) body = `${r.name} = ${r.valueText}`;
    else body = r.name;
    const shown = undef ? body : typeset(body);
    const el = h('div', { class: 'preview', role: 'group', 'aria-label': `Preview: ${undef ? body : speak(body)}${type ? `, ${type}` : ''}` });
    el.append(
      h('span', { 'aria-hidden': 'true' }, 'preview:  '),
      h('span', { class: undef ? 'undef' : '', 'aria-hidden': 'true' }, shown),
      h('span', { 'aria-hidden': 'true' }, type ? `   → ${type}  ` : '  '),
      h('span', { class: 'ok', 'aria-hidden': 'true' }, '✓'),
    );
    for (const n of r.warnings) el.append(h('div', { class: 'warn' }, n.message));
    return el;
  }

  private signatureEl(sig: SignatureHelp): HTMLElement {
    const wrap = h('div', { class: 'sig', role: 'group', 'aria-label': `${sig.command} forms` });
    const typed = sig.argsSoFar.length > 0;
    for (const f of sig.forms) {
      if (!f.matches && typed && !f.active) continue;
      const parts = parseForm(f.text);
      const row = h('div', { class: 'form' + (f.active ? ' active' : ''), ...(f.active ? { 'aria-current': 'true' } : {}) });
      let at = 0;
      parts.spans.forEach((sp, i) => {
        row.append(f.text.slice(at, sp.start));
        const chunk = f.text.slice(sp.start, sp.end);
        row.append(f.active && i === sig.activeParam ? h('u', {}, chunk) : chunk);
        at = sp.end;
      });
      row.append(f.text.slice(at));
      if (f.active && f.summary) row.append(h('span', { class: 'summary' }, `  ${f.summary}`));
      wrap.append(row);
    }
    return wrap;
  }

  private errorEl(e: LanguageError): HTMLElement {
    const block = this.resultBlock;
    const original = block ? block.text : '';
    const el = h('div', { class: 'error' });
    el.append(h('div', { class: 'msg' }, e.message));
    if (e.hint) el.append(h('div', { class: 'hint' }, e.hint));
    if (e.more && e.more.length > 0) {
      const list = h('ul', { class: 'more' });
      for (const m of e.more) list.append(h('li', {}, `Column ${m.col}: ${m.message}`));
      el.append(list);
    }
    const chips = h('div', { class: 'chips' });
    const callable = /^[\p{L}_][\p{L}\p{N}_]*\s*\(/u.test(e.token);
    const closest = e.forms.findIndex((f) => parseForm(f).params.filter((p) => !p.optional).length <= countArgs(e.token) && parseForm(f).params.length >= countArgs(e.token));
    e.forms.forEach((form, i) => {
      const label = form.replace(/\s*->.*$/, '');
      if (!callable) {
        chips.append(h('span', { class: 'form' }, label));
        return;
      }
      const b = h('button', { type: 'button', class: 'form-chip' + (i === (closest < 0 ? 0 : closest) ? ' closest' : ''), title: form }, label);
      b.addEventListener('click', () => this.applyForm(e, form));
      chips.append(b);
    });
    const seen = new Set<string>();
    const addFix = (label: string, lines: readonly string[], full: string): void => {
      const key = lines.join('\n');
      if (seen.has(key)) return;
      seen.add(key);
      const b = h('button', { type: 'button', class: 'fix', title: full, 'aria-label': `Suggested fix: ${full}` }, label);
      b.addEventListener('click', () => this.applyText(lines.join('\n')));
      chips.append(b);
    };
    if (e.fix !== undefined) addFix(this.fixLabel(original, e.fix), [e.fix], e.fix);
    for (const q of e.quickFixes ?? []) addFix(q.label, q.lines, q.lines.join(' / '));
    for (const line of e.suggest.slice(0, 3)) addFix(`Use ${truncate(line, 40)}`, [line], line);
    if (chips.childNodes.length > 0) el.append(chips);
    return el;
  }

  private fixLabel(original: string, fixed: string): string {
    const { added, removed } = changedText(original, fixed);
    if (added !== '' && removed === '') return `Add ${truncate(added, 30)}`;
    if (added === '' && removed !== '') return `Remove ${truncate(removed, 30)}`;
    if (added !== '') return `Use ${truncate(added, 30)}`;
    return `Use ${truncate(fixed, 40)}`;
  }

  /* ------------------------------- editing ------------------------------- */

  /** Replaces a range. It goes through the browser's edit command when it can, so the field's own undo keeps working. */
  private edit(start: number, end: number, text: string, select?: readonly [number, number]): void {
    const ta = this.input;
    const before = ta.value;
    const expected = before.slice(0, start) + text + before.slice(end);
    ta.focus();
    ta.setSelectionRange(start, end);
    this.silent = true;
    try {
      if (typeof document.execCommand === 'function') document.execCommand('insertText', false, text);
    } catch {
      // fall through to the direct edit below
    }
    if (ta.value !== expected) ta.value = expected;
    this.silent = false;
    const caret = start + text.length;
    ta.setSelectionRange(select ? select[0] : caret, select ? select[1] : caret);
    this.afterEdit(false);
  }

  private applyText(replacement: string): void {
    const block = this.resultBlock ?? logicalAt(this.input.value, this.input.selectionStart ?? 0);
    this.edit(block.start, block.end, replacement);
  }

  /** A form chip: the call's arguments become placeholders, the first one selected. */
  private applyForm(e: LanguageError, form: string): void {
    const block = this.resultBlock;
    if (!block) return;
    const parts = parseForm(form);
    const names = parts.params.filter((p) => !p.optional).map((p) => p.name);
    const call = `${parts.name}(${names.join(', ')})`;
    const a = block.start + offsetOf(block.text, e.line, e.col);
    const b = block.start + offsetOf(block.text, e.line, e.endCol);
    this.edit(a, b, call);
    this.holes = [];
    let at = a + parts.name.length + 1;
    for (const n of names) {
      this.holes.push({ start: at, end: at + n.length });
      at += n.length + 2;
    }
    this.selectHole(0);
  }

  private selectHole(i: number): void {
    const hole = this.holes[i];
    if (!hole) return;
    this.holeIdx = i;
    this.input.setSelectionRange(hole.start, hole.end);
    this.updateSignature();
    this.paint();
    this.renderStrip();
  }

  /** Keeps the placeholder offsets right while the learner overtypes one. */
  private adjustHoles(): void {
    const delta = this.input.value.length - this.lastLen;
    if (this.holes.length === 0 || delta === 0) return;
    const active = this.holes[this.holeIdx];
    if (!active) {
      this.holes = [];
      return;
    }
    active.end += delta;
    for (let i = this.holeIdx + 1; i < this.holes.length; i++) {
      (this.holes[i] as Hole).start += delta;
      (this.holes[i] as Hole).end += delta;
    }
  }

  /* ------------------------------- completion ------------------------------- */

  private maybeComplete(forced: boolean): void {
    const fig = this.fig;
    if (!fig) return;
    const text = this.input.value;
    const caret = this.input.selectionStart ?? 0;
    const block = logicalAt(text, caret);
    const rel = caret - block.start;
    const before = block.text.slice(0, rel);
    const m = WORD_BEFORE.exec(before);
    const word = m ? m[0] : '';
    const lead = m ? before[m.index - 1] : before[before.length - 1];
    const afterTrigger = lead === '.' || lead === '@';
    if (!forced && !(word.length >= 2 || (afterTrigger && word.length >= 1))) {
      this.closeCompletion();
      return;
    }
    const items = complete(block.text, rel, fig, { limit: 50 });
    if (items.length === 0) {
      this.closeCompletion();
      return;
    }
    this.items = items;
    this.active = 0;
    this.range = { start: caret - word.length, end: caret };
    this.openCompletion();
  }

  private openCompletion(): void {
    this.isOpen = true;
    const lb = this.listbox;
    lb.hidden = false;
    lb.replaceChildren(
      ...this.items.map((c, i) => {
        const li = h('li', { role: 'option', id: `${this.uidBase}-opt-${i}`, 'aria-selected': i === this.active ? 'true' : 'false' });
        li.append(
          h('span', { class: 'icon', 'aria-hidden': 'true' }, ICONS[c.kind] ?? '•'),
          h('span', { class: 'label' }, c.label),
          h('span', { class: 'detail' }, c.detail ?? ''),
          h('span', { class: 'kind' }, c.kind),
        );
        li.addEventListener('click', () => this.accept(i));
        return li;
      }),
    );
    this.syncActive();
  }

  private syncActive(): void {
    const options = [...this.listbox.children] as HTMLElement[];
    options.forEach((o, i) => o.setAttribute('aria-selected', i === this.active ? 'true' : 'false'));
    const cur = options[this.active];
    if (cur) {
      this.input.setAttribute('aria-activedescendant', cur.id);
      cur.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private closeCompletion(): void {
    if (!this.isOpen && this.listbox.hidden) return;
    this.isOpen = false;
    this.listbox.hidden = true;
    this.listbox.replaceChildren();
    this.items = [];
    this.input.removeAttribute('aria-activedescendant');
  }

  /** An object that fits a parameter type and was made last, not yet used in this call. */
  private bestObject(typeText: string, used: Set<string>): string | undefined {
    const fig = this.fig;
    if (!fig || typeText === '') return undefined;
    try {
      const set = typeSet(typeText);
      const names = fig.names();
      for (let i = names.length - 1; i >= 0; i--) {
        const name = names[i] as string;
        const info = fig.lookup(name);
        if (!used.has(name) && info && accepts(set, info.type)) return name;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private accept(i: number): void {
    const c = this.items[i];
    if (!c) return;
    const form = c.detail && (c.kind === 'command' || c.kind === 'function') ? parseForm(c.detail) : null;
    const used = new Set<string>();
    const { text, holes } = expandInsert(c.insert, (n) => {
      const p = form?.params[n - 1];
      const obj = p ? this.bestObject(p.type, used) : undefined;
      if (obj !== undefined) used.add(obj);
      return obj ?? p?.name ?? 'x';
    });
    const { start, end } = this.range;
    this.closeCompletion();
    const first = holes[0];
    this.edit(start, end, text, first ? [start + first.start, start + first.end] : undefined);
    this.holes = holes.map((hole) => ({ start: start + hole.start, end: start + hole.end }));
    this.holeIdx = this.holes.length > 0 ? 0 : -1;
    if (this.holes.length > 0) this.selectHole(0);
  }

  /* ------------------------------- submit ------------------------------- */

  private submit(): void {
    clearTimeout(this.previewTimer);
    clearTimeout(this.errorTimer);
    this.closeCompletion();
    const handler = this.onSubmitLine;
    if (!handler) return;
    const text = this.input.value;
    const blocks = logicalLines(text).filter((b) => b.text.trim() !== '');
    if (blocks.length === 0) return;
    let applied = 0;
    let announcement = '';
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i] as LogicalSpan;
      const res = handler(b.text, { index: i, total: blocks.length });
      if (!res.ok) {
        this.showSubmitError(text.slice(b.start), res.error);
        emit<SubmittedDetail>(this, 'incantly-submitted', { applied, failed: true });
        return;
      }
      applied += 1;
      this.pushHistory(b.text.trim());
      if (res.announcement) announcement = res.announcement;
    }
    this.input.value = '';
    this.holes = [];
    this.histIdx = -1;
    this.afterEdit(false);
    this.announce(applied > 1 ? `${applied} lines applied` : announcement || 'Line applied');
    emit<SubmittedDetail>(this, 'incantly-submitted', { applied, failed: false });
  }

  /** A line failed on Enter: the field keeps it and the rest, selects the bad span, and shows the error at once. */
  private showSubmitError(remaining: string, error: LanguageError): void {
    clearTimeout(this.previewTimer);
    clearTimeout(this.errorTimer);
    this.input.value = remaining;
    this.holes = [];
    this.lastLen = remaining.length;
    this.retokenize();
    const block = this.firstBlock();
    this.resultBlock = block;
    this.result = { ok: false, incomplete: false, error };
    this.errors.send('fail');
    this.cover.send('reset');
    this.closeCompletion();
    this.updateSignature();
    if (block) {
      const a = block.start + offsetOf(block.text, error.line, error.col);
      const b = block.start + offsetOf(block.text, error.line, error.endCol);
      this.input.setSelectionRange(a, Math.max(a, b));
    }
    this.paint();
    this.renderStrip();
    this.announce(this.errorAnnouncement(error));
  }

  private pushHistory(line: string): void {
    if (line === '' || this.history[0] === line) return;
    this.history.unshift(line);
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
  }

  /* ------------------------------- events ------------------------------- */

  private readonly onInput = (): void => {
    if (this.silent) return;
    this.adjustHoles();
    this.histIdx = -1;
    this.afterEdit(true);
  };

  private readonly onCaret = (): void => {
    this.updateSignature();
    if (this.isOpen) {
      const caret = this.input.selectionStart ?? 0;
      if (caret < this.range.start || caret > this.range.end) this.closeCompletion();
    }
    this.paint();
    this.renderStrip();
  };

  private readonly onBlur = (): void => {
    this.closeCompletion();
    this.paint();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing) return;
    const k = e.key;
    const ta = this.input;
    const mod = e.ctrlKey || e.metaKey;

    if (this.confirmClear) {
      if (k === 'Enter') {
        e.preventDefault();
        this.edit(0, ta.value.length, '');
        this.announce('Line cleared');
        return;
      }
      this.cover.send('keep');
      this.renderStrip();
      if (k === 'Escape') {
        e.preventDefault();
        return;
      }
    }

    if (this.isOpen) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const n = this.items.length;
        this.active = (this.active + (k === 'ArrowDown' ? 1 : n - 1)) % n;
        this.syncActive();
        return;
      }
      if (k === 'Enter' || k === 'Tab') {
        e.preventDefault();
        this.accept(this.active);
        return;
      }
      if (k === 'Escape') {
        e.preventDefault();
        this.closeCompletion();
        return;
      }
    }

    if (mod && k === ' ') {
      e.preventDefault();
      if (e.shiftKey) {
        this.cover.send('show');
        this.updateSignature();
        this.renderStrip();
      } else this.maybeComplete(true);
      return;
    }
    if (mod && k === '/') {
      e.preventDefault();
      this.toggleComment();
      return;
    }
    if (k === 'Enter' && !e.shiftKey && !mod) {
      e.preventDefault();
      this.submit();
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      this.escape();
      return;
    }
    if (k === 'Tab' && this.holes.length > 0) {
      const next = this.holeIdx + (e.shiftKey ? -1 : 1);
      if (next >= 0 && next < this.holes.length) {
        e.preventDefault();
        this.selectHole(next);
        return;
      }
      if (!e.shiftKey) {
        const last = this.holes[this.holes.length - 1] as Hole;
        this.holes = [];
        this.holeIdx = -1;
        if (ta.value[last.end] === ')') {
          e.preventDefault();
          ta.setSelectionRange(last.end + 1, last.end + 1);
          this.onCaret();
          return;
        }
      }
    }
    if ((k === 'ArrowUp' || k === 'ArrowDown') && !e.shiftKey && !mod && this.historyApplies()) {
      e.preventDefault();
      this.walkHistory(k === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (!mod && !e.altKey && k.length === 1) this.autoClose(e);
    if (k === 'Backspace' && !mod && ta.selectionStart === ta.selectionEnd) this.backspacePair(e);
  };

  private escape(): void {
    if (!this.dismissed && this.strip.childNodes.length > 0) {
      this.cover.send('dismiss');
      this.renderStrip();
      emit(this, 'incantly-preview', { result: null });
      return;
    }
    if (this.input.value !== '') {
      this.cover.send('askClear');
      this.renderStrip();
      this.announce('Clear the line? Press Enter to clear it, Escape to keep it.');
    }
  }

  private historyApplies(): boolean {
    const v = this.input.value;
    if (this.history.length === 0) return false;
    return v === '' || (this.histIdx >= 0 && v === this.history[this.histIdx]);
  }

  private walkHistory(dir: 1 | -1): void {
    const next = Math.min(this.history.length - 1, this.histIdx + dir);
    this.histIdx = next;
    const text = next < 0 ? '' : (this.history[next] as string);
    this.edit(0, this.input.value.length, text);
    this.histIdx = next;
  }

  private toggleComment(): void {
    const ta = this.input;
    const v = ta.value;
    const caret = ta.selectionStart ?? 0;
    const ls = v.lastIndexOf('\n', caret - 1) + 1;
    const nl = v.indexOf('\n', caret);
    const le = nl < 0 ? v.length : nl;
    const line = v.slice(ls, le);
    const next = /^\s*#/.test(line) ? line.replace(/^(\s*)# ?/, '$1') : '# ' + line;
    this.edit(ls, le, next);
  }

  /** Typing `(`, `[` or `"` adds the pair; typing a closer over its twin steps over it. */
  private autoClose(e: KeyboardEvent): void {
    const ta = this.input;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const i = ta.selectionStart ?? 0;
    const v = ta.value;
    const k = e.key;
    const next = v[i] ?? '';
    const free = next === '' || /[\s)\],]/.test(next);
    const closeOf = PAIRS[k];
    if (closeOf !== undefined && free) {
      e.preventDefault();
      this.edit(i, i, k + closeOf, [i + 1, i + 1]);
      this.afterEdit(true);
      return;
    }
    if ((k === ')' || k === ']') && next === k && this.hasOpener(v.slice(0, i), k === ')' ? '(' : '[')) {
      e.preventDefault();
      ta.setSelectionRange(i + 1, i + 1);
      this.onCaret();
      return;
    }
    if (k === '"') {
      const lineStart = v.lastIndexOf('\n', i - 1) + 1;
      const quotes = (v.slice(lineStart, i).match(/(?<!\\)"/g) ?? []).length;
      if (quotes % 2 === 1 && next === '"') {
        e.preventDefault();
        ta.setSelectionRange(i + 1, i + 1);
        this.onCaret();
      } else if (quotes % 2 === 0 && free) {
        e.preventDefault();
        this.edit(i, i, '""', [i + 1, i + 1]);
        this.afterEdit(true);
      }
    }
  }

  private hasOpener(prefix: string, opener: string): boolean {
    const closer = opener === '(' ? ')' : ']';
    let depth = 0;
    let inString = false;
    for (const c of prefix) {
      if (c === '"') inString = !inString;
      else if (!inString && c === opener) depth++;
      else if (!inString && c === closer) depth = Math.max(0, depth - 1);
    }
    return depth > 0;
  }

  /** Backspace between an empty pair removes both. */
  private backspacePair(e: KeyboardEvent): void {
    const ta = this.input;
    const i = ta.selectionStart ?? 0;
    const pair = ta.value.slice(i - 1, i + 1);
    if (pair === '()' || pair === '[]' || pair === '""') {
      e.preventDefault();
      this.edit(i - 1, i + 1, '');
      this.afterEdit(true);
    }
  }

  /** Column of the caret in its physical line (1-based), for the host's status line. */
  get column(): number {
    return columnOf(this.input.value, this.input.selectionStart ?? 0);
  }
}
