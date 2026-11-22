/**
 * The job of one request (docs/state-machines.md SV1): one field over `SERVER_JOB_MACHINE`. It owns the response, so
 * exactly one answer ends each request, nothing is written after the job is final, and the head of an NDJSON answer is
 * written with its first event, or by `open()` on a model route, once its checks pass (an error after that is the last event).
 */
import type { ServerResponse } from 'node:http';
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { STATUS, fingerprintOf, internalError, retryAfterSeconds } from '../errors';
import type { ServerError } from '../errors';
import type { LogFn } from '../log';
import { openNdjson, writeNdjson } from '../http/ndjson';

export type JobState = 'received' | 'running' | 'streaming' | 'done' | 'refused' | 'aborted' | 'failed';
export type JobMove = 'checked' | 'refuse' | 'fail' | 'firstEvent' | 'finish' | 'close';

/** docs/state-machines.md SV1. The last four states take no event. */
export const SERVER_JOB_MACHINE: MachineTable<JobState, JobMove> = {
  received: { checked: 'running', refuse: 'refused', fail: 'failed' },
  running: { firstEvent: 'streaming', finish: 'done', close: 'aborted', fail: 'failed' },
  streaming: { finish: 'done', close: 'aborted', fail: 'failed' },
  done: {},
  refused: {},
  aborted: {},
  failed: {},
};

export interface JobContext {
  readonly res: ServerResponse;
  readonly log: LogFn;
  /** CORS headers for this request's origin; added to every answer. */
  readonly headers: Readonly<Record<string, string>>;
  /** The request's id, for the log. */
  readonly id: number;
}

export class Job {
  /** Aborted when the client closes the connection; the model call listens to it. */
  readonly abort = new AbortController();
  private readonly machine: StateMachine<JobState, JobMove>;

  constructor(private readonly ctx: JobContext) {
    this.machine = new StateMachine(SERVER_JOB_MACHINE, 'received', (from, event) => {
      ctx.log('job.refused', { id: ctx.id, machine: 'server job', from, event, fingerprint: `internal:job.${from}.${event}` });
    });
  }

  /** True while no answer was started: the job can still be refused, or written to. */
  is(a: JobState, b?: JobState): boolean {
    return this.machine.is(a, b);
  }

  /** The checks passed (method, route, origin, size, JSON, limits). */
  checked(): boolean {
    return this.machine.can('checked') && this.machine.send('checked');
  }

  /** A check failed: the answer is an HTTP error. */
  refuse(error: ServerError): void {
    if (!this.machine.can('refuse') || !this.machine.send('refuse')) return;
    this.writeError(error);
  }

  /**
   * A model route: the checks passed, so the answer is a stream (design 6). `checked` and `firstEvent` follow at once and
   * the head goes out before any event, so every later error, from the model or the deadline, is the stream's last event.
   */
  open(): boolean {
    if (!this.checked()) return false;
    if (!this.machine.send('firstEvent')) return false;
    openNdjson(this.ctx.res, this.ctx.headers);
    return true;
  }

  /** The answer is one JSON body. */
  json(status: number, body: unknown): void {
    if (!this.machine.can('finish') || !this.machine.send('finish')) return;
    this.writeJson(status, body);
  }

  /** The answer has no body (an answer to a preflight request). */
  empty(status: number, headers: Readonly<Record<string, string>> = {}): void {
    if (!this.machine.can('finish') || !this.machine.send('finish')) return;
    this.writeEmpty(status, headers);
  }

  /** One NDJSON event, flushed at once. The first one writes the head. Dropped when the job is final. */
  event(event: unknown): void {
    if (this.machine.can('firstEvent')) {
      if (!this.machine.send('firstEvent')) return;
      openNdjson(this.ctx.res, this.ctx.headers);
    } else if (!this.is('streaming')) {
      return;
    }
    writeNdjson(this.ctx.res, event);
  }

  /** The stream is complete (its last event was written), or the answer had no event. */
  end(): void {
    if (!this.machine.can('finish')) return;
    const wasRunning = this.machine.is('running');
    if (!this.machine.send('finish')) return;
    if (wasRunning) openNdjson(this.ctx.res, this.ctx.headers);
    this.ctx.res.end();
  }

  /** An error ends the job: an HTTP error before the first event, the last event after it. */
  fail(error: ServerError): void {
    if (!this.machine.can('fail')) return;
    const streaming = this.machine.is('streaming');
    if (!this.machine.send('fail')) return;
    if (streaming) {
      writeNdjson(this.ctx.res, { error });
      this.ctx.res.end();
      return;
    }
    this.writeError(error);
  }

  /** The client closed the connection: the model call is aborted and nothing more is written. */
  close(): void {
    if (this.machine.can('close') && this.machine.send('close')) this.abort.abort();
  }

  /** A fault in a handler: logged with a fingerprint, answered as `internal`, never thrown. */
  crash(e: unknown): void {
    const fingerprint = fingerprintOf(e);
    this.ctx.log('internal', { id: this.ctx.id, fingerprint, message: e instanceof Error ? e.message : 'unknown', stack: e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 6).join('\n') : '' });
    this.fail(internalError(fingerprint));
  }

  /**
   * Makes sure the request ended with an answer. A job that is not final (a handler returned without answering) fails
   * through the machine as `internal`; the response is then closed if it is still open (a job that was aborted).
   */
  ensureEnded(): void {
    if (this.machine.can('fail')) this.crash(new Error('no answer'));
    this.writeEnd();
  }

  private writeEmpty(status: number, headers: Readonly<Record<string, string>>): void {
    const res = this.ctx.res;
    if (res.writableEnded) return;
    res.writeHead(status, { ...this.ctx.headers, ...headers, 'content-length': '0' });
    res.end();
  }

  /** The last guard: ends a response that is still open. */
  private writeEnd(): void {
    const res = this.ctx.res;
    if (!res.writableEnded) res.end();
  }

  private writeJson(status: number, body: unknown): void {
    const res = this.ctx.res;
    if (res.writableEnded) return;
    const text = JSON.stringify(body);
    res.writeHead(status, { ...this.ctx.headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  }

  private writeError(error: ServerError): void {
    const res = this.ctx.res;
    if (res.writableEnded || res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    const retry = retryAfterSeconds(error);
    const text = JSON.stringify(error);
    res.writeHead(STATUS[error.kind], {
      ...this.ctx.headers,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
      ...(retry !== undefined ? { 'retry-after': String(retry) } : {}),
      ...(error.kind === 'payload_too_large' ? { connection: 'close' } : {}),
    });
    res.end(text);
  }
}
