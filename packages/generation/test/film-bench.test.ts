import { describe, expect, it } from 'vitest';
import { filmPresetFor, FILM_PLAN_TOKENS_PER_SCENE, FILM_SCENE_MAX_SECONDS } from '@incantly/core';
import { deriveFilmCaps, filmBenchMarkdown, FILM_MODEL_ALLOWANCE_MS, FILM_SEEK_LIMIT_MS, runFilmBench } from '../src/film-bench';

describe('deriving the film caps from bench numbers', () => {
  it('fits when the plan, the seeks and the deadlines hold', () => {
    const caps = deriveFilmCaps(
      [{ planTokensPerScene: 120, scenes: 2 }],
      [{ ms: 40 }, { ms: 90 }],
      [{ length: 30, deadlineMs: 25_000, codeMs: 2000 }],
    );
    expect(caps.planTokensPerScene).toMatchObject({ measured: 120, cap: FILM_PLAN_TOKENS_PER_SCENE, fits: true });
    expect(caps.seekMs).toMatchObject({ measured: 90, limit: FILM_SEEK_LIMIT_MS, sceneCapSeconds: FILM_SCENE_MAX_SECONDS, fits: true });
    expect(caps.deadlines).toEqual([{ length: 30, deadlineMs: 25_000, codeMs: 2000, allowanceMs: FILM_MODEL_ALLOWANCE_MS, fits: true }]);
    expect(caps.fits).toBe(true);
  });

  it('refuses each cap that exceeds', () => {
    const caps = deriveFilmCaps([{ planTokensPerScene: 900, scenes: 2 }], [{ ms: 400 }], [{ length: 30, deadlineMs: 25_000, codeMs: 20_000 }]);
    expect(caps.planTokensPerScene.fits).toBe(false);
    expect(caps.seekMs.fits).toBe(false);
    expect(caps.deadlines[0]!.fits).toBe(false);
    expect(caps.fits).toBe(false);
  });
});

describe('running the film bench', () => {
  it('reports tokens, dollars, pace and a holding derivation at one length', async () => {
    const report = await runFilmBench({ lengths: [30], trialsPerLength: 1 });
    expect(report.model).toBe('film-reference');
    expect(report.lengths).toHaveLength(1);
    const line = report.lengths[0]!;
    expect(line.length).toBe(30);
    expect(line.films).toBe(1);
    expect(line.scenes).toBe(filmPresetFor(30).scenes);
    expect(line.outputTokens).toBeGreaterThan(0);
    expect(line.usd).toBeGreaterThanOrEqual(0);
    expect(line.speechChars).toBeGreaterThan(0);
    expect(line.firstSceneMs).toHaveLength(1);
    expect(line.totalMs).toHaveLength(1);
    expect(line.repairs).toBe(0);
    expect(line.planTokensPerScene).toBeGreaterThan(0);
    expect(line.planTokensPerScene).toBeLessThanOrEqual(FILM_PLAN_TOKENS_PER_SCENE);

    expect(report.seek.length).toBe(6);
    expect(report.seek.some((s) => s.seconds === 59)).toBe(true);
    // The svg scene's long seek holds the scrub limit with room to spare; the
    // plot scene's is reported beside it, with the derivation's rationale.
    expect(report.seek.find((s) => s.fixture === 'pendulum' && s.seconds === 59)!.ms).toBeLessThanOrEqual(FILM_SEEK_LIMIT_MS);
    expect(report.export.frames).toBeGreaterThan(0);
    expect(report.export.filmSeconds).toBeGreaterThan(0);
    expect(report.export.msPerFilmMinute).toBeGreaterThanOrEqual(0);
    expect(report.answer.firstWordsMs).toBeGreaterThanOrEqual(0);
    expect(report.speech.beats).toBe(6);
    expect(report.speech.msPerBeat).toBeGreaterThanOrEqual(0);

    expect(report.caps.planTokensPerScene.fits).toBe(true);
    expect(report.caps.deadlines).toHaveLength(1);
    expect(report.caps.deadlines[0]!.fits).toBe(true);
    const markdown = filmBenchMarkdown(report);
    expect(markdown).toContain('# Film bench: film-reference');
    expect(markdown).toContain('## Cap derivation');
    expect(markdown).toContain('## Pace off the generation path');
  }, 180_000);
});
