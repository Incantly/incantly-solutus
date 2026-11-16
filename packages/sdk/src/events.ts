/**
 * The event hub (design 3.6): typed events with their source, delivered after the update pass on a microtask, never
 * inside it. `changed`, `drag`, `viewChanged` and `clockChanged` are coalesced to one per frame unless a listener asks
 * otherwise. A handler that throws is reported as an `error` event to the others; it never breaks the app.
 */
import type { ApiError } from './errors';
import { apiError } from './errors';
import type { Value } from './values';

export type EventSource = 'user' | 'script' | 'api' | 'clock' | 'file';

interface Base {
  readonly source: EventSource;
  /** Clock time at the event. */
  readonly t: number;
}

export interface ChangedObject {
  readonly name: string;
  readonly type: string;
  readonly value: Value;
  readonly defined: boolean;
}

export type AppEvent =
  | (Base & { readonly type: 'ready' })
  | (Base & { readonly type: 'loaded'; readonly applied: number; readonly failed: number })
  | (Base & { readonly type: 'modeChanged'; readonly mode: string; readonly from: string })
  | (Base & { readonly type: 'added'; readonly name: string; readonly objectType: string })
  | (Base & { readonly type: 'removed'; readonly name: string })
  | (Base & { readonly type: 'changed'; readonly objects: readonly ChangedObject[] })
  | (Base & { readonly type: 'restyled'; readonly names: readonly string[] })
  | (Base & { readonly type: 'renamed'; readonly from: string; readonly to: string })
  | (Base & { readonly type: 'redefined'; readonly name: string; readonly definition: string })
  | (Base & { readonly type: 'cleared' })
  | (Base & { readonly type: 'dragStart' | 'dragEnd'; readonly name: string })
  | (Base & { readonly type: 'drag'; readonly name: string; readonly value: Value })
  | (Base & { readonly type: 'selected' | 'deselected'; readonly names: readonly string[] })
  | (Base & { readonly type: 'clicked'; readonly name: string })
  | (Base & { readonly type: 'viewChanged'; readonly view: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number } })
  | (Base & { readonly type: 'clockChanged' })
  | (Base & { readonly type: 'play' | 'pause' })
  | (Base & { readonly type: 'undoPoint'; readonly label: string })
  | (Base & { readonly type: 'undone' | 'redone'; readonly label: string })
  | (Base & { readonly type: 'error'; readonly error: ApiError | { readonly ok: false; readonly kind: string; readonly message: string } });

export type EventType = AppEvent['type'];
export type EventOf<E extends EventType> = Extract<AppEvent, { type: E }>;
export type Unsubscribe = () => void;

export interface ListenOpts {
  /** Only events about these names. */
  readonly object?: string | readonly string[];
  /** Only objects of these types (`changed`, `added`). */
  readonly types?: readonly string[];
  readonly source?: EventSource | readonly EventSource[];
  /** `frame` (default for changed, drag, viewChanged, clockChanged), `none`, or a minimum gap in ms (read as `frame`). */
  readonly coalesce?: 'frame' | 'none' | number;
}

/** How the hub waits: a microtask after the update pass, and the next frame for coalesced events. */
export interface Scheduler {
  micro(fn: () => void): void;
  frame(fn: () => void): void;
}

export const defaultScheduler: Scheduler = {
  micro: (fn) => queueMicrotask(fn),
  frame: (fn) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => unknown }).requestAnimationFrame;
    if (typeof raf === 'function') raf(fn);
    else setTimeout(fn, 16);
  },
};

const COALESCED: ReadonlySet<EventType> = new Set(['changed', 'drag', 'viewChanged', 'clockChanged']);

interface Listener {
  readonly type: EventType;
  readonly handler: (e: AppEvent) => void;
  readonly names?: ReadonlySet<string>;
  readonly types?: ReadonlySet<string>;
  readonly sources?: ReadonlySet<EventSource>;
  readonly coalesce: boolean;
  /** Waiting for the next frame: one per type and name. */
  buffer?: AppEvent[];
}

const asSet = <T>(x: T | readonly T[] | undefined): ReadonlySet<T> | undefined => (x === undefined ? undefined : new Set(Array.isArray(x) ? (x as readonly T[]) : [x as T]));

/** The names an event is about, for the `object` filter. */
function namesOf(e: AppEvent): readonly string[] | undefined {
  switch (e.type) {
    case 'added':
    case 'removed':
    case 'redefined':
    case 'drag':
    case 'dragStart':
    case 'dragEnd':
    case 'clicked':
      return [e.name];
    case 'renamed':
      return [e.from, e.to];
    case 'restyled':
    case 'selected':
    case 'deselected':
      return e.names;
    case 'changed':
      return e.objects.map((o) => o.name);
    default:
      return undefined;
  }
}

/** The event narrowed to what the listener asked for, or `undefined` when nothing of it is left. */
function fit(l: Listener, e: AppEvent): AppEvent | undefined {
  if (l.sources && !l.sources.has(e.source)) return undefined;
  if (e.type === 'changed' && (l.names || l.types)) {
    const objects = e.objects.filter((o) => (!l.names || l.names.has(o.name)) && (!l.types || l.types.has(o.type)));
    return objects.length === 0 ? undefined : { ...e, objects };
  }
  if (l.types && e.type === 'added' && !l.types.has(e.objectType)) return undefined;
  if (l.names) {
    const ns = namesOf(e);
    if (ns && !ns.some((n) => l.names?.has(n))) return undefined;
  }
  return e;
}

/** Two events of a frame as one: `changed` keeps every object (the last value of each), the others keep the last. */
function mergeInto(buffer: AppEvent[], e: AppEvent): void {
  if (e.type === 'changed') {
    const prev = buffer.find((x) => x.type === 'changed') as EventOf<'changed'> | undefined;
    if (!prev) {
      buffer.push(e);
      return;
    }
    const byName = new Map(prev.objects.map((o) => [o.name, o]));
    for (const o of e.objects) byName.set(o.name, o);
    buffer[buffer.indexOf(prev)] = { ...e, objects: [...byName.values()] };
    return;
  }
  const key = e.type === 'drag' ? `drag:${e.name}` : e.type;
  const at = buffer.findIndex((x) => (x.type === 'drag' ? `drag:${x.name}` : x.type) === key);
  if (at >= 0) buffer[at] = e;
  else buffer.push(e);
}

export class EventHub {
  private readonly listeners: Listener[] = [];
  private pending: AppEvent[] = [];
  private microQueued = false;
  private frameQueued = false;
  private closed = false;

  constructor(private readonly sched: Scheduler = defaultScheduler) {}

  on<E extends EventType>(type: E, handler: (e: EventOf<E>) => void, opts: ListenOpts = {}): Unsubscribe {
    const names = asSet(opts.object);
    const types = asSet(opts.types);
    const sources = asSet(opts.source);
    const l: Listener = {
      type,
      handler: handler as (e: AppEvent) => void,
      ...(names ? { names } : {}),
      ...(types ? { types } : {}),
      ...(sources ? { sources } : {}),
      coalesce: COALESCED.has(type) && opts.coalesce !== 'none',
    };
    this.listeners.push(l);
    return () => {
      const i = this.listeners.indexOf(l);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  once<E extends EventType>(type: E, handler: (e: EventOf<E>) => void): Unsubscribe {
    const off = this.on(type, (e) => {
      off();
      handler(e);
    });
    return off;
  }

  /** True when someone listens to this type (the app skips building events nobody reads). */
  wants(type: EventType): boolean {
    return this.listeners.some((l) => l.type === type);
  }

  emit(e: AppEvent): void {
    if (this.closed) return;
    this.pending.push(e);
    if (this.microQueued) return;
    this.microQueued = true;
    this.sched.micro(() => this.flush());
  }

  /** Delivers what waits now (tests and `destroy` call it; the hub calls it on its microtask). */
  flush(): void {
    this.microQueued = false;
    const events = this.pending;
    this.pending = [];
    for (const e of events) {
      for (const l of [...this.listeners]) {
        if (l.type !== e.type) continue;
        const ev = fit(l, e);
        if (!ev) continue;
        if (l.coalesce) {
          mergeInto((l.buffer ??= []), ev);
          this.queueFrame();
        } else this.deliver(l, ev);
      }
    }
  }

  private queueFrame(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    this.sched.frame(() => this.flushFrame());
  }

  /** Delivers the coalesced events of the frame. */
  flushFrame(): void {
    this.frameQueued = false;
    for (const l of [...this.listeners]) {
      const b = l.buffer;
      if (!b || b.length === 0) continue;
      l.buffer = [];
      for (const e of b) this.deliver(l, e);
    }
  }

  private deliver(l: Listener, e: AppEvent): void {
    try {
      l.handler(e);
    } catch (x) {
      if (e.type === 'error') return;
      this.emit({ type: 'error', source: e.source, t: e.t, error: apiError('api', 'listener_failed', `A ${e.type} handler threw: ${x instanceof Error ? x.message : String(x)}.`, { hint: 'The app goes on; fix the handler.' }) });
    }
  }

  close(): void {
    this.closed = true;
    this.pending = [];
    this.listeners.length = 0;
  }
}
