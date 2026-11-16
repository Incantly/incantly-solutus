/**
 * The scientific calculator's results column (app-modes ui 2 "Scientific"; design 7.5): each calc line is the hidden
 * object `r1`, `r2`, …, and `ans` stands for the latest. The language does not change. `S↔D` shows an exact fraction or a
 * decimal; in degrees the trig functions take and give degrees. A tap on a row copies its expression into the input.
 */
import { formatNumber, reasonPhrase, valueText } from '@incantly/kernel';
import type { I18n, Settings, Rounding } from '@incantly/modes';
import type { KernelSession } from '../session';

export interface ScientificView {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Runs one calc line; returns the result text, or the error message. */
  run(text: string): { ok: boolean; text: string };
  toggleExact(): void;
  toggleAngle(): void;
  refresh(): void;
}

const TRIG = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'];
const ARC = ['asin', 'acos', 'atan', 'asec', 'acsc', 'acot'];

/** The end of the bracket that opens at `open` in `s`, or -1. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** In degrees: `sin(30)` becomes `sin((30) * pi / 180)` and `asin(x)` gives degrees (ui 2: the deg indicator). */
export function inDegrees(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const m = /^[a-z]+(?=\()/.exec(src.slice(i));
    const before = i > 0 ? (src[i - 1] as string) : ' ';
    if (m && !/[A-Za-z0-9_]/.test(before) && (TRIG.includes(m[0]) || ARC.includes(m[0]))) {
      const name = m[0];
      const open = i + name.length;
      const close = closing(src, open);
      if (close < 0) return src;
      const inner = inDegrees(src.slice(open + 1, close));
      out += TRIG.includes(name) ? `${name}((${inner}) * pi / 180)` : `(${name}(${inner}) * 180 / pi)`;
      i = close + 1;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

export function mountScientific(session: KernelSession, settings: Settings, i18n: I18n, say: (t: string) => void): ScientificView {
  const element = document.createElement('section');
  element.className = 'sci-view';
  element.setAttribute('aria-label', i18n.t('mode.scientific.title'));
  element.hidden = true;
  const list = document.createElement('ol');
  list.className = 'sci-rows';
  list.setAttribute('aria-live', 'polite');
  const bar = document.createElement('div');
  bar.className = 'sci-bar';
  const angle = document.createElement('button');
  angle.type = 'button';
  angle.className = 'sci-angle';
  const sd = document.createElement('button');
  sd.type = 'button';
  sd.className = 'sci-sd';
  sd.textContent = 'S↔D';
  sd.title = i18n.t('sci.toggle');
  sd.setAttribute('aria-label', i18n.t('sci.toggle'));
  const input = document.createElement('input');
  input.className = 'sci-input expr-input';
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = i18n.t('sci.placeholder');
  input.setAttribute('aria-label', i18n.t('sci.placeholder'));
  const err = document.createElement('p');
  err.className = 'sci-error';
  err.setAttribute('role', 'alert');
  const form = document.createElement('div');
  form.className = 'sci-new';
  form.append(input, err);
  bar.append(angle, sd);
  element.append(bar, list, form);

  /** What the learner typed for each hidden row (the figure holds the line itself). */
  const typedOf = new Map<string, string>();
  /** The calc rows of the figure, in order: `r1`, `r2`, … (also those of a loaded script). */
  const calcRows = (): { readonly typed: string; readonly name: string }[] =>
    session.figure.objects().filter((o) => /^r\d+$/.test(o.name)).map((o) => ({ name: o.name, typed: typedOf.get(o.name) ?? o.definition.replace(/^[^=]*=\s*/, '') }));
  let exact = true;

  const rounding = (): Rounding => settings.get<Rounding>('rounding');
  const fmt = (x: number, asExact: boolean): string => {
    const r = rounding();
    const f = formatNumber(x, { decimals: r.mode === 'decimals' ? r.digits : 2, significant: r.mode === 'sig' ? r.digits : null, notation: asExact ? 'fraction' : 'decimal', trimZeros: true });
    return f.text;
  };

  const resultOf = (name: string): { text: string; decimal?: string; bad: boolean } => {
    const o = session.figure.get(name);
    if (!o) return { text: '—', bad: true };
    if (!o.cell.defined) return { text: reasonPhrase(o.cell.reason ?? 'undefined').noun, bad: true };
    const v = session.figure.value(name);
    if (typeof v === 'number') {
      const ex = fmt(v, exact);
      const dec = fmt(v, false);
      return { text: ex, ...(exact && ex !== dec ? { decimal: dec } : {}), bad: false };
    }
    return { text: valueText(v), bad: false };
  };

  const render = (): void => {
    angle.textContent = settings.get<string>('angleUnit') === 'degree' ? 'DEG' : 'RAD';
    angle.title = settings.get<string>('angleUnit') === 'degree' ? i18n.t('value.degree') : i18n.t('value.radian');
    sd.classList.toggle('on', exact);
    sd.setAttribute('aria-pressed', String(exact));
    list.replaceChildren();
    for (const r of calcRows()) {
      const res = resultOf(r.name);
      const li = document.createElement('li');
      li.className = `sci-row${res.bad ? ' bad' : ''}`;
      li.dataset['name'] = r.name;
      const expr = document.createElement('button');
      expr.type = 'button';
      expr.className = 'sci-expr';
      expr.textContent = r.typed;
      expr.title = 'Copy into the input';
      expr.addEventListener('click', () => {
        input.value = r.typed;
        input.focus();
      });
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'sci-result';
      out.textContent = res.text;
      out.title = 'Copy the result into the input';
      out.addEventListener('click', () => {
        const at = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, at) + r.name + input.value.slice(at);
        input.focus();
      });
      li.append(expr, out);
      if (res.decimal) {
        const d = document.createElement('span');
        d.className = 'sci-decimal';
        d.textContent = `= ${res.decimal}`;
        li.append(d);
      }
      list.append(li);
    }
    list.scrollTop = list.scrollHeight;
  };

  const nextName = (): string => {
    let n = calcRows().length + 1;
    while (session.figure.get(`r${n}`)) n++;
    return `r${n}`;
  };

  const api: ScientificView = {
    element,
    input,
    open() {
      element.hidden = false;
      render();
    },
    close() {
      element.hidden = true;
    },
    isOpen: () => !element.hidden,
    run(text) {
      const typed = text.trim();
      if (!typed) return { ok: false, text: '' };
      const last = calcRows().at(-1)?.name;
      let src = typed.replace(/\b[Aa]ns\b/g, last ?? '0');
      if (settings.get<string>('angleUnit') === 'degree') src = inDegrees(src);
      const name = nextName();
      const r = session.submit(`${name} = ${src}`);
      if (!r.ok) {
        // the message names the hidden row's line; the learner typed only the expression
        const msg = r.error.message.replace(new RegExp(`\\b${name}\\b`, 'g'), 'this row');
        err.textContent = r.error.hint ? `${msg} ${r.error.hint}` : msg;
        say(msg);
        return { ok: false, text: msg };
      }
      err.textContent = '';
      typedOf.set(name, typed);
      render();
      const res = resultOf(name);
      say(`${typed} = ${res.text}`);
      return { ok: true, text: res.text };
    },
    toggleExact() {
      exact = !exact;
      render();
    },
    toggleAngle() {
      const next = settings.get<string>('angleUnit') === 'degree' ? 'radian' : 'degree';
      const r = settings.set('angleUnit', next);
      if (!r.ok) say(r.message);
      render();
    },
    refresh() {
      if (!element.hidden) render();
    },
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (api.run(input.value).ok) input.value = '';
    } else if (e.key === 'Escape') input.value = '';
  });
  sd.addEventListener('click', () => api.toggleExact());
  angle.addEventListener('click', () => api.toggleAngle());
  return api;
}
