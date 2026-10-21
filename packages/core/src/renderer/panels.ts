import type { RendererMessage } from '../protocol/runtime-messages';
import type { FormulaView, LegendView, PredictView, TableView } from '../protocol/ui';
import { setDisabled } from './controls';
import { mathElement } from './math';

type Send = (message: RendererMessage) => void;

/** How long after the learner stops typing a formula it is tried. */
export const FORMULA_SETTLE_MS = 350;

/** The card's head (BR-7): figure number, title and a hint on how to use it. */
export class HeaderView {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private number: number | null = null;
  private titleText: string | null = null;

  constructor(doc: Document) {
    this.element = doc.createElement('header');
    this.element.className = 'inc-header';
    this.element.hidden = true;
    this.title = doc.createElement('p');
    this.title.className = 'inc-title';
    this.hint = doc.createElement('p');
    this.hint.className = 'inc-hint';
    this.element.append(this.title, this.hint);
  }

  setNumber(number: number | null): void {
    this.number = number;
    this.render();
  }

  update(card: { readonly title: string | null; readonly hint: string | null }): void {
    this.titleText = card.title;
    this.hint.textContent = card.hint ?? '';
    this.hint.hidden = !card.hint;
    this.render();
  }

  private render(): void {
    const parts = [this.number !== null ? `Figure ${this.number}` : null, this.titleText].filter(Boolean);
    this.title.textContent = parts.join(' · ');
    this.title.hidden = parts.length === 0;
    this.element.hidden = this.title.hidden && this.hint.hidden;
  }
}

/** The legend (G2-9): what each colour means, with switches for series the learner may hide. */
export class LegendPanel {
  readonly element: HTMLElement;
  private signature = '';

  constructor(
    private readonly doc: Document,
    send: Send,
    signal: AbortSignal,
    private readonly onFocus: (part: string | null) => void,
  ) {
    this.element = doc.createElement('ul');
    this.element.className = 'inc-legend';
    this.element.setAttribute('aria-label', 'Legend');
    this.element.hidden = true;
    this.element.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-legend]');
        if (!button) return;
        send({ type: 'legend', id: Number(button.dataset.legend), visible: button.getAttribute('aria-pressed') !== 'true' });
      },
      { signal },
    );
    const focus = (event: Event, on: boolean) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-legend-part]');
      if (item) this.onFocus(on ? (item.dataset.legendPart ?? null) : null);
    };
    this.element.addEventListener('pointerover', (e) => focus(e, true), { signal });
    this.element.addEventListener('pointerout', (e) => focus(e, false), { signal });
  }

  update(entries: readonly LegendView[]): void {
    const signature = JSON.stringify(entries);
    if (signature === this.signature) return;
    this.signature = signature;
    this.element.replaceChildren();
    for (const entry of entries) {
      const item = this.doc.createElement('li');
      item.className = 'inc-legend__item';
      if (entry.part) item.dataset.legendPart = entry.part;
      const swatch = this.doc.createElement('span');
      swatch.className = `inc-legend__swatch inc-swatch--${entry.tone ?? 'mid'}${entry.dashed ? ' is-dashed' : ''}`;
      swatch.setAttribute('aria-hidden', 'true');
      if (entry.toggle) {
        const button = this.doc.createElement('button');
        button.type = 'button';
        button.className = 'inc-legend__toggle';
        button.dataset.legend = String(entry.id);
        button.setAttribute('aria-pressed', String(entry.visible));
        button.append(swatch, entry.label);
        item.append(button);
      } else {
        item.append(swatch, entry.label);
      }
      this.element.append(item);
    }
    this.element.hidden = entries.length === 0;
  }
}

/** Formulas as rendered maths, editable when the scene says so (FM-2, FM-4, RP-8). */
export class FormulasPanel {
  readonly element: HTMLElement;
  private signature = '';
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly doc: Document,
    private readonly scope: string,
    private readonly send: Send,
    signal: AbortSignal,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'inc-formulas';
    this.element.hidden = true;
    this.element.addEventListener(
      'input',
      (event) => {
        const input = event.target as HTMLInputElement;
        const index = Number(input.dataset.formula);
        if (!Number.isInteger(index)) return;
        const pending = this.timers.get(index);
        if (pending !== undefined) clearTimeout(pending);
        this.timers.set(
          index,
          setTimeout(() => {
            this.timers.delete(index);
            this.send({ type: 'formula', index, source: input.value });
          }, FORMULA_SETTLE_MS),
        );
      },
      { signal },
    );
    signal.addEventListener('abort', () => {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
    });
  }

  update(formulas: readonly FormulaView[]): void {
    const shown = formulas.filter((f) => f.editable || f.label);
    const signature = JSON.stringify(shown.map((f) => [f.index, f.label, f.editable]));
    if (signature !== this.signature) {
      this.signature = signature;
      this.element.replaceChildren();
      for (const formula of shown) this.element.append(this.row(formula));
    }
    for (const formula of shown) {
      const row = this.element.querySelector<HTMLElement>(`[data-row="${formula.index}"]`);
      if (!row) continue;
      const math = row.querySelector<HTMLElement>('.inc-formula__math');
      if (math && math.dataset.source !== formula.source) {
        math.dataset.source = formula.source;
        const rendered = mathElement(this.doc, formula.source, 'y');
        math.replaceChildren(rendered ?? this.doc.createTextNode(formula.source));
      }
      const input = row.querySelector<HTMLInputElement>('input');
      if (input && this.doc.activeElement !== input) input.value = formula.draft ?? formula.source;
      const error = row.querySelector<HTMLElement>('.inc-formula__error');
      if (error) {
        error.textContent = formula.error ?? '';
        error.hidden = formula.error === null;
      }
      input?.setAttribute('aria-invalid', String(formula.error !== null));
    }
    this.element.hidden = shown.length === 0;
  }

  private row(formula: FormulaView): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'inc-formula';
    row.dataset.row = String(formula.index);
    const id = `${this.scope}-formula-${formula.index}`;
    const label = this.doc.createElement('label');
    label.className = 'inc-formula__label';
    label.textContent = formula.label || 'Formula';
    const math = this.doc.createElement('span');
    math.className = 'inc-formula__math';
    math.setAttribute('aria-hidden', 'true');
    row.append(label, math);
    if (formula.editable) {
      label.htmlFor = id;
      const input = this.doc.createElement('input');
      input.type = 'text';
      input.id = id;
      input.className = 'inc-formula__input';
      input.dataset.formula = String(formula.index);
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('autocapitalize', 'off');
      input.value = formula.source;
      const error = this.doc.createElement('p');
      error.className = 'inc-formula__error';
      error.id = `${id}-error`;
      error.setAttribute('role', 'status');
      error.hidden = true;
      input.setAttribute('aria-describedby', error.id);
      row.append(input, error);
    } else {
      const text = this.doc.createElement('span');
      text.className = 'inc-visually-hidden';
      text.textContent = formula.source;
      row.append(text);
    }
    return row;
  }
}

/** Predict, then reveal (TE-4): the learner commits to an answer before the figure shows it. Never scored. */
export class PredictPanel {
  readonly element: HTMLElement;
  private signature = '';
  private readonly question: HTMLElement;
  private readonly options: HTMLElement;
  private readonly reveal: HTMLButtonElement;
  private readonly result: HTMLElement;

  constructor(
    private readonly doc: Document,
    send: Send,
    signal: AbortSignal,
  ) {
    this.element = doc.createElement('section');
    this.element.className = 'inc-predict';
    this.element.setAttribute('aria-label', 'Predict');
    this.element.hidden = true;
    this.question = doc.createElement('p');
    this.question.className = 'inc-predict__question';
    this.options = doc.createElement('div');
    this.options.className = 'inc-predict__options';
    this.options.setAttribute('role', 'group');
    this.reveal = doc.createElement('button');
    this.reveal.type = 'button';
    this.reveal.className = 'inc-primary';
    this.reveal.dataset.reveal = '';
    this.reveal.textContent = 'Show me';
    this.result = doc.createElement('p');
    this.result.className = 'inc-predict__result';
    this.result.setAttribute('aria-live', 'polite');
    this.element.append(this.question, this.options, this.reveal, this.result);
    this.element.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest('button');
        if (!button || button.getAttribute('aria-disabled') === 'true') return;
        if (button.dataset.option !== undefined) send({ type: 'predict', index: 0, choice: Number(button.dataset.option) });
        else if (button.dataset.reveal !== undefined) send({ type: 'predict', index: 0, choice: Number(this.element.dataset.chosen ?? -1), reveal: true });
      },
      { signal },
    );
  }

  update(predict: PredictView | null): void {
    if (!predict) {
      this.element.hidden = true;
      return;
    }
    this.element.hidden = false;
    const signature = JSON.stringify([predict.question, predict.options]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.question.textContent = predict.question;
      this.options.setAttribute('aria-label', predict.question);
      this.options.replaceChildren(
        ...predict.options.map((text, i) => {
          const button = this.doc.createElement('button');
          button.type = 'button';
          button.dataset.option = String(i);
          button.textContent = text;
          return button;
        }),
      );
    }
    this.element.dataset.chosen = String(predict.chosen ?? -1);
    for (const button of this.options.querySelectorAll<HTMLButtonElement>('button')) {
      const i = Number(button.dataset.option);
      button.setAttribute('aria-pressed', String(predict.chosen === i));
      setDisabled(button, predict.revealed);
      button.classList.toggle('is-answer', predict.revealed && predict.answer === i);
    }
    setDisabled(this.reveal, predict.chosen === null || predict.revealed);
    this.reveal.hidden = predict.revealed;
    if (predict.revealed) {
      const right = predict.answer !== null && predict.chosen === predict.answer;
      const answer = predict.answer !== null ? predict.options[predict.answer] : null;
      const verdict = answer === null ? '' : right ? 'You predicted it. ' : `It is “${answer}”. `;
      this.result.textContent = `${verdict}${predict.explanation ?? ''}`.trim();
    } else this.result.textContent = '';
  }
}

/** Live tables beside the drawing (DG-2). */
export class TablesPanel {
  readonly element: HTMLElement;
  private signature = '';

  constructor(private readonly doc: Document) {
    this.element = doc.createElement('div');
    this.element.className = 'inc-tables';
    this.element.hidden = true;
  }

  update(tables: readonly TableView[]): void {
    const signature = JSON.stringify(tables.map((t) => [t.title, t.columns]));
    if (signature !== this.signature) {
      this.signature = signature;
      this.element.replaceChildren(
        ...tables.map((table) => {
          const element = this.doc.createElement('table');
          element.className = 'inc-table';
          const caption = this.doc.createElement('caption');
          caption.textContent = table.title;
          const head = this.doc.createElement('thead');
          const row = this.doc.createElement('tr');
          for (const column of table.columns) {
            const th = this.doc.createElement('th');
            th.scope = 'col';
            th.textContent = column;
            row.append(th);
          }
          head.append(row);
          element.append(caption, head, this.doc.createElement('tbody'));
          return element;
        }),
      );
    }
    tables.forEach((table, i) => {
      const body = this.element.querySelectorAll('table')[i]?.querySelector('tbody');
      if (!body) return;
      for (let r = 0; r < table.rows.length; r++) {
        let tr = body.children[r];
        if (!tr) tr = body.appendChild(this.doc.createElement('tr'));
        const cells = table.rows[r]!;
        for (let c = 0; c < table.columns.length; c++) {
          const td = tr.children[c] ?? tr.appendChild(this.doc.createElement('td'));
          const text = cells[c] ?? '';
          if (td.textContent !== text) td.textContent = text;
        }
      }
      while (body.children.length > table.rows.length) body.lastElementChild?.remove();
    });
    this.element.hidden = tables.length === 0;
  }
}
