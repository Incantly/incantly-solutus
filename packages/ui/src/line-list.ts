/**
 * `<incantly-line-list>`: the list of accepted lines (docs/features/algebra-view/ui.md sections 2, 10 and 11, reduced to what
 * the language alone can fill). Each row shows the definition, its type and its value; an undefined value shows the reason
 * in words and the chain of undefined inputs behind it. The host builds the rows; this element draws them.
 */
import { emit, h, styleEl } from './dom';
import { LIST_CSS, THEME_CSS } from './styles';
import { reasonText, speak, typeset } from './text';

/** One undefined object in a cascade: the object and why it is undefined. */
export interface CauseLink {
  readonly name: string;
  readonly reason: string;
  readonly detail?: string;
}

export type RowState =
  | { readonly defined: true; readonly value: string }
  /** `cause` lists the nearest undefined input first and ends at the root. */
  | { readonly defined: false; readonly reason: string; readonly detail?: string; readonly cause: readonly CauseLink[] };

/** A control shown inside a row for a free object: a text field, a checkbox or a slider. */
export type RowControl =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bool'; readonly checked: boolean }
  | { readonly kind: 'slider'; readonly min: number; readonly max: number; readonly step?: number; readonly value: number; readonly text: string }
  // controls (controls-scripting ui.md 1 to 3); a host draws them, this list shows their value text only
  | { readonly kind: 'button'; readonly label: string }
  | { readonly kind: 'choice'; readonly options: readonly string[]; readonly index: number }
  | { readonly kind: 'input'; readonly caption: string; readonly text: string; readonly error?: InputProblem; readonly notice?: string };

/** An input box's error: the message and, when known, the columns of the text it is about (1-based, end exclusive). */
export interface InputProblem {
  readonly message: string;
  readonly col?: number;
  readonly endCol?: number;
}

type FieldControl = Extract<RowControl, { kind: 'text' | 'bool' | 'slider' }>;
const isField = (c: RowControl | undefined): c is FieldControl => c !== undefined && (c.kind === 'text' || c.kind === 'bool' || c.kind === 'slider');

export interface LineRow {
  readonly id: number;
  readonly name: string;
  /** Type in words, such as `Point` or `Function<Number>`. */
  readonly type: string;
  /** The definition as the learner typed it. */
  readonly source: string;
  readonly state: RowState;
  readonly warnings?: readonly string[];
  /** A free object (it has a value of its own). */
  readonly free?: boolean;
  /** A pinned (`fixed`) object: its controls are shown but cannot be used. */
  readonly locked?: boolean;
  readonly control?: RowControl;
}

/** `incantly-row-rename` and `incantly-row-delete`. */
export interface RowActionDetail {
  readonly name: string;
}

/** `incantly-row-set`: the text typed into a free object's field, or the checkbox state as `true` or `false`. */
export interface RowSetDetail {
  readonly name: string;
  readonly text: string;
}

/** `incantly-row-slide`: a slider moved. `done` is true on release or when a key press ends. */
export interface RowSlideDetail {
  readonly name: string;
  readonly value: number;
  readonly done: boolean;
}

export interface RowEditDetail {
  readonly name: string;
  readonly source: string;
}

export interface RowInsertDetail {
  readonly text: string;
  /** True for Ctrl+Alt+click: replace the field with the definition. */
  readonly replace: boolean;
}

/** What follows the first `=` of a definition (the whole text when there is none). */
export function rightSide(source: string): string {
  const m = /^[^=]*?=(?!=)\s*(.*)$/s.exec(source);
  return (m ? (m[1] as string) : source).trim();
}

/** The accessible name of a row, in one sentence (algebra-view/ui.md section 11). */
export function rowLabel(row: LineRow): string {
  const type = row.type.replace(/[<>()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const head = `${row.name}, ${type}`;
  if (!row.state.defined) {
    const chain = row.state.cause;
    const why =
      chain.length > 0
        ? `${chain.map((c) => `${c.name} is undefined`).join(' because ')}: ${reasonText((chain[chain.length - 1] as CauseLink).reason)}`
        : reasonText(row.state.reason);
    return `${head}, undefined because ${why}`;
  }
  const rhs = rightSide(row.source);
  const words = speak(rhs);
  return rhs === row.state.value ? `${head}, ${words}` : `${head}, defined as ${words}, value ${speak(row.state.value)}`;
}

interface Entry {
  readonly li: HTMLLIElement;
  readonly def: HTMLElement;
  readonly type: HTMLElement;
  readonly free: HTMLElement;
  readonly pinned: HTMLElement;
  readonly rel: HTMLElement;
  readonly rename: HTMLButtonElement;
  readonly del: HTMLButtonElement;
  readonly ctl: HTMLElement;
  readonly body: HTMLElement;
  /** The control in `ctl`, kept across updates so a drag or an edit in progress keeps its focus. */
  control: { kind: RowControl['kind']; input: HTMLInputElement; name: string } | undefined;
  sig: string;
}

const SLIDE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

export class LineListElement extends HTMLElement {
  private rowData: readonly LineRow[] = [];
  private marked: ReadonlySet<string> = new Set();
  private readonly ul = h('ul', { class: 'lines', role: 'list', 'aria-label': 'Lines' });
  private readonly empty = h('p', { class: 'empty' }, 'No lines yet. Type one below, for example A = (1, 2).');
  private readonly nodes = new Map<number, Entry>();
  private focusId: number | undefined;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.append(styleEl(THEME_CSS + LIST_CSS), this.empty, this.ul);
    this.ul.addEventListener('keydown', (e) => this.onKey(e));
    this.ul.addEventListener('click', (e) => this.onClick(e));
    this.ul.addEventListener('dblclick', (e) => {
      if (e.target instanceof Element && e.target.closest('button, input')) return;
      const row = this.rowOf(e.target);
      if (row) this.edit(row);
    });
    this.ul.addEventListener('focusin', (e) => {
      const row = this.rowOf(e.target);
      if (row) this.focusId = row.id;
    });
  }

  get rows(): readonly LineRow[] {
    return this.rowData;
  }
  set rows(rows: readonly LineRow[]) {
    this.rowData = rows;
    this.render();
  }

  /** Names to mark as related to an error (a text marker as well as a colour). */
  get highlighted(): readonly string[] {
    return [...this.marked];
  }
  set highlighted(names: readonly string[]) {
    this.marked = new Set(names);
    this.render();
  }

  /** Moves focus to a row by name. Returns false when there is none. */
  focusRow(name: string): boolean {
    const row = this.rowData.find((r) => r.name === name);
    const entry = row ? this.nodes.get(row.id) : undefined;
    if (!row || !entry) return false;
    entry.li.focus();
    return true;
  }

  private build(): Entry {
    const def = h('span', { class: 'def' });
    const type = h('span', { class: 'type' });
    const free = h('span', { class: 'chip free' }, 'free');
    const pinned = h('span', { class: 'chip pinned' }, 'pinned');
    const rel = h('span', { class: 'chip rel' }, 'related');
    const rename = h('button', { type: 'button', class: 'act', 'data-act': 'rename' }, 'Rename');
    const del = h('button', { type: 'button', class: 'act', 'data-act': 'delete' }, 'Delete');
    const acts = h('span', { class: 'acts' }, rename, del);
    const ctl = h('div', { class: 'ctl' });
    const body = h('div', { class: 'body' });
    const li = h('li', { class: 'row', role: 'listitem' }, h('div', { class: 'top' }, def, free, pinned, rel, type, acts), ctl, body);
    return { li, def, type, free, pinned, rel, rename, del, ctl, body, control: undefined, sig: '' };
  }

  private render(): void {
    this.empty.hidden = this.rowData.length > 0;
    this.ul.hidden = this.rowData.length === 0;
    const keep = new Set<number>();
    const ordered: HTMLLIElement[] = [];
    const tabStop = this.rowData.find((r) => r.id === this.focusId)?.id ?? this.rowData[0]?.id;
    for (const row of this.rowData) {
      keep.add(row.id);
      const marked = this.marked.has(row.name);
      const sig = JSON.stringify(row) + (marked ? '!' : '');
      let entry = this.nodes.get(row.id);
      if (!entry) {
        entry = this.build();
        this.nodes.set(row.id, entry);
      }
      if (entry.sig !== sig) {
        this.fill(entry, row, marked);
        entry.sig = sig;
      }
      this.setStop(entry, row.id === tabStop);
      ordered.push(entry.li);
    }
    for (const [id, entry] of this.nodes) {
      if (!keep.has(id)) {
        entry.li.remove();
        this.nodes.delete(id);
      }
    }
    this.ul.replaceChildren(...ordered);
  }

  /** The row is the one tab stop of the list; its own buttons and fields join it only while it is. */
  private setStop(entry: Entry, on: boolean): void {
    entry.li.tabIndex = on ? 0 : -1;
    for (const c of entry.li.querySelectorAll<HTMLElement>('button.act, input.control')) c.tabIndex = on ? 0 : -1;
  }

  private fill(entry: Entry, row: LineRow, marked: boolean): void {
    const li = entry.li;
    li.dataset['id'] = String(row.id);
    li.dataset['name'] = row.name;
    li.classList.toggle('marked', marked);
    li.setAttribute('aria-label', rowLabel(row) + (row.free ? ', free' : '') + (row.locked ? ', pinned' : '') + (marked ? ', related to the error' : ''));
    entry.def.textContent = typeset(row.source);
    entry.type.textContent = row.type;
    entry.free.hidden = !row.free;
    entry.pinned.hidden = !row.locked;
    entry.rel.hidden = !marked;
    entry.rename.setAttribute('aria-label', `Rename ${row.name}`);
    entry.del.setAttribute('aria-label', `Delete ${row.name}`);
    entry.rename.title = 'Rename (F2)';
    entry.del.title = 'Delete (Delete key)';
    this.fillControl(entry, row);
    const kids: Node[] = [];
    const st = row.state;
    if (st.defined) {
      if (rightSide(row.source) !== st.value && st.value !== '' && row.control === undefined) kids.push(h('div', { class: 'value' }, `= ${typeset(st.value)}`));
    } else {
      const why = st.cause.length > 0 ? reasonText('input_undefined') : st.detail ?? reasonText(st.reason);
      kids.push(h('div', { class: 'undef' }, h('span', { class: 'dash' }, '—  '), h('span', { class: 'why' }, `undefined: ${why}`)));
      if (st.cause.length > 0) {
        const ol = h('ol', { class: 'cause', 'aria-label': 'Because' });
        for (const c of st.cause) {
          const btn = h('button', { type: 'button', 'data-goto': c.name, 'aria-label': `Go to ${c.name}` }, c.name);
          ol.append(h('li', {}, btn, ` is undefined: ${c.detail ?? reasonText(c.reason)}`));
        }
        kids.push(ol);
      }
    }
    for (const w of row.warnings ?? []) kids.push(h('div', { class: 'warn' }, w));
    entry.body.replaceChildren(...kids);
  }

  /** Updates the row's field, checkbox or slider in place; a control that has focus keeps what the person is typing. */
  private fillControl(entry: Entry, row: LineRow): void {
    const c = isField(row.control) ? row.control : undefined;
    if (c === undefined) {
      entry.control = undefined;
      entry.ctl.replaceChildren();
      entry.ctl.hidden = true;
      return;
    }
    entry.ctl.hidden = false;
    if (entry.control === undefined || entry.control.kind !== c.kind || entry.control.name !== row.name) {
      const input =
        c.kind === 'text'
          ? h('input', { type: 'text', class: 'control', spellcheck: 'false', autocomplete: 'off', inputmode: 'text' })
          : c.kind === 'bool'
            ? h('input', { type: 'checkbox', class: 'control' })
            : h('input', { type: 'range', class: 'control' });
      entry.control = { kind: c.kind, input, name: row.name };
      const label = h('label', {}, h('span', { class: 'lbl' }, c.kind === 'slider' ? 'slider' : 'value'), input);
      entry.ctl.replaceChildren(label);
      this.wire(input, row.name, c.kind);
    }
    const input = entry.control.input;
    input.setAttribute('aria-label', c.kind === 'slider' ? `${row.name}, slider` : c.kind === 'bool' ? `${row.name}, on or off` : `Value of ${row.name}`);
    input.disabled = row.locked === true;
    const editing = input.isConnected && this.shadowRoot?.activeElement === input;
    if (c.kind === 'text') {
      if (!editing) input.value = c.text;
    } else if (c.kind === 'bool') {
      input.checked = c.checked;
    } else {
      input.min = String(c.min);
      input.max = String(c.max);
      input.step = c.step === undefined ? 'any' : String(c.step);
      input.value = String(c.value);
      input.setAttribute('aria-valuetext', c.text);
      const lbl = entry.ctl.querySelector('.lbl');
      if (lbl) lbl.textContent = c.text;
    }
  }

  private wire(input: HTMLInputElement, name: string, kind: RowControl['kind']): void {
    if (kind === 'text') {
      let original = '';
      input.addEventListener('focus', () => (original = input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          original = input.value;
          emit<RowSetDetail>(this, 'incantly-row-set', { name, text: input.value });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          input.value = original;
          input.closest('li')?.focus();
        }
      });
      input.addEventListener('blur', () => {
        if (input.value !== original) {
          original = input.value;
          emit<RowSetDetail>(this, 'incantly-row-set', { name, text: input.value });
        }
      });
    } else if (kind === 'bool') {
      input.addEventListener('change', () => emit<RowSetDetail>(this, 'incantly-row-set', { name, text: input.checked ? 'true' : 'false' }));
    } else {
      input.addEventListener('input', () => emit<RowSlideDetail>(this, 'incantly-row-slide', { name, value: Number(input.value), done: false }));
      input.addEventListener('change', () => emit<RowSlideDetail>(this, 'incantly-row-slide', { name, value: Number(input.value), done: true }));
      input.addEventListener('keydown', (e) => {
        // Shift with an arrow key moves ten steps (the browser moves one)
        if (!e.shiftKey || !SLIDE_KEYS.includes(e.key)) return;
        e.preventDefault();
        const step = Number(input.step) > 0 ? Number(input.step) : (Number(input.max) - Number(input.min)) / 100;
        const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1;
        const next = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value) + dir * 10 * step));
        input.value = String(next);
        emit<RowSlideDetail>(this, 'incantly-row-slide', { name, value: Number(input.value), done: true });
      });
    }
  }

  private rowOf(target: EventTarget | null): LineRow | undefined {
    const li = target instanceof Element ? target.closest('li.row') : null;
    const id = li instanceof HTMLElement ? Number(li.dataset['id']) : NaN;
    return this.rowData.find((r) => r.id === id);
  }

  private edit(row: LineRow): void {
    emit<RowEditDetail>(this, 'incantly-row-edit', { name: row.name, source: row.source });
  }

  private onClick(e: Event): void {
    const target = e.target instanceof Element ? e.target : null;
    const goto = target?.closest('button[data-goto]');
    if (goto) {
      this.focusRow(goto.getAttribute('data-goto') ?? '');
      return;
    }
    const act = target?.closest('button[data-act]');
    if (act) {
      const row = this.rowOf(act);
      if (row) emit<RowActionDetail>(this, act.getAttribute('data-act') === 'rename' ? 'incantly-row-rename' : 'incantly-row-delete', { name: row.name });
      return;
    }
    if (target?.closest('input')) return;
    const row = this.rowOf(e.target);
    const me = e as MouseEvent;
    if (row && me.altKey) {
      e.preventDefault();
      emit<RowInsertDetail>(this, 'incantly-row-insert', me.ctrlKey ? { text: row.source, replace: true } : { text: row.name, replace: false });
    }
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('button, input')) return;
    const li = target?.closest('li.row');
    if (!(li instanceof HTMLElement)) return;
    const items = [...this.ul.querySelectorAll<HTMLElement>('li.row')];
    const i = items.indexOf(li);
    const move = (to: number): void => {
      e.preventDefault();
      const dest = items[Math.max(0, Math.min(items.length - 1, to))];
      if (!dest) return;
      for (const it of items) {
        const on = it === dest;
        it.tabIndex = on ? 0 : -1;
        for (const c of it.querySelectorAll<HTMLElement>('button.act, input.control')) c.tabIndex = on ? 0 : -1;
      }
      dest.focus();
    };
    const row = this.rowOf(li);
    switch (e.key) {
      case 'ArrowDown':
        return move(i + 1);
      case 'ArrowUp':
        return move(i - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(items.length - 1);
      case 'Enter':
        if (row) {
          e.preventDefault();
          this.edit(row);
        }
        return;
      case 'F2':
        if (row) {
          e.preventDefault();
          emit<RowActionDetail>(this, 'incantly-row-rename', { name: row.name });
        }
        return;
      case 'Delete':
        if (row) {
          e.preventDefault();
          emit<RowActionDetail>(this, 'incantly-row-delete', { name: row.name });
        }
        return;
      default:
    }
  }
}
