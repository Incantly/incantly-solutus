import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  anchorWords,
  askAnchorFor,
  askContextLine,
  askWordIndex,
  AskReturnStack,
  attachAudio,
  BACK_TO_FILM_SECONDS,
  beginShowMe,
  FilmController,
  InsertPlayer,
  PlayerModel,
  resolveAskAnchor,
  routeQuestion,
  SceneRuntime,
  THIRTY_SECOND_FILM,
  validateInsertClip,
  wordStarts,
  type AskAnchor,
  type CompiledFilm,
  type FilmSceneInput,
  type InsertClip,
} from '../src/index';
import { trustFixture } from './helpers/film';

function mounted(scene: FilmSceneInput): SceneRuntime {
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true });
  runtime.mount(scene.scene);
  return runtime;
}

function snapshot(runtime: SceneRuntime): string {
  const parts = [...runtime.parts.parts.values()]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((p) => [p.name, p.node.hidden, [...p.node.attrs].sort(), p.node.text]);
  return JSON.stringify({ parts, values: runtime.values(), focus: runtime.uiState().focus });
}

/** Drives a driver-mode controller to a film time, resuming through pause points. */
function driveTo(controller: FilmController, target: number): void {
  for (let i = 0; i < 20000 && controller.time + 1e-9 < target; i++) {
    if (!controller.isPlaying) controller.play();
    controller.tick(1 / 60);
    if (!controller.isPlaying && controller.time + 1e-9 >= target) break;
  }
}

async function thirty(): Promise<{ film: CompiledFilm; scenes: readonly FilmSceneInput[] }> {
  return trustFixture(THIRTY_SECOND_FILM);
}

function anchorFor(film: CompiledFilm, beat: string, wordIndex: number): AskAnchor {
  const found = film.beats.find((candidate) => candidate.id === beat)!;
  return { film: film.id, version: film.version, scene: found.sceneId, beat, wordIndex, controlValues: {}, readouts: [] };
}

describe('film ask: word-boundary anchors', () => {
  it('pauses the clock at the current word with values and readouts', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    driveTo(controller, film.beats[2]!.start + 0.6);
    expect(controller.isPlaying).toBe(true);
    const asked = controller.ask('What does it trade?');
    expect(controller.isPlaying).toBe(false);
    expect(asked?.beat.id).toBe('s1b3');
    // Estimated 2.5 words per second: 0.6 s in is word 1 ("trades").
    expect(asked?.anchor.wordIndex).toBe(1);
    expect(asked?.anchor).toMatchObject({ film: 'pendulum', version: 1, scene: 's1', beat: 's1b3' });
    expect(asked?.anchor.controlValues).toMatchObject({ angle: expect.any(Number) });
    expect(Array.isArray(asked?.anchor.readouts)).toBe(true);
    expect(asked?.lines.map((line) => line.beat)).toEqual(['s1b2', 's1b3', 's1b4']);
    controller.destroy();
  });

  it('anchors from estimated timings while the film is silent', async () => {
    const { film } = await thirty();
    const beat = film.beats[0]!;
    expect(beat.timed).toBe(false);
    expect(askWordIndex(beat, beat.start)).toBe(0);
    expect(askWordIndex(beat, beat.start + 0.39)).toBe(0);
    expect(askWordIndex(beat, beat.start + 0.4)).toBe(1);
    expect(askWordIndex(beat, beat.start + 99)).toBe(beat.words.length - 1);
    const anchor = askAnchorFor(film, beat.id, beat.start + 0.4);
    expect(anchor?.wordIndex).toBe(1);
    expect(resolveAskAnchor(film, anchor!)).toBeCloseTo(beat.start + 0.4, 9);
  });

  it('anchors from word timings once narration arrives', async () => {
    const { film } = await thirty();
    const beat = film.beats[0]!;
    const starts = beat.words.map((_, i) => i * 0.3);
    const timed = attachAudio(film, beat.id, { seconds: starts.length * 0.3, words: starts });
    const next = timed.beats[0]!;
    expect(next.timed).toBe(true);
    expect(wordStarts(next)[2]).toBeCloseTo(next.start + 0.6, 9);
    expect(askWordIndex(next, next.start + 0.65)).toBe(2);
    const anchor = askAnchorFor(timed, beat.id, next.start + 0.65);
    expect(resolveAskAnchor(timed, anchor!)).toBeCloseTo(next.start + 0.6, 9);
  });

  it('resolves by beat and word, never seconds, and rejects moved-on films', async () => {
    const { film } = await thirty();
    const anchor = askAnchorFor(film, 's1b1', film.beats[0]!.start + 0.8)!;
    expect(anchor.wordIndex).toBe(2);
    // Re-timing moves the anchor along with its word.
    const timed = attachAudio(film, 's1b1', { seconds: 6, words: film.beats[0]!.words.map((_, i) => i * 0.5) });
    expect(resolveAskAnchor(timed, anchor)).toBeCloseTo(timed.beats[0]!.start + 1.0, 9);
    expect(resolveAskAnchor(timed, { ...anchor, version: 99 })).toBeNull();
    expect(resolveAskAnchor(timed, { ...anchor, beat: 'missing' })).toBeNull();
    expect(askAnchorFor(film, 'missing', 0)).toBeNull();
  });

  it('names the beat and the anchor words for the ask sheet', async () => {
    const { film } = await thirty();
    const anchor = anchorFor(film, 's1b3', 1);
    expect(anchorWords(film, anchor)).toBe('It trades height for …');
    expect(askContextLine(film, anchor)).toBe('s1b3 · “It trades height for …”');
    expect(anchorWords(film, { ...anchor, beat: 'missing' })).toBe('');
  });
});

describe('film ask: cheapest-rung router', () => {
  it('answers first, shows on demonstration, goes deeper on new clips', () => {
    expect(routeQuestion('Explain this step')).toBe('answer');
    expect(routeQuestion('Why does every swing take the same time?')).toBe('answer');
    expect(routeQuestion('Show me')).toBe('showme');
    expect(routeQuestion('Show me that swing again')).toBe('showme');
    expect(routeQuestion('Can I watch the bob move?')).toBe('showme');
    expect(routeQuestion('Explain deeper')).toBe('deeper');
    expect(routeQuestion('Tell me more, step by step from the start')).toBe('deeper');
    // Deterministic: the same words always take the same rung.
    expect(routeQuestion('Show me')).toBe(routeQuestion('show ME'));
  });
});

describe('film ask: return stack', () => {
  it('nests one deep, refuses a third push, and pops back to anchor words', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const stack = new AskReturnStack();
    const first = anchorFor(film, 's1b2', 3);
    const nested = anchorFor(film, 's1b4', 1);
    expect(stack.push(first)).toBe(true);
    expect(stack.push(nested)).toBe(true);
    expect(stack.depth).toBe(2);
    expect(stack.peek()).toBe(nested);
    expect(stack.push(anchorFor(film, 's1b5', 0))).toBe(false);

    // Each pop resumes at its anchor word.
    controller.play();
    driveTo(controller, film.beats[5]!.start + 0.5);
    expect(stack.pop()).toBe(nested);
    expect(controller.seekAskAnchor(nested)).toBe(true);
    expect(controller.time).toBeCloseTo(resolveAskAnchor(film, nested)!, 9);
    expect(controller.currentBeat?.id).toBe('s1b4');
    expect(stack.pop()).toBe(first);
    expect(controller.seekAskAnchor(first)).toBe(true);
    expect(controller.time).toBeCloseTo(resolveAskAnchor(film, first)!, 9);
    expect(stack.pop()).toBeNull();
    controller.destroy();
  });
});

describe('film ask: show me', () => {
  it('replays beat fields deterministically and restores values', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    driveTo(controller, film.beats[4]!.start + 0.3);
    const before = snapshot(runtime);
    const beat = controller.currentBeat!;
    expect(beat.id).toBe('s1b5');

    // The beat's show list and set land on the live scene, silently.
    const shown = beginShowMe(runtime, beat);
    expect(shown.cues.focusing).toBe('Push');
    expect(shown.cues.sfxPlayed).toBe(false);
    expect(runtime.values().push).toBe(0.8);
    expect(runtime.parts.parts.get('Push')?.node.hidden).toBe(false);
    const replayed = snapshot(runtime);

    // Replay draws the same frame; restoring returns values, visibility and focus.
    expect(snapshot(runtime)).toBe(replayed);
    shown.replay();
    expect(snapshot(runtime)).toBe(replayed);
    shown.restore();
    expect(shown.restored).toBe(true);
    expect(snapshot(runtime)).toBe(before);

    // A second session from the same scene draws the same replay.
    const again = beginShowMe(runtime, beat);
    expect(snapshot(runtime)).toBe(replayed);
    again.restore();
    expect(snapshot(runtime)).toBe(before);
    controller.destroy();
  });

  it('restores a focus the replay moved', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.seek(film.beats[0]!.start + 0.1);
    expect(runtime.uiState().focus).toBe('Pivot');
    const shown = beginShowMe(runtime, film.beats[2]!);
    expect(runtime.uiState().focus).toBe('Bob');
    shown.restore();
    expect(runtime.uiState().focus).toBe('Pivot');
    controller.destroy();
  });
});

describe('film ask: inserts', () => {
  it('pins clips to anchors and rejects what the film cannot play', async () => {
    const { film } = await thirty();
    const params = new Set(['angle', 'push']);
    const anchor = askAnchorFor(film, 's1b3', film.beats[2]!.start + 0.6)!;
    const valid = validateInsertClip(
      { anchor, lines: [{ say: 'The bob moves fastest at the bottom.', set: { angle: 0.9 } }, { say: 'That is the whole trade.', seconds: 2 }] },
      film,
      params,
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.clip.anchor.beat).toBe('s1b3');
      expect(valid.clip.lines).toHaveLength(2);
      expect(valid.clip.seconds).toBeGreaterThan(2);
    }
    expect(validateInsertClip({ anchor: { ...anchor, beat: 'missing' }, lines: [{ say: 'Lost.' }] }, film, params)).toMatchObject({ ok: false });
    expect(validateInsertClip({ anchor, lines: [] }, film, params)).toMatchObject({ ok: false });
    expect(validateInsertClip({ anchor, lines: [{ say: 'x', set: { height: 1 } }] }, film, params)).toMatchObject({ ok: false });
    expect(validateInsertClip({ anchor, lines: [{ say: '' }] }, film, params)).toMatchObject({ ok: false });
    expect(validateInsertClip({ anchor, lines: Array.from({ length: 5 }, () => ({ say: 'Too many.' })) }, film, params)).toMatchObject({ ok: false });
  });

  it('hands each clip a unique id, even for the same words twice or elsewhere', async () => {
    const { film } = await thirty();
    const params = new Set<string>();
    const lines = [{ say: 'The bob moves fastest at the bottom.', seconds: 3 }];
    const first = validateInsertClip({ anchor: anchorFor(film, 's1b3', 1), lines }, film, params);
    const second = validateInsertClip({ anchor: anchorFor(film, 's1b3', 1), lines }, film, params);
    const elsewhere = validateInsertClip({ anchor: anchorFor(film, 's1b1', 0), lines }, film, params);
    expect(first.ok && second.ok && elsewhere.ok).toBe(true);
    if (!first.ok || !second.ok || !elsewhere.ok) return;
    // Same asker, same words, same anchor: still two inserts, never one id.
    expect(second.clip.id).not.toBe(first.clip.id);
    // Same words at another anchor: no overwrite, no ambiguity.
    expect(elsewhere.clip.id).not.toBe(first.clip.id);
    for (const clip of [first.clip, second.clip, elsewhere.clip]) {
      expect(clip.id).toMatch(/^[\w-]{1,80}$/);
    }
    // An asked-for id still lands untouched.
    const named = validateInsertClip({ id: 'insert-1', anchor: anchorFor(film, 's1b3', 1), lines }, film, params);
    expect(named.ok && named.clip.id).toBe('insert-1');
  });

  function clip(film: CompiledFilm): InsertClip {
    const anchor = askAnchorFor(film, 's1b3', film.beats[2]!.start + 0.6)!;
    const valid = validateInsertClip({ anchor, lines: [{ say: 'First line.', seconds: 2 }, { say: 'Second line.', seconds: 3 }] }, film, new Set());
    if (!valid.ok) throw new Error(valid.problems.join('; '));
    return valid.clip;
  }

  it('auto-resumes at the anchor word after a back-to-film beat', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    driveTo(controller, film.beats[2]!.start + 0.6);
    // The anchor word's start: 0.6 s in is word 1, which starts at 0.4 s.
    const anchorSeconds = film.beats[2]!.start + 0.4;
    const events: string[] = [];
    const player = new InsertPlayer(controller, film, clip(film), { onEvent: (event) => events.push(event.type) });
    expect(player.play()).toBe(true);
    expect(controller.isPlaying).toBe(false);
    expect(player.currentPhase).toBe('insert');
    expect(player.remaining).toBeCloseTo(5 + BACK_TO_FILM_SECONDS, 9);

    player.tick(2.5);
    expect(player.currentLineIndex).toBe(1);
    player.tick(2.5);
    expect(player.currentPhase).toBe('back');
    expect(player.currentLine).toBeNull();
    player.tick(BACK_TO_FILM_SECONDS - 0.1);
    expect(controller.isPlaying).toBe(false);
    player.tick(0.1);
    expect(player.currentPhase).toBe('done');
    expect(player.remaining).toBe(0);
    expect(controller.isPlaying).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b3');
    expect(controller.time).toBeCloseTo(anchorSeconds, 2);
    expect(events).toEqual(['line', 'line', 'back', 'resume']);
    controller.destroy();
  });

  it('backs now and applies line values to the live scene', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    driveTo(controller, film.beats[2]!.start + 0.6);
    const anchor = askAnchorFor(film, 's1b3', controller.time)!;
    const valid = validateInsertClip({ anchor, lines: [{ say: 'Wider.', seconds: 4, set: { angle: 1.0 } }] }, film, new Set(['angle']));
    if (!valid.ok) throw new Error(valid.problems.join('; '));
    const player = new InsertPlayer(controller, film, valid.clip, { applySet: (set) => runtime.setValues(set) });
    player.play();
    expect(runtime.values().angle).toBe(1.0);
    player.skipToFilm();
    expect(player.currentPhase).toBe('done');
    expect(controller.isPlaying).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b3');
    controller.destroy();
  });

  it('nests one insert inside another, then resumes the film', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    driveTo(controller, film.beats[2]!.start + 0.6);
    const stack = new AskReturnStack();
    const outer = new InsertPlayer(controller, film, clip(film));
    stack.push(anchorFor(film, 's1b3', 1));
    expect(outer.play()).toBe(true);
    outer.tick(1);
    // A nested question pauses the outer insert and plays its own.
    const nestedAnchor = askAnchorFor(film, 's1b3', controller.time)!;
    stack.push(nestedAnchor);
    const inner = new InsertPlayer(controller, film, clip(film), { resumeToFilm: false });
    expect(inner.play()).toBe(true);
    inner.tick(5);
    inner.tick(BACK_TO_FILM_SECONDS);
    expect(inner.currentPhase).toBe('done');
    // The inner insert ends back in the outer one: the film stays paused.
    expect(controller.isPlaying).toBe(false);
    expect(stack.pop()).toBe(nestedAnchor);
    outer.tick(4);
    outer.tick(BACK_TO_FILM_SECONDS);
    expect(outer.currentPhase).toBe('done');
    expect(controller.isPlaying).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b3');
    controller.destroy();
  });

  it('plays the film on when its anchor no longer resolves', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.seek(film.beats[1]!.start);
    const moved = { ...film, version: film.version + 1 };
    const player = new InsertPlayer(controller, moved, clip(film));
    expect(player.play()).toBe(false);
    expect(controller.isPlaying).toBe(true);
    controller.destroy();
  });
});

describe('film ask: markers', () => {
  it('pins question markers to the scrubber and the transcript', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const model = new PlayerModel(controller, film);
    controller.seek(film.beats[2]!.start + 0.6);
    const asked = model.ask('What does it trade?')!;
    model.addMarker(asked.anchor, 'What does it trade?');
    controller.seek(film.beats[4]!.start + 0.2);
    model.addMarker(model.anchorNow()!, 'Why a push?');
    expect(model.markers).toHaveLength(2);
    const times = model.markerTimes();
    expect(times).toHaveLength(2);
    expect(times[0]).toBeCloseTo(film.beats[2]!.start + 0.4, 9);
    expect(model.markersForBeat('s1b3')).toHaveLength(1);
    expect(model.markersForBeat('s1b5')).toHaveLength(1);
    expect(model.markersForBeat('s1b1')).toHaveLength(0);
    // Markers re-time along with the audio.
    const timed = attachAudio(film, 's1b1', { seconds: 9, words: film.beats[0]!.words.map((_, i) => i * 0.7) });
    controller.retime(timed);
    model.retime(timed);
    expect(model.markerTimes()[0]).toBeCloseTo(times[0]! + (timed.beats[2]!.start - film.beats[2]!.start), 9);
    model.clearMarkers();
    expect(model.markers).toHaveLength(0);
    controller.destroy();
  });
});

describe('film ask: timings', () => {
  it('anchors and resumes within budget', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.seek(film.beats[2]!.start + 0.6);
    const anchorRuns: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      controller.anchorNow();
      anchorRuns.push(performance.now() - started);
    }
    const anchor = controller.anchorNow()!;
    const resumeRuns: number[] = [];
    for (let i = 0; i < 5; i++) {
      controller.seek(film.beats[5]!.start);
      const started = performance.now();
      controller.seekAskAnchor(anchor);
      resumeRuns.push(performance.now() - started);
    }
    const mean = (runs: number[]) => runs.reduce((a, b) => a + b, 0) / runs.length;
    const bench = { anchorMs: mean(anchorRuns), resumeMs: mean(resumeRuns) };
    writeFileSync('/tmp/film-ask-bench.json', JSON.stringify(bench, null, 1));
    expect(bench.anchorMs).toBeLessThan(50);
    expect(bench.resumeMs).toBeLessThan(1000);
    controller.destroy();
  });
});
