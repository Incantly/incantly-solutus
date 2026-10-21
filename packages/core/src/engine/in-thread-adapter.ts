import type { ExecutionAdapter, FigureHandle, FigureState, MountOptions } from '../sandbox/adapter';
import { snapshotStage } from '../sandbox/snapshot';
import type { SceneFragments } from '../validation';
import { mountTrusted } from './mount';

/**
 * The in-thread execution adapter: the same contract as the sandbox, with the
 * runtime on the page's own thread. For trusted scenes only: the hand-written
 * reference scenes, tests and the playground. Generated scenes never use it.
 */
export function mountInThread(container: HTMLElement, fragments: SceneFragments, options: MountOptions = {}): FigureHandle {
  let state: FigureState = 'booting';
  const setState = (next: FigureState) => {
    state = next;
    options.onState?.(next);
  };
  let figure: ReturnType<typeof mountTrusted> | null = null;
  try {
    figure = mountTrusted(container, fragments, {
      ...(options.values ? { values: options.values } : {}),
      ...(options.step !== undefined ? { step: options.step } : {}),
      ...(options.autoplay !== undefined ? { autoplay: options.autoplay } : {}),
      ...(options.reducedMotion !== undefined ? { reducedMotion: options.reducedMotion } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.theme ? { theme: options.theme } : {}),
      visibility: 'observe',
      ...(options.onValues ? { onValues: options.onValues } : {}),
      ...(options.onStep ? { onStep: options.onStep } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
      ...(options.onDescription
        ? {
            onUpdate: (update) => {
              if (typeof update.ui.description === 'string') options.onDescription?.(update.ui.description);
            },
          }
        : {}),
    });
    if (options.onEscape) listenForEscape(figure.root, options.onEscape);
    setState(figure.runtime.isMounted ? 'live' : 'failed');
  } catch (error) {
    options.onError?.({ phase: 'mount', message: error instanceof Error ? error.message : 'The figure could not start' });
    setState('failed');
  }
  const ready = Promise.resolve(state);
  return {
    get state() {
      return state;
    },
    ready,
    pause: () => figure?.renderer.setVisible(false),
    resume: () => figure?.renderer.setVisible(true),
    setValues: (values) => figure?.renderer.send({ type: 'setValues', values }),
    restore: ({ values, step }) => {
      if (values) figure?.renderer.send({ type: 'setValues', values });
      if (step !== undefined) {
        figure?.renderer.send(step === null ? { type: 'step', action: 'exit' } : { type: 'step', action: 'goto', index: step });
      }
    },
    setReducedMotion: (value) => figure?.renderer.send({ type: 'reducedMotion', value }),
    focus: (edge = 'first') => {
      const targets = figure ? focusable(figure.root) : [];
      (edge === 'first' ? targets[0] : targets[targets.length - 1])?.focus();
    },
    snapshot: () => snapshotStage(figure?.root.querySelector<SVGSVGElement>('svg.inc-stage') ?? null),
    destroy: () => {
      figure?.destroy();
      figure = null;
      setState('destroyed');
    },
  };
}

export const inThreadAdapter: ExecutionAdapter = { name: 'in-thread', mount: mountInThread };

const FOCUSABLE = 'button, input, select, summary, [tabindex="0"]';

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
}

/** The same keyboard hand-off as the sandbox frame: Escape, or Tab past either end. */
function listenForEscape(root: HTMLElement, onEscape: NonNullable<MountOptions['onEscape']>): void {
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      onEscape('out');
      return;
    }
    if (event.key !== 'Tab') return;
    const targets = focusable(root);
    const active = root.ownerDocument.activeElement;
    if (!event.shiftKey && active === targets[targets.length - 1]) {
      event.preventDefault();
      onEscape('forward');
    } else if (event.shiftKey && active === targets[0]) {
      event.preventDefault();
      onEscape('backward');
    }
  });
}
