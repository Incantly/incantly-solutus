import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyFilmPatch,
  attachAudio,
  compileTrusted,
  exampleReturnSeconds,
  FilmController,
  formatFilmLink,
  parseFilmLink,
  PlayerModel,
  probeFilm,
  probeScene,
  resolveFilmLink,
  resolveFilmPosition,
  resumeKey,
  ResumeStore,
  routeQuestion,
  sanitizeFilmPatch,
  SceneRuntime,
  shortcutFor,
  SHORTCUTS,
  SideClipPlayer,
  THIRTY_SECOND_FILM,
  validateExampleClip,
  validateScene,
  type AskAnchor,
  type CompiledFilm,
  type FilmSceneInput,
} from '../src/index';
import { compileValidated } from './helpers/compile';
import { compileFixture, trustFixture } from './helpers/film';

async function thirty(): Promise<{ film: CompiledFilm; scenes: readonly FilmSceneInput[] }> {
  return trustFixture(THIRTY_SECOND_FILM);
}

function mounted(scene: FilmSceneInput): SceneRuntime {
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true });
  runtime.mount(scene.scene);
  return runtime;
}

function anchorFor(film: CompiledFilm, beat: string, wordIndex: number): AskAnchor {
  const found = film.beats.find((candidate) => candidate.id === beat)!;
  return { film: film.id, version: film.version, scene: found.sceneId, beat, wordIndex, controlValues: {}, readouts: [] };
}

function exampleInput(film: CompiledFilm, over: Record<string, unknown> = {}): Record<string, unknown> {
  const scene = THIRTY_SECOND_FILM.scenes[0]!;
  return {
    id: 'example-s1b3',
    anchor: { film: film.id, version: film.version, scene: 's1', beat: 's1b3', wordIndex: 1 },
    html: scene.html,
    css: scene.css,
    js: scene.js,
    caption: 'The same swing on a longer string.',
    ...over,
  };
}

function patchInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    film: 'pendulum',
    parent: 1,
    version: 2,
    reason: 'Say what pulls the pendulum down.',
    beats: [{ beat: 's1b1', scene: 's1', say: 'A pendulum hangs from its pivot, pulled down by gravity.' }],
    audio: [],
    ...over,
  };
}

describe('film ask full: cheapest-rung router across all four rungs', () => {
  const matrix: Array<[string, ReturnType<typeof routeQuestion>]> = [
    ['Explain this step', 'answer'],
    ['Why does every swing take the same time?', 'answer'],
    ['What pulls it down?', 'answer'],
    ['Show me', 'showme'],
    ['Show me that swing again', 'showme'],
    ['Can I watch the bob move?', 'showme'],
    ['Replay the swing', 'showme'],
    ['Demonstrate the push', 'showme'],
    ['Explain deeper', 'deeper'],
    ['Tell me more, step by step from the start', 'deeper'],
    ['Go deeper on friction', 'deeper'],
    ['Slow down and take it from the start', 'deeper'],
    ['Give me another example', 'example'],
    ['Show me another example', 'example'],
    ['A different example, please', 'example'],
    ['Can I see a new example?', 'example'],
    ['Show the two side by side', 'example'],
    ['Compared to a heavier bob?', 'example'],
  ];

  it.each(matrix)('routes "%s" to %s', (question, rung) => {
    expect(routeQuestion(question)).toBe(rung);
  });

  it('is deterministic and fast: the slowest rung runs only when picked', () => {
    expect(routeQuestion('Give me ANOTHER example')).toBe(routeQuestion('give me another example'));
    const questions = matrix.map(([question]) => question);
    const started = performance.now();
    const rounds = 20_000;
    for (let i = 0; i < rounds; i++) routeQuestion(questions[i % questions.length]!);
    const ms = performance.now() - started;
    const perQuestionUs = (ms * 1000) / rounds;
    writeFileSync('/tmp/film-router-bench.json', JSON.stringify({ rounds, ms: Math.round(ms * 10) / 10, perQuestionUs: Math.round(perQuestionUs * 100) / 100 }, null, 1));
    console.log(`[film-bench] router: ${perQuestionUs.toFixed(2)} µs/question over ${rounds} rounds (${ms.toFixed(0)} ms total)`);
    expect(perQuestionUs).toBeLessThan(1000);
  });
});

describe('film ask full: another-example side clips', () => {
  it('validates a side clip pinned to its anchor with a checked scene', async () => {
    const { film } = await thirty();
    const validated = validateExampleClip(exampleInput(film), film);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.clip.anchor).toMatchObject({ film: 'pendulum', version: 1, beat: 's1b3', wordIndex: 1 });
    expect(validated.clip.caption).toBe('The same swing on a longer string.');
    expect(exampleReturnSeconds(film, validated.clip)).not.toBeNull();
  });

  it('rejects clips pinned nowhere, saying nothing, or failing the scene checks', async () => {
    const { film } = await thirty();
    expect(validateExampleClip(exampleInput(film, { anchor: { film: 'pendulum', version: 1, scene: 's1', beat: 'missing', wordIndex: 0 } }), film).ok).toBe(false);
    expect(validateExampleClip(exampleInput(film, { anchor: { film: 'pendulum', version: 99, scene: 's1', beat: 's1b3', wordIndex: 0 } }), film).ok).toBe(false);
    expect(validateExampleClip(exampleInput(film, { caption: '  ' }), film).ok).toBe(false);
    expect(validateExampleClip(exampleInput(film, { js: 'fetch("https://example.com");' }), film).ok).toBe(false);
    expect(validateExampleClip(exampleInput(film, { html: 42 }), film).ok).toBe(false);
    expect(validateExampleClip('nope', film).ok).toBe(false);
  });

  it('opens over a paused film and returns to the anchor word', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const validated = validateExampleClip(exampleInput(film), film);
    if (!validated.ok) throw new Error(validated.problems.join('; '));
    controller.play();
    controller.seek(film.beats[2]!.start + 0.6);
    expect(controller.isPlaying).toBe(true);
    const player = new SideClipPlayer(controller, film, validated.clip);
    expect(player.open()).toBe(true);
    expect(controller.isPlaying).toBe(false);
    expect(player.currentPhase).toBe('open');
    player.tick(1.5);
    expect(player.elapsedSeconds).toBeCloseTo(1.5, 9);
    // The clip's own figure plays independently while the film waits.
    const clipRuntime = new SceneRuntime({ ...(scenes[0]!.kits ? { kits: scenes[0]!.kits } : {}) });
    clipRuntime.mount(compileTrusted(validated.clip.js));
    clipRuntime.play();
    const filmTime = controller.time;
    clipRuntime.tick(0.5);
    expect(clipRuntime.time).toBeGreaterThan(0);
    expect(controller.time).toBe(filmTime);
    player.closeToFilm();
    expect(player.currentPhase).toBe('done');
    expect(controller.isPlaying).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b3');
    controller.destroy();
  });

  it('plays the film on when the anchor no longer resolves', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const validated = validateExampleClip(exampleInput(film), film);
    if (!validated.ok) throw new Error(validated.problems.join('; '));
    const movedOn = { ...film, version: 2 };
    const player = new SideClipPlayer(controller, movedOn, validated.clip);
    controller.play();
    expect(player.open()).toBe(false);
    expect(controller.isPlaying).toBe(true);
    controller.destroy();
  });
});

describe('film ask full: version patches', () => {
  it('sanitizes a patch: parent link, one step up, narration only', () => {
    expect(sanitizeFilmPatch(patchInput()).ok).toBe(true);
    expect(sanitizeFilmPatch(patchInput({ parent: 2, version: 3 })).ok).toBe(true);
    expect(sanitizeFilmPatch(patchInput({ film: '' })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ version: 3 })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ reason: '' })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ beats: [] })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ beats: [{ beat: 's1b1', scene: 's1', say: '' }] })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ beats: [{ beat: 's1b1', scene: 's1', say: 'New words.', set: { angle: 1 } }] })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ beats: [{ beat: 's1b1', scene: 's1', say: 'One.' }, { beat: 's1b1', scene: 's1', say: 'Two.' }] })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ audio: [{ beat: 's1b1', seconds: -1 }] })).ok).toBe(false);
    expect(sanitizeFilmPatch('nope').ok).toBe(false);
  });

  it('applies cleanly to version N+1 and re-lays the timeline', async () => {
    const { film } = await thirty();
    const sanitized = sanitizeFilmPatch(patchInput());
    if (!sanitized.ok) throw new Error(sanitized.problems.join('; '));
    const scene = THIRTY_SECOND_FILM.scenes[0]!;
    const runtime = new SceneRuntime({});
    runtime.mount(compileTrusted(scene.js));
    const applied = applyFilmPatch(film, sanitized.patch, [{ id: 's1', js: scene.js, steps: runtime.beats()! }]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const next = applied.film;
    expect(next.version).toBe(2);
    expect(next.id).toBe('pendulum');
    expect(next.beats.map((beat) => beat.id)).toEqual(film.beats.map((beat) => beat.id));
    expect(next.beats[0]!.step.say).toBe('A pendulum hangs from its pivot, pulled down by gravity.');
    expect(next.beats[0]!.words).toContain('gravity.');
    // Untouched beats keep their narration; the timeline stays contiguous.
    expect(next.beats[1]!.step.say).toBe(film.beats[1]!.step.say);
    next.beats.forEach((beat, i) => {
      expect(beat.start).toBeCloseTo(i === 0 ? 0 : next.beats[i - 1]!.start + next.beats[i - 1]!.seconds, 9);
    });
    expect(next.seconds).toBeCloseTo(next.beats.reduce((total, beat) => total + beat.seconds, 0), 9);
    // Old anchors never resolve on the new version.
    const anchor = anchorFor(film, 's1b1', 2);
    const { resolveAskAnchor } = await import('../src/index');
    expect(resolveAskAnchor(next, anchor)).toBeNull();
  });

  it('attaches the changed beats audio and refuses what does not fit', async () => {
    const { film } = await thirty();
    const say = 'A pendulum hangs from its pivot, pulled down by gravity.';
    const words = say.split(' ');
    const sanitized = sanitizeFilmPatch(patchInput({ audio: [{ beat: 's1b1', seconds: words.length * 0.4, words: words.map((_, i) => i * 0.4) }] }));
    if (!sanitized.ok) throw new Error(sanitized.problems.join('; '));
    const scene = THIRTY_SECOND_FILM.scenes[0]!;
    const runtime = new SceneRuntime({});
    runtime.mount(compileTrusted(scene.js));
    const sources = [{ id: 's1', js: scene.js, steps: runtime.beats()! }];
    const applied = applyFilmPatch(film, sanitized.patch, sources);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.film.beats[0]!.timed).toBe(true);
    expect(applied.film.beats[1]!.timed).toBe(false);

    const badBeat = sanitizeFilmPatch(patchInput({ beats: [{ beat: 'missing', scene: 's1', say: 'New words here.' }] }));
    if (!badBeat.ok) throw new Error('expected a structurally valid patch');
    expect(applyFilmPatch(film, badBeat.patch, sources).ok).toBe(false);
    const wrongParent = sanitizeFilmPatch(patchInput({ parent: 2, version: 3 }));
    if (!wrongParent.ok) throw new Error('expected a structurally valid patch');
    expect(applyFilmPatch(film, wrongParent.patch, sources).ok).toBe(false);
    const wrongFilm = sanitizeFilmPatch({ ...patchInput(), film: 'waves' });
    if (!wrongFilm.ok) throw new Error('expected a structurally valid patch');
    expect(applyFilmPatch(film, wrongFilm.patch, sources).ok).toBe(false);
  });

  it('leaves the parent untouched and the result passes validator, probe and film checks', async () => {
    const { film, scenes, refuel } = await compileFixture(THIRTY_SECOND_FILM);
    const before = JSON.stringify({ version: film.version, say: film.beats[0]!.step.say, seconds: film.seconds });
    const sanitized = sanitizeFilmPatch(patchInput());
    if (!sanitized.ok) throw new Error(sanitized.problems.join('; '));
    const scene = THIRTY_SECOND_FILM.scenes[0]!;
    // The validator and the probe run over the patched film's unchanged scene.
    expect(validateScene({ html: scene.html, css: scene.css, js: scene.js }).ok).toBe(true);
    const { scene: compiled, fuel } = compileValidated({ html: scene.html, css: scene.css, js: scene.js });
    expect(probeScene(compiled, { beforeStep: fuel.refuel, spec: { parts: [...scene.probe.parts], steps: scene.probe.steps } }).failures).toEqual([]);
    const probeRuntime = new SceneRuntime({});
    probeRuntime.mount(compileTrusted(scene.js));
    const applied = applyFilmPatch(film, sanitized.patch, [{ id: 's1', js: scene.js, steps: probeRuntime.beats()! }]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    // The parent is never half changed.
    expect(JSON.stringify({ version: film.version, say: film.beats[0]!.step.say, seconds: film.seconds })).toBe(before);
    const report = probeFilm({ film: applied.film, scenes, beforeStep: refuel });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    // And version 2 plays through the real controller.
    const runtime = new SceneRuntime({ ...(scenes[0]!.kits ? { kits: scenes[0]!.kits } : {}) });
    runtime.mount(scenes[0]!.scene);
    const controller = new FilmController({ runtime, film: applied.film });
    controller.play();
    controller.seek(applied.film.beats[0]!.start + 0.5);
    expect(controller.currentBeat?.id).toBe('s1b1');
    controller.destroy();
  });
});

describe('film ask full: loop-a-beat and bookmarks', () => {
  async function setup() {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const model = new PlayerModel(controller, film);
    return { film, runtime, controller, model };
  }

  it('loops the beat while playing and stops on demand', async () => {
    const { film, model, controller } = await setup();
    model.play();
    model.seek(film.beats[1]!.start + 0.1);
    model.loopBeat('s1b2');
    expect(model.loopedBeat).toBe('s1b2');
    // Play crosses the beat's end; the loop seeks back to its start.
    controller.seek(film.beats[1]!.start + film.beats[1]!.seconds - 0.01);
    if (!controller.isPlaying) controller.play();
    controller.tick(film.beats[1]!.seconds);
    model.applyLoop();
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(controller.time).toBeCloseTo(film.beats[1]!.start, 6);
    model.loopBeat(null);
    expect(model.loopedBeat).toBeNull();
    model.loopBeat('missing');
    expect(model.loopedBeat).toBeNull();
    controller.destroy();
  });

  it('leaves a paused film alone', async () => {
    const { film, model, controller } = await setup();
    model.loopBeat('s1b1');
    model.seek(film.beats[0]!.start + film.beats[0]!.seconds - 0.01);
    const before = controller.time;
    model.applyLoop();
    // Paused: the loop leaves the time exactly where the seek landed it.
    expect(controller.time).toBe(before);
    expect(controller.time).toBeGreaterThan(film.beats[0]!.start + 1);
    controller.destroy();
  });

  it('adds, jumps and removes bookmarks by beat and word', async () => {
    const { film, model, controller } = await setup();
    expect(model.addBookmark()).toBeNull();
    model.play();
    model.seek(film.beats[2]!.start + 0.6);
    const bookmark = model.addBookmark('The trade');
    expect(bookmark).toMatchObject({ film: 'pendulum', version: 1, beat: 's1b3', label: 'The trade' });
    expect(bookmark?.wordIndex).toBe(1);
    expect(model.bookmarks).toHaveLength(1);
    expect(model.bookmarkTime(bookmark!.id)).toBeCloseTo(film.beats[2]!.start + 0.4, 9);
    model.seek(film.beats[5]!.start);
    expect(model.jumpBookmark(bookmark!.id)).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b3');
    expect(controller.time).toBeCloseTo(film.beats[2]!.start + 0.4, 9);
    expect(model.jumpBookmark('missing')).toBe(false);
    expect(model.removeBookmark(bookmark!.id)).toBe(true);
    expect(model.removeBookmark(bookmark!.id)).toBe(false);
    expect(model.bookmarks).toHaveLength(0);
    controller.destroy();
  });

  it('moves bookmarks along with re-timed audio and drops moved-on films', async () => {
    const { film, model, controller } = await setup();
    model.play();
    model.seek(film.beats[0]!.start + 0.8);
    const bookmark = model.addBookmark()!;
    const timed = attachAudio(film, 's1b1', { seconds: 6, words: film.beats[0]!.words.map((_, i) => i * 0.5) });
    controller.retime(timed);
    model.retime(timed);
    expect(model.bookmarkTime(bookmark.id)).toBeCloseTo(timed.beats[0]!.start + 1.0, 9);
    expect(model.jumpBookmark(bookmark.id)).toBe(true);
    const movedOn = { ...timed, version: 99 };
    controller.retime(movedOn);
    model.retime(movedOn);
    expect(model.jumpBookmark(bookmark.id)).toBe(false);
    expect(model.bookmarkTime(bookmark.id)).toBeNull();
    controller.destroy();
  });
});

describe('film ask full: link to a time', () => {
  it('round-trips a beat-and-word link', async () => {
    const { film } = await thirty();
    const hash = formatFilmLink({ film: 'pendulum', version: 1, beat: 's1b3', word: 2 });
    expect(hash.startsWith('#')).toBe(true);
    expect(parseFilmLink(hash)).toEqual({ film: 'pendulum', version: 1, beat: 's1b3', word: 2 });
    const resolved = resolveFilmLink(film, parseFilmLink(hash)!);
    expect(resolved).toBeCloseTo(film.beats[2]!.start + 0.8, 9);
  });

  it('falls back to seconds and clamps them into the film', async () => {
    const { film } = await thirty();
    expect(parseFilmLink('#film=pendulum&v=1&t=3.5')).toEqual({ film: 'pendulum', version: 1, t: 3.5 });
    expect(resolveFilmLink(film, parseFilmLink('#film=pendulum&v=1&t=3.5')!)).toBeCloseTo(3.5, 9);
    expect(resolveFilmLink(film, parseFilmLink(`#film=pendulum&v=1&t=${film.seconds + 99}`)!)).toBeCloseTo(film.seconds, 9);
    expect(resolveFilmLink(film, parseFilmLink('#film=pendulum&v=1')!)).toBe(0);
  });

  it('rejects malformed links and links to other films or versions', async () => {
    const { film } = await thirty();
    expect(parseFilmLink('')).toBeNull();
    expect(parseFilmLink('#film=&v=1')).toBeNull();
    expect(parseFilmLink('#film=pendulum&v=0')).toBeNull();
    expect(parseFilmLink('#film=pendulum&v=x')).toBeNull();
    expect(parseFilmLink('#film=pendulum&v=1&beat=&w=1')).toBeNull();
    expect(parseFilmLink('#film=pendulum&v=1&beat=s1b3&w=-1')).toBeNull();
    expect(parseFilmLink('#film=pendulum&v=1&t=much')).toBeNull();
    expect(resolveFilmLink(film, { film: 'waves', version: 1, beat: 's1b1', word: 0 })).toBeNull();
    expect(resolveFilmLink(film, { film: 'pendulum', version: 2, beat: 's1b1', word: 0 })).toBeNull();
    expect(resolveFilmLink(film, { film: 'pendulum', version: 1, beat: 'missing', word: 0 })).toBeNull();
    // A word past the line lands on the last word, never past the beat.
    const end = resolveFilmLink(film, { film: 'pendulum', version: 1, beat: 's1b1', word: 9999 })!;
    expect(end).toBeGreaterThanOrEqual(film.beats[0]!.start);
    expect(end).toBeLessThan(film.beats[0]!.start + film.beats[0]!.seconds);
  });
});

describe('film ask full: resume where the learner left off', () => {
  function memoryStore(): ResumeStore & { raw(): Map<string, string> } {
    const data = new Map<string, string>();
    const store = new ResumeStore({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    });
    return Object.assign(store, { raw: () => data });
  }

  it('namespaces positions per film', () => {
    const store = memoryStore();
    expect(resumeKey('pendulum')).toBe('incantly.film.resume.pendulum.93789903e590');
    expect(resumeKey('waves')).not.toBe(resumeKey('pendulum'));
    // Hostile ids cannot escape the namespace.
    expect(resumeKey('../../x')).toBe('incantly.film.resume.------x.9cdf6a50100a');
    store.save('pendulum', { v: 1, beat: 's1b3', w: 2, t: 12.5 });
    store.save('waves', { v: 1, beat: 'w2', w: 0, t: 3 });
    expect(store.load('pendulum')).toEqual({ v: 1, beat: 's1b3', w: 2, t: 12.5 });
    expect(store.load('waves')).toEqual({ v: 1, beat: 'w2', w: 0, t: 3 });
    expect(store.load('missing')).toBeNull();
  });

  it('stores positions, ids and numbers only — never question or note text', () => {
    const store = memoryStore();
    store.save('pendulum', { v: 1, beat: 's1b3', w: 2, t: 12.5 });
    const keys = Object.keys(JSON.parse(store.raw().get(resumeKey('pendulum'))!) as Record<string, unknown>).sort();
    expect(keys).toEqual(['beat', 't', 'v', 'w']);
  });

  it('keeps colliding titles apart: the readable id plus a hash of the full id', () => {
    // 'my film' and 'my-film' sanitize to the same id; titles sharing their
    // first 80 characters truncate to the same prefix. The hash suffix keeps
    // each film's position its own.
    expect(resumeKey('my film')).toBe('incantly.film.resume.my-film.41f2fac1cbbe');
    expect(resumeKey('my-film')).toBe('incantly.film.resume.my-film.1384fdc7220f');
    const longA = `${'x'.repeat(80)}-first-film`;
    const longB = `${'x'.repeat(80)}-second-film`;
    expect(resumeKey(longA)).not.toBe(resumeKey(longB));
    expect(resumeKey(longA).startsWith(`incantly.film.resume.${'x'.repeat(80)}.`)).toBe(true);
    const store = memoryStore();
    store.save('my film', { v: 1, beat: 's1b1', w: 0, t: 1 });
    store.save('my-film', { v: 1, beat: 's1b2', w: 0, t: 2 });
    expect(store.load('my film')).toMatchObject({ beat: 's1b1' });
    expect(store.load('my-film')).toMatchObject({ beat: 's1b2' });
  });

  it('rejects garbage and clears on demand', () => {
    const store = memoryStore();
    store.raw().set(resumeKey('pendulum'), 'not json');
    expect(store.load('pendulum')).toBeNull();
    store.raw().set(resumeKey('pendulum'), JSON.stringify({ v: 1, beat: 's1b3', w: -1, t: 3 }));
    expect(store.load('pendulum')).toBeNull();
    store.save('pendulum', { v: 1, beat: 's1b3', w: 2, t: 12.5 });
    expect(store.load('pendulum')).not.toBeNull();
    store.clear('pendulum');
    expect(store.load('pendulum')).toBeNull();
  });

  it('resolves by beat and word on the stored version only', async () => {
    const { film } = await thirty();
    expect(resolveFilmPosition(film, { v: 1, beat: 's1b3', w: 2, t: 99 })).toBeCloseTo(film.beats[2]!.start + 0.8, 9);
    expect(resolveFilmPosition(film, { v: 2, beat: 's1b3', w: 2, t: 3 })).toBeNull();
    expect(resolveFilmPosition(film, { v: 1, beat: 'missing', w: 0, t: 0 })).toBeNull();
  });
});

describe('film ask full: keyboard shortcuts', () => {
  it('documents every shortcut on keys nothing else owns', () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(8);
    const keys = SHORTCUTS.map((shortcut) => shortcut.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.label.trim()).not.toBe('');
      expect(shortcut.key).toHaveLength(1);
    }
    // Nothing reserved by browsers or screen readers: no Tab, Escape, arrows,
    // function keys, Space (buttons and scroll) or modifier chords.
    const reserved = ['Tab', 'Escape', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F12'];
    for (const key of reserved) expect(shortcutFor(key)).toBeNull();
    expect(shortcutFor('Control')).toBeNull();
    expect(shortcutFor('k')).toMatchObject({ action: 'playPause' });
    expect(shortcutFor('K')).toMatchObject({ action: 'playPause' });
    expect(shortcutFor(',')).toMatchObject({ action: 'prevBeat' });
    expect(shortcutFor('z')).toBeNull();
  });
});

describe('film ask full: reduced motion starts on a still beat', () => {
  it('never autoplays and shows the first beat with its caption', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film, autoplay: true, reducedMotion: true });
    const model = new PlayerModel(controller, film);
    expect(controller.isPlaying).toBe(false);
    expect(model.state.caption).toBeNull();
    model.seek(0);
    expect(controller.isPlaying).toBe(false);
    expect(controller.currentBeat?.id).toBe('s1b1');
    expect(model.state.caption?.beat).toBe('s1b1');
    expect(model.state.caption?.say).toBe(film.beats[0]!.step.say);
    controller.destroy();
  });
});
