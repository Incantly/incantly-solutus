/**
 * The `incantlyFigure` node (design 2): a block atom holding a figure as its script. Schema, HTML in and out, paste of
 * a script, id de-duplication and the commands. The node view (round 2) is added by `addNodeView`.
 */
import { Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { createHeadlessApp } from '@incantly/sdk';
import type { AppModeId } from '@incantly/sdk';
import { FIGURE_DEFAULTS, SCRIPT_LIMIT, checkAttrs, headerMode, isPictureUrl, newFigureId } from './attrs';
import type { IncantlyFigureAttrs } from './attrs';
import { FIGURE_NAME, figuresIn, findFigure } from './doc';
import { tiptapError } from './errors';
import { aiUnavailable, startAsk } from './ai';
import { createFigureView } from './node-view';
import { reportError } from './report';
import type { IncantlyTiptapOptions, InsertFigureOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    incantlyFigure: {
      /** Inserts a figure at the selection. */
      insertIncantlyFigure: (options?: InsertFigureOptions) => ReturnType;
      /** Changes attributes of the figure with this id; the merged attributes are checked first. */
      updateIncantlyFigure: (id: string, patch: Partial<IncantlyFigureAttrs>) => ReturnType;
      /** Asks the AI to draw or change the figure; needs a `server` or an `aiTransport`. */
      askIncantly: (id: string, request: string) => ReturnType;
    };
  }
}

/** True when the writer may change figures: the extension is not read-only and the editor is editable. */
export const canWrite = (editor: Editor, options: IncantlyTiptapOptions): boolean => options.readOnly !== true && editor.isEditable;

const NUMBER_TEXT = /^\d+(?:\.\d+)?$/;

/** A number attribute from HTML: digits become a number, `full` stays, anything else stays as written (nothing is lost). */
const fromHtml = (value: string | null, fallback: unknown): unknown => {
  if (value === null) return fallback;
  const t = value.trim();
  if (NUMBER_TEXT.test(t)) return Number(t);
  return value;
};

/**
 * What a plain-text paste holds, if it is an Incantly script: the `# incantly 1` header, or every non-empty line
 * checks without error in a headless app of the default mode and at least one has `=` (requirements R4.3).
 */
export function scriptOfPaste(text: string, defaultMode: AppModeId = 'figure'): { readonly script: string; readonly mode: AppModeId } | undefined {
  if (typeof text !== 'string' || text.trim() === '' || text.length > SCRIPT_LIMIT) return undefined;
  const script = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (/^\s*# incantly \d+/.test(script)) return { script, mode: headerMode(script) ?? defaultMode };
  if (!script.includes('=')) return undefined;
  const lines = script.split('\n').filter((l) => l.trim() !== '');
  if (!lines.some((l) => l.includes('='))) return undefined;
  let app: ReturnType<typeof createHeadlessApp> | undefined;
  try {
    app = createHeadlessApp({ mode: defaultMode });
    for (const line of lines) {
      const results = app.run(line);
      if (results.length === 0 || results.some((r) => !r.ok)) return undefined;
    }
    return { script, mode: defaultMode };
  } catch {
    return undefined;
  } finally {
    try {
      app?.destroy();
    } catch {
      // nothing to free
    }
  }
}

export const figureIdsKey = new PluginKey('incantlyFigureIds');
export const figurePasteKey = new PluginKey('incantlyFigurePaste');

export const IncantlyFigure = Node.create<IncantlyTiptapOptions>({
  name: FIGURE_NAME,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { ...DEFAULT_OPTIONS };
  },

  addAttributes() {
    const mode = this.options.defaultMode ?? DEFAULT_OPTIONS.defaultMode;
    return {
      id: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-id') ?? '' },
      script: {
        default: '',
        rendered: false,
        parseHTML: (el: HTMLElement) => el.querySelector('pre[data-incantly-script]')?.textContent ?? '',
      },
      mode: { default: mode, rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-mode') ?? mode },
      width: { default: FIGURE_DEFAULTS.width, rendered: false, parseHTML: (el: HTMLElement) => fromHtml(el.getAttribute('data-width'), 'full') },
      height: { default: FIGURE_DEFAULTS.height, rendered: false, parseHTML: (el: HTMLElement) => fromHtml(el.getAttribute('data-height'), FIGURE_DEFAULTS.height) },
      caption: {
        default: '',
        rendered: false,
        parseHTML: (el: HTMLElement) => el.querySelector('figcaption')?.textContent ?? el.querySelector('img')?.getAttribute('alt') ?? '',
      },
      picture: { default: null, rendered: false, parseHTML: (el: HTMLElement) => el.querySelector('img')?.getAttribute('src') ?? null },
      version: { default: 1, rendered: false, parseHTML: (el: HTMLElement) => fromHtml(el.getAttribute('data-version'), 1) },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-incantly-figure]' }];
  },

  renderHTML({ node }) {
    const a = node.attrs as Record<string, unknown>;
    const text = (x: unknown): string => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
    const caption = text(a['caption']);
    const children: unknown[] = [];
    if (isPictureUrl(a['picture'])) {
      const img: Record<string, string> = { src: a['picture'], alt: caption };
      if (typeof a['width'] === 'number') img['width'] = String(a['width']);
      if (typeof a['height'] === 'number') img['height'] = String(a['height']);
      children.push(['img', img]);
    }
    children.push(['pre', { 'data-incantly-script': '', hidden: '' }, text(a['script'])]);
    if (caption !== '') children.push(['figcaption', {}, caption]);
    return [
      'figure',
      {
        'data-incantly-figure': '',
        'data-id': text(a['id']),
        'data-mode': text(a['mode']),
        'data-width': text(a['width']),
        'data-height': text(a['height']),
        'data-version': text(a['version']),
      },
      ...children,
    ] as unknown as ['figure', Record<string, string>, ...unknown[]];
  },

  addNodeView() {
    return createFigureView(this.editor, this.options);
  },

  addCommands() {
    const options = this.options;
    const type = this.type;
    return {
      insertIncantlyFigure:
        (o = {}) =>
        ({ editor, tr, dispatch }) => {
          const script = o.script ?? '';
          const raw = {
            ...FIGURE_DEFAULTS,
            id: o.id ?? newFigureId(),
            script,
            mode: o.mode ?? headerMode(script) ?? options.defaultMode ?? DEFAULT_OPTIONS.defaultMode,
            height: o.height ?? FIGURE_DEFAULTS.height,
            caption: o.caption ?? '',
          };
          const checked = checkAttrs(raw);
          if (!checked.ok) {
            reportError(editor, options, checked);
            return false;
          }
          if (dispatch) {
            tr.replaceSelectionWith(type.create({ ...checked.value })).scrollIntoView();
            // a figure at the very end would leave no line to write on
            const paragraph = tr.doc.type.schema.nodes['paragraph'];
            if (paragraph && tr.doc.lastChild?.type === type && tr.doc.canReplaceWith(tr.doc.childCount, tr.doc.childCount, paragraph)) {
              tr.insert(tr.doc.content.size, paragraph.create());
            }
          }
          return true;
        },

      updateIncantlyFigure:
        (id, patch) =>
        ({ editor, tr, state, dispatch }) => {
          const found = findFigure(state.doc, id);
          if (!found) {
            reportError(editor, options, tiptapError('figure_not_found', `There is no figure with the id ${id}.`, { hint: 'Check the id with the document\'s figures.', node: id }));
            return false;
          }
          if (patch.id !== undefined && patch.id !== id) {
            reportError(editor, options, tiptapError('bad_attrs', 'The id of a figure cannot be changed.', { hint: 'Leave the id out of the patch.', node: id }));
            return false;
          }
          const checked = checkAttrs({ ...found.node.attrs, ...patch, id });
          if (!checked.ok) {
            reportError(editor, options, checked);
            return false;
          }
          const next = { ...checked.value } as Record<string, unknown>;
          const same = Object.keys(next).every((k) => next[k] === found.node.attrs[k]);
          if (dispatch && !same) {
            tr.setNodeMarkup(found.pos, undefined, next);
            // a picture is a cache: refreshing it is not an undo step
            if (Object.keys(patch).every((k) => k === 'picture')) tr.setMeta('addToHistory', false);
          }
          return true;
        },

      askIncantly:
        (id, request) =>
        ({ editor, state, dispatch }) => {
          const unavailable = aiUnavailable(options, id);
          if (unavailable) {
            reportError(editor, options, unavailable);
            return false;
          }
          if (!findFigure(state.doc, id)) {
            reportError(editor, options, tiptapError('figure_not_found', `There is no figure with the id ${id}.`, { node: id }));
            return false;
          }
          if (!dispatch) return true;
          return startAsk(editor, options, id, request);
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;
    return [
      // a pasted or copied figure whose id is already in the document gets a new one, keeping its script
      new Plugin({
        key: figureIdsKey,
        appendTransaction: (trs, oldState, newState) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const figs = figuresIn(newState.doc);
          if (figs.length === 0) return null;
          const seen = new Set<string>();
          let clash = false;
          for (const f of figs) {
            const id: unknown = f.node.attrs['id'];
            if (typeof id !== 'string' || id === '' || seen.has(id)) {
              clash = true;
              break;
            }
            seen.add(id);
          }
          if (!clash) return null;
          // the nodes that were already in the document keep their ids; the new copies get new ones
          const mapping = new Mapping(trs.flatMap((t) => t.mapping.maps));
          const claimed = new Map<string, number>();
          for (const o of figuresIn(oldState.doc)) {
            const r = mapping.mapResult(o.pos, 1);
            if (r.deleted) continue;
            const n = newState.doc.nodeAt(r.pos);
            const id: unknown = o.node.attrs['id'];
            if (n && n.type.name === FIGURE_NAME && typeof id === 'string' && n.attrs['id'] === id) claimed.set(id, r.pos);
          }
          const tr = newState.tr;
          const used = new Set<string>();
          for (const f of figs) {
            const id: unknown = f.node.attrs['id'];
            if (typeof id === 'string' && id !== '' && (claimed.get(id) === f.pos || (!claimed.has(id) && !used.has(id)))) {
              used.add(id);
              continue;
            }
            tr.setNodeMarkup(f.pos, undefined, { ...f.node.attrs, id: newFigureId() });
          }
          return tr.docChanged ? tr : null;
        },
      }),
      // pasting plain text that is an Incantly script inserts a figure with it
      new Plugin({
        key: figurePasteKey,
        props: {
          handlePaste: (_view, event) => {
            try {
              if (!canWrite(editor, options)) return false;
              const data = event.clipboardData;
              if (!data) return false;
              if (Array.from(data.types ?? []).includes('text/html')) return false;
              const found = scriptOfPaste(data.getData('text/plain'), options.defaultMode ?? DEFAULT_OPTIONS.defaultMode);
              if (!found) return false;
              return editor.commands.insertIncantlyFigure({ script: found.script, mode: found.mode });
            } catch {
              return false;
            }
          },
        },
      }),
    ];
  },
});
