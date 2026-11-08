import { describe, expect, it } from 'vitest';
import { compileFilm, contrastRatio, luminance, probeFilm, probeScene, PYTHAGORAS_FILM, SIXTY_SECOND_FILM, THIRTY_SECOND_FILM, type Beat, type SceneFunction } from '../src/index';
import { compileValidated } from './helpers/compile';
import { compileFixture } from './helpers/film';

describe('film checks: contrast', () => {
  it('measures luminance and ratios like WCAG', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 3);
    expect(luminance('#000000')).toBeCloseTo(0, 3);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#1f1f24', '#ffffff')).toBeGreaterThan(4.5);
    expect(contrastRatio('#ececf1', '#17171b')).toBeGreaterThan(4.5);
    expect(contrastRatio('#888888', '#ffffff')).toBeLessThan(4.5);
  });
});

describe('film checks: fixtures pass', () => {
  it('the 30 s film passes every beat at every width, light and dark', async () => {
    const { film, scenes, refuel } = await compileFixture(THIRTY_SECOND_FILM);
    const report = probeFilm({ film, scenes, beforeStep: refuel });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats.beats).toBe(6);
    expect(report.stats.points).toBe(18);
    console.log(`[film-bench] checks 30 s film: ${report.stats.msPerBeat.toFixed(1)} ms/beat (${report.stats.ms.toFixed(0)} ms total)`);
  });

  it(
    'the 1 min film passes every beat at every width, light and dark',
    async () => {
      const { film, scenes, refuel } = await compileFixture(SIXTY_SECOND_FILM);
      const report = probeFilm({ film, scenes, beforeStep: refuel });
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.stats.beats).toBe(8);
      console.log(`[film-bench] checks 1 min film: ${report.stats.msPerBeat.toFixed(1)} ms/beat (${report.stats.ms.toFixed(0)} ms total)`);
    },
    120000,
  );

  it('the Pythagoras film passes every beat at every width, light and dark', async () => {
    const { film, scenes, refuel } = await compileFixture(PYTHAGORAS_FILM);
    const report = probeFilm({ film, scenes, beforeStep: refuel });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats.beats).toBe(7);
    console.log(`[film-bench] checks Pythagoras film: ${report.stats.msPerBeat.toFixed(1)} ms/beat (${report.stats.ms.toFixed(0)} ms total)`);
  });

  it('all fixture scenes pass the probe', async () => {
    for (const fixture of [THIRTY_SECOND_FILM, SIXTY_SECOND_FILM, PYTHAGORAS_FILM]) {
      for (const scene of fixture.scenes) {
        const { scene: compiled, fuel } = compileValidated({ html: scene.html, css: scene.css, js: scene.js });
        const report = probeScene(compiled, { beforeStep: fuel.refuel, spec: { parts: [...scene.probe.parts], steps: scene.probe.steps } });
        expect(report.failures).toEqual([]);
      }
    }
  });
});

describe('film checks: failures', () => {
  it('fails low-contrast tokens', async () => {
    const { film, scenes, refuel } = await compileFixture(THIRTY_SECOND_FILM);
    const report = probeFilm({ film, scenes, beforeStep: refuel, widths: [640], themes: ['light'], tokens: { light: { fg: '#888888', bg: '#ffffff' }, dark: { fg: '#888888', bg: '#ffffff' } } });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.check === 'contrast')).toBe(true);
  });

  it('fails an unknown sfx cue', async () => {
    const { film, scenes, refuel } = await compileFixture(THIRTY_SECOND_FILM);
    const beats = film.beats.map((beat, i) => (i === 0 ? { ...beat, step: { ...beat.step, sfx: 'klaxon' } } : beat));
    const report = probeFilm({ film: { ...film, beats }, scenes, widths: [640], themes: ['light'], beforeStep: refuel });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.check === 'sfx' && f.message.includes('klaxon'))).toBe(true);
  });

  it('fails two moving emphases on one beat', async () => {
    const { film, scenes, refuel } = await compileFixture(THIRTY_SECOND_FILM);
    const beats = film.beats.map((beat, i) =>
      i === 0 ? { ...beat, step: { ...beat.step, mark: [{ type: 'pulse', part: 'Bob' }, { type: 'draw', part: 'Rod' }] as const } } : beat,
    );
    const report = probeFilm({ film: { ...film, beats }, scenes, widths: [640], themes: ['light'], beforeStep: refuel });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.check === 'one-emphasis')).toBe(true);
  });

  it('fails narration over the reading limit', async () => {
    const { film, scenes, refuel } = await compileFixture(THIRTY_SECOND_FILM);
    const first = film.beats[0]!;
    const words = 'word '.repeat(30).trim().split(' ');
    const beats = film.beats.map((beat, i) => (i === 0 ? { ...beat, words, seconds: 2 } : beat));
    const report = probeFilm({ film: { ...film, beats }, scenes, widths: [640], themes: ['light'], beforeStep: refuel });
    expect(first.words.length).toBeLessThan(words.length);
    expect(report.failures.some((f) => f.check === 'reading-speed')).toBe(true);
  });

  it('fails a focus drawn outside its stage', () => {
    const scene: SceneFunction = (inc) => {
      const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Far', description: 'A dot far outside the frame.' });
      const dot = stage.circle(900, 200, 10, { tone: 'hi' });
      stage.part('Far', dot, { label: 'Far', info: 'Outside the frame.' });
      inc.steps([{ say: 'Look far away now.', focus: 'Far' }]);
    };
    const steps: Beat[] = [{ say: 'Look far away now.', focus: 'Far' }];
    const spec = { film: { id: 'f', title: 'F' }, scenes: [{ id: 's1', beats: [{ id: 'b1', say: 'Look far away now.', focus: 'Far' }] }] };
    const compiled = compileFilm(spec, [{ id: 's1', js: "stage.part('Far', dot);", steps }]);
    expect(compiled.ok).toBe(true);
    const report = probeFilm({ film: compiled.film!, scenes: [{ id: 's1', scene }], widths: [640], themes: ['light'] });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.check === 'focus-in-frame' && f.message.includes('outside its stage'))).toBe(true);
  });

  it('replays earlier beats show and hide lists like play does', async () => {
    const { film, scenes, refuel } = await compileFixture(THIRTY_SECOND_FILM);
    // s1b5 hides Bob while s1b6 focuses him, so play draws him hidden there.
    const beats = film.beats.map((beat, i) => (i === 4 ? { ...beat, step: { ...beat.step, hide: ['Bob'] } } : beat));
    const compiledScenes = film.scenes.map((scene) => ({ ...scene, beats: beats.filter((beat) => beat.sceneId === scene.id) }));
    const report = probeFilm({ film: { ...film, scenes: compiledScenes, beats }, scenes, widths: [640], themes: ['light'], beforeStep: refuel });
    expect(report.failures.some((f) => f.check === 'focus-in-frame' && f.beat === 's1b6' && f.message.includes('hidden or draws nothing'))).toBe(true);
  });
});
