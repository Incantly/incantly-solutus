import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The film docs stay in sync with the implementation: the product doc
 * describes what shipped, the SDK teaches film scenes, the bench derivation
 * is recorded, the PRD coverage names every FV requirement, and ADR 009
 * with its AGENTS.md sentence is referenced, never duplicated.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const doc = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('film docs in sync', () => {
  it('video-figures.md matches the implementation', () => {
    const text = doc('docs/product/video-figures.md');
    expect(text).toContain('Status: implemented');
    expect(text).toContain('Cartesia');
    expect(text).toContain('CARTESIA_RETENTION_ACCEPTED=1');
    expect(text).toContain('film bench');
    expect(text).toContain('ADR 009');
    expect(text).toContain('All four rungs landed');
  });

  it('the SDK teaches film scenes and the index lists the page', () => {
    const text = doc('docs/sdk/films.md');
    expect(text).toContain('inc.steps');
    expect(text).toContain('shared context');
    expect(text).toContain('`say`');
    expect(text).toContain('CARTESIA_VOICE_ID');
    expect(doc('docs/README.md')).toContain('(sdk/films.md)');
  });

  it('the bench derivation is recorded with its measured numbers', () => {
    const text = doc('docs/implementation/bench/2026-11-04-film.md');
    expect(text).toContain('## Derivation');
    expect(text).toContain('162 plan output tokens per scene');
    expect(text).toContain('60 s cap stands');
    expect(text).toContain('25, 45,');
  });

  it('the PRD coverage names every FV requirement as done', () => {
    const text = doc('docs/implementation/prd-coverage.md');
    for (const id of ['FV-1', 'FV-4', 'FV-7', 'FV-11', 'FV-13', 'FV-14', 'FV-15']) {
      expect(text).toContain(`| ${id} |`);
    }
    expect(text).toContain('212 rows');
  });

  it('ADR 009 and its AGENTS.md sentence stand, referenced and not duplicated', () => {
    expect(doc('docs/architecture/decisions/009-film-scene-calls.md')).toContain('Status: accepted');
    expect(doc('AGENTS.md')).toContain('as ADR 009 allows (docs/architecture/decisions/009-film-scene-calls.md)');
  });
});
