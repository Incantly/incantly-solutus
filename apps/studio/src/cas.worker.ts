/**
 * The CAS worker (cas/design.md 5.13; finding SYM-SM-26): heavy algebra runs here, so a slow Factor or Solve never
 * blocks the page. One job per turn of the event loop, so a cancel that arrives between jobs is honoured.
 */
import { WorkerQueue, handleWorkerRequest, run } from '@incantly/symbolic';
import type { WorkerMessage } from '@incantly/symbolic';

const scope = globalThis as unknown as {
  onmessage: ((e: { data: WorkerMessage }) => void) | null;
  postMessage(m: unknown): void;
  setTimeout(f: () => void, ms: number): unknown;
};
const queue = new WorkerQueue();
let busy = false;

const step = (): void => {
  const job = queue.next();
  if (!job) {
    busy = false;
    return;
  }
  scope.postMessage(handleWorkerRequest(job, run));
  scope.setTimeout(step, 0);
};

scope.onmessage = (e): void => {
  queue.push(e.data);
  if (!busy) {
    busy = true;
    scope.setTimeout(step, 0);
  }
};
