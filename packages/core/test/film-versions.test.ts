import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  askerHashOf,
  compileTrusted,
  FilmVersionStore,
  flattenFilm,
  flattenInsert,
  flattenTranscript,
  insertIndexKey,
  insertRecordKey,
  PrivateInsertStore,
  promoteInsertClip,
  reanchorAskAnchor,
  sanitizeFilmPatch,
  sanitizeStoredInsert,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  VersionPicker,
  type CompiledFilm,
  type FilmSceneSource,
  type InsertClip,
  type ResumeStorage,
} from '../src/index';
import { trustFixture } from './helpers/film';

async function thirty(): Promise<{ film: CompiledFilm; sources: FilmSceneSource[] }> {
  const { film } = await trustFixture(THIRTY_SECOND_FILM);
  const scene = THIRTY_SECOND_FILM.scenes[0]!;
  const runtime = new SceneRuntime({});
  runtime.mount(compileTrusted(scene.js));
  return { film, sources: [{ id: 's1', js: scene.js, steps: runtime.beats()! }] };
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

function insertInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'insert-1',
    anchor: { film: 'pendulum', version: 1, scene: 's1', beat: 's1b3', wordIndex: 2 },
    lines: [
      { say: 'Here is the step again, slowly.', seconds: 3 },
      { say: 'Watch the bob pass the bottom.', seconds: 2.5 },
    ],
    askedAt: 42,
    ...over,
  };
}

function clipFor(film: CompiledFilm, over: Partial<InsertClip> = {}): InsertClip {
  return {
    id: 'insert-1',
    anchor: { film: film.id, version: film.version, scene: 's1', beat: 's1b3', wordIndex: 2, controlValues: {}, readouts: [] },
    lines: [
      { say: 'Here is the step again, slowly.', seconds: 3 },
      { say: 'Watch the bob pass the bottom.', seconds: 2.5 },
    ],
    seconds: 5.5,
    ...over,
  };
}

function memoryStorage(): ResumeStorage & { keys(): string[] } {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    keys: () => [...data.keys()],
  };
}

describe('film versions: the base is immutable', () => {
  it('freezes the base so no caller can change it', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    expect(Object.isFrozen(store.base)).toBe(true);
    expect(Object.isFrozen(store.base.beats)).toBe(true);
    expect(Object.isFrozen(store.base.beats[0])).toBe(true);
    expect(Object.isFrozen(store.base.beats[0]!.step)).toBe(true);
    expect(() => {
      (store.base.beats[0] as { seconds: number }).seconds = 999;
    }).toThrow();
    expect(store.get(1)!.beats[0]!.seconds).not.toBe(999);
  });

  it('keeps its own copy: later changes to the handed-in film do not leak in', async () => {
    const { film, sources } = await thirty();
    const before = film.beats[0]!.step.say;
    const store = new FilmVersionStore(film, sources);
    (film as { title: string }).title = 'Rewritten elsewhere';
    expect(store.base.title).not.toBe('Rewritten elsewhere');
    expect(store.base.beats[0]!.step.say).toBe(before);
  });

  it('never half-changes the parent when a patch lands', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    const before = JSON.stringify(store.get(1));
    expect(store.putPatch(patchInput()).ok).toBe(true);
    expect(JSON.stringify(store.get(1))).toBe(before);
    expect(store.get(2)).not.toBe(store.get(1));
  });
});

describe('film versions: chain integrity', () => {
  it('appends only to the tip, one version up', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    expect(store.putPatch(patchInput())).toEqual({ ok: true, version: 2 });
    expect(store.latest).toBe(2);
    // The parent must be the tip now.
    const behind = store.putPatch(patchInput());
    expect(behind.ok).toBe(false);
    // Skipping a version is refused, not stored.
    const skipped = store.putPatch(patchInput({ parent: 2, version: 4 }));
    expect(skipped.ok).toBe(false);
    // The next version lands on the tip.
    const next = store.putPatch(patchInput({ parent: 2, version: 3, reason: 'Tighten the second beat.', beats: [{ beat: 's1b2', scene: 's1', say: 'Pull the bob aside and let go.' }] }));
    expect(next).toEqual({ ok: true, version: 3 });
    expect(store.latest).toBe(3);
  });

  it('refuses patches for another film and patches that do not apply', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    expect(store.putPatch(patchInput({ film: 'waves' })).ok).toBe(false);
    expect(store.putPatch(patchInput({ beats: [{ beat: 'missing', scene: 's1', say: 'New words here.' }] })).ok).toBe(false);
    expect(store.latest).toBe(1);
    expect(store.list()).toHaveLength(1);
  });

  it('lists versions with their changed beats for the picker', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    expect(store.putPatch(patchInput()).ok).toBe(true);
    const cards = store.list();
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ version: 1, parent: null, beats: [] });
    expect(cards[1]).toMatchObject({ version: 2, parent: 1, beats: ['s1b1'] });
    expect(cards[1]!.summary).toBe('v2 (s1b1)');
    expect(cards[1]!.reason).toContain('pulls the pendulum');
  });
});

describe('film versions: promoted inserts', () => {
  it('sanitizes a promotion patch: empty beats allowed only with inserts', () => {
    const promotion = patchInput({
      beats: [],
      inserts: [{ after: { scene: 's1', beat: 's1b3' }, lines: [{ say: 'Here is the step again, slowly.' }] }],
    });
    const clean = sanitizeFilmPatch(promotion);
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(clean.patch.inserts).toHaveLength(1);
    expect(sanitizeFilmPatch(patchInput({ beats: [] })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ beats: [], inserts: [] })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ beats: [], inserts: [{ after: { scene: 's1', beat: '' }, lines: [{ say: 'Words.' }] }] })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ beats: [], inserts: [{ after: { scene: 's1', beat: 's1b3' }, lines: [] }] })).ok).toBe(false);
    expect(sanitizeFilmPatch(patchInput({ beats: [], inserts: [{ after: { scene: 's1', beat: 's1b3' }, lines: [{ say: 'Words.', set: { angle: 1 } }] }] })).ok).toBe(false);
    expect(
      sanitizeFilmPatch(patchInput({ beats: [], inserts: [{ after: { scene: 's1', beat: 's1b3' }, lines: [{ say: 'One.' }, { say: 'Two.' }, { say: 'Three.' }, { say: 'Four.' }, { say: 'Five.' }] }] })).ok,
    ).toBe(false);
  });

  it('splices promoted beats after their anchor and re-lays the timeline', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    const promotion = patchInput({
      beats: [],
      reason: 'Share the deeper explanation of the swing.',
      inserts: [{ after: { scene: 's1', beat: 's1b3' }, lines: [{ say: 'Here is the step again, slowly.' }, { say: 'Watch the bob pass the bottom.' }] }],
      audio: [
        { beat: 's1b3-v2-1', seconds: 3 },
        { beat: 's1b3-v2-2', seconds: 2.5 },
      ],
    });
    expect(store.putPatch(promotion)).toEqual({ ok: true, version: 2 });
    const next = store.get(2)!;
    expect(next.beats.map((beat) => beat.id)).toEqual(['s1b1', 's1b2', 's1b3', 's1b3-v2-1', 's1b3-v2-2', 's1b4', 's1b5', 's1b6']);
    expect(next.beats[3]!.step.say).toBe('Here is the step again, slowly.');
    // Spliced beats replay the anchor's scene step; later beats keep theirs.
    expect(next.beats[3]!.index).toBe(next.beats[2]!.index);
    expect(next.beats[5]!.index).toBe(film.beats[3]!.index);
    expect(next.beats[3]!.sceneId).toBe('s1');
    // The timeline stays contiguous and the source map covers the new beats.
    next.beats.forEach((beat, i) => {
      expect(beat.start).toBeCloseTo(i === 0 ? 0 : next.beats[i - 1]!.start + next.beats[i - 1]!.seconds, 9);
    });
    expect(next.seconds).toBeCloseTo(next.beats.reduce((total, beat) => total + beat.seconds, 0), 9);
    expect(next.sourceMap['s1b3-v2-1']).toMatchObject({ beat: 's1b3-v2-1', scene: 's1' });
    expect(store.list()[1]!.summary).toBe('v2 (+2 after s1b3)');
  });

  it('refuses inserts pinned to beats the film does not have', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    const bad = store.putPatch(patchInput({ beats: [], inserts: [{ after: { scene: 's1', beat: 'missing' }, lines: [{ say: 'Words here.' }] }] }));
    expect(bad.ok).toBe(false);
    expect(store.latest).toBe(1);
  });

  it('builds a promotion patch from an insert clip', async () => {
    const { film } = await thirty();
    const built = promoteInsertClip(film, clipFor(film), 'Share the deeper explanation.');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.patch).toMatchObject({ film: 'pendulum', parent: 1, version: 2, beats: [] });
    expect(built.patch.inserts).toHaveLength(1);
    expect(built.patch.audio.map((line) => line.beat)).toEqual(['s1b3-v2-1', 's1b3-v2-2']);
    // The builder only emits patches the sanitizer accepts.
    expect(sanitizeFilmPatch(JSON.parse(JSON.stringify(built.patch)) as unknown).ok).toBe(true);

    const other = promoteInsertClip(film, clipFor(film, { anchor: { film: 'waves', version: 1, scene: 's1', beat: 's1b3', wordIndex: 0, controlValues: {}, readouts: [] } }), 'Share it.');
    expect(other.ok).toBe(false);
    const missing = promoteInsertClip(film, clipFor(film, { anchor: { film: 'pendulum', version: 1, scene: 's1', beat: 'missing', wordIndex: 0, controlValues: {}, readouts: [] } }), 'Share it.');
    expect(missing.ok).toBe(false);
    expect(promoteInsertClip(film, clipFor(film), '   ').ok).toBe(false);
  });
});

describe('film versions: private inserts', () => {
  it('keys inserts by asker: one asker never lists another', () => {
    const storage = memoryStorage();
    const inserts = new PrivateInsertStore(storage);
    expect(inserts.save('asker-a', insertInput())).toEqual({ ok: true, id: 'insert-1' });
    expect(inserts.save('asker-b', insertInput({ id: 'insert-1' })).ok).toBe(true);
    expect(inserts.list('asker-a', 'pendulum')).toHaveLength(1);
    expect(inserts.list('asker-b', 'pendulum')).toHaveLength(1);
    expect(inserts.list('asker-c', 'pendulum')).toHaveLength(0);
    expect(inserts.list('asker-a', 'waves')).toHaveLength(0);
    expect(inserts.get('asker-a', 'pendulum', 'insert-1')!.lines).toHaveLength(2);
    expect(inserts.get('asker-b', 'pendulum', 'insert-1')!.anchor.beat).toBe('s1b3');
  });

  it('scopes storage keys by asker hash, never the asker id', () => {
    const storage = memoryStorage();
    const inserts = new PrivateInsertStore(storage);
    expect(inserts.save('asker-a', insertInput()).ok).toBe(true);
    const keys = storage.keys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('asker-a');
      expect(key).toContain(askerHashOf('asker-a'));
    }
    expect(insertRecordKey('asker-a', 'pendulum', 'insert-1')).not.toBe(insertRecordKey('asker-b', 'pendulum', 'insert-1'));
    expect(insertIndexKey('asker-a', 'pendulum')).not.toBe(insertIndexKey('asker-a', 'waves'));
    expect(askerHashOf('asker-a')).toBe(askerHashOf('asker-a'));
    expect(askerHashOf('asker-a')).not.toBe(askerHashOf('asker-b'));
  });

  it('validates stored inserts on the way in and out', () => {
    const storage = memoryStorage();
    const inserts = new PrivateInsertStore(storage);
    expect(sanitizeStoredInsert(insertInput()).ok).toBe(true);
    expect(inserts.save('', insertInput()).ok).toBe(false);
    expect(inserts.save('asker-a', insertInput({ lines: [] })).ok).toBe(false);
    expect(inserts.save('asker-a', insertInput({ lines: [{ say: 'Words.', seconds: 99 }] })).ok).toBe(false);
    expect(inserts.save('asker-a', insertInput({ anchor: { film: 'pendulum', version: 0, scene: 's1', beat: 's1b3', wordIndex: 0 } })).ok).toBe(false);
    // A corrupt record is dropped from the listing, never thrown.
    expect(inserts.save('asker-a', insertInput()).ok).toBe(true);
    storage.setItem(insertRecordKey('asker-a', 'pendulum', 'insert-1'), '{"id": "insert-1", "lines": []}');
    expect(inserts.list('asker-a', 'pendulum')).toHaveLength(0);
    expect(inserts.get('asker-a', 'pendulum', 'insert-1')).toBeNull();
    // A corrupt index lists nothing.
    storage.setItem(insertIndexKey('asker-a', 'pendulum'), 'not json');
    expect(inserts.list('asker-a', 'pendulum')).toHaveLength(0);
  });

  it('removes inserts on demand', () => {
    const inserts = new PrivateInsertStore(memoryStorage());
    expect(inserts.save('asker-a', insertInput()).ok).toBe(true);
    expect(inserts.remove('asker-a', 'pendulum', 'insert-1')).toBe(true);
    expect(inserts.remove('asker-a', 'pendulum', 'insert-1')).toBe(false);
    expect(inserts.list('asker-a', 'pendulum')).toHaveLength(0);
  });
});

describe('film versions: the picker', () => {
  it('lists every version and switches between them', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    expect(store.putPatch(patchInput()).ok).toBe(true);
    const picker = new VersionPicker(store);
    const choices = picker.choices();
    expect(choices.map((choice) => choice.version)).toEqual([1, 2]);
    expect(choices[1]).toMatchObject({ version: 2, summary: 'v2 (s1b1)', current: true });
    expect(picker.current.version).toBe(2);
    expect(picker.switchTo(1)!.beats[0]!.step.say).toBe(film.beats[0]!.step.say);
    expect(picker.current.version).toBe(1);
    expect(picker.switchTo(2)!.beats[0]!.step.say).toBe('A pendulum hangs from its pivot, pulled down by gravity.');
    expect(picker.switchTo(9)).toBeNull();
    expect(picker.current.version).toBe(2);
  });

  it('re-resolves anchors by beat id on the new version, never seconds', async () => {
    const { film, sources } = await thirty();
    const store = new FilmVersionStore(film, sources);
    expect(store.putPatch(patchInput()).ok).toBe(true);
    const v2 = store.get(2)!;
    const anchor = { film: 'pendulum', version: 1, scene: 's1', beat: 's1b3', wordIndex: 2, controlValues: {}, readouts: [] };
    const moved = reanchorAskAnchor(v2, anchor);
    expect(moved).not.toBeNull();
    expect(moved!.anchor).toMatchObject({ film: 'pendulum', version: 2, beat: 's1b3', wordIndex: 2 });
    // The word's start on v2, where the renarrated first beat moved everything after it.
    const v2beat = v2.beats.find((beat) => beat.id === 's1b3')!;
    expect(moved!.seconds).toBeCloseTo(v2beat.start + 2 / 2.5, 9);
    // A short beat clamps the word; a missing beat or another film resolves nowhere.
    const short = reanchorAskAnchor(v2, { ...anchor, wordIndex: 9999 });
    expect(short!.anchor.wordIndex).toBe(v2beat.words.length - 1);
    expect(reanchorAskAnchor(v2, { ...anchor, beat: 'missing' })).toBeNull();
    expect(reanchorAskAnchor(v2, { ...anchor, film: 'waves' })).toBeNull();
  });
});

describe('film versions: export flattening', () => {
  it('flattens a film alone: play order with recomputed timing', async () => {
    const { film } = await thirty();
    const flat = flattenFilm(film);
    expect(flat.selection).toBe('film');
    expect(flat).toMatchObject({ film: 'pendulum', version: 1, inserts: [] });
    expect(flat.beats.map((beat) => beat.id)).toEqual(film.beats.map((beat) => beat.id));
    expect(flat.beats.every((beat) => beat.from === 'film')).toBe(true);
    flat.beats.forEach((beat, i) => {
      expect(beat.index).toBe(i);
      expect(beat.start).toBeCloseTo(i === 0 ? 0 : flat.beats[i - 1]!.start + flat.beats[i - 1]!.seconds, 9);
    });
    expect(flat.seconds).toBeCloseTo(film.seconds, 9);
  });

  it('splices chosen inserts after their pins', async () => {
    const { film } = await thirty();
    const first = clipFor(film);
    const second = clipFor(film, {
      id: 'insert-2',
      anchor: { film: film.id, version: film.version, scene: 's1', beat: 's1b1', wordIndex: 0, controlValues: {}, readouts: [] },
      lines: [{ say: 'One more line about the pivot.', seconds: 4 }],
      seconds: 4,
    });
    const flat = flattenFilm(film, [first, second]);
    expect(flat.selection).toBe('film+inserts');
    expect(flat.inserts).toEqual(['insert-1', 'insert-2']);
    expect(flat.beats.map((beat) => beat.id)).toEqual(['s1b1', 'insert-2-l1', 's1b2', 's1b3', 'insert-1-l1', 'insert-1-l2', 's1b4', 's1b5', 's1b6']);
    const spliced = flat.beats[4]!;
    expect(spliced).toMatchObject({ say: 'Here is the step again, slowly.', seconds: 3, from: 'insert', insertId: 'insert-1', anchorBeat: 's1b3' });
    flat.beats.forEach((beat, i) => {
      expect(beat.index).toBe(i);
      expect(beat.start).toBeCloseTo(i === 0 ? 0 : flat.beats[i - 1]!.start + flat.beats[i - 1]!.seconds, 9);
    });
    expect(flat.seconds).toBeCloseTo(film.seconds + 5.5 + 4, 9);
  });

  it('skips inserts pinned where the film does not go', async () => {
    const { film } = await thirty();
    const stray = clipFor(film, { id: 'stray', anchor: { film: film.id, version: film.version, scene: 's1', beat: 'missing', wordIndex: 0, controlValues: {}, readouts: [] } });
    const foreign = clipFor(film, { id: 'foreign', anchor: { film: 'waves', version: 1, scene: 's1', beat: 's1b3', wordIndex: 0, controlValues: {}, readouts: [] } });
    const flat = flattenFilm(film, [stray, foreign]);
    expect(flat.selection).toBe('film');
    expect(flat.beats).toHaveLength(film.beats.length);
  });

  it('flattens a single insert on its own', async () => {
    const { film } = await thirty();
    const flat = flattenInsert(film, clipFor(film));
    expect(flat.selection).toBe('insert');
    expect(flat.inserts).toEqual(['insert-1']);
    expect(flat.beats.map((beat) => beat.say)).toEqual(['Here is the step again, slowly.', 'Watch the bob pass the bottom.']);
    expect(flat.beats.map((beat) => beat.start)).toEqual([0, 3]);
    expect(flat.seconds).toBeCloseTo(5.5, 9);
  });

  it('exports transcripts of beat text only', async () => {
    const { film } = await thirty();
    const lines = flattenTranscript(flattenFilm(film, [clipFor(film)]));
    expect(lines).toEqual([
      'A pendulum hangs from its pivot, pulled straight down by gravity.',
      'Pull the bob aside, let go, and watch the swing begin.',
      'It trades height for speed, moving fastest through the very bottom.',
      'Here is the step again, slowly.',
      'Watch the bob pass the bottom.',
      'Friction steals a little energy on every single passing swing.',
      'A gentle push at just the right moment keeps it swinging.',
      'Every swing takes the same time, so the pendulum keeps time.',
    ]);
    // Beat text only: no ids, anchors, or timing leak into the transcript.
    for (const line of lines) {
      expect(line).not.toMatch(/s1b\d|insert-\d|anchor|seconds/);
    }
  });

  it('flattens fast: film alone and film plus inserts', async () => {
    const { film } = await trustFixture(SIXTY_SECOND_FILM);
    const clips = film.beats.slice(0, 4).map((beat, i) =>
      clipFor(film, {
        id: `insert-${i}`,
        anchor: { film: film.id, version: film.version, scene: beat.sceneId, beat: beat.id, wordIndex: 1, controlValues: {}, readouts: [] },
      }),
    );
    const rounds = 2000;
    const time = (fn: () => void): number => {
      const started = performance.now();
      for (let i = 0; i < rounds; i++) fn();
      return performance.now() - started;
    };
    const aloneMs = time(() => void flattenFilm(film));
    const splicedMs = time(() => void flattenFilm(film, clips));
    const perAloneUs = (aloneMs * 1000) / rounds;
    const perSplicedUs = (splicedMs * 1000) / rounds;
    writeFileSync('/tmp/film-flatten-bench.json', JSON.stringify({ rounds, aloneMs: Math.round(aloneMs * 10) / 10, splicedMs: Math.round(splicedMs * 10) / 10, perAloneUs: Math.round(perAloneUs * 100) / 100, perSplicedUs: Math.round(perSplicedUs * 100) / 100 }, null, 1));
    console.log(`[film-bench] flatten: ${perAloneUs.toFixed(1)} µs/film, ${perSplicedUs.toFixed(1)} µs/film+4-inserts over ${rounds} rounds`);
    expect(perAloneUs).toBeLessThan(5000);
    expect(perSplicedUs).toBeLessThan(5000);
  });
});

describe('film versions: stored data is untrusted', () => {
  it('loads a contiguous valid chain from stored patches, skipping the bad ones', async () => {
    const { film, sources } = await thirty();
    const second = patchInput({ parent: 2, version: 3, reason: 'Tighten the second beat.', beats: [{ beat: 's1b2', scene: 's1', say: 'Pull the bob aside and let go.' }] });
    const loaded = FilmVersionStore.load(film, [patchInput(), second], sources);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.store.latest).toBe(3);
    expect(loaded.dropped).toBe(0);
    expect(loaded.store.list().map((card) => card.version)).toEqual([1, 2, 3]);

    expect(FilmVersionStore.load(film, 'nope', sources)).toMatchObject({ ok: false });
    // Each bad patch is skipped, never fatal: the good prefix still loads.
    for (const stored of [
      [{ ...patchInput(), version: 3 }],
      [patchInput(), patchInput({ parent: 1, version: 2 })],
      [patchInput({ film: 'waves' })],
      [patchInput({ beats: [{ beat: 'missing', scene: 's1', say: 'New words here.' }] })],
    ]) {
      const partial = FilmVersionStore.load(film, stored, sources);
      expect(partial.ok).toBe(true);
      if (!partial.ok) continue;
      expect(partial.dropped).toBeGreaterThan(0);
    }
    const forked = FilmVersionStore.load(film, [patchInput(), patchInput({ parent: 1, version: 2 })], sources);
    expect(forked.ok).toBe(true);
    if (forked.ok) {
      expect(forked.store.latest).toBe(2);
      expect(forked.dropped).toBe(1);
    }
  });

  it('skips poison patches and plays the good versions', async () => {
    const { film, sources } = await thirty();
    const poison = patchInput({ parent: 2, version: 3, reason: 'A poisoned patch.', beats: [{ beat: 'missing', scene: 's1', say: 'New words here.' }] });
    const good = patchInput({ parent: 2, version: 3, reason: 'Tighten the second beat.', beats: [{ beat: 's1b2', scene: 's1', say: 'Pull the bob aside and let go.' }] });
    const loaded = FilmVersionStore.load(film, [{ broken: true }, patchInput(), poison, good], sources);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.dropped).toBe(2);
    expect(loaded.store.latest).toBe(3);
    expect(loaded.store.list().map((card) => card.version)).toEqual([1, 2, 3]);
    expect(loaded.store.get(3)!.beats[1]!.step.say).toBe('Pull the bob aside and let go.');
  });

  it('caps how many versions and how much audio load', async () => {
    const { film, sources } = await thirty();
    const many = Array.from({ length: 40 }, (_, i) => patchInput({ parent: i + 1, version: i + 2 }));
    const capped = FilmVersionStore.load(film, many, sources);
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.store.latest).toBe(32);
    expect(capped.dropped).toBe(9);
    // One audio entry past its own cap, and one film past its kept cap: both skipped.
    const entry = patchInput({ audio: [{ beat: 's1b1', seconds: 2, audioBase64: 'AA=='.repeat(3_000_000) }] });
    const beats = ['s1b1', 's1b2', 's1b3', 's1b4', 's1b5'].map((beat) => ({ beat, scene: 's1', say: 'A line long enough to carry its share of audio.' }));
    const audio = ['s1b1', 's1b2', 's1b3', 's1b4', 's1b5'].map((beat) => ({ beat, seconds: 30, audioBase64: 'Q'.repeat(1_700_000) }));
    const heavy = FilmVersionStore.load(film, [entry, patchInput({ beats, audio })], sources);
    expect(heavy.ok).toBe(true);
    if (!heavy.ok) return;
    expect(heavy.dropped).toBe(2);
    expect(heavy.store.latest).toBe(1);
  });
});
