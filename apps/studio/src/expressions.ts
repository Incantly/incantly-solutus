/**
 * The expression list: one row per figure line, the way a graphing calculator shows them. Each row has a colour swatch
 * (click to hide or show the object), the line as editable text, and under it the value, a slider, a result card or
 * the reason it failed. The last row is empty: type there to add a line. Rows are keyed by object id and updated in
 * place, so typing is never interrupted by a repaint.
 */
import { complete, niceRange, signatureHelp, valueText } from '@incantly/kernel';
import type { Completion, ErrorObject, FigureView } from '@incantly/kernel';
import { nextName } from '@incantly/ui';
import type { LineRow } from '@incantly/ui';
import { AlgebraCache, DEFAULT_PREFS, algebraRows, prefsFromScript, refreshAlgebraRows, suggestionsFor } from '@incantly/view';
import type { AlgebraObject, AlgebraPrefs, AlgebraRow, DisplayMode } from '@incantly/view';
import { colorAt } from './graph/paint';
import { miniCurve, miniInterval } from './mini';
import { mathElement } from './graph/mathdraw';
import type { KernelSession } from './session';
import { selectionFrom } from './selection';
import type { Selection } from './selection';

/** Types that draw on the graph and so get a swatch. */
const DRAWN = new Set(['Particles', 'Point', 'Vector', 'Segment', 'Line', 'Ray', 'Circle', 'Arc', 'Sector', 'Conic', 'Polyline', 'Polygon', 'Function', 'Curve', 'Relation', 'Region', 'Field', 'Chart', 'ContinuousDistribution', 'DiscreteDistribution']);

export function drawsOnGraph(type: string, typeText: string, value: unknown): boolean {
  const base = type.replace(/<.*$/, '');
  if (DRAWN.has(base)) return true;
  if (base === 'List') return /^List<(Point|Polygon|Segment|Circle|Line|Vector)/.test(typeText);
  if (base === 'Record') return (value as { schema?: string } | undefined)?.schema === 'Fit';
  return false;
}

export interface ExpressionList {
  readonly element: HTMLElement;
  /** Rebuilds the rows from the session (after any change). */
  update(): void;
  /** The colour of an object, by id. */
  colorOf(id: number): string;
  isHidden(id: number): boolean;
  /** Puts the caret in the empty row at the end. */
  focusNew(text?: string): void;
  /** Highlights the rows of these objects for two seconds: the lines a tool just wrote (tools-2d ui.md 4). */
  flash(names: readonly string[]): void;
  /** The list's header: filter box and display settings (algebra-view ui.md 1). */
  readonly header: HTMLElement;
  /** The preferences in force: the user's, overridden by the figure's `@algebra` lines. */
  prefs(): AlgebraPrefs;
  setPrefs(patch: Partial<AlgebraPrefs>): void;
}

export interface ExpressionOptions {
  readonly session: KernelSession;
  /** Called when visibility changes, so the graph repaints. */
  readonly changed: () => void;
  /** Status messages for the screen reader and the footer. */
  readonly say: (text: string) => void;
  /** The visible x-range of the graph, for next-step cards that scan the view. */
  readonly view?: () => { readonly x0: number; readonly x1: number };
  /** The studio's selection (design 3.9): a row click selects, a canvas pick scrolls to and marks the row. */
  readonly selection?: Selection;
}

interface RowParts {
  readonly row: HTMLElement;
  readonly swatch: HTMLButtonElement;
  readonly index: HTMLElement;
  readonly input: HTMLInputElement;
  readonly out: HTMLElement;
  readonly del: HTMLButtonElement;
  /** The row's text in maths form, shown while it is not being edited. */
  readonly display: HTMLElement;
  /** "Made from" and "used by", and the undefined chain, when expanded (design 3.7). */
  readonly deps: HTMLElement;
  readonly toggle: HTMLButtonElement;
  /** A next-step card under the row (design 3.13). */
  readonly card: HTMLElement;
  /** The text last shown from the figure, to tell an edit in progress from a stale row. */
  shown: string;
  error: ErrorObject | undefined;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

/** The name a line defines: `a = …`, `f(x) = …`. */
export function lineName(text: string): string | undefined {
  const m = /^\s*([A-Za-z_][\w']*)\s*(?:\([^)]*\))?\s*=(?!=)/.exec(text);
  return m?.[1];
}

/** A short unused name for a bare expression; letters the language reserves (e, t, x, y, z) are skipped. */
function freeName(session: KernelSession): string {
  for (const c of 'abcdghkmnpqrsuvw') if (!session.figure.get(c)) return c;
  let k = 1;
  while (session.figure.get(`v${k}`)) k++;
  return `v${k}`;
}

const fmt = (x: unknown): string => (typeof x === 'number' ? valueText(Number(x.toPrecision(4))) : valueText(x));

export function mountExpressions(opts: ExpressionOptions): ExpressionList {
  const { session } = opts;
  const element = el('div', 'exprs');
  element.setAttribute('role', 'list');
  element.setAttribute('aria-label', 'Expressions');
  const rows = new Map<number, RowParts>();
  const hidden = new Set<number>();
  let userPrefs: AlgebraPrefs = DEFAULT_PREFS;
  let prefs: AlgebraPrefs = DEFAULT_PREFS;
  let model = new Map<number, AlgebraRow>();
  const expanded = new Set<number>();
  const collapsed = new Set<string>();
  const groupHeads = new Map<string, HTMLElement>();
  const history: string[] = [];
  let historyAt = -1;
  /** Objects already offered a next-step card (once per object). */
  const offered = new Set<number>();
  let cardFor: number | undefined;
  /** A fresh name of a kind that is also not taken by an earlier call in the same batch. */
  const freeOf = (taken: Set<string>) => (kind: string): string => {
    const n = nextName(kind, (x) => !taken.has(x) && !session.figure.get(x) && session.figure.apply(`${x} = 0`, { dryRun: true }).ok);
    taken.add(n);
    return n;
  };
  const colors = new Map<number, string>();
  let nextColor = 0;
  const colorOf = (id: number): string => {
    let c = colors.get(id);
    if (!c) {
      c = colorAt(nextColor++);
      colors.set(id, c);
    }
    return c;
  };

  /* ------------------------------ completion ------------------------------ */

  const pop = el('ul', 'complete');
  pop.setAttribute('role', 'listbox');
  pop.hidden = true;
  const sig = el('div', 'signature');
  sig.hidden = true;
  let items: Completion[] = [];
  let pick = 0;
  let popFor: HTMLInputElement | undefined;

  const closePop = (): void => {
    pop.hidden = true;
    sig.hidden = true;
    items = [];
    popFor = undefined;
  };

  const place = (target: HTMLElement, node: HTMLElement): void => {
    const r = target.getBoundingClientRect();
    const host = element.getBoundingClientRect();
    node.style.left = `${r.left - host.left}px`;
    node.style.top = `${r.bottom - host.top + element.scrollTop + 4}px`;
    node.style.width = `${Math.max(260, r.width)}px`;
  };

  const showCompletions = (input: HTMLInputElement): void => {
    const typed = input.value;
    const typedCur = input.selectionStart ?? typed.length;
    // a bare expression is completed as the right side of a line, which is what it becomes
    const bare = lineName(typed) === undefined;
    const pad = bare ? 'q__ = ' : '';
    const text = pad + typed;
    const cur = typedCur + pad.length;
    const fig = session.figure.view as FigureView;
    // signature help inside a call
    const help = ((): ReturnType<typeof signatureHelp> => {
      try {
        return signatureHelp(text, cur, fig);
      } catch {
        return null;
      }
    })();
    if (help) {
      renderSignature(help);
      if (!sig.hidden) place(input, sig);
    } else sig.hidden = true;
    // completion of the word before the caret, from two letters
    const word = /[A-Za-z_]\w*$/.exec(text.slice(0, cur))?.[0] ?? '';
    if (word.length < 2) {
      pop.hidden = true;
      items = [];
      return;
    }
    try {
      items = complete(text, cur, fig, { limit: 8 });
    } catch {
      items = [];
    }
    items = items.filter((c) => c.label !== word);
    if (items.length === 0) {
      pop.hidden = true;
      return;
    }
    pick = 0;
    popFor = input;
    pop.replaceChildren(...items.map((c, i) => {
      const li = el('li', i === 0 ? 'on' : '');
      li.setAttribute('role', 'option');
      li.append(el('span', 'c-label', c.label), el('span', 'c-detail', c.detail ?? c.kind));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        accept(input, i);
      });
      return li;
    }));
    place(input, pop);
    pop.hidden = false;
    if (!sig.hidden) sig.style.top = `${parseFloat(pop.style.top) + pop.getBoundingClientRect().height + 4}px`;
  };

  /** Which form the signature box shows: the active one, or another picked with Alt+Up and Alt+Down. */
  let sigShift = 0;
  let sigFor = '';
  const renderSignature = (help: NonNullable<ReturnType<typeof signatureHelp>>): void => {
    const forms = [...help.forms].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.matches) - Number(a.matches));
    if (forms.length === 0) {
      sig.hidden = true;
      return;
    }
    if (sigFor !== help.command) {
      sigFor = help.command;
      sigShift = 0;
    }
    const at = ((sigShift % forms.length) + forms.length) % forms.length;
    const f = forms[at] as (typeof forms)[number];
    sig.replaceChildren();
    // the form with the parameter being typed in bold (language ui.md, signature help)
    const m = /^(\w+)\((.*)\)(\s*->\s*(.*))?$/.exec(f.text);
    const head = el('div', 'sig-form');
    if (m) {
      const params = (m[2] as string).length ? (m[2] as string).split(/,\s*/) : [];
      head.append(el('span', 'sig-name', `${m[1]}(`));
      params.forEach((p, i) => {
        if (i > 0) head.append(document.createTextNode(', '));
        head.append(el('span', i === help.activeParam && (at === 0 || f.matches) ? 'sig-param on' : 'sig-param', p));
      });
      head.append(document.createTextNode(')'));
      if (m[4]) head.append(el('span', 'sig-ret', ` → ${m[4]}`));
    } else head.textContent = f.text;
    sig.append(head);
    if (f.summary) sig.append(el('div', 'sig-summary', f.summary));
    if (forms.length > 1) {
      const n = forms.filter((x) => x.matches).length;
      sig.append(el('div', 'sig-more', `${at + 1} of ${forms.length} forms${n > 1 ? ` · ${n} fit so far` : ''} · Alt+↑ ↓ for others`));
    }
    sig.setAttribute('aria-label', `${f.text}. ${f.summary}`);
    sig.hidden = false;
  };

  const accept = (input: HTMLInputElement, i: number): void => {
    const c = items[i];
    if (!c) return;
    const text = input.value;
    // (completion ran on the padded text; the word before the caret is the same in both)
    const cur = input.selectionStart ?? text.length;
    const start = cur - (/[A-Za-z_]\w*$/.exec(text.slice(0, cur))?.[0].length ?? 0);
    const ins = c.insert.replace(/\$\d/g, '');
    const hole = c.insert.indexOf('$1');
    input.value = text.slice(0, start) + ins + text.slice(cur);
    const caret = start + (hole >= 0 ? hole : ins.length);
    input.setSelectionRange(caret, caret);
    closePop();
    input.focus();
    showCompletions(input);
  };

  /* ------------------------------ rows ------------------------------ */

  const commit = (parts: RowParts | undefined, input: HTMLInputElement, oldName: string | undefined): void => {
    let text = input.value.trim();
    if (text === '') {
      if (oldName) remove(oldName);
      return;
    }
    if (parts && text === parts.shown) return;
    // a lesson may allow only some commands (design 3.11, error kind `restricted`)
    if (prefs.input.kind === 'commands') {
      const allowed = prefs.input.names;
      const used = [...text.matchAll(/\b([A-Z]\w*)\s*\(/g)].map((m) => m[1] as string).filter((c) => !allowed.includes(c) && !session.figure.get(c));
      if (used.length > 0) {
        return showError(parts, input, { ok: false, kind: 'restricted', line: 1, col: 1, endCol: text.length + 1, token: used[0] as string, message: `This activity allows ${allowed.join(', ')}.`, forms: allowed.map((c) => `${c}(...)`), hint: `${used[0]} is not part of this activity.` } as unknown as ErrorObject);
      }
    }
    if (!parts) {
      history.unshift(text);
      if (history.length > 200) history.length = 200;
      historyAt = -1;
    }
    const newName = lineName(text);
    if (oldName && newName && newName !== oldName && !session.figure.get(newName)) {
      const rn = session.rename(oldName, newName);
      if (!rn.ok) return showError(parts, input, rn.error);
    }
    let r = session.submit(text);
    if (!r.ok && r.error.kind === 'unnamed_object') {
      // a bare expression gets a name, as a graphing calculator would: the kernel's suggestion, else a free letter
      const named = r.error.suggest?.[0] ?? `${freeName(session)} = ${text}`;
      text = named;
      r = session.submit(text);
    }
    if (!r.ok) return showError(parts, input, r.error);
    opts.say(r.announcement ?? '');
    if (!parts) {
      const made = lineName(text);
      const id = made ? session.figure.get(made)?.id : undefined;
      if (id !== undefined) {
        cardFor = id as unknown as number;
        update();
      }
      input.value = '';
      newRow.error = undefined;
      newRow.out.replaceChildren();
      newRow.row.classList.remove('bad');
    }
  };

  const showError = (parts: RowParts | undefined, input: HTMLInputElement, e: ErrorObject): void => {
    const p = parts ?? newRow;
    p.error = e;
    p.row.classList.add('bad');
    const box = el('div', 'err');
    box.append(el('span', 'err-msg', e.message));
    if (e.hint) box.append(el('span', 'err-hint', e.hint));
    // a missing name becomes a slider in one click, then the line runs (design 3.10, no dialog)
    if (e.kind === 'unknown_name' && e.token && /^[A-Za-z]\w*$/.test(e.token)) {
      const name = e.token;
      const chip = el('button', 'err-fix', `Make slider ${name}`);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        const r = session.applyLines([`${name} = 1 in -5..5 step 0.1`, input.value.trim()], `Slider ${name}`, 'atomic');
        if (!r.ok) return showError(parts, input, r.error);
        opts.say(`Made slider ${name}.`);
        if (!parts) {
          input.value = '';
          newRow.error = undefined;
          newRow.out.replaceChildren();
          newRow.row.classList.remove('bad');
        }
      });
      box.append(chip);
    }
    const fixes = (e.suggest ?? []).filter((x) => !(e.kind === 'unknown_name' && x.startsWith(`${e.token} =`))).slice(0, 2);
    for (const s of fixes) {
      const b = el('button', 'err-fix', `Use: ${s}`);
      b.type = 'button';
      b.addEventListener('click', () => {
        input.value = s;
        commit(parts, input, parts ? lineName(parts.shown) : undefined);
      });
      box.append(b);
    }
    p.out.replaceChildren(box);
    opts.say(e.message);
    input.focus();
  };

  const remove = (name: string): void => {
    const r = session.delete(name);
    if (!r.ok) opts.say(r.error.message);
  };

  const keys = (parts: RowParts | undefined, input: HTMLInputElement) => (e: KeyboardEvent): void => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (!sig.hidden) {
        // another form of the command in the signature box
        sigShift += e.key === 'ArrowDown' ? 1 : -1;
        showCompletions(input);
      } else if (!parts && history.length > 0) {
        // the history of lines typed here (design 3.11)
        historyAt = Math.max(-1, Math.min(history.length - 1, historyAt + (e.key === 'ArrowUp' ? 1 : -1)));
        input.value = historyAt < 0 ? '' : (history[historyAt] as string);
        input.setSelectionRange(input.value.length, input.value.length);
      }
      return;
    }
    if (e.key === 'F2' && parts) {
      // rename: select the name so typing replaces it (design 3.8)
      e.preventDefault();
      const name = lineName(input.value);
      if (name) input.setSelectionRange(input.value.indexOf(name), input.value.indexOf(name) + name.length);
      return;
    }
    if (!pop.hidden && popFor === input) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pick = (pick + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        [...pop.children].forEach((li, i) => li.classList.toggle('on', i === pick));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && items.length > 0 && !e.shiftKey && (input.selectionStart ?? 0) === input.value.length && /[A-Za-z_]\w*$/.test(input.value))) {
        e.preventDefault();
        accept(input, pick);
        return;
      }
      if (e.key === 'Escape') {
        closePop();
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      closePop();
      commit(parts, input, parts ? lineName(parts.shown) : undefined);
      if (!parts && !newRow.error) newRow.input.focus();
      return;
    }
    if (e.key === 'Escape' && parts) {
      input.value = parts.shown;
      parts.error = undefined;
      parts.row.classList.remove('bad');
      update();
      input.blur();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && pop.hidden) {
      const inputs = [...element.querySelectorAll<HTMLInputElement>('.expr-input')];
      const i = inputs.indexOf(input);
      const next = inputs[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
    if (e.key === 'Backspace' && input.value === '' && parts) {
      e.preventDefault();
      const name = lineName(parts.shown);
      if (name) remove(name);
      newRow.input.focus();
    }
  };

  const makeRow = (isNew: boolean): RowParts => {
    const row = el('div', isNew ? 'expr expr-new' : 'expr');
    row.setAttribute('role', 'listitem');
    const tab = el('div', 'expr-tab');
    const index = el('span', 'expr-index');
    const swatch = el('button', 'swatch');
    swatch.type = 'button';
    const toggle = el('button', 'expr-toggle', '▸');
    toggle.type = 'button';
    toggle.hidden = true;
    tab.append(index, swatch, toggle);
    const main = el('div', 'expr-main');
    const display = el('div', 'expr-display');
    display.hidden = isNew;
    const input = el('input', 'expr-input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('aria-label', isNew ? 'New expression' : 'Expression');
    if (isNew) input.placeholder = 'Type an expression, e.g.  data = [4, 7, 8, 9]';
    const out = el('div', 'expr-out');
    out.setAttribute('aria-live', 'polite');
    const deps = el('div', 'expr-deps');
    deps.hidden = true;
    const card = el('div', 'expr-card');
    card.hidden = true;
    main.append(display, input, out, deps, card);
    // the maths text shows until the row is edited (algebra-view ui.md 2)
    display.addEventListener('click', () => {
      row.classList.add('editing');
      input.focus();
    });
    const del = el('button', 'expr-del', '×');
    del.type = 'button';
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete expression');
    row.append(tab, main, del);
    // a click on the row selects its object (design 3.9); Shift or Ctrl/Cmd adds to the selection. The marble, the
    // delete button and the expand arrow keep their own jobs.
    row.addEventListener('pointerdown', (e) => {
      const sel = opts.selection ? selectionFrom(opts.selection, 'list') : undefined;
      const name = row.dataset['name'];
      if (!sel || !name || isNew) return;
      const t = e.target as HTMLElement;
      if (t === swatch || t === del || t === toggle) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        // Shift would also select the row's text: the click is a pick, not a text selection
        e.preventDefault();
        sel.toggle(name);
      }
      else if (!sel.has(name) || sel.names().length > 1) sel.set(name);
      markSelection();
    });
    row.addEventListener('pointerenter', () => {
      const name = row.dataset['name'];
      if (opts.selection && name && !isNew) selectionFrom(opts.selection, 'list').setHover(name);
    });
    row.addEventListener('pointerleave', () => {
      const name = row.dataset['name'];
      if (opts.selection && name && opts.selection.hover() === name) selectionFrom(opts.selection, 'list').setHover(undefined);
    });
    const parts: RowParts = { row, swatch, index, input, out, del, display, deps, toggle, card, shown: '', error: undefined };
    toggle.addEventListener('click', () => {
      const id = [...rows].find(([, p]) => p === parts)?.[0];
      if (id === undefined) return;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      update();
    });
    input.addEventListener('keydown', keys(isNew ? undefined : parts, input));
    input.addEventListener('input', () => showCompletions(input));
    input.addEventListener('focus', () => row.classList.add('focus', 'editing'));
    input.addEventListener('blur', () => {
      row.classList.remove('focus', 'editing');
      window.setTimeout(() => {
        if (popFor === input || document.activeElement !== input) closePop();
      }, 120);
      if (!isNew && input.value.trim() !== parts.shown && !parts.error) commit(parts, input, lineName(parts.shown));
    });
    del.addEventListener('click', () => {
      const name = lineName(parts.shown);
      if (name) remove(name);
    });
    return parts;
  };

  const newRow = makeRow(true);
  newRow.swatch.disabled = true;

  /* ------------------------------ output under a row ------------------------------ */

  const output = (p: RowParts, r: LineRow, value: unknown): void => {
    if (p.error) return;
    const out = p.out;
    out.replaceChildren();
    p.row.classList.remove('bad');
    const m = model.get(r.id);
    if (!r.state.defined) {
      const s = r.state;
      const why = el('div', 'undef');
      why.textContent = `undefined: ${m?.undefinedInfo?.text ?? s.reason.replace(/_/g, ' ')}${s.detail ? ` — ${s.detail}` : ''}`;
      out.append(why);
      return;
    }
    const c = r.control;
    if (c?.kind === 'slider') {
      const wrap = el('div', 'slider');
      const lo = el('span', 'slider-end', fmt(c.min));
      const hi = el('span', 'slider-end', fmt(c.max));
      const range = el('input');
      range.type = 'range';
      range.min = String(c.min);
      range.max = String(c.max);
      range.step = c.step !== undefined ? String(c.step) : String((c.max - c.min) / 1000);
      range.value = String(c.value);
      range.setAttribute('aria-label', `${r.name} slider`);
      range.addEventListener('input', () => session.slide(r.name, Number(range.value), false));
      range.addEventListener('change', () => session.slide(r.name, Number(range.value), true));
      wrap.append(lo, range, hi);
      out.append(wrap);
      return;
    }
    if (c?.kind === 'bool') {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = c.checked;
      box.setAttribute('aria-label', r.name);
      box.addEventListener('change', () => session.setText(r.name, box.checked ? 'true' : 'false'));
      out.append(box);
      return;
    }
    const schema = (value as { schema?: string } | undefined)?.schema;
    if (r.type.startsWith('Record') && (schema === 'Test' || schema === 'ChiSquared' || schema === 'ANOVA')) {
      out.append(testCard(value as { fields: Record<string, unknown> }, colorOf(r.id)));
      return;
    }
    if (r.type.startsWith('Record') && schema === 'Interval') {
      out.append(intervalCard(value as { fields: Record<string, unknown> }, colorOf(r.id)));
      return;
    }
    const v = el('div', 'value');
    // the second row of the display mode (algebra-view design 3.2): only when it adds something
    if (m) v.textContent = m.lines[1] ?? '';
    else v.textContent = r.state.value.startsWith(`${r.name} `) ? r.state.value : `${r.type === 'Function' ? '' : '= '}${r.state.value}`;
    // values the preview cannot print get a plain description instead of "…"
    if (/^= [[\]…,() {}]*(\(\d+ items\)\])?$/.test(v.textContent) || v.textContent === '= …' || v.textContent === '= [object Object]') v.textContent = describe(r.type, value);
    if (m?.approx && v.textContent) v.title = 'rounded';
    // a text with $…$ parts is typeset (text-logic design 6)
    const typeset = r.type === 'Text' && typeof value === 'string' ? mathElement(value) : undefined;
    if (typeset) {
      v.replaceChildren(document.createTextNode('= '), typeset);
      v.classList.add('typeset');
    }
    if (v.textContent || typeset) out.append(v);
    if (r.free && r.type === 'Number' && !c) {
      const n = Number(value);
      const add = el('button', 'chip', '+ slider');
      add.type = 'button';
      add.title = 'Make this number a slider';
      add.addEventListener('click', () => {
        // the range form keeps the value (design 3.10): 3 gives 0..10 step 0.1
        const g = niceRange(n);
        session.submit(`${r.name} in ${valueText(g.min)}..${valueText(g.max)} step ${valueText(g.step)}`);
      });
      out.append(add);
    }
  };

  /* ------------------------------ update ------------------------------ */

  /** The header of a group (type, dependency or layer sort), collapsible. */
  const groupHead = (key: string, label: string, count: number): HTMLElement => {
    let h = groupHeads.get(key);
    if (!h) {
      h = el('button', 'expr-group');
      (h as HTMLButtonElement).type = 'button';
      h.addEventListener('click', () => {
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        update();
      });
      groupHeads.set(key, h);
    }
    h.textContent = `${collapsed.has(key) ? '▸' : '▾'} ${label} · ${count}`;
    h.setAttribute('aria-expanded', String(!collapsed.has(key)));
    return h;
  };

  /** "Made from", "used by" and the undefined chain (design 3.7). Names are links to their rows. */
  const fillDeps = (p: RowParts, m: AlgebraRow): void => {
    p.deps.replaceChildren();
    const link = (name: string): HTMLButtonElement => {
      const b = el('button', 'dep-link', name);
      b.type = 'button';
      b.addEventListener('click', () => api.flash([name]));
      return b;
    };
    const line = (label: string, names: readonly string[]): void => {
      if (names.length === 0) return;
      const d = el('div', 'dep-line');
      d.append(el('span', 'dep-label', label), ...names.map(link));
      p.deps.append(d);
    };
    line('made from', m.madeFrom);
    line('used by', m.usedBy);
    if (m.undefinedInfo && m.undefinedInfo.chain.length > 0) {
      const d = el('div', 'dep-line dep-chain');
      d.append(el('span', 'dep-label', 'undefined because'), document.createTextNode(m.undefinedInfo.chain.join(' ← ')));
      p.deps.append(d);
    }
    if (m.descriptionText) p.deps.append(el('div', 'dep-line dep-desc', m.descriptionText));
  };

  /*
   * The list is virtualised (design 3.16): only the rows in view, plus OVERSCAN above and below, are in the page.
   * Gaps are spacers of the rows' heights (measured once seen, estimated before). A row is filled again only when its
   * model row, its source or its state changed, so a slider drag touches the rows that move, not all of them.
   */
  const OVERSCAN = 10;
  const ROW_GUESS = 58;
  const HEAD_GUESS = 30;
  type Entry = { readonly kind: 'head'; readonly key: string; readonly label: string; readonly count: number } | { readonly kind: 'row'; readonly id: number; readonly index: number };
  let entries: Entry[] = [];
  const heights = new Map<string | number, number>();
  // rows by id, headers by their group key: no string is built per row on a scroll or an update
  const keyOf = (e: Entry): string | number => (e.kind === 'head' ? `h:${e.key}` : e.id);
  const cache = new AlgebraCache();
  let objs: AlgebraObject[] = [];
  let lastDirectives = -1;
  let lastFigure: unknown;
  let lastStructure = -1;
  let lastSettings = -1;
  /** Goes up on every update; `fullEpoch` is the last full one. A row read at an older epoch is read again. */
  let valueEpoch = 0;
  let fullEpoch = 0;
  const seenAt = new Map<number, number>();
  let lastPrefs: { user: AlgebraPrefs; out: AlgebraPrefs } | undefined;
  let settingsVersion = 0;
  /** What each shown row was last filled from, to skip rows that did not change. */
  const filled = new Map<number, string>();
  const filledFrom = new Map<number, AlgebraRow>();
  const filledQuick = new Map<number, string>();
  const spacers: HTMLElement[] = [];
  const spacer = (i: number, h: number): HTMLElement => {
    let s = spacers[i];
    if (!s) {
      s = el('div', 'expr-spacer');
      s.setAttribute('aria-hidden', 'true');
      spacers[i] = s;
    }
    s.style.height = `${h}px`;
    return s;
  };

  /** Fills a row's parts from its model row and session row; skipped when nothing it shows has changed. */
  const fill = (p: RowParts, id: number, index: number, m: AlgebraRow): void => {
    // the model row is reused while nothing it shows changed: then only a moving slider knob can need setting
    const quick = `${settingsVersion}|${index}|${expanded.has(id)}|${prefs.input.kind}|${cardFor === id}|${m.usedBy.length}`;
    if (filledFrom.get(id) === m && filledQuick.get(id) === quick && !p.error) return;
    filledFrom.set(id, m);
    filledQuick.set(id, quick);
    const off = m.visible === false;
    const hasDeps = m.madeFrom.length > 0 || m.usedBy.length > 0 || m.undefinedInfo !== null;
    const open = expanded.has(id) && hasDeps;
    const editing = document.activeElement === p.input && p.input.value !== p.shown;
    const r = session.row(id);
    if (!r) return;
    const control = r.control?.kind === 'slider' ? { ...r.control, value: 0 } : r.control;
    const stamp = `${settingsVersion}|${index}|${off}|${open}|${prefs.input.kind}|${cardFor === id}|${r.source}|${JSON.stringify(r.state)}|${JSON.stringify(control)}|${m.lines[0]}|${m.lines[1]}|${m.madeFrom.join(',')}|${m.usedBy.join(',')}`;
    if (filled.get(id) === stamp && !p.error) {
      // a slider that only moved: set its knob, keep the element (so a drag in progress is not cut)
      if (r.control?.kind === 'slider') {
        const range = p.out.querySelector<HTMLInputElement>('input[type="range"]');
        if (range && Number(range.value) !== r.control.value) range.value = String(r.control.value);
      }
      return;
    }
    filled.set(id, stamp);
    const value = session.figure.value(r.name);
    const drawn = drawsOnGraph(r.type, r.type, value);
    const color = colorOf(id);
    p.index.textContent = String(index + 1);
    p.swatch.hidden = !drawn;
    p.swatch.style.setProperty('--c', color);
    p.swatch.classList.toggle('off', off);
    p.swatch.setAttribute('aria-pressed', String(!off));
    p.swatch.title = off ? `Show ${r.name}` : `Hide ${r.name}`;
    p.swatch.setAttribute('aria-label', p.swatch.title);
    p.swatch.onclick = () => {
      // the marble writes a restyle line, so it is undoable and saved (design 3.9)
      const res = session.applyLines([`${r.name} with visible = ${off ? 'true' : 'false'}`], off ? `Show ${r.name}` : `Hide ${r.name}`, 'atomic');
      if (!res.ok) opts.say(res.error.message);
      opts.changed();
    };
    p.display.textContent = m.lines[0];
    p.display.title = m.descriptionText;
    p.display.classList.toggle('desc', prefs.mode === 'description');
    p.toggle.hidden = !hasDeps;
    p.toggle.textContent = open ? '▾' : '▸';
    p.toggle.setAttribute('aria-expanded', String(open));
    p.toggle.setAttribute('aria-label', open ? `Hide what ${r.name} is made from` : `Show what ${r.name} is made from`);
    p.deps.hidden = !open;
    if (open) fillDeps(p, m);
    // a next-step card under a row just added (design 3.13), once per object
    if (cardFor === id && !offered.has(id)) {
      offered.add(id);
      cardFor = undefined;
      const view = opts.view?.() ?? { x0: -10, x1: 10 };
      const [sug] = suggestionsFor(m, objs, view, freeOf(new Set()));
      p.card.replaceChildren();
      p.card.hidden = !sug;
      if (sug) {
        const add = el('button', 'card-add', sug.text);
        add.type = 'button';
        add.addEventListener('click', () => {
          p.card.hidden = true;
          const res = session.applyLines(sug.lines, sug.text, 'atomic');
          opts.say(res.ok ? res.message : res.error.message);
        });
        const no = el('button', 'card-close', '×');
        no.type = 'button';
        no.setAttribute('aria-label', 'Dismiss the suggestion');
        no.addEventListener('click', () => {
          p.card.hidden = true;
        });
        p.card.append(el('span', 'card-hint', 'Next step'), add, no);
      }
    }
    p.input.readOnly = prefs.input.kind === 'off';
    p.shown = r.source;
    if (!editing) {
      p.input.value = r.source;
      p.error = undefined;
    }
    p.row.dataset['name'] = r.name;
    p.row.title = r.type;
    output(p, r, value);
  };

  /** Puts the rows in view (and the focused row) in the page, with spacers for the rest. */
  const render = (): void => {
    const view = element.clientHeight || 800;
    const top = element.scrollTop;
    const focusedId = [...rows].find(([, p]) => document.activeElement === p.input)?.[0];
    // the window: entries that overlap the view, widened by OVERSCAN
    let y = 0;
    let first = -1;
    let last = -1;
    const at: number[] = [];
    entries.forEach((e, i) => {
      at.push(y);
      const h = heights.get(keyOf(e)) ?? (e.kind === 'head' ? HEAD_GUESS : ROW_GUESS);
      if (first < 0 && y + h > top) first = i;
      if (y < top + view) last = i;
      y += h;
    });
    const total = y;
    if (first < 0) first = Math.max(0, entries.length - 1);
    const lo = Math.max(0, first - OVERSCAN);
    const hi = Math.min(entries.length - 1, last + OVERSCAN);
    const keep: number[] = [];
    entries.forEach((e, i) => {
      if ((i >= lo && i <= hi) || (e.kind === 'row' && e.id === focusedId)) keep.push(i);
    });
    const order: HTMLElement[] = [];
    const shown = new Set<number>();
    let gap = 0;
    let prevEnd = 0;
    for (const i of keep) {
      const e = entries[i] as Entry;
      const start = at[i] as number;
      if (start > prevEnd) order.push(spacer(gap++, start - prevEnd));
      prevEnd = start + (heights.get(keyOf(e)) ?? (e.kind === 'head' ? HEAD_GUESS : ROW_GUESS));
      if (e.kind === 'head') {
        order.push(groupHead(e.key, e.label, e.count));
        continue;
      }
      const m = freshRow(e.id);
      if (!m) continue;
      let p = rows.get(e.id);
      if (!p) {
        p = makeRow(false);
        rows.set(e.id, p);
        filled.delete(e.id);
        filledFrom.delete(e.id);
      }
      fill(p, e.id, e.index, m);
      shown.add(e.id);
      order.push(p.row);
    }
    if (total > prevEnd) order.push(spacer(gap, total - prevEnd));
    // rows out of view leave the page (their parts are made again when scrolled back)
    for (const [id, p] of rows) {
      if (shown.has(id)) continue;
      p.row.remove();
      rows.delete(id);
      filled.delete(id);
      filledFrom.delete(id);
    }
    newRow.row.hidden = prefs.input.kind === 'off';
    order.push(newRow.row);
    // keep the page order without moving a focused row
    order.forEach((node, i) => {
      if (element.children[i] !== node) element.insertBefore(node, element.children[i] ?? null);
    });
    const want = new Set<Node>([...order, pop, sig]);
    for (const c of [...element.children]) if (!want.has(c)) c.remove();
    if (!pop.isConnected) element.append(pop, sig);
    markSelection();
    // measure what is in the page, for the spacers next time (no layout in tests: keep the guesses)
    for (const i of keep) {
      const e = entries[i] as Entry;
      const node = e.kind === 'head' ? groupHeads.get(e.key) : rows.get(e.id)?.row;
      const h = node?.offsetHeight ?? 0;
      if (h > 0) heights.set(keyOf(e), h);
    }
  };

  const update = (): void => {
    // the `@algebra` lines are read again only when a directive or the user's settings changed
    if (session.directiveVersion !== lastDirectives || session.figure !== lastFigure || lastPrefs?.user !== userPrefs) {
      const next = prefsFromScript(session.figure.toScript(), userPrefs);
      if (!lastPrefs || JSON.stringify(next) !== JSON.stringify(lastPrefs.out)) settingsVersion++;
      lastPrefs = { user: userPrefs, out: next };
      lastDirectives = session.directiveVersion;
      lastFigure = session.figure;
    }
    prefs = (lastPrefs as { out: AlgebraPrefs }).out;
    // only values moved (a slider drag, the clock): the rows, their order and their links are the same, so only the
    // rows in view are read again; the others are refreshed when they scroll into view (design 3.16)
    const sameShape = session.structureVersion === lastStructure && settingsVersion === lastSettings && !prefs.filter.onlyUndefined && entries.length > 0;
    if (sameShape) {
      valueEpoch++;
      render();
      return;
    }
    lastStructure = session.structureVersion;
    lastSettings = settingsVersion;
    objs = session.figure.objects() as unknown as AlgebraObject[];
    if (objs.length < cache.rows.size) cache.prune(new Set(objs.map((o) => o.id)));
    const { groups } = algebraRows(objs, prefs, cache);
    model = new Map(groups.flatMap((g) => g.rows).map((r) => [r.id, r]));
    const next: Entry[] = [];
    let index = 0;
    for (const g of groups) {
      if (g.label) next.push({ kind: 'head', key: g.key, label: g.label, count: g.rows.length });
      // a collapsed group shows only its header
      if (g.label && collapsed.has(g.key)) continue;
      for (const r of g.rows) next.push({ kind: 'row', id: r.id, index: index++ });
    }
    entries = next;
    fullEpoch = ++valueEpoch;
    newRow.index.textContent = String(index + 1);
    render();
  };

  /** The model row of an object, read again from the figure when values moved since it was made. */
  const freshRow = (id: number): AlgebraRow | undefined => {
    const m = model.get(id);
    if (valueEpoch === fullEpoch || (seenAt.get(id) ?? -1) >= valueEpoch) return m;
    seenAt.set(id, valueEpoch);
    const o = session.figure.get(id as never) as unknown as AlgebraObject | undefined;
    const r = o ? refreshAlgebraRows([o], prefs, cache)?.[0] : undefined;
    if (r) model.set(id, r);
    return r ?? m;
  };

  /** Scrolls a row into the window and puts it in the page; false when the row is filtered out or collapsed. */
  /** Marks the selected rows and the hovered row (ui.md: accent border, tinted background). */
  function markSelection(): void {
    const sel = opts.selection;
    for (const p of rows.values()) {
      const name = p.row.dataset['name'] ?? '';
      const on = sel?.has(name) === true;
      p.row.classList.toggle('selected', on);
      p.row.setAttribute('aria-selected', String(on));
      p.row.classList.toggle('hovered', sel?.hover() === name);
    }
  }

  // a pick on the canvas scrolls the list to the row (design 3.9)
  opts.selection?.onChange((source) => {
    const sel = opts.selection as Selection;
    if (source === 'canvas' || source === 'tool') {
      const last = sel.names()[sel.names().length - 1];
      const id = last === undefined ? undefined : (session.figure.get(last)?.id as unknown as number | undefined);
      if (id !== undefined) reveal(id);
    }
    markSelection();
  });

  const reveal = (id: number): RowParts | undefined => {
    let y = 0;
    for (const e of entries) {
      if (e.kind === 'row' && e.id === id) {
        const h = heights.get(keyOf(e)) ?? ROW_GUESS;
        const view = element.clientHeight || 800;
        if (y < element.scrollTop || y + h > element.scrollTop + view) element.scrollTop = Math.max(0, y - view / 3);
        render();
        return rows.get(id);
      }
      y += heights.get(keyOf(e)) ?? (e.kind === 'head' ? HEAD_GUESS : ROW_GUESS);
    }
    return undefined;
  };
  element.addEventListener('scroll', () => render(), { passive: true });

  /* ------------------------------ header ------------------------------ */

  const header = el('div', 'expr-head');
  const filter = el('input', 'expr-filter');
  filter.type = 'search';
  filter.placeholder = 'Filter';
  filter.setAttribute('aria-label', 'Filter the expressions by name, definition or type');
  filter.addEventListener('input', () => api.setPrefs({ filter: { ...userPrefs.filter, text: filter.value } }));
  const gear = el('button', 'icon-btn expr-gear', '⚙');
  gear.type = 'button';
  gear.title = 'Display settings';
  gear.setAttribute('aria-label', 'Display settings');
  gear.setAttribute('aria-haspopup', 'true');
  const menu = el('div', 'expr-menu');
  menu.hidden = true;
  const sel = (label: string, options: readonly (readonly [string, string])[], value: () => string, on: (v: string) => void): HTMLLabelElement => {
    const l = el('label', 'menu-field');
    const s2 = el('select');
    for (const [v, t] of options) {
      const o = el('option', '', t);
      o.value = v;
      s2.append(o);
    }
    s2.value = value();
    s2.addEventListener('change', () => on(s2.value));
    l.append(el('span', '', label), s2);
    return l;
  };
  const chk = (label: string, value: () => boolean, on: (v: boolean) => void): HTMLLabelElement => {
    const l = el('label', 'menu-check');
    const i = el('input');
    i.type = 'checkbox';
    i.checked = value();
    i.addEventListener('change', () => on(i.checked));
    l.append(i, document.createTextNode(` ${label}`));
    return l;
  };
  const renderMenu = (): void => {
    menu.replaceChildren(
      sel('Show', [['definitionAndValue', 'Definition and value'], ['definition', 'Definition'], ['value', 'Value'], ['description', 'Description']], () => prefs.mode, (v) => api.setPrefs({ mode: v as DisplayMode })),
      sel('Sort by', [['creation', 'Order made'], ['type', 'Type'], ['dependency', 'Dependency'], ['name', 'Name'], ['layer', 'Layer']], () => prefs.sort, (v) => api.setPrefs({ sort: v as AlgebraPrefs['sort'] })),
      sel('Rounding', [0, 1, 2, 3, 4, 5, 6, 8, 10].map((d) => [String(d), `${d} decimal places`] as const), () => String(prefs.format.decimals), (v) => api.setPrefs({ format: { ...userPrefs.format, decimals: Number(v) } })),
      chk('Show helper objects', () => prefs.showAux, (v) => api.setPrefs({ showAux: v })),
      chk('Only undefined', () => prefs.filter.onlyUndefined, (v) => api.setPrefs({ filter: { ...userPrefs.filter, onlyUndefined: v } })),
      chk('Only hidden', () => prefs.filter.onlyHidden, (v) => api.setPrefs({ filter: { ...userPrefs.filter, onlyHidden: v } })),
    );
  };
  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    renderMenu();
    menu.hidden = !menu.hidden;
    gear.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== gear) menu.hidden = true;
  });
  header.append(filter, gear, menu);

  const api: ExpressionList = {
    element,
    header,
    update,
    colorOf,
    prefs: () => prefs,
    setPrefs(patch) {
      userPrefs = { ...userPrefs, ...patch };
      update();
      opts.changed();
    },
    isHidden: (id) => hidden.has(id) || session.figure.get(id as never)?.style.visible === false,
    focusNew(text) {
      if (text !== undefined) newRow.input.value = text;
      newRow.input.focus();
    },
    flash(names) {
      // the last row may be out of the window: scroll it in, so its parts are in the page
      const lastName = names[names.length - 1];
      const lastId = lastName === undefined ? undefined : (session.figure.get(lastName)?.id as unknown as number | undefined);
      if (lastId !== undefined) reveal(lastId);
      const want = new Set(names);
      const found = [...element.querySelectorAll<HTMLElement>('.expr')].filter((r) => want.has(r.dataset['name'] ?? ''));
      for (const r of found) r.classList.add('flash');
      found[found.length - 1]?.scrollIntoView?.({ block: 'nearest' });
      setTimeout(() => found.forEach((r) => r.classList.remove('flash')), 2000);
    },
  };
  update();
  return api;
}

/** A short description of a value the text preview cannot print: a region, a curve, a list of shapes. */
function describe(type: string, value: unknown): string {
  const o = value as Record<string, unknown> | undefined;
  if (o && o['kind'] === 'region') return `region, area ${fmt(o['area'])}`;
  if (o && o['kind'] === 'curve') return typeof o['text'] === 'string' ? (o['text'] as string) : 'curve';
  if (Array.isArray(value)) return `${type}, ${value.length} item${value.length === 1 ? '' : 's'}`;
  return type;
}

/* ------------------------------ result cards (statistics ui.md 5) ------------------------------ */

const TAILS: Readonly<Record<string, string>> = { two: 'two-tailed', left: 'left-tailed', right: 'right-tailed' };

function testCard(rec: { fields: Record<string, unknown> }, color: string): HTMLElement {
  const F = rec.fields;
  const card = el('div', 'card');
  const name = String(F['test'] ?? (F['F'] !== undefined ? 'ANOVA' : 'Test'));
  const tail = String(F['tail'] ?? 'right');
  card.append(el('div', 'card-title', `${name}${F['tail'] ? ` · ${TAILS[tail] ?? tail}` : ''}`));
  const sym = F['F'] !== undefined ? 'F' : name.startsWith('Z') ? 'z' : name.startsWith('Chi') ? 'χ²' : 't';
  const stat = (F['statistic'] ?? F['F']) as number;
  const grid = el('div', 'card-grid');
  const cell = (k: string, v: unknown): void => {
    if (v === undefined) return;
    grid.append(el('span', 'k', k), el('span', 'v', fmt(v)));
  };
  cell(sym, stat);
  cell('df', F['df'] ?? (F['dfBetween'] !== undefined ? `${fmt(F['dfBetween'])}, ${fmt(F['dfWithin'])}` : undefined));
  cell('p', F['p']);
  cell('estimate', F['estimate']);
  cell('se', F['se']);
  cell('n', F['n']);
  card.append(grid);
  const d = F['dist'] as { spec?: { pdf: (p: readonly number[], x: number) => number; discrete: boolean }; params?: readonly number[] } | undefined;
  if (d?.spec && typeof stat === 'number') card.append(miniCurve(d as never, stat, tail, color));
  return card;
}

function intervalCard(rec: { fields: Record<string, unknown> }, color: string): HTMLElement {
  const F = rec.fields;
  const card = el('div', 'card');
  card.append(el('div', 'card-title', `${String(F['test'])} · ${fmt((F['level'] as number) * 100)} %`));
  const grid = el('div', 'card-grid');
  grid.append(el('span', 'k', 'interval'), el('span', 'v wide', `[${fmt(F['lo'])}, ${fmt(F['hi'])}]`));
  grid.append(el('span', 'k', 'estimate'), el('span', 'v', fmt(F['estimate'])));
  grid.append(el('span', 'k', 'margin'), el('span', 'v', fmt(F['margin'])));
  card.append(grid, miniInterval(F['lo'] as number, F['hi'] as number, F['estimate'] as number, color));
  return card;
}
