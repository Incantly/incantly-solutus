/**
 * Worker hosting (cas/design.md 5.1, 5.13): the message protocol for running `run` in a
 * Web Worker. No DOM here: the kernel (or sdk) owns the actual `Worker` and posts these
 * plain-data messages. `SymNode`/`SymCond`/`SymArg` are plain data (bigints included),
 * so they cross `postMessage` by structured clone unchanged.
 */
import type { Result } from '@incantly/kernel';
import type { Domain, OpName, RunContext, SymArg } from './contracts';
import type { SymCond } from './node';
import type { RunOptions, RunSuccess } from './run';

/**
 * A symbolic job for the worker. `resolveRef` cannot cross `postMessage`, so the host resolves every `ref` to its value
 * before it posts (the kernel's engine never sends refs).
 */
export interface WorkerRequest {
  readonly id: number;
  /** The main thread's cache key of the call (`runCacheKey`), sent back so the answer can seed that cache. */
  readonly key?: string;
  readonly op: OpName;
  readonly args: readonly SymArg[];
  readonly opts?: RunOptions;
  readonly domains?: ReadonlyArray<readonly [string, Domain]>;
  readonly facts?: readonly SymCond[];
}

/** The worker's answer. */
export interface WorkerResponse {
  readonly id: number;
  readonly key?: string;
  readonly result: Result<RunSuccess>;
}

/** Drop a job that has not started (a slider moved on, so its answer is no longer wanted). */
export interface WorkerCancel {
  readonly cancel: number;
}

export type WorkerMessage = WorkerRequest | WorkerCancel;

/**
 * The worker's queue (SYM-SM-26): jobs wait here, a cancel removes one that has not started, and a newer job for the
 * same key replaces an older one. The worker script takes one job per turn of its event loop, so cancels arriving
 * between jobs are seen. Pure: no timers here.
 */
export class WorkerQueue {
  private readonly jobs: WorkerRequest[] = [];

  push(m: WorkerMessage): void {
    if ('cancel' in m) {
      const i = this.jobs.findIndex((j) => j.id === m.cancel);
      if (i >= 0) this.jobs.splice(i, 1);
      return;
    }
    if (m.key !== undefined) {
      const i = this.jobs.findIndex((j) => j.key === m.key);
      if (i >= 0) this.jobs.splice(i, 1);
    }
    this.jobs.push(m);
  }

  next(): WorkerRequest | undefined {
    return this.jobs.shift();
  }

  get size(): number {
    return this.jobs.length;
  }
}

/**
 * Handle one request with `run`. The host calls this inside the worker's `onmessage`
 * and posts the response back. Never throws: `run` already returns data for every
 * failure, and the `catch` below guards the guard.
 */
export function handleWorkerRequest(
  req: WorkerRequest,
  run: (op: OpName, args: readonly SymArg[], opts: RunOptions, ctx: RunContext) => Result<RunSuccess>,
): WorkerResponse {
  try {
    const ctx: RunContext = {
      ...(req.domains === undefined ? {} : { domains: new Map(req.domains) }),
      ...(req.facts === undefined ? {} : { facts: req.facts }),
    };
    return { id: req.id, ...(req.key === undefined ? {} : { key: req.key }), result: run(req.op, req.args, req.opts ?? {}, ctx) };
  } catch (err) {
    return {
      id: req.id,
      result: {
        ok: false,
        committed: false,
        kind: 'internal',
        code: 'K999',
        phase: 'plan',
        message: err instanceof Error ? err.message : 'Worker failed.',
        messageKey: 'symbolic.internal',
        params: {},
        line: 1,
        col: 1,
        endCol: 1,
        token: '',
        expected: [],
        forms: [],
        suggest: [],
        recovery: 'report',
        fingerprint: 'internal:symbolic-worker',
        severity: 'error',
      },
    };
  }
}

/** Minimal worker surface the host implements (real `Worker` or a test double). */
export interface WorkerHost {
  post(req: WorkerRequest): void;
  onResponse(cb: (res: WorkerResponse) => void): void;
}
