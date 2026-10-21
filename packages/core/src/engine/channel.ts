import type { RendererMessage, RuntimeUpdate } from '../protocol/runtime-messages';
import type { SceneFunction, SceneRuntime } from '../runtime/runtime';

/** How a renderer talks to a scene runtime, in the same thread or across a Worker boundary. */
export interface RuntimeChannel {
  send(message: RendererMessage): void;
  onUpdate(listener: (update: RuntimeUpdate) => void): () => void;
}

/**
 * Applies one renderer message to a runtime and returns the resulting update.
 * Shared by the in-thread channel and the Worker entry, so both behave alike.
 */
export function handleRendererMessage(runtime: SceneRuntime, message: RendererMessage): RuntimeUpdate | null {
  switch (message.type) {
    case 'tick':
      return runtime.tick(message.dt);
    case 'setParam':
      runtime.setParam(message.name, message.value);
      break;
    case 'setValues':
      runtime.setValues(message.values);
      break;
    case 'play':
      runtime.play();
      break;
    case 'pause':
      runtime.pause();
      break;
    case 'restart':
      return runtime.restart();
    case 'reset':
      return runtime.reset();
    case 'speed':
      runtime.setSpeed(message.value);
      break;
    case 'visible':
      runtime.setVisible(message.value);
      break;
    case 'reducedMotion':
      runtime.setReducedMotion(message.value);
      break;
    case 'step':
      runtime.step(message.action, message.index);
      break;
    case 'focusPart':
      runtime.focusPart(message.name);
      break;
    case 'drag':
      runtime.drag(message.id, message.phase, message.x, message.y);
      break;
    case 'hover':
      runtime.hover(message.stage, message.x, message.y);
      break;
    case 'view':
      runtime.view(message.stage, message.action);
      break;
    case 'action':
      runtime.action(message.index);
      break;
    case 'legend':
      runtime.setLegend(message.id, message.visible);
      break;
    case 'formula':
      runtime.editFormula(message.index, message.source);
      break;
    case 'predict':
      runtime.predict(message.index, message.choice, message.reveal === true);
      break;
    case 'undo':
      runtime.undo();
      break;
    case 'redo':
      runtime.redo();
      break;
    case 'timing':
      runtime.setTiming(message);
      break;
    case 'frame':
      runtime.stepFrame();
      break;
    case 'compare':
      runtime.setCompare(message.on);
      break;
    case 'destroy':
      runtime.destroy();
      return null;
  }
  return runtime.flush();
}

/** Runs the scene runtime in the same thread. Used for trusted reference scenes and tests. */
export class InThreadChannel implements RuntimeChannel {
  private readonly listeners = new Set<(update: RuntimeUpdate) => void>();

  constructor(readonly runtime: SceneRuntime) {}

  start(scene: SceneFunction): void {
    this.emit(this.runtime.mount(scene));
  }

  send(message: RendererMessage): void {
    const update = handleRendererMessage(this.runtime, message);
    if (update) this.emit(update);
  }

  onUpdate(listener: (update: RuntimeUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(update: RuntimeUpdate): void {
    for (const listener of this.listeners) listener(update);
  }
}
