/**
 * The plan: backend metadata written before a scene, never executed or
 * rendered. The probe reads its declared parts and singular points.
 */
export type SceneKind = 'graph' | 'motion' | 'diagram';

/**
 * How big a figure is (PL-3, BR-11), chosen by the planner. The budgets
 * follow from it: Quick for one concept in one view, Standard for a concept
 * with a second view such as a graph beside the scene, Rich for several linked
 * panels, only when the learner asks for that much.
 */
export type SceneSize = 'quick' | 'standard' | 'rich';

export interface SizeBudget {
  /** Controls: parameters, toggles, choices and colours. */
  readonly controls: number;
  /** Named parts. */
  readonly parts: number;
  /** Drawn elements the probe allows. */
  readonly elements: number;
  /** Lines of scene code to aim for. */
  readonly lines: number;
  /** Most output tokens the scene call may spend. */
  readonly sceneTokens: number;
  /** Seconds from request to figure. */
  readonly seconds: number;
}

export const SIZE_BUDGETS: Readonly<Record<SceneSize, SizeBudget>> = Object.freeze({
  quick: { controls: 3, parts: 8, elements: 400, lines: 60, sceneTokens: 3500, seconds: 10 },
  standard: { controls: 6, parts: 12, elements: 800, lines: 100, sceneTokens: 5000, seconds: 20 },
  rich: { controls: 8, parts: 16, elements: 1600, lines: 150, sceneTokens: 6500, seconds: 25 },
});

export const SCENE_SIZES = Object.keys(SIZE_BUDGETS) as SceneSize[];

/** The control a parameter gets: a slider, an on/off switch, or one of several named options. */
export type ControlKind = 'slider' | 'toggle' | 'choice';

export interface PlanParameter {
  readonly name: string;
  readonly unit?: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  /** Why these bounds are physically or mathematically meaningful. */
  readonly why: string;
  /** Default slider. A toggle runs from 0 to 1; a choice from 0 to one less than its options. */
  readonly control?: ControlKind;
  /** A choice's options, in order. */
  readonly options?: readonly string[];
}

export interface PlanOutput {
  readonly name: string;
  /** Inputs this output depends on; an output no input can change is rejected. */
  readonly dependsOn: readonly string[];
}

/** A parameter state where the model is singular, e.g. an object at a lens's focal length. */
export type SingularPoint = Readonly<Record<string, number>>;

export interface ScenePlan {
  readonly concept: string;
  /** One sentence: what the figure teaches. */
  readonly idea: string;
  readonly kind: SceneKind;
  /** Default quick. */
  readonly size?: SceneSize;
  /** SDK capabilities the scene will use, e.g. graph2d, svg, formula. */
  readonly capabilities: readonly string[];
  readonly parameters: readonly PlanParameter[];
  readonly model: { readonly inputs: readonly string[]; readonly outputs: readonly PlanOutput[] };
  readonly parts: readonly string[];
  readonly moves: string;
  readonly steps: readonly string[];
  readonly singularPoints?: readonly SingularPoint[];
}
