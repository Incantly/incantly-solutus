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
    });
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
    snapshot: () => snapshotStage(figure?.root.querySelector<SVGSVGElement>('svg.inc-stage') ?? null),
    destroy: () => {
      figure?.destroy();
      figure = null;
      setState('destroyed');
    },
  };
}

export const inThreadAdapter: ExecutionAdapter = { name: 'in-thread', mount: mountInThread };
