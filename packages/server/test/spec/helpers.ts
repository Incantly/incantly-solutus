/**
 * Helpers of the server spec tests: a server on a random port of 127.0.0.1, a small HTTP client on `node:http` (so a test
 * sets any header, including `Origin`, and reads a stream line by line), and test routes. No network beyond loopback.
 */
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { ROUTES, createServer, readSettings } from '../../src/index';
import type { EnvLike, Route, Server, ServerOptions, Settings } from '../../src/index';

export const settingsOf = (env: EnvLike = {}): Settings => {
  const r = readSettings(env);
  if (!r.ok) throw new Error(`readSettings failed: ${r.kind}: ${r.message}`);
  return r.value;
};

export interface Running {
  readonly server: Server;
  readonly port: number;
  readonly settings: Settings;
  close(): Promise<void>;
}

/** Starts a server on port 0 of 127.0.0.1. */
export async function start(env: EnvLike = {}, options: Partial<Omit<ServerOptions, 'settings'>> = {}): Promise<Running> {
  const settings = settingsOf(env);
  const server = createServer({ settings, ...options });
  const listening = await server.listen(0, '127.0.0.1');
  if (!listening.ok) throw new Error(`listen failed: ${listening.message}`);
  return { server, port: listening.port, settings, close: () => server.close() };
}

export interface Reply {
  readonly status: number;
  readonly headers: IncomingMessage['headers'];
  readonly text: string;
  /** The body parsed as JSON, or undefined. */
  readonly json: unknown;
}

export interface Ask {
  readonly method?: string;
  readonly path: string;
  readonly headers?: Record<string, string>;
  /** Text or bytes sent as the body. */
  readonly body?: string | Uint8Array;
  /** Send the body in chunks with no content-length. */
  readonly chunked?: boolean;
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** One request, one whole reply. */
export function ask(port: number, a: Ask): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(a.headers ?? {}) };
    const bytes = a.body === undefined ? undefined : typeof a.body === 'string' ? Buffer.from(a.body) : Buffer.from(a.body);
    if (bytes !== undefined && a.chunked !== true) headers['content-length'] = String(bytes.length);
    const req = httpRequest({ host: '127.0.0.1', port, method: a.method ?? (bytes === undefined ? 'GET' : 'POST'), path: a.path, headers, agent: false }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: parse(text) });
      });
      res.on('error', () => {
        const text = Buffer.concat(parts).toString('utf8');
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: parse(text) });
      });
    });
    // the server may answer and close before the whole body is sent: the answer is what counts. A reset that comes before
    // any answer is a status of 0 (the client never saw the answer), not a hang.
    req.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ECONNRESET' || code === 'EPIPE') {
        setTimeout(() => resolve({ status: 0, headers: {}, text: `connection ${code}`, json: undefined }), 50);
        return;
      }
      reject(e);
    });
    if (bytes !== undefined) {
      if (a.chunked === true) {
        const size = 16 * 1024;
        for (let i = 0; i < bytes.length; i += size) req.write(bytes.subarray(i, i + size));
        req.end();
      } else {
        req.end(bytes);
      }
    } else {
      req.end();
    }
  });
}

export const getJson = (port: number, path: string, headers: Record<string, string> = {}): Promise<Reply> => ask(port, { path, headers });
export const postJson = (port: number, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
  ask(port, { method: 'POST', path, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

/** A reply that is an error object: `{ ok: false, kind, message, ... }`. */
export function errorBody(r: Reply): { ok: false; kind: string; message: string; hint?: string; detail?: Record<string, unknown> } {
  const j = r.json as { ok?: unknown; kind?: unknown; message?: unknown } | undefined;
  if (j === undefined || j.ok !== false || typeof j.kind !== 'string' || typeof j.message !== 'string') throw new Error(`not an error body (status ${r.status}): ${r.text.slice(0, 200)}`);
  return j as ReturnType<typeof errorBody>;
}

export interface Stream {
  readonly status: number;
  readonly headers: IncomingMessage['headers'];
  /** The next full line, or undefined when the stream ended first, or after `ms`. */
  next(ms?: number): Promise<string | undefined>;
  /** Everything read so far has been consumed and the stream ended. */
  ended(): boolean;
  /** Closes the connection from the client's side. */
  destroy(): void;
}

/** Opens a request and reads its answer line by line as it arrives. */
export function openStream(port: number, a: Ask): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(a.headers ?? {}) };
    const bytes = a.body === undefined ? undefined : Buffer.from(a.body);
    if (bytes !== undefined) headers['content-length'] = String(bytes.length);
    const req = httpRequest({ host: '127.0.0.1', port, method: a.method ?? (bytes === undefined ? 'GET' : 'POST'), path: a.path, headers, agent: false }, (res) => {
      const lines: string[] = [];
      const box = { rest: '', finished: false, wake: undefined as (() => void) | undefined };
      const wake = (): void => {
        const w = box.wake;
        box.wake = undefined;
        w?.();
      };
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        box.rest += chunk;
        let i = box.rest.indexOf('\n');
        while (i >= 0) {
          lines.push(box.rest.slice(0, i));
          box.rest = box.rest.slice(i + 1);
          i = box.rest.indexOf('\n');
        }
        wake();
      });
      const finish = (): void => {
        box.finished = true;
        wake();
      };
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        async next(ms = 1500) {
          const deadline = Date.now() + ms;
          while (lines.length === 0 && !box.finished) {
            const left = deadline - Date.now();
            if (left <= 0) return undefined;
            await new Promise<void>((r) => {
              box.wake = r;
              setTimeout(r, left);
            });
          }
          return lines.shift();
        },
        ended: () => box.finished && lines.length === 0,
        destroy: () => req.destroy(),
      });
    });
    req.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      reject(e);
    });
    req.end(bytes);
  });
}

/** A promise with its resolver, for gates the test opens by hand. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  const box = { resolve: (_v: T): void => undefined };
  const promise = new Promise<T>((r) => {
    box.resolve = r;
  });
  return { promise, resolve: (v) => box.resolve(v) };
}

/**
 * Adds routes to the server's route table for the life of a test file and returns the function that takes them out.
 * Round 1 has no model endpoint, so limits, streams and aborts are tested through routes that behave as a model route
 * does (take a slot, stream events, end). They go through the real server: origin, body and job checks included.
 */
export function addRoutes(routes: readonly Route[]): () => void {
  const table = ROUTES as Route[];
  const before = table.length;
  table.push(...routes);
  return () => {
    table.splice(before, routes.length);
  };
}

/** Sleeps `ms` real milliseconds. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Waits until `check` is true, up to `ms`. */
export async function until(check: () => boolean, ms = 1500): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await sleep(10);
  }
  return true;
}

/** The clock a test moves by hand, starting at 2026-11-22 12:00 UTC. */
export function makeClock(start = Date.UTC(2026, 10, 22, 12, 0, 0)): { now: () => number; advance: (ms: number) => void; set: (t: number) => void } {
  const box = { t: start };
  return {
    now: () => box.t,
    advance: (ms) => {
      box.t += ms;
    },
    set: (t) => {
      box.t = t;
    },
  };
}

/** A key-shaped value no test may ever see in a log, an error or a response. */
export const SECRET_KEY = 'sk-or-v1-TESTONLY0123456789abcdefSECRETKEYVALUE';
