/**
 * `createServer` (docs/features/server/design.md 2): the HTTP server on `node:http` and its route table. Each request is
 * one `Job`: the origin, the route, the size and the JSON are checked, then the route's handler answers. Nothing throws
 * out of a handler: a fault becomes `internal` with a fingerprint in the log.
 */
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModelClient } from '@incantly/teacher';
import { badRequest, notFound, serverError } from '../errors';
import type { ServerError } from '../errors';
import type { Settings } from '../env';
import { check } from '../jobs/check';
import type { Context, Route } from '../jobs/context';
import { health } from '../jobs/health';
import { Job } from '../jobs/job';
import { RateLimiter } from '../limits/rate';
import { silentLog } from '../log';
import type { LogFn } from '../log';
import { BODY_LIMIT, parseJsonObject, readBody } from './body';
import { checkOrigin, corsHeaders, preflightHeaders } from './cors';
import { onClientClose } from './ndjson';

/** The route table. A later round adds the model endpoints here. */
export const ROUTES: readonly Route[] = [
  { method: 'GET', path: '/v1/health', bodyLimit: 0, handle: health },
  { method: 'POST', path: '/v1/check', bodyLimit: BODY_LIMIT, handle: check },
];

const routeNames = (routes: readonly Route[]): string[] => routes.map((r) => `${r.method} ${r.path}`);

export interface ServerOptions {
  readonly settings: Settings;
  /** The model client. Without one, model endpoints answer `model_unavailable`. */
  readonly client?: ModelClient;
  readonly log?: LogFn;
  /** The clock in milliseconds (limits, log stamps). Default: `Date.now`. */
  readonly now?: () => number;
}

export interface Listening {
  readonly ok: true;
  readonly host: string;
  readonly port: number;
}

export interface Server {
  readonly limiter: RateLimiter;
  /** `METHOD path` of every route. */
  readonly routes: readonly string[];
  /** Starts listening. A failure to listen (the port is taken) is `config_invalid`, not a throw. */
  listen(port?: number, host?: string): Promise<Listening | ServerError>;
  /** Stops listening and ends open connections. */
  close(): Promise<void>;
}

const headerOf = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** The client's address for the rate limits; `x-forwarded-for` only when the server is told to trust a proxy. */
function clientOf(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = headerOf(req, 'x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded !== undefined && forwarded !== '') return forwarded;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function createServer(options: ServerOptions): Server {
  const { settings } = options;
  const log = options.log ?? silentLog;
  const now = options.now ?? Date.now;
  const limiter = new RateLimiter({ ratePerMinute: settings.ratePerMinute, dailyModelCalls: settings.dailyModelCalls }, now);
  let nextId = 0;

  const dispatch = async (req: IncomingMessage, job: Job, id: number): Promise<void> => {
    const origin = headerOf(req, 'origin');
    const blocked = checkOrigin(origin, settings.allowedOrigins);
    if (blocked) {
      job.refuse(blocked);
      return;
    }
    const method = req.method ?? 'GET';
    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      job.refuse(badRequest('The address is not valid.'));
      return;
    }
    if (method === 'OPTIONS') {
      if (job.checked()) job.empty(204, origin !== undefined ? preflightHeaders(origin) : {});
      return;
    }
    const route = ROUTES.find((r) => r.method === method && r.path === path);
    if (route === undefined) {
      job.refuse(notFound(routeNames(ROUTES)));
      return;
    }
    let body: Record<string, unknown> = {};
    if (route.method === 'POST') {
      const read = await readBody(req, route.bodyLimit);
      if (!read.ok) {
        job.refuse(read);
        // a body refused before it ended is left unread: the answer is written, then the connection closes
        if (read.kind === 'payload_too_large' && !req.readableEnded) req.socket.destroySoon();
        return;
      }
      const parsed = parseJsonObject(read.bytes);
      if (!parsed.ok) {
        job.refuse(parsed);
        return;
      }
      body = parsed.value;
    }
    const ctx: Context = { job, settings, client: options.client, limiter, log, clientId: clientOf(req, settings.trustProxy), body, now };
    log('request', { id, method, path });
    await route.handle(ctx);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    nextId += 1;
    const id = nextId;
    const job = new Job({ res, log, id, headers: corsHeaders(headerOf(req, 'origin'), settings.allowedOrigins) });
    onClientClose(res, () => job.close());
    try {
      await dispatch(req, job, id);
    } catch (e) {
      job.crash(e);
    } finally {
      job.ensureEnded();
    }
  };

  const http = createHttpServer((req, res) => {
    void handle(req, res);
  });
  http.requestTimeout = 30_000;
  http.headersTimeout = 15_000;

  return {
    limiter,
    routes: routeNames(ROUTES),
    listen(port = settings.port, host = settings.host) {
      return new Promise((resolve) => {
        const onError = (e: Error): void => {
          resolve(serverError('config_invalid', `PORT: the server could not listen on ${host}:${port} (${(e as NodeJS.ErrnoException).code ?? 'error'}).`, { hint: 'Another program may use the port; change PORT in packages/server/.env.', detail: { setting: 'PORT' } }));
        };
        http.once('error', onError);
        http.listen(port, host, () => {
          http.off('error', onError);
          const address = http.address();
          resolve({ ok: true, host, port: typeof address === 'object' && address !== null ? address.port : port });
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
