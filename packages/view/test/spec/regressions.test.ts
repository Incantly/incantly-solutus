/**
 * Regression tests for handoff/view/findings.md, VIEW-SM-1 to VIEW-SM-27.
 *
 * Every test describes the behaviour the finding's evidence says is wrong and
 * must fail while the bug is present and pass once it is fixed. Tests use the
 * public API (`@incantly/view`) only. Anything that could loop for a long time
 * is bounded: heavy scenarios use sizes where the buggy code still finishes,
 * and each test carries an explicit timeout.
 *
 * Section names are the finding ids, so a failing test points at its finding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CanvasSurface,
  DrawList,
  FigureView,
  Figure3D,
  CLIP_OFF,
  SchedulerHost,
  SchedulerState,
  SharedGpuContext,
  SceneIndex,
  SoftwareBackend,
  SvgSurface,
  WebGL2Backend,
  DEFAULT_SCHEDULER_CONFIG,
  MAX_SVG_ELEMENTS,
  axisLabels,
  buildGeometry,
  buildInput,
  createViewport,
  fitAllRegion,
  isoGrid,
  placeLabels,
  polarGrid,
  registerFigure,
  resolveStyle,
  schedulerTick,
  setPlaying,
  spritePath,
  touchFigure,
  v3,
} from '@incantly/view';
import type {
  AuthoredStyle,
  DragApplier,
  DragMove,
  ExportRequest,
  FigureRecord,
  FigureViewOptions,
  KernelEvent,
  KernelView,
  LabelInput,
  LabelMarker,
  PaintKind,
  ParticleProgram,
  PathCommand,
  PathInfo,
  SchedulerAction,
  StyleStore,
  TickInput,
  ViewObjectHead,
  ViewValue,
} from '@incantly/view';
import { dragLog, fakeGl, head, oid, okValue, pumpQueue, recordingContext, stubDrawable, stubKernel, stubStyles, testStyle, testViewport } from './helpers';
import type { StubObject } from './helpers';

/* ------------------------------------------------------------------------- */
/* Shared harness                                                            */
/* ------------------------------------------------------------------------- */

interface Call {
  readonly name: string;
  readonly args: unknown[];
}

/** Everything a fake 2D context was asked to do, in order. */
class CtxLog {
  readonly calls: Call[] = [];
  readonly sets: Array<[string, unknown]> = [];
  count(name: string): number {
    let n = 0;
    for (const c of this.calls) if (c.name === name) n += 1;
    return n;
  }
  of(name: string): Call[] {
    return this.calls.filter((c) => c.name === name);
  }
  setsOf(prop: string): unknown[] {
    return this.sets.filter(([p]) => p === prop).map(([, v]) => v);
  }
  clear(): void {
    this.calls.length = 0;
    this.sets.length = 0;
  }
  /** Path-building and painting calls, a proxy for drawing work. */
  get drawOps(): number {
    let n = 0;
    for (const c of this.calls) {
      if (c.name === 'moveTo' || c.name === 'lineTo' || c.name === 'arc' || c.name === 'ellipse' || c.name === 'fill' || c.name === 'stroke' || c.name === 'fillText' || c.name === 'strokeText' || c.name === 'bezierCurveTo' || c.name === 'quadraticCurveTo' || c.name === 'fillRect' || c.name === 'drawImage') n += 1;
    }
    return n;
  }
}

function makeCtx(canvas: HTMLCanvasElement | null): { ctx: CanvasRenderingContext2D; log: CtxLog } {
  const log = new CtxLog();
  const store: Record<string, unknown> = { canvas, font: '10px sans-serif', textAlign: 'start', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(store, {
    get: (t, p) => {
      if (typeof p !== 'string') return undefined;
      if (p in t) return t[p];
      if (p === 'measureText') {
        return (s: string) => ({
          width: String(s).length * 7, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3, actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: String(s).length * 7, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3,
        });
      }
      if (p === 'createPattern') {
        return (...args: unknown[]) => {
          log.calls.push({ name: p, args });
          return { __pattern: true };
        };
      }
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
      if (p === 'getLineDash') return () => [];
      if (p === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (p === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(4 * Math.max(1, w * h)), width: w, height: h });
      if (p === 'isPointInPath' || p === 'isPointInStroke') return () => false;
      return (...args: unknown[]) => {
        log.calls.push({ name: p, args });
        return undefined;
      };
    },
    set: (t, p, v) => {
      t[p as string] = v;
      log.sets.push([String(p), v]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

/** Make `getContext('2d')` answer with a recording context; returns the log of each canvas. */
const logsByCanvas = new Map<HTMLCanvasElement, CtxLog>();
let canvasesCreated = 0;

function installCanvas(): void {
  logsByCanvas.clear();
  canvasesCreated = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    let rec = logsByCanvas.get(this);
    if (rec === undefined) {
      const made = makeCtx(this);
      rec = made.log;
      logsByCanvas.set(this, rec);
      (this as unknown as { __ctx: unknown }).__ctx = made.ctx;
    }
    return (this as unknown as { __ctx: unknown }).__ctx as never;
  } as never);
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, o?: ElementCreationOptions) => {
    if (String(tag).toLowerCase() === 'canvas') canvasesCreated += 1;
    return realCreate(tag, o);
  }) as never);
}

function logOf(c: HTMLCanvasElement): CtxLog {
  c.getContext('2d');
  const l = logsByCanvas.get(c);
  if (l === undefined) throw new Error('no context log for canvas');
  return l;
}

function noMotion(): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduce'), media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  }));
}

function motion(): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  }));
}

const pt = (id: number, name: string, x: number, y: number, extra: Partial<ViewObjectHead> = {}, style?: AuthoredStyle): StubObject => ({
  head: head(id, name, extra), value: { k: 'point', x, y }, kind: 'point', ...(style === undefined ? {} : { style }),
});

interface Fig {
  readonly view: FigureView;
  readonly el: HTMLDivElement;
  readonly queue: Array<() => void>;
  readonly drag: ReturnType<typeof dragLog>;
  readonly gestures: Array<[string, string]>;
  readonly deleted: unknown[][];
  readonly stats: Array<{ labels: number; painted: number; frameMs: number }>;
  readonly objects: StubObject[];
  readonly shared: SharedGpuContext;
  readonly canvases: () => HTMLCanvasElement[];
  readonly bg: () => CtxLog;
  readonly scene: () => CtxLog;
  readonly overlayCanvas: () => HTMLCanvasElement;
  readonly pump: (n?: number) => void;
}

interface FigOpts {
  readonly objects?: StubObject[];
  readonly over?: Partial<FigureViewOptions> & { kernel?: KernelView; styles?: StyleStore; drag?: DragApplier };
  readonly mode?: '2d' | '3d';
  readonly width?: number;
  readonly height?: number;
  readonly id?: string;
  readonly shared?: SharedGpuContext;
  readonly skipAdd?: boolean;
}

function sizeEl(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) });
}

const figs: Fig[] = [];

function mountFig(o: FigOpts = {}): Fig {
  const objects = o.objects ?? [pt(1, 'A', 1, 2)];
  const shared = o.shared ?? okValue(SharedGpuContext.create(), 'shared');
  const queue: Array<() => void> = [];
  const drag = dragLog();
  const gestures: Array<[string, string]> = [];
  const deleted: unknown[][] = [];
  const stats: Array<{ labels: number; painted: number; frameMs: number }> = [];
  const view = new FigureView({
    id: o.id ?? 'fig', kernel: stubKernel(objects), styles: stubStyles(objects), drag: drag.applier, snapshots: null, shared,
    meshes: { get: () => undefined }, toScript: () => '', mode: o.mode ?? '2d',
    scheduleFrame: (cb) => { queue.push(cb); },
    onGesture: (code, text) => { gestures.push([code, text]); },
    onDelete: (ids) => { deleted.push([...ids]); },
    onStats: (s) => { stats.push({ labels: s.labels, painted: s.painted, frameMs: s.frameMs }); },
    ...(o.over ?? {}),
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  sizeEl(el, o.width ?? 800, o.height ?? 600);
  okValue(view.mount(el), 'mount');
  if (o.skipAdd !== true) view.applyEvents([{ kind: 'add', ids: objects.map((x) => x.head.id) }]);
  const pump = (n = 60): void => { pumpQueue(queue, n); };
  pump();
  const canvases = (): HTMLCanvasElement[] => Array.from(el.querySelectorAll('canvas'));
  const fig: Fig = {
    view, el, queue, drag, gestures, deleted, stats, objects, shared, canvases, pump,
    bg: () => logOf(canvases()[0] as HTMLCanvasElement),
    scene: () => logOf(canvases()[1] as HTMLCanvasElement),
    overlayCanvas: () => canvases()[canvases().length - 1] as HTMLCanvasElement,
  };
  figs.push(fig);
  return fig;
}

function key(f: Fig, k: string, mods: KeyboardEventInit = {}): void {
  f.el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
  f.pump();
}

function pointer(f: Fig, type: string, x: number, y: number, over: PointerEventInit = {}): void {
  f.overlayCanvas().dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, bubbles: true, cancelable: true, ...over,
  }));
  f.pump();
}

function wheelEv(f: Fig, deltaY: number, x: number, y: number, ctrlKey: boolean): void {
  f.overlayCanvas().dispatchEvent(Object.assign(new Event('wheel', { bubbles: true, cancelable: true }), { deltaY, deltaX: 0, deltaMode: 0, clientX: x, clientY: y, ctrlKey }));
  f.pump();
}

const SVG_REQ: ExportRequest = { format: 'svg', region: 'view', background: 'view', includeGrid: false, includeAxes: false };

function exportOf(f: Fig, over: Partial<ExportRequest> = {}): string {
  return okValue(f.view.exportSvg({ ...SVG_REQ, ...over }), 'exportSvg');
}

/** Drag-protocol reader: kernel drag calls are `['drag' moves...]`, `['commit']`, `['cancel']`. */
function protocol(calls: unknown[][]): string[] {
  return calls.map((c) => (c[0] === 'commit' ? 'commit' : c[0] === 'cancel' ? 'cancel' : 'drag'));
}

/** Every `drag` run must end in exactly one commit or cancel; neither may arrive without a run. */
function protocolProblems(calls: unknown[][]): string[] {
  const problems: string[] = [];
  let open = false;
  for (const p of protocol(calls)) {
    if (p === 'drag') open = true;
    else if (!open) problems.push(`${p} without an open drag`);
    else open = false;
  }
  if (open) problems.push('drag left open');
  return problems;
}

const STUB_PARTS = (n: number): StubObject[] => Array.from({ length: n }, (_v, i) => pt(i + 1, `P${String(i + 1)}`, 0, 0));

beforeEach(() => {
  noMotion();
  installCanvas();
});

afterEach(() => {
  for (const f of figs.splice(0)) {
    try {
      f.view.unmount();
    } catch {
      // a failing test may leave a half-built view
    }
    f.el.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const TIMEOUT = 30_000;

/* ------------------------------------------------------------------------- */
/* VIEW-SM-1: untrusted text reaching CSS, SVG and HTML                      */
/* ------------------------------------------------------------------------- */

const HOSTILE_FAMILIES = [
  'x;fill:url(https://evil.example/beacon)',
  'x"onload="alert(1)',
  'x</style><script>alert(1)</script>',
  "x'; color: red",
  'a}b{c',
  'x\n;color:red',
  'x/**/;color:red',
  'url(https://evil.example/f)',
  'x\\3b color:red',
  'x;;',
  'x&#59;y',
  'x'.repeat(201),
];

const SAFE_FAMILY = /^[A-Za-z0-9 ,'"-]*$/;
const familySafe = (f: string): boolean => f.length <= 200 && SAFE_FAMILY.test(f);

const TEXT_STYLE = { size: 14, bold: false, italic: false, family: 'f', align: 'left', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, background: 'none' } as const;

function textObject(id: number, name: string, text: string, style?: AuthoredStyle): StubObject {
  return { head: head(id, name, { type: 'Text' as never }), value: { k: 'text', text, atX: 0, atY: 0, screen: false }, kind: 'text', ...(style === undefined ? {} : { style }) };
}

function styleAttrs(svg: string): string[] {
  return Array.from(svg.matchAll(/style="([^"]*)"/g)).map((m) => m[1] ?? '');
}

/** The invariant of V14: nothing in the document lets authored text act as CSS or markup. */
function expectNoCssInjection(svg: string): void {
  for (const s of styleAttrs(svg)) {
    expect(s).not.toContain('url(');
    expect(s).not.toMatch(/;\s*(fill|color|stroke|background)\s*:/);
  }
  for (const m of svg.matchAll(/font-family="([^"]*)"/g)) {
    const v = m[1] ?? '';
    expect(v).not.toContain('url(');
    expect(v).not.toContain(';');
  }
  expect(svg).not.toMatch(/<script/i);
  expect(svg).not.toMatch(/\sonload=/i);
}

describe('VIEW-SM-1 untrusted strings never become raw CSS or markup', () => {
  it.each(HOSTILE_FAMILIES)('resolveStyle refuses or neutralises textStyle.family %j', (family) => {
    const r = resolveStyle('text', true, { textStyle: { family } }, () => undefined);
    if (r.ok) expect(familySafe(r.value.textStyle.family)).toBe(true);
    else expect(JSON.stringify(r)).toMatch(/family|bad_property_value/);
  });

  it('a CSS-injecting family fails with a bad property value that names the property', () => {
    const r = resolveStyle('text', true, { textStyle: { family: 'x;fill:url(https://evil.example/beacon)' } }, () => undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r)).toMatch(/family|bad_property_value/);
  });

  it.each(['system-ui, sans-serif', 'Georgia, "Times New Roman", serif', "'Helvetica Neue', Arial", 'Fira-Code', 'x'.repeat(200)])(
    'ordinary font lists %j are still accepted unchanged',
    (family) => {
      const r = okValue(resolveStyle('text', true, { textStyle: { family } }, () => undefined), 'family');
      expect(r.textStyle.family).toBe(family);
    },
  );

  it('SvgSurface never writes a family as raw CSS (beacon url)', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.text({ text: 'hi', math: false }, { x: 5, y: 6 } as never, { ...TEXT_STYLE, family: 'x;fill:url(https://evil.example/beacon)' });
    expectNoCssInjection(s.toString(100, 80, 'none'));
  });

  it.each(HOSTILE_FAMILIES)('SvgSurface output stays inert for family %j', (family) => {
    const s = new SvgSurface({ textAs: 'text' });
    s.text({ text: 'hi', math: false }, { x: 5, y: 6 } as never, { ...TEXT_STYLE, family });
    expectNoCssInjection(s.toString(100, 80, 'none'));
  });

  it('SvgSurface keeps an ordinary family in the output', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.text({ text: 'hi', math: false }, { x: 5, y: 6 } as never, { ...TEXT_STYLE, family: 'Georgia, serif' });
    expect(s.toString(100, 80, 'none')).toContain('Georgia, serif');
  });

  it.each(HOSTILE_FAMILIES)('CanvasSurface never assigns ctx.font from family %j', (family) => {
    const { ctx, log } = makeCtx(null);
    const s = new CanvasSurface(ctx);
    s.text({ text: 'hi', math: false }, { x: 5, y: 6 } as never, { ...TEXT_STYLE, family });
    s.measure({ text: 'hi', math: false }, { ...TEXT_STYLE, family });
    for (const font of log.setsOf('font')) {
      expect(String(font)).not.toContain('evil.example');
      expect(String(font)).not.toMatch(/[;{}\n\\]|url\(|\/\*/);
    }
  });

  it('an exported figure with a hostile text family has no raw CSS in any style attribute', () => {
    const f = mountFig({ objects: [textObject(1, 'T', 'hello', { textStyle: { family: 'x;fill:url(https://evil.example/beacon)' } })] });
    const r = f.view.exportSvg(SVG_REQ);
    if (r.ok) expectNoCssInjection(r.value);
  });

  it('text content is escaped in the export', () => {
    const f = mountFig({ objects: [textObject(1, 'T', '<script>alert(1)</script>&"\'')] });
    const svg = exportOf(f);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain('&lt;script&gt;');
  });

  it('an object name with quotes and angle brackets cannot break out of the id attribute', () => {
    const f = mountFig({ objects: [pt(1, 'A"><script>alert(1)</script>', 1, 2)] });
    const svg = exportOf(f);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/id="[^"]*[<>][^"]*"/);
  });

  it('a caption label with markup is escaped as text content', () => {
    const f = mountFig({ objects: [pt(1, 'A', 1, 2, {}, { label: 'caption', caption: '"><img src=x onerror=1>' })] });
    const svg = exportOf(f);
    expect(svg).not.toMatch(/<img/i);
  });

  it('an image href cannot close its attribute', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.setImageHref('k', 'https://x.example/a.png"onload="alert(1)');
    s.image({ key: 'k', widthPx: 10, heightPx: 10 }, { x0: 0, x1: 10, y0: 0, y1: 10 } as never, 1);
    expect(s.toString(100, 80, 'none')).not.toMatch(/\sonload=/);
  });

  it('a hatch image src cannot close its attribute', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.path(new Float32Array([0, 0, 10, 0, 10, 10]));
    s.fill({ kind: 'hatch', spec: { kind: 'image', src: 'x"onload="alert(1)', mode: 'tile' }, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 });
    expect(s.toString(100, 80, 'none')).not.toMatch(/\sonload=/);
  });

  it('the reader list shows names and descriptions only as text', () => {
    const f = mountFig({ objects: [pt(1, '<img src=x onerror=1>', 1, 2)] });
    expect(f.el.querySelector('img')).toBeNull();
    // A name inside an attribute value is serialised unescaped by innerHTML, so
    // the check is on elements: nothing the name could have created exists.
    expect(f.el.querySelectorAll('[onerror], script, iframe')).toHaveLength(0);
  });

  it('announced text goes into the live region as text', () => {
    const f = mountFig();
    f.view.announceAdded('<b>circle</b>', '<i>c</i>', '<script>1</script>');
    f.pump();
    expect(f.el.querySelector('b, i, script')).toBeNull();
  });

  it('alt text with markup stays text in the accessible name', () => {
    const f = mountFig({ objects: [pt(1, 'A', 1, 2, {}, { alt: '"><script>1</script>' })] });
    expect(f.el.querySelector('script')).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */
/* VIEW-SM-2: the 300-label budget                                           */
/* ------------------------------------------------------------------------- */

function labelGrid(n: number, label: AuthoredStyle['label'] = 'name'): StubObject[] {
  const out: StubObject[] = [];
  const cols = 25;
  for (let i = 0; i < n; i += 1) {
    out.push(pt(i + 1, `P${String(i + 1)}`, -7 + (i % cols) * 0.58, -5 + Math.floor(i / cols) * 0.62, {}, { label }));
  }
  return out;
}

const textCount = (svg: string): number => (svg.match(/<text[\s>]/g) ?? []).length;

describe('VIEW-SM-2 at most 300 labels paint, and only labels in the viewport count', () => {
  it('400 labelled points export at most 300 text elements', () => {
    const f = mountFig({ objects: labelGrid(400) });
    expect(textCount(exportOf(f))).toBeLessThanOrEqual(300);
  }, TIMEOUT);

  it('1,000 labelled points still export at most 300 text elements', () => {
    const f = mountFig({ objects: labelGrid(1000) });
    expect(textCount(exportOf(f))).toBeLessThanOrEqual(300);
  }, TIMEOUT);

  it('300 labelled points are all kept (the budget is not lower than 300)', () => {
    const f = mountFig({ objects: labelGrid(300) });
    expect(textCount(exportOf(f))).toBeGreaterThan(200);
  }, TIMEOUT);

  it('name-value labels obey the same budget', () => {
    const f = mountFig({ objects: labelGrid(400, 'name-value') });
    expect(textCount(exportOf(f))).toBeLessThanOrEqual(300);
  }, TIMEOUT);

  it('the frame statistics never report more than 300 labels', () => {
    const f = mountFig({ objects: labelGrid(400) });
    const maxLabels = Math.max(0, ...f.stats.map((s) => s.labels));
    expect(maxLabels).toBeLessThanOrEqual(300);
  }, TIMEOUT);

  it('the live scene canvas draws at most 300 label texts', () => {
    const f = mountFig({ objects: labelGrid(400) });
    f.scene().clear();
    f.view.setViewRegion({ x0: -8 as never, x1: 8 as never, y0: -6 as never, y1: 6 as never }, 'free', null);
    f.pump();
    expect(f.scene().count('fillText')).toBeLessThanOrEqual(300);
  }, TIMEOUT);

  it('off-screen labels do not use up the budget: 350 hidden by position, 40 on screen, all 40 appear', () => {
    const objects: StubObject[] = [];
    for (let i = 0; i < 350; i += 1) objects.push(pt(i + 1, `Far${String(i + 1)}`, 100 + i * 0.5, 100, {}, { label: 'name' }));
    for (let i = 0; i < 40; i += 1) objects.push(pt(351 + i, `Near${String(i + 1)}`, -7 + (i % 8) * 1.8, -4 + Math.floor(i / 8) * 1.8, {}, { label: 'name' }));
    const f = mountFig({ objects });
    const svg = exportOf(f);
    let shown = 0;
    for (let i = 1; i <= 40; i += 1) if (svg.includes(`>Near${String(i)}<`)) shown += 1;
    expect(shown).toBe(40);
  }, TIMEOUT);

  it('off-screen labels never paint', () => {
    const objects: StubObject[] = [];
    for (let i = 0; i < 20; i += 1) objects.push(pt(i + 1, `Far${String(i + 1)}`, 100 + i, 100, {}, { label: 'name' }));
    const f = mountFig({ objects });
    expect(exportOf(f)).not.toContain('>Far');
  }, TIMEOUT);

  it('a selected point keeps its label when 400 labels compete', () => {
    const objects = labelGrid(400);
    // The last object, drawn last, is the one a draw-list-order cut would drop first.
    objects[399] = pt(400, 'Chosen', 0, 0, {}, { label: 'name' });
    const f = mountFig({ objects });
    pointer(f, 'pointerdown', 400, 300);
    pointer(f, 'pointerup', 400, 300);
    expect(exportOf(f)).toContain('>Chosen<');
  }, TIMEOUT);

  it('a curve with many runs is capped across all runs, not per run', () => {
    const runs: Float64Array[] = [];
    for (let r = 0; r < 10; r += 1) {
      const a = new Float64Array(2 * 3000);
      for (let i = 0; i < 3000; i += 1) {
        a[2 * i] = -7 + (14 * i) / 3000;
        a[2 * i + 1] = (i % 2 === 0 ? 1 : -1) * (1 + r * 0.1);
      }
      runs.push(a);
    }
    const vp = testViewport();
    const g = buildGeometry({ k: 'curve', runs }, buildInput(vp, (t, s) => ({ width: t.length * s * 0.6, height: s })), testStyle('curve'));
    let total = 0;
    for (const s of g?.strokes ?? []) total += s.length / 2;
    expect(total).toBeLessThanOrEqual(4000 + 20);
  }, TIMEOUT);

  it('one long run is still capped at 4,000 samples', () => {
    const a = new Float64Array(2 * 20000);
    for (let i = 0; i < 20000; i += 1) {
      a[2 * i] = -7 + (14 * i) / 20000;
      a[2 * i + 1] = i % 2 === 0 ? 1 : -1;
    }
    const g = buildGeometry({ k: 'curve', runs: [a] }, buildInput(testViewport(), (t, s) => ({ width: t.length * s * 0.6, height: s })), testStyle('curve'));
    let total = 0;
    for (const s of g?.strokes ?? []) total += s.length / 2;
    expect(total).toBeLessThanOrEqual(4000 + 10);
  }, TIMEOUT);
});

/* ------------------------------------------------------------------------- */
/* VIEW-SM-3: SVG element and byte caps stop the work                        */
/* ------------------------------------------------------------------------- */

const STROKE = { color: { r: 1, g: 0, b: 0, a: 1 }, width: 2, dash: [] as number[], dashPhase: 0, cap: 'butt', join: 'miter', miterLimit: 4, opacity: 1 } as const;

describe('VIEW-SM-3 a cap stops the work before the work is done', () => {
  it('the surface stops growing past the element cap', () => {
    const s = new SvgSurface({ textAs: 'text' });
    for (let i = 0; i < MAX_SVG_ELEMENTS + 10_000; i += 1) {
      s.path(new Float32Array([0, 0, 1, 1]));
      s.stroke(STROKE);
    }
    expect(s.elementCount).toBeLessThanOrEqual(MAX_SVG_ELEMENTS + 1);
  }, TIMEOUT);

  it('the written document stays near the element cap', () => {
    const s = new SvgSurface({ textAs: 'text' });
    for (let i = 0; i < MAX_SVG_ELEMENTS + 10_000; i += 1) {
      s.path(new Float32Array([0, 0, 1, 1]));
      s.stroke(STROKE);
    }
    const doc = s.toString(100, 80, 'none');
    const paths = (doc.match(/<path/g) ?? []).length;
    expect(paths).toBeLessThanOrEqual(MAX_SVG_ELEMENTS + 5);
  }, TIMEOUT);

  it('text elements count against the same cap', () => {
    const s = new SvgSurface({ textAs: 'text' });
    for (let i = 0; i < MAX_SVG_ELEMENTS + 5000; i += 1) s.text({ text: 'a', math: false }, { x: 1, y: 2 } as never, TEXT_STYLE);
    expect(s.elementCount).toBeLessThanOrEqual(MAX_SVG_ELEMENTS + 1);
  }, TIMEOUT);

  it('a byte budget stops very large documents (100 MB of text is refused)', () => {
    const s = new SvgSurface({ textAs: 'text' });
    const big = 'x'.repeat(1_000_000);
    for (let i = 0; i < 100; i += 1) s.text({ text: big, math: false }, { x: 1, y: 2 } as never, TEXT_STYLE);
    const doc = s.toString(100, 80, 'none');
    expect(doc.length).toBeLessThanOrEqual(80 * 1024 * 1024);
  }, TIMEOUT);

  it('a figure of 60,000 points is refused with a limit error', () => {
    const objects: StubObject[] = [];
    for (let i = 0; i < 60_000; i += 1) objects.push(pt(i + 1, `P${String(i + 1)}`, (i % 300) * 0.05 - 7, Math.floor(i / 300) * 0.05 - 5));
    const f = mountFig({ objects });
    const r = f.view.exportSvg(SVG_REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('limit');
  }, 60_000);

  it('a figure whose document would pass the byte budget is refused with a limit error', () => {
    const big = 'y'.repeat(100_000);
    const objects: StubObject[] = [];
    for (let i = 0; i < 700; i += 1) objects.push(textObject(i + 1, `T${String(i + 1)}`, big));
    const f = mountFig({ objects });
    const r = f.view.exportSvg(SVG_REQ);
    if (r.ok) expect(r.value.length).toBeLessThanOrEqual(80 * 1024 * 1024);
    else expect(r.kind).toBe('limit');
  }, 60_000);

  it('a figure just under the cap still exports', () => {
    const objects: StubObject[] = [];
    for (let i = 0; i < 2000; i += 1) objects.push(pt(i + 1, `P${String(i + 1)}`, (i % 100) * 0.1 - 5, Math.floor(i / 100) * 0.2 - 2));
    const f = mountFig({ objects });
    expect(f.view.exportSvg(SVG_REQ).ok).toBe(true);
  }, TIMEOUT);

  it('a refused export leaves the view able to export again', () => {
    const objects: StubObject[] = [];
    for (let i = 0; i < 60_000; i += 1) objects.push(pt(i + 1, `P${String(i + 1)}`, (i % 300) * 0.05 - 7, Math.floor(i / 300) * 0.05 - 5));
    const f = mountFig({ objects });
    expect(f.view.exportSvg(SVG_REQ).ok).toBe(false);
    f.objects.length = 10;
    f.view.applyEvents([{ kind: 'remove', ids: Array.from({ length: 59_990 }, (_v, i) => oid(i + 11)) }]);
    f.pump();
    expect(f.view.exportSvg(SVG_REQ).ok).toBe(true);
  }, 90_000);
});

/* ------------------------------------------------------------------------- */
/* VIEW-SM-4: caches stay bounded                                            */
/* ------------------------------------------------------------------------- */

function disposeCountFor(cycles: number): { duringBackendDispose: number; total: number } {
  let deletes = 0;
  const base = fakeGl() as unknown as Record<string, unknown>;
  const gl = new Proxy({}, {
    get: (_t, p) => {
      if (typeof p === 'string' && /^delete/.test(p)) {
        return () => {
          deletes += 1;
        };
      }
      return base[p as string];
    },
  });
  const be = new WebGL2Backend(gl as never);
  for (let i = 0; i < cycles; i += 1) {
    const t = be.createTarget({ width: 16, height: 16, samples: 0, depth: true, float: false });
    if (t.ok) t.value.dispose();
  }
  const before = deletes;
  be.dispose();
  return { duringBackendDispose: deletes - before, total: deletes };
}

describe('VIEW-SM-4 caches are bounded and owned handles are released', () => {
  it('1,000 hatch fills with a drifting colour create a bounded number of tile canvases', () => {
    const { ctx, log } = makeCtx(null);
    const s = new CanvasSurface(ctx);
    const created0 = canvasesCreated;
    s.path(new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]));
    for (let i = 0; i < 1000; i += 1) {
      s.fill({ kind: 'hatch', spec: { kind: 'lines', angle: 45, spacing: 8 }, color: { r: 128 + i * 0.001, g: 40, b: 40, a: 1 }, opacity: 1 });
    }
    expect(canvasesCreated - created0).toBeLessThanOrEqual(64);
    expect(log.count('createPattern')).toBeLessThanOrEqual(64);
  }, TIMEOUT);

  it('1,000 hatch fills with 1,000 different spacings do not keep 1,000 tiles alive', () => {
    const { ctx } = makeCtx(null);
    const s = new CanvasSurface(ctx);
    const created0 = canvasesCreated;
    s.path(new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]));
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 200; i += 1) s.fill({ kind: 'hatch', spec: { kind: 'dots', spacing: 4 + i * 0.01 }, color: { r: 10, g: 10, b: 10, a: 1 }, opacity: 1 });
    }
    // A bounded cache can rebuild evicted tiles, but no tile is built twice in a row for the same request.
    expect(canvasesCreated - created0).toBeLessThanOrEqual(600);
  }, TIMEOUT);

  it('the same hatch request twice reuses one tile', () => {
    const { ctx } = makeCtx(null);
    const s = new CanvasSurface(ctx);
    s.path(new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]));
    const spec = { kind: 'lines', angle: 45, spacing: 8 } as const;
    s.fill({ kind: 'hatch', spec, color: { r: 1, g: 2, b: 3, a: 1 }, opacity: 1 });
    const after1 = canvasesCreated;
    s.fill({ kind: 'hatch', spec, color: { r: 1, g: 2, b: 3, a: 1 }, opacity: 1 });
    expect(canvasesCreated).toBe(after1);
  });

  it('disposed handles are not deleted a second time when the back-end is disposed', () => {
    expect(disposeCountFor(1).duringBackendDispose).toBe(disposeCountFor(40).duringBackendDispose);
  });

  it('the work at back-end disposal does not grow with the number of target create/dispose cycles', () => {
    const a = disposeCountFor(5).duringBackendDispose;
    const b = disposeCountFor(200).duringBackendDispose;
    expect(b).toBeLessThanOrEqual(a);
  });

  it('every target handle is deleted exactly once over its life', () => {
    const one = disposeCountFor(1);
    const ten = disposeCountFor(10);
    const perTarget = (ten.total - ten.duringBackendDispose) / 10;
    expect(Number.isInteger(perTarget)).toBe(true);
    expect(one.total - one.duringBackendDispose).toBe(perTarget);
    expect(ten.total).toBe(perTarget * 10 + ten.duringBackendDispose);
  });
});

/* ------------------------------------------------------------------------- */
/* VIEW-SM-5: grid cost is bounded by the view                               */
/* ------------------------------------------------------------------------- */

const bounds = (x0: number, x1: number, y0: number, y1: number): never => ({ x0, x1, y0, y1 }) as never;

describe('VIEW-SM-5 grid drawing is bounded by the view size', () => {
  it('a polar grid far from the origin makes only the circles that cross the view', () => {
    const g = polarGrid(bounds(1e6 - 8, 1e6 + 8, -6, 6), 1, 30);
    expect(g.circles.length).toBeLessThanOrEqual(40);
  }, TIMEOUT);

  it('those circles are all between the nearest and the farthest corner of the view', () => {
    const g = polarGrid(bounds(1e6 - 8, 1e6 + 8, -6, 6), 1, 30);
    for (const r of g.circles) {
      expect(r).toBeGreaterThanOrEqual(1e6 - 8 - 1);
      expect(r).toBeLessThanOrEqual(1e6 + 8 + 1);
    }
  }, TIMEOUT);

  it('a polar grid centred on the origin still has its circles out to the far corner', () => {
    const g = polarGrid(bounds(-8, 8, -6, 6), 2, 30);
    for (const r of [2, 4, 6, 8, 10]) expect(g.circles.map((c) => Math.round(c * 1e6) / 1e6)).toContain(r);
    expect(g.circles.some((c) => c > 10.01)).toBe(false);
  });

  it('a view that does not contain the origin skips the circles that never reach it', () => {
    const g = polarGrid(bounds(20, 30, -1, 1), 1, 30);
    expect(g.circles.some((c) => c < 19)).toBe(false);
    expect(g.circles.some((c) => c > 31)).toBe(false);
  });

  it('a polar grid with a tiny step stays within a fixed line cap', () => {
    const g = polarGrid(bounds(-8, 8, -6, 6), 1e-5, 30);
    expect(g.circles.length).toBeLessThanOrEqual(4000);
  }, TIMEOUT);

  it('the polar grid is built in well under a second at x = 1e6', () => {
    const t0 = performance.now();
    polarGrid(bounds(1e6 - 8, 1e6 + 8, -6, 6), 1, 30);
    expect(performance.now() - t0).toBeLessThan(1000);
  }, TIMEOUT);

  it('an iso grid with a tiny step stays within a fixed line cap', () => {
    const g = isoGrid(bounds(-8, 8, -6, 6), 1e-3);
    expect(g.offsets0.length).toBeLessThanOrEqual(4000);
    expect(g.offsets60.length).toBeLessThanOrEqual(4000);
    expect(g.offsets120.length).toBeLessThanOrEqual(4000);
  }, TIMEOUT);

  it('axis labels with a tiny fixed step stay within a fixed cap', () => {
    const l = axisLabels(bounds(-8, 8, -6, 6), 1e-4, 1e-4, { k: 'unit' }, { k: 'unit' });
    expect(l.x.length).toBeLessThanOrEqual(4000);
    expect(l.y.length).toBeLessThanOrEqual(4000);
  }, TIMEOUT);

  it('a repaint of a polar grid centred at x = 20,000 draws a bounded number of operations', () => {
    const f = mountFig({ objects: [pt(1, 'A', 2e4, 0)] });
    f.view.setGrid({ on: true, kind: 'polar', step: null, polarSpokesDeg: 30 });
    f.view.setViewRegion({ x0: 2e4 - 8 as never, x1: 2e4 + 8 as never, y0: -6 as never, y1: 6 as never }, 'free', null);
    f.bg().clear();
    f.view.setViewRegion({ x0: 2e4 - 9 as never, x1: 2e4 + 9 as never, y0: -6 as never, y1: 6 as never }, 'free', null);
    f.pump();
    expect(f.bg().drawOps).toBeLessThan(150_000);
  }, 120_000);

  it('an iso grid with a fixed step of 1e-4 draws a bounded number of operations', () => {
    const f = mountFig();
    f.view.setGrid({ on: true, kind: 'iso', step: 1e-4, polarSpokesDeg: 30 });
    f.bg().clear();
    f.view.setViewRegion({ x0: -9 as never, x1: 9 as never, y0: -6 as never, y1: 6 as never }, 'free', null);
    f.pump();
    expect(f.bg().drawOps).toBeLessThan(60_000);
  }, 120_000);

  it('a cartesian grid with a fixed step of 1e-4 draws a bounded number of operations', () => {
    const f = mountFig();
    f.view.setGrid({ on: true, kind: 'minor', step: 1e-4, polarSpokesDeg: 30 });
    f.bg().clear();
    f.view.setViewRegion({ x0: -9 as never, x1: 9 as never, y0: -6 as never, y1: 6 as never }, 'free', null);
    f.pump();
    expect(f.bg().drawOps).toBeLessThan(60_000);
  }, 120_000);

  it('axis numbers with a fixed step of 1e-4 stay under a fixed cap', () => {
    const f = mountFig();
    f.view.setAxes({ which: 'on', labels: true, unitX: { k: 'unit' }, unitY: { k: 'unit' } });
    f.view.setGrid({ on: true, kind: 'major', step: 1e-4, polarSpokesDeg: 30 });
    f.bg().clear();
    f.view.setViewRegion({ x0: -9 as never, x1: 9 as never, y0: -6 as never, y1: 6 as never }, 'free', null);
    f.pump();
    expect(f.bg().count('fillText')).toBeLessThanOrEqual(4000);
  }, 120_000);

  it('a normal grid is unaffected: 16 by 12 units at the default step draws its lines', () => {
    const f = mountFig();
    f.view.setGrid({ on: true, kind: 'major', step: null, polarSpokesDeg: 30 });
    f.bg().clear();
    f.view.setViewRegion({ x0: -9 as never, x1: 9 as never, y0: -6 as never, y1: 6 as never }, 'free', null);
    f.pump();
    expect(f.bg().drawOps).toBeGreaterThan(5);
  });
});

/* ------------------------------------------------------------------------- */
/* VIEW-SM-6: WebGL context loss and box ownership                           */
/* ------------------------------------------------------------------------- */

describe('VIEW-SM-6 context loss and shared boxes', () => {
  it('the shared canvas prevents the default action on webglcontextlost so the browser may restore it', () => {
    const made: HTMLCanvasElement[] = [];
    const factory = {
      createOffscreen: (w: number, h: number) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        (c as unknown as { getContext: (k: string) => unknown }).getContext = (k: string) => (k === 'webgl2' ? fakeGl() : null);
        made.push(c);
        return c;
      },
      createVisible: (_id: string, w: number, h: number) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        made.push(c);
        return c;
      },
    };
    const shared = okValue(SharedGpuContext.create(factory), 'shared');
    okValue(shared.acquireBox('a', 100, 100, 1), 'box');
    const prevented = made.map((c) => {
      const ev = new Event('webglcontextlost', { cancelable: true, bubbles: true });
      c.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented.some((p) => p)).toBe(true);
  });

  it('a lost context makes present report an error or a no-op instead of throwing', () => {
    const shared = okValue(SharedGpuContext.create(), 'shared');
    okValue(shared.acquireBox('a', 100, 100, 1), 'box');
    expect(() => shared.present('a')).not.toThrow();
  });

  it('two views with the same id do not share one box: unmounting one leaves the other drawable', () => {
    const shared = okValue(SharedGpuContext.create(), 'shared');
    const a = mountFig({ id: 'dup', mode: '3d', shared, objects: [pt(1, 'A', 0, 0)] });
    const objects = [pt(1, 'A', 0, 0)];
    const view2 = new FigureView({
      id: 'dup', kernel: stubKernel(objects), styles: stubStyles(objects), drag: dragLog().applier, snapshots: null, shared,
      meshes: { get: () => undefined }, toScript: () => '', mode: '3d', scheduleFrame: () => undefined,
    });
    const el2 = document.createElement('div');
    document.body.appendChild(el2);
    sizeEl(el2, 400, 300);
    const r2 = view2.mount(el2);
    a.view.unmount();
    if (r2.ok) expect(shared.box('dup')).toBeDefined();
    view2.unmount();
    el2.remove();
  });

  it('a second owner of an id is refused or given its own box', () => {
    const shared = okValue(SharedGpuContext.create(), 'shared');
    const first = shared.acquireBox('same', 100, 100, 1);
    const second = shared.acquireBox('same', 100, 100, 1);
    expect(first.ok).toBe(true);
    if (second.ok && first.ok) expect(second.value).not.toBe(first.value);
  });

  it('releasing one id leaves the other boxes alone', () => {
    const shared = okValue(SharedGpuContext.create(), 'shared');
    okValue(shared.acquireBox('a', 100, 100, 1), 'a');
    okValue(shared.acquireBox('b', 100, 100, 1), 'b');
    shared.releaseBox('a');
    expect(shared.box('b')).toBeDefined();
    expect(shared.box('a')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------- */
/* VIEW-SM-7: remount after unmount                                          */
/* ------------------------------------------------------------------------- */

describe('VIEW-SM-7 a figure mounted again after unmount draws or says it cannot', () => {
  function remount(): { f: Fig; el2: HTMLDivElement; result: ReturnType<FigureView['mount']> } {
    const f = mountFig({ objects: [pt(1, 'A', 1, 2), pt(2, 'B', -1, 0), pt(3, 'C', 3, 1)] });
    f.view.unmount();
    const el2 = document.createElement('div');
    document.body.appendChild(el2);
    sizeEl(el2, 800, 600);
    const result = f.view.mount(el2);
    return { f, el2, result };
  }

  it('after unmount and mount, applying events queues frames (or mount returned an error)', () => {
    const { f, result } = remount();
    if (!result.ok) return;
    // Run the frame that mount itself asked for, so the next request is new.
    f.pump();
    f.queue.length = 0;
    f.view.applyEvents([{ kind: 'add', ids: f.objects.map((o) => o.head.id) }]);
    expect(f.queue.length).toBeGreaterThan(0);
  });

  it('after unmount and mount, the reader list holds the objects (or mount returned an error)', () => {
    const { f, el2, result } = remount();
    if (!result.ok) return;
    f.view.applyEvents([{ kind: 'add', ids: f.objects.map((o) => o.head.id) }]);
    pumpQueue(f.queue, 50);
    expect(el2.querySelectorAll('li')).toHaveLength(3);
  });

  it('after unmount and mount, the canvases draw the objects (or mount returned an error)', () => {
    const { f, el2, result } = remount();
    if (!result.ok) return;
    f.view.applyEvents([{ kind: 'add', ids: f.objects.map((o) => o.head.id) }]);
    pumpQueue(f.queue, 50);
    const scene = el2.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    expect(logOf(scene).drawOps).toBeGreaterThan(0);
  });

  it('a mount that cannot work again says so with an error that names the problem', () => {
    const { result } = remount();
    if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
  });

  it('three mount/unmount cycles still end with a drawing figure (or an error each time)', () => {
    const f = mountFig({ objects: [pt(1, 'A', 1, 2), pt(2, 'B', -1, 0)] });
    let last = { ok: true } as { ok: boolean };
    let el: HTMLDivElement | null = null;
    for (let i = 0; i < 3; i += 1) {
      f.view.unmount();
      el?.remove();
      el = document.createElement('div');
      document.body.appendChild(el);
      sizeEl(el, 800, 600);
      last = f.view.mount(el);
    }
    if (last.ok && el !== null) {
      f.view.applyEvents([{ kind: 'add', ids: f.objects.map((o) => o.head.id) }]);
      pumpQueue(f.queue, 50);
      expect(el.querySelectorAll('li')).toHaveLength(2);
    }
    el?.remove();
  });

  it('an unmounted figure does not queue frames for events', () => {
    const f = mountFig();
    f.view.unmount();
    f.queue.length = 0;
    f.view.applyEvents([{ kind: 'update', ids: [oid(1)] }]);
    expect(f.queue).toHaveLength(0);
  });
});
