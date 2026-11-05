import type { RendererMessage, RuntimeUpdate } from '../protocol/runtime-messages';
import type { SceneFunction, SceneRuntime, SeekOptions } from '../runtime/runtime';
import { stageBounds } from '../scene/bounds';
import type { VNode } from '../scene/graph';

/** How a renderer talks to a scene runtime, in the same thread or across a Worker boundary. */
export interface RuntimeChannel {
  send(message: RendererMessage): void;
  onUpdate(listener: (update: RuntimeUpdate) => void): () => void;
}

const TOUCHES: ReadonlySet<RendererMessage['type']> = new Set<RendererMessage['type']>([
  'setParam',
  'play',
  'pause',
  'restart',
  'reset',
  'seek',
  'speed',
  'step',
  'partVisible',
  'note',
  'framePart',
  'drag',
  'view',
  'action',
  'legend',
  'formula',
  'predict',
  'undo',
  'redo',
  'timing',
  'frame',
  'compare',
]);

/**
 * Applies one renderer message to a runtime and returns the resulting update.
 * Shared by the in-thread channel and the Worker entry, so both behave alike.
 * The Worker passes its refuel hook so a seek refuels every replayed step.
 */
export function handleRendererMessage(runtime: SceneRuntime, message: RendererMessage, hooks: SeekOptions = {}): RuntimeUpdate | null {
  // Anything the learner does ends the idle tour; ticks, visibility and pointing do not.
  if (TOUCHES.has(message.type)) runtime.touched();
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
    case 'seek':
      return runtime.seek(message.seconds, hooks);
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
    case 'partVisible': {
      // A beat's show, hide and marks, as absolute visibility — the same
      // write applyShowHide does, without the film layer (the engine cannot
      // import it): the sandbox mirror drives beats across the bridge.
      const record = runtime.parts.parts.get(message.name);
      if (record && record.node.hidden === message.visible) runtime.graph.setFlags(record.node, { hidden: !message.visible });
      break;
    }
    case 'note':
      runtime.graph.note({
        wave: message.wave,
        frequency: Number.isFinite(message.frequency) ? message.frequency : 440,
        duration: Number.isFinite(message.duration) && message.duration > 0 ? message.duration : 0.2,
        gain: Number.isFinite(message.gain) ? Math.min(1, Math.max(0, message.gain)) : 0.5,
      });
      break;
    case 'framePart':
      frameRuntimePart(runtime, message.part, message.zoom);
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

/**
 * A beat's camera on the runtime itself: the same framing framePart in the
 * film layer computes, kept here so the sandbox Worker can apply it without
 * the film layer. Null returns kit-owned stages to the wide view.
 */
function frameRuntimePart(runtime: SceneRuntime, part: string | null, zoom: number): void {
  if (part === null) {
    for (const [stage] of runtime.viewControllers()) runtime.view(stage, { kind: 'reset' });
    return;
  }
  const factor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const record = runtime.parts.parts.get(part);
  if (!record || record.node.hidden) return;
  const stage = record.node.stage;
  const bounds = stageBounds(runtime.graph, stage);
  const ids = [record.node.id, ...subtreeIds(record.node, runtime.graph)];
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const id of ids) {
    const found = bounds.boxes.get(id);
    if (!found) continue;
    box = box
      ? { minX: Math.min(box.minX, found.minX), minY: Math.min(box.minY, found.minY), maxX: Math.max(box.maxX, found.maxX), maxY: Math.max(box.maxY, found.maxY) }
      : { ...found };
  }
  if (!box) return;
  if (!new Map(runtime.viewControllers()).has(stage)) return;
  runtime.view(stage, { kind: 'reset' });
  if (factor !== 1) runtime.view(stage, { kind: 'zoom', x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, factor });
}

function subtreeIds(node: VNode, graph: SceneRuntime['graph']): number[] {
  const out: number[] = [];
  const visit = (current: VNode): void => {
    for (const id of current.children) {
      out.push(id);
      const child = graph.nodes.get(id);
      if (child) visit(child);
    }
  };
  visit(node);
  return out;
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
