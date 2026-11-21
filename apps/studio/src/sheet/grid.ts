/**
 * The spreadsheet view (docs/features/spreadsheet/ui.md; .kiro/specs/spreadsheet R8): a grid of cells beside the figure.
 * A cell is an object named by its address; every edit, fill, clear and paste is a line (or one batch of lines) through
 * the session, so the grid and the figure always agree and the script is the file.
 *
 * Only the visible cells and a margin of two exist in the DOM (ui 9).
 */
import {
  applyFill, applyPaste, applyPasteCells, cellMarks, cellName, columnLetters, copyText, isCellName, literalOf, parseCellName, reasonPhrase, rectOf,
  rectText, setSheetLocks, sheetLocksOn, sheetSize, undefinedCode, valueText,
} from '@incantly/kernel';
import type { CellAddress, CellClip, CellRect, ErrorObject, Notice, ObjectView } from '@incantly/kernel';
import type { KernelSession } from '../session';

export interface SheetPanel {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Re-reads the figure (after any change) when open. */
  refresh(): void;
  /** The selected block. */
  selection(): CellRect;
  /** Selects a block; the active cell is its top-left. */
  select(rect: CellRect): void;
  /** Starts editing the active cell, with `text` or with what it holds. */
  edit(text?: string): void;
  /** Writes an entry into the active cell as the editor's Enter does. False (and the editor stays) when it failed. */
  commit(text: string): boolean;
  /** Copy, cut and paste of the selection (the keyboard shortcuts call these). */
  copy(cut?: boolean): string;
  paste(text: string): void;
  /** Fills from the selection into a larger block, as the fill handle does. */
  fillTo(target: CellRect): void;
}

export interface SheetOptions {
  readonly session: KernelSession;
  readonly say: (text: string) => void;
  /** The cell's object was picked: the figure highlights it (ui 11). */
  readonly pick?: (name: string | undefined) => void;
  /** Writes text to the system clipboard (navigator.clipboard by default). */
  readonly writeClipboard?: (text: string) => void;
}

const HW = 44;
const HH = 24;
const RH = 25;
const CW = 70;
const DEFAULT_SIZE = { cols: 26, rows: 100 };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

const button = (label: string, title: string, onClick: () => void, cls = 'sheet-btn'): HTMLButtonElement => {
  const b = el('button', cls, label);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
};

/** The right side of a definition line. */
const rightOf = (definition: string): string => {
  const at = definition.indexOf('=');
  return at < 0 ? definition : definition.slice(at + 1).trim();
};

/** A number as a cell shows it: ten significant digits, scientific beyond 1e15 or below 1e-6 (design 5). */
export function cellNumber(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '-∞' : '#N/A';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-6)) return v.toExponential(4).replace('e+', 'e');
  return String(Number(v.toPrecision(10)));
}

/** What a cell shows: the value, not the formula (ui 2). */
export function cellShows(o: ObjectView | undefined): { text: string; kind: 'num' | 'text' | 'bool' | 'undef' | 'other' | 'blank'; title?: string } {
  if (!o) return { text: '', kind: 'blank' };
  const c = o.cell;
  if (!c.defined) {
    if (o.free && / = undefined$/.test(o.definition)) return { text: '', kind: 'blank' };
    return { text: undefinedCode(c.reason), kind: 'undef', title: reasonPhrase(c.reason).sentence };
  }
  const v = c.value;
  if (typeof v === 'number') return { text: cellNumber(v), kind: 'num' };
  if (typeof v === 'string') {
    const first = v.split('\n', 1)[0] as string;
    return { text: first.length < v.length ? `${first}…` : first, kind: 'text' };
  }
  if (typeof v === 'boolean') return { text: v ? '✓' : '✗', kind: 'bool' };
  if (v && typeof v === 'object' && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number') {
    const p = v as { x: number; y: number };
    return { text: `(${cellNumber(p.x)}, ${cellNumber(p.y)})`, kind: 'other' };
  }
  if (Array.isArray(v) || v instanceof Float64Array) return { text: `{…} ${(v as ArrayLike<unknown>).length}`, kind: 'other' };
  if (typeof v === 'object' && v !== null && typeof (v as { call?: unknown }).call === 'function') return { text: o.definition.replace(/ = .*/, ''), kind: 'other' };
  const t = valueText(v);
  return { text: t.length > 40 ? `${t.slice(0, 39)}…` : t, kind: 'other' };
}

/** The text the editor starts with: a value as typed, a formula with `=` in front, a function's whole line. */
export function editText(o: ObjectView | undefined): string {
  if (!o) return '';
  if (o.free) {
    if (/ = undefined$/.test(o.definition)) return '';
    const lit = literalOf(o.cell.defined ? o.cell.value : undefined);
    if (lit) return lit.type === 'Text' && o.cell.defined ? (o.cell.value as string) : lit.text;
  }
  if (o.definition.startsWith(`${o.name}(`)) return `=${o.definition}`;
  return `=${rightOf(o.definition)}`;
}

/** True for an entry that is plain words: stored as a text when it is not a name the figure knows (ui 3). */
const WORDS = /^[\p{L}][\p{L}\p{N} _'.,!?-]*$/u;

export function mountSheet(opts: SheetOptions): SheetPanel {
  const { session, say } = opts;
  const fig = (): KernelSession['figure'] => session.figure;

  /* ------------------------------ state ------------------------------ */

  let anchor: CellAddress = { col: 1, row: 1 };
  let focus: CellAddress = { col: 1, row: 1 };
  let editing: { at: CellAddress; error?: ErrorObject } | undefined;
  let clip: CellClip | undefined;
  let clipText = '';
  let cells = new Map<string, ObjectView>();
  let colX: number[] = [];
  let size = DEFAULT_SIZE;
  let showFormulaBar = false;
  let showGrid = true;
  let dragging: { kind: 'select' | 'fill'; to: CellAddress } | undefined;

  const rect = (): CellRect => rectOf(anchor, focus);

  /* ------------------------------ DOM ------------------------------ */

  const element = el('aside', 'sheetpanel');
  element.hidden = true;
  element.setAttribute('aria-label', 'Sheet');
  const head = el('header', 'lab-head');
  const title = el('h2', '', 'Sheet');
  const sizeText = el('span', 'sheet-size');
  const cog = button('⚙', 'Sheet settings', () => {
    menu.hidden = !menu.hidden;
  }, 'icon-btn');
  const closeBtn = button('×', 'Close', () => close(), 'icon-btn');
  closeBtn.setAttribute('aria-label', 'Close the sheet');
  head.append(title, sizeText, cog, closeBtn);

  const menu = el('div', 'sheet-menu');
  menu.hidden = true;
  const check = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLLabelElement => {
    const l = el('label', 'sheet-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = get();
    box.addEventListener('change', () => {
      set(box.checked);
      render();
    });
    l.append(box, document.createTextNode(` ${label}`));
    return l;
  };
  menu.append(
    check('Formula bar', () => showFormulaBar, (v) => (showFormulaBar = v)),
    check('Gridlines', () => showGrid, (v) => (showGrid = v)),
    check('Enforce locks (teacher)', () => sheetLocksOn(fig()), (v) => setSheetLocks(fig(), v)),
  );

  const fx = el('div', 'sheet-fx');
  const fxName = el('span', 'fx-name');
  const fxInput = el('input', 'fx-input');
  fxInput.setAttribute('aria-label', 'Formula');
  fx.append(el('span', 'fx-label', 'fx'), fxName, fxInput);

  const scroll = el('div', 'sheet-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'grid');
  const spacer = el('div', 'sheet-spacer');
  const layer = el('div', 'sheet-layer');
  const selBox = el('div', 'sheet-sel');
  const handle = el('div', 'sheet-handle');
  handle.title = 'Drag to fill';
  const ghost = el('div', 'sheet-ghost');
  ghost.hidden = true;
  const editor = el('input', 'sheet-editor');
  editor.hidden = true;
  editor.setAttribute('aria-label', 'Cell entry');
  const editError = el('div', 'sheet-error');
  editError.hidden = true;
  editError.setAttribute('role', 'alert');
  scroll.append(spacer, layer, selBox, handle, ghost, editor, editError);

  const bar = el('div', 'sheet-bar');
  const tools = el('div', 'sheet-tools');
  const summary = el('div', 'sheet-summary');
  bar.append(tools, summary);

  const toast = el('div', 'sheet-toast');
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  const live = el('div', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  element.append(head, menu, fx, scroll, bar, toast, live);

  /* ------------------------------ geometry ------------------------------ */

  const widths = (): Map<number, number> => {
    const out = new Map<number, number>();
    const lines = (fig() as { directiveLines?: (n: string) => readonly (readonly string[])[] }).directiveLines?.('colwidth') ?? [];
    for (const w of lines) {
      const col = /^\d+$/.test(w[0] ?? '') ? Number(w[0]) : undefined;
      const c = col ?? (w[0] ? parseCellName(`${w[0]}1`)?.col : undefined);
      const px = Number(w[1]);
      if (c !== undefined && Number.isFinite(px) && px >= 20 && px <= 600) out.set(c, px);
    }
    return out;
  };

  const measure = (): void => {
    size = sheetSize(fig()) ?? DEFAULT_SIZE;
    const ws = widths();
    colX = [HW];
    for (let c = 1; c <= size.cols; c++) colX.push((colX[c - 1] as number) + (ws.get(c) ?? CW));
    spacer.style.width = `${colX[size.cols] as number}px`;
    spacer.style.height = `${HH + size.rows * RH}px`;
    scroll.setAttribute('aria-colcount', String(size.cols));
    scroll.setAttribute('aria-rowcount', String(size.rows));
    sizeText.textContent = sheetSize(fig()) ? `${size.cols} × ${size.rows}` : 'no sheet yet';
  };

  const cellBox = (a: CellAddress): { x: number; y: number; w: number; h: number } => ({
    x: colX[a.col - 1] as number,
    y: HH + (a.row - 1) * RH,
    w: (colX[a.col] as number) - (colX[a.col - 1] as number),
    h: RH,
  });

  /** The cell under a point of the scrolled content, clamped to the sheet. */
  const cellAt = (x: number, y: number): CellAddress => {
    let col = 1;
    while (col < size.cols && (colX[col] as number) <= x) col++;
    const row = Math.min(size.rows, Math.max(1, Math.floor((y - HH) / RH) + 1));
    return { col, row };
  };

  const pointIn = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const b = scroll.getBoundingClientRect();
    return { x: e.clientX - b.left + scroll.scrollLeft, y: e.clientY - b.top + scroll.scrollTop };
  };

  /* ------------------------------ reading ------------------------------ */

  const readCells = (): void => {
    const m = new Map<string, ObjectView>();
    for (const o of fig().objects()) if (isCellName(o.name)) m.set(o.name, o);
    cells = m;
  };

  const nameAt = (a: CellAddress): string => cellName(a.col, a.row) as string;

  const speak = (a: CellAddress): string => {
    const name = nameAt(a);
    const o = cells.get(name);
    if (!o) return `${name}, empty, row ${a.row} of ${size.rows}, column ${a.col} of ${size.cols}`;
    const s = cellShows(o);
    const value = s.kind === 'undef' ? `undefined, ${reasonPhrase(o.cell.defined ? 'not_set' : o.cell.reason).noun}` : `value ${s.text}`;
    const formula = o.free ? '' : `, formula ${rightOf(o.definition)}`;
    return `${name}, ${value}${formula}, row ${a.row} of ${size.rows}, column ${a.col} of ${size.cols}`;
  };

  /* ------------------------------ render ------------------------------ */

  const render = (): void => {
    if (element.hidden) return;
    measure();
    element.classList.toggle('no-grid', !showGrid);
    fx.hidden = !showFormulaBar;
    const sl = scroll.scrollLeft;
    const st = scroll.scrollTop;
    const vw = scroll.clientWidth || 600;
    const vh = scroll.clientHeight || 500;
    let c0 = 1;
    while (c0 < size.cols && (colX[c0] as number) <= sl + HW) c0++;
    let c1 = c0;
    while (c1 < size.cols && (colX[c1 - 1] as number) < sl + vw) c1++;
    c0 = Math.max(1, c0 - 2);
    c1 = Math.min(size.cols, c1 + 2);
    const r0 = Math.max(1, Math.floor(st / RH) + 1 - 2);
    const r1 = Math.min(size.rows, Math.floor((st + vh) / RH) + 1 + 2);
    const marks = cellMarks(fig());
    const sel = rect();
    const frag = document.createDocumentFragment();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const name = cellName(c, r) as string;
        const o = cells.get(name);
        const shows = cellShows(o);
        const b = cellBox({ col: c, row: r });
        const d = el('div', `cell ${shows.kind}`, shows.text);
        d.dataset['cell'] = name;
        d.setAttribute('role', 'gridcell');
        d.setAttribute('aria-rowindex', String(r));
        d.setAttribute('aria-colindex', String(c));
        d.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
        if (o && !o.free) d.classList.add('formula');
        const mark = marks.get(name);
        if (mark?.locked) d.classList.add('locked');
        if (mark?.input) d.classList.add('input');
        if (c >= sel.c0 && c <= sel.c1 && r >= sel.r0 && r <= sel.r1) {
          d.classList.add('in-sel');
          d.setAttribute('aria-selected', 'true');
        }
        if (shows.title || (o && !o.free)) d.title = [shows.title, o && !o.free ? o.definition : ''].filter(Boolean).join('\n');
        frag.append(d);
      }
    }
    // headers ride on the scroll, so they stay in view
    for (let c = c0; c <= c1; c++) {
      const b = cellBox({ col: c, row: 1 });
      const h = el('div', 'colhead', columnLetters(c) as string);
      h.setAttribute('role', 'columnheader');
      h.dataset['col'] = String(c);
      h.style.cssText = `left:${b.x}px;top:${st}px;width:${b.w}px;height:${HH}px`;
      if (c >= sel.c0 && c <= sel.c1) h.classList.add('on');
      const grip = el('span', 'col-grip');
      grip.dataset['col'] = String(c);
      h.append(grip);
      frag.append(h);
    }
    for (let r = r0; r <= r1; r++) {
      const h = el('div', 'rowhead', String(r));
      h.setAttribute('role', 'rowheader');
      h.dataset['row'] = String(r);
      h.style.cssText = `left:${sl}px;top:${HH + (r - 1) * RH}px;width:${HW}px;height:${RH}px`;
      if (r >= sel.r0 && r <= sel.r1) h.classList.add('on');
      frag.append(h);
    }
    const corner = el('div', 'corner');
    corner.style.cssText = `left:${sl}px;top:${st}px;width:${HW}px;height:${HH}px`;
    frag.append(corner);
    layer.replaceChildren(frag);
    // selection outline and fill handle
    const a = cellBox({ col: sel.c0, row: sel.r0 });
    const z = cellBox({ col: sel.c1, row: sel.r1 });
    selBox.style.cssText = `left:${a.x}px;top:${a.y}px;width:${z.x + z.w - a.x}px;height:${z.y + z.h - a.y}px`;
    handle.style.cssText = `left:${z.x + z.w - 4}px;top:${z.y + z.h - 4}px`;
    scroll.setAttribute('aria-activedescendant', '');
    scroll.setAttribute('aria-label', `Sheet. ${speak(focus)}`);
    // editor
    if (editing) {
      const e = cellBox(editing.at);
      editor.style.cssText = `left:${e.x}px;top:${e.y}px;width:${Math.max(e.w, 120)}px;height:${e.h}px`;
      editError.style.cssText = `left:${e.x}px;top:${e.y + e.h}px`;
    }
    editor.hidden = editing === undefined;
    editError.hidden = !editing?.error;
    if (editing?.error) editError.replaceChildren(el('strong', '', editing.error.message), ...(editing.error.hint ? [el('div', 'hint', editing.error.hint)] : []));
    // formula bar
    const active = cells.get(nameAt(focus));
    fxName.textContent = nameAt(focus);
    if (document.activeElement !== fxInput) fxInput.value = editText(active);
    renderBar();
  };

  /* ------------------------------ selection bar (ui 1, 4) ------------------------------ */

  const nextName = (base: string): string => {
    for (let i = 1; ; i++) if (!fig().get(`${base}${i}`)) return `${base}${i}`;
  };

  const renderBar = (): void => {
    const r = rect();
    const many = r.c0 !== r.c1 || r.r0 !== r.r1;
    bar.hidden = !many;
    if (!many) return;
    const text = rectText(r);
    const cols = r.c1 - r.c0 + 1;
    const rows = r.r1 - r.r0 + 1;
    const make = (label: string, base: string, cmd: string, ok: boolean, why: string): HTMLButtonElement => {
      const line = `${nextName(base)} = ${cmd}(${text})`;
      const b = button(label, ok ? line : why, () => {
        const res = session.submit(line);
        if (res.ok) {
          say(res.announcement ?? line);
          showToast(`Made ${line}`, []);
        } else say(res.error.message);
      });
      b.disabled = !ok;
      b.dataset['line'] = line;
      return b;
    };
    tools.replaceChildren(
      make('List', 'list', 'ListFrom', true, ''),
      make('Points', 'pts', 'PointsFrom', cols === 2, 'Needs 2 columns'),
      make('Matrix', 'm', 'MatrixFrom', true, ''),
      make('Table', 'table', 'TableFrom', true, ''),
      make('Polyline', 'poly', 'PolylineFrom', cols === 2, 'Needs 2 columns'),
      make('Op. table', 'ot', 'OperationTable', cols >= 2 && rows >= 2, 'Needs at least 2 × 2'),
      make('Sum', 'sum', 'Sum', true, ''),
      make('Mean', 'mean', 'Mean', true, ''),
    );
    // a quick check with no object made (ui 4)
    const nums: number[] = [];
    for (const [name, o] of cells) {
      const a = parseCellName(name) as CellAddress;
      if (a.col < r.c0 || a.col > r.c1 || a.row < r.r0 || a.row > r.r1) continue;
      if (o.cell.defined && typeof o.cell.value === 'number' && Number.isFinite(o.cell.value)) nums.push(o.cell.value);
    }
    const sum = nums.reduce((s, x) => s + x, 0);
    summary.textContent = nums.length === 0 ? 'No numbers' : `Count ${nums.length} · Sum ${cellNumber(sum)} · Mean ${cellNumber(sum / nums.length)}`;
  };

  /* ------------------------------ toast (ui 5) ------------------------------ */

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (text: string, notices: readonly Notice[]): void => {
    const undo = button('Undo', 'Undo this step', () => {
      session.undo();
      toast.hidden = true;
    }, 'sheet-btn');
    const parts: Node[] = [el('span', '', text), undo];
    if (notices.length > 0) parts.push(el('div', 'sheet-warn', notices.map((n) => n.message).join(' ')));
    toast.replaceChildren(...parts);
    toast.hidden = false;
    live.textContent = text;
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 6000);
  };

  /* ------------------------------ writing ------------------------------ */

  const ensureSheet = (lines: string[]): string[] => (sheetSize(fig()) ? lines : ['@sheet 26 100', ...lines]);

  /** Applies lines as one undo step; the sheet is added first when the figure has none. */
  const write = (lines: string[], label: string): ErrorObject | undefined => {
    const all = ensureSheet(lines);
    if (all.length === 0) return undefined;
    if (all.length === 1) {
      const r = session.submit(all[0] as string);
      return r.ok ? undefined : r.error;
    }
    const r = session.applyLines(all, label, 'atomic', 'learner');
    return r.ok ? undefined : r.error;
  };

  const commitAt = (at: CellAddress, text: string): ErrorObject | undefined => {
    const name = nameAt(at);
    const old = fig().get(name);
    const t = text.trim();
    if (t === '') {
      if (!old) return undefined;
      return write([`ClearCells(${name})`], `Clear ${name}`);
    }
    let body = t.startsWith('=') ? t.slice(1).trim() : t;
    // a whole function line: `=A1(x, y) = x * y`
    let line = new RegExp(`^${name}\\s*\\(`).test(body) ? body : `${name} = ${body}`;
    if (!t.startsWith('=') && WORDS.test(body) && !fig().get(body) && !/^(true|false|undefined|pi|e)$/.test(body)) {
      const probe = fig().apply(line, { dryRun: true });
      if (!probe.ok) {
        body = `"${body.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        line = `${name} = ${body}`;
      }
    }
    let err = write([line], name);
    // a cell may change its type: the UI clears it first (design 3.7), unless other objects read it
    if (err && err.kind === 'type_change' && old && fig().dependentsOf(old.id).length === 0) err = write([`Delete(${name})`, line], name);
    return err;
  };

  const move = (dc: number, dr: number, extend = false): void => {
    focus = { col: Math.min(size.cols, Math.max(1, focus.col + dc)), row: Math.min(size.rows, Math.max(1, focus.row + dr)) };
    if (!extend) anchor = focus;
    reveal(focus);
    render();
    live.textContent = speak(focus);
    opts.pick?.(cells.has(nameAt(focus)) ? nameAt(focus) : undefined);
  };

  const reveal = (a: CellAddress): void => {
    const b = cellBox(a);
    const vw = scroll.clientWidth || 600;
    const vh = scroll.clientHeight || 500;
    if (b.x - HW < scroll.scrollLeft) scroll.scrollLeft = b.x - HW;
    else if (b.x + b.w > scroll.scrollLeft + vw) scroll.scrollLeft = b.x + b.w - vw;
    if (b.y - HH < scroll.scrollTop) scroll.scrollTop = b.y - HH;
    else if (b.y + b.h > scroll.scrollTop + vh) scroll.scrollTop = b.y + b.h - vh;
  };

  const startEdit = (text?: string): void => {
    editing = { at: focus };
    editor.value = text ?? editText(cells.get(nameAt(focus)));
    render();
    editor.focus();
    const n = editor.value.length;
    editor.setSelectionRange?.(n, n);
  };

  const stopEdit = (): void => {
    editing = undefined;
    render();
    scroll.focus();
  };

  const commitEdit = (dc: number, dr: number): boolean => {
    if (!editing) return true;
    const at = editing.at;
    const e = commitAt(at, editor.value);
    if (e) {
      editing = { at, error: e };
      render();
      editor.focus();
      return false;
    }
    editing = undefined;
    focus = at;
    anchor = at;
    move(dc, dr);
    scroll.focus();
    return true;
  };

  /* ------------------------------ fill, copy, paste ------------------------------ */

  const fillTo = (target: CellRect): void => {
    const src = rect();
    let dir: 'down' | 'up' | 'right' | 'left' | undefined;
    let into: CellRect | undefined;
    if (target.r1 > src.r1 && target.c0 === src.c0 && target.c1 === src.c1) {
      dir = 'down';
      into = { ...src, r0: src.r1 + 1, r1: target.r1 };
    } else if (target.r0 < src.r0 && target.c0 === src.c0 && target.c1 === src.c1) {
      dir = 'up';
      into = { ...src, r0: target.r0, r1: src.r0 - 1 };
    } else if (target.c1 > src.c1 && target.r0 === src.r0 && target.r1 === src.r1) {
      dir = 'right';
      into = { ...src, c0: src.c1 + 1, c1: target.c1 };
    } else if (target.c0 < src.c0 && target.r0 === src.r0 && target.r1 === src.r1) {
      dir = 'left';
      into = { ...src, c0: target.c0, c1: src.c0 - 1 };
    }
    if (!dir || !into) return;
    if (!sheetSize(fig())) {
      const e = write([], 'Sheet');
      if (e) return;
    }
    const r = applyFill(fig(), src, into, dir, 'learner');
    if (!r.ok) {
      say(r.error.message);
      showToast(r.error.message, []);
      return;
    }
    anchor = { col: Math.min(src.c0, into.c0), row: Math.min(src.r0, into.r0) };
    focus = { col: Math.max(src.c1, into.c1), row: Math.max(src.r1, into.r1) };
    const n = r.plan.cells.length;
    showToast(`Filled ${n === 1 ? '1 cell' : `${n} cells`} in ${rectText(into)}`, r.plan.warnings);
    render();
  };

  const copy = (cut = false): string => {
    const r = rect();
    clip = { rect: r, cut };
    clipText = copyText(fig(), r);
    (opts.writeClipboard ?? ((t: string) => void navigator.clipboard?.writeText?.(t).catch(() => undefined)))(clipText);
    say(`${cut ? 'Cut' : 'Copied'} ${rectText(r)}`);
    return clipText;
  };

  const paste = (text: string): void => {
    if (!sheetSize(fig()) && write([], 'Sheet')) return;
    const r = clip && text === clipText ? applyPasteCells(fig(), clip, focus, { origin: 'learner' }) : applyPaste(fig(), text, focus, { origin: 'learner' });
    if (clip?.cut && text === clipText) clip = undefined;
    if (!r.ok) {
      say(r.error.message);
      showToast(r.error.message, []);
      return;
    }
    const n = r.plan.cells.length;
    const m = /^([A-Z]+\d+):([A-Z]+\d+)$/.exec(r.plan.range);
    if (m) {
      anchor = parseCellName(m[1] as string) as CellAddress;
      focus = parseCellName(m[2] as string) as CellAddress;
    }
    showToast(`Pasted ${n === 1 ? '1 cell' : `${n} cells`}`, r.plan.warnings);
    render();
  };

  const clearSelection = (): void => {
    const r = rect();
    const any = [...cells.keys()].some((n) => {
      const a = parseCellName(n) as CellAddress;
      return a.col >= r.c0 && a.col <= r.c1 && a.row >= r.r0 && a.row <= r.r1;
    });
    if (!any) return;
    const e = write([`ClearCells(${rectText(r)})`], `Clear ${rectText(r)}`);
    if (e) say(e.message);
  };

  const fillLine = (which: 'FillDown' | 'FillRight'): void => {
    const r = rect();
    if (which === 'FillDown' ? r.r0 === r.r1 : r.c0 === r.c1) return;
    const res = session.submit(`${which}(${rectText(r)})`);
    if (!res.ok) {
      say(res.error.message);
      showToast(res.error.message, []);
    } else showToast((res.announcement ?? '').split('. ')[0] ?? '', []);
  };

  /* ------------------------------ events ------------------------------ */

  scroll.addEventListener('scroll', () => render());

  scroll.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (t === editor) return;
    if (t.classList.contains('col-grip')) {
      startResize(Number(t.dataset['col']), e);
      return;
    }
    const p = pointIn(e);
    if (t.classList.contains('colhead')) {
      const c = Number(t.dataset['col']);
      anchor = { col: c, row: 1 };
      focus = { col: c, row: size.rows };
      render();
      return;
    }
    if (t.classList.contains('rowhead')) {
      const r = Number(t.dataset['row']);
      anchor = { col: 1, row: r };
      focus = { col: size.cols, row: r };
      render();
      return;
    }
    if (t === handle) {
      dragging = { kind: 'fill', to: focus };
      scroll.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    const at = cellAt(p.x, p.y);
    // while a formula is being typed, a click puts the cell's name in it (ui 3)
    if (editing && /[=(+\-*/^,:]\s*$/.test(editor.value)) {
      editor.value += nameAt(at);
      editor.focus();
      e.preventDefault();
      return;
    }
    if (editing && !commitEdit(0, 0)) return;
    if (e.shiftKey) focus = at;
    else {
      anchor = at;
      focus = at;
    }
    dragging = { kind: 'select', to: at };
    scroll.setPointerCapture?.(e.pointerId);
    render();
    scroll.focus();
    opts.pick?.(cells.has(nameAt(at)) ? nameAt(at) : undefined);
  });

  scroll.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = pointIn(e);
    const at = cellAt(p.x, p.y);
    if (dragging.kind === 'select') {
      focus = at;
      render();
      return;
    }
    dragging = { kind: 'fill', to: at };
    // the ghost outline of the target (ui 5)
    const src = rect();
    const tgt = targetOf(src, at);
    const a = cellBox({ col: tgt.c0, row: tgt.r0 });
    const z = cellBox({ col: tgt.c1, row: tgt.r1 });
    ghost.hidden = false;
    ghost.style.cssText = `left:${a.x}px;top:${a.y}px;width:${z.x + z.w - a.x}px;height:${z.y + z.h - a.y}px`;
  });

  /** The block the fill handle covers when dragged to `at`: down, up, right or left, whichever is farther. */
  const targetOf = (src: CellRect, at: CellAddress): CellRect => {
    const down = at.row - src.r1;
    const up = src.r0 - at.row;
    const right = at.col - src.c1;
    const left = src.c0 - at.col;
    const best = Math.max(down, up, right, left);
    if (best <= 0) return src;
    if (best === down) return { ...src, r1: at.row };
    if (best === up) return { ...src, r0: at.row };
    if (best === right) return { ...src, c1: at.col };
    return { ...src, c0: at.col };
  };

  scroll.addEventListener('pointerup', () => {
    if (dragging?.kind === 'fill') {
      ghost.hidden = true;
      const target = targetOf(rect(), dragging.to);
      dragging = undefined;
      fillTo(target);
      return;
    }
    dragging = undefined;
  });

  scroll.addEventListener('dblclick', (e) => {
    const t = e.target as HTMLElement;
    if (!t.dataset['cell']) return;
    startEdit();
  });

  const startResize = (col: number, e: PointerEvent): void => {
    const x0 = e.clientX;
    const w0 = (colX[col] as number) - (colX[col - 1] as number);
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointerup', up);
      const w = Math.round(Math.min(600, Math.max(20, w0 + ev.clientX - x0)));
      if (w !== w0) session.submit(`@colwidth ${columnLetters(col) as string} ${w}`);
    };
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };

  scroll.addEventListener('keydown', (e) => {
    if (e.target === editor) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const page = Math.max(1, Math.floor((scroll.clientHeight || 500) / RH) - 1);
    const handled = (): void => e.preventDefault();
    if (k === 'ArrowDown') return handled(), mod ? jump(0, 1, e.shiftKey) : move(0, 1, e.shiftKey);
    if (k === 'ArrowUp') return handled(), mod ? jump(0, -1, e.shiftKey) : move(0, -1, e.shiftKey);
    if (k === 'ArrowRight') return handled(), mod ? jump(1, 0, e.shiftKey) : move(1, 0, e.shiftKey);
    if (k === 'ArrowLeft') return handled(), mod ? jump(-1, 0, e.shiftKey) : move(-1, 0, e.shiftKey);
    if (k === 'PageDown') return handled(), move(0, page, e.shiftKey);
    if (k === 'PageUp') return handled(), move(0, -page, e.shiftKey);
    if (k === 'Home') return handled(), move(1 - focus.col, 0, e.shiftKey);
    if (k === 'End') return handled(), move(lastFilled(focus.row) - focus.col, 0, e.shiftKey);
    if (k === 'Tab') return handled(), move(e.shiftKey ? -1 : 1, 0);
    if (k === 'Enter') return handled(), e.shiftKey ? move(0, -1) : startEdit();
    if (k === 'F2') return handled(), startEdit();
    if (k === 'Delete') return handled(), clearSelection();
    if (k === 'Backspace') {
      handled();
      if (cells.has(nameAt(focus))) write([`ClearCells(${nameAt(focus)})`], `Clear ${nameAt(focus)}`);
      startEdit('');
      return;
    }
    if (mod && k.toLowerCase() === 'd') return handled(), fillLine('FillDown');
    if (mod && k.toLowerCase() === 'r') return handled(), fillLine('FillRight');
    if (mod && k.toLowerCase() === 'a') return handled(), selectUsed();
    if (mod && k.toLowerCase() === 'c') return void copy(false);
    if (mod && k.toLowerCase() === 'x') return void copy(true);
    if (k === 'Escape') {
      menu.hidden = true;
      return;
    }
    if (!mod && !e.altKey && k.length === 1) {
      handled();
      startEdit(k);
    }
  });

  scroll.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (text === undefined || editing) return;
    e.preventDefault();
    paste(text);
  });
  scroll.addEventListener('copy', (e) => {
    if (editing) return;
    e.clipboardData?.setData('text/plain', clipText || copyText(fig(), rect()));
    e.preventDefault();
  });

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(0, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      stopEdit();
    }
    e.stopPropagation();
  });

  fxInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const err = commitAt(focus, fxInput.value);
    if (err) say(`${err.message}${err.hint ? ` ${err.hint}` : ''}`);
    fxInput.blur();
    render();
  });

  const lastFilled = (row: number): number => {
    let last = 1;
    for (const n of cells.keys()) {
      const a = parseCellName(n) as CellAddress;
      if (a.row === row) last = Math.max(last, a.col);
    }
    return last;
  };

  /** Ctrl+arrow: to the edge of the data in that direction (ui 9). */
  const jump = (dc: number, dr: number, extend: boolean): void => {
    let c = focus.col;
    let r = focus.row;
    const filled = (cc: number, rr: number): boolean => cells.has(cellName(cc, rr) as string);
    const inSheet = (cc: number, rr: number): boolean => cc >= 1 && rr >= 1 && cc <= size.cols && rr <= size.rows;
    const startFilled = filled(c, r) && inSheet(c + dc, r + dr) && filled(c + dc, r + dr);
    while (inSheet(c + dc, r + dr)) {
      const next = filled(c + dc, r + dr);
      if (startFilled ? !next : next) {
        if (!startFilled) {
          c += dc;
          r += dr;
        }
        break;
      }
      c += dc;
      r += dr;
    }
    move(c - focus.col, r - focus.row, extend);
  };

  const selectUsed = (): void => {
    let c0 = Infinity;
    let r0 = Infinity;
    let c1 = 0;
    let r1 = 0;
    for (const n of cells.keys()) {
      const a = parseCellName(n) as CellAddress;
      c0 = Math.min(c0, a.col);
      r0 = Math.min(r0, a.row);
      c1 = Math.max(c1, a.col);
      r1 = Math.max(r1, a.row);
    }
    if (c1 === 0) return;
    anchor = { col: c0, row: r0 };
    focus = { col: c1, row: r1 };
    render();
  };

  /* ------------------------------ api ------------------------------ */

  const open = (): void => {
    element.hidden = false;
    readCells();
    render();
  };
  const close = (): void => {
    element.hidden = true;
    element.dispatchEvent(new CustomEvent('lab-closed', { bubbles: true }));
  };

  return {
    element,
    open,
    close,
    isOpen: () => !element.hidden,
    refresh: () => {
      if (element.hidden) return;
      readCells();
      render();
    },
    selection: rect,
    select: (r) => {
      anchor = { col: r.c0, row: r.r0 };
      focus = { col: r.c1, row: r.r1 };
      render();
    },
    edit: (text) => startEdit(text),
    commit: (text) => {
      if (!editing) startEdit(text);
      editor.value = text;
      return commitEdit(0, 1);
    },
    copy,
    paste,
    fillTo,
  };
}
