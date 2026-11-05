import prompts from '../evals/film-prompts.json' with { type: 'json' };

export interface FilmEvalConcept {
  readonly id: string;
  readonly concept: string;
  /** Length presets in seconds this concept runs at. */
  readonly lengths: readonly number[];
  readonly phrasings: readonly string[];
}

export interface FilmEvalPromptSet {
  readonly version: number;
  readonly concepts: readonly FilmEvalConcept[];
}

export function loadFilmEvalPrompts(): FilmEvalPromptSet {
  return prompts as FilmEvalPromptSet;
}
