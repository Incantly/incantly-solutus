/**
 * The figure view: canvases, the frame loop, 2D and 3D paint paths, pointer
 * and keyboard, live-region accessibility and export. Browser-owned wiring
 * around the DOM-free core; the core never sees these nodes.
 */
import type { ObjId, TypeName } from '@incantly/kernel';
import type { DragApplier, DragMove, KernelEvent, KernelView, SnapshotProvider } from '../contracts';
import { CanvasSurface } from '../backends/canvas2d';
import { SoftwareBackend } from '../backends/software';
import { MAX_SVG_BYTES, SvgSurface } from '../backends/svg';
import {
  createMapper, createViewport, defaultHome, fitAllRegion, isDegenerateView, maths, panBy, px, tweenViewport,
  viewportFromRegion, zoomAbout, type MathsRect, type PxPoint, type PxRect, type Viewport,
} from '../core/coords';
import { okResult, viewError } from '../errors';
import type { Notice, Result } from '@incantly/kernel';
import {
  axisLabels, cartesianGrid, chooseStep, isoGrid, pinToEdge, polarGrid, thinLabels,
  type AxesSpec, type AxisUnit, type GridSpec,
} from '../core/grid';
import { DEFAULT_AXES, DEFAULT_GRID, GRID_MIN_FIXED_PX, visibleArc } from '../core/grid';
import {
  clickSelect, emptySelection, rubberBandSelect, selectAll, type RubberBandShape, type SelectionState,
} from '../core/selection';
import {
  createCycleState, cyclePick, cycleTooltip, rankCandidates, slackFor,
  type CycleState, type HitCandidate, type HitList, type PointerKind,
} from '../core/hit';
import { HitIndex } from '../core/hit';
import {
  clampParam, computeDragPlan, freePointTarget, nudgeStep,
  projectArc, projectCircle, projectLine, projectOnSamples, projectPolygon, projectRay, projectSegment,
  roundForCommit, sliderTarget, wrapDelta, type DragFacts, type DragPlan,
} from '../core/drag';
import { GeometryDrawable } from '../core/drawable';
import {
  paintDrawables, splitForActive, updateDrawables,
  type DrawListEntry, type PaintContext, type PaintKind, type StyleStore,
} from '../core/drawables';
import { DrawList, ResolutionController } from '../core/drawables';
import type { TextMeasure } from '../core/geometry';
import {
  createSnapMemory, limitAngle, snapParamToGrid, snapWithHysteresis,
  type SnapContext, type SnapMemory, type SnapMode,
} from '../core/snap';
import { placeLabels, type LabelInput, type LabelPlacement } from '../core/labels';
import {
  DEFAULT_BUDGETS, checkLabels, type BudgetLimits,
} from '../core/budgets';
import {
  MAX_SVG_ELEMENTS, exportViewport, normalizeExport, type ExportRequest,
} from '../core/export';
import { describeAdded, describeFigure, describeMove } from '../core/describe';
import { LIGHT_THEME, type Rgba, type Theme } from '../core/styles';
import {
  buildCamera, drawnToWorldVec, pointerRay, projectPoint, readAzEl, userRotate,
  v3Add, v3Dot, v3Scale, v3Sub,
  DEFAULT_SPACE_CAMERA, type Camera, type SpaceCameraProps, type V3,
} from '../core/camera';
import { CLIP_OFF, itemBounds, type ClipBox, type DrawItem, type HiddenLineMode } from '../core/scene';
import { buildBvh, pick, rayLineClosest, rayPlane, type Bvh, type Pickable } from '../core/pick3d';
import { particleExportPlan } from '../core/particles';
import { mathsBounds } from '../core/bounds';
import { createDrawStats, type DrawStats, type Target } from '../core/gpu';
import type { Surface } from '../core/surface';
import { Figure3D, type MeshProvider } from './figure-3d';
import type { SharedGpuContext } from './shared-context';

export type FigureMode = '2d' | '3d';

export interface FigureViewOptions {
  readonly id: string;
  readonly kernel: KernelView;
  readonly styles: StyleStore;
  readonly drag: DragApplier;
  readonly snapshots: SnapshotProvider | null;
  readonly shared: SharedGpuContext;
  readonly meshes: MeshProvider;
  readonly toScript: () => string;
  mode: FigureMode;
  readonly theme?: Theme;
  /** Preformatted value text per object, for labels and the reader list. */
  readonly valueText?: (id: ObjId) => string;
  /** Pair intersections under the pointer, for point snapping. */
  readonly intersections?: (at: { x: number; y: number }) => Array<{ x: number; y: number }>;
  readonly onDelete?: (ids: ObjId[]) => void;
  /** Label drags report their final offset; the sdk writes the `with` line. */
  readonly onRestyle?: (id: ObjId, props: { labelDx: number; labelDy: number }) => void;
  /** Gesture feedback (toasts, tooltips): code + human text. */
  readonly onGesture?: (code: string, text: string) => void;
  readonly onStats?: (stats: FigureStats) => void;
  /** Budget notices, such as hidden labels (performance design 5). */
  readonly onNotice?: (notice: Notice) => void;
  readonly onInteract?: () => void;
  /** Frame scheduling; defaults to requestAnimationFrame. The player passes its own. */
  readonly scheduleFrame?: (cb: () => void) => void;
}

export interface FigureStats {
  readonly frameMs: number;
  readonly painted: number;
  readonly labels: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly culled: number;
}

/** Map a kernel type to its drawable kind; null means no 2D drawable. */
export function kindForType(type: TypeName, valueKind: string): PaintKind | null {
  if (valueKind === 'slider') return 'widget';
  switch (type) {
    case 'Point': return 'point';
    case 'Vector': return 'vector';
    case 'Segment': return 'segment';
    case 'Ray':
    case 'Line': return 'line';
    case 'Circle':
    case 'Arc': return 'arc';
    case 'Polygon': return 'region';
    case 'Function':
    case 'Curve': return 'curve';
    case 'Region': return 'region';
    case 'Text': return 'text';
    case 'Bool': return 'widget';
    case 'Particles': return 'particles';
    default: return null;
  }
}

interface Tween {
  readonly from: Viewport;
  readonly to: Viewport;
  readonly startMs: number;
  readonly durMs: number;
}

interface DragSession {
  readonly pointerId: number;
  readonly plan: DragPlan;
  readonly startX: number;
  readonly startY: number;
  started: boolean;
  readonly grabOffset: { dx: number; dy: number };
  readonly hintS: number | null;
  lastX: number;
  lastY: number;
  readonly kind: PointerKind;
  readonly targetName: string;
  readonly labelId: ObjId | null;
}

const HOVER_SLACK: PointerKind = 'mouse';
/** Most isometric lines drawn on each side of the centre (VIEW-SM-5). */
const MAX_ISO_LINES_PER_SIDE = 1500;

export class FigureView {
  /** Counter for unique `aria-describedby` summary ids across figures on a page. */
  private static nextSummaryId = 1;
  private readonly opts: FigureViewOptions;
  private readonly list = new DrawList();
  private readonly hits = new HitIndex();
  private readonly figure3d: Figure3D;
  private software: SoftwareBackend | null = null;
  private view: Viewport | null = null;
  private home: MathsRect;
  private ratioLock: 'free' | 'equal' = 'equal';
  private grid: GridSpec = DEFAULT_GRID;
  private axes: AxesSpec = DEFAULT_AXES;
  private background: Rgba | 'transparent';
  private snap: SnapMode = 'auto';
  private theme: Theme;
  private selection: SelectionState = emptySelection();
  private cycle: CycleState = createCycleState();
  private snapMem: SnapMemory = createSnapMemory(12);
  private readonly resolution = new ResolutionController();
  private placements: LabelPlacement[] = [];
  /** Labels allowed to paint this frame (at most the label budget, in view). */
  private labelShown: ReadonlySet<ObjId> = new Set();
  private lastLabelsHidden = 0;
  private prevLabelOffsets = new Map<ObjId, { dx: number; dy: number; score: number }>();
  private labelOverride = new Map<ObjId, { dx: number; dy: number }>();
  private gridStepX: number | null = null;
  private gridStepY: number | null = null;

  private root: HTMLElement | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private sceneCanvas: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private bgSurface: CanvasSurface | null = null;
  private sceneSurface: CanvasSurface | null = null;
  private overlaySurface: CanvasSurface | null = null;
  private readerList: HTMLElement | null = null;
  private liveRegion: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private readonly readerItems = new Map<ObjId, HTMLElement>();
  private readonly readerText = new Map<ObjId, string>();
  private lastAnnounceMs = Number.NEGATIVE_INFINITY;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedAnnounce: string | null = null;

  private pending = false;
  private bgDirty = true;
  private cacheValid = false;
  private cacheKey = '';
  private lowerCache: HTMLCanvasElement | null = null;
  private upperCache: HTMLCanvasElement | null = null;
  private lowerSurface: CanvasSurface | null = null;
  private upperSurface: CanvasSurface | null = null;
  private paintVersion = 0;
  private tween: Tween | null = null;
  private hovered: ObjId | null = null;
  private focused: ObjId | null = null;
  private drag: DragSession | null = null;
  private panning: { pointerId: number; lastX: number; lastY: number; axis: 'both' | 'x' | 'y' } | null = null;
  private band: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  private snapIndicator: { x: number; y: number; text: string } | null = null;
  private readonly highlights = new Map<ObjId, number>();
  private pendingEvents: KernelEvent[] = [];
  private sceneEvents: KernelEvent[] = [];
  private dpr = 1;
  private resizeObserver: ResizeObserver | null = null;
  private reducedMotion = false;
  private filmT = 0;
  private cameraProps: SpaceCameraProps = DEFAULT_SPACE_CAMERA;
  private clip: ClipBox = CLIP_OFF;
  private hiddenLines: HiddenLineMode = 'dashed';
  private light: 'on' | 'off' | 'flat' = 'on';
  private readonly budgets: BudgetLimits = DEFAULT_BUDGETS;
  private destroyed = false;
  private camTween: { from: SpaceCameraProps; to: SpaceCameraProps; startMs: number; durMs: number } | null = null;
  private camDrag: { pointerId: number; mode: 'orbit' | 'pan'; lastX: number; lastY: number } | null = null;
  private point3Drag: {
    pointerId: number; id: ObjId;
    plane: { n: V3; c: number } | null;
    axis: { a: V3; e: V3 } | null;
    depth: boolean;
    last: V3;
    lastX: number;
    lastY: number;
  } | null = null;
  private readonly bvhCache = new Map<DrawItem, Bvh>();
  private softwareTarget: Target | null = null;
  private softwareSize = '';

  constructor(opts: FigureViewOptions) {
    this.opts = opts;
    this.theme = opts.theme ?? LIGHT_THEME;
    this.background = { ...this.theme.background };
    this.home = defaultHome(800, 600);
    this.figure3d = new Figure3D(opts.kernel, opts.styles, opts.meshes);
  }

  get id(): string {
    return this.opts.id;
  }

  get mode(): FigureMode {
    return this.opts.mode;
  }

  /* ---------------- mount ---------------- */

  mount(el: HTMLElement): Result<void> {
    if (this.root !== null) return okResult(undefined);
    try {
      this.root = el;
      el.classList.add('incantly-figure');
      el.setAttribute('role', 'application');
      el.tabIndex = 0;
      const w = Math.max(1, el.clientWidth || 800);
      const h = Math.max(1, el.clientHeight || 600);
      this.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const made = viewportFromRegion(this.home, w, h, this.ratioLock, this.dpr);
      if (made.ok) this.view = made.value;
      this.reducedMotion = typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.bgCanvas = document.createElement('canvas');
      this.overlayCanvas = document.createElement('canvas');
      for (const c of [this.bgCanvas, this.overlayCanvas]) {
        c.style.position = 'absolute';
        c.style.inset = '0';
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
        c.width = Math.floor(w * this.dpr);
        c.height = Math.floor(h * this.dpr);
      }
      this.bgCanvas.setAttribute('aria-hidden', 'true');
      this.overlayCanvas.setAttribute('aria-hidden', 'true');
      el.append(this.bgCanvas);
      if (this.opts.mode === '3d') {
        const box = this.opts.shared.acquireBox(this.opts.id, w, h, this.dpr);
        if (box.ok) {
          this.sceneCanvas = box.value.canvas;
          this.sceneCanvas.style.position = 'absolute';
          this.sceneCanvas.style.inset = '0';
          el.append(this.sceneCanvas);
        }
      } else {
        this.sceneCanvas = document.createElement('canvas');
        this.sceneCanvas.style.position = 'absolute';
        this.sceneCanvas.style.inset = '0';
        this.sceneCanvas.style.width = `${w}px`;
        this.sceneCanvas.style.height = `${h}px`;
        this.sceneCanvas.width = Math.floor(w * this.dpr);
        this.sceneCanvas.height = Math.floor(h * this.dpr);
        this.sceneCanvas.setAttribute('aria-hidden', 'true');
        el.append(this.sceneCanvas);
      }
      el.append(this.overlayCanvas);
      const bg2d = this.bgCanvas.getContext('2d');
      const scene2d = this.sceneCanvas?.getContext('2d') ?? null;
      const over2d = this.overlayCanvas.getContext('2d');
      if (bg2d !== null) {
        bg2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.bgSurface = new CanvasSurface(bg2d);
      }
      if (scene2d !== null && this.opts.mode === '2d') {
        scene2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.sceneSurface = new CanvasSurface(scene2d);
      }
      if (over2d !== null) {
        over2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.overlaySurface = new CanvasSurface(over2d);
      }
      // Accessibility nodes: the hidden object list and the live region.
      this.readerList = document.createElement('ul');
      this.readerList.className = 'incantly-sr-only';
      this.readerList.setAttribute('aria-label', 'Figure objects');
      this.liveRegion = document.createElement('div');
      this.liveRegion.className = 'incantly-sr-only';
      this.liveRegion.setAttribute('aria-live', 'polite');
      this.summaryEl = document.createElement('div');
      this.summaryEl.className = 'incantly-sr-only';
      this.summaryEl.id = `incantly-figure-${FigureView.nextSummaryId++}-summary`;
      el.setAttribute('aria-describedby', this.summaryEl.id);
      el.append(this.summaryEl, this.readerList, this.liveRegion);
      this.updateAriaName();

      this.overlayCanvas.addEventListener('pointerdown', this.onPointerDown);
      this.overlayCanvas.addEventListener('pointermove', this.onPointerMove);
      this.overlayCanvas.addEventListener('pointerup', this.onPointerUp);
      this.overlayCanvas.addEventListener('pointercancel', this.onPointerUp);
      this.overlayCanvas.addEventListener('wheel', this.onWheel, { passive: false });
      this.overlayCanvas.addEventListener('dblclick', this.onDoubleClick);
      el.addEventListener('keydown', this.onKeyDown);
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(el);
      }
      this.markCacheInvalid();
      this.requestFrame();
      return okResult(undefined);
    } catch {
      return viewError({
        kind: 'internal',
        messageKey: 'view.internal',
        params: { where: 'figure mount' },
        token: this.opts.id,
      });
    }
  }

  unmount(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.overlayCanvas?.removeEventListener('pointerdown', this.onPointerDown);
    this.overlayCanvas?.removeEventListener('pointermove', this.onPointerMove);
    this.overlayCanvas?.removeEventListener('pointerup', this.onPointerUp);
    this.overlayCanvas?.removeEventListener('pointercancel', this.onPointerUp);
    this.overlayCanvas?.removeEventListener('wheel', this.onWheel);
    this.overlayCanvas?.removeEventListener('dblclick', this.onDoubleClick);
    this.root?.removeEventListener('keydown', this.onKeyDown);
    this.bgCanvas?.remove();
    if (this.opts.mode === '2d') this.sceneCanvas?.remove();
    else this.opts.shared.releaseBox(this.opts.id);
    this.overlayCanvas?.remove();
    this.readerList?.remove();
    this.liveRegion?.remove();
    this.summaryEl?.remove();
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = null;
    this.queuedAnnounce = null;
    this.readerItems.clear();
    this.root = null;
    this.bgCanvas = null;
    this.sceneCanvas = null;
    this.overlayCanvas = null;
    this.figure3d.dispose();
    this.software = null;
  }

  resize(): void {
    if (this.root === null || this.view === null) return;
    const w = Math.max(1, this.root.clientWidth || 1);
    const h = Math.max(1, this.root.clientHeight || 1);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.dpr = dpr;
    // Resize keeps the maths centre and the scales; only the size changes.
    const kept = createViewport({
      widthPx: w,
      heightPx: h,
      centreX: this.view.centreX as number,
      centreY: this.view.centreY as number,
      scaleX: this.view.scaleX,
      scaleY: this.view.scaleY,
      dpr,
    });
    if (kept.ok) this.view = kept.value;
    this.paintVersion++;
    // Rebuild all canvases at the new size (DPR changes rebuild everything).
    for (const c of [this.bgCanvas, this.opts.mode === '2d' ? this.sceneCanvas : null, this.overlayCanvas]) {
      if (c === null || c === undefined) continue;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
    }
    if (this.opts.mode === '3d') this.opts.shared.resizeBox(this.opts.id, w, h, dpr);
    for (const s of [this.bgSurface, this.sceneSurface, this.overlaySurface]) {
      if (s !== null) s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.list.markViewDirtyAll();
    this.markCacheInvalid();
    this.bgDirty = true;
    this.requestFrame();
  }

  /* ---------------- view state ---------------- */

  viewport(): Viewport | null {
    return this.view;
  }

  setViewRegion(region: MathsRect, ratio: 'equal' | 'free' | null, overSeconds: number | null): void {
    if (this.view === null) return;
    if (ratio !== null) this.ratioLock = ratio;
    const made = viewportFromRegion(
      region, this.view.width as number, this.view.height as number,
      this.ratioLock, this.dpr,
    );
    if (!made.ok) return;
    this.home = { ...region };
    if (overSeconds !== null && overSeconds > 0 && !this.reducedMotion) {
      this.tween = { from: this.view, to: made.value, startMs: performance.now(), durMs: overSeconds * 1000 };
    } else {
      this.view = made.value;
      this.list.markViewDirtyAll();
      this.paintVersion++;
      this.markCacheInvalid();
      this.bgDirty = true;
    }
    this.requestFrame();
  }

  goHome(): void {
    if (this.view === null) return;
    const made = viewportFromRegion(
      this.home, this.view.width as number, this.view.height as number,
      this.ratioLock, this.dpr,
    );
    if (!made.ok) return;
    if (this.reducedMotion) {
      this.view = made.value;
      this.list.markViewDirtyAll();
      this.paintVersion++;
      this.markCacheInvalid();
      this.bgDirty = true;
    } else {
      this.tween = { from: this.view, to: made.value, startMs: performance.now(), durMs: 350 };
    }
    this.requestFrame();
  }

  fitAll(): void {
    if (this.view === null) return;
    // Bounds come from the values in maths units, so objects outside the
    // current view (clipped away in pixels) still count (VIEW-SM-16).
    const fit = fitAllRegion(this.objectBoundsMaths());
    if (fit === null) {
      this.goHome();
      return;
    }
    this.setViewRegion(fit, 'equal', 0.35);
  }

  setGrid(grid: GridSpec): void {
    this.grid = grid;
    this.bgDirty = true;
    this.requestFrame();
  }

  setAxes(axes: AxesSpec): void {
    this.axes = axes;
    this.bgDirty = true;
    this.requestFrame();
  }

  setBackground(bg: Rgba | 'transparent'): void {
    this.background = bg;
    this.bgDirty = true;
    this.requestFrame();
  }

  setSnap(snap: SnapMode): void {
    this.snap = snap;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.bgDirty = true;
    this.markCacheInvalid();
    this.list.markViewDirtyAll();
    this.requestFrame();
  }

  setFilmT(t: number): void {
    this.filmT = t;
  }

  setSpaceCamera(props: SpaceCameraProps): void {
    this.cameraProps = props;
    this.requestFrame();
  }

  setClip(clip: ClipBox): void {
    this.clip = clip;
    this.requestFrame();
  }

  /* ---------------- events + frames ---------------- */

  applyEvents(events: readonly KernelEvent[]): void {
    if (events.length === 0) return;
    this.pendingEvents.push(...events);
    this.sceneEvents.push(...events);
    this.paintVersion++;
    this.markCacheInvalid();
    this.requestFrame();
  }

  requestFrame(): void {
    if (this.pending || this.destroyed) return;
    this.pending = true;
    const run = (): void => {
      this.pending = false;
      this.frame();
    };
    if (this.opts.scheduleFrame !== undefined) this.opts.scheduleFrame(run);
    else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }

  private markCacheInvalid(): void {
    this.cacheValid = false;
    this.cacheKey = '';
  }

  private measure: TextMeasure = (text: string, sizePx: number): { width: number; height: number } => {
    const s = this.sceneSurface ?? this.overlaySurface;
    if (s !== null) {
      try {
        const m = s.measure({ text, math: false }, {
          size: sizePx, bold: false, italic: false, family: 'system-ui, sans-serif',
          align: 'left', color: this.theme.stroke, opacity: 1, background: 'none',
        });
        return { width: m.width, height: m.height };
      } catch {
        // Fall through to the estimate.
      }
    }
    return { width: [...text].length * sizePx * 0.6, height: sizePx * 1.2 };
  };

  private frame(): void {
    if (this.destroyed || this.view === null || this.root === null) return;
    if (isDegenerateView(this.view)) return;
    const t0 = performance.now();
    // View tween first: it dirties the viewport each step.
    if (this.tween !== null) {
      const t = Math.min(1, (performance.now() - this.tween.startMs) / Math.max(this.tween.durMs, 1));
      this.view = tweenViewport(this.tween.from, this.tween.to, t);
      this.list.markViewDirtyAll();
      this.paintVersion++;
      this.markCacheInvalid();
      this.bgDirty = true;
      if (t >= 1) this.tween = null;
    }
    // Camera tween (interactive ViewFacing / ViewReset ease over 400 ms).
    if (this.camTween !== null && this.opts.mode === '3d') {
      const t = Math.min(1, (performance.now() - this.camTween.startMs) / Math.max(this.camTween.durMs, 1));
      const e = t * t * (3 - 2 * t);
      const { from, to } = this.camTween;
      const lerpAngle = (a: number, b: number): number => {
        let d = (b - a) % (2 * Math.PI);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        return a + d * e;
      };
      this.cameraProps = {
        ...to,
        azimuth: lerpAngle(from.azimuth, to.azimuth),
        elevation: from.elevation + (to.elevation - from.elevation) * e,
        roll: from.roll + (to.roll - from.roll) * e,
        target: {
          x: from.target.x + (to.target.x - from.target.x) * e,
          y: from.target.y + (to.target.y - from.target.y) * e,
          z: from.target.z + (to.target.z - from.target.z) * e,
        },
        zoom: from.zoom + (to.zoom - from.zoom) * e,
      };
      if (t >= 1) this.camTween = null;
    }
    // Consume kernel events: create drawables at their sort positions.
    for (const e of this.pendingEvents) {
      this.list.applyEvent(e, (id) => this.createDrawable(id));
    }
    this.pendingEvents = [];
    // Update phase.
    const viewRect: PxRect = { x0: px(0), x1: this.view.width, y0: px(0), y1: this.view.height };
    const report = updateDrawables(
      this.list,
      { kernel: this.opts.kernel, styles: this.opts.styles },
      this.view,
      (id, bbox) => this.hits.update(id, bbox),
    );
    void report;
    // Value text + widget rects for the paint below.
    this.refreshDrawableState();
    // Layout phase: labels.
    this.layoutLabels();
    // Paint.
    let painted: number;
    let labels = 0;
    let drawCalls: number;
    let triangles = 0;
    if (this.opts.mode === '2d') {
      this.paintBackground();
      const r = this.paintScene2D(viewRect);
      painted = r.painted;
      labels = r.labels;
      drawCalls = painted;
      this.paintOverlay2D();
    } else {
      const stats = this.paintScene3D();
      drawCalls = stats.drawCalls;
      triangles = stats.triangles;
      painted = this.figure3d.scene.size;
      this.paintOverlay3D();
    }
    this.updateReaderList();
    this.flushAnnounce();
    const frameMs = performance.now() - t0;
    this.resolution.noteFrame(frameMs > 6);
    this.opts.onStats?.({
      frameMs, painted, labels, drawCalls, triangles,
      culled: 0,
    });
    // Keep framing while a tween, highlight or coast is alive.
    if (this.tween !== null || this.camTween !== null || this.highlights.size > 0) this.requestFrame();
  }

  private createDrawable(id: ObjId): GeometryDrawable | null {
    const head = this.opts.kernel.head(id);
    if (head === undefined) return null;
    const value = this.opts.kernel.valueOf(id);
    const valueKind = value.defined ? value.value.k : 'number';
    const kind = kindForType(head.type, valueKind);
    if (kind === null) return null;
    return new GeometryDrawable({
      id,
      name: head.name,
      kind,
      order: head.order,
      layer: 0,
      free: head.free,
      onPath: head.onPath,
      measure: this.measure,
    });
  }

  private refreshDrawableState(): void {
    let widgetRow = 0;
    for (const e of this.list.sorted()) {
      const d = e.drawable;
      if (!(d instanceof GeometryDrawable)) continue;
      if (this.opts.valueText !== undefined) d.setValueText(this.opts.valueText(d.id));
      d.setDetail(this.resolution.level);
      if (d.kind === 'widget') {
        const rect: PxRect = {
          x0: px(12), x1: px(192),
          y0: px(12 + widgetRow * 44), y1: px(40 + widgetRow * 44),
        };
        widgetRow++;
        d.setWidgetRect(rect);
      }
    }
  }

  /**
   * Which labels may paint (performance design 5): only labels whose anchor
   * is inside `rect` count, the lowest priority hide first (selected, focused
   * and dragged labels, then hovered, then points, then the rest in draw
   * order), and at most `limit` stay. `total` is the count before the cut.
   */
  private selectLabels(
    entries: readonly DrawListEntry[],
    rect: PxRect,
    limit: number,
    interactive: boolean,
  ): { shown: Set<ObjId>; total: number } {
    const margin = 80;
    const cands: Array<{ id: ObjId; prio: number; idx: number }> = [];
    for (let i = 0; i < entries.length; i++) {
      const d = entries[i]?.drawable;
      if (!(d instanceof GeometryDrawable) || !d.hasLabel()) continue;
      const a = d.anchor();
      if (a === null) continue;
      const ax = a.x as number;
      const ay = a.y as number;
      if (ax < (rect.x0 as number) - margin || ax > (rect.x1 as number) + margin ||
        ay < (rect.y0 as number) - margin || ay > (rect.y1 as number) + margin) continue;
      let prio = d.kind === 'point' ? 2 : 3;
      if (interactive) {
        if (this.selection.ids.has(d.id) || this.focused === d.id || this.labelOverride.has(d.id)) prio = 0;
        else if (this.hovered === d.id) prio = 1;
      }
      cands.push({ id: d.id, prio, idx: i });
    }
    cands.sort((x, y) => x.prio - y.prio || x.idx - y.idx);
    const shown = new Set<ObjId>();
    for (let i = 0; i < cands.length && i < limit; i++) {
      const c = cands[i];
      if (c !== undefined) shown.add(c.id);
    }
    return { shown, total: cands.length };
  }

  private layoutLabels(): void {
    if (this.view === null) return;
    const w = this.view.width as number;
    const h = this.view.height as number;
    const viewRect: PxRect = { x0: px(0), x1: px(w), y0: px(0), y1: px(h) };
    const { shown, total } = this.selectLabels(this.list.sorted(), viewRect, this.budgets.labelsShown, true);
    this.labelShown = shown;
    const check = checkLabels(total, this.budgets);
    if (check.hidden !== this.lastLabelsHidden) {
      this.lastLabelsHidden = check.hidden;
      if (check.notice !== null) this.opts.onNotice?.(check.notice);
    }
    const inputs: LabelInput[] = [];
    const markers: Array<{ x: number; y: number; r: number }> = [];
    for (const e of this.list.sorted()) {
      const d = e.drawable;
      if (!(d instanceof GeometryDrawable)) continue;
      if (d.kind === 'point' && d.hasLabel()) {
        const a = d.anchor();
        if (a !== null && (a.x as number) > -80 && (a.x as number) < w + 80 && (a.y as number) > -80 && (a.y as number) < h + 80) {
          markers.push({ x: a.x as number, y: a.y as number, r: 4 });
        }
      }
      if (!shown.has(d.id)) {
        d.clearLabelOffset();
        continue;
      }
      const req = d.labelRequest();
      if (req === null) {
        d.clearLabelOffset();
        continue;
      }
      // A user-dragged label offset lives in the style (view pixels); a
      // live drag preview overrides both until pointerup writes the line.
      const authored = this.opts.styles.authoredOf(d.id);
      const udx = authored?.style.labelDx ?? 0;
      const udy = authored?.style.labelDy ?? 0;
      const over = this.labelOverride.get(d.id);
      const user = over !== undefined || udx !== 0 || udy !== 0;
      const prev = this.prevLabelOffsets.get(d.id);
      inputs.push({
        id: d.id,
        anchorX: req.anchor.x as number,
        anchorY: req.anchor.y as number,
        widthPx: req.widthPx,
        heightPx: req.heightPx,
        userDx: over?.dx ?? (user ? udx : null),
        userDy: over?.dy ?? (user ? udy : null),
        prevDx: prev?.dx ?? null,
        prevDy: prev?.dy ?? null,
        prevScore: prev?.score ?? null,
      });
    }
    this.placements = placeLabels(inputs, markers);
    this.prevLabelOffsets.clear();
    for (const p of this.placements) {
      this.prevLabelOffsets.set(p.id, { dx: p.dx, dy: p.dy, score: p.score });
      const entry = this.list.get(p.id);
      const d = entry?.drawable;
      if (d instanceof GeometryDrawable) d.setLabelOffset(p.dx, p.dy);
    }
  }

  /* ---------------- 2D paint ---------------- */

  private paintBackground(): void {
    const s = this.bgSurface;
    const view = this.view;
    if (s === null || view === null || !this.bgDirty) return;
    this.bgDirty = false;
    const w = view.width as number;
    const h = view.height as number;
    const ctx = s.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.background !== 'transparent') {
      ctx.fillStyle = `rgb(${Math.round(this.background.r)},${Math.round(this.background.g)},${Math.round(this.background.b)})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
    if (this.grid.on) this.paintGrid(s, view);
    if (this.axes.which !== 'off') this.paintAxes(s, view);
  }

  private axisUnit(which: 'x' | 'y'): AxisUnit {
    return which === 'x' ? this.axes.unitX : this.axes.unitY;
  }

  private paintGrid(s: Surface, view: Viewport): void {
    const mapper = createMapper(view);
    const bounds = mapper.bounds();
    const stepX = chooseStep(view.scaleX, this.axisUnit('x'), this.gridStepX, this.grid.step);
    const stepY = chooseStep(view.scaleY, this.axisUnit('y'), this.gridStepY, this.grid.step);
    this.gridStepX = stepX.step;
    this.gridStepY = stepY.step;
    const minor = this.grid.kind === 'minor';
    const major = { color: this.theme.gridMajor, width: 1, dash: [], dashPhase: 0, cap: 'butt' as const, join: 'miter' as const, miterLimit: 4, opacity: 1 };
    const sub = { color: this.theme.gridMinor, width: 1, dash: [], dashPhase: 0, cap: 'butt' as const, join: 'miter' as const, miterLimit: 4, opacity: 1 };
    if (this.grid.kind === 'polar') {
      const g = polarGrid(bounds, stepX.step, this.grid.polarSpokesDeg);
      const c = mapper.toPx({ x: maths(0), y: maths(0) });
      const cx = c.x as number;
      const cy = c.y as number;
      for (const r of g.circles) {
        const rp = r * view.scaleX;
        // Only the arc that can show inside the view is stroked, so a circle
        // far from the origin costs the same as a near one (VIEW-SM-5).
        const arc = visibleArc(cx, cy, rp, view.width as number, view.height as number);
        if (arc === null) continue;
        const sweep = arc.a1 - arc.a0;
        const segs = Math.min(256, Math.max(8, Math.ceil((sweep / (2 * Math.PI)) * Math.max(24, rp / 2))));
        const run = new Float32Array((segs + 1) * 2);
        for (let i = 0; i <= segs; i++) {
          const a = arc.a0 + (i / segs) * sweep;
          run[i * 2] = cx + rp * Math.cos(a);
          run[i * 2 + 1] = cy - rp * Math.sin(a);
        }
        s.path(run);
        s.stroke(major);
      }
      const diag = Math.hypot(view.width as number, view.height as number);
      for (const a of g.spokes) {
        s.path(new Float32Array([cx, cy, cx + diag * Math.cos(a), cy - diag * Math.sin(a)]));
        s.stroke(major);
      }
      return;
    }
    if (this.grid.kind === 'iso') {
      const g = isoGrid(bounds, stepX.step);
      void g;
      // Isometric lines at 0/60/120 degrees through the view centre.
      const c = mapper.toPx({ x: maths(0), y: maths(0) });
      const cx = c.x as number;
      const cy = c.y as number;
      const diag = Math.hypot(view.width as number, view.height as number);
      const step = stepX.step * view.scaleX;
      // Lines closer than 4 px or more than 1,500 a side are not drawn (VIEW-SM-5).
      if (!(step >= GRID_MIN_FIXED_PX) || !Number.isFinite(step)) return;
      const kMax = Math.min(MAX_ISO_LINES_PER_SIDE, Math.ceil(diag / step));
      for (let k = -kMax; k <= kMax; k++) {
        for (const deg of [0, 60, 120]) {
          const a = (deg * Math.PI) / 180;
          const nx = -Math.sin(a);
          const ny = Math.cos(a);
          const ox = cx + nx * k * step;
          const oy = cy + ny * k * step;
          s.path(new Float32Array([
            ox - Math.cos(a) * diag, oy - Math.sin(a) * diag,
            ox + Math.cos(a) * diag, oy + Math.sin(a) * diag,
          ]));
          s.stroke(major);
        }
      }
      return;
    }
    const g = cartesianGrid(bounds, stepX, stepY, minor);
    const x0 = 0;
    const x1 = view.width as number;
    const y0 = 0;
    const y1 = view.height as number;
    if (minor) {
      for (const x of g.minorVertical) {
        const p = mapper.toPx({ x: maths(x), y: maths(0) });
        s.path(new Float32Array([p.x as number, y0, p.x as number, y1]));
        s.stroke(sub);
      }
      for (const y of g.minorHorizontal) {
        const p = mapper.toPx({ x: maths(0), y: maths(y) });
        s.path(new Float32Array([x0, p.y as number, x1, p.y as number]));
        s.stroke(sub);
      }
    }
    for (const x of g.vertical) {
      const p = mapper.toPx({ x: maths(x), y: maths(0) });
      s.path(new Float32Array([p.x as number, y0, p.x as number, y1]));
      s.stroke(major);
    }
    for (const y of g.horizontal) {
      const p = mapper.toPx({ x: maths(0), y: maths(y) });
      s.path(new Float32Array([x0, p.y as number, x1, p.y as number]));
      s.stroke(major);
    }
  }

  private paintAxes(s: Surface, view: Viewport): void {
    const mapper = createMapper(view);
    const bounds = mapper.bounds();
    const o = mapper.toPx({ x: maths(0), y: maths(0) });
    const ox = o.x as number;
    const oy = o.y as number;
    const w = view.width as number;
    const h = view.height as number;
    const st = { color: this.theme.axes, width: 1.5, dash: [], dashPhase: 0, cap: 'butt' as const, join: 'miter' as const, miterLimit: 4, opacity: 1 };
    const showX = this.axes.which === 'on' || this.axes.which === 'x';
    const showY = this.axes.which === 'on' || this.axes.which === 'y';
    if (showX && oy >= 0 && oy <= h) {
      s.path(new Float32Array([0, oy, w, oy]));
      s.stroke(st);
    }
    if (showY && ox >= 0 && ox <= w) {
      s.path(new Float32Array([ox, 0, ox, h]));
      s.stroke(st);
    }
    if (!this.axes.labels) return;
    const stepX = this.gridStepX ?? chooseStep(view.scaleX, this.axisUnit('x'), null, this.grid.step).step;
    const stepY = this.gridStepY ?? chooseStep(view.scaleY, this.axisUnit('y'), null, this.grid.step).step;
    const labels = axisLabels(bounds, stepX, stepY, this.axisUnit('x'), this.axisUnit('y'));
    const tstyle = {
      size: 14, bold: false, italic: false, family: 'system-ui, sans-serif',
      align: 'center' as const, color: this.theme.axes, opacity: 1, background: 'none' as const,
    };
    const drawRow = (items: readonly { at: number; text: string }[], horizontal: boolean): void => {
      const measured = items.map((l) => {
        const m = this.measure(l.text, 14);
        const p = horizontal
          ? mapper.toPx({ x: maths(l.at), y: bounds.y0 })
          : mapper.toPx({ x: bounds.x0, y: maths(l.at) });
        return { at: (horizontal ? p.x : p.y) as number, text: l.text, widthPx: m.width };
      }).filter((l) => l.at >= -40 && l.at <= (horizontal ? w : h) + 40)
        .sort((a, b) => a.at - b.at);
      for (const l of thinLabels(measured)) {
        if (horizontal) {
          const pinned = pinToEdge(oy + 16, h, 16);
          s.text({ text: l.text, math: false }, { x: px(l.at), y: px(pinned.pos) }, tstyle);
        } else {
          const pinned = pinToEdge(ox - 8, w, 30);
          s.text({ text: l.text, math: false }, { x: px(pinned.pos), y: px(l.at) }, { ...tstyle, align: 'right' });
        }
      }
    };
    if (showX) drawRow(labels.x, true);
    if (showY) drawRow(labels.y, false);
  }

  private paintEntries(entries: readonly DrawListEntry[], s: Surface, ctx: PaintContext, viewRect: PxRect): { painted: number; labels: number } {
    // Same layer/text-pass order as paintDrawables, over a subset (7.4).
    let painted = 0;
    let labels = 0;
    let i = 0;
    while (i < entries.length) {
      const layer = entries[i]?.drawable.sortKey.layer ?? 0;
      let j = i;
      while (j < entries.length && (entries[j]?.drawable.sortKey.layer ?? -1) === layer) j++;
      for (let k = i; k < j; k++) {
        const d = entries[k]?.drawable;
        if (d === undefined || d.bbox === null) {
          if (d !== undefined && d.kind !== 'particles') continue;
          if (d === undefined) continue;
        }
        const b = (d as { bbox: PxRect | null }).bbox;
        if (b !== null) {
          const inside = (b.x0 as number) <= (viewRect.x1 as number) && (b.x1 as number) >= (viewRect.x0 as number) &&
            (b.y0 as number) <= (viewRect.y1 as number) && (b.y1 as number) >= (viewRect.y0 as number);
          if (!inside) continue;
        }
        d.paint(s, ctx);
        painted++;
      }
      for (let k = i; k < j; k++) {
        const d = entries[k]?.drawable;
        if (d === undefined || !this.labelShown.has(d.id)) continue;
        d.paintLabel(s, ctx);
        labels++;
      }
      i = j;
    }
    return { painted, labels };
  }

  private paintScene2D(viewRect: PxRect): { painted: number; labels: number } {
    const s = this.sceneSurface;
    const view = this.view;
    if (s === null || view === null) return { painted: 0, labels: 0 };
    const ctx: PaintContext = {
      view,
      theme: this.theme,
      selected: this.selection.ids,
      hovered: this.hovered,
      focused: this.focused,
      reducedMotion: this.reducedMotion,
      t: this.filmT,
    };
    const c2d = s.ctx;
    c2d.save();
    c2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c2d.clearRect(0, 0, view.width as number, view.height as number);
    c2d.restore();
    const active = new Set<ObjId>([...this.list.activeIds(), ...this.highlights.keys()]);
    if (this.drag !== null && this.drag.plan.kind !== 'none') {
      for (const m of this.drag.plan.moves) active.add(m.id);
    }
    const split = active.size > 0 ? splitForActive(this.list, active) : null;
    if (split === null) {
      const r = this.paintEntries(this.list.sorted(), s, ctx, viewRect);
      this.paintWidgets(s, ctx);
      return r;
    }
    // Partial repaint (7.4): lower/upper paint once to bitmaps, middle live.
    const key = `${this.paintVersion}:${[...active].sort((a, b) => a - b).join(',')}`;
    this.ensureCacheCanvases();
    if (this.cacheValid && key === this.cacheKey && this.lowerCache !== null && this.upperCache !== null &&
      this.lowerSurface !== null && this.upperSurface !== null) {
      const c2d = s.ctx;
      c2d.drawImage(this.lowerCache, 0, 0, view.width as number, view.height as number);
      const r = this.paintEntries(split.middle, s, ctx, viewRect);
      c2d.drawImage(this.upperCache, 0, 0, view.width as number, view.height as number);
      this.paintWidgets(s, ctx);
      return r;
    }
    if (this.lowerSurface !== null && this.upperSurface !== null) {
      this.clearCacheCanvas(this.lowerCache);
      this.clearCacheCanvas(this.upperCache);
      this.paintEntries(split.lower, this.lowerSurface, ctx, viewRect);
      const r = this.paintEntries(split.middle, s, ctx, viewRect);
      this.paintEntries(split.upper, this.upperSurface, ctx, viewRect);
      const c2d = s.ctx;
      // Composite: lower under, upper over.
      const scene = this.sceneCanvas;
      if (scene !== null && this.lowerCache !== null && this.upperCache !== null) {
        const live = document.createElement('canvas');
        live.width = scene.width;
        live.height = scene.height;
        const g = live.getContext('2d');
        if (g !== null) {
          g.drawImage(scene, 0, 0);
          c2d.save();
          c2d.setTransform(1, 0, 0, 1, 0, 0);
          c2d.clearRect(0, 0, scene.width, scene.height);
          c2d.drawImage(this.lowerCache, 0, 0);
          c2d.drawImage(live, 0, 0);
          c2d.drawImage(this.upperCache, 0, 0);
          c2d.restore();
          c2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
      }
      this.cacheValid = true;
      this.cacheKey = key;
      this.paintWidgets(s, ctx);
      return r;
    }
    const r = this.paintEntries(this.list.sorted(), s, ctx, viewRect);
    this.paintWidgets(s, ctx);
    return r;
  }

  private ensureCacheCanvases(): void {
    if (this.view === null || this.sceneCanvas === null) return;
    for (const which of ['lower', 'upper'] as const) {
      const cur = which === 'lower' ? this.lowerCache : this.upperCache;
      if (cur !== null && cur.width === this.sceneCanvas.width && cur.height === this.sceneCanvas.height) continue;
      const c = document.createElement('canvas');
      c.width = this.sceneCanvas.width;
      c.height = this.sceneCanvas.height;
      const g = c.getContext('2d');
      if (g === null) continue;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (which === 'lower') {
        this.lowerCache = c;
        this.lowerSurface = new CanvasSurface(g);
      } else {
        this.upperCache = c;
        this.upperSurface = new CanvasSurface(g);
      }
    }
  }

  private clearCacheCanvas(c: HTMLCanvasElement | null): void {
    if (c === null || this.view === null) return;
    const g = c.getContext('2d');
    if (g === null) return;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.restore();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Sliders and checkboxes paint as canvas shapes from their widget rects. */
  private paintWidgets(s: Surface, _ctx: PaintContext): void {
    for (const e of this.list.sorted()) {
      const d = e.drawable;
      if (!(d instanceof GeometryDrawable) || d.kind !== 'widget') continue;
      const value = this.opts.kernel.valueOf(d.id);
      if (!value.defined) continue;
      const v = value.value;
      if (v.k === 'slider') {
        this.paintSlider(s, d, v.v, v.lo, v.hi);
      } else if (v.k === 'bool') {
        this.paintCheckbox(s, d, v.v);
      }
    }
  }

  private widgetRectOf(d: GeometryDrawable): PxRect | null {
    return d.bbox;
  }

  private paintSlider(s: Surface, d: GeometryDrawable, v: number, lo: number, hi: number): void {
    const r = this.widgetRectOf(d);
    if (r === null) return;
    const x0 = r.x0 as number;
    const x1 = r.x1 as number;
    const midY = ((r.y0 as number) + (r.y1 as number)) / 2;
    const f = hi > lo ? (v - lo) / (hi - lo) : 0;
    const tx = x0 + f * (x1 - x0);
    s.path(new Float32Array([x0, midY, x1, midY]));
    s.stroke({ color: this.theme.axes, width: 4, dash: [], dashPhase: 0, cap: 'round', join: 'round', miterLimit: 4, opacity: 1 });
    s.path(new Float32Array([tx - 7, midY - 9, tx - 7, midY + 9, tx + 7, midY + 9, tx + 7, midY - 9, tx - 7, midY - 9]));
    s.fill({ kind: 'solid', color: this.theme.freePoint, opacity: 1 });
    const head = this.opts.kernel.head(d.id);
    s.text({ text: `${head?.name ?? ''} = ${this.opts.valueText?.(d.id) ?? String(v)}`, math: false },
      { x: px(x0), y: px((r.y0 as number) - 4) },
      { size: 12, bold: false, italic: false, family: 'system-ui, sans-serif', align: 'left', color: this.theme.axes, opacity: 1, background: 'none' });
  }

  private paintCheckbox(s: Surface, d: GeometryDrawable, v: boolean): void {
    const r = this.widgetRectOf(d);
    if (r === null) return;
    const x = r.x0 as number;
    const y = r.y0 as number;
    s.path(new Float32Array([x, y, x + 16, y, x + 16, y + 16, x, y + 16, x, y]));
    s.stroke({ color: this.theme.axes, width: 1.5, dash: [], dashPhase: 0, cap: 'butt', join: 'miter', miterLimit: 4, opacity: 1 });
    if (v) {
      s.path(new Float32Array([x + 3, y + 8, x + 7, y + 12, x + 13, y + 4]));
      s.stroke({ color: this.theme.freePoint, width: 2, dash: [], dashPhase: 0, cap: 'round', join: 'round', miterLimit: 4, opacity: 1 });
    }
    const head = this.opts.kernel.head(d.id);
    s.text({ text: head?.name ?? '', math: false }, { x: px(x + 20), y: px(y + 13) },
      { size: 13, bold: false, italic: false, family: 'system-ui, sans-serif', align: 'left', color: this.theme.stroke, opacity: 1, background: 'none' });
  }

  private paintOverlay2D(): void {
    const s = this.overlaySurface;
    const view = this.view;
    if (s === null || view === null) return;
    const c2d = s.ctx;
    c2d.save();
    c2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c2d.clearRect(0, 0, view.width as number, view.height as number);
    c2d.restore();
    const byId = new Map<ObjId, DrawListEntry>();
    for (const e of this.list.sorted()) byId.set(e.drawable.id, e);
    if (this.hovered !== null) byId.get(this.hovered)?.drawable.outline(s, 'hover');
    for (const id of this.selection.ids) byId.get(id)?.drawable.outline(s, 'selected');
    if (this.focused !== null) byId.get(this.focused)?.drawable.outline(s, 'focus');
    const now = performance.now();
    for (const [id, until] of this.highlights) {
      if (now > until) {
        this.highlights.delete(id);
        continue;
      }
      byId.get(id)?.drawable.outline(s, 'pulse');
    }
    if (this.snapIndicator !== null) {
      const p = this.snapIndicator;
      s.path(new Float32Array([p.x - 8, p.y, p.x, p.y - 8, p.x + 8, p.y, p.x, p.y + 8, p.x - 8, p.y]));
      s.stroke({ color: this.theme.freePoint, width: 1.5, dash: [], dashPhase: 0, cap: 'round', join: 'round', miterLimit: 4, opacity: 1 });
      s.text({ text: p.text, math: false }, { x: px(p.x + 10), y: px(p.y - 10) },
        { size: 12, bold: false, italic: false, family: 'system-ui, sans-serif', align: 'left', color: this.theme.stroke, opacity: 1, background: this.theme.background });
    }
    if (this.band !== null) {
      const b = this.band;
      s.path(new Float32Array([b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1, b.x0, b.y0]));
      s.stroke({ color: this.theme.freePoint, width: 1, dash: [4, 3], dashPhase: 0, cap: 'butt', join: 'miter', miterLimit: 4, opacity: 0.9 });
    }
  }

  /* ---------------- 2D input ---------------- */

  private eventPos(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.overlayCanvas?.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private pointerKindOf(e: PointerEvent): PointerKind {
    if (e.pointerType === 'touch') return 'touch';
    if (e.pointerType === 'pen') return 'pen';
    return 'mouse';
  }

  /** Hit test at a view pixel, ranked best-first (design 10). */
  hitTest(x: number, y: number, pointer: PointerKind): HitList {
    const at: PxPoint = { x: px(x), y: px(y) };
    const slack = slackFor(pointer, 'edge', 4);
    const ids = this.hits.query(at, Math.max(slack, 16));
    const rankOf = new Map<ObjId, number>();
    this.list.sorted().forEach((e, i) => rankOf.set(e.drawable.id, i));
    const cands: HitCandidate[] = [];
    for (const id of ids) {
      const d = this.list.get(id)?.drawable;
      if (d === undefined) continue;
      const hit = d.hit(at, d.kind === 'point' ? slackFor(pointer, 'point', 4) : slack);
      if (hit !== null) cands.push(hit);
    }
    // Labels hit first (priority 0): test the placed label rects.
    for (const p of this.placements) {
      const anchor = this.labelAnchorOf(p.id);
      if (anchor === null) continue;
      const rx0 = anchor.x + p.dx;
      const ry0 = anchor.y + p.dy;
      const entry = this.list.get(p.id)?.drawable;
      const size = entry instanceof GeometryDrawable ? entry.labelRequest() : null;
      const w = size?.widthPx ?? 40;
      const h = size?.heightPx ?? 16;
      if (x >= rx0 - 2 && x <= rx0 + w + 2 && y >= ry0 - 2 && y <= ry0 + h + 2) {
        cands.push({ id: p.id, part: 'label', distance: 0, priority: 0 });
      }
    }
    return { at, candidates: rankCandidates(cands, (id) => rankOf.get(id) ?? 0) };
  }

  private labelAnchorOf(id: ObjId): { x: number; y: number } | null {
    const d = this.list.get(id)?.drawable;
    if (!(d instanceof GeometryDrawable)) return null;
    const a = d.anchor();
    return a === null ? null : { x: a.x as number, y: a.y as number };
  }

  private dragFactsFor(id: ObjId, isLabel: boolean): DragFacts {
    const head = this.opts.kernel.head(id);
    const authored = this.opts.styles.authoredOf(id);
    const value = this.opts.kernel.valueOf(id);
    const parents = this.opts.kernel.freeParentsOf(id);
    const isSlider = value.defined && value.value.k === 'slider';
    return {
      free: head?.free ?? false,
      onPath: head?.onPath ?? false,
      pathDefined: head !== undefined && head.onPath ? this.opts.kernel.pathOf(id) !== undefined : true,
      isSlider,
      isLabel,
      fixed: authored?.style.fixed ?? false,
      movableParents: parents,
      blockedReason: 'built from other objects',
    };
  }

  private snapContext(exclude: ObjId | null): SnapContext {
    const view = this.view;
    const scaleX = view?.scaleX ?? 80;
    const scaleY = view?.scaleY ?? 80;
    const points: Array<{ id: ObjId; x: number; y: number }> = [];
    if (view !== null) {
      const mapper = createMapper(view);
      for (const e of this.list.sorted()) {
        if (e.drawable.kind !== 'point' || e.drawable.id === exclude) continue;
        const b = e.drawable.bbox;
        if (b === null) continue;
        const cx = ((b.x0 as number) + (b.x1 as number)) / 2;
        const cy = ((b.y0 as number) + (b.y1 as number)) / 2;
        const m = mapper.toMaths({ x: px(cx), y: px(cy) });
        points.push({ id: e.drawable.id, x: m.x as number, y: m.y as number });
      }
    }
    return {
      mode: this.snap,
      gridVisible: this.grid.on,
      stepX: this.gridStepX,
      stepY: this.gridStepY,
      metric: { scaleX, scaleY },
      snapRadiusPx: 12,
      points,
      intersections: [],
    };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.view === null || this.overlayCanvas === null) return;
    this.opts.onInteract?.();
    const pos = this.eventPos(e);
    this.pointers.set(e.pointerId, pos);
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const a = pts[0];
      const b = pts[1];
      if (a !== undefined && b !== undefined) {
        this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      }
      this.drag = null;
      this.panning = null;
      return;
    }
    if (this.opts.mode === '3d') {
      this.onPointerDown3D(e, pos);
      return;
    }
    const kind = this.pointerKindOf(e);
    const hits = this.hitTest(pos.x, pos.y, kind);
    // Shift-drag on the background starts a rubber band (design 11).
    if (hits.candidates.length === 0 && e.shiftKey) {
      this.band = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
      this.overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
    const cycled = cyclePick(this.cycle, hits.candidates, pos.x, pos.y, performance.now());
    if (cycled !== null) this.cycle = cycled.state;
    const top = cycled?.candidate ?? null;
    // Click selection (the drag may still start on move).
    if (top !== null) {
      this.selection = clickSelect(this.selection, top.id, e.shiftKey || e.ctrlKey || e.metaKey,
        (id) => this.opts.styles.authoredOf(id)?.style.selectable !== false);
      if (cycled !== null && cycled.total > 1) {
        const names = hits.candidates.map((c) => this.opts.kernel.head(c.id)?.name ?? '?');
        this.opts.onGesture?.('cycle', cycleTooltip(cycled, names));
      }
      this.requestFrame();
    } else if (!e.shiftKey) {
      this.selection = clickSelect(this.selection, null, false, () => true);
      this.requestFrame();
    }
    // Axis rescale: drag within 12 px of an axis rescales it (design 4).
    const axis = this.axisNear(pos.x, pos.y);
    if (top === null && axis !== 'both') {
      this.panning = { pointerId: e.pointerId, lastX: pos.x, lastY: pos.y, axis };
      this.overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
    if (top === null) {
      this.panning = { pointerId: e.pointerId, lastX: pos.x, lastY: pos.y, axis: 'both' };
      this.overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
    const plan = computeDragPlan(top.id, this.dragFactsFor(top.id, top.part === 'label'));
    if (plan.kind === 'none' && top.part !== 'label') {
      const name = this.opts.kernel.head(top.id)?.name ?? '?';
      if (plan.reason === 'fixed') this.opts.onGesture?.('drag_fixed', `${name} is fixed.`);
      else if (plan.reason === 'path_undefined') this.opts.onGesture?.('drag_path_undefined', `${name} is on a path that has no value right now.`);
      else this.opts.onGesture?.('drag_blocked', `${name} can't be moved: ${plan.reason ?? 'built from other objects'}.`);
      this.panning = { pointerId: e.pointerId, lastX: pos.x, lastY: pos.y, axis: 'both' };
      this.overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
    const mapper = createMapper(this.view);
    const m = mapper.toMaths({ x: px(pos.x), y: px(pos.y) });
    const value = this.opts.kernel.valueOf(top.id);
    let grabOffset = { dx: 0, dy: 0 };
    const hintS: number | null = null;
    if (value.defined && value.value.k === 'point') {
      grabOffset = { dx: (m.x as number) - value.value.x, dy: (m.y as number) - value.value.y };
    }
    this.drag = {
      pointerId: e.pointerId, plan, startX: pos.x, startY: pos.y, started: false,
      grabOffset, hintS, lastX: pos.x, lastY: pos.y, kind,
      targetName: this.opts.kernel.head(top.id)?.name ?? '?',
      labelId: top.part === 'label' ? top.id : null,
    };
    this.overlayCanvas.setPointerCapture(e.pointerId);
  };

  private axisNear(x: number, y: number): 'both' | 'x' | 'y' {
    if (this.view === null || this.axes.which === 'off') return 'both';
    const mapper = createMapper(this.view);
    const o = mapper.toPx({ x: maths(0), y: maths(0) });
    const showX = this.axes.which === 'on' || this.axes.which === 'x';
    const showY = this.axes.which === 'on' || this.axes.which === 'y';
    if (showX && Math.abs(y - (o.y as number)) <= 12) return 'x';
    if (showY && Math.abs(x - (o.x as number)) <= 12) return 'y';
    return 'both';
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.view === null) return;
    const pos = this.eventPos(e);
    this.pointers.set(e.pointerId, pos);
    // Pinch: zoom about the midpoint, pan with its drag.
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const a = pts[0];
      const b = pts[1];
      if (a !== undefined && b !== undefined && this.pinchStart > 0) {
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: px((a.x + b.x) / 2), y: px((a.y + b.y) / 2) };
        const k = dist / this.pinchStart;
        this.pinchStart = dist;
        if (Number.isFinite(k) && k > 0 && Math.abs(k - 1) > 0.001) {
          const r = zoomAbout(this.view, mid, k);
          if (r.refused === undefined) {
            this.view = r.viewport;
            this.list.markViewDirtyAll();
            this.paintVersion++;
            this.markCacheInvalid();
            this.bgDirty = true;
            this.requestFrame();
          }
        }
      }
      return;
    }
    if (this.opts.mode === '3d') {
      this.onPointerMove3D(e, pos);
      return;
    }
    if (this.band !== null) {
      this.band = { ...this.band, x1: pos.x, y1: pos.y };
      this.requestFrame();
      return;
    }
    if (this.panning !== null && this.panning.pointerId === e.pointerId) {
      const dx = pos.x - this.panning.lastX;
      const dy = pos.y - this.panning.lastY;
      this.panning = { ...this.panning, lastX: pos.x, lastY: pos.y };
      if (this.panning.axis === 'both') {
        this.view = panBy(this.view, dx, dy);
        this.list.markPanDirty(dx, dy);
      } else {
        this.rescaleAxis(this.panning.axis, dx, dy, pos);
      }
      this.paintVersion++;
      this.markCacheInvalid();
      this.bgDirty = true;
      this.requestFrame();
      return;
    }
    if (this.drag !== null && this.drag.pointerId === e.pointerId) {
      const threshold = this.drag.kind === 'touch' ? 8 : 3;
      if (!this.drag.started && Math.hypot(pos.x - this.drag.startX, pos.y - this.drag.startY) < threshold) return;
      this.drag.started = true;
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      const last = coalesced[coalesced.length - 1] ?? e;
      const lp = this.eventPos(last);
      this.drag.lastX = lp.x;
      this.drag.lastY = lp.y;
      this.applyDragMove(lp.x, lp.y, e);
      return;
    }
    // Hover (mouse only): halo + cursor.
    if (this.pointerKindOf(e) === 'mouse') {
      const hits = this.hitTest(pos.x, pos.y, HOVER_SLACK);
      const top = hits.candidates[0] ?? null;
      const id = top?.id ?? null;
      if (id !== this.hovered) {
        this.hovered = id;
        if (this.overlayCanvas !== null) {
          if (id === null) this.overlayCanvas.style.cursor = 'default';
          else {
            const plan = computeDragPlan(id, this.dragFactsFor(id, false));
            this.overlayCanvas.style.cursor = plan.kind === 'none' ? 'pointer' : 'grab';
          }
        }
        this.requestFrame();
      }
    }
  };

  private rescaleAxis(axis: 'x' | 'y', dx: number, dy: number, pos: { x: number; y: number }): void {
    if (this.view === null) return;
    // Drag on an axis rescales it only and frees the ratio lock (design 4).
    this.ratioLock = 'free';
    const factor = axis === 'x' ? 1 + dx / 200 : 1 - dy / 200;
    if (!(factor > 0.2) || !Number.isFinite(factor)) return;
    const mapper = createMapper(this.view);
    const m = mapper.toMaths({ x: px(pos.x), y: px(pos.y) });
    const scaleX = axis === 'x' ? this.view.scaleX * factor : this.view.scaleX;
    const scaleY = axis === 'y' ? this.view.scaleY * factor : this.view.scaleY;
    const w = this.view.width as number;
    const h = this.view.height as number;
    const ncx = (m.x as number) - ((pos.x - w / 2) / scaleX);
    const ncy = (m.y as number) + ((pos.y - h / 2) / scaleY);
    const kept = createViewport({
      widthPx: w, heightPx: h, centreX: ncx, centreY: ncy, scaleX, scaleY, dpr: this.dpr,
    });
    if (kept.ok) {
      this.view = kept.value;
      this.list.markViewDirtyAll();
    }
  }

  private applyDragMove(x: number, y: number, e: PointerEvent): void {
    const drag = this.drag;
    const view = this.view;
    if (drag === null || view === null) return;
    const mapper = createMapper(view);
    const noSnap = e.altKey;
    if (drag.plan.kind === 'label') {
      // Label drags preview a transient offset; the sdk writes one `with`
      // line on pointerup (see onRestyle).
      const id = drag.labelId;
      if (id === null) return;
      const base = this.prevLabelOffsets.get(id) ?? { dx: 6, dy: -6, score: 0 };
      this.labelOverride.set(id, {
        dx: Math.round(base.dx + (x - drag.startX)),
        dy: Math.round(base.dy + (y - drag.startY)),
      });
      this.requestFrame();
      return;
    }
    if (drag.plan.kind === 'free' || drag.plan.kind === 'parents') {
      let m = mapper.toMaths({ x: px(x), y: px(y) });
      if (e.shiftKey) {
        const start = mapper.toMaths({ x: px(drag.startX), y: px(drag.startY) });
        m = limitAngle(start, m, 15);
      }
      let target = freePointTarget(m, drag.grabOffset);
      if (!noSnap) {
        const snapped = snapWithHysteresis(target, this.snapContext(drag.plan.moves[0]?.id ?? null), this.snapMem);
        target = snapped.position;
        const sp = mapper.toPx(target);
        this.snapIndicator = snapped.source.k === 'none' ? null : {
          x: sp.x as number,
          y: sp.y as number,
          text: snapped.source.k === 'grid' ? 'grid' : snapped.source.k === 'point' ? `on ${this.opts.kernel.head(snapped.source.id)?.name ?? ''}` : 'crossing',
        };
      } else {
        this.snapIndicator = null;
      }
      const moves: DragMove[] = [];
      if (drag.plan.kind === 'free') {
        const id = drag.plan.moves[0]?.id;
        if (id !== undefined) moves.push({ k: 'point', id, x: target.x as number, y: target.y as number });
      } else {
        // Parents move by the pointer delta in maths units (design 12.5).
        const startM = mapper.toMaths({ x: px(drag.startX), y: px(drag.startY) });
        const dx = (target.x as number) - (startM.x as number);
        const dy = (target.y as number) - (startM.y as number);
        for (const ref of drag.plan.moves) {
          const v = this.opts.kernel.valueOf(ref.id);
          if (v.defined && v.value.k === 'point') {
            moves.push({ k: 'point', id: ref.id, x: v.value.x + dx, y: v.value.y + dy });
          }
        }
      }
      try {
        this.opts.drag.drag(moves);
      } catch {
        // A drag that throws is dropped; the next move retries.
      }
      this.requestFrame();
      return;
    }
    if (drag.plan.kind === 'path') {
      const id = drag.plan.moves[0]?.id;
      if (id === undefined) return;
      const info = this.opts.kernel.pathOf(id);
      if (info === undefined) return;
      const m = mapper.toMaths({ x: px(x), y: px(y) });
      const metric = { scaleX: view.scaleX, scaleY: view.scaleY };
      const proj = this.projectOnPath(info, m, metric, drag.hintS ?? null);
      let s = proj.s;
      if (!noSnap && (this.snap === 'grid' || this.snap === 'grid+points' || (this.snap === 'auto' && this.grid.on))) {
        const along = info.kind === 'samples'
          ? snapParamToGrid(info.pts, this.gridStepX ?? 1, this.gridStepY ?? 1, metric, 12)
          : null;
        if (along !== null) s = along.s;
      }
      s = clampParam(s, info.domain, info.closed);
      try {
        this.opts.drag.drag([{ k: 'param', id, s }]);
      } catch {
        // Dropped; the next move retries.
      }
      this.requestFrame();
      return;
    }
    if (drag.plan.kind === 'slider') {
      const id = drag.plan.moves[0]?.id;
      if (id === undefined) return;
      const entry = this.list.get(id)?.drawable;
      const bbox = entry?.bbox ?? null;
      const value = this.opts.kernel.valueOf(id);
      if (bbox === null || !value.defined || value.value.k !== 'slider') return;
      const v = sliderTarget(x, bbox.x0 as number, bbox.x1 as number, value.value.lo, value.value.hi, value.value.step);
      try {
        this.opts.drag.drag([{ k: 'number', id, v }]);
      } catch {
        // Dropped; the next move retries.
      }
      this.requestFrame();
    }
  }

  private projectOnPath(
    info: { kind: 'segment' | 'line' | 'ray' | 'circle' | 'arc' | 'polygon' | 'samples'; pts: Float64Array; closed: boolean; domain: { lo: number; hi: number } },
    m: { x: number; y: number },
    metric: { scaleX: number; scaleY: number },
    hint: number | null,
  ): { s: number } {
    const p = { x: m.x as never, y: m.y as never };
    const pts = info.pts;
    switch (info.kind) {
      case 'segment':
        return projectSegment(pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 0, pts[3] ?? 0, p);
      case 'line':
        return projectLine(pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 1, pts[3] ?? 0, p);
      case 'ray':
        return projectRay(pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 1, pts[3] ?? 0, p);
      case 'circle':
        return projectCircle(pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 1, p);
      case 'arc':
        return projectArc(pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 1, pts[3] ?? 0, pts[4] ?? 0, p);
      case 'polygon':
        return projectPolygon(pts, p);
      case 'samples': {
        const r = projectOnSamples(pts, p, metric, hint, info.closed, 0);
        if (info.closed && hint !== null) {
          const wrapped = hint + wrapDelta(hint, r.s, info.domain);
          return { s: wrapped };
        }
        return r;
      }
    }
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = 0;
    if (this.band !== null && this.view !== null) {
      const b = this.band;
      this.band = null;
      const band: PxRect = {
        x0: px(Math.min(b.x0, b.x1)), x1: px(Math.max(b.x0, b.x1)),
        y0: px(Math.min(b.y0, b.y1)), y1: px(Math.max(b.y0, b.y1)),
      };
      const shapes: RubberBandShape[] = [];
      for (const entry of this.list.sorted()) {
        const d = entry.drawable;
        if (d instanceof GeometryDrawable) {
          const shape = d.rubberShape();
          if (shape !== null) shapes.push({ id: d.id, strokes: shape.strokes, fills: shape.fills });
        }
      }
      const found = rubberBandSelect(shapes, band,
        (id) => this.opts.styles.authoredOf(id)?.style.selectable !== false);
      const next = new Set(this.selection.ids);
      for (const id of found) next.add(id);
      this.selection = { ids: next, anchor: this.selection.anchor, focus: this.selection.focus };
      this.requestFrame();
      return;
    }
    if (this.panning !== null && this.panning.pointerId === e.pointerId) {
      this.panning = null;
      return;
    }
    const drag = this.drag;
    if (drag !== null && drag.pointerId === e.pointerId) {
      this.drag = null;
      this.snapIndicator = null;
      if (drag.plan.kind === 'label' && drag.labelId !== null && drag.started) {
        const over = this.labelOverride.get(drag.labelId);
        this.labelOverride.delete(drag.labelId);
        if (over !== undefined) this.opts.onRestyle?.(drag.labelId, { labelDx: over.dx, labelDy: over.dy });
        this.requestFrame();
        return;
      }
      if (this.view !== null && drag.started && drag.plan.kind !== 'none' && drag.plan.kind !== 'label') {
        // Commit rounded values, then one batched script record (design 12.6).
        const scale = this.view.scaleX;
        const moves: DragMove[] = [];
        for (const ref of drag.plan.moves) {
          const v = this.opts.kernel.valueOf(ref.id);
          if (v.defined && v.value.k === 'point') {
            moves.push({
              k: 'point', id: ref.id,
              x: roundForCommit(v.value.x, scale),
              y: roundForCommit(v.value.y, scale),
            });
          }
        }
        try {
          if (moves.length > 0) this.opts.drag.drag(moves);
          this.opts.drag.commitDrag();
        } catch {
          try {
            this.opts.drag.cancelDrag();
          } catch {
            // Nothing left to try; the kernel kept its pre-drag values.
          }
        }
        const head = this.opts.kernel.head(drag.plan.moves[0]?.id ?? -1 as ObjId);
        if (head !== undefined) {
          this.announce(describeMove(head.name, this.opts.valueText?.(head.id) ?? ''));
        }
      }
      this.requestFrame();
      return;
    }
    if (this.opts.mode === '3d') this.onPointerUp3D(e);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.view === null) return;
    // Plain scroll over a page-embedded view does not capture the page scroll
    // unless the view is focused; ctrl+wheel and pinch always zoom.
    const focused = this.root !== null && this.root.contains(document.activeElement);
    if (!e.ctrlKey && !focused && this.root !== null) return;
    e.preventDefault();
    this.opts.onInteract?.();
    if (this.opts.mode === '3d') {
      this.onWheel3D(e);
      return;
    }
    const pos = this.eventPos(e);
    const units = Math.abs(e.deltaY) > 0 ? e.deltaY : e.deltaX;
    const k = 1.1 ** (-units / 100);
    const r = zoomAbout(this.view, { x: px(pos.x), y: px(pos.y) }, k);
    if (r.refused !== undefined) {
      this.opts.onGesture?.(r.refused, r.refused === 'zoom_limit' ? "Can't zoom further." : 'Zoom is at the number precision limit here.');
      return;
    }
    this.view = r.viewport;
    this.list.markViewDirtyAll();
    this.paintVersion++;
    this.markCacheInvalid();
    this.bgDirty = true;
    this.requestFrame();
  };

  private readonly onDoubleClick = (e: MouseEvent): void => {
    if (this.view === null) return;
    this.opts.onInteract?.();
    if (this.opts.mode === '3d') {
      this.onDoubleClick3D(e);
      return;
    }
    const pos = this.eventPos(e);
    const hits = this.hitTest(pos.x, pos.y, 'mouse');
    if (hits.candidates.length > 0) {
      // Double-click an object opens its properties (the ui package).
      this.opts.onGesture?.('properties', this.opts.kernel.head(hits.candidates[0]?.id ?? -1 as ObjId)?.name ?? '');
      return;
    }
    const k = e.shiftKey ? 1 / 1.5 : 1.5;
    const r = zoomAbout(this.view, { x: px(pos.x), y: px(pos.y) }, k);
    if (r.refused === undefined) {
      this.view = r.viewport;
      this.list.markViewDirtyAll();
      this.paintVersion++;
      this.markCacheInvalid();
      this.bgDirty = true;
      this.requestFrame();
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.view === null) return;
    if (e.key === 'Escape') {
      if (this.drag !== null) {
        try {
          this.opts.drag.cancelDrag();
        } catch {
          // The kernel kept its pre-drag values.
        }
        this.drag = null;
        this.snapIndicator = null;
        this.requestFrame();
        e.preventDefault();
        return;
      }
      this.selection = emptySelection();
      this.band = null;
      this.requestFrame();
      return;
    }
    if (this.opts.mode === '3d') {
      this.onKeyDown3D(e);
      return;
    }
    const step = (mult = 1): number => nudgeStep(this.view?.scaleX ?? 80,
      this.gridStepX, this.snap !== 'off',
      e.shiftKey ? 'shift' : e.altKey ? 'alt' : 'none') * mult;
    const moveSelected = (dx: number, dy: number): void => {
      const moves: DragMove[] = [];
      for (const id of this.selection.ids) {
        const plan = computeDragPlan(id, this.dragFactsFor(id, false));
        if (plan.kind !== 'free') continue;
        const v = this.opts.kernel.valueOf(id);
        if (v.defined && v.value.k === 'point') {
          moves.push({ k: 'point', id, x: v.value.x + dx, y: v.value.y + dy });
        }
      }
      if (moves.length > 0) {
        try {
          this.opts.drag.drag(moves);
          this.opts.drag.commitDrag();
        } catch {
          // Dropped; the figure is unchanged.
        }
        this.requestFrame();
      }
    };
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        this.opts.onInteract?.();
        if (e.ctrlKey || e.metaKey) {
          const f = (this.view.width as number) * 0.1;
          const dx = e.key === 'ArrowLeft' ? f : e.key === 'ArrowRight' ? -f : 0;
          const dy = e.key === 'ArrowUp' ? -f : e.key === 'ArrowDown' ? f : 0;
          this.view = panBy(this.view, dx, dy);
          this.list.markPanDirty(dx, dy);
          this.paintVersion++;
          this.markCacheInvalid();
          this.bgDirty = true;
          this.requestFrame();
          return;
        }
        if (this.selection.ids.size > 0) {
          const s = step();
          moveSelected(
            e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0,
            e.key === 'ArrowUp' ? s : e.key === 'ArrowDown' ? -s : 0,
          );
          return;
        }
        // No selection: arrows move focus between objects (creation order).
        this.stepFocus(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      case '+':
      case '=': {
        const c = { x: px((this.view.width as number) / 2), y: px((this.view.height as number) / 2) };
        const r = zoomAbout(this.view, c, 1.5);
        if (r.refused === undefined) {
          this.view = r.viewport;
          this.list.markViewDirtyAll();
          this.paintVersion++;
          this.markCacheInvalid();
          this.bgDirty = true;
          this.requestFrame();
        }
        return;
      }
      case '-':
      case '_': {
        const c = { x: px((this.view.width as number) / 2), y: px((this.view.height as number) / 2) };
        const r = zoomAbout(this.view, c, 1 / 1.5);
        if (r.refused === undefined) {
          this.view = r.viewport;
          this.list.markViewDirtyAll();
          this.paintVersion++;
          this.markCacheInvalid();
          this.bgDirty = true;
          this.requestFrame();
        }
        return;
      }
      case '0':
      case 'Home':
        this.goHome();
        return;
      case 'Delete':
      case 'Backspace': {
        const ids = [...this.selection.ids];
        if (ids.length > 0) {
          this.opts.onDelete?.(ids);
          this.selection = emptySelection();
          this.requestFrame();
        }
        return;
      }
      case 'Enter':
      case ' ': {
        if (this.focused !== null) {
          this.selection = clickSelect(this.selection, this.focused, e.shiftKey,
            (id) => this.opts.styles.authoredOf(id)?.style.selectable !== false);
          this.requestFrame();
          e.preventDefault();
        }
        return;
      }
      default:
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
          const ids = this.opts.kernel.heads().map((h) => h.id);
          this.selection = selectAll(ids, (id) => this.opts.styles.authoredOf(id)?.style.selectable !== false);
          this.requestFrame();
          e.preventDefault();
        }
    }
  };

  private stepFocus(dir: -1 | 1): void {
    // Focus walks the hidden list: visible, selectable objects in creation order.
    const ids = this.opts.kernel.heads().map((h) => h.id).filter((id) => this.readerItems.has(id));
    if (ids.length === 0) return;
    const at = this.focused === null ? -1 : ids.indexOf(this.focused);
    const next = ids[(at + dir + ids.length) % ids.length] ?? ids[0];
    if (next === undefined) return;
    this.focused = next;
    this.readerItems.get(next)?.focus();
    this.announce(this.list.get(next)?.drawable.describe() ?? '');
    this.requestFrame();
  }

  /* ---------------- 3D ---------------- */

  private currentCamera(): Camera | null {
    if (this.view === null) return null;
    const bounds = this.figure3d.scene.sceneBounds();
    return buildCamera({
      props: this.cameraProps,
      viewport: { w: this.view.width as number, h: this.view.height as number, dpr: this.dpr },
      fitDist: Math.max(bounds.r * 2.2, 1e-6),
      fitRadius: Math.max(bounds.r, 1e-6),
    });
  }

  private pickables3D(): Pickable[] {
    const out: Pickable[] = [];
    const live = new Set(this.figure3d.scene.all());
    for (const key of [...this.bvhCache.keys()]) {
      if (!live.has(key)) this.bvhCache.delete(key);
    }
    for (const item of this.figure3d.scene.all()) {
      if (item.k === 'points') {
        const n = Math.floor(item.pos.length / 3);
        for (let i = 0; i < n; i++) {
          out.push({
            k: 'point', objId: item.objId,
            at: { x: item.pos[i * 3] ?? 0, y: item.pos[i * 3 + 1] ?? 0, z: item.pos[i * 3 + 2] ?? 0 },
          });
        }
      } else if (item.k === 'lines') {
        out.push({ k: 'path', objId: item.objId, pts: item.pos, closed: item.closed });
      } else if (item.k === 'mesh') {
        let bvh = this.bvhCache.get(item);
        if (bvh === undefined) {
          bvh = buildBvh(item.pos, item.idx);
          this.bvhCache.set(item, bvh);
        }
        out.push({ k: 'surface', objId: item.objId, bvh, transparent: item.alpha < 0.999 });
      }
    }
    return out;
  }

  /** Handles of the selected free point: 3 arrows + 3 plane squares (10.1). */
  private gizmoHit(x: number, y: number): { axis: V3 } | { plane: V3 } | null {
    const cam = this.currentCamera();
    const id = this.focused ?? (this.selection.ids.size === 1 ? [...this.selection.ids][0] : undefined);
    if (cam === null || id === undefined) return null;
    const value = this.opts.kernel.valueOf(id);
    if (!value.defined || value.value.k !== 'point3') return null;
    const at = { x: value.value.x, y: value.value.y, z: value.value.z };
    const o = projectPoint(cam, at);
    if (o.behind) return null;
    const axes: V3[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
    for (const e of axes) {
      const tip = projectPoint(cam, v3Add(at, v3Scale(e, 40 / Math.max(cam.scale, 1e-9))));
      if (tip.behind) continue;
      const d = this.pointSegmentPx(x, y, o.x, o.y, tip.x, tip.y);
      if (d <= 10) return { axis: e };
    }
    // Squares between arrow tips: xy, xz, yz planes.
    const planes: V3[] = [{ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }];
    for (const n of planes) {
      const c = projectPoint(cam, at);
      if (Math.hypot(x - (c.x + 28), y - (c.y - 28)) <= 9) return { plane: n };
    }
    return null;
  }

  private pointSegmentPx(pxv: number, pyv: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((pxv - ax) * dx + (pyv - ay) * dy) / len2)) : 0;
    return Math.hypot(pxv - (ax + t * dx), pyv - (ay + t * dy));
  }

  /** Default drag plane: the axis plane facing the camera most (10.1). */
  private defaultDragPlane(cam: Camera, at: V3): { n: V3; c: number } {
    const planes: V3[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
    let best = planes[0] ?? { x: 0, y: 0, z: 1 };
    let bestD = -1;
    for (const n of planes) {
      const d = Math.abs(v3Dot(n, cam.forward));
      if (d > bestD) {
        bestD = d;
        best = n;
      }
    }
    return { n: best, c: v3Dot(best, at) };
  }

  private readonly onPointerDown3D = (e: PointerEvent, pos: { x: number; y: number }): void => {
    const cam = this.currentCamera();
    if (cam === null || this.overlayCanvas === null) return;
    const gizmo = this.gizmoHit(pos.x, pos.y);
    const ray = pointerRay(cam, pos.x, pos.y);
    const project = (p: V3): { x: number; y: number } | null => {
      const s = projectPoint(cam, p);
      return s.behind ? null : { x: s.x, y: s.y };
    };
    const hits = pick(this.pickables3D(), ray, project, pos.x, pos.y, { tolerancePx: 10, includeTransparent: true });
    const top = hits[0] ?? null;
    if (e.button === 1 || e.shiftKey || top === null) {
      if (top !== null && e.shiftKey) {
        this.selection = clickSelect(this.selection, top.objId, true,
          (id) => this.opts.styles.authoredOf(id)?.style.selectable !== false);
        this.requestFrame();
      }
      this.camDrag = {
        pointerId: e.pointerId,
        mode: e.button === 1 || e.shiftKey ? 'pan' : 'orbit',
        lastX: pos.x, lastY: pos.y,
      };
      this.overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
    this.selection = clickSelect(this.selection, top.objId, e.ctrlKey || e.metaKey,
      (id) => this.opts.styles.authoredOf(id)?.style.selectable !== false);
    this.focused = top.objId;
    this.requestFrame();
    const head = this.opts.kernel.head(top.objId);
    const value = this.opts.kernel.valueOf(top.objId);
    if (head?.free === true && this.opts.styles.authoredOf(top.objId)?.style.fixed !== true && value.defined && value.value.k === 'point3') {
      const at = { x: value.value.x, y: value.value.y, z: value.value.z };
      const base = { pointerId: e.pointerId, id: top.objId, last: at, lastX: pos.x, lastY: pos.y };
      if (gizmo !== null && 'axis' in gizmo) {
        this.point3Drag = { ...base, plane: null, axis: { a: at, e: gizmo.axis }, depth: false };
      } else if (gizmo !== null && 'plane' in gizmo) {
        const n = gizmo.plane;
        this.point3Drag = { ...base, plane: { n, c: v3Dot(n, at) }, axis: null, depth: false };
      } else if (e.altKey) {
        this.point3Drag = { ...base, plane: null, axis: null, depth: true };
      } else if (e.shiftKey) {
        this.point3Drag = { ...base, plane: null, axis: { a: at, e: { x: 0, y: 0, z: 1 } }, depth: false };
      } else {
        this.point3Drag = { ...base, plane: this.defaultDragPlane(cam, at), axis: null, depth: false };
      }
      this.overlayCanvas.setPointerCapture(e.pointerId);
    } else if (this.opts.styles.authoredOf(top.objId)?.style.fixed === true) {
      this.opts.onGesture?.('drag_fixed', `${head?.name ?? '?'} is fixed.`);
    } else {
      this.opts.onGesture?.('drag_blocked', `${head?.name ?? '?'} can't be moved here.`);
    }
  };

  private readonly onPointerMove3D = (e: PointerEvent, pos: { x: number; y: number }): void => {
    const cam = this.currentCamera();
    if (cam === null) return;
    if (this.camDrag !== null && this.camDrag.pointerId === e.pointerId) {
      const dx = pos.x - this.camDrag.lastX;
      const dy = pos.y - this.camDrag.lastY;
      this.camDrag = { ...this.camDrag, lastX: pos.x, lastY: pos.y };
      if (this.camDrag.mode === 'orbit') {
        const q = userRotate(this.figure3d.camera?.q ?? cam.q, dx, dy);
        const { azimuth, elevation } = readAzEl(q, this.cameraProps.zUp);
        this.cameraProps = { ...this.cameraProps, azimuth, elevation };
      } else {
        const target = v3Add(
          v3Add(this.cameraProps.target, drawnToWorldVec(cam, v3Scale(cam.right, -dx / Math.max(cam.scale, 1e-9)))),
          drawnToWorldVec(cam, v3Scale(cam.up, dy / Math.max(cam.scale, 1e-9))),
        );
        this.cameraProps = { ...this.cameraProps, target };
      }
      this.requestFrame();
      return;
    }
    const drag = this.point3Drag;
    if (drag !== null && drag.pointerId === e.pointerId) {
      const ray = pointerRay(cam, pos.x, pos.y);
      let next: V3 | null = null;
      if (drag.depth) {
        // Along the line from the camera: vertical pointer motion is depth.
        const dy = pos.y - drag.lastY;
        drag.lastX = pos.x;
        drag.lastY = pos.y;
        next = this.snap3D(v3Add(drag.last, drawnToWorldVec(cam, v3Scale(cam.forward, -dy / Math.max(cam.scale, 1e-9)))));
      } else if (drag.axis !== null) {
        const r = rayLineClosest(ray.o, ray.d, drag.axis.a, drag.axis.e);
        if (r !== null) {
          const p = v3Add(drag.axis.a, v3Scale(drag.axis.e, r.s));
          next = this.snap3D(p);
        }
      } else if (drag.plane !== null) {
        let plane = drag.plane;
        if (Math.abs(v3Dot(plane.n, ray.d)) < 0.05) {
          // Looking edge-on: switch to the next-best plane (10.1).
          plane = this.defaultDragPlane(cam, drag.last);
          if (Math.abs(v3Dot(plane.n, ray.d)) < 0.05) plane = drag.plane;
        }
        const t = rayPlane(ray.o, ray.d, plane.n, plane.c);
        if (t !== null && t >= 0) {
          next = this.snap3D(v3Add(ray.o, v3Scale(ray.d, t)));
        }
      }
      if (next !== null) {
        drag.last = next;
        try {
          this.opts.drag.drag([{ k: 'point3', id: drag.id, x: next.x, y: next.y, z: next.z }]);
        } catch {
          // Dropped; the next move retries.
        }
        this.requestFrame();
      }
      return;
    }
    if (this.pointerKindOf(e) === 'mouse') {
      const ray = pointerRay(cam, pos.x, pos.y);
      const project = (p: V3): { x: number; y: number } | null => {
        const s = projectPoint(cam, p);
        return s.behind ? null : { x: s.x, y: s.y };
      };
      const hits = pick(this.pickables3D(), ray, project, pos.x, pos.y, { tolerancePx: 10, includeTransparent: false });
      const id = hits[0]?.objId ?? null;
      if (id !== this.hovered) {
        this.hovered = id;
        if (this.overlayCanvas !== null) this.overlayCanvas.style.cursor = id === null ? 'default' : 'grab';
        this.requestFrame();
      }
    }
  };

  private snap3D(p: V3): V3 {
    if (this.snap === 'off' || this.snap === 'points') return p;
    const step = this.gridStepX ?? 1;
    if (!(step > 0)) return p;
    const near = (v: number): number => {
      const g = Math.round(v / step) * step;
      return Math.abs(g - v) <= 0.15 * step ? g : v;
    };
    return { x: near(p.x), y: near(p.y), z: near(p.z) };
  }

  private readonly onPointerUp3D = (e: PointerEvent): void => {
    if (this.camDrag !== null && this.camDrag.pointerId === e.pointerId) this.camDrag = null;
    const drag = this.point3Drag;
    if (drag !== null && drag.pointerId === e.pointerId) {
      this.point3Drag = null;
      try {
        this.opts.drag.commitDrag();
      } catch {
        try {
          this.opts.drag.cancelDrag();
        } catch {
          // The kernel kept its pre-drag values.
        }
      }
      const head = this.opts.kernel.head(drag.id);
      if (head !== undefined) this.announce(describeMove(head.name, this.opts.valueText?.(head.id) ?? ''));
      this.requestFrame();
    }
  };

  private readonly onWheel3D = (e: WheelEvent): void => {
    const cam = this.currentCamera();
    if (cam === null || this.view === null) return;
    const pos = this.eventPos(e);
    const units = Math.abs(e.deltaY) > 0 ? e.deltaY : e.deltaX;
    const k = 1.1 ** (-units / 100);
    // Zoom toward the pointer: keep the pointed world point still.
    const ray = pointerRay(cam, pos.x, pos.y);
    const depthPoint = v3Add(ray.o, v3Scale(ray.d, cam.dist));
    const zoom = Math.min(1e6, Math.max(1e-6, this.cameraProps.zoom * k));
    this.cameraProps = { ...this.cameraProps, zoom };
    const cam2 = this.currentCamera();
    if (cam2 !== null) {
      const ray2 = pointerRay(cam2, pos.x, pos.y);
      const depthPoint2 = v3Add(ray2.o, v3Scale(ray2.d, cam2.dist));
      const shift = v3Sub(depthPoint, depthPoint2);
      this.cameraProps = { ...this.cameraProps, target: v3Add(this.cameraProps.target, shift) };
    }
    this.requestFrame();
  };

  private readonly onDoubleClick3D = (e: MouseEvent): void => {
    const cam = this.currentCamera();
    if (cam === null) return;
    const pos = this.eventPos(e);
    const ray = pointerRay(cam, pos.x, pos.y);
    const project = (p: V3): { x: number; y: number } | null => {
      const s = projectPoint(cam, p);
      return s.behind ? null : { x: s.x, y: s.y };
    };
    const hits = pick(this.pickables3D(), ray, project, pos.x, pos.y, { tolerancePx: 10, includeTransparent: true });
    if (hits.length === 0) {
      // ViewReset, animated.
      this.camTween = { from: this.cameraProps, to: { ...DEFAULT_SPACE_CAMERA, target: this.cameraProps.target }, startMs: performance.now(), durMs: 400 };
    } else {
      // Retarget to the hit; ViewFacing proper needs kernel plane normals.
      const world = hits[0]?.world;
      if (world !== undefined) {
        this.camTween = { from: this.cameraProps, to: { ...this.cameraProps, target: world }, startMs: performance.now(), durMs: 400 };
      }
    }
    this.requestFrame();
  };

  private readonly onKeyDown3D = (e: KeyboardEvent): void => {
    const cam = this.currentCamera();
    if (cam === null || this.view === null) return;
    const grid = this.gridStepX ?? 1;
    const step = e.shiftKey ? grid * 10 : e.altKey ? grid / 10 : grid;
    const moveSelected3 = (dx: number, dy: number, dz: number): void => {
      const moves: DragMove[] = [];
      for (const id of this.selection.ids) {
        const head = this.opts.kernel.head(id);
        const v = this.opts.kernel.valueOf(id);
        if (head?.free !== true || !v.defined || v.value.k !== 'point3') continue;
        moves.push({ k: 'point3', id, x: v.value.x + dx, y: v.value.y + dy, z: v.value.z + dz });
      }
      if (moves.length > 0) {
        try {
          this.opts.drag.drag(moves);
          this.opts.drag.commitDrag();
        } catch {
          // Dropped; the figure is unchanged.
        }
        this.requestFrame();
      }
    };
    switch (e.key) {
      case 'ArrowLeft': moveSelected3(-step, 0, 0); e.preventDefault(); return;
      case 'ArrowRight': moveSelected3(step, 0, 0); e.preventDefault(); return;
      case 'ArrowUp': moveSelected3(0, step, 0); e.preventDefault(); return;
      case 'ArrowDown': moveSelected3(0, -step, 0); e.preventDefault(); return;
      case 'PageUp': moveSelected3(0, 0, step); e.preventDefault(); return;
      case 'PageDown': moveSelected3(0, 0, -step); e.preventDefault(); return;
      case '+':
      case '=':
        this.cameraProps = { ...this.cameraProps, zoom: this.cameraProps.zoom * 1.5 };
        this.requestFrame();
        return;
      case '-':
      case '_':
        this.cameraProps = { ...this.cameraProps, zoom: this.cameraProps.zoom / 1.5 };
        this.requestFrame();
        return;
      case '0':
      case 'Home':
        this.cameraProps = { ...DEFAULT_SPACE_CAMERA, target: this.cameraProps.target };
        this.requestFrame();
        return;
      case 'Delete':
      case 'Backspace': {
        const ids = [...this.selection.ids];
        if (ids.length > 0) {
          this.opts.onDelete?.(ids);
          this.selection = emptySelection();
          this.requestFrame();
        }
        return;
      }
      case 'Enter':
      case ' ': {
        if (this.focused !== null) {
          this.selection = clickSelect(this.selection, this.focused, e.shiftKey,
            (id) => this.opts.styles.authoredOf(id)?.style.selectable !== false);
          this.requestFrame();
          e.preventDefault();
        }
        return;
      }
      default:
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
          const ids = this.opts.kernel.heads().map((h) => h.id);
          this.selection = selectAll(ids, (id) => this.opts.styles.authoredOf(id)?.style.selectable !== false);
          this.requestFrame();
          e.preventDefault();
        }
    }
  };

  private paintScene3D(): DrawStats {
    const stats = createDrawStats();
    if (this.view === null) return stats;
    this.figure3d.applyEvents(this.sceneEvents);
    this.sceneEvents = [];
    const box = this.opts.shared.box(this.opts.id);
    if (box === undefined) return stats;
    const size = {
      width: this.view.width as number,
      height: this.view.height as number,
      dpr: this.dpr,
    };
    const backend = this.opts.shared.backend();
    if (backend !== null && box.target !== null) {
      const r = this.figure3d.paint({
        backend,
        target: box.target,
        size,
        cameraProps: this.cameraProps,
        clip: this.clip,
        hidden: this.hiddenLines,
        light: this.light,
        background: { r: 255, g: 255, b: 255, a: 0 },
      });
      if (r.ok) {
        stats.drawCalls = r.value.drawCalls;
        stats.triangles = r.value.triangles;
        stats.lines = r.value.lines;
        stats.points = r.value.points;
      }
      this.opts.shared.present(this.opts.id);
      return stats;
    }
    // Software fallback on the visible 2D canvas.
    if (box.ctx2d === null) return stats;
    if (this.software === null) this.software = new SoftwareBackend(box.ctx2d);
    const key = `${size.width}x${size.height}`;
    if (this.softwareTarget === null || this.softwareSize !== key) {
      this.softwareTarget?.dispose();
      const made = this.software.createTarget({ width: size.width, height: size.height, samples: 1, depth: true, float: false });
      this.softwareTarget = made.ok ? made.value : null;
      this.softwareSize = key;
    }
    if (this.softwareTarget === null) return stats;
    const r = this.figure3d.paint({
      backend: this.software,
      target: this.softwareTarget,
      size,
      cameraProps: this.cameraProps,
      clip: this.clip,
      hidden: this.hiddenLines,
      light: this.light,
      background: { r: 255, g: 255, b: 255, a: 0 },
    });
    if (r.ok) {
      stats.drawCalls = r.value.drawCalls;
      stats.triangles = r.value.triangles;
    }
    return stats;
  }

  private paintOverlay3D(): void {
    const s = this.overlaySurface;
    const cam = this.currentCamera();
    if (s === null || cam === null || this.view === null) return;
    const c2d = s.ctx;
    c2d.save();
    c2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c2d.clearRect(0, 0, this.view.width as number, this.view.height as number);
    c2d.restore();
    // Labels: projected anchors with greedy offsets, haloed like 2D labels.
    const inputs: LabelInput[] = [];
    const anchors = new Map<ObjId, { x: number; y: number }>();
    for (const head of this.opts.kernel.heads()) {
      const items = this.figure3d.scene.of(head.id);
      if (items.length === 0) continue;
      const first = items[0];
      if (first === undefined) continue;
      const b = itemBounds(first);
      const p = projectPoint(cam, b.c);
      if (p.behind) continue;
      const m = this.measure(head.name, 13);
      anchors.set(head.id, { x: p.x, y: p.y });
      inputs.push({
        id: head.id, anchorX: p.x, anchorY: p.y, widthPx: m.width, heightPx: m.height,
        userDx: null, userDy: null, prevDx: null, prevDy: null, prevScore: null,
      });
      if (inputs.length >= this.budgets.labelsShown) break;
    }
    for (const p of placeLabels(inputs, [])) {
      const head = this.opts.kernel.head(p.id);
      const anchor = anchors.get(p.id);
      if (head === undefined || anchor === undefined) continue;
      s.text({ text: head.name, math: false }, { x: px(anchor.x + p.dx), y: px(anchor.y + p.dy) }, {
        size: 13, bold: false, italic: false, family: 'system-ui, sans-serif',
        align: 'left', color: this.theme.stroke, opacity: 1, background: this.theme.background,
      });
    }
    // Gizmo for the selected free point.
    const id = this.focused ?? (this.selection.ids.size === 1 ? [...this.selection.ids][0] : undefined);
    if (id !== undefined) {
      const value = this.opts.kernel.valueOf(id);
      if (value.defined && value.value.k === 'point3') {
        const at = { x: value.value.x, y: value.value.y, z: value.value.z };
        const o = projectPoint(cam, at);
        if (!o.behind) {
          const axes: Array<{ e: V3; c: string }> = [
            { e: { x: 1, y: 0, z: 0 }, c: '#d03a2a' },
            { e: { x: 0, y: 1, z: 0 }, c: '#1f8a4c' },
            { e: { x: 0, y: 0, z: 1 }, c: '#1a5fd1' },
          ];
          for (const { e, c } of axes) {
            const tip = projectPoint(cam, v3Add(at, v3Scale(e, 40 / Math.max(cam.scale, 1e-9))));
            if (tip.behind) continue;
            const col = this.theme.axes;
            void c;
            void col;
            s.path(new Float32Array([o.x, o.y, tip.x, tip.y]));
            s.stroke({ color: this.theme.stroke, width: 2, dash: [], dashPhase: 0, cap: 'round', join: 'round', miterLimit: 4, opacity: 1 });
          }
        }
      }
    }
  }

  /* ---------------- export ---------------- */

  /** Bounds of the shown objects in maths units, for fit-all and the `objects` region. */
  private objectBoundsMaths(): MathsRect[] {
    const out: MathsRect[] = [];
    for (const e of this.list.sorted()) {
      const d = e.drawable;
      if (!(d instanceof GeometryDrawable)) continue;
      const v = d.shownValue();
      if (v === null) continue;
      const b = mathsBounds(v);
      if (b !== null) out.push(b);
    }
    return out;
  }

  exportSvg(req: ExportRequest): Result<string> {
    if (this.view === null) {
      return viewError({
        kind: 'internal',
        messageKey: 'view.internal',
        params: { where: 'export with no view' },
        token: 'export',
      });
    }
    const liveView = this.view;
    const mapper = createMapper(liveView);
    const objectBounds = this.objectBoundsMaths();
    const norm = normalizeExport(req, {
      viewBounds: mapper.bounds(),
      objectBounds,
      nowT: this.filmT,
      equalRatio: this.ratioLock === 'equal',
      pxPerUnit: liveView.scaleX,
      pxPerUnitY: liveView.scaleY,
    });
    if (!norm.ok) return norm;
    const exp = norm.value;
    const token = exp.time !== null && this.opts.snapshots !== null
      ? this.opts.snapshots.snapshotAt(exp.time)
      : null;
    try {
      const vp = exportViewport(exp, this.ratioLock === 'equal', 1);
      if (!vp.ok) return vp;
      // The caps stop the work as it grows, not after the whole document is
      // built (VIEW-SM-3): the surface refuses elements past the count or byte cap.
      const svg = new SvgSurface({ textAs: exp.textAs }, { maxElements: MAX_SVG_ELEMENTS, maxBytes: MAX_SVG_BYTES });
      // The drawables hold live-viewport pixels: rebuild them all for the export viewport.
      this.rebuildForExport(vp.value);
      const labelIds = this.selectLabels(
        this.list.sorted(),
        { x0: px(0), x1: vp.value.width, y0: px(0), y1: vp.value.height },
        this.budgets.labelsShown,
        false,
      ).shown;
      if (exp.includeGrid && this.grid.on) {
        svg.setCurrentId('');
        this.paintGrid(svg, vp.value);
      }
      if (exp.includeAxes && this.axes.which !== 'off') {
        svg.setCurrentId('');
        this.paintAxes(svg, vp.value);
      }
      const ctx: PaintContext = {
        view: vp.value, theme: this.theme, selected: new Set(), hovered: null,
        focused: null, reducedMotion: true, t: exp.time ?? this.filmT,
      };
      for (const e of this.list.sorted()) {
        if (svg.exceeded) break;
        if (exp.layers !== 'all' && !exp.layers.includes(e.drawable.sortKey.layer)) continue;
        const head = this.opts.kernel.head(e.drawable.id);
        svg.setCurrentId(head?.name ?? '');
        e.drawable.paint(svg, ctx);
        if (labelIds.has(e.drawable.id)) e.drawable.paintLabel(svg, ctx);
      }
      if (!svg.exceeded) this.paintParticlesSvg(svg, exp.time ?? this.filmT, vp.value);
      if (svg.exceeded) {
        return viewError({
          kind: 'limit',
          messageKey: 'view.limit',
          params: {
            what: svg.byteCount >= MAX_SVG_BYTES ? 'SVG bytes' : 'SVG elements',
            max: svg.byteCount >= MAX_SVG_BYTES ? MAX_SVG_BYTES : MAX_SVG_ELEMENTS,
            got: svg.byteCount >= MAX_SVG_BYTES ? svg.byteCount : svg.elementCount,
          },
          token: String(svg.elementCount),
          hint: 'Export a smaller region or hide some objects.',
        });
      }
      const bg = exp.background === 'view'
        ? this.background === 'transparent' ? 'none' as const : this.background
        : exp.background === 'transparent' ? 'none' as const : exp.background;
      return okResult(svg.toString(exp.widthPx, exp.heightPx, bg));
    } finally {
      token?.release();
      this.restoreLive();
    }
  }

  /** Rebuild every drawable at an export viewport (the live geometry is restored by `restoreLive`). */
  private rebuildForExport(vp: Viewport): void {
    this.list.markViewDirtyAll();
    updateDrawables(this.list, { kernel: this.opts.kernel, styles: this.opts.styles }, vp, () => undefined);
  }

  /**
   * Put live-viewport geometry and hit boxes back as soon as an export has
   * painted, so input that arrives before the next frame hits the right
   * places (VIEW-SM-14).
   */
  private restoreLive(): void {
    if (this.view !== null) {
      this.list.markViewDirtyAll();
      updateDrawables(
        this.list,
        { kernel: this.opts.kernel, styles: this.opts.styles },
        this.view,
        (id, bbox) => this.hits.update(id, bbox),
      );
    }
    this.markCacheInvalid();
    this.requestFrame();
  }

  /** Particles export through the CPU path so frames are reproducible. */
  private paintParticlesSvg(svg: SvgSurface, t: number, view: Viewport): void {
    const mapper = createMapper(view);
    for (const e of this.list.sorted()) {
      if (svg.exceeded) return;
      if (e.drawable.kind !== 'particles') continue;
      const program = this.opts.kernel.particlesOf(e.drawable.id);
      if (program === undefined) continue;
      const count = program.spec.count;
      const plan = particleExportPlan(count);
      const batch = {
        count,
        x: new Float32Array(count),
        y: new Float32Array(count),
        size: new Float32Array(count),
        alpha: new Float32Array(count),
        rgba: new Uint32Array(count),
        angle: new Float32Array(count),
      };
      try {
        program.evalCpu(t, t, batch);
      } catch {
        continue;
      }
      svg.setCurrentId(this.opts.kernel.head(e.drawable.id)?.name ?? 'particles');
      for (let i = 0; i < plan.drawn && !svg.exceeded; i++) {
        const p = mapper.toPx({ x: (batch.x[i] ?? 0) as never, y: (batch.y[i] ?? 0) as never });
        const r = Math.max(((batch.size[i] ?? 0) * (program.spec.sizeIsPx ? 1 : view.scaleX) * Math.sqrt(plan.densityMul)) / 2, 0.5);
        const u = batch.rgba[i] ?? 0;
        const col = {
          r: (u >>> 24) & 0xff, g: (u >>> 16) & 0xff, b: (u >>> 8) & 0xff, a: (u & 0xff) / 255,
        };
        svg.path(new Float32Array([p.x as number - r, p.y as number, p.x as number + r, p.y as number]));
        svg.stroke({
          color: col, width: r * 2, dash: [], dashPhase: 0, cap: 'round',
          join: 'round', miterLimit: 4, opacity: Math.min(1, (batch.alpha[i] ?? 1) * plan.densityMul),
        });
      }
    }
  }

  exportPng(req: ExportRequest): Promise<Result<Blob>> {
    if (this.view === null) {
      return Promise.resolve(viewError({
        kind: 'internal',
        messageKey: 'view.internal',
        params: { where: 'export with no view' },
        token: 'export',
      }));
    }
    const liveView = this.view;
    const mapper = createMapper(liveView);
    const norm = normalizeExport(req, {
      viewBounds: mapper.bounds(),
      objectBounds: this.objectBoundsMaths(),
      nowT: this.filmT,
      equalRatio: this.ratioLock === 'equal',
      pxPerUnit: liveView.scaleX,
      pxPerUnitY: liveView.scaleY,
    });
    if (!norm.ok) return Promise.resolve(norm);
    const exp = norm.value;
    const token = exp.time !== null && this.opts.snapshots !== null
      ? this.opts.snapshots.snapshotAt(exp.time)
      : null;
    try {
      const vp = exportViewport(exp, this.ratioLock === 'equal', exp.scale);
      if (!vp.ok) {
        token?.release();
        return Promise.resolve(vp);
      }
      const w = Math.floor(exp.widthPx * exp.scale);
      const h = Math.floor(exp.heightPx * exp.scale);
      let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
      try {
        if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
      } catch {
        canvas = null;
      }
      if (canvas === null) {
        canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
      }
      const g = canvas.getContext('2d');
      if (g === null || g === undefined) {
        token?.release();
        return Promise.resolve(viewError({
          kind: 'internal',
          messageKey: 'view.internal',
          params: { where: 'PNG canvas' },
          token: 'export',
          hint: "Couldn't make the image. Try a smaller size.",
        }));
      }
      const ctx2d = g as CanvasRenderingContext2D;
      ctx2d.setTransform(exp.scale, 0, 0, exp.scale, 0, 0);
      const surface = new CanvasSurface(ctx2d);
      // The drawables hold live-viewport pixels: rebuild them all for the export viewport.
      this.rebuildForExport(vp.value);
      const labelIds = this.selectLabels(
        this.list.sorted(),
        { x0: px(0), x1: vp.value.width, y0: px(0), y1: vp.value.height },
        this.budgets.labelsShown,
        false,
      ).shown;
      if (exp.background !== 'transparent') {
        const bg = exp.background === 'view'
          ? this.background === 'transparent' ? null : this.background
          : exp.background;
        if (bg !== null) {
          ctx2d.save();
          ctx2d.fillStyle = `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`;
          ctx2d.fillRect(0, 0, exp.widthPx, exp.heightPx);
          ctx2d.restore();
        }
      }
      if (exp.includeGrid && this.grid.on) this.paintGrid(surface, vp.value);
      if (exp.includeAxes && this.axes.which !== 'off') this.paintAxes(surface, vp.value);
      const ctx: PaintContext = {
        view: vp.value, theme: this.theme, selected: new Set(), hovered: null,
        focused: null, reducedMotion: true, t: exp.time ?? this.filmT,
      };
      const report = paintDrawables(
        this.list, surface, ctx, { x0: px(0), x1: vp.value.width, y0: px(0), y1: vp.value.height }, labelIds,
      );
      void report;
      this.restoreLive();
      token?.release();
      if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
        return canvas.convertToBlob({ type: 'image/png' }).then(
          (blob) => okResult(blob),
          () => viewError({
            kind: 'internal',
            messageKey: 'view.internal',
            params: { where: 'PNG encode' },
            token: 'export',
            hint: "Couldn't make the image. Try a smaller size.",
          }),
        );
      }
      return new Promise((resolve) => {
        (canvas as HTMLCanvasElement).toBlob((blob) => {
          if (blob === null) {
            resolve(viewError({
              kind: 'internal',
              messageKey: 'view.internal',
              params: { where: 'PNG encode' },
              token: 'export',
              hint: "Couldn't make the image. Try a smaller size.",
            }));
          } else resolve(okResult(blob));
        }, 'image/png');
      });
    } catch {
      token?.release();
      this.restoreLive();
      return Promise.resolve(viewError({
        kind: 'internal',
        messageKey: 'view.internal',
        params: { where: 'PNG export' },
        token: 'export',
        hint: "Couldn't make the image. Try a smaller size.",
      }));
    }
  }

  exportScript(): string {
    return this.opts.toScript();
  }

  /* ---------------- saved state, highlight, a11y ---------------- */

  /** The view's slice of the scheduler's `saved` picture state. */
  persistView(): PersistedView {
    const v = this.view;
    return {
      bounds: v === null ? { ...this.home } : createMapper(v).bounds(),
      ratioLock: this.ratioLock,
      home: { ...this.home },
      grid: { ...this.grid },
      axes: { ...this.axes, unitX: { ...this.axes.unitX }, unitY: { ...this.axes.unitY } },
      background: this.background,
      cameraProps: { ...this.cameraProps, target: { ...this.cameraProps.target }, aspect: { ...this.cameraProps.aspect } },
      clip: { ...this.clip, min: { ...this.clip.min }, max: { ...this.clip.max } },
    };
  }

  restoreView(saved: PersistedView): void {
    if (this.view === null) return;
    this.ratioLock = saved.ratioLock;
    this.home = { ...saved.home };
    this.grid = { ...saved.grid };
    this.axes = saved.axes;
    this.background = saved.background;
    this.cameraProps = saved.cameraProps;
    this.clip = saved.clip;
    const made = viewportFromRegion(
      saved.bounds, this.view.width as number, this.view.height as number,
      this.ratioLock, this.dpr,
    );
    if (made.ok) this.view = made.value;
    this.list.markViewDirtyAll();
    this.paintVersion++;
    this.markCacheInvalid();
    this.bgDirty = true;
    this.requestFrame();
  }

  /** Pulse an object while the teacher talks about it (design 9.7). */
  highlight(id: ObjId, seconds: number): void {
    if (!(seconds > 0)) return;
    this.highlights.set(id, performance.now() + seconds * 1000);
    this.requestFrame();
  }

  private updateAriaName(): void {
    if (this.root === null) return;
    const count = this.opts.kernel.heads().length;
    this.root.setAttribute('aria-label', `${describeFigure(count)} Press Tab to explore.`);
    if (this.summaryEl !== null) this.summaryEl.textContent = describeFigure(count);
  }

  private updateReaderList(): void {
    const ul = this.readerList;
    if (ul === null) return;
    this.updateAriaName();
    const seen = new Set<ObjId>();
    const drop = (id: ObjId): void => {
      this.readerText.delete(id);
      this.readerItems.get(id)?.remove();
      this.readerItems.delete(id);
    };
    for (const head of this.opts.kernel.heads()) {
      const authored = this.opts.styles.authoredOf(head.id);
      if (authored?.style.selectable === false) continue;
      const drawable = this.list.get(head.id)?.drawable;
      if (drawable === undefined || drawable.bbox === null) {
        drop(head.id);
        continue;
      }
      seen.add(head.id);
      const text = drawable.describe();
      let li = this.readerItems.get(head.id);
      if (li === undefined) {
        li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('tabindex', '-1');
        ul.append(li);
        this.readerItems.set(head.id, li);
      } else if (this.readerText.get(head.id) === text && li.getAttribute('data-id') === head.name) {
        continue;
      }
      // `data-id` is the object name (design 15), which is what the learner hears.
      li.setAttribute('data-id', head.name);
      this.readerText.set(head.id, text);
      li.textContent = text;
    }
    for (const id of [...this.readerItems.keys()]) {
      if (!seen.has(id)) drop(id);
    }
  }

  /**
   * Polite live region, at most one message per 800 ms (design 15). A message
   * inside the window is queued and the last one is spoken when it closes.
   */
  private announce(text: string): void {
    const now = performance.now();
    if (now - this.lastAnnounceMs >= 800) {
      this.lastAnnounceMs = now;
      this.queuedAnnounce = null;
      if (this.liveRegion !== null) this.liveRegion.textContent = text;
      return;
    }
    this.queuedAnnounce = text;
    if (this.announceTimer === null) {
      const wait = Math.max(0, 800 - (now - this.lastAnnounceMs));
      this.announceTimer = setTimeout(() => {
        this.announceTimer = null;
        this.flushAnnounce();
      }, wait + 5);
    }
  }

  private flushAnnounce(): void {
    if (this.queuedAnnounce === null) return;
    const now = performance.now();
    if (now - this.lastAnnounceMs >= 800) {
      this.lastAnnounceMs = now;
      if (this.liveRegion !== null) this.liveRegion.textContent = this.queuedAnnounce;
      this.queuedAnnounce = null;
    }
  }

  /** Announce teacher-added objects after the current speech (ui.md 5). */
  announceAdded(typeLabel: string, name: string, summary: string): void {
    this.announce(describeAdded(typeLabel, name, summary));
  }
}

export interface PersistedView {
  readonly bounds: MathsRect;
  readonly ratioLock: 'free' | 'equal';
  readonly home: MathsRect;
  readonly grid: GridSpec;
  readonly axes: AxesSpec;
  readonly background: Rgba | 'transparent';
  readonly cameraProps: SpaceCameraProps;
  readonly clip: ClipBox;
}
