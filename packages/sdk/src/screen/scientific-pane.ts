/**
 * The scientific calculator's results column (app-modes ui 2 "Scientific"). Each line is the object `r1`, `r2`, …,
 * and `ans` stands for the latest. In degrees the trig functions take and give degrees. S↔D shows an exact fraction
 * or a decimal.
 */
import { formatNumber, reasonPhrase, valueText } from '@incantly/kernel';
import type { App } from '../app';

export interface ScientificView {
  readonly element: HTMLElement;
  refresh(): void;
  dispose(): void;
}

const TRIG = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'];
const ARC = ['asin', 'acos', 'atan', 'asec', 'acsc', 'acot'];

function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** In degrees: `sin(30)` becomes `sin((30) * pi / 180)` and `asin(x)` gives degrees. */
function inDegrees(src: string): string {
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

/** The results column for one app. `say` is the app's status line. */
export function mountScientific(app: App, say: (text: string) => void): ScientificView {
  const element = document.createElement('section');
  element.className = 'sci-view';
  element.setAttribute('aria-label', 'Calculator');
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
  sd.title = 'Exact or decimal';
  sd.setAttribute('aria-label', 'Exact or decimal');
  const input = document.createElement('input');
  input.className = 'sci-input expr-input';
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = 'Calculate';
  input.setAttribute('aria-label', 'Calculate');
  const err = document.createElement('p');
  err.className = 'sci-error';
  err.setAttribute('role', 'alert');
  const form = document.createElement('div');
  form.className = 'sci-new';
  form.append(input, err);
  bar.append(angle, sd);
  element.append(bar, list, form);

  const typedOf = new Map<string, string>();
  let exact = true;
  let degrees = app.settings.angleUnit === 'degree';

  const calcRows = (): { readonly typed: string; readonly name: string }[] =>
    app.figure.objects().filter((o) => /^r\d+$/.test(o.name)).map((o) => ({ name: o.name, typed: typedOf.get(o.name) ?? o.definition.replace(/^[^=]*=\s*/, '') }));

  const fmt = (x: number, asExact: boolean): string => {
    const r = app.settings.rounding;
    return formatNumber(x, { decimals: r.mode === 'decimals' ? r.digits : 2, significant: r.mode === 'sig' ? r.digits : null, notation: asExact ? 'fraction' : 'decimal', trimZeros: true }).text;
  };

  const resultOf = (name: string): { text: string; decimal?: string; bad: boolean } => {
    const o = app.figure.get(name);
    if (!o) return { text: '—', bad: true };
    if (!o.cell.defined) return { text: reasonPhrase(o.cell.reason ?? 'undefined').noun, bad: true };
    const v = app.figure.value(name);
    if (typeof v === 'number') {
      const ex = fmt(v, exact);
      const dec = fmt(v, false);
      return { text: ex, ...(exact && ex !== dec ? { decimal: dec } : {}), bad: false };
    }
    return { text: valueText(v), bad: false };
  };

  const render = (): void => {
    angle.textContent = degrees ? 'DEG' : 'RAD';
    angle.title = degrees ? 'Degrees' : 'Radians';
    sd.classList.toggle('on', exact);
    sd.setAttribute('aria-pressed', String(exact));
    list.replaceChildren();
    for (const r of calcRows()) {
      const res = resultOf(r.name);
      const li = document.createElement('li');
      li.className = `sci-row${res.bad ? ' bad' : ''}`;
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
    while (app.figure.get(`r${n}`)) n++;
    return `r${n}`;
  };

  const run = (text: string): boolean => {
    const typed = text.trim();
    if (!typed) return false;
    const last = calcRows().at(-1)?.name;
    let src = typed.replace(/\b[Aa]ns\b/g, last ?? '0');
    if (degrees) src = inDegrees(src);
    const name = nextName();
    const [r] = app.as('user', () => app.run(`${name} = ${src}`));
    if (!r || !r.ok) {
      const msg = r && 'message' in r ? r.message.replace(new RegExp(`\\b${name}\\b`, 'g'), 'this row') : 'That line did not run.';
      const hint = r && 'hint' in r && typeof r.hint === 'string' ? ` ${r.hint}` : '';
      err.textContent = `${msg}${hint}`;
      say(msg);
      return false;
    }
    err.textContent = '';
    typedOf.set(name, typed);
    render();
    say(`${typed} = ${resultOf(name).text}`);
    return true;
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (run(input.value)) input.value = '';
    } else if (e.key === 'Escape') input.value = '';
  });
  sd.addEventListener('click', () => {
    exact = !exact;
    render();
  });
  angle.addEventListener('click', () => {
    degrees = !degrees;
    render();
  });
  render();
  return { element, refresh: render, dispose: () => element.remove() };
}
