import { checkStyle, type ExecutionAdapter, type FigureStyle } from '@incantly/core';
import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import {
  CONTENT_REF,
  DEFAULT_ASPECT,
  defaultAttributes,
  parseJson,
  parseNumber,
  sanitizeFormulas,
  sanitizeFragments,
  sanitizeLook,
  sanitizeMeta,
  sanitizeValues,
  sanitizeVersions,
  type FigureAttributes,
} from './attributes';
import { FIGURE_TRANSACTION, FigureNodeView, figureViews, type FigureErrorReport, type FigureRepair, type FigureSignal } from './node-view';
import { LiveFigureScheduler, type SchedulerOptions } from './scheduler';
import type { FigureStore } from './store';

export interface SnapshotSource {
  /** Returns a renderable image URL for a snapshot hash, if it is available. */
  url(ref: string): string | undefined;
}

export interface FigureNodeOptions {
  /** Placeholder-only views use this to show snapshots. */
  snapshots: SnapshotSource | null;
  /** Runs live figures. Without one, figures stay placeholders. */
  adapter: ExecutionAdapter | null;
  /** Where snapshots and large fragments are kept by content reference. */
  store: FigureStore | null;
  scheduler: SchedulerOptions;
  /** Learner changes are saved this long after the last one. */
  settleMs: number;
  theme: 'light' | 'dark' | 'auto';
  /** Hears about each problem a live figure runs into, for the host's own reporting. */
  onError: ((report: FigureErrorReport) => void) | null;
  /** Hears how figures are used, for product signals: ids, names and numbers only. */
  signals: ((signal: FigureSignal) => void) | null;
  /**
   * How every figure in this editor looks: a preset, design tokens, classes per
   * part (for Tailwind and the like), the host's own CSS, the layout of the
   * controls around the drawing, the drawing's height and which parts show.
   * A figure's `look` attribute goes over it.
   */
  style: FigureStyle | null;
  /** Show each figure's number in the note (Fig 1, Fig 2) on its card. */
  numbering: boolean;
  /**
   * Repairs a figure that hit a problem while live, in the background (RP-7),
   * such as @incantly/generation/client's figureRepairer. Without it, a figure
   * that hits a problem offers to go back to its working version.
   */
  repair: FigureRepair | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    incantlyFigure: {
      insertFigure: (attributes: Partial<FigureAttributes>) => ReturnType;
      /** Sets the selected figure's own look over the editor's style; null goes back to the editor's. */
      setFigureLook: (look: FigureStyle | null) => ReturnType;
      /** Brings back an earlier version of the selected figure, or of the one with `figureId`, by its place in the history (HO-9). */
      restoreFigureVersion: (index: number, figureId?: string) => ReturnType;
    };
  }
}

const jsonAttribute = <T>(name: string, fallback: T, sanitize: (value: unknown) => T) => ({
  default: fallback,
  parseHTML: (element: HTMLElement) => sanitize(parseJson<unknown>(element.getAttribute(`data-${name}`), fallback)),
  renderHTML: (attributes: Record<string, unknown>) => ({
    [`data-${name}`]: JSON.stringify(attributes[camel(name)] ?? fallback),
  }),
});

const textAttribute = (name: string, fallback: string | null, pattern?: RegExp) => ({
  default: fallback,
  parseHTML: (element: HTMLElement) => {
    const value = element.getAttribute(`data-${name}`);
    if (value === null) return fallback;
    return pattern && !pattern.test(value) ? fallback : value;
  },
  renderHTML: (attributes: Record<string, unknown>) => {
    const value = attributes[camel(name)];
    return value === null || value === undefined ? {} : { [`data-${name}`]: String(value) };
  },
});

const numberAttribute = (name: string, fallback: number | null) => ({
  default: fallback,
  parseHTML: (element: HTMLElement) => {
    const raw = element.getAttribute(`data-${name}`);
    if (raw === null) return fallback;
    return parseNumber(raw, fallback ?? 0);
  },
  renderHTML: (attributes: Record<string, unknown>) => {
    const value = attributes[camel(name)];
    return value === null || value === undefined ? {} : { [`data-${name}`]: String(value) };
  },
});

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

const schedulers = new WeakMap<Editor, LiveFigureScheduler>();

function schedulerFor(editor: Editor, options: SchedulerOptions): LiveFigureScheduler {
  let scheduler = schedulers.get(editor);
  if (!scheduler) {
    scheduler = new LiveFigureScheduler(options);
    schedulers.set(editor, scheduler);
  }
  return scheduler;
}

/**
 * Saves what learners changed in the editor's figures and has not been saved
 * yet. Call it before reading the document to store it; destroying the editor
 * does it too, but only after the document has been read.
 */
export function flushFigures(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dom.querySelectorAll('figure.incantly-figure').forEach((element) => figureViews.get(element)?.flush());
}

/** The live-figure scheduler of an editor, if it has created one. */
export function figureScheduler(editor: Editor): LiveFigureScheduler | undefined {
  return schedulers.get(editor);
}

export function newFigureId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `fig-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const figureIds = new PluginKey('incantlyFigureIds');
const figureNumbers = new PluginKey('incantlyFigureNumbers');

/**
 * The figure node. Every attribute is rendered to HTML so that copy and paste
 * and HTML export round-trip the figure; large content is stored by content
 * reference. See ADR 007.
 */
export const FigureNode = Node.create<FigureNodeOptions>({
  name: 'incantlyFigure',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { snapshots: null, adapter: null, store: null, scheduler: {}, settleMs: 600, theme: 'auto', onError: null, signals: null, style: null, numbering: false, repair: null };
  },

  addAttributes() {
    const d = defaultAttributes();
    return {
      figureId: textAttribute('figure-id', d.figureId, /^[\w-]{1,64}$/),
      concept: textAttribute('concept', d.concept),
      sdkVersion: textAttribute('sdk-version', d.sdkVersion, /^\d+\.\d+\.\d+$/),
      schemaVersion: numberAttribute('schema-version', d.schemaVersion),
      fragments: jsonAttribute('fragments', d.fragments, sanitizeFragments),
      fragmentsRef: textAttribute('fragments-ref', d.fragmentsRef, CONTENT_REF),
      defaults: jsonAttribute('defaults', d.defaults, sanitizeValues),
      values: jsonAttribute('values', d.values, sanitizeValues),
      step: numberAttribute('step', d.step),
      snapshotRef: textAttribute('snapshot-ref', d.snapshotRef, CONTENT_REF),
      description: textAttribute('description', d.description),
      aspect: numberAttribute('aspect', d.aspect),
      meta: jsonAttribute('meta', d.meta, sanitizeMeta),
      formulas: jsonAttribute('formulas', d.formulas, sanitizeFormulas),
      look: jsonAttribute('look', d.look, sanitizeLook),
      versions: jsonAttribute('versions', d.versions, sanitizeVersions),
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-incantly-figure]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const description = String(node.attrs.description ?? '');
    return ['figure', mergeAttributes({ 'data-incantly-figure': '' }, HTMLAttributes), ['figcaption', description]];
  },

  addCommands() {
    return {
      insertFigure:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { ...defaultAttributes(), figureId: newFigureId(), ...attributes },
          }),
      setFigureLook:
        (look) =>
        ({ state, tr, dispatch }) => {
          const { selection } = state;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false;
          const checked = look === null ? null : checkStyle(look);
          if (dispatch) tr.setNodeAttribute(selection.from, 'look', checked && Object.keys(checked).length > 0 ? checked : null);
          return true;
        },
      restoreFigureVersion:
        (index, figureId) =>
        ({ state, view, dispatch }) => {
          let pos: number | null = null;
          if (figureId === undefined) {
            const { selection } = state;
            if (selection instanceof NodeSelection && selection.node.type.name === this.name) pos = selection.from;
          } else {
            state.doc.descendants((node, at) => {
              if (pos !== null) return false;
              if (node.type.name === this.name && (node.attrs as FigureAttributes).figureId === figureId) pos = at;
              return node.isBlock;
            });
          }
          if (pos === null) return false;
          const node = state.doc.nodeAt(pos);
          const dom = view.nodeDOM(pos);
          const figure = dom instanceof Element ? figureViews.get(dom) : undefined;
          if (!node || !figure || !Number.isInteger(index) || !(node.attrs as FigureAttributes).versions[index]) return false;
          if (dispatch) void figure.restore(index);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    // Enter on a selected figure moves keyboard focus into it; the figure hands it back on Escape.
    const enter = (edge: 'first' | 'last') => (): boolean => {
      const { selection } = this.editor.state;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false;
      const dom = this.editor.view.nodeDOM(selection.from);
      const view = dom instanceof Element ? figureViews.get(dom) : undefined;
      if (!view) return false;
      view.enter(edge);
      return true;
    };
    return { Enter: enter('first'), Space: enter('first') };
  },

  addProseMirrorPlugins() {
    const type = this.name;
    const numbering = this.options.numbering;
    return [
      // Numbers figures in document order (Fig 1, Fig 2) as they come and go.
      ...(numbering
        ? [
            new Plugin({
              key: figureNumbers,
              view: (view) => {
                const renumber = () => {
                  let n = 0;
                  view.state.doc.descendants((node, pos) => {
                    if (node.type.name !== type) return true;
                    n++;
                    const dom = view.nodeDOM(pos);
                    if (dom instanceof Element) figureViews.get(dom)?.setNumber(n);
                    return false;
                  });
                };
                renumber();
                return { update: (_view, previous) => (previous.doc.eq(view.state.doc) ? undefined : renumber()) };
              },
            }),
          ]
        : []),
      new Plugin({
        key: figureIds,
        // Pasted or duplicated figures get their own id, so every figure is addressed once.
        appendTransaction: (transactions, _old, state) => {
          const inserted = transactions.some((tr) =>
            tr.steps.some((step) => {
              const slice = (step as { slice?: { content: { descendants(f: (n: ProseMirrorNode) => boolean | void): void } } }).slice;
              let found = false;
              slice?.content.descendants((n) => {
                if (n.type.name === type) found = true;
                return !found;
              });
              return found;
            }),
          );
          if (!inserted) return null;
          const seen = new Set<string>();
          let tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== type) return true;
            const id = String(node.attrs.figureId ?? '');
            if (!id || seen.has(id)) {
              const fresh = newFigureId();
              tr = tr.setNodeAttribute(pos, 'figureId', fresh);
              seen.add(fresh);
              changed = true;
            } else seen.add(id);
            return false;
          });
          return changed ? tr.setMeta(FIGURE_TRANSACTION, 'ids') : null;
        },
      }),
    ];
  },

  onDestroy() {
    // Save what learners changed while the view still exists, then stop the scheduler.
    const scheduler = schedulers.get(this.editor);
    flushFigures(this.editor);
    scheduler?.destroy();
    schedulers.delete(this.editor);
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const adapter = this.options.adapter;
      if (!adapter) return new PlaceholderView(node, this.options.snapshots);
      return new FigureNodeView(node, editor, getPos, {
        adapter,
        store: this.options.store,
        scheduler: schedulerFor(editor, this.options.scheduler),
        settleMs: this.options.settleMs,
        theme: this.options.theme,
        onError: this.options.onError,
        signals: this.options.signals,
        style: this.options.style,
        repair: this.options.repair,
      });
    };
  },
});

/** Placeholder view: a stable-size box with the snapshot or a skeleton, plus the text alternative. */
export class PlaceholderView implements NodeView {
  readonly dom: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly caption: HTMLElement;

  constructor(
    private node: ProseMirrorNode,
    private readonly snapshots: SnapshotSource | null,
  ) {
    this.dom = document.createElement('figure');
    this.dom.className = 'incantly-figure';
    this.dom.dataset.state = 'placeholder';
    this.dom.contentEditable = 'false';
    this.frame = document.createElement('div');
    this.frame.className = 'incantly-figure__frame';
    this.caption = document.createElement('figcaption');
    this.caption.className = 'incantly-figure__description';
    this.dom.append(this.frame, this.caption);
    this.render();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** Placeholders own no interactive content. */
  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  private render(): void {
    const attrs = this.node.attrs as FigureAttributes;
    const aspect = attrs.aspect > 0 ? attrs.aspect : DEFAULT_ASPECT;
    this.frame.style.aspectRatio = `${1} / ${aspect}`;
    this.dom.dataset.figureId = attrs.figureId;
    this.caption.textContent = attrs.description;
    const url = attrs.snapshotRef ? this.snapshots?.url(attrs.snapshotRef) : undefined;
    this.frame.replaceChildren();
    if (url) {
      const img = document.createElement('img');
      img.className = 'incantly-figure__snapshot';
      img.alt = '';
      img.src = url;
      this.frame.append(img);
    } else {
      const skeleton = document.createElement('div');
      skeleton.className = 'incantly-figure__skeleton';
      this.frame.append(skeleton);
    }
  }
}
