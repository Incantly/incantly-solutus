/**
 * The expression list: one row per figure line, the way a graphing calculator shows them. Each row has a colour swatch
 * (click to hide or show the object), the line as editable text, and under it the value, a slider, a result card or
 * the reason it failed. The last row is empty: type there to add a line. Rows are keyed by object id and updated in
 * place, so typing is never interrupted by a repaint.
 */
import { complete, signatureHelp, valueText } from '@incantly/kernel';
import type { Completion, ErrorObject, FigureView } from '@incantly/kernel';
import type { LineRow } from '@incantly/ui';
import { colorAt } from './graph/paint';
import { miniCurve, miniInterval } from './mini';
import type { KernelSession } from './session';

/** Types that draw on the graph and so get a swatch. */
const DRAWN = new Set(['Point', 'Vector', 'Segment', 'Line', 'Ray', 'Circle', 'Arc', 'Sector', 'Conic', 'Polyline', 'Polygon', 'Function', 'Curve', 'Relation', 'Region', 'Field', 'Chart', 'ContinuousDistribution', 'DiscreteDistribution']);

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
}

export interface ExpressionOptions {
  readonly session: KernelSession;
  /** Called when visibility changes, so the graph repaints. */
  readonly changed: () => void;
  /** Status messages for the screen reader and the footer. */
  readonly say: (text: string) => void;
}

interface RowParts {
  readonly row: HTMLElement;
  readonly swatch: HTMLButtonElement;
  readonly index: HTMLElement;
  readonly input: HTMLInputElement;
  readonly out: HTMLElement;
  readonly del: HTMLButtonElement;
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
      const h = help as unknown as { forms?: readonly { text?: string; active?: boolean; matches?: boolean }[] };
      const forms = [...(h.forms ?? [])].sort((a, b) => Number(b.active ?? false) - Number(a.active ?? false) || Number(b.matches ?? false) - Number(a.matches ?? false));
      const lines = forms.map((f) => f.text ?? '').filter(Boolean);
      sig.textContent = lines.slice(0, 3).join('\n');
      sig.hidden = lines.length === 0;
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
    const fixes = (e.suggest ?? []).slice(0, 2);
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
    tab.append(index, swatch);
    const main = el('div', 'expr-main');
    const input = el('input', 'expr-input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('aria-label', isNew ? 'New expression' : 'Expression');
    if (isNew) input.placeholder = 'Type an expression, e.g.  data = [4, 7, 8, 9]';
    const out = el('div', 'expr-out');
    out.setAttribute('aria-live', 'polite');
    main.append(input, out);
    const del = el('button', 'expr-del', '×');
    del.type = 'button';
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete expression');
    row.append(tab, main, del);
    const parts: RowParts = { row, swatch, index, input, out, del, shown: '', error: undefined };
    input.addEventListener('keydown', keys(isNew ? undefined : parts, input));
    input.addEventListener('input', () => showCompletions(input));
    input.addEventListener('focus', () => row.classList.add('focus'));
    input.addEventListener('blur', () => {
      row.classList.remove('focus');
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
    if (!r.state.defined) {
      const s = r.state;
      const why = el('div', 'undef');
      why.textContent = `undefined: ${s.reason.replace(/_/g, ' ')}${s.detail ? ` — ${s.detail}` : ''}`;
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
    v.textContent = r.state.value.startsWith(`${r.name} `) ? r.state.value : `${r.type === 'Function' ? '' : '= '}${r.state.value}`;
    if (r.type === 'Function') v.textContent = '';
    // values the preview cannot print get a plain description instead of "…"
    if (/^= [[\]…,() ]*(\(\d+ items\)\])?$/.test(v.textContent) || v.textContent === '= …') v.textContent = describe(r.type, value);
    out.append(v);
    if (r.free && r.type === 'Number' && !c) {
      const n = Number(value);
      const add = el('button', 'chip', '+ slider');
      add.type = 'button';
      add.title = 'Make this number a slider';
      add.addEventListener('click', () => {
        const span = Math.max(10, Math.abs(n) * 2);
        session.submit(`${r.name} = ${valueText(n)} in ${valueText(Math.floor(n - span))}..${valueText(Math.ceil(n + span))}`);
      });
      out.append(add);
    }
  };

  /* ------------------------------ update ------------------------------ */

  const update = (): void => {
    const list = session.rows();
    const seen = new Set<number>();
    const order: HTMLElement[] = [];
    list.forEach((r, i) => {
      seen.add(r.id);
      let p = rows.get(r.id);
      if (!p) {
        p = makeRow(false);
        rows.set(r.id, p);
      }
      const value = session.figure.value(r.name);
      const drawn = drawsOnGraph(r.type, r.type, value);
      const color = colorOf(r.id);
      p.index.textContent = String(i + 1);
      p.swatch.hidden = !drawn;
      p.swatch.style.setProperty('--c', color);
      p.swatch.classList.toggle('off', hidden.has(r.id));
      p.swatch.setAttribute('aria-pressed', String(!hidden.has(r.id)));
      p.swatch.title = hidden.has(r.id) ? `Show ${r.name}` : `Hide ${r.name}`;
      p.swatch.setAttribute('aria-label', p.swatch.title);
      p.swatch.onclick = () => {
        if (hidden.has(r.id)) hidden.delete(r.id);
        else hidden.add(r.id);
        update();
        opts.changed();
      };
      const editing = document.activeElement === p.input && p.input.value !== p.shown;
      p.shown = r.source;
      if (!editing) {
        p.input.value = r.source;
        p.error = undefined;
      }
      p.row.dataset['name'] = r.name;
      p.row.title = r.type;
      output(p, r, value);
      order.push(p.row);
    });
    for (const [id, p] of rows) {
      if (!seen.has(id)) {
        p.row.remove();
        rows.delete(id);
        hidden.delete(id);
      }
    }
    newRow.index.textContent = String(list.length + 1);
    order.push(newRow.row);
    // keep the DOM order without moving a focused row
    order.forEach((node, i) => {
      if (element.children[i] !== node) element.insertBefore(node, element.children[i] ?? null);
    });
    if (!pop.isConnected) element.append(pop, sig);
  };

  update();

  return {
    element,
    update,
    colorOf,
    isHidden: (id) => hidden.has(id),
    focusNew(text) {
      if (text !== undefined) newRow.input.value = text;
      newRow.input.focus();
    },
    flash(names) {
      const want = new Set(names);
      const rows = [...element.querySelectorAll<HTMLElement>('.expr')].filter((r) => want.has(r.dataset['name'] ?? ''));
      for (const r of rows) r.classList.add('flash');
      rows[rows.length - 1]?.scrollIntoView?.({ block: 'nearest' });
      setTimeout(() => rows.forEach((r) => r.classList.remove('flash')), 2000);
    },
  };
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
