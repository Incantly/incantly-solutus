import type { Layer, ViewBox } from '../api/types';

/** `use` repeats another element of the same stage (SV-6). */
/** `math` is an equation drawn as maths (DG-5): its text is the formula's source. */
export type ElementKind = 'g' | 'path' | 'line' | 'circle' | 'rect' | 'text' | 'polyline' | 'use' | 'math';

/**
 * Drawing instructions from the scene runtime to the renderer. Ids are
 * scene-local integers; the renderer scopes them to its figure.
 */
export type SceneCommand =
  | {
      readonly op: 'stage';
      readonly id: number;
      readonly selector: string;
      readonly viewBox: ViewBox;
      readonly title: string;
      readonly description: string;
      /** Optional clip rectangle for the stage's middle layer, e.g. a graph's plot area. */
      readonly clip?: ViewBox;
    }
  | {
      readonly op: 'create';
      readonly id: number;
      readonly kind: ElementKind;
      readonly parent: number;
      readonly layer: Layer;
      /** For `use`: the element it repeats. */
      readonly source?: number;
    }
  /** A stage's view changes, as a stage that fits its drawing does. */
  | { readonly op: 'viewBox'; readonly id: number; readonly viewBox: ViewBox }
  | { readonly op: 'attr'; readonly id: number; readonly name: string; readonly value: string | null }
  | { readonly op: 'text'; readonly id: number; readonly value: string }
  | { readonly op: 'class'; readonly id: number; readonly value: string }
  | {
      readonly op: 'part';
      readonly id: number;
      readonly name: string;
      readonly label: string;
      readonly info: string;
    }
  /** The learner can drag this element; the runtime turns the pointer into parameter values. */
  | { readonly op: 'drag'; readonly id: number; readonly label: string }
  /** How a stage answers the pointer: who zooms it, whether hovering is reported, its camera views. */
  | {
      readonly op: 'interact';
      readonly id: number;
      /** `viewbox`: the renderer zooms and pans the drawing itself. `runtime`: it sends view messages and the kit redraws. */
      readonly zoom: StageZoom;
      /** Whether pointer movement over the stage is sent to the runtime (tracing a curve). */
      readonly hover: boolean;
      /** Dragging the background orbits the camera rather than panning. */
      readonly orbit: boolean;
      /** Named camera views offered in the stage toolbar. */
      readonly views: readonly string[];
      /** How the measuring tool reads lengths on this stage, or null when it has none (VI-5). */
      readonly measure: StageMeasure | null;
    }
  /** The part an element belongs to when it is not inside the part's own element (3D faces in shared slots). */
  | { readonly op: 'owner'; readonly id: number; readonly part: string | null }
  /** Many small dots drawn on a canvas that shares the stage's coordinates. Coordinates are x0, y0, x1, y1, ... */
  | {
      readonly op: 'dots';
      readonly id: number;
      readonly stage: number;
      readonly layer: 'back' | 'front';
      readonly tone: string;
      readonly r: number;
      readonly points: readonly number[];
      readonly glow?: boolean;
      /** Seconds each dot's streak takes to fade, for a fluid (FX-1): the set gets a canvas of its own that keeps what it drew. */
      readonly trail?: number;
      /** For a fluid: the dots that started again elsewhere since the last command, which draw no streak from where they were. */
      readonly restarts?: readonly number[];
    }
  /** Puts an element's children in this order (a 3D depth sort that changed). */
  | { readonly op: 'order'; readonly id: number; readonly children: readonly number[] };

export type StageZoom = 'viewbox' | 'runtime' | 'none';

/**
 * How the measuring tool reads a stage (VI-5): real coordinates are an
 * affine map of stage units on each axis, u = origin + scale * x, so
 * distances and angles come out in the stage's own units, such as metres on a
 * physics stage or the axes' units on a graph.
 */
export interface StageMeasure {
  /** Real units per stage unit along x and y; negative where the real axis points the other way. */
  readonly scale: readonly [number, number];
  /** The real coordinates of the stage point (0, 0). */
  readonly origin: readonly [number, number];
  /** The unit's name, such as m or Å; empty for plain numbers. */
  readonly unit: string;
}

/** Attributes the renderer will write. Anything else is dropped. */
export const RENDERABLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'd',
  'points',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
]);
