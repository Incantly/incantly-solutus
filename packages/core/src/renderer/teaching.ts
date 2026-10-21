import type { RendererMessage } from '../protocol/runtime-messages';
import type { UiState } from '../protocol/ui';
import type { SceneDom } from './dom-scene';

type Send = (message: RendererMessage) => void;

/**
 * Teaching region outside the drawing: the model-bound explanation and the
 * text alternative. Steps arrive with the teaching layer.
 */
export class TeachingView {
  readonly element: HTMLElement;
  private readonly explanation: HTMLElement;
  private readonly describe: HTMLDetailsElement;
  private readonly descriptionText: HTMLElement;

  constructor(
    doc: Document,
    scope: string,
    _send: Send,
    _signal: AbortSignal,
    _scene: SceneDom,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'inc-teaching';

    this.explanation = doc.createElement('p');
    this.explanation.className = 'inc-explain';
    this.explanation.hidden = true;

    this.describe = doc.createElement('details');
    this.describe.className = 'inc-describe';
    this.describe.hidden = true;
    const summary = doc.createElement('summary');
    summary.textContent = 'Text description';
    this.descriptionText = doc.createElement('p');
    this.descriptionText.id = `${scope}-description`;
    this.describe.append(summary, this.descriptionText);

    this.element.append(this.explanation, this.describe);
  }

  update(changed: Partial<UiState>, _ui: UiState): void {
    if (changed.explanation !== undefined) {
      this.explanation.textContent = changed.explanation ?? '';
      this.explanation.hidden = !changed.explanation;
    }
    if (changed.description !== undefined) {
      this.descriptionText.textContent = changed.description ?? '';
      this.describe.hidden = !changed.description;
    }
  }
}
