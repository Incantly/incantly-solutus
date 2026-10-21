import type { DragInfo, Formula, PathHelpers, Values, Vec2 } from '../api/types';
import type { ViewAction } from '../protocol/runtime-messages';
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
}

export interface ParamInfo {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

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
  /** A legend entry for an element; `toggle` lets the learner hide it. */
  addLegend(node: VNode, label: string, toggle: boolean): void;
  param(name: string): ParamInfo | undefined;
  /** Runs `fn` with a fixed time step while playing (PH-8). */
  simulate(fn: (dt: number) => void, step: number): void;
  /** Whether the learner asked for reduced motion. */
  reducedMotion(): boolean;
  /** Records a problem the scene did not throw for, such as a budget warning. */
  warn(message: string): void;
}
