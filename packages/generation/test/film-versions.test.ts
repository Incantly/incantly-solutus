import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hmacAuthenticator, mintToken } from '../src/auth';
import { FileFilmLibraryStore, FilmLibrary, MemoryFilmLibraryStore, filmAskerOf } from '../src/film-library';
import { ScriptedModel } from '../src/models';
import { GenerationService, type ServiceOptions } from '../src/service';

const SECRET = 'a-test-secret-that-is-long-enough-to-use';
const servers: Array<{ server: Server; service: GenerationService }> = [];

async function start(options: Partial<ServiceOptions> = {}, withFilms = true) {
  const films = withFilms ? new FilmLibrary(new MemoryFilmLibraryStore()) : null;
  const service = new GenerationService({ model: new ScriptedModel(() => ' unused '), authenticate: hmacAuthenticator(SECRET), films, ...options });
  const server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push({ server, service });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const author = mintToken(SECRET, 'learner-1');
  const asker = mintToken(SECRET, 'learner-2');
  const post = (path: string, body: unknown, as = author) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${as}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = (path: string, as = author) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${as}` } });
  return { base, service, films: films!, author, asker, post, get };
}

afterEach(async () => {
  for (const { server, service } of servers.splice(0)) {
    await service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

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
    anchor: { film: 'pendulum', version: 2, scene: 's1', beat: 's1b3', wordIndex: 1 },
    lines: [{ say: 'Here is the step again.', seconds: 3 }],
    askedAt: 7,
    ...over,
  };
}

function promotionPatch(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    film: 'pendulum',
    parent: 2,
    version: 3,
    reason: 'Share the deeper explanation.',
    beats: [],
    inserts: [{ after: { scene: 's1', beat: 's1b3' }, lines: [{ say: 'Here is the step again.' }] }],
    audio: [{ beat: 's1b3-v3-1', seconds: 3 }],
    ...over,
  };
}

describe('film versions: the service stores a chain-checked chain', () => {
  it('stores versions and lists them oldest first', async () => {
    const { post, get } = await start();
    const stored = await post('/v1/films/pendulum/versions', { patch: patchInput() });
    expect(stored.status).toBe(201);
    expect(await stored.json()).toEqual({ version: 2 });

    const listed = await get('/v1/films/pendulum/versions');
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { film: string; versions: Array<{ version: number; parent: number; beats: string[]; summary: string }> };
    expect(body.film).toBe('pendulum');
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0]).toMatchObject({ version: 2, parent: 1, beats: ['s1b1'], summary: 'v2 (s1b1)' });

    const one = await get('/v1/films/pendulum/versions/2');
    expect(one.status).toBe(200);
    expect(((await one.json()) as { patch: { version: number } }).patch.version).toBe(2);
    expect((await get('/v1/films/pendulum/versions/9')).status).toBe(404);
    expect((await get('/v1/films/waves/versions')).status).toBe(200);
  });

  it('refuses branches, stale parents, and patches for another film', async () => {
    const { post } = await start();
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput() })).status).toBe(201);
    // The tip moved: the same parent is a conflict, not a branch.
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput() })).status).toBe(409);
    // A well-formed patch for a stale parent conflicts once the tip moves past it.
    const third = patchInput({ parent: 2, version: 3, reason: 'Tighten the second beat.', beats: [{ beat: 's1b2', scene: 's1', say: 'Pull the bob aside and let go.' }] });
    expect((await post('/v1/films/pendulum/versions', { patch: third })).status).toBe(201);
    expect((await post('/v1/films/pendulum/versions', { patch: third })).status).toBe(409);
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput({ beats: [] }) })).status).toBe(400);
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput({ film: 'waves', parent: 1, version: 2 }) })).status).toBe(400);
    expect((await post('/v1/films/pendulum/versions', 'nope')).status).toBe(400);
  });

  it('serves nothing where films are not kept, and nothing without a token', async () => {
    const { base } = await start({}, false);
    expect(await fetch(`${base}/v1/films/pendulum/versions`).then((r) => r.status)).toBe(401);
    const authed = await start();
    expect(await fetch(`${authed.base}/v1/films/pendulum/versions`).then((r) => r.status)).toBe(401);
  });
});

describe('film versions: inserts stay private to their asker', () => {
  it('lists only the asker\u2019s own inserts', async () => {
    const { post, get, author, asker } = await start();
    expect((await post('/v1/films/pendulum/inserts', insertInput(), asker)).status).toBe(201);
    expect((await post('/v1/films/pendulum/inserts', insertInput({ id: 'insert-2' }), author)).status).toBe(201);

    const mine = (await (await get('/v1/films/pendulum/inserts', asker)).json()) as { inserts: Array<{ id: string }> };
    expect(mine.inserts.map((entry) => entry.id)).toEqual(['insert-1']);
    const theirs = (await (await get('/v1/films/pendulum/inserts', author)).json()) as { inserts: Array<{ id: string }> };
    expect(theirs.inserts.map((entry) => entry.id)).toEqual(['insert-2']);
    const other = await get('/v1/films/waves/inserts', asker);
    expect(((await other.json()) as { inserts: unknown[] }).inserts).toEqual([]);
  });

  it('refuses inserts that do not fit or point elsewhere', async () => {
    const { post, asker } = await start();
    expect((await post('/v1/films/pendulum/inserts', insertInput({ lines: [] }), asker)).status).toBe(400);
    expect((await post('/v1/films/pendulum/inserts', insertInput({ anchor: { film: 'waves', version: 1, scene: 's1', beat: 's1b3', wordIndex: 0 } }), asker)).status).toBe(400);
  });
});

describe('film versions: promotion is author-only', () => {
  async function promoted() {
    const api = await start();
    // The first version stored claims authorship for learner-1.
    expect((await api.post('/v1/films/pendulum/versions', { patch: patchInput() })).status).toBe(201);
    return api;
  }

  it('lets the author promote any asker\u2019s insert to the next version', async () => {
    const { post, get, author, asker } = await promoted();
    expect((await post('/v1/films/pendulum/inserts', insertInput(), asker)).status).toBe(201);
    const answer = await post('/v1/films/pendulum/promote', { insertId: 'insert-1', patch: promotionPatch() }, author);
    expect(answer.status).toBe(201);
    const body = (await answer.json()) as { status: string; version: number; patch: { inserts: unknown[] } };
    expect(body.status).toBe('promoted');
    expect(body.version).toBe(3);
    expect(body.patch.inserts).toHaveLength(1);

    const listed = (await (await get('/v1/films/pendulum/versions')).json()) as { versions: Array<{ version: number; summary: string }> };
    expect(listed.versions.map((entry) => entry.version)).toEqual([2, 3]);
    expect(listed.versions[1]!.summary).toBe('v3 (+1 after s1b3)');
    // The insert is marked promoted for its asker.
    const mine = (await (await get('/v1/films/pendulum/inserts', asker)).json()) as { inserts: Array<{ promoted: boolean }> };
    expect(mine.inserts[0]!.promoted).toBe(true);
  });

  it('refuses non-authors, missing inserts, and patches that do not carry the insert', async () => {
    const { post, author, asker } = await promoted();
    expect((await post('/v1/films/pendulum/inserts', insertInput(), asker)).status).toBe(201);

    const refused = await post('/v1/films/pendulum/promote', { insertId: 'insert-1', patch: promotionPatch() }, asker);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ status: 'failed', reason: 'missing' });

    const missing = await post('/v1/films/pendulum/promote', { insertId: 'missing', patch: promotionPatch() }, author);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ status: 'failed', reason: 'missing' });

    // A renarration wearing the insert's id is not a promotion.
    const smuggled = await post('/v1/films/pendulum/promote', { insertId: 'insert-1', patch: patchInput({ parent: 2, version: 3 }) }, author);
    expect(smuggled.status).toBe(400);
    expect(await smuggled.json()).toEqual({ status: 'failed', reason: 'invalid' });

    // A promotion off the tip conflicts.
    const conflicted = await post('/v1/films/pendulum/promote', { insertId: 'insert-1', patch: promotionPatch({ parent: 1, version: 2, audio: [{ beat: 's1b3-v2-1', seconds: 3 }] }) }, author);
    expect(conflicted.status).toBe(409);
    expect(await conflicted.json()).toEqual({ status: 'failed', reason: 'conflict' });
  });

  it('claims authorship when the first version comes from a promotion', async () => {
    const { post, author, asker } = await start();
    expect((await post('/v1/films/pendulum/inserts', insertInput(), asker)).status).toBe(201);
    const first = promotionPatch({ parent: 1, version: 2, audio: [{ beat: 's1b3-v2-1', seconds: 3 }] });
    const answer = await post('/v1/films/pendulum/promote', { insertId: 'insert-1', patch: first }, author);
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ status: 'promoted', version: 2 });
    // learner-1 is now the author: learner-2's promotion answers as missing.
    const refused = await post('/v1/films/pendulum/promote', { insertId: 'insert-1', patch: promotionPatch() }, asker);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ status: 'failed', reason: 'missing' });
  });
});

describe('film versions: stored data is untrusted service-side', () => {
  it('skips corrupt records instead of serving them', async () => {
    const store = new MemoryFilmLibraryStore();
    const films = new FilmLibrary(store);
    await store.putVersion({ film: 'pendulum', version: 2, parent: 1, patch: patchInput() as never, author: 'aaaaaaaaaaaaaaaa', createdAt: new Date(1).toISOString() });
    await store.putVersion({ film: 'pendulum', version: 3, parent: 2, patch: { broken: true } as never, author: 'aaaaaaaaaaaaaaaa', createdAt: new Date(2).toISOString() });
    await store.putVersion({ film: 'pendulum', version: 4, parent: 3, patch: patchInput({ parent: 3, version: 4 }) as never, author: 'aaaaaaaaaaaaaaaa', createdAt: new Date(3).toISOString() });
    const listed = await films.versions('pendulum');
    // v3 is corrupt and v4's parent is gone with it: only the contiguous chain serves.
    expect(listed.versions.map((entry) => entry.version)).toEqual([2]);
    expect(listed.dropped).toBe(2);
    expect(await films.version('pendulum', 3)).toBeNull();

    await store.putInsert({ id: 'bad', film: 'pendulum', asker: 'bbbbbbbbbbbbbbbb', insert: { broken: true } as never, promoted: false, createdAt: new Date(4).toISOString() });
    expect(await films.insertsFor('anyone', 'pendulum')).toEqual([]);
  });

  it('round-trips through the file store, one JSON file per record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'film-library-'));
    const store = new FileFilmLibraryStore(dir);
    const films = new FilmLibrary(store);
    expect(await store.authorOf('pendulum')).toBeNull();
    expect(await films.storePatch('learner-1', patchInput())).toEqual({ ok: true, version: 2 });
    expect(await store.authorOf('pendulum')).toHaveLength(16);
    // Authorship never moves.
    expect(await store.claimAuthor('pendulum', 'cccccccccccccccc')).toBe(false);
    expect(await films.saveInsert('learner-2', insertInput())).toEqual({ ok: true, id: 'insert-1' });
    expect((await films.versions('pendulum')).versions.map((entry) => entry.version)).toEqual([2]);
    expect((await films.insertsFor('learner-2', 'pendulum')).map((entry) => entry.id)).toEqual(['insert-1']);
    expect(await films.insertsFor('learner-1', 'pendulum')).toEqual([]);
    expect((await store.findInsert('pendulum', 'insert-1'))?.asker).toHaveLength(16);
    expect(await store.findInsert('pendulum', 'missing')).toBeNull();

    // Corrupt JSON on disk reads as missing, never throws. The list path
    // reads only the metadata sidecar: a corrupt payload hides the version,
    // not its listing.
    await writeFile(join(dir, 'versions', 'pendulum', 'v2.json'), 'not json', 'utf8');
    expect(await films.version('pendulum', 2)).toBeNull();
    expect((await films.versions('pendulum')).versions.map((entry) => entry.version)).toEqual([2]);
    await writeFile(join(dir, 'versions', 'pendulum', 'v2.meta.json'), 'not json', 'utf8');
    expect((await films.versions('pendulum')).versions).toEqual([]);
    expect(await store.getVersion('nope!', 2)).toBeNull();
    expect(await store.listVersions('nope!')).toEqual([]);
  });
});

describe('film versions: direct stores are author-only and renarration-only', () => {
  it('refuses direct versions from non-authors, while the author still stores', async () => {
    const { post, author, asker } = await start();
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput() })).status).toBe(201);
    const third = patchInput({ parent: 2, version: 3, reason: 'Tighten the second beat.', beats: [{ beat: 's1b2', scene: 's1', say: 'Pull the bob aside and let go.' }] });
    expect((await post('/v1/films/pendulum/versions', { patch: third }, asker)).status).toBe(403);
    expect((await post('/v1/films/pendulum/versions', { patch: third }, author)).status).toBe(201);
  });

  it('refuses insert-carrying patches on the direct path; promotion still lands them', async () => {
    const { post, author, asker } = await start();
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput() })).status).toBe(201);
    // Promotion-shaped, but posted direct: refused, even from the author.
    expect((await post('/v1/films/pendulum/versions', { patch: promotionPatch() }, author)).status).toBe(400);
    expect((await post('/v1/films/pendulum/versions', { patch: promotionPatch() }, asker)).status).toBe(400);
    // The same insert lands through the author-only promote path.
    expect((await post('/v1/films/pendulum/inserts', insertInput(), asker)).status).toBe(201);
    const answer = await post('/v1/films/pendulum/promote', { insertId: 'insert-1', patch: promotionPatch() }, author);
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ status: 'promoted', version: 3 });
  });
});

describe('film versions: kept audio is capped cumulatively and listed without payloads', () => {
  it('refuses a patch that would exceed the film\u2019s kept audio', async () => {
    const { post, get, author } = await start();
    const beats = ['s1b1', 's1b2', 's1b3', 's1b4'].map((beat) => ({ beat, scene: 's1', say: 'A line long enough to carry two megabytes of audio.' }));
    const audio = ['s1b1', 's1b2', 's1b3', 's1b4'].map((beat) => ({ beat, seconds: 30, audioBase64: 'Q'.repeat(2_000_000) }));
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput({ beats, audio }) })).status).toBe(201);
    // Tiny on its own, but the film already keeps 8 MB: refused cumulatively.
    const next = patchInput({ parent: 2, version: 3, beats: [{ beat: 's1b5', scene: 's1', say: 'One more line.' }], audio: [{ beat: 's1b5', seconds: 2, audioBase64: 'QQ==' }] });
    expect((await post('/v1/films/pendulum/versions', { patch: next }, author)).status).toBe(400);
    const listed = (await (await get('/v1/films/pendulum/versions')).json()) as { versions: unknown[] };
    expect(listed.versions).toHaveLength(1);
  });

  it('lists versions without loading their audio payloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'film-library-meta-'));
    const store = new FileFilmLibraryStore(dir);
    const films = new FilmLibrary(store);
    const stored = await films.storePatch('learner-1', patchInput({ audio: [{ beat: 's1b1', seconds: 2, audioBase64: 'QUJDRA==' }] }));
    expect(stored).toEqual({ ok: true, version: 2 });
    // The sidecar carries no audio bytes.
    expect(await readFile(join(dir, 'versions', 'pendulum', 'v2.meta.json'), 'utf8')).not.toContain('audioBase64');
    // The payload file is gone entirely: the listing still serves from metadata.
    await rm(join(dir, 'versions', 'pendulum', 'v2.json'));
    const listed = await films.versions('pendulum');
    expect(listed.versions.map((entry) => entry.version)).toEqual([2]);
    expect(listed.audioChars).toBe('QUJDRA=='.length);
    expect(await films.version('pendulum', 2)).toBeNull();
  });
});

describe('film versions: un-appliable patches are stored nowhere', () => {
  it('refuses patches whose audio cannot apply', async () => {
    const { post, get, author } = await start();
    // Audio for a beat the patch does not carry: apply would fail.
    const ghost = patchInput({ audio: [{ beat: 'ghost-beat', seconds: 2 }] });
    expect((await post('/v1/films/pendulum/versions', { patch: ghost }, author)).status).toBe(400);
    // Word starts that do not time the carried line: apply would fail.
    const mistimed = patchInput({ audio: [{ beat: 's1b1', seconds: 2, words: [0] }] });
    expect((await post('/v1/films/pendulum/versions', { patch: mistimed }, author)).status).toBe(400);
    // Stored nowhere: no versions, and authorship still unclaimed.
    expect(((await (await get('/v1/films/pendulum/versions')).json()) as { versions: unknown[] }).versions).toEqual([]);
    expect((await get('/v1/films/pendulum/versions/2')).status).toBe(404);
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput() }, author)).status).toBe(201);
  });
});

describe('film versions: promotion answers missing and forbidden alike', () => {
  it('returns the same response for a missing insert and a forbidden one', async () => {
    const { post, author, asker } = await start();
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput() })).status).toBe(201);
    expect((await post('/v1/films/pendulum/inserts', insertInput(), asker)).status).toBe(201);
    const forbidden = await post('/v1/films/pendulum/promote', { insertId: 'insert-1', patch: promotionPatch() }, asker);
    const missing = await post('/v1/films/pendulum/promote', { insertId: 'missing', patch: promotionPatch() }, asker);
    const absent = await post('/v1/films/pendulum/promote', { insertId: 'missing', patch: promotionPatch() }, author);
    for (const answer of [forbidden, missing, absent]) {
      expect(answer.status).toBe(404);
      expect(await answer.json()).toEqual({ status: 'failed', reason: 'missing' });
    }
  });
});

describe('film versions: same-words inserts coexist under distinct ids', () => {
  it('promotes the named insert when two askers ask the same words', async () => {
    const { post, author, asker } = await start();
    const third = mintToken(SECRET, 'learner-3');
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput() })).status).toBe(201);
    const lines = [{ say: 'Here is the step again.', seconds: 3 }];
    expect((await post('/v1/films/pendulum/inserts', insertInput({ id: 'insert-a', lines }), asker)).status).toBe(201);
    expect((await post('/v1/films/pendulum/inserts', insertInput({ id: 'insert-b', lines, anchor: { film: 'pendulum', version: 2, scene: 's1', beat: 's1b1', wordIndex: 0 } }), third)).status).toBe(201);
    const patch = promotionPatch({ inserts: [{ after: { scene: 's1', beat: 's1b1' }, lines: [{ say: 'Here is the step again.' }] }], audio: [{ beat: 's1b1-v3-1', seconds: 3 }] });
    const answer = await post('/v1/films/pendulum/promote', { insertId: 'insert-b', patch }, author);
    expect(answer.status).toBe(201);
    const body = (await answer.json()) as { patch: { inserts: Array<{ after: { beat: string } }> } };
    expect(body.patch.inserts[0]!.after.beat).toBe('s1b1');
  });
});

describe('film versions: film-shaped poison is refused, and a wedged chain heals', () => {
  const beats = [
    { beat: 's1b1', scene: 's1' },
    { beat: 's1b2', scene: 's1' },
    { beat: 's1b3', scene: 's1' },
    { beat: 's1b4', scene: 's1' },
  ];

  it('refuses unknown beats at store; the author heals a poisoned slot and the versions behind it load', async () => {
    const { post, get } = await start();
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput(), beats })).status).toBe(201);
    // Film-shaped poison: valid shape, no audio problems, beats the film does not have.
    const poison = patchInput({ parent: 2, version: 3, reason: 'A change from nowhere.', beats: [{ beat: 'ghost', scene: 's9', say: 'A line for a beat that never existed.' }] });
    expect((await post('/v1/films/pendulum/versions', { patch: poison, beats })).status).toBe(400);
    expect(((await (await get('/v1/films/pendulum/versions')).json()) as { versions: unknown[] }).versions).toHaveLength(1);
    // A renarration of a real beat still lands.
    const third = patchInput({ parent: 2, version: 3, reason: 'Tighten the second beat.', beats: [{ beat: 's1b2', scene: 's1', say: 'Pull the bob aside and let go.' }] });
    expect((await post('/v1/films/pendulum/versions', { patch: third, beats })).status).toBe(201);

    // A legacy wedge: poison seated before beats were recorded, with a good version behind it.
    const store = new MemoryFilmLibraryStore();
    const films = new FilmLibrary(store);
    expect(await films.storePatch('learner-1', patchInput(), { beats })).toEqual({ ok: true, version: 2 });
    const author = filmAskerOf('learner-1');
    await store.putVersion({ film: 'pendulum', version: 3, parent: 2, patch: poison as never, author, createdAt: new Date(2).toISOString() });
    const behind = patchInput({ parent: 3, version: 4, reason: 'Name the swing.', beats: [{ beat: 's1b4', scene: 's1', say: 'Every swing takes the same time.' }] });
    await store.putVersion({ film: 'pendulum', version: 4, parent: 3, patch: behind as never, author, createdAt: new Date(3).toISOString() });
    expect((await films.versions('pendulum')).versions.map((entry) => entry.version)).toEqual([2, 3, 4]);
    // A poison heal is refused; the corrected slot lands; the version behind it loads.
    const poisonHeal = patchInput({ parent: 2, version: 3, reason: 'Another change from nowhere.', beats: [{ beat: 'ghost-again', scene: 's9', say: 'Still not a beat.' }] });
    expect(await films.storePatch('learner-1', poisonHeal)).toEqual({
      ok: false,
      refused: null,
      conflict: false,
      problems: ['Beat "ghost-again" is not a beat of scene "s9"'],
    });
    expect(await films.storePatch('learner-1', third)).toEqual({ ok: true, version: 3 });
    expect((await films.versions('pendulum')).versions.map((entry) => entry.version)).toEqual([2, 3, 4]);
    expect((await films.version('pendulum', 3))?.beats).toEqual([{ beat: 's1b2', scene: 's1', say: 'Pull the bob aside and let go.' }]);
    // The healed slot re-posted verbatim still conflicts; a non-author heal is refused.
    expect(await films.storePatch('learner-1', third)).toMatchObject({ ok: false, conflict: true });
    expect(await films.storePatch('learner-2', third)).toMatchObject({ ok: false, refused: 'not-author' });
  });
});

describe('film versions: cross-asker duplicate insert ids both promote', () => {
  it('promotes whichever asker\u2019s lines the patch carries', async () => {
    const { post, get, author, asker } = await start();
    const third = mintToken(SECRET, 'learner-3');
    expect((await post('/v1/films/pendulum/versions', { patch: patchInput() })).status).toBe(201);
    // Two askers save one explicit id with different words and anchors.
    expect((await post('/v1/films/pendulum/inserts', insertInput({ id: 'dup' }), asker)).status).toBe(201);
    const other = insertInput({ id: 'dup', anchor: { film: 'pendulum', version: 2, scene: 's1', beat: 's1b1', wordIndex: 0 }, lines: [{ say: 'A different aside.', seconds: 2 }] });
    expect((await post('/v1/films/pendulum/inserts', other, third)).status).toBe(201);
    // The second writer's insert promotes first: no shadowing by the first.
    const patchB = promotionPatch({ inserts: [{ after: { scene: 's1', beat: 's1b1' }, lines: [{ say: 'A different aside.' }] }], audio: [{ beat: 's1b1-v3-1', seconds: 2 }] });
    const answerB = await post('/v1/films/pendulum/promote', { insertId: 'dup', patch: patchB }, author);
    expect(answerB.status).toBe(201);
    expect(((await answerB.json()) as { patch: { inserts: Array<{ after: { beat: string } }> } }).patch.inserts[0]!.after.beat).toBe('s1b1');
    // And the first writer's insert still promotes after it.
    const patchA = promotionPatch({ parent: 3, version: 4, audio: [{ beat: 's1b3-v4-1', seconds: 3 }] });
    expect((await post('/v1/films/pendulum/promote', { insertId: 'dup', patch: patchA }, author)).status).toBe(201);
    for (const as of [asker, third]) {
      const mine = (await (await get('/v1/films/pendulum/inserts', as)).json()) as { inserts: Array<{ promoted: boolean }> };
      expect(mine.inserts[0]!.promoted).toBe(true);
    }
  });
});

describe('film versions: concurrent saves to one path resolve cleanly', () => {
  it('lands racing identical inserts without a 500', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'film-library-race-'));
    const films = new FilmLibrary(new FileFilmLibraryStore(dir));
    const saved = await Promise.all(Array.from({ length: 20 }, () => films.saveInsert('learner-2', insertInput())));
    expect(saved).toEqual(Array.from({ length: 20 }, () => ({ ok: true, id: 'insert-1' })));
    expect((await films.insertsFor('learner-2', 'pendulum')).map((entry) => entry.id)).toEqual(['insert-1']);
  });
});

describe('film versions: corrupt author records keep the boolean contract', () => {
  it('elects exactly one holder under concurrent claims', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'film-library-corrupt-claim-'));
    await mkdir(join(dir, 'authors'), { recursive: true });
    await writeFile(join(dir, 'authors', 'waves.json'), 'not json', 'utf8');
    const store = new FileFilmLibraryStore(dir);
    const [heldA, heldB] = await Promise.all([store.claimAuthor('waves', 'a'.repeat(16)), store.claimAuthor('waves', 'b'.repeat(16))]);
    expect(typeof heldA).toBe('boolean');
    expect(typeof heldB).toBe('boolean');
    expect([heldA, heldB].filter(Boolean)).toHaveLength(1);
    expect(await store.authorOf('waves')).toBe(heldA ? 'a'.repeat(16) : 'b'.repeat(16));
  });
});

describe('film versions: versions below 2 read as missing on both stores', () => {
  it('answers 404 identically for versions 1 and 0', async () => {
    const memory = new MemoryFilmLibraryStore();
    expect(await memory.getVersion('pendulum', 1)).toBeNull();
    expect(await memory.getVersion('pendulum', 0)).toBeNull();
    const file = new FileFilmLibraryStore(await mkdtemp(join(tmpdir(), 'film-library-version-guard-')));
    expect(await file.getVersion('pendulum', 1)).toBeNull();
    expect(await file.getVersion('pendulum', 0)).toBeNull();
    expect(await file.listVersionMeta('pendulum')).toEqual([]);

    const { get } = await start();
    expect((await get('/v1/films/pendulum/versions/1')).status).toBe(404);
    expect((await get('/v1/films/pendulum/versions/0')).status).toBe(404);
    const films = new FilmLibrary(new FileFilmLibraryStore(await mkdtemp(join(tmpdir(), 'film-library-version-http-'))));
    const service = new GenerationService({ model: new ScriptedModel(() => ' unused '), authenticate: hmacAuthenticator(SECRET), films });
    const server = createServer((req, res) => void service.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push({ server, service });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const token = mintToken(SECRET, 'learner-1');
    for (const version of [1, 0]) {
      const answer = await fetch(`${base}/v1/films/pendulum/versions/${version}`, { headers: { authorization: `Bearer ${token}` } });
      expect(answer.status).toBe(404);
    }
  });
});

describe('film versions: insert ids are charset-checked at the boundary', () => {
  it('refuses hostile ids on both stores, and stores nothing outside the inserts tree', async () => {
    const refused = { ok: false, problems: ['The insert id may only use letters, numbers, underscore and dash'] };
    const memory = new FilmLibrary(new MemoryFilmLibraryStore());
    for (const id of ['a b', '../x', 'a/b', 'a.b']) {
      expect(await memory.saveInsert('learner-2', insertInput({ id }))).toEqual(refused);
    }
    const dir = await mkdtemp(join(tmpdir(), 'film-library-insert-id-'));
    const file = new FilmLibrary(new FileFilmLibraryStore(dir));
    for (const id of ['a b', '../x', 'a/b', 'a.b']) {
      expect(await file.saveInsert('learner-2', insertInput({ id }))).toEqual(refused);
    }
    // Nothing wandered: the directory tree holds no file at all.
    const tree: string[] = [];
    const walk = async (at: string): Promise<void> => {
      for (const name of await readdir(at, { withFileTypes: true })) {
        const full = join(at, name.name);
        if (name.isDirectory()) await walk(full);
        else tree.push(full);
      }
    };
    await walk(dir).catch(() => undefined);
    expect(tree).toEqual([]);
    expect(await file.saveInsert('learner-2', insertInput({ id: 'a_b-9' }))).toEqual({ ok: true, id: 'a_b-9' });
  });
});

describe('film versions: concurrent first writers elect one author', () => {
  it('claims authorship atomically, and the entry names the winner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'film-library-claim-'));
    const store = new FileFilmLibraryStore(dir);
    const [heldA, heldB] = await Promise.all([store.claimAuthor('waves', 'a'.repeat(16)), store.claimAuthor('waves', 'b'.repeat(16))]);
    expect([heldA, heldB].filter(Boolean)).toHaveLength(1);
    expect(await store.authorOf('waves')).toBe(heldA ? 'a'.repeat(16) : 'b'.repeat(16));

    const films = new FilmLibrary(store);
    const [a, b] = await Promise.all([films.storePatch('learner-a', patchInput()), films.storePatch('learner-b', patchInput())]);
    expect([a, b].filter((result) => result.ok)).toHaveLength(1);
    for (const result of [a, b]) {
      if (!result.ok) expect(result.refused).toBe('not-author');
    }
    const winner = a.ok ? 'learner-a' : 'learner-b';
    expect(await store.authorOf('pendulum')).toBe(filmAskerOf(winner));
    expect((await store.getVersion('pendulum', 2))?.author).toBe(filmAskerOf(winner));
  });
});
