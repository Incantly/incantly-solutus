/**
 * The CAS view (cas ui.md 1 to 6, 8, 11; .kiro/specs/cas R3): a panel over the figure's symbolic objects, one row per
 * Expr, Cond, Symbol or list of them, in creation order. It is not a second document: every row is an object line,
 * and every button writes a line through the session, so the worked solution is the script.
 */
import { isSymValue, valueText } from '@incantly/kernel';
import type { ErrorObject, ObjectView, SymValue } from '@incantly/kernel';
import { mathElement } from './graph/mathdraw';
import { hasDrawing } from './graph/symplot';
import type { KernelSession } from './session';

export interface CasPanel {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Re-reads the figure (after any change) when open. */
  refresh(): void;
  /** The selected row's name, if any. */
  selected(): string | undefined;
  select(name: string | undefined): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

const button = (label: string, title: string, onClick: () => void, cls = 'cas-btn'): HTMLButtonElement => {
  const b = el('button', cls, label);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
};

/** Values the view shows as rows (design 5.14): an Expr, Cond, Symbol, or a list (of lists) of them. */
export function isCasRow(o: ObjectView): boolean {
  const t = o.type as string;
  if (t === 'Expr' || t === 'Cond' || t === 'Symbol') return true;
  if (o.type !== 'List') return false;
  // a list of solutions, or of systems' solutions (List<List> carries no inner type): read the values
  if (/^List<(Expr|Cond)/.test(o.typeText)) return true;
  const v = o.cell.defined ? o.cell.value : undefined;
  return Array.isArray(v) && v.length > 0 && v.every((x) => isSymValue(x) || (Array.isArray(x) && x.every(isSymValue)));
}

/** The right side of a definition line: what the row's input shows. */
export function rightOf(definition: string): string {
  const at = definition.indexOf('=');
  return at < 0 ? definition : definition.slice(at + 1).trim();
}

/** The LaTeX of a row value and whether it is exact; numbers in decimal mode when asked. */
function latexOf(v: unknown, decimal: boolean): { latex: string; exact: boolean; approx?: number } | undefined {
  if (isSymValue(v)) {
    if (decimal && v.approx !== undefined && v.unknowns?.length === 0) return { latex: short(v.approx), exact: false };
    return { latex: v.latex, exact: v.exact, ...(v.approx !== undefined ? { approx: v.approx } : {}) };
  }
  if (Array.isArray(v) && v.length > 0) {
    const parts = v.map((x) => latexOf(x, decimal));
    if (parts.some((p) => p === undefined)) return undefined;
    const ok = parts as { latex: string; exact: boolean }[];
    return { latex: `\\left\\{ ${ok.map((p) => p.latex).join(',\\; ')} \\right\\}`, exact: ok.every((p) => p.exact) };
  }
  if (Array.isArray(v) && v.length === 0) return { latex: '\\left\\{ \\right\\}', exact: true };
  if (typeof v === 'number') return { latex: short(v), exact: Number.isInteger(v) };
  if (typeof v === 'boolean') return { latex: `\\text{${v}}`, exact: true };
  return undefined;
}

const short = (x: number): string => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(10))));

/** Spoken form of a value for the row's label (ui.md 8). */
function speechOf(v: unknown): string {
  if (isSymValue(v)) return v.speech ?? v.text;
  if (Array.isArray(v)) return v.map(speechOf).join(', ');
  return valueText(v);
}

const LONG_OUTPUT = 300;

export function mountCasPanel(session: KernelSession, say: (t: string) => void): CasPanel {
  const element = el('aside', 'caspanel');
  element.setAttribute('aria-label', 'CAS');
  element.hidden = true;
  element.tabIndex = -1;

  let decimal = false;
  let selectedName: string | undefined;
  /** The last good output of each row, shown struck through while the row is undefined (ui.md 11). */
  const lastGood = new Map<string, Element>();
  const expanded = new Set<string>();

  /* ------------------------------ header ------------------------------ */

  const head = el('header', 'lab-head');
  const title = el('h2', '', 'CAS');
  const modeExact = button('Exact', 'Show exact values', () => setMode(false), 'cas-mode on');
  const modeDec = button('1.23', 'Show decimals', () => setMode(true), 'cas-mode');
  const modes = el('div', 'cas-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Display');
  modes.append(modeExact, modeDec);
  const closeBtn = button('×', 'Close', () => close(), 'icon-btn');
  closeBtn.setAttribute('aria-label', 'Close the CAS view');
  head.append(title, modes, closeBtn);
  const setMode = (d: boolean): void => {
    decimal = d;
    modeExact.classList.toggle('on', !d);
    modeDec.classList.toggle('on', d);
    modeExact.setAttribute('aria-pressed', String(!d));
    modeDec.setAttribute('aria-pressed', String(d));
    render(true);
  };

  /* ------------------------------ toolbar (ui.md 2) ------------------------------ */

  const digits = el('input', 'cas-digits');
  digits.type = 'number';
  digits.min = '1';
  digits.max = '200';
  digits.value = '15';
  digits.title = 'Digits for N';
  digits.setAttribute('aria-label', 'Digits for N');
  const prompt = el('form', 'cas-prompt');
  prompt.hidden = true;
  const menu = el('div', 'cas-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const toolbar = el('div', 'cas-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'CAS operations');

  const rows = (): ObjectView[] => session.figure.objects().filter(isCasRow);
  /** The row a button works on: the selected one, else the last one (ui.md 2). */
  const target = (): ObjectView | undefined => {
    const all = rows();
    return (selectedName !== undefined ? all.find((o) => o.name === selectedName) : undefined) ?? all.filter((o) => (o.type as string) !== 'Symbol').at(-1);
  };
  const freeName = (): string => {
    let k = 1;
    while (session.figure.get(`c${k}`)) k++;
    return `c${k}`;
  };
  const unknownsOf = (o: ObjectView): readonly string[] => {
    const v = o.cell.defined ? o.cell.value : undefined;
    if (isSymValue(v)) return v.unknowns ?? [];
    return [];
  };

  /** Adds a row `cN = text` and selects it; on an error the message is said and nothing changes. */
  const addRow = (text: string): boolean => {
    const name = freeName();
    const r = session.submit(`${name} = ${text}`);
    if (!r.ok) {
      showError(newErr, r.error, (fixed) => addRow(fixed.replace(/^\s*\w+\s*=\s*/, '')));
      say(r.error.message);
      return false;
    }
    selectedName = name;
    newErr.replaceChildren();
    render(true);
    return true;
  };

  /** Asks for the fields of an operation in a one-line form under the toolbar. */
  const ask = (label: string, fields: readonly { name: string; label: string; options?: readonly string[]; value?: string }[], done: (vals: Record<string, string>) => void): void => {
    prompt.replaceChildren(el('span', 'cas-prompt-label', label));
    const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    for (const f of fields) {
      const lab = el('label', 'cas-field');
      lab.append(el('span', '', f.label));
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.options) {
        const sel = el('select');
        for (const o of f.options) {
          const opt = el('option', '', o);
          opt.value = o;
          sel.append(opt);
        }
        input = sel;
      } else {
        const i = el('input');
        i.type = 'text';
        i.spellcheck = false;
        i.value = f.value ?? '';
        input = i;
      }
      inputs[f.name] = input;
      lab.append(input);
      prompt.append(lab);
    }
    const ok = el('button', 'cas-btn primary', 'OK');
    ok.type = 'submit';
    const cancel = button('Cancel', 'Cancel', () => {
      prompt.hidden = true;
    });
    prompt.append(ok, cancel);
    prompt.onsubmit = (e): void => {
      e.preventDefault();
      const vals: Record<string, string> = {};
      for (const [k, i] of Object.entries(inputs)) vals[k] = i.value.trim();
      prompt.hidden = true;
      done(vals);
    };
    prompt.hidden = false;
    (Object.values(inputs)[0] as HTMLElement | undefined)?.focus();
  };

  /** Runs `make(row, unknown)`, picking the unknown: the only one, or a chooser when there are several (ui.md 2). */
  const withUnknown = (label: string, make: (row: string, v: string) => void): void => {
    const t = target();
    if (!t) return void say('Add a row first.');
    const us = unknownsOf(t).length > 0 ? unknownsOf(t) : ['x'];
    if (us.length === 1) make(t.name, us[0] as string);
    else ask(`${label}: which unknown?`, [{ name: 'v', label: 'unknown', options: us }], (v) => make(t.name, v['v'] as string));
  };

  const ops: { label: string; title: string; key: string; run: () => void }[] = [
    { label: 'Simplify', title: 'Simplify (S)', key: 's', run: () => one((n) => `Simplify(${n})`) },
    { label: 'Expand', title: 'Expand (E)', key: 'e', run: () => one((n) => `Expand(${n})`) },
    {
      label: 'Factor', title: 'Factor (F)', key: 'f', run: () => {
        const t = target();
        if (!t) return void say('Add a row first.');
        // a condition factors its left side (ui.md 2)
        addRow((t.type as string) === 'Cond' ? `Factor(LeftSide(${t.name}))` : `Factor(${t.name})`);
      },
    },
    { label: 'Solve', title: 'Solve (V)', key: 'v', run: () => withUnknown('Solve', (n, v) => addRow(`Solve(${condFor(n)}, ${v})`)) },
    { label: 'd/dx', title: 'Derivative (D)', key: 'd', run: () => withUnknown('Derivative', (n, v) => addRow(`Derivative(${n}, ${v})`)) },
    {
      label: '∫', title: 'Integral (I); give bounds for a definite integral', key: 'i', run: () => withUnknown('Integral', (n, v) => ask('Integral', [{ name: 'a', label: 'from' }, { name: 'b', label: 'to' }], (b) => {
        addRow(b['a'] && b['b'] ? `Integral(${n}, ${v}, ${b['a']}, ${b['b']})` : `Integral(${n}, ${v})`);
      })),
    },
    { label: 'Limit', title: 'Limit', key: '', run: () => withUnknown('Limit', (n, v) => ask(`Limit as ${v} goes to`, [{ name: 'a', label: v + ' →', value: '0' }], (b) => addRow(`Limit(${n}, ${v}, ${b['a'] || '0'})`))) },
    {
      label: 'Substitute', title: 'Substitute', key: '', run: () => {
        const t = target();
        if (!t) return void say('Add a row first.');
        const us = unknownsOf(t);
        ask('Substitute', [us.length > 0 ? { name: 'old', label: 'replace', options: us } : { name: 'old', label: 'replace', value: 'x' }, { name: 'new', label: 'with', value: '0' }], (b) => addRow(`Substitute(${t.name}, ${b['old']}, ${b['new'] || '0'})`));
      },
    },
    { label: 'N', title: 'Numeric value (N); the box sets the digits', key: 'n', run: () => one((n) => `Numeric(${n}, ${Math.max(1, Math.min(200, Math.round(Number(digits.value) || 15)))})`) },
  ];
  /** The condition to solve: a Cond row as it is, an Expr row set to 0. */
  const condFor = (n: string): string => ((session.figure.get(n)?.type as string | undefined) === 'Cond' ? n : `${n} == 0`);
  const one = (make: (n: string) => string): void => {
    const t = target();
    if (!t) return void say('Add a row first.');
    addRow(make(t.name));
  };
  for (const o of ops) toolbar.append(button(o.label, o.title, o.run));
  toolbar.append(digits);

  const menuItems: { label: string; run: () => void }[] = [
    { label: 'Evaluate', run: () => one((n) => `Evaluate(${n})`) },
    { label: 'Hold', run: () => one((n) => `Hold(${n})`) },
    { label: 'Mixed number', run: () => one((n) => `MixedNumber(${n})`) },
    {
      label: 'Equivalent to…', run: () => {
        const t = target();
        if (!t) return;
        ask(`Is ${t.name} equal to`, [{ name: 'e', label: 'expression' }], (b) => b['e'] && addRow(`Equivalent(${t.name}, ${b['e']})`));
      },
    },
    { label: 'Freeze', run: () => freeze() },
    {
      label: 'Rename', run: () => {
        const t = target();
        if (!t) return;
        ask(`Rename ${t.name}`, [{ name: 'n', label: 'new name', value: t.name }], (b) => {
          const r = session.rename(t.name, b['n'] ?? t.name);
          if (!r.ok) say(r.error.message);
          else selectedName = b['n'];
        });
      },
    },
    { label: 'Delete row', run: () => deleteRow() },
  ];
  for (const m of menuItems) {
    const b = button(m.label, m.label, () => {
      menu.hidden = true;
      m.run();
    }, 'cas-menu-item');
    b.setAttribute('role', 'menuitem');
    menu.append(b);
  }
  const more = button('⋮', 'More', () => {
    menu.hidden = !menu.hidden;
  });
  more.setAttribute('aria-haspopup', 'menu');
  toolbar.append(more);

  /** `Freeze(c2)`: the row becomes a free Expr with its current value (design 5.14). */
  const freeze = (): void => {
    const t = target();
    const v = t?.cell.defined ? t.cell.value : undefined;
    if (!t || !isSymValue(v) || v.input === undefined || v.sym === 'Symbol') return void say('Pick an expression row to freeze.');
    const r = session.submit(`${t.name} = Expr(${v.input})`);
    say(r.ok ? `Froze ${t.name}.` : r.error.message);
  };

  /** Deleting a row that others use asks first, listing them (ui.md 11). */
  const deleteRow = (): void => {
    const t = target();
    if (!t) return;
    const plan = session.deletePlan(t.name);
    const others = plan.filter((n) => n !== t.name);
    if (others.length > 0 && typeof window.confirm === 'function' && !window.confirm(`Delete ${t.name}? ${others.join(', ')} ${others.length === 1 ? 'also goes' : 'also go'}.`)) return;
    const r = session.delete(t.name);
    say(r.ok ? r.message : r.error.message);
    if (selectedName === t.name) selectedName = undefined;
  };

  /* ------------------------------ rows ------------------------------ */

  const list = el('ol', 'cas-rows');
  list.setAttribute('aria-label', 'CAS rows');
  const newRow = el('div', 'cas-new');
  const newInput = el('input', 'cas-input');
  newInput.type = 'text';
  newInput.spellcheck = false;
  newInput.autocomplete = 'off';
  newInput.placeholder = 'Type an expression, e.g. x^2 - 5x + 6';
  newInput.setAttribute('aria-label', 'New CAS row');
  const newErr = el('div', 'cas-error');
  newErr.setAttribute('role', 'alert');
  newRow.append(el('span', 'cas-name', '▸'), newInput);
  let upCount = 0;
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = newInput.value.trim();
      if (!text) return;
      // `name = …` keeps its name; any other text becomes the next cN, wrapped in Expr when it is plain algebra
      const named = /^([A-Za-z\u0370-\u03FF][\w\u0370-\u03FF]*)\s*=(?!=)/.exec(text);
      let ok: boolean;
      if (named) {
        const r = session.submit(text);
        ok = r.ok;
        if (!r.ok) showError(newErr, r.error, (fixed) => void session.submit(fixed));
        else selectedName = named[1];
      } else ok = addRow(/^[A-Z]\w*\(/.test(text) ? text : `Expr(${text})`);
      if (ok) {
        newInput.value = '';
        newErr.replaceChildren();
        upCount = 0;
      }
    } else if (e.key === 'ArrowUp') {
      // the row above (ui.md 3): Up puts the last row's name in, Up again the row before it
      const names = rows().map((o) => o.name);
      if (names.length === 0) return;
      e.preventDefault();
      upCount = Math.min(names.length, upCount + 1);
      const name = names[names.length - upCount] as string;
      const prev = upCount > 1 ? (names[names.length - upCount + 1] as string) : undefined;
      newInput.value = prev && newInput.value.endsWith(prev) ? newInput.value.slice(0, -prev.length) + name : newInput.value + name;
    } else if (e.key === 'Escape') {
      newInput.value = '';
      newErr.replaceChildren();
    }
  });

  /** An error under an input: the message, the first fix as a button, and for a new letter "Create unknown k" (ui.md 3). */
  const showError = (box: HTMLElement, err: ErrorObject, apply: (line: string) => void): void => {
    box.replaceChildren(el('span', 'cas-error-text', `⚠ ${err.message}`));
    const symbol = err.kind === 'unknown_name' ? err.suggest.find((s) => /=\s*Symbol\(\)$/.test(s)) : undefined;
    if (symbol) {
      const letter = symbol.split('=')[0]?.trim() ?? '';
      box.append(button(`Create unknown ${letter}`, symbol, () => {
        const r = session.submit(symbol);
        if (!r.ok) return void say(r.error.message);
        box.replaceChildren();
        say(`Made the unknown ${letter}.`);
      }, 'cas-fix'));
    } else if (err.suggest[0]) {
      const fix = err.suggest[0];
      box.append(button(`Use: ${fix}`, fix, () => apply(fix), 'cas-fix'));
    }
  };

  const stamps = new Map<string, string>();
  const rowEls = new Map<string, HTMLLIElement>();

  const rowFor = (o: ObjectView, force: boolean): HTMLLIElement => {
    const v = o.cell.defined ? o.cell.value : undefined;
    const plotted = (o.style.ext as { plot?: unknown }).plot === true;
    const stamp = `${o.definition}|${o.cell.defined ? valueText(v) : `u:${o.cell.reason}`}|${plotted}|${decimal}|${selectedName === o.name}|${expanded.has(o.name)}`;
    const old = rowEls.get(o.name);
    if (old && !force && stamps.get(o.name) === stamp) return old;
    stamps.set(o.name, stamp);
    const li = el('li', `cas-row${selectedName === o.name ? ' selected' : ''}`);
    li.dataset['name'] = o.name;
    const name = button(o.name, `Select ${o.name}`, () => {
      selectedName = selectedName === o.name ? undefined : o.name;
      render(true);
    }, 'cas-name');
    name.setAttribute('aria-pressed', String(selectedName === o.name));
    const input = el('input', 'cas-input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = rightOf(o.definition);
    input.setAttribute('aria-label', `Definition of ${o.name}`);
    const err = el('div', 'cas-error');
    err.setAttribute('role', 'alert');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const r = session.submit(`${o.name} = ${input.value.trim()}`);
        if (!r.ok) showError(err, r.error, (fixed) => void session.submit(fixed));
        else err.replaceChildren();
      } else if (e.key === 'Escape') {
        input.value = rightOf(o.definition);
        err.replaceChildren();
        input.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const all = [...list.querySelectorAll<HTMLInputElement>('.cas-row .cas-input')];
        const i = all.indexOf(input);
        const next = e.key === 'ArrowUp' ? all[i - 1] : (all[i + 1] ?? newInput);
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }
    });
    const out = el('div', 'cas-output');
    const lx = o.cell.defined ? latexOf(v, decimal) : undefined;
    if (lx) {
      const plain = valueText(v);
      const long = plain.length > LONG_OUTPUT && !expanded.has(o.name);
      const typeset = long ? undefined : mathElement(`$${lx.latex}$`, 17);
      out.append(el('span', `cas-sign${lx.exact ? '' : ' approx'}`, lx.exact ? '=' : '≈'));
      if (typeset) {
        typeset.setAttribute('aria-hidden', 'true');
        out.append(typeset);
        lastGood.set(o.name, typeset.cloneNode(true) as Element);
      } else {
        out.append(el('span', 'cas-long', `${plain.slice(0, 120)}…`), button('show more', 'Show the whole output', () => {
          expanded.add(o.name);
          render(true);
        }, 'cas-link'));
      }
      // the hover of an exact output is its decimal (ui.md 5)
      if (lx.approx !== undefined && lx.exact && !Number.isInteger(lx.approx)) out.title = `≈ ${short(lx.approx)}`;
    } else if (!o.cell.defined) {
      const reason = o.cell.reason;
      if (reason === 'pending') {
        out.append(el('span', 'cas-pending', '…'));
        out.setAttribute('aria-label', 'calculating');
      } else {
        const prev = lastGood.get(o.name);
        if (prev) {
          const p = prev.cloneNode(true) as HTMLElement;
          p.classList.add('cas-stale');
          out.append(p);
        }
        out.append(el('span', 'cas-reason', reason.replace(/_/g, ' ')));
        if (o.cell.detail) out.title = o.cell.detail;
      }
    } else out.append(el('span', 'cas-plain', valueText(v)));
    const marble = hasDrawing(v)
      ? button(plotted ? '●' : '○', plotted ? `Hide ${o.name} on the graph` : `Show ${o.name} on the graph`, () => {
        const r = session.submit(`${o.name} with plot = ${plotted ? 'false' : 'true'}`);
        if (!r.ok) say(r.error.message);
      }, `cas-marble${plotted ? ' on' : ''}`)
      : el('span', 'cas-marble none');
    if (marble instanceof HTMLButtonElement) marble.setAttribute('aria-pressed', String(plotted));
    li.append(name, el('div', 'cas-body'), marble);
    (li.children[1] as HTMLElement).append(input, err, out);
    li.setAttribute('aria-label', `row ${o.name}: ${rightOf(o.definition)}; result: ${o.cell.defined ? speechOf(v) : o.cell.reason.replace(/_/g, ' ')}`);
    rowEls.set(o.name, li);
    return li;
  };

  const render = (force = false): void => {
    if (element.hidden) return;
    const all = rows();
    if (selectedName !== undefined && !all.some((o) => o.name === selectedName)) selectedName = undefined;
    const kids = all.map((o) => rowFor(o, force));
    // keep the element that has focus in place when nothing about its row changed
    if (kids.length !== list.children.length || kids.some((k, i) => list.children[i] !== k)) list.replaceChildren(...kids);
    for (const n of [...rowEls.keys()]) if (!all.some((o) => o.name === n)) {
      rowEls.delete(n);
      stamps.delete(n);
    }
    empty.hidden = all.length > 0;
  };

  const empty = el('p', 'cas-empty', 'Type an expression below, or write lines such as p = Expr(x^2 - 1) in the list.');
  const body = el('div', 'cas-body-scroll');
  body.append(empty, list, newRow, newErr);
  element.append(head, toolbar, menu, prompt, body);

  // letter shortcuts while the view has focus and no field takes the keys (ui.md 8)
  element.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    const op = ops.find((o) => o.key !== '' && o.key === e.key.toLowerCase());
    if (op) {
      e.preventDefault();
      op.run();
    }
  });

  const open = (): void => {
    element.hidden = false;
    render(true);
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
    refresh: () => render(false),
    selected: () => selectedName,
    select: (n) => {
      selectedName = n;
      render(true);
    },
  };
}

export type { SymValue };
