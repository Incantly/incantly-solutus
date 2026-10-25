import type { DragInfo, Formula, PathHelpers, Shade, Step, Tone, Values, Vec2 } from '../api/types';
import type { ViewAction } from '../protocol/runtime-messages';
import type { StageMeasure } from '../protocol/scene-commands';
import type { VNode } from '../scene/graph';
import type { StageHandle } from '../scene/handles';

/** A stage whose view the kit owns: a graph that re-ranges, a 3D camera. */
export interface ViewController {
  /** Applies a view change; returns whether the drawing must be redrawn. */
  apply(action: ViewAction): boolean;
  /** The view differs from where it started. */
  changed(): boolean;
  /** Dragging the background turns the camera. */
  readonly orbit: boolean;
  /** Named views the stage toolbar offers. */
  readonly views: readonly string[];
  /**
   * The walkthrough moved to step `index` of `steps`, or left it for null:
   * the kit turns to the view the steps name there. `immediate` cuts.
   */
  steps?(steps: readonly Step[] | null, index: number | null, immediate: boolean): void;
  /** Who zooms the stage: the kit (`runtime`), or the renderer through its view box when the kit cannot redraw everything. */
  mode?(): 'runtime' | 'viewbox';
  /**
   * For offline checks (CH-2): draws the stage turned to `turn`, or as it
   * stands, and audits the order it drew in. Costs far more than a draw.
   */
  audit?(turn?: AuditTurn): DepthAudit;
}

/** A camera turn, in degrees: yaw about the upright axis, pitch down toward the target. */
export interface AuditTurn {
  readonly yaw: number;
  readonly pitch: number;
}

/** Two pieces of a 3D drawing where the farther is drawn over the nearer. */
export interface DepthViolation {
  /** The piece drawn underneath: a part's name, or the kind of thing. */
  readonly under: string;
  /** The piece drawn over it. */
  readonly over: string;
  /** How much of the stage shows it, in square stage units. */
  readonly area: number;
  /** A stage point where it shows. */
  readonly at: Vec2;
}

/** The depth-order audit of one drawing: where two pieces overlap on the stage, the nearer must be drawn on top. */
export interface DepthAudit {
  readonly pieces: number;
  /** Pairs whose boxes overlap on the stage, all checked. */
  readonly pairs: number;
  /** Pairs drawn in the wrong order: the nearer is underneath, and drawing it later would be right. */
  readonly violations: readonly DepthViolation[];
  /**
   * Pairs that pass through each other: each is nearer somewhere in their
   * overlap, so no drawing order shows both right. The geometry crosses
   * itself; the audit names them and does not fail on them.
   */
  readonly crossings: readonly DepthViolation[];
  /**
   * Pairs drawn in the wrong order because their right order was in a ring:
   * three or more pieces that each lie over the next, so that no order shows
   * them all right. The engine gave up the least sure order of the ring; the
   * audit names them and does not fail on them.
   */
  readonly rings: readonly DepthViolation[];
}

export interface ParamInfo {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * The map of a drag still to come: a graph handle placed at numbers sets no
 * parameter itself, so the scene must give it one with graph.drag before it
 * finishes mounting. The runtime checks that it did.
 */
export const AWAITING_MAP = (): void => undefined;

/**
 * What a drawing kit (graph2d, space3d, physics2d, chart, flow) gets from the
 * runtime for one stage. Kits are SDK code: they may create elements at any
 * time, register drags and redraws, and read parameters.
 */
export interface KitContext {
  readonly stage: StageHandle;
  readonly path: PathHelpers;
  /** Current scene time. */
  time(): number;
  /** The scene changes with time, so it needs frames while playing. */
  markTimeUse(): void;
  /** Runs after the scene's frame callbacks on every drawn frame. */
  onRedraw(fn: () => void): void;
  reportCap(requested: number): void;
  isFormula(value: unknown): value is Formula;
  /** Lets the learner drag `node`. `map` returns parameter values to set; `end` runs when the drag ends. */
  addDrag(node: VNode, label: string, map: (p: DragInfo) => Values | void, toLocal?: (x: number, y: number) => Vec2, end?: () => void): void;
  /** Pointer movement over this stage, or null when it leaves. */
  addHover(fn: (p: Vec2 | null) => void): void;
  /** The kit owns this stage's zoom, pan and camera. */
  setView(controller: ViewController): void;
  /** How the measuring tool reads this stage, as its view stands; null offers no tool (VI-5). */
  setMeasure(measure: StageMeasure | null): void;
  /** A legend entry for an element; `toggle` lets the learner hide it. */
  addLegend(node: VNode, label: string, toggle: boolean): void;
  param(name: string): ParamInfo | undefined;
  /** Runs `fn` with a fixed time step while playing (PH-8). */
  simulate(fn: (dt: number) => void, step: number): void;
  /**
   * Runs `fn` on every frame with the wall-clock seconds since the last one,
   * playing or paused, until it returns false: a view moving on its own, such
   * as a camera turning to a named view. It costs nothing once it is done.
   */
  motion(fn: (dt: number) => boolean): void;
  /** Whether the learner asked for reduced motion. */
  reducedMotion(): boolean;
  /** Records a problem the scene did not throw for, such as a budget warning. */
  warn(message: string): void;
  /** Restyles an element the kit reuses, such as a 3D face slot, as one change. */
  restyle(node: VNode, look: ElementLook): void;
  /** Names the part a reused element draws for now, or null. */
  setOwner(node: VNode, part: string | null): void;
  /** Wall-clock milliseconds, for measuring how long drawing takes. */
  now(): number;
  /** A number that changes whenever a parameter or an edited formula changes. */
  paramVersion(): number;
}

export interface ElementLook {
  readonly tone?: Tone | null;
  readonly dashed?: boolean;
  readonly hidden?: boolean;
  readonly fill?: boolean;
  readonly shade?: Shade | null;
  /** Extra classes, such as a 3D face's lighting level. */
  readonly extra?: string;
}
