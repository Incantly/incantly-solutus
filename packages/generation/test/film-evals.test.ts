import { describe, expect, it } from 'vitest';
import { validateScene } from '@incantly/core';
import { checkFilmExpectations, filmSummaryMarkdown, planFilmTrials, recheckFilm, runFilmEvals, summarizeFilmEvals } from '../src/film-evals';
import { loadFilmEvalPrompts } from '../src/film-eval-prompts';
import { filmReferenceModel } from '../src/film-reference';
import { generateFilm } from '../src/film';
import type { SceneProber } from '../src/probe';
import { StubNarrator } from '../src/tts';

describe('planning film trials', () => {
  it('runs every concept at its lengths, phrasings in turn', () => {
    const prompts = loadFilmEvalPrompts();
    const planned = planFilmTrials(prompts, { trialsPerConcept: 2 });
    expect(planned.length).toBe(prompts.concepts.reduce((sum, c) => sum + c.lengths.length * 2, 0));
    const pendulum = planned.filter((t) => t.concept.id === 'pendulum');
    expect(pendulum.map((t) => t.length)).toEqual([30, 30]);
    expect(pendulum.map((t) => t.phrasing)).toEqual([0, 1]);
  });

  it('filters to concepts and lengths', () => {
    const prompts = loadFilmEvalPrompts();
    const planned = planFilmTrials(prompts, { trialsPerConcept: 1, concepts: ['wave'], lengths: [60] });
    expect(planned).toHaveLength(1);
    expect(planFilmTrials(prompts, { trialsPerConcept: 1, concepts: ['wave'], lengths: [30] })).toHaveLength(0);
  });
});

describe('film storyboard expectations', () => {
  it('wants the preset scene count and the shared context past one scene', () => {
    expect(checkFilmExpectations(null, 30)).toEqual(['no storyboard']);
    const state = { film: { title: 'T', lengthTarget: 120, context: { palette: '', parts: [], notation: '', units: {}, tone: '' } }, scenes: [{}, {}] };
    expect(checkFilmExpectations(state as never, 120)).toEqual([]);
    expect(checkFilmExpectations(state as never, 30)).toEqual(['a 30 s film holds 1 scenes, not 2']);
    const lonely = { film: { title: 'T', lengthTarget: 120 }, scenes: [{}, {}] };
    expect(checkFilmExpectations(lonely as never, 120)).toEqual(['no shared context for several scenes']);
  });
});

describe('running the film evals', () => {
  it('passes a one-trial concept with the gate met and no broken film', async () => {
    const seen: number[] = [];
    const { trials, summary } = await runFilmEvals({
      trialsPerConcept: 1,
      concepts: ['pendulum'],
      onTrial: (_, done) => seen.push(done),
    });
    expect(trials).toHaveLength(1);
    expect(trials[0]!.passed).toBe(true);
    expect(trials[0]!.firstAttempt).toBe(true);
    expect(trials[0]!.broken).toBe(false);
    expect(trials[0]!.failure).toBeNull();
    expect(trials[0]!.expectations).toEqual([]);
    expect(seen).toEqual([1]);
    expect(summary.trials).toBe(1);
    expect(summary.promptsVersion).toBe(1);
    expect(summary.brokenShown).toBe(0);
    expect(summary.gate).toEqual({ noBrokenFilms: true });
    expect(summary.byLength['30s']!.postRepair.rate).toBe(1);
  }, 60_000);

  it('a film that fails its re-check is broken and fails the gate, never passing silently', async () => {
    let calls = 0;
    const stats = { configurations: 1, frames: 1, averageFrameMs: 0, elements: 1, durationMs: 0 };
    const flaky: SceneProber = async () => {
      calls++;
      // Generation's own probe passes; the from-scratch re-probe fails.
      if (calls === 1) return { ok: true, failures: [], stats };
      return { ok: false, failures: [{ check: 'mount', message: 'a part went missing' }], stats };
    };
    const { trials, summary } = await runFilmEvals({ trialsPerConcept: 1, concepts: ['pendulum'], probe: flaky, concurrency: 1 });
    expect(trials[0]!.passed).toBe(false);
    expect(trials[0]!.broken).toBe(true);
    expect(trials[0]!.failure).toContain('no longer probes');
    expect(summary.brokenShown).toBe(1);
    expect(summary.gate.noBrokenFilms).toBe(false);
  }, 60_000);

  it('re-validates from scratch: tampered fragments break the re-check', async () => {
    const state = await generateFilm({ prompt: 'How dots shift', lengthTarget: 30 }, { model: filmReferenceModel(), narrator: new StubNarrator() });
    expect(state.fallback).toBeNull();
    expect(await recheckFilm(state, null)).toBeNull();
    const tampered = {
      ...state,
      scenes: state.scenes.map((scene) => ({ ...scene, fragments: scene.fragments ? { ...scene.fragments, js: `${scene.fragments.js}\nfetch('https://example.com/x');\n` } : null })),
    };
    expect(await recheckFilm(tampered, null)).toContain('no longer validates');
    expect(validateScene({ html: tampered.scenes[0]!.fragments!.html, css: '', js: tampered.scenes[0]!.fragments!.js }).ok).toBe(false);
  }, 60_000);
});

describe('the film eval summary', () => {
  it('reports rates, repairs and the gate as Markdown', async () => {
    const { summary } = await runFilmEvals({ trialsPerConcept: 1, concepts: ['pendulum', 'wave'] });
    expect(summary.trials).toBe(2);
    expect(summary.postRepair.rate).toBe(1);
    expect(Object.keys(summary.byConcept).sort()).toEqual(['pendulum', 'wave']);
    const markdown = filmSummaryMarkdown(summary);
    expect(markdown).toContain('# Film evals: film-reference, prompts v1');
    expect(markdown).toContain('| Broken films shown | 0 | none |');
    expect(summarizeFilmEvals([], 1, 'film-reference').gate).toEqual({ noBrokenFilms: true });
  }, 120_000);
});
