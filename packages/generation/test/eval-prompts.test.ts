import { describe, expect, it } from 'vitest';
import { loadEvalPrompts } from '../src';

describe('eval prompt set', () => {
  const set = loadEvalPrompts();

  it('covers exactly the three v0.1 concepts', () => {
    expect(set.concepts.map((c) => c.id).sort()).toEqual(['projectile-motion', 'sine-wave', 'thin-lens']);
  });

  it('has several distinct phrasings per concept', () => {
    for (const concept of set.concepts) {
      expect(concept.phrasings.length, concept.id).toBeGreaterThanOrEqual(8);
      expect(new Set(concept.phrasings).size, concept.id).toBe(concept.phrasings.length);
    }
  });

  it('keeps parameter expectations within the v0.1 limit of three', () => {
    for (const concept of set.concepts) {
      expect(concept.expects.maxParams).toBeLessThanOrEqual(3);
      expect(concept.expects.minParams).toBeGreaterThanOrEqual(1);
    }
  });

  it('expects the thin lens plan to declare its singular point', () => {
    const lens = set.concepts.find((c) => c.id === 'thin-lens');
    expect(lens?.expects.singularPoints).toBe(true);
  });
});
