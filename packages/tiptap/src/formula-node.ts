/**
 * The `incantlyFormula` node (design 1.8): an inline atom that shows the live value of an expression read from a
 * figure in the document, as typeset text; with no figure it shows the expression as a maths text. A failing
 * expression shows itself with an error mark, and the message on hover.
 */
import { Node } from '@tiptap/core';
import type { Editor, NodeViewRenderer } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { prettyText } from '@incantly/kernel';
import { math } from '@incantly/view';
import { tiptapError } from './errors';
import type { TiptapError } from './errors';
import { FORMULA_NAME } from './doc';
import { evaluateExpr } from './formula';
import { reportError } from './report';
import { runtimeOf } from './runtime';
import type { EditorRuntime } from './runtime';
import { addStyles } from './styles';
import { DEFAULT_OPTIONS } from './types';
import type { IncantlyTiptapOptions } from './types';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    incantlyFormula: {
      /** Inserts a formula: the value of `expr` read from the figure with the id `figure` (none: the expression as maths). */
      insertIncantlyFormula: (options: { expr: string; figure?: string; format?: string }) => ReturnType;
    };
  }
}

const FORMULA_CSS = `
.inc-tt-formula{display:inline-block;padding:0 3px;border-radius:4px;background:#f1f4f9;color:#1f2430;font-variant-numeric:tabular-nums}
.inc-tt-formula svg{display:inline-block}
.inc-tt-formula-bad{background:#fff4f4;text-decoration:underline wavy #c0392b;text-underline-offset:3px;cursor:help}
.ProseMirror-selectednode.inc-tt-formula{outline:2px solid #2f6fdb}
`;

const text = (x: unknown): string => (typeof x === 'string' ? x : '');

/** A glyph measure from a canvas where there is one, else a rough table. */
function measureFor(doc: Document): math.Measure {
  const ctx = ((): CanvasRenderingContext2D | null => {
    try {
      return doc.createElement('canvas').getContext('2d');
    } catch {
      return null;
    }
  })();
  if (!ctx) return math.roughMeasure;
  const c = ctx;
  return (s, font, px) => {
    c.font = math.cssFont(font, px);
    const m = c.measureText(s);
    return { w: m.width, asc: m.actualBoundingBoxAscent || px * 0.72, desc: m.actualBoundingBoxDescent || px * 0.22 };
  };
}

const frame = (fn: () => void): number => {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
  return typeof raf === 'function' ? raf(fn) : (setTimeout(fn, 16) as unknown as number);
};

const cancelFrame = (h: number): void => {
  const caf = (globalThis as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame;
  if (typeof caf === 'function') caf(h);
  else clearTimeout(h);
};

export class FormulaNodeView implements NodeView {
  readonly dom: HTMLElement;
  private node: PmNode;
  private readonly runtime: EditorRuntime;
  private readonly doc: Document;
  private off: (() => void) | undefined;
  private watching = '';
  private pending: number | undefined;
  private settle: ReturnType<typeof setTimeout> | undefined;
  private lastError = '';
  private destroyed = false;

  constructor(
    private readonly editor: Editor,
    private readonly options: IncantlyTiptapOptions,
    node: PmNode,
  ) {
    this.node = node;
    this.doc = editor.view.dom.ownerDocument;
    addStyles(this.doc, 'incantly-tiptap-formula-style', FORMULA_CSS);
    this.runtime = runtimeOf(editor, options);
    this.dom = this.doc.createElement('span');
    this.dom.className = 'inc-tt-formula';
    this.refresh();
  }

  private get expr(): string {
    return text(this.node.attrs['expr']);
  }

  private get figure(): string {
    return text(this.node.attrs['figure']);
  }

  /** Reads the value now and shows it. */
  private refresh(): void {
    if (this.destroyed) return;
    const { expr, figure } = this;
    const format = text(this.node.attrs['format']);
    this.follow(figure);
    this.dom.classList.remove('inc-tt-formula-bad');
    this.dom.removeAttribute('title');
    if (figure === '') {
      this.showMath(expr);
      return;
    }
    const store = this.runtime.store;
    if (!store.has(figure)) {
      // the figure's own view may come later in the document: wait for it, and say so only if it never comes
      this.dom.textContent = expr;
      if (this.settle === undefined) {
        this.settle = setTimeout(() => {
          this.settle = undefined;
          if (!this.destroyed && !this.runtime.store.has(this.figure)) {
            this.fail(tiptapError('formula_failed', `There is no figure with the id ${this.figure}.`, { hint: 'Give the formula the id of a figure in this document.', node: this.figure }));
          }
        }, 0);
      }
      return;
    }
    const app = store.appFor(figure);
    if (!app) {
      this.fail(tiptapError('formula_failed', 'The figure could not be read.', { node: figure }));
      return;
    }
    const r = evaluateExpr(app, expr, format, figure);
    if (r.ok) {
      this.lastError = '';
      this.dom.textContent = r.text;
      this.dom.setAttribute('aria-label', `${expr} = ${r.text}`);
    } else this.fail(r.error);
  }

  private fail(error: TiptapError): void {
    this.dom.classList.add('inc-tt-formula-bad');
    this.dom.textContent = this.expr;
    this.dom.title = error.hint ? `${error.message} ${error.hint}` : error.message;
    this.dom.setAttribute('aria-label', `${this.expr}: ${error.message}`);
    const key = `${this.expr}|${error.message}`;
    if (key !== this.lastError) {
      this.lastError = key;
      reportError(this.editor, this.options, error);
    }
  }

  /** The expression as maths text, typeset to SVG. */
  private showMath(expr: string): void {
    this.lastError = '';
    try {
      const pretty = (() => {
        try {
          return prettyText(expr);
        } catch {
          return expr;
        }
      })();
      const layout = math.layoutText(`$${pretty}$`, 16, measureFor(this.doc));
      this.dom.innerHTML = math.mathSvg(layout);
      this.dom.setAttribute('aria-label', expr);
    } catch {
      this.dom.textContent = expr;
    }
  }

  /** Follows the figure's changes, at most once a frame. */
  private follow(figure: string): void {
    if (figure === this.watching) return;
    this.off?.();
    this.off = undefined;
    this.watching = figure;
    if (figure === '') return;
    this.off = this.runtime.store.watch(figure, () => {
      if (this.pending !== undefined || this.destroyed) return;
      this.pending = frame(() => {
        this.pending = undefined;
        this.refresh();
      });
    });
  }

  update(node: PmNode): boolean {
    if (this.destroyed || node.type !== this.node.type) return false;
    this.node = node;
    this.refresh();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.off?.();
    if (this.pending !== undefined) cancelFrame(this.pending);
    if (this.settle !== undefined) clearTimeout(this.settle);
  }
}

export const IncantlyFormula = Node.create<IncantlyTiptapOptions>({
  name: FORMULA_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { ...DEFAULT_OPTIONS };
  },

  addAttributes() {
    return {
      expr: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-expr') ?? el.textContent ?? '' },
      figure: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-figure') ?? '' },
      format: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-format') ?? '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-incantly-formula]' }];
  },

  renderHTML({ node }) {
    const a = node.attrs as Record<string, unknown>;
    return [
      'span',
      { 'data-incantly-formula': '', 'data-expr': text(a['expr']), 'data-figure': text(a['figure']), 'data-format': text(a['format']) },
      text(a['expr']),
    ];
  },

  addNodeView(): NodeViewRenderer {
    const editor = this.editor;
    const options = this.options;
    return ({ node }) => new FormulaNodeView(editor, options, node);
  },

  addCommands() {
    const options = this.options;
    const name = this.name;
    return {
      insertIncantlyFormula:
        (o) =>
        ({ editor, commands }) => {
          if (typeof o !== 'object' || o === null || typeof o.expr !== 'string' || o.expr.trim() === '') {
            reportError(editor, options, tiptapError('formula_failed', 'A formula needs an expression.', { hint: 'Pass expr, such as "Area(p)".' }));
            return false;
          }
          return commands.insertContent({ type: name, attrs: { expr: o.expr, figure: o.figure ?? '', format: o.format ?? '' } });
        },
    };
  },
});
