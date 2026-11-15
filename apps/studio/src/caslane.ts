/**
 * The two lanes of the CAS in the studio (cas/design.md 5.13; SYM-SM-26): the engine answers on the main thread within
 * a few milliseconds or says `pending` and hands the job here; the worker computes it, its answer seeds the main
 * thread's cache, and the objects that waited are computed again. A newer job for the same object cancels the older.
 */
import type { LaneJob } from '@incantly/symbolic';

interface Lanes {
  readonly submit: (job: LaneJob) => void;
}

/**
 * Starts the worker and turns the lanes on. Returns false where workers are not available (tests, old browsers): then
 * every call simply runs to its full budget on the main thread.
 */
export function startCasLanes(onAnswer: () => void): boolean {
  if (typeof Worker === 'undefined') return false;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./cas.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return false;
  }
  let id = 0;
  const byOwner = new Map<string, number>();
  let accept: ((key: string, result: unknown) => void) | undefined;
  void import('@incantly/symbolic').then((m) => {
    accept = (key, result) => m.acceptWorkerResult(key, result as Parameters<typeof m.acceptWorkerResult>[1]);
    const lanes: Lanes = {
      submit: (job) => {
        const prev = byOwner.get(job.owner);
        if (prev !== undefined) worker.postMessage({ cancel: prev });
        const n = ++id;
        byOwner.set(job.owner, n);
        worker.postMessage({ id: n, key: job.key, op: job.op, args: job.args, domains: job.domains });
      },
    };
    m.setCasLanes({ fastLaneMs: 4, ...lanes });
  });
  worker.onmessage = (e: MessageEvent<{ id: number; key?: string; result: unknown }>): void => {
    const { key, result } = e.data;
    if (key === undefined || !accept) return;
    accept(key, result);
    for (const [owner, n] of byOwner) if (n === e.data.id) byOwner.delete(owner);
    onAnswer();
  };
  return true;
}
