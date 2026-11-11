/**
 * Shared helpers for the view spec tests. Imports only the package entry
 * `@incantly/view` (plus vitest). Fixture shapes follow the docs
 * (docs/features/graphics-view/*) and the emitted public type declarations.
 */
import {
  createViewport,
  resolveStyle,
} from '@incantly/view';
import type {
  AuthoredStyle,
  DragApplier,
  Drawable,
  FigureView,
  HitCandidate,
  KernelView,
  PaintKind,
  ResolvedStyle,
  StyleEvaluator,
  StyleStore,
  ViewObjectHead,
  Viewport,
  ViewportOptions,
} from '@incantly/view';

/** Object id without importing the kernel: `HitCandidate['id']` is `ObjId`. */
export type Oid = HitCandidate['id'];
export const oid = (n: number): Oid => n as Oid;

/** Structural success/error helpers so tests never import kernel error types. */
interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}
interface Err {
  readonly ok: false;
  readonly kind: string;
  readonly code: string;
  readonly message: string;
  readonly messageKey: string;
  readonly hint?: string;
  readonly recovery: string;
}
type AnyResult<T> = Ok<T> | Err;

export function okValue<T>(r: AnyResult<T>, what: string): T {
  if (!r.ok) throw new Error(`expected ok for ${what}, got ${r.kind} ${r.code}: ${r.message}`);
  return r.value;
}

export function errOf<T>(r: AnyResult<T>, what: string): Err {
  if (r.ok) throw new Error(`expected an error for ${what}, got success`);
  return r;
}

export function closeTo(actual: number, expected: number, digits = 9): void {
  const d = Math.abs(actual - expected);
  const tol = Math.pow(10, -digits) * Math.max(1, Math.abs(expected));
  if (!(d <= tol)) throw new Error(`expected ${String(actual)} close to ${String(expected)} (diff ${String(d)})`);
}

/** Default 800x600 canvas, 50 px/unit, centred on the origin. */
export function testViewport(over: Partial<ViewportOptions> = {}): Viewport {
  return okValue(
    createViewport({ widthPx: 800, heightPx: 600, centreX: 0, centreY: 0, scaleX: 50, scaleY: 50, ...over }),
    'testViewport',
  );
}

/** A resolved style for tests that need concrete values (docs 9.1 defaults). */
export function testStyle(kind: PaintKind = 'point', authored: AuthoredStyle = {}, free = true): ResolvedStyle {
  const evalRef: StyleEvaluator = () => undefined;
  return okValue(resolveStyle(kind, free, authored, evalRef), `testStyle(${kind})`);
}

/** Minimal object head for stub kernels. */
export function head(id: number, name: string, extra: Partial<ViewObjectHead> = {}): ViewObjectHead {
  return {
    id: oid(id), name, type: 'Point', order: id, version: 1, styleVersion: 1, free: true, onPath: false, ...extra,
  };
}

/** A stub kernel holding a fixed map of id -> value/kind. */
export interface StubObject {
  readonly head: ViewObjectHead;
  readonly value: unknown;
  readonly kind: PaintKind;
  readonly style?: AuthoredStyle;
}

export function stubKernel(objects: readonly StubObject[]): KernelView {
  const byId = new Map<number, StubObject>(objects.map((o) => [o.head.id as number, o]));
  return {
    heads: () => objects.map((o) => o.head),
    head: (id) => byId.get(id as number)?.head,
    valueOf: (id) => {
      const o = byId.get(id as number);
      if (o === undefined) return { defined: false, undef: { reason: 'not_set' } };
      return { defined: true, value: o.value } as unknown as ReturnType<KernelView['valueOf']>;
    },
    freeParentsOf: () => [],
    particlesOf: () => undefined,
    pathOf: () => undefined,
  };
}

export function stubStyles(objects: readonly StubObject[], evalRef: StyleEvaluator = () => undefined): StyleStore {
  const byId = new Map<number, StubObject>(objects.map((o) => [o.head.id as number, o]));
  return {
    authoredOf: (id) => {
      const o = byId.get(id as number);
      if (o === undefined) return undefined;
      return { kind: o.kind, free: o.head.free, style: o.style ?? {} };
    },
    evaluator: evalRef,
  };
}

export interface DragLog {
  readonly calls: unknown[][];
  readonly applier: DragApplier;
}

export function dragLog(): DragLog {
  const calls: unknown[][] = [];
  return {
    calls,
    applier: {
      drag: (moves) => {
        calls.push([...moves]);
      },
      commitDrag: () => {
        calls.push(['commit']);
      },
      cancelDrag: () => {
        calls.push(['cancel']);
      },
    },
  };
}

/** Mount a figure with a captured frame queue; tests pump frames by hand. */
export interface Mounted {
  readonly view: FigureView;
  readonly el: HTMLDivElement;
  readonly queue: Array<() => void>;
  readonly pump: (n: number) => number;
  readonly canvas: HTMLCanvasElement;
}

export function pumpQueue(queue: Array<() => void>, n: number): number {
  let c = 0;
  while (queue.length > 0 && c < n) {
    const cb = queue.shift();
    if (cb === undefined) break;
    cb();
    c += 1;
  }
  return c;
}

export function overlayCanvas(el: HTMLElement): HTMLCanvasElement {
  const all = el.querySelectorAll('canvas');
  const last = all[all.length - 1];
  if (last === undefined || last === null) throw new Error('no canvas mounted');
  return last as HTMLCanvasElement;
}

/** A stub drawable for draw-list tests (docs 6): records update/paint calls. */
export function stubDrawable(opts: {
  id: number;
  kind: PaintKind;
  rank: number;
  layer?: number;
  order?: number;
  bbox?: { x0: number; x1: number; y0: number; y1: number } | null;
}): Drawable & { calls: string[] } {
  const calls: string[] = [];
  const layer = opts.layer ?? 0;
  const order = opts.order ?? opts.id;
  return {
    calls,
    id: oid(opts.id),
    kind: opts.kind,
    rank: opts.rank,
    bbox: opts.bbox === undefined
      ? { x0: 0 as never, x1: 10 as never, y0: 0 as never, y1: 10 as never }
      : opts.bbox === null
        ? null
        : { x0: opts.bbox.x0 as never, x1: opts.bbox.x1 as never, y0: opts.bbox.y0 as never, y1: opts.bbox.y1 as never },
    sortKey: { layer, rank: opts.rank, order },
    update: () => {
      calls.push('update');
      return true;
    },
    paint: () => {
      calls.push('paint');
    },
    paintLabel: () => {
      calls.push('label');
    },
    hit: () => null,
    outline: () => {
      calls.push('outline');
    },
    describe: () => `stub ${String(opts.id)}`,
  };
}

/** A recording 2D context: every method call and property set is logged. */
export function recordingContext(): { ctx: never; calls: string[] } {
  const calls: string[] = [];
  const ctx = new Proxy({ canvas: null }, {
    get: (t, p) => {
      if (p in t) return (t as Record<string | symbol, unknown>)[p];
      if (typeof p === 'string') {
        return (..._a: unknown[]) => {
          calls.push(p);
          return undefined;
        };
      }
      return undefined;
    },
    set: (t, p, v) => {
      calls.push(`set:${String(p)}=${String(v)}`);
      return Reflect.set(t, p, v);
    },
  });
  return { ctx: ctx as never, calls };
}

/** A fake WebGL2 context: named constants read 1, creators return handles. */
export function fakeGl(over: { lost?: boolean } = {}): never {
  let n = 0;
  return new Proxy({}, {
    get: (_t, p) => {
      if (typeof p !== 'string') return undefined;
      if (p === 'canvas') return null;
      if (p === 'isContextLost') return () => over.lost === true;
      if (p === 'getError') return () => 0;
      if (p === 'getParameter') return () => 4096;
      if (p === 'getExtension') return () => ({});
      if (p === 'getShaderParameter') return () => true;
      if (p === 'getProgramParameter') return () => true;
      if (p === 'getShaderInfoLog') return () => '';
      if (p === 'getProgramInfoLog') return () => '';
      if (p === 'getUniformLocation') return () => ({});
      if (p === 'getAttribLocation') return () => 0;
      if (/^(create|gen)/.test(p)) {
        return () => {
          n += 1;
          return { __id: n };
        };
      }
      if (/^[A-Z0-9_]+$/.test(p)) return 1;
      return () => undefined;
    },
  }) as never;
}
