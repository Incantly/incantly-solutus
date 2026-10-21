import { ALLOWED_MATH, ALLOWED_NUMBER, BLOCKED_PROPERTIES } from '../api/surface';
import type { Inc } from '../api/types';
import type { SceneFunction } from '../runtime/runtime';
import { FUEL_FUNCTION, KEY_FUNCTION } from '../validation/names';

/**
 * How validated scene code is wrapped before it runs. The wrapper gives the
 * scene exactly five names (inc, a Math without random, a reduced Number,
 * isFinite and isNaN), passes in the fuel and key guards, and shadows the
 * ambient globals a validator bug could otherwise expose. This is defence in
 * depth: the validator has already rejected every free name outside the subset.
 */

/** Globals shadowed with undefined inside the scene, in case the validator ever misses one. */
export const SHADOWED_GLOBALS = [
  'self',
  'globalThis',
  'window',
  'document',
  'parent',
  'top',
  'opener',
  'location',
  'navigator',
  'postMessage',
  'onmessage',
  'close',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'MessageChannel',
  'Function',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'requestAnimationFrame',
  'Atomics',
  'SharedArrayBuffer',
  'WebAssembly',
  'Reflect',
  'Proxy',
] as const;

export const SCENE_PARAMETERS = ['inc', 'Math', 'Number', 'isFinite', 'isNaN'] as const;

export type ScenePrimitive = (inc: Inc, math: unknown, number: unknown, finite: unknown, nan: unknown) => void;
export type SceneFactory = (fuel: () => void, key: (key: unknown) => string | number) => ScenePrimitive;

const PREFIX =
  `(function (${FUEL_FUNCTION}, ${KEY_FUNCTION}, ${SHADOWED_GLOBALS.join(', ')}) {"use strict"; ` +
  `return function (${SCENE_PARAMETERS.join(', ')}) {\n`;
const SUFFIX = '\n};})';

/** The scene source as a function expression; the agent's line 1 is the wrapper's line 2. */
export function wrapSceneSource(instrumentedCode: string): string {
  return `${PREFIX}${instrumentedCode}${SUFFIX}`;
}

/** Lines that come before the agent's first line inside the wrapped source. */
export const WRAPPER_LINES_BEFORE = PREFIX.split('\n').length - 1;

/** A frozen Math with only the pure members a scene may use. */
export function createSafeMath(): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = Object.create(null);
  for (const name of ALLOWED_MATH) out[name] = (Math as unknown as Record<string, unknown>)[name];
  return Object.freeze(out);
}

export function createSafeNumber(): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = Object.create(null);
  for (const name of ALLOWED_NUMBER) out[name] = (Number as unknown as Record<string, unknown>)[name];
  return Object.freeze(out);
}

/** The guard every computed property key passes through. */
export function guardKey(key: unknown): string | number {
  if (typeof key === 'number') return key;
  if (typeof key === 'string') {
    if (BLOCKED_PROPERTIES.has(key)) throw new TypeError(`"${key}" is not available in scenes`);
    return key;
  }
  throw new TypeError('Only numbers and strings can be used as property keys in scenes');
}

/** Turns a wrapped scene factory into the function the runtime mounts. */
export function bindScene(factory: SceneFactory, fuel: () => void): SceneFunction {
  const math = createSafeMath();
  const number = createSafeNumber();
  const scene = factory(fuel, guardKey);
  return (inc) => scene(inc, math, number, isFinite, isNaN);
}
