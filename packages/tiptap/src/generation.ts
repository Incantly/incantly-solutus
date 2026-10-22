import { VALIDATOR_VERSION, type ExecutionAdapter, type WarmLease } from '@incantly/core';
import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { DEFAULT_ASPECT, MAX_VERSIONS, type FigureAttributes, type FigureFragments } from './attributes';
import { newFigureId } from './figure-node';
import { FIGURE_TRANSACTION, figureViews } from './node-view';

/**
 * Making a new figure in a note (PRD 25.2, 27.1). The command places a
 * skeleton where the figure will go: a card with the title, the control row
 * with its sliders disabled and a shimmer where the drawing will be, drawn
 * from the plan as soon as it arrives. Only an approved figure is inserted
 * into the note; nothing half-made is ever stored. When the figure cannot be
 * built the card says so in one line and offers Retry, which starts afresh.
 *
 * The host supplies `generate`: @incantly/generation/client's figureGenerator
 * runs the service, the device probe, the one repair and the fallback ladder.
 *
 * A figure already in the note can be changed in the learner's words, or made
 * again (HO-8). The host supplies `change`: @incantly/generation/client's
 * figureChanger edits the scene the service signed, and the device probes
 * the change before it replaces the figure. A change is an ordinary edit:
 * undo brings the figure back as it was.
 *
 * While a figure is being made or changed, the adapter the note's figures
 * mount with boots the next figure's frame ahead of it (PRD 25.4), so the
 * figure starts in a frame that is already running.
 */

export interface FigureRequest {
  readonly prompt: string;
  readonly noteContext?: string;
}

/** The skeleton: names and numbers from the plan. */
export interface SkeletonView {
  readonly concept: string;
  readonly parameters: ReadonlyArray<{ readonly name: string; readonly unit?: string; readonly min: number; readonly max: number; readonly default: number }>;
  readonly steps: number;
}

export type GenerationStageView = 'planning' | 'building' | 'checking' | 'repairing';

export interface GeneratedFigure {
  readonly fragments: FigureFragments;
  readonly concept: string;
  readonly description: string;
  readonly generationId: string | null;
  readonly approvedAt: string;
  /** The service's signature on the scene, kept for a background repair (RP-7). */
  readonly ticket?: string | null;
}

export type FigureGenerationResult =
  | { readonly kind: 'figure'; readonly figure: GeneratedFigure; readonly notice?: string }
  | { readonly kind: 'failed'; readonly message: string };

export type FigureGenerate = (
  request: FigureRequest,
  hooks: { readonly onSkeleton: (skeleton: SkeletonView) => void; readonly onStage: (stage: GenerationStageView) => void; readonly signal: AbortSignal },
) => Promise<FigureGenerationResult>;

/** Changes a figure the learner has, in their words (HO-8). */
export type FigureChange = (
  request: { readonly fragments: FigureFragments; readonly ticket: string | null; readonly prompt: string; readonly noteContext?: string },
  hooks: { readonly onStage: (stage: GenerationStageView) => void; readonly signal: AbortSignal },
) => Promise<FigureGenerationResult>;

export interface FigureGenerationOptions {
  generate: FigureGenerate | null;
  /** Changes a figure already in the note; without it, a change makes the figure again with the change in the request. */
  change: FigureChange | null;
}

/** Which figure a change is for: the selected one, or the one with this id. */
export interface FigureChangeRequest extends FigureRequest {
  readonly figureId?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figureGeneration: {
      /** Makes a figure for the request, placed after the block at the selection, or at `at`. */
      generateFigure: (request: FigureRequest, at?: number) => ReturnType;
      /** Changes the selected figure, or the one with `figureId`, as the request says (HO-8). */
      changeFigure: (request: FigureChangeRequest) => ReturnType;
      /** Makes the selected figure, or the one with `figureId`, again: from its concept, or from `prompt` (HO-8). */
      regenerateFigure: (request?: Partial<FigureChangeRequest>) => ReturnType;
    };
  }
}

const STAGE_TEXT: Readonly<Record<GenerationStageView, string>> = {
  planning: 'Planning the figure…',
  building: 'Drawing the figure…',
  checking: 'Checking that it works…',
  repairing: 'Fixing a problem…',
};

const CHANGE_TEXT: Readonly<Record<GenerationStageView, string>> = {
  planning: 'Planning the change…',
  building: 'Changing the figure…',
  checking: 'Checking that it works…',
  repairing: 'Fixing a problem…',
};

type Meta = { readonly add: { readonly id: string; readonly pos: number; readonly element: HTMLElement } } | { readonly remove: string };

export const figureGenerationKey = new PluginKey<DecorationSet>('incantlyFigureGeneration');

/** Boots the next figure's frame while a figure is made or changed, for as long as the lease is held. */
type Warm = () => WarmLease | null;

/** The execution adapter the note's figures mount with, which may warm a frame ahead of the next one. */
function warmerOf(editor: Editor): Warm {
  const figure = editor.extensionManager.extensions.find((extension) => extension.name === 'incantlyFigure');
  const adapter = (figure?.options as { adapter?: ExecutionAdapter | null } | undefined)?.adapter ?? null;
  return () => adapter?.prewarm?.() ?? null;
}

/** One figure being made: its card in the note and the work behind it. */
class GenerationTask {
  readonly element: HTMLElement;
  private controller = new AbortController();
  private lease: WarmLease | null = null;
  private readonly title: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly status: HTMLElement;
  private readonly actions: HTMLElement;
  private concept: string | null = null;
  finished = false;

  constructor(
    readonly id: string,
    private readonly request: FigureRequest,
    private readonly view: EditorView,
    private readonly generate: FigureGenerate,
    private readonly warm: Warm,
  ) {
    const doc = view.dom.ownerDocument;
    this.element = doc.createElement('figure');
    this.element.className = 'incantly-figure incantly-figure--generating';
    this.element.contentEditable = 'false';
    this.element.dataset.generation = id;
    this.title = doc.createElement('p');
    this.title.className = 'incantly-skeleton__title';
    this.frame = doc.createElement('div');
    this.frame.className = 'incantly-figure__frame';
    this.frame.style.aspectRatio = `1 / ${DEFAULT_ASPECT}`;
    const shimmer = doc.createElement('div');
    shimmer.className = 'incantly-figure__skeleton incantly-skeleton__shimmer';
    this.frame.append(shimmer);
    this.controls = doc.createElement('div');
    this.controls.className = 'incantly-skeleton__controls';
    this.status = doc.createElement('p');
    this.status.className = 'incantly-figure__status';
    this.status.setAttribute('role', 'status');
    this.actions = doc.createElement('div');
    this.actions.className = 'incantly-skeleton__actions';
    this.actions.hidden = true;
    this.element.append(this.title, this.frame, this.controls, this.status, this.actions);
  }

  start(): void {
    this.finished = false;
    this.controller = new AbortController();
    // The figure's frame boots while its scene is written.
    this.lease?.release();
    this.lease = this.warm();
    this.element.setAttribute('aria-busy', 'true');
    this.element.classList.remove('is-failed');
    this.actions.hidden = true;
    this.actions.replaceChildren();
    this.concept = null;
    this.title.hidden = false;
    this.title.textContent = 'Making a figure';
    this.element.setAttribute('aria-label', 'Making a figure');
    this.controls.replaceChildren();
    this.frame.hidden = false;
    this.stage('planning');
    void this.generate(this.request, {
      onSkeleton: (skeleton) => this.skeleton(skeleton),
      onStage: (stage) => this.stage(stage),
      signal: this.controller.signal,
    }).then(
      (result) => this.done(result),
      () => this.done({ kind: 'failed', message: 'This figure could not be built.' }),
    );
  }

  cancel(): void {
    this.controller.abort();
    this.lease?.release();
    this.lease = null;
  }

  private stage(stage: GenerationStageView): void {
    if (!this.finished) this.status.textContent = STAGE_TEXT[stage];
  }

  /** The plan arrived: the card takes the figure's title and its control row. */
  private skeleton(skeleton: SkeletonView): void {
    if (this.finished) return;
    const doc = this.element.ownerDocument;
    this.concept = skeleton.concept;
    this.title.textContent = skeleton.concept;
    this.element.setAttribute('aria-label', `Making a figure: ${skeleton.concept}`);
    const rows = skeleton.parameters.map((p) => {
      const label = doc.createElement('label');
      label.className = 'incantly-skeleton__control';
      const name = doc.createElement('span');
      name.textContent = p.unit ? `${p.name} (${p.unit})` : p.name;
      const input = doc.createElement('input');
      input.type = 'range';
      input.disabled = true;
      input.min = String(p.min);
      input.max = String(p.max);
      input.value = String(p.default);
      input.tabIndex = -1;
      label.append(name, input);
      return label;
    });
    this.controls.replaceChildren(...rows);
  }

  private done(result: FigureGenerationResult): void {
    if (this.finished || this.controller.signal.aborted) return;
    this.finished = true;
    // A warm frame nobody takes closes a little after this.
    this.lease?.release();
    this.lease = null;
    this.element.removeAttribute('aria-busy');
    if (result.kind === 'figure') {
      insertFigure(this.view, this.id, result.figure, result.notice);
      return;
    }
    // One quiet line, the request it was for, and a way to try again.
    const doc = this.element.ownerDocument;
    this.element.classList.add('is-failed');
    // Nothing is being made any more: the title is the concept, if the plan named one.
    this.title.hidden = this.concept === null;
    this.element.setAttribute('aria-label', this.concept ? `Figure not built: ${this.concept}` : 'Figure not built');
    this.frame.hidden = true;
    this.controls.replaceChildren();
    this.status.textContent = result.message;
    const request = doc.createElement('p');
    request.className = 'incantly-skeleton__request';
    request.textContent = this.request.prompt;
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => this.start());
    const dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => removeTask(this.view, this.id));
    this.actions.replaceChildren(request, retry, dismiss);
    this.actions.hidden = false;
  }
}

const tasks = new WeakMap<EditorView, Map<string, GenerationTask>>();

function tasksOf(view: EditorView): Map<string, GenerationTask> {
  let map = tasks.get(view);
  if (!map) {
    map = new Map();
    tasks.set(view, map);
  }
  return map;
}

/** Where a task's card is now, after any edits around it. */
function positionOf(state: EditorState, id: string): number | null {
  const set = figureGenerationKey.getState(state);
  const found = set?.find(undefined, undefined, (spec: { id?: string }) => spec.id === id)[0];
  return found ? found.from : null;
}

function removeTask(view: EditorView, id: string): void {
  tasksOf(view).get(id)?.cancel();
  tasksOf(view).delete(id);
  if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(figureGenerationKey, { remove: id } satisfies Meta));
}

function insertFigure(view: EditorView, id: string, figure: GeneratedFigure, notice?: string): void {
  if (view.isDestroyed) return;
  const pos = positionOf(view.state, id);
  tasksOf(view).delete(id);
  const type = view.state.schema.nodes.incantlyFigure;
  if (pos === null || !type) return;
  const node = type.create({
    figureId: newFigureId(),
    concept: figure.concept,
    fragments: figure.fragments,
    description: figure.description,
    meta: {
      ...(figure.generationId ? { generationId: figure.generationId } : {}),
      approvedAt: figure.approvedAt,
      validatorVersion: VALIDATOR_VERSION,
      ...(figure.ticket ? { ticket: figure.ticket } : {}),
    },
  });
  // Adding a figure is an ordinary edit: undo takes it out again.
  const tr: Transaction = view.state.tr.insert(pos, node).setMeta(figureGenerationKey, { remove: id } satisfies Meta).setMeta(FIGURE_TRANSACTION, 'generated');
  view.dispatch(tr);
  if (notice) {
    const dom = view.nodeDOM(pos);
    if (dom instanceof Element) figureViews.get(dom)?.notify(notice);
  }
}

/** The position after the top-level block that holds `pos`: a figure goes between blocks. */
function blockBoundary(doc: ProseMirrorNode, pos: number): number {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  return $pos.depth === 0 ? $pos.pos : $pos.after(1);
}

let taskCounter = 0;

export const FigureGeneration = Extension.create<FigureGenerationOptions>({
  name: 'figureGeneration',

  addOptions() {
    return { generate: null, change: null };
  },

  addCommands() {
    return {
      generateFigure:
        (request, at) =>
        ({ view, state, dispatch }) => {
          const generate = this.options.generate;
          if (!generate || request.prompt.trim() === '') return false;
          if (!dispatch) return true;
          const pos = blockBoundary(state.doc, at ?? state.selection.to);
          const id = `task-${++taskCounter}`;
          const task = new GenerationTask(id, { ...request, prompt: request.prompt.trim() }, view, generate, warmerOf(this.editor));
          tasksOf(view).set(id, task);
          dispatch(state.tr.setMeta(figureGenerationKey, { add: { id, pos, element: task.element } } satisfies Meta));
          task.start();
          return true;
        },
      changeFigure:
        (request) =>
        ({ view, state, dispatch }) => {
          const { change, generate } = this.options;
          const prompt = request.prompt.trim();
          const at = figureAt(state, request.figureId);
          if (!at || prompt === '' || (!change && !generate)) return false;
          if (!dispatch) return true;
          const attrs = at.node.attrs as FigureAttributes;
          const ticket = attrs.meta.ticket ?? null;
          void changeInPlace(
            view,
            attrs.figureId,
            warmerOf(this.editor),
            async (hooks) => {
              const fragments = attrs.fragments ?? (await sourceOf(view, at.pos));
              if (change && ticket && fragments) {
                return change({ fragments, ticket, prompt, ...(request.noteContext ? { noteContext: request.noteContext } : {}) }, hooks);
              }
              // Without the service's signature, the figure is made again with the change in the request.
              if (!generate) return { kind: 'failed', message: 'This figure cannot be changed here.' };
              return generate({ prompt: `${attrs.concept ? `${attrs.concept}: ` : ''}${prompt}` }, { ...hooks, onSkeleton: () => undefined });
            },
            true,
          );
          return true;
        },
      regenerateFigure:
        (request = {}) =>
        ({ view, state, dispatch }) => {
          const generate = this.options.generate;
          const at = figureAt(state, request.figureId);
          if (!at || !generate) return false;
          const attrs = at.node.attrs as FigureAttributes;
          const prompt = (request.prompt ?? attrs.concept).trim();
          if (prompt === '') return false;
          if (!dispatch) return true;
          void changeInPlace(
            view,
            attrs.figureId,
            warmerOf(this.editor),
            (hooks) => generate({ prompt, ...(request.noteContext ? { noteContext: request.noteContext } : {}) }, { ...hooks, onSkeleton: () => undefined }),
            false,
          );
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: figureGenerationKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(figureGenerationKey) as Meta | undefined;
            if (meta && 'add' in meta) {
              const widget = Decoration.widget(meta.add.pos, meta.add.element, {
                id: meta.add.id,
                side: -1,
                ignoreSelection: true,
                // The card's buttons are its own; the editor leaves their events alone.
                stopEvent: () => true,
              });
              next = next.add(tr.doc, [widget]);
            } else if (meta && 'remove' in meta) {
              next = next.remove(next.find(undefined, undefined, (spec: { id?: string }) => spec.id === meta.remove));
            }
            return next;
          },
        },
        props: {
          decorations: (state) => figureGenerationKey.getState(state),
        },
        view: (view) => ({
          destroy: () => {
            // Closing the note cancels the figures still being made or changed; none is half stored.
            for (const task of tasksOf(view).values()) task.cancel();
            tasks.delete(view);
            for (const controller of changesOf(view).values()) controller.abort();
            changes.delete(view);
          },
        }),
      }),
    ];
  },
});

/** Figures being made in an editor, for hosts and tests. */
export function pendingFigures(view: EditorView): number {
  return tasksOf(view).size;
}

/** The figure a change is for: the one with this id, or the selected one. */
function figureAt(state: EditorState, figureId?: string): { readonly pos: number; readonly node: ProseMirrorNode } | null {
  if (figureId === undefined) {
    const { selection } = state;
    return selection instanceof NodeSelection && selection.node.type.name === 'incantlyFigure' ? { pos: selection.from, node: selection.node } : null;
  }
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'incantlyFigure' && (node.attrs as FigureAttributes).figureId === figureId) found = { pos, node };
    return node.isBlock;
  });
  return found;
}

/** Changes being made, by editor and figure id, so a second change waits its turn and closing the note cancels them. */
const changes = new WeakMap<EditorView, Map<string, AbortController>>();

function changesOf(view: EditorView): Map<string, AbortController> {
  let map = changes.get(view);
  if (!map) {
    map = new Map();
    changes.set(view, map);
  }
  return map;
}

/**
 * Runs a change to a figure in the note: a quiet line under the figure says
 * what is happening, and the result replaces the figure in one ordinary,
 * undoable edit, or the figure stays as it was with one line saying why.
 */
async function changeInPlace(
  view: EditorView,
  figureId: string,
  warm: Warm,
  work: (hooks: { readonly onStage: (stage: GenerationStageView) => void; readonly signal: AbortSignal }) => Promise<FigureGenerationResult>,
  keepValues: boolean,
): Promise<void> {
  const running = changesOf(view);
  if (running.has(figureId)) return;
  const controller = new AbortController();
  running.set(figureId, controller);
  // The changed figure's frame boots while the change is made.
  const lease = warm();
  try {
    await changeWith(view, figureId, controller, work, keepValues);
  } finally {
    lease?.release();
  }
}

async function changeWith(
  view: EditorView,
  figureId: string,
  controller: AbortController,
  work: (hooks: { readonly onStage: (stage: GenerationStageView) => void; readonly signal: AbortSignal }) => Promise<FigureGenerationResult>,
  keepValues: boolean,
): Promise<void> {
  const running = changesOf(view);
  const figureView = () => {
    const at = figureAt(view.state, figureId);
    const dom = at ? view.nodeDOM(at.pos) : null;
    return dom instanceof Element ? figureViews.get(dom) : undefined;
  };
  figureView()?.working(CHANGE_TEXT.planning);
  let result: FigureGenerationResult;
  try {
    result = await work({ onStage: (stage) => figureView()?.working(CHANGE_TEXT[stage]), signal: controller.signal });
  } catch {
    result = { kind: 'failed', message: 'The figure could not be changed, so the working version is kept.' };
  } finally {
    running.delete(figureId);
  }
  if (controller.signal.aborted || view.isDestroyed) return;
  figureView()?.working(null);
  const at = figureAt(view.state, figureId);
  if (!at) return;
  if (result.kind === 'failed') {
    figureView()?.notify(result.message);
    return;
  }
  // The figure as it was joins its history, so the learner can go back to it (HO-9).
  const kept = (await figureView()?.keep(keepValues ? 'changed' : 'remade')) ?? null;
  if (view.isDestroyed) return;
  const now = figureAt(view.state, figureId);
  if (!now) return;
  const { figure } = result;
  const attrs = now.node.attrs as FigureAttributes;
  let tr: Transaction = view.state.tr
    .setNodeAttribute(now.pos, 'fragments', figure.fragments)
    .setNodeAttribute(now.pos, 'fragmentsRef', null)
    .setNodeAttribute(now.pos, 'snapshotRef', null)
    .setNodeAttribute(now.pos, 'concept', figure.concept)
    .setNodeAttribute(now.pos, 'description', figure.description)
    .setNodeAttribute(now.pos, 'meta', {
      ...(figure.generationId ? { generationId: figure.generationId } : {}),
      approvedAt: figure.approvedAt,
      validatorVersion: VALIDATOR_VERSION,
      ...(figure.ticket ? { ticket: figure.ticket } : {}),
    });
  if (kept) tr = tr.setNodeAttribute(now.pos, 'versions', [kept, ...attrs.versions].slice(0, MAX_VERSIONS));
  // A figure made again starts afresh; a changed one keeps the learner's values where they still apply.
  if (!keepValues) tr = tr.setNodeAttribute(now.pos, 'values', {}).setNodeAttribute(now.pos, 'step', null).setNodeAttribute(now.pos, 'formulas', {});
  else if (Object.keys(attrs.formulas).length > 0) tr = tr.setNodeAttribute(now.pos, 'formulas', {});
  view.dispatch(tr.setMeta(FIGURE_TRANSACTION, 'changed'));
  if (result.notice) figureView()?.notify(result.notice);
}

/** A figure's fragments when the note keeps them by reference: its live view loads them from the store. */
async function sourceOf(view: EditorView, pos: number): Promise<FigureFragments | null> {
  const dom = view.nodeDOM(pos);
  const figure = dom instanceof Element ? figureViews.get(dom) : undefined;
  return figure ? figure.source() : null;
}

