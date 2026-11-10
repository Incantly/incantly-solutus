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

export interface LineRow {
  readonly id: number;
  readonly name: string;
  /** Type in words, such as `Point` or `Function<Number>`. */
  readonly type: string;
  /** The definition as the learner typed it. */
  readonly source: string;
  readonly state: RowState;
  readonly warnings?: readonly string[];
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

export class LineListElement extends HTMLElement {
  private rowData: readonly LineRow[] = [];
  private readonly ul = h('ul', { class: 'lines', role: 'list', 'aria-label': 'Lines' });
  private readonly empty = h('p', { class: 'empty' }, 'No lines yet. Type one below, for example A = (1, 2).');
  private readonly nodes = new Map<number, { li: HTMLLIElement; sig: string }>();
  private focusId: number | undefined;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.append(styleEl(THEME_CSS + LIST_CSS), this.empty, this.ul);
    this.ul.addEventListener('keydown', (e) => this.onKey(e));
    this.ul.addEventListener('click', (e) => this.onClick(e));
    this.ul.addEventListener('dblclick', (e) => {
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

  /** Moves focus to a row by name. Returns false when there is none. */
  focusRow(name: string): boolean {
    const row = this.rowData.find((r) => r.name === name);
    const entry = row ? this.nodes.get(row.id) : undefined;
    if (!row || !entry) return false;
    entry.li.focus();
    return true;
  }

  private render(): void {
    this.empty.hidden = this.rowData.length > 0;
    this.ul.hidden = this.rowData.length === 0;
    const keep = new Set<number>();
    const ordered: HTMLLIElement[] = [];
    const tabStop = this.rowData.find((r) => r.id === this.focusId)?.id ?? this.rowData[0]?.id;
    for (const row of this.rowData) {
      keep.add(row.id);
      const sig = JSON.stringify(row);
      let entry = this.nodes.get(row.id);
      if (!entry) {
        entry = { li: h('li', { class: 'row', role: 'listitem' }), sig: '' };
        this.nodes.set(row.id, entry);
      }
      if (entry.sig !== sig) {
        this.fill(entry.li, row);
        entry.sig = sig;
      }
      entry.li.tabIndex = row.id === tabStop ? 0 : -1;
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

  private fill(li: HTMLLIElement, row: LineRow): void {
    li.dataset['id'] = String(row.id);
    li.dataset['name'] = row.name;
    li.setAttribute('aria-label', rowLabel(row));
    const kids: Node[] = [h('div', { class: 'top' }, h('span', { class: 'def' }, typeset(row.source)), h('span', { class: 'type' }, row.type))];
    const st = row.state;
    if (st.defined) {
      if (rightSide(row.source) !== st.value && st.value !== '') kids.push(h('div', { class: 'value' }, `= ${typeset(st.value)}`));
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
    li.replaceChildren(...kids);
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
    const row = this.rowOf(e.target);
    const me = e as MouseEvent;
    if (row && me.altKey) {
      e.preventDefault();
      emit<RowInsertDetail>(this, 'incantly-row-insert', me.ctrlKey ? { text: row.source, replace: true } : { text: row.name, replace: false });
    }
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('button')) return;
    const li = target?.closest('li.row');
    if (!(li instanceof HTMLElement)) return;
    const items = [...this.ul.querySelectorAll<HTMLElement>('li.row')];
    const i = items.indexOf(li);
    const move = (to: number): void => {
      e.preventDefault();
      const dest = items[Math.max(0, Math.min(items.length - 1, to))];
      if (!dest) return;
      for (const it of items) it.tabIndex = -1;
      dest.tabIndex = 0;
      dest.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(i + 1);
      case 'ArrowUp':
        return move(i - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(items.length - 1);
      case 'Enter': {
        const row = this.rowOf(li);
        if (row) {
          e.preventDefault();
          this.edit(row);
        }
        return;
      }
      default:
    }
  }
}
