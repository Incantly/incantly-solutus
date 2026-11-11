/**
 * `<incantly-error-card>`: shows one unified error object away from the input line (docs/features/errors/ui.md sections 1, 3
 * and 8): the message with a leading "!" (never colour alone), the hint, the nearest cause, one-click fixes from `suggest`,
 * and the objects named in `related` and `path`. It is a polite live region and is never a dialog.
 */
import type { ErrorObject } from '@incantly/kernel';
import { emit, h, styleEl } from './dom';
import { CARD_CSS, THEME_CSS } from './styles';

/** `incantly-fix`: the person chose a suggested line. The host puts it in the input; it does not run it. */
export interface FixDetail {
  readonly line: string;
}

/** `incantly-goto`: the person chose a related object. */
export interface GotoDetail {
  readonly name: string;
}

/** The names an error points at, once each, in the order `related` then `path`. */
export function errorNames(e: ErrorObject): string[] {
  return [...new Set([...(e.related ?? []), ...(e.path ?? [])])];
}

export class ErrorCardElement extends HTMLElement {
  private err: ErrorObject | null = null;
  private tech = false;
  private readonly live = h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).append(styleEl(THEME_CSS + CARD_CSS), this.live);
    this.live.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      const fix = t?.closest('button[data-fix]');
      const go = t?.closest('button[data-goto]');
      if (fix) emit<FixDetail>(this, 'incantly-fix', { line: fix.getAttribute('data-fix') ?? '' });
      else if (go) emit<GotoDetail>(this, 'incantly-goto', { name: go.getAttribute('data-goto') ?? '' });
      else if (t?.closest('button.close')) this.error = null;
    });
    this.hidden = true;
  }

  get error(): ErrorObject | null {
    return this.err;
  }
  set error(e: ErrorObject | null) {
    this.err = e;
    this.render();
  }

  /** Show the kind and code before the message ("technical messages" setting, off by default). */
  get technical(): boolean {
    return this.tech;
  }
  set technical(on: boolean) {
    this.tech = on;
    this.render();
  }

  private render(): void {
    const e = this.err;
    this.hidden = e === null;
    if (e === null) {
      this.live.replaceChildren();
      return;
    }
    const main = h('div', { class: 'main' }, h('p', { class: 'msg' }, `${this.tech ? `${e.kind} ${e.code}: ` : ''}${e.message}`));
    if (e.hint) main.append(h('p', { class: 'hint' }, e.hint));
    let cause = e.cause;
    if (cause) {
      const ol = h('ol', { class: 'why', 'aria-label': 'Because' });
      while (cause) {
        ol.append(h('li', {}, cause.message));
        cause = cause.cause;
      }
      main.append(ol);
    }
    const names = errorNames(e);
    if (names.length > 0) {
      const row = h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Related:'));
      for (const n of names) row.append(h('button', { type: 'button', 'data-goto': n, 'aria-label': `Go to ${n}` }, n));
      main.append(row);
    }
    if (e.suggest.length > 0) {
      const row = h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Try:'));
      for (const s of e.suggest) row.append(h('button', { type: 'button', 'data-fix': s }, s));
      main.append(row);
    }
    this.live.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('span', { class: 'bang', 'aria-hidden': 'true' }, '!'),
        main,
        h('button', { type: 'button', class: 'close', 'aria-label': 'Dismiss message' }, '×'),
      ),
    );
  }
}
