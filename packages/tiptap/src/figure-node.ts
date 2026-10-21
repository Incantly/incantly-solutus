import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { DEFAULT_ASPECT, defaultAttributes, parseJson, parseNumber, type FigureAttributes } from './attributes';

export interface SnapshotSource {
  /** Returns a renderable image URL for a snapshot hash, if it is available. */
  url(ref: string): string | undefined;
}

export interface FigureNodeOptions {
  snapshots: SnapshotSource | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    incantlyFigure: {
      insertFigure: (attributes: Partial<FigureAttributes>) => ReturnType;
    };
  }
}

const jsonAttribute = <T>(name: string, fallback: T) => ({
  default: fallback,
  parseHTML: (element: HTMLElement) => parseJson<T>(element.getAttribute(`data-${name}`), fallback),
  renderHTML: (attributes: Record<string, unknown>) => ({
    [`data-${name}`]: JSON.stringify(attributes[camel(name)] ?? fallback),
  }),
});

const textAttribute = (name: string, fallback: string | null) => ({
  default: fallback,
  parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) ?? fallback,
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

/**
 * The figure node. Every attribute is rendered to HTML so that copy and paste
 * and HTML export round-trip the figure; large content is stored by hash.
 */
export const FigureNode = Node.create<FigureNodeOptions>({
  name: 'incantlyFigure',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { snapshots: null };
  },

  addAttributes() {
    const d = defaultAttributes();
    return {
      figureId: textAttribute('figure-id', d.figureId),
      concept: textAttribute('concept', d.concept),
      sdkVersion: textAttribute('sdk-version', d.sdkVersion),
      schemaVersion: numberAttribute('schema-version', d.schemaVersion),
      fragments: jsonAttribute('fragments', d.fragments),
      fragmentsRef: textAttribute('fragments-ref', d.fragmentsRef),
      defaults: jsonAttribute('defaults', d.defaults),
      values: jsonAttribute('values', d.values),
      step: numberAttribute('step', d.step),
      snapshotRef: textAttribute('snapshot-ref', d.snapshotRef),
      description: textAttribute('description', d.description),
      aspect: numberAttribute('aspect', d.aspect),
      meta: jsonAttribute('meta', d.meta),
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
          commands.insertContent({ type: this.name, attrs: { ...defaultAttributes(), ...attributes } }),
    };
  },

  addNodeView() {
    return ({ node }) => new PlaceholderView(node, this.options.snapshots);
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
