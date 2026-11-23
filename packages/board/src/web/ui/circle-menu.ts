/**
 * The suggestions beside a circle (design 11.1, docs/state-machines.md B33): they appear at once when the loop closes, from
 * the item kinds alone, and each is one button. "Ask something else" opens a box for the user's own words. Esc, or a press
 * on the board, puts them away. The menu is a view of `CircleAsk`: it holds no state of its own, only the element.
 */
import type { Camera } from '../../core/camera';
import type { CircleAsk } from '../../core/circle';
import type { Strings } from '../../core/strings';

const h = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

export interface CircleMenuOptions {
  readonly doc: Document;
  readonly root: HTMLElement;
  readonly circle: CircleAsk;
  readonly strings: Strings;
  /** Called after a pick, so the board takes the focus back. */
  readonly focusBoard: () => void;
}

export class CircleMenu {
  readonly element: HTMLElement;
  readonly #o: CircleMenuOptions;
  readonly #off: () => void;
  /** The circle's serial the buttons were made for: the buttons are built again only for a new circle. */
  #builtFor = '';

  constructor(options: CircleMenuOptions) {
    this.#o = options;
    this.element = h(options.doc, 'div', { class: 'ib-menu ib-suggest', role: 'dialog', 'aria-label': options.strings.t('ask.label'), hidden: '' });
    options.root.append(this.element);
    this.element.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        options.circle.dismiss();
        options.focusBoard();
      }
    });
    this.#off = options.circle.on(() => this.#sync());
  }

  /** Puts the menu beside the circle's lower right corner, kept inside the board. */
  place(camera: Camera | undefined): void {
    if (this.element.hidden || camera === undefined) return;
    const [x, y, w, hh] = this.#o.circle.found.box;
    const corner = camera.toScreen(x + w, y + hh);
    const at = this.#o.root.getBoundingClientRect();
    const mw = this.element.offsetWidth || 220;
    const mh = this.element.offsetHeight || 200;
    const left = Math.max(8, Math.min(corner.x + 10, at.width - mw - 8));
    const top = Math.max(8, Math.min(corner.y + 10, at.height - mh - 8));
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
  }

  dispose(): void {
    this.#off();
    this.element.remove();
  }

  #sync(): void {
    const { circle, doc, strings } = this.#o;
    if (circle.state !== 'choosing') {
      this.element.hidden = true;
      this.#builtFor = '';
      return;
    }
    const serial = `${circle.found.box.join(',')}|${circle.suggestions.map((s) => s.choice).join(',')}`;
    if (serial === this.#builtFor && !this.element.hidden) return;
    this.#builtFor = serial;
    this.element.replaceChildren();
    for (const s of circle.suggestions) {
      const b = h(doc, 'button', { type: 'button', 'data-choice': s.choice }, strings.t(`ask.choice.${s.choice}`, s.label));
      b.addEventListener('click', () => {
        if (s.choice === 'ask') this.#askBox();
        else {
          void circle.pick(s.choice);
          this.#o.focusBoard();
        }
      });
      this.element.append(b);
    }
    this.element.hidden = false;
    (this.element.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  /** "Ask something else": a box for the user's own words. */
  #askBox(): void {
    const { circle, doc, strings } = this.#o;
    const input = h(doc, 'input', { type: 'text', class: 'ib-suggest-input', placeholder: strings.t('ask.placeholder'), 'aria-label': strings.t('ask.placeholder'), maxlength: '2000' });
    const go = h(doc, 'button', { type: 'submit' }, strings.t('ask.go'));
    const form = h(doc, 'form', { class: 'ib-suggest-form' }, input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text === '') return;
      void circle.pick('ask', text);
      this.#o.focusBoard();
    });
    this.element.querySelector('[data-choice="ask"]')?.replaceWith(form);
    input.focus({ preventScroll: true });
  }
}
