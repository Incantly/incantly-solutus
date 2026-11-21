/**
 * Embedding across frames (embed-files-export design 3.7; errors 2; .kiro/specs/sdk R3). The frame serves its app with
 * `serveApp`; the page talks to it with `connectApp`. One envelope type over `postMessage`, a closed set of methods,
 * origins checked both ways, no `eval`, plain data only.
 */
import type { App } from './app';
import type { ApiError } from './errors';
import { apiError } from './errors';
import type { AppEvent, EventOf, EventType, ListenOpts, Unsubscribe } from './events';

export const PROTOCOL_VERSION = 1;
export const FRAME_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, callsPerSecond: 200, timeoutMs: 10_000, originNoticeMs: 60_000 });

export type Envelope =
  | { readonly v: number; readonly id: number; readonly method: string; readonly params: readonly unknown[] }
  | { readonly v: number; readonly id: number; readonly result: unknown }
  | { readonly v: number; readonly id: number; readonly error: ApiError }
  | { readonly v: number; readonly event: string; readonly data: unknown; readonly sub: number };

/** What sends messages: a window, a frame's `contentWindow`, a port. */
export interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

/** What receives them: a window (or a test double). */
export interface MessageHost {
  addEventListener(type: 'message', fn: (e: MessageLike) => void): void;
  removeEventListener(type: 'message', fn: (e: MessageLike) => void): void;
}

export interface MessageLike {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

/** The methods a frame answers: nothing outside this set runs. */
const METHODS: Readonly<Record<string, (app: App, p: readonly unknown[]) => unknown>> = {
  run: (a, p) => a.run(p[0] as string),
  runBatch: (a, p) => a.runBatch(p[0] as string[]),
  list: (a, p) => [...a.list((p[0] ?? {}) as object)],
  get: (a, p) => a.get(p[0] as string),
  exists: (a, p) => a.exists(p[0] as string),
  value: (a, p) => a.value(p[0] as string),
  definition: (a, p) => a.definition(p[0] as string),
  undefinedObjects: (a) => a.undefinedObjects(),
  figureSummary: (a) => a.figureSummary(),
  set: (a, p) => a.set(p[0] as string, p[1] as number),
  setStyle: (a, p) => a.setStyle(p[0] as string, p[1] as Record<string, string>),
  show: (a, p) => a.show(...(p as string[])),
  hide: (a, p) => a.hide(...(p as string[])),
  remove: (a, p) => a.remove(p[0] as string),
  rename: (a, p) => a.rename(p[0] as string, p[1] as string),
  clear: (a) => a.clear(),
  undo: (a) => a.undo(),
  redo: (a) => a.redo(),
  markUndoPoint: (a, p) => a.markUndoPoint(p[0] as string | undefined),
  saved: (a) => a.saved,
  markSaved: (a) => a.markSaved(),
  toScript: (a) => a.toScript(),
  save: (a) => a.save(),
  saveText: (a) => a.saveText(),
  load: (a, p) => a.load(p[0] as string),
  toFragment: (a) => a.toFragment(),
  loadFragment: (a, p) => a.loadFragment(p[0] as string),
  setMode: (a, p) => a.setMode(p[0] as never, (p[1] ?? {}) as object),
  resize: (a, p) => a.resize(p[0] as number, p[1] as number),
  'view.get': (a) => a.view.get(),
  'view.set': (a, p) => a.view.set(p[0] as number, p[1] as number, p[2] as number, p[3] as number),
  'view.setAxes': (a, p) => a.view.setAxes(p[0] as boolean),
  'view.setGrid': (a, p) => a.view.setGrid(p[0] as boolean),
  'view.keepRatio': (a, p) => a.view.keepRatio(p[0] as boolean),
  'view.fit': (a) => a.view.fit(),
  'clock.t': (a) => a.clock.t,
  'clock.playing': (a) => a.clock.playing,
  'clock.play': (a) => a.clock.play(),
  'clock.pause': (a) => a.clock.pause(),
  'clock.seek': (a, p) => a.clock.seek(p[0] as number),
  'clock.setSpeed': (a, p) => a.clock.setSpeed(p[0] as number),
  'clock.setRange': (a, p) => a.clock.setRange(p[0] as number, p[1] as number),
};

export const FRAME_METHODS: readonly string[] = [...Object.keys(METHODS), 'subscribe', 'unsubscribe'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Bytes of a message as JSON text (a cheap upper bound of what crosses the frame). */
function sizeOf(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/** Plain data only: what `postMessage` copies without surprises (functions and class instances dropped). */
function plain(v: unknown): unknown {
  return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as unknown);
}

export interface ServeOptions {
  /** Origins the frame answers; default only its own. `*` allows any (for local tests only). */
  readonly allowOrigins?: readonly string[];
  /** The frame's own origin (default `location.origin`). */
  readonly selfOrigin?: string;
  /** Where messages arrive (default `window`). */
  readonly host?: MessageHost;
  /** A clock in ms for the rate limit (default `performance.now`). */
  readonly now?: () => number;
}

export interface Served {
  /** Stops answering and drops every subscription. */
  close(): void;
}

/** The frame side: answers the page's calls on `app` and forwards the events it subscribed to. */
export function serveApp(app: App, opts: ServeOptions = {}): Served {
  const host = opts.host ?? (globalThis as unknown as MessageHost);
  const self = opts.selfOrigin ?? (globalThis as { location?: { origin?: string } }).location?.origin ?? '';
  const allow = new Set(opts.allowOrigins ?? [self]);
  const now = opts.now ?? (() => performance.now());
  const calls = new Map<string, number[]>();
  const noticed = new Map<string, number>();
  const subs = new Map<number, Unsubscribe>();
  let nextSub = 1;

  const reply = (e: MessageLike, msg: Envelope): void => {
    const src = e.source as MessageTarget | null;
    if (src && typeof src.postMessage === 'function') src.postMessage(msg, e.origin);
  };
  const fail = (e: MessageLike, id: number, kind: string, message: string, detail?: Record<string, unknown>): void =>
    reply(e, { v: PROTOCOL_VERSION, id, error: apiError('frame', kind, message, detail ? { detail } : {}) });

  const onMessage = (e: MessageLike): void => {
    if (!allow.has('*') && !allow.has(e.origin)) {
      // dropped; the app hears of each origin once a minute
      const last = noticed.get(e.origin);
      if (last === undefined || now() - last > FRAME_LIMITS.originNoticeMs) {
        noticed.set(e.origin, now());
        app.reportError(apiError('frame', 'origin_blocked', `A message from ${e.origin} was dropped.`, { detail: { origin: e.origin } }));
      }
      return;
    }
    const m = e.data;
    if (!isObj(m) || typeof m['id'] !== 'number' || typeof m['method'] !== 'string') return;
    const id = m['id'] as number;
    if (m['v'] !== PROTOCOL_VERSION) return fail(e, id, 'protocol_version', `This frame speaks protocol ${PROTOCOL_VERSION}.`, { supported: [PROTOCOL_VERSION] });
    if (sizeOf(m) > FRAME_LIMITS.bytes) return fail(e, id, 'payload_too_large', 'The message is over 2 MB.', { max: FRAME_LIMITS.bytes });
    const t = now();
    const recent = (calls.get(e.origin) ?? []).filter((x) => t - x < 1000);
    if (recent.length >= FRAME_LIMITS.callsPerSecond) {
      calls.set(e.origin, recent);
      return fail(e, id, 'rate_limited', 'More than 200 calls in one second.', { retryAfterMs: Math.ceil(1000 - (t - (recent[0] as number))) });
    }
    recent.push(t);
    calls.set(e.origin, recent);
    const method = m['method'] as string;
    const params = Array.isArray(m['params']) ? (m['params'] as unknown[]) : [];
    if (method === 'subscribe') {
      const sub = nextSub++;
      const type = params[0] as EventType;
      const lo = (isObj(params[1]) ? params[1] : {}) as ListenOpts;
      const off = app.on(type, (ev: AppEvent) => reply(e, { v: PROTOCOL_VERSION, event: type, data: plain(ev), sub }), lo);
      subs.set(sub, off);
      return reply(e, { v: PROTOCOL_VERSION, id, result: sub });
    }
    if (method === 'unsubscribe') {
      subs.get(params[0] as number)?.();
      subs.delete(params[0] as number);
      return reply(e, { v: PROTOCOL_VERSION, id, result: null });
    }
    const fn = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined;
    if (!fn) return fail(e, id, 'unknown_method', `${method} is not a method of the embed API.`, { method });
    let out: unknown;
    try {
      out = fn(app, params);
    } catch (x) {
      return fail(e, id, 'bad_argument', x instanceof Error ? x.message : String(x));
    }
    void Promise.resolve(out).then(
      (result) => reply(e, { v: PROTOCOL_VERSION, id, result: plain(result) }),
      (x: unknown) => fail(e, id, 'bad_argument', x instanceof Error ? x.message : String(x)),
    );
  };

  host.addEventListener('message', onMessage);
  return {
    close(): void {
      host.removeEventListener('message', onMessage);
      for (const off of subs.values()) off();
      subs.clear();
    },
  };
}

/* ------------------------------ the page side ------------------------------ */

export interface ConnectOptions {
  /** The frame's origin: messages from anywhere else are ignored. */
  readonly origin: string;
  readonly timeoutMs?: number;
  /** Where the answers arrive (default `window`). */
  readonly host?: MessageHost;
  /** The frame element, to notice when it is removed (`frame_gone`). */
  readonly element?: { readonly isConnected: boolean };
}

type Async<T> = T extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;

/** The app across a frame: the same methods, each a promise. */
export interface AsyncApp {
  call(method: string, ...params: unknown[]): Promise<unknown>;
  readonly run: Async<App['run']>;
  readonly runBatch: Async<App['runBatch']>;
  readonly list: Async<App['list']>;
  readonly get: Async<App['get']>;
  readonly exists: Async<App['exists']>;
  readonly value: Async<App['value']>;
  readonly definition: Async<App['definition']>;
  readonly set: Async<App['set']>;
  readonly setStyle: Async<App['setStyle']>;
  readonly remove: Async<App['remove']>;
  readonly rename: Async<App['rename']>;
  readonly undo: Async<App['undo']>;
  readonly redo: Async<App['redo']>;
  readonly toScript: Async<App['toScript']>;
  readonly save: Async<App['save']>;
  readonly load: Async<App['load']>;
  readonly setMode: Async<App['setMode']>;
  readonly view: { readonly get: Async<App['view']['get']>; readonly set: Async<App['view']['set']>; readonly fit: Async<App['view']['fit']> };
  readonly clock: { readonly play: () => Promise<void>; readonly pause: () => Promise<void>; readonly seek: (t: number) => Promise<void>; readonly t: () => Promise<number> };
  on<E extends EventType>(type: E, handler: (e: EventOf<E>) => void, opts?: ListenOpts): Promise<Unsubscribe>;
  /** Rejects every waiting call with `frame_gone` and stops listening. */
  close(): void;
}

/** The page side: talks to the app served in `frame` (an iframe element or its window). */
export function connectApp(frame: MessageTarget | { readonly contentWindow: MessageTarget | null; readonly isConnected?: boolean }, opts: ConnectOptions): AsyncApp {
  if (typeof opts !== 'object' || opts === null || typeof opts.origin !== 'string' || opts.origin === '' || opts.origin === '*') throw new TypeError('connectApp: it needs the exact origin of the frame');
  const target: MessageTarget | null = 'postMessage' in frame ? frame : frame.contentWindow;
  const element = opts.element ?? ('contentWindow' in frame ? (frame as { isConnected?: boolean }) : undefined);
  const host = opts.host ?? (globalThis as unknown as MessageHost);
  const timeoutMs = opts.timeoutMs ?? FRAME_LIMITS.timeoutMs;
  let nextId = 1;
  let closed = false;
  const waiting = new Map<number, { resolve(v: unknown): void; reject(e: ApiError): void; timer: ReturnType<typeof setTimeout> }>();
  const handlers = new Map<number, (e: AppEvent) => void>();

  const gone = (): ApiError => apiError('frame', 'frame_gone', 'The frame is gone.', { hint: 'Connect again to a new frame.' });

  const onMessage = (e: MessageLike): void => {
    if (e.source !== target || e.origin !== opts.origin) return;
    const m = e.data;
    if (!isObj(m) || m['v'] !== PROTOCOL_VERSION) return;
    if (typeof m['sub'] === 'number' && typeof m['event'] === 'string') {
      handlers.get(m['sub'] as number)?.(m['data'] as AppEvent);
      return;
    }
    const w = typeof m['id'] === 'number' ? waiting.get(m['id'] as number) : undefined;
    if (!w) return; // a late answer, after its timeout: ignored
    waiting.delete(m['id'] as number);
    clearTimeout(w.timer);
    if ('error' in m) w.reject(m['error'] as ApiError);
    else w.resolve(m['result']);
  };
  host.addEventListener('message', onMessage);

  const call = (method: string, ...params: unknown[]): Promise<unknown> => {
    if (closed || !target || (element && element.isConnected === false)) return Promise.reject(gone());
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(apiError('frame', 'timeout', `No answer to ${method} within ${timeoutMs} ms.`, { detail: { method, timeoutMs } }));
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      target.postMessage({ v: PROTOCOL_VERSION, id, method, params: plain(params) }, opts.origin);
    });
  };

  const m = <T>(name: string) => ((...p: unknown[]) => call(name, ...p)) as unknown as T;
  return {
    call,
    run: m('run'),
    runBatch: m('runBatch'),
    list: m('list'),
    get: m('get'),
    exists: m('exists'),
    value: m('value'),
    definition: m('definition'),
    set: m('set'),
    setStyle: m('setStyle'),
    remove: m('remove'),
    rename: m('rename'),
    undo: m('undo'),
    redo: m('redo'),
    toScript: m('toScript'),
    save: m('save'),
    load: m('load'),
    setMode: m('setMode'),
    view: { get: m('view.get'), set: m('view.set'), fit: m('view.fit') },
    clock: { play: m('clock.play'), pause: m('clock.pause'), seek: m('clock.seek'), t: m('clock.t') },
    async on<E extends EventType>(type: E, handler: (e: EventOf<E>) => void, lo: ListenOpts = {}): Promise<Unsubscribe> {
      const sub = (await call('subscribe', type, lo)) as number;
      handlers.set(sub, handler as (e: AppEvent) => void);
      return () => {
        handlers.delete(sub);
        void call('unsubscribe', sub).catch(() => undefined);
      };
    },
    close(): void {
      closed = true;
      host.removeEventListener('message', onMessage);
      for (const w of waiting.values()) {
        clearTimeout(w.timer);
        w.reject(gone());
      }
      waiting.clear();
      handlers.clear();
    },
  };
}
