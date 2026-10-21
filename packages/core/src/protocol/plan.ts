/**
 * The plan: backend metadata written before a scene, never executed or
 * rendered. The probe reads its declared parts and singular points.
 */
export type SceneKind = 'graph' | 'motion' | 'diagram';

export interface PlanParameter {
  readonly name: string;
  readonly unit?: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  /** Why these bounds are physically or mathematically meaningful. */
  readonly why: string;
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
  /** SDK capabilities the scene will use, e.g. graph2d, svg, formula. */
  readonly capabilities: readonly string[];
  readonly parameters: readonly PlanParameter[];
  readonly model: { readonly inputs: readonly string[]; readonly outputs: readonly PlanOutput[] };
  readonly parts: readonly string[];
  readonly moves: string;
  readonly steps: readonly string[];
  readonly singularPoints?: readonly SingularPoint[];
}
