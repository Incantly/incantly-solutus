import { handleRendererMessage } from '../engine/channel';
import { probeScene } from '../probe/probe';
import type { RendererMessage } from '../protocol/runtime-messages';
import { createFuel, type FuelTank } from '../runtime/fuel';
import { isKitModule, KIT_GLOBAL, type KitRegistry } from '../runtime/kits';
import { SceneRuntime } from '../runtime/runtime';
import { SHARED_GLOBAL, SHARED_MODULES } from './kit-shared';
import { bindScene, type SceneFactory } from './scene-wrapper';
import { locateInStack, type StackMap } from './stack';
import type { WorkerBoot, WorkerInbound, WorkerOutbound } from './worker-protocol';

/**
 * The Worker side of the sandbox. This bundle is the first part of the Worker
 * script; the wrapped scene follows it in the same blob and registers itself
 * through __incRegister. The scene then runs here, with no DOM, and the frame
 * draws what this posts back.
 */

interface WorkerScope {
  postMessage(message: WorkerOutbound): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  location: { href: string };
  [key: string]: unknown;
}

const scope = globalThis as unknown as WorkerScope;
const post = scope.postMessage.bind(scope);
let factory: SceneFactory | null = null;
let runtime: SceneRuntime | null = null;
let fuel: FuelTank = createFuel();
let kits: KitRegistry = {};

// Kit scripts joined after this one read the shared modules here, then register under KIT_GLOBAL.
Object.defineProperty(scope, SHARED_GLOBAL, { configurable: true, value: SHARED_MODULES });

/** Takes the kits that registered and removes both globals before the scene can run. */
function takeKits(): KitRegistry {
  const registered = scope[KIT_GLOBAL];
  const out: Record<string, unknown> = {};
  if (typeof registered === 'object' && registered !== null) {
    for (const [name, kit] of Object.entries(registered)) if (isKitModule(kit) && kit.name === name) out[name] = kit;
  }
  delete (scope as Record<string, unknown>)[KIT_GLOBAL];
  delete (scope as Record<string, unknown>)[SHARED_GLOBAL];
  return Object.freeze(out) as KitRegistry;
}

Object.defineProperty(scope, '__incRegister', {
  configurable: true,
  value: (candidate: unknown) => {
    if (factory === null && typeof candidate === 'function') factory = candidate as SceneFactory;
    // One registration only; nothing can replace the scene later.
    delete (scope as Record<string, unknown>).__incRegister;
    kits = takeKits();
    neutralize();
  },
});

/**
 * Defence in depth: the validator already keeps scenes away from these, and the
 * frame's policy blocks the network, but nothing in this Worker needs them.
 */
function neutralize(): void {
  for (const name of [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'WebTransport',
    'EventSource',
    'importScripts',
    'indexedDB',
    'caches',
    'BroadcastChannel',
    'Worker',
    'SharedWorker',
  ]) {
    try {
      Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false });
    } catch {
      // Some names are not configurable in some engines; the policy still blocks them.
    }
  }
}

function fatal(message: string): void {
  post({ type: 'fatal', error: { phase: 'mount', message } });
}

function boot(message: WorkerBoot): void {
  if (!factory) {
    fatal('The scene did not load');
    return;
  }
  fuel = createFuel();
  const map: StackMap = { lineOffset: message.lineOffset, sceneLines: message.sceneLines, shifts: message.shifts };
  const locate = (error: unknown) => (error instanceof Error && typeof error.stack === 'string' ? locateInStack(error.stack, map) : null);
  const scene = bindScene(factory, fuel.burn);

  if (message.mode === 'probe') {
    const report = probeScene(scene, {
      ...(message.probe?.spec ? { spec: message.probe.spec } : {}),
      ...(message.probe?.seed !== undefined ? { seed: message.probe.seed } : {}),
      ...(message.probe?.frameBudgetMs !== undefined ? { frameBudgetMs: message.probe.frameBudgetMs } : {}),
      ...(message.probe?.elementBudget !== undefined ? { elementBudget: message.probe.elementBudget } : {}),
      beforeStep: fuel.refuel,
      runtime: { locate, kits },
    });
    post({ type: 'probe', report });
    return;
  }

  const live = message.live ?? {};
  runtime = new SceneRuntime({
    ...(live.values ? { values: live.values } : {}),
    ...(live.formulas ? { formulas: live.formulas } : {}),
    ...(live.step !== undefined ? { step: live.step } : {}),
    ...(live.autoplay !== undefined ? { autoplay: live.autoplay } : {}),
    ...(live.reducedMotion !== undefined ? { reducedMotion: live.reducedMotion } : {}),
    ...(live.seed !== undefined ? { seed: live.seed } : {}),
    locate,
    kits,
  });
  fuel.refuel();
  post({ type: 'update', update: runtime.mount(scene) });
}

const EMPTY_UPDATE = { commands: [], ui: {}, needsFrame: false } as const;

function handle(message: RendererMessage): void {
  // Every message is answered, so the frame's watchdog can tell busy from hung.
  if (!runtime) {
    if (message.type !== 'destroy') post({ type: 'update', update: EMPTY_UPDATE });
    return;
  }
  fuel.refuel();
  // A seek replays up to 3,600 steps inside one call; each step refuels, so fuel never stops a long seek.
  const update = handleRendererMessage(runtime, message, { beforeStep: fuel.refuel });
  if (update) post({ type: 'update', update });
}

scope.onmessage = (event) => {
  const data = event.data as WorkerInbound;
  try {
    if (data?.type === 'boot') boot(data);
    else if (data?.type === 'message') handle(data.message);
  } catch (error) {
    // The runtime catches scene errors itself; reaching here is an engine fault.
    fatal(error instanceof Error ? error.message : 'The figure stopped');
  }
};

post({ type: 'alive' });
