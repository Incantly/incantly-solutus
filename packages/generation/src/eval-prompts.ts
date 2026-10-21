import prompts from '../evals/prompts.json' with { type: 'json' };

export interface EvalExpectations {
  /** Each entry lists acceptable names for one quantity the figure should expose. */
  readonly quantities: readonly (readonly string[])[];
  readonly minParams: number;
  readonly maxParams: number;
  readonly readouts: readonly (readonly string[])[];
  /** Whether the plan must declare at least one singular point. */
  readonly singularPoints: boolean;
}

export interface EvalConcept {
  readonly id: string;
  readonly concept: string;
  /** Id of the concept's own reviewed example, withheld in leak-free runs. */
  readonly example: string;
  readonly expects: EvalExpectations;
  readonly phrasings: readonly string[];
}

export interface EvalPromptSet {
  readonly version: number;
  readonly concepts: readonly EvalConcept[];
}

export function loadEvalPrompts(): EvalPromptSet {
  return prompts as EvalPromptSet;
}
