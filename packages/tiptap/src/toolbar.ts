/**
 * The floating figure toolbar and the AI box (ui.md Writing): Edit lines, AI, Mode, Size, Caption, Save view as
 * default and Delete. It shows while the figure is selected and the writer may change it.
 */
import { MODE_IDS } from '@incantly/modes';
import { HEIGHT_MAX, HEIGHT_MIN, isModeId } from './attrs';
import type { FigureNodeView } from './node-view';

const MODE_LABELS: Readonly<Record<string, string>> = {
  figure: 'Figure',
  graphing: 'Graphing',
  geometry: 'Geometry',
  classic: 'Classic',
  scientific: 'Scientific',
  probability: 'Probability',
  notes: 'Notes',
  cas: 'CAS',
  graphing3d: '3D',
};

export class FigureToolbar {
  readonly el: HTMLElement;
  private readonly editBtn: HTMLButtonElement;
  private readonly aiBtn: HTMLButtonElement;
  private readonly modeSel: HTMLSelectElement;
  private readonly fullBtn: HTMLButtonElement;
  private readonly widthIn: HTMLInputElement;
  private readonly captionIn: HTMLInputElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly aiRow: HTMLElement;
  private readonly aiIn: HTMLInputElement;
  private readonly aiSend: HTMLButtonElement;
  private readonly aiMsg: HTMLElement;

  constructor(private readonly owner: FigureNodeView, private readonly doc: Document) {
    const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
      const el = doc.createElement(tag);
      el.className = cls;
      if (text !== undefined) el.textContent = text;
      return el;
    };
    const button = (label: string, title: string, on: () => void): HTMLButtonElement => {
      const b = h('button', 'inc-tt-btn', label);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', on);
      return b;
    };
    this.el = h('div', 'inc-tt-toolbar');
    this.el.hidden = true;
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Figure');

    this.editBtn = button('Edit lines', 'Edit the figure\'s lines', () => owner.toggleLines());
    this.editBtn.setAttribute('aria-pressed', 'false');
    this.aiBtn = button('AI', 'Ask the AI to draw or change the figure', () => this.toggleAi());
    this.aiBtn.setAttribute('aria-pressed', 'false');

    this.modeSel = h('select', 'inc-tt-select');
    this.modeSel.setAttribute('aria-label', 'Mode');
    for (const id of MODE_IDS) {
      const o = h('option', '', MODE_LABELS[id] ?? id);
      o.value = id;
      this.modeSel.append(o);
    }
    this.modeSel.addEventListener('change', () => {
      if (isModeId(this.modeSel.value)) owner.commitAttrs({ mode: this.modeSel.value }, true);
    });

    this.fullBtn = button('Full width', 'Use the full width of the column', () => owner.commitAttrs({ width: 'full' }, true));
    this.widthIn = h('input', 'inc-tt-input inc-tt-num');
    this.widthIn.type = 'number';
    this.widthIn.min = String(HEIGHT_MIN);
    this.widthIn.max = String(HEIGHT_MAX);
    this.widthIn.placeholder = 'px';
    this.widthIn.setAttribute('aria-label', 'Width in pixels');
    this.widthIn.addEventListener('change', () => {
      const n = Number(this.widthIn.value);
      if (Number.isFinite(n) && n > 0) owner.commitAttrs({ width: Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, n))) }, true);
      else this.sync();
    });

    this.captionIn = h('input', 'inc-tt-input inc-tt-caption-in');
    this.captionIn.type = 'text';
    this.captionIn.placeholder = 'Caption';
    this.captionIn.setAttribute('aria-label', 'Caption');
    const commitCaption = (): void => {
      if (this.captionIn.value !== owner.attrOf('caption', '')) owner.commitAttrs({ caption: this.captionIn.value }, true);
    };
    this.captionIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCaption();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.sync();
        owner.leaveToDocument();
      }
    });
    this.captionIn.addEventListener('blur', commitCaption);

    this.saveBtn = button('Save view as default', 'Make the figure\'s present state its starting state', () => owner.saveViewAsDefault());
    const del = button('Delete', 'Delete the figure', () => owner.deleteSelf());

    const row = h('div', 'inc-tt-row');
    row.append(this.editBtn, this.aiBtn, this.modeSel, this.fullBtn, this.widthIn, this.captionIn, this.saveBtn, del);

    this.aiRow = h('div', 'inc-tt-ai');
    this.aiRow.hidden = true;
    this.aiIn = h('input', 'inc-tt-input inc-tt-ai-in');
    this.aiIn.type = 'text';
    this.aiIn.placeholder = 'Ask for a figure, or a change to this one';
    this.aiIn.setAttribute('aria-label', 'Ask the AI');
    this.aiSend = button('Send', 'Send the request', () => this.send());
    this.aiMsg = h('span', 'inc-tt-ai-msg');
    this.aiMsg.setAttribute('role', 'status');
    this.aiIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.toggleAi(false);
        owner.leaveToDocument();
      }
    });
    this.aiRow.append(this.aiIn, this.aiSend, this.aiMsg);
    this.el.append(row, this.aiRow);
    this.sync();
  }

  show(): void {
    this.el.hidden = false;
    this.sync();
  }

  hide(): void {
    this.el.hidden = true;
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  /** Makes the fields say what the node says (a field being typed in is left alone). */
  sync(): void {
    const o = this.owner;
    const active = this.doc.activeElement;
    this.modeSel.value = o.attrOf('mode', 'figure');
    const width = o.attrOf('width', 'full');
    this.fullBtn.setAttribute('aria-pressed', String(width === 'full'));
    if (active !== this.widthIn) this.widthIn.value = typeof width === 'number' ? String(width) : '';
    if (active !== this.captionIn) this.captionIn.value = o.attrOf('caption', '');
    this.editBtn.setAttribute('aria-pressed', String(o.linesOpen));
    this.saveBtn.hidden = o.live === undefined;
  }

  toggleAi(open?: boolean): void {
    const next = open ?? this.aiRow.hidden;
    this.aiRow.hidden = !next;
    this.aiBtn.setAttribute('aria-pressed', String(next));
    if (next) {
      this.show();
      this.aiIn.focus();
    }
  }

  /** The reason or the notice under the AI box. */
  message(text: string): void {
    this.aiMsg.textContent = text;
  }

  setBusy(busy: boolean): void {
    this.aiSend.disabled = busy;
    this.aiIn.readOnly = busy;
  }

  private send(): void {
    const request = this.aiIn.value.trim();
    if (request === '') {
      this.message('Write what you want the figure to show.');
      return;
    }
    this.message('');
    void this.owner.ask(request);
  }
}
