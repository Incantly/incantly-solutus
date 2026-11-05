import { describe, expect, it } from 'vitest';
import { filmPresetFor, FILM_LENGTH_PRESETS } from '@incantly/core';
import { loadFilmEvalPrompts } from '../src';

describe('film eval prompt set', () => {
  const set = loadFilmEvalPrompts();

  it('is versioned', () => {
    expect(set.version).toBe(1);
  });

  it('covers every length preset with a concept each', () => {
    const lengths = [...new Set(set.concepts.flatMap((c) => c.lengths))].sort((a, b) => a - b);
    expect(lengths).toEqual([...FILM_LENGTH_PRESETS]);
    for (const concept of set.concepts) {
      for (const length of concept.lengths) expect(FILM_LENGTH_PRESETS, concept.id).toContain(length);
      expect(filmPresetFor(concept.lengths[0]!).scenes).toBeGreaterThanOrEqual(1);
    }
  });

  it('has several distinct phrasings per concept', () => {
    for (const concept of set.concepts) {
      expect(concept.phrasings.length, concept.id).toBeGreaterThanOrEqual(3);
      expect(new Set(concept.phrasings).size, concept.id).toBe(concept.phrasings.length);
      for (const phrasing of concept.phrasings) expect(phrasing.trim().length, concept.id).toBeGreaterThan(10);
    }
  });

  it('names a distinct concept per id', () => {
    const ids = set.concepts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const concept of set.concepts) expect(concept.concept.trim().length, concept.id).toBeGreaterThan(3);
  });
});
