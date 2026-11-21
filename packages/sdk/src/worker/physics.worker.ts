/**
 * The physics worker's entry (docs/features/physics/design.md 9.6): one message at a time, each answered with the cells
 * the world owns, their typed arrays moved to the page.
 */
import { PhysicsWorkerState } from './physics-worker';
import type { ToWorker } from './physics-worker';

const scope = globalThis as unknown as {
  onmessage: ((e: { data: ToWorker }) => void) | null;
  postMessage(m: unknown, transfer: ArrayBuffer[]): void;
};
const state = new PhysicsWorkerState();

scope.onmessage = (e): void => {
  const { reply, transfer } = state.handle(e.data);
  scope.postMessage(reply, transfer);
};
