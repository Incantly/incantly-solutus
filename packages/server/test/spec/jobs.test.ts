/**
 * The job of one request (server design 7 table, docs/state-machines.md SV1, requirements R5.5): `SERVER_JOB_MACHINE`
 * row by row, every move with no row refused, and the behaviour of a job over a real HTTP request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { SERVER_JOB_MACHINE, serverError } from '../../src/index';
import type { JobMove, JobState } from '../../src/index';
import { addRoutes, ask, errorBody, getJson, openStream, start, until } from './helpers';
import type { Running } from './helpers';

const STATES: readonly JobState[] = ['received', 'running', 'streaming', 'done', 'refused', 'aborted', 'failed'];
const MOVES: readonly JobMove[] = ['checked', 'refuse', 'fail', 'firstEvent', 'finish', 'close'];

/** The rows of the table in server design 7, with the event names of docs/state-machines.md SV1. */
const DESIGN_ROWS: readonly (readonly [JobState, JobMove, JobState])[] = [
  ['received', 'checked', 'running'],
  ['received', 'refuse', 'refused'],
  ['running', 'firstEvent', 'streaming'],
  ['running', 'finish', 'done'],
  ['streaming', 'finish', 'done'],
  ['running', 'close', 'aborted'],
  ['streaming', 'close', 'aborted'],
  ['running', 'fail', 'failed'],
  ['streaming', 'fail', 'failed'],
];

/** The rows SV1 adds to design 7 (a contradiction between the two documents, listed in the report). */
const SV1_EXTRA_ROWS: readonly (readonly [JobState, JobMove, JobState])[] = [['received', 'fail', 'failed']];

const rowsOf = (table: MachineTable<JobState, JobMove>): string[] =>
  Object.entries(table).flatMap(([from, moves]) => Object.entries(moves as Record<string, string>).map(([event, to]) => `${from} -${event}-> ${to}`)).sort();

describe('SERVER_JOB_MACHINE (design 7, SV1)', () => {
  it('every row of design 7 is in the table', () => {
    for (const [from, event, to] of DESIGN_ROWS) expect(SERVER_JOB_MACHINE[from][event], `${from} ${event}`).toBe(to);
  });

  it('every row that SV1 adds is in the table', () => {
    for (const [from, event, to] of SV1_EXTRA_ROWS) expect(SERVER_JOB_MACHINE[from][event], `${from} ${event}`).toBe(to);
  });

  it('the table is exactly the rows of SV1 (design 7 and its addition), nothing else', () => {
    expect(rowsOf(SERVER_JOB_MACHINE)).toEqual([...DESIGN_ROWS, ...SV1_EXTRA_ROWS].map(([f, e, t]) => `${f} -${e}-> ${t}`).sort());
  });

  it('done, refused, aborted and failed are final: they take no event', () => {
    for (const s of ['done', 'refused', 'aborted', 'failed'] as const) expect(SERVER_JOB_MACHINE[s]).toEqual({});
  });

  for (const from of STATES) {
    for (const event of MOVES) {
      const to = SERVER_JOB_MACHINE[from][event];
      it(to !== undefined ? `${from} on ${event} goes to ${to}` : `${from} on ${event} is refused and reported, and the state does not change`, () => {
        const refused: [string, string][] = [];
        const m = new StateMachine(SERVER_JOB_MACHINE, from, (f, e) => refused.push([f, e]));
        expect(m.send(event)).toBe(to !== undefined);
        expect(m.state).toBe(to ?? from);
        expect(refused).toEqual(to === undefined ? [[from, event]] : []);
      });
    }
  }

  it('a whole streamed request walks received, running, streaming, done', () => {
    const m = new StateMachine(SERVER_JOB_MACHINE, 'received', () => undefined);
    for (const e of ['checked', 'firstEvent', 'finish'] as const) expect(m.send(e), e).toBe(true);
    expect(m.state).toBe('done');
  });
});

describe('a job over a real request (SV1 invariants)', () => {
  const trail: Record<string, string[]> = {};
  const mark = (name: string, state: string): void => {
    (trail[name] ??= []).push(state);
  };
  const stateOf = (job: { is(a: JobState, b?: JobState): boolean }): string => STATES.find((s) => job.is(s)) ?? '?';
  let undo: (() => void) | undefined;
  let run: Running;

  beforeAll(async () => {
    undo = addRoutes([
      {
        method: 'GET',
        path: '/v1/job/json',
        bodyLimit: 0,
        handle(ctx) {
          mark('json', stateOf(ctx.job));
          ctx.job.checked();
          mark('json', stateOf(ctx.job));
          ctx.job.json(200, { first: true });
          mark('json', stateOf(ctx.job));
          ctx.job.json(200, { second: true });
          ctx.job.event({ late: true });
          ctx.job.fail(serverError('internal', 'late'));
          ctx.job.refuse(serverError('bad_request', 'late'));
          mark('json', stateOf(ctx.job));
        },
      },
      {
        method: 'GET',
        path: '/v1/job/stream',
        bodyLimit: 0,
        handle(ctx) {
          ctx.job.checked();
          mark('stream', stateOf(ctx.job));
          ctx.job.event({ n: 1 });
          mark('stream', stateOf(ctx.job));
          ctx.job.event({ n: 2 });
          ctx.job.end();
          mark('stream', stateOf(ctx.job));
          ctx.job.event({ n: 3 });
          ctx.job.json(200, { late: true });
          ctx.job.fail(serverError('internal', 'late'));
          ctx.job.end();
        },
      },
      {
        method: 'GET',
        path: '/v1/job/fail-running',
        bodyLimit: 0,
        handle(ctx) {
          ctx.job.checked();
          ctx.job.fail(serverError('model_unavailable', 'The AI is not set up.'));
          mark('fail-running', stateOf(ctx.job));
          ctx.job.event({ late: true });
        },
      },
      {
        method: 'GET',
        path: '/v1/job/refuse',
        bodyLimit: 0,
        handle(ctx) {
          ctx.job.refuse(serverError('bad_request', 'The field "x" is missing.'));
          mark('refuse', stateOf(ctx.job));
          ctx.job.checked();
          mark('refuse', stateOf(ctx.job));
          ctx.job.event({ late: true });
        },
      },
      {
        method: 'GET',
        path: '/v1/job/refuse-late',
        bodyLimit: 0,
        handle(ctx) {
          ctx.job.checked();
          ctx.job.event({ n: 1 });
          ctx.job.refuse(serverError('bad_request', 'too late to refuse'));
          ctx.job.end();
        },
      },
      {
        method: 'GET',
        path: '/v1/job/silent',
        bodyLimit: 0,
        handle(ctx) {
          ctx.job.checked();
        },
      },
      {
        method: 'GET',
        path: '/v1/job/running-abort',
        bodyLimit: 0,
        async handle(ctx) {
          ctx.job.checked();
          await new Promise<void>((resolve) => ctx.job.abort.signal.addEventListener('abort', () => resolve(), { once: true }));
          mark('running-abort', stateOf(ctx.job));
          ctx.job.event({ late: true });
          ctx.job.end();
        },
      },
    ]);
    run = await start({});
  });

  afterAll(async () => {
    undo?.();
    await run.close();
  });

  it('received, then running after the checks, then done with a JSON answer', async () => {
    const r = await getJson(run.port, '/v1/job/json');
    expect(r.status).toBe(200);
    expect(trail['json']).toEqual(['received', 'running', 'done', 'done']);
  });

  it('exactly one response ends the request: later answers, events and errors of a finished job are dropped', async () => {
    const r = await getJson(run.port, '/v1/job/json');
    expect(r.json).toEqual({ first: true });
  });

  it('running, then streaming with the first event, then done at the end', async () => {
    const s = await openStream(run.port, { path: '/v1/job/stream' });
    expect(s.status).toBe(200);
    expect(await s.next()).toBe('{"n":1}');
    expect(await s.next()).toBe('{"n":2}');
    expect(await s.next()).toBeUndefined();
    expect(s.ended()).toBe(true);
    expect(trail['stream']).toEqual(['running', 'streaming', 'done']);
  });

  it('nothing is written in a final state: no third event, no late JSON, no late error', async () => {
    const r = await ask(run.port, { path: '/v1/job/stream' });
    expect(r.text).toBe('{"n":1}\n{"n":2}\n');
  });

  it('the head is written once, with the first event, so one stream has one status line', async () => {
    const r = await ask(run.port, { path: '/v1/job/stream' });
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/^application\/x-ndjson/);
  });

  it('an error in `running` is an HTTP error body and the job is failed', async () => {
    const r = await getJson(run.port, '/v1/job/fail-running');
    expect(r.status).toBe(503);
    expect(errorBody(r)).toMatchObject({ kind: 'model_unavailable', message: 'The AI is not set up.' });
    expect(trail['fail-running']).toEqual(['failed']);
    expect(r.text).not.toContain('late');
  });

  it('a refused request is `refused`, its answer is the HTTP error, and `checked` after it has no effect', async () => {
    const r = await getJson(run.port, '/v1/job/refuse');
    expect(r.status).toBe(400);
    expect(errorBody(r).message).toBe('The field "x" is missing.');
    expect(trail['refuse']).toEqual(['refused', 'refused']);
  });

  it('a refusal after the first event has no row: the stream stays a stream and ends normally', async () => {
    const r = await ask(run.port, { path: '/v1/job/refuse-late' });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"n":1}\n');
  });

  it('a handler that answers nothing still gets one answer: the request does not hang', async () => {
    const r = await ask(run.port, { path: '/v1/job/silent' });
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('a client that leaves while the job is `running` (no event written yet) aborts it', async () => {
    const { request } = await import('node:http');
    const req = request({ host: '127.0.0.1', port: run.port, path: '/v1/job/running-abort', method: 'GET', agent: false });
    req.on('error', () => undefined);
    req.end();
    await new Promise((r) => setTimeout(r, 150));
    req.destroy();
    expect(await until(() => trail['running-abort'] !== undefined, 1500)).toBe(true);
    expect(trail['running-abort']?.[0]).toBe('aborted');
  });
});
