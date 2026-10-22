import type { DragInfo, Formula, PathHelpers, Shade, Tone, Values, Vec2 } from '../api/types';
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
  /** Who zooms the stage: the kit (`runtime`), or the renderer through its view box when the kit cannot redraw everything. */
  mode?(): 'runtime' | 'viewbox';
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
