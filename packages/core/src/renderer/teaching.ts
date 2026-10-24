import type { RendererMessage } from '../protocol/runtime-messages';
import type { PartView, StepsView, UiState } from '../protocol/ui';
import type { SceneDom } from './dom-scene';

type Send = (message: RendererMessage) => void;
type StepAction = 'enter' | 'next' | 'prev' | 'exit';

export interface TeachingOptions {
  readonly doc: Document;
  /** Prefix for generated ids, unique per figure. */
  readonly scope: string;
  readonly send: Send;
  readonly signal: AbortSignal;
  readonly scene: SceneDom;
  /** The figure root, which carries `has-focus` while a part is highlighted. */
  readonly figureRoot: HTMLElement;
  /** The element holding the scene HTML and its stages, where parts live. */
  readonly sceneRoot: HTMLElement;
}

export const PART_HINT = 'Point at or tap a part of the drawing to see what it shows.';

/**
 * The teaching layer outside the drawing: part notes, the model-bound
 * explanation, the step walkthrough and the text alternative. All words live
 * in HTML, never inside the SVG. It has three elements so the renderer can
 * place them: part notes under the drawing, explanation and steps above the
 * controls, and the description last.
 */
export class TeachingView {
  /** Explanation and the step walkthrough. */
  readonly element: HTMLElement;
  /** One line under the drawing naming the highlighted part. */
  readonly partInfoElement: HTMLElement;
  /** The text alternative under a toggle, plus its print copy. */
  readonly descriptionElement: HTMLElement;
  private readonly doc: Document;
  private readonly send: Send;
  private readonly scene: SceneDom;
  private readonly figureRoot: HTMLElement;

  private readonly explanation: HTMLElement;
  private readonly steps: HTMLElement;
  private readonly start: HTMLButtonElement;
  private readonly count: HTMLElement;
  private readonly active: HTMLElement;
  private readonly say: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly done: HTMLButtonElement;
  private readonly live: HTMLElement;
  private readonly describe: HTMLDetailsElement;
  private readonly descriptionText: HTMLElement;
  private readonly printDescription: HTMLElement;

  private stepIndex: number | null = null;
  private stepCount = 0;
  private stepsRendered = false;
  private highlighted: Element | null = null;
  // Learner focus is worked out here from three sources, most specific first.
  private hoverPart: string | null = null;
  private keyboardPart: string | null = null;
  private tapPart: string | null = null;
  private sentFocus: string | null = null;
  private lastPointerType = '';

  constructor(options: TeachingOptions) {
    const { doc, scope, signal } = options;
    this.doc = doc;
    this.send = options.send;
    this.scene = options.scene;
    this.figureRoot = options.figureRoot;

    this.element = doc.createElement('div');
    this.element.className = 'inc-teaching';

    this.explanation = doc.createElement('p');
    this.explanation.className = 'inc-explain';
    this.explanation.hidden = true;

    this.partInfoElement = doc.createElement('p');
    this.partInfoElement.className = 'inc-part-info';
    this.partInfoElement.hidden = true;
    // Pointer users read it here; screen readers get the same words from the part's own name.
    this.partInfoElement.setAttribute('aria-hidden', 'true');

    // Steps: a start button outside step mode, the walkthrough inside it.
    this.steps = doc.createElement('div');
    this.steps.className = 'inc-steps';
    this.steps.setAttribute('role', 'group');
    this.steps.setAttribute('aria-label', 'Walkthrough');
    this.steps.hidden = true;

    const startRow = doc.createElement('div');
    startRow.className = 'inc-steps__start';
    this.start = button(doc, 'enter', 'Walk me through it');
    this.count = doc.createElement('span');
    this.count.className = 'inc-steps__count';
    startRow.append(this.start, this.count);

    this.active = doc.createElement('div');
    this.active.className = 'inc-steps__active';
    this.active.hidden = true;
    this.say = doc.createElement('p');
    this.say.className = 'inc-steps__say';
    this.say.id = `${scope}-step-say`;
    const nav = doc.createElement('div');
    nav.className = 'inc-steps__nav';
    this.back = button(doc, 'prev', 'Back');
    this.back.setAttribute('aria-keyshortcuts', 'ArrowLeft');
    this.progress = doc.createElement('span');
    this.progress.className = 'inc-steps__progress';
    this.next = button(doc, 'next', 'Next');
    this.next.setAttribute('aria-keyshortcuts', 'ArrowRight');
    this.done = button(doc, 'exit', 'Done');
    this.done.setAttribute('aria-keyshortcuts', 'Escape');
    this.done.title = 'Leave the walkthrough and return to your own values';
    nav.append(this.back, this.progress, this.next, this.done);
    this.active.append(this.say, nav);

    // Announces step changes; always present so screen readers notice updates.
    this.live = doc.createElement('p');
    this.live.className = 'inc-visually-hidden';
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    this.steps.append(startRow, this.active, this.live);

    this.describe = doc.createElement('details');
    this.describe.className = 'inc-describe';
    this.describe.hidden = true;
    const summary = doc.createElement('summary');
    summary.textContent = 'Text description';
    this.descriptionText = doc.createElement('p');
    this.describe.append(summary, this.descriptionText);
    // A closed <details> neither prints nor feeds the drawing's accessible
    // description, so a copy hidden on screen does both jobs.
    this.printDescription = doc.createElement('p');
    this.printDescription.className = 'inc-print-only';
    this.printDescription.id = `${scope}-description`;

    this.element.append(this.explanation, this.steps);
    this.descriptionElement = doc.createElement('div');
    this.descriptionElement.className = 'inc-description';
    this.descriptionElement.append(this.describe, this.printDescription);

    this.listenToSteps(signal);
    this.listenToParts(options.sceneRoot, signal);
  }

  update(changed: Partial<UiState>, ui: UiState, reset = false): void {
    if (changed.explanation !== undefined) {
      this.explanation.textContent = changed.explanation ?? '';
      this.explanation.hidden = !changed.explanation;
    }
    if (changed.description !== undefined) {
      this.descriptionText.textContent = changed.description ?? '';
      this.printDescription.textContent = changed.description ?? '';
      this.describe.hidden = !changed.description;
    }
    if (changed.steps !== undefined) this.renderSteps(changed.steps);
    if (reset) {
      // The stages were rebuilt: earlier part elements are gone.
      this.highlighted = null;
      this.hoverPart = this.keyboardPart = this.tapPart = this.sentFocus = null;
    }
    if (reset || changed.focus !== undefined || changed.parts !== undefined || changed.steps !== undefined) {
      this.renderFocus(ui);
    }
  }

  // -------------------------------------------------------------------------
  // Steps
  // -------------------------------------------------------------------------

  private listenToSteps(signal: AbortSignal): void {
    this.steps.addEventListener(
      'click',
      (event) => {
        const target = (event.target as Element).closest<HTMLButtonElement>('button[data-step]');
        if (!target || target.getAttribute('aria-disabled') === 'true') return;
        this.sendStep(target.dataset.step as StepAction);
      },
      { signal },
    );
    this.steps.addEventListener(
      'keydown',
      (event) => {
        if (this.stepIndex === null || event.altKey || event.ctrlKey || event.metaKey) return;
        const last = this.stepCount - 1;
        switch (event.key) {
          case 'ArrowRight':
            if (this.stepIndex < last) this.sendStep('next');
            break;
          case 'ArrowLeft':
            if (this.stepIndex > 0) this.sendStep('prev');
            break;
          case 'Home':
            this.send({ type: 'step', action: 'goto', index: 0 });
            break;
          case 'End':
            this.send({ type: 'step', action: 'goto', index: last });
            break;
          case 'Escape':
            this.sendStep('exit');
            break;
          default:
            return;
        }
        event.preventDefault();
        event.stopPropagation();
      },
      { signal },
    );
  }

  private sendStep(action: StepAction): void {
    this.send({ type: 'step', action });
  }

  private renderSteps(steps: StepsView | null): void {
    const firstRender = !this.stepsRendered;
    this.stepsRendered = true;
    if (!steps) {
      this.steps.hidden = true;
      this.stepIndex = null;
      this.stepCount = 0;
      return;
    }
    const hadFocus = this.steps.contains(this.doc.activeElement);
    const wasIndex = this.stepIndex;
    const index = steps.index;
    this.stepIndex = index;
    this.stepCount = steps.count;
    this.steps.hidden = false;
    this.count.textContent = steps.count === 1 ? '1 step' : `${steps.count} steps`;

    if (index === null) {
      this.start.hidden = false;
      this.active.hidden = true;
      if (wasIndex !== null) {
        if (!firstRender) this.announce('Walkthrough closed. Your own values are back.');
        if (hadFocus) this.start.focus();
      }
      return;
    }

    const say = steps.say ?? '';
    const progress = `Step ${index + 1} of ${steps.count}`;
    this.start.hidden = true;
    this.active.hidden = false;
    if (this.say.textContent !== say) this.say.textContent = say;
    this.progress.textContent = progress;
    setDisabled(this.back, index === 0);
    setDisabled(this.next, index === steps.count - 1);
    if (!firstRender && wasIndex !== index) this.announce(`${progress}. ${say}`);
    if (hadFocus && wasIndex === null) {
      // The start button just disappeared: keep keyboard focus in the walkthrough.
      (index < steps.count - 1 ? this.next : this.done).focus();
    }
  }

  private announce(text: string): void {
    this.live.textContent = text;
  }

  // -------------------------------------------------------------------------
  // Parts: hover, keyboard focus and tap all highlight the same way
  // -------------------------------------------------------------------------

  private listenToParts(sceneRoot: HTMLElement, signal: AbortSignal): void {
    const partOf = (target: EventTarget | null): string | null => {
      if (!target || !(target as Element).closest) return null;
      const element = (target as Element).closest('[data-part]');
      if (element && sceneRoot.contains(element)) return element.getAttribute('data-part');
      // 3D faces live in shared slots and name the part they draw for now.
      const owned = (target as Element).closest('[data-owner]');
      return owned && sceneRoot.contains(owned) ? owned.getAttribute('data-owner') : null;
    };
    sceneRoot.addEventListener(
      'pointerover',
      (event) => {
        if (event.pointerType === 'touch') return;
        this.hoverPart = partOf(event.target);
        this.sendFocus();
      },
      { signal },
    );
    sceneRoot.addEventListener(
      'pointerout',
      (event) => {
        if (event.pointerType === 'touch') return;
        if (partOf(event.relatedTarget) === this.hoverPart) return;
        this.hoverPart = null;
        this.sendFocus();
      },
      { signal },
    );
    sceneRoot.addEventListener(
      'pointerdown',
      (event) => {
        this.lastPointerType = event.pointerType;
      },
      { signal },
    );
    sceneRoot.addEventListener(
      'click',
      (event) => {
        // A tap has no hover, so it toggles the highlight instead.
        if (this.lastPointerType !== 'touch') return;
        const name = partOf(event.target);
        this.tapPart = name !== null && name !== this.tapPart ? name : null;
        this.sendFocus();
      },
      { signal },
    );
    sceneRoot.addEventListener(
      'focusin',
      (event) => {
        this.keyboardPart = partOf(event.target);
        this.sendFocus();
      },
      { signal },
    );
    sceneRoot.addEventListener(
      'focusout',
      (event) => {
        if (partOf(event.relatedTarget) !== null) return;
        this.keyboardPart = null;
        this.sendFocus();
      },
      { signal },
    );
  }

  private sendFocus(): void {
    const focus = this.hoverPart ?? this.keyboardPart ?? this.tapPart;
    if (focus === this.sentFocus) return;
    this.sentFocus = focus;
    this.send({ type: 'focusPart', name: focus });
  }

  private renderFocus(ui: UiState): void {
    const part: PartView | undefined = ui.focus ? ui.parts.find((p) => p.name === ui.focus) : undefined;
    const element = part ? (this.scene.element(part.id) ?? null) : null;
    if (this.highlighted !== element) {
      this.highlighted?.classList.remove('is-focus');
      this.highlighted = element;
    }
    if (element && !element.classList.contains('is-focus')) element.classList.add('is-focus');
    this.scene.focusOwner(part?.name ?? null);
    this.figureRoot.classList.toggle('has-focus', element !== null);

    // The step already says why its part matters; other parts show their note.
    // The line keeps its height so the controls never jump while pointing.
    const info = part && part.name !== ui.steps?.focus ? describePart(part) : '';
    const text = info || PART_HINT;
    const line = this.partInfoElement;
    if (line.textContent !== text) line.textContent = text;
    line.classList.toggle('is-hint', info === '');
    line.hidden = ui.parts.length === 0;
  }
}

function describePart(part: PartView): string {
  return part.info ? `${part.label}: ${part.info}` : part.label;
}

function button(doc: Document, action: string, text: string): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.dataset.step = action;
  element.textContent = text;
  return element;
}

/** aria-disabled keeps the button focusable, so focus never drops to the page. */
function setDisabled(element: HTMLButtonElement, disabled: boolean): void {
  if (disabled) element.setAttribute('aria-disabled', 'true');
  else element.removeAttribute('aria-disabled');
}
