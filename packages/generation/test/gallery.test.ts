import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { afterEach, describe, expect, it } from 'vitest';
import { hmacAuthenticator, mintToken } from '../src/auth';
import { ServiceError } from '../src/client';
import { GenerationClient } from '../src/client/service-client';
import { FileGalleryStore, MemoryGalleryStore, galleryId, matchFor, promote, reviewGallery, sceneFiles, sceneSlug, submitterOf, type GalleryEntry } from '../src/gallery';
import { referenceModel } from '../src/reference-model';
import { GenerationService, RETENTION } from '../src/service';
import { issueTicket, readTicket } from '../src/ticket';

const SECRET = 'a-test-secret-that-is-long-enough-to-use';
const TICKETS = 'another-secret-only-the-service-knows-1234';
const projectile = REFERENCE_SCENES.projectile!;
const fragments = { html: projectile.html, css: projectile.css, js: projectile.js };
const running: Array<{ server: Server; service: GenerationService }> = [];
const temporary: string[] = [];

afterEach(async () => {
  for (const { server, service } of running.splice(0)) {
    await service.close();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function serve(options: { gallery?: MemoryGalleryStore | null; ticketSecret?: string | null; pending?: number } = {}) {
  const gallery = options.gallery === undefined ? new MemoryGalleryStore() : options.gallery;
  const ticketSecret = options.ticketSecret === undefined ? TICKETS : options.ticketSecret;
  const service = new GenerationService({
    model: referenceModel(),
    authenticate: hmacAuthenticator(SECRET),
    ...(gallery ? { gallery } : {}),
    ...(ticketSecret ? { ticketSecret } : {}),
    ...(options.pending !== undefined ? { galleryPendingLimit: options.pending } : {}),
  });
  const server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  running.push({ server, service });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const client = (learner = 'learner-1') => new GenerationClient({ baseUrl: base, token: () => mintToken(SECRET, learner) });
  return { gallery, base, client };
}

const ticket = issueTicket(TICKETS, projectile.plan, fragments);
const submission = { ticket, fragments, prompt: 'Why does a ball thrown at 45 degrees go the furthest?' };

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'incantly-gallery-'));
  temporary.push(dir);
  return dir;
}

describe('the community gallery (GL-1, BR-13)', () => {
  it('takes a figure the service made, with the request that made it, and keeps it for review', async () => {
    const { gallery, client } = await serve();
    const receipt = await client().publish({ ...submission, title: 'Throwing a ball' });
    expect(receipt).toEqual({ id: galleryId(fragments), status: 'pending' });
    const entry = (await gallery!.get(receipt.id))!;
    expect(entry).toMatchObject({ status: 'pending', title: 'Throwing a ball', prompt: submission.prompt, plan: projectile.plan, fragments });
    // Who published it is kept only as a hash, to count what they have waiting.
    expect(entry.submitter).toBe(submitterOf('learner-1'));
    expect(JSON.stringify(entry)).not.toContain('learner-1');
    // The same figure again is the same entry.
    expect(await client('learner-2').publish(submission)).toEqual({ id: receipt.id, status: 'pending' });
    expect(await gallery!.list()).toHaveLength(1);
    expect(RETENTION.gallery).toContain('until a reviewer removes it');
  });

  it('refuses figures it did not make, broken scenes, empty requests and learners without a token', async () => {
    const { client, base } = await serve();
    const refused = async (body: Record<string, unknown>) => {
      try {
        await client().publish(body as never);
        return null;
      } catch (error) {
        return (error as ServiceError).code;
      }
    };
    expect(await refused({ ...submission, fragments: { ...fragments, js: `${fragments.js}\n// edited` } })).toBe('invalid-ticket');
    expect(await refused({ ...submission, ticket: issueTicket('a-different-secret-of-enough-length-x', projectile.plan, fragments) })).toBe('invalid-ticket');
    expect(await refused({ ...submission, prompt: ' ' })).toBe('invalid-request');
    // Signed here, but no longer passing today's validator.
    const stale = { ...fragments, js: 'window.open("x");' };
    expect(await refused({ ticket: issueTicket(TICKETS, projectile.plan, stale), fragments: stale, prompt: submission.prompt })).toBe('invalid-scene');
    expect((await fetch(`${base}/gallery`, { method: 'POST', body: JSON.stringify(submission) })).status).toBe(401);
  });

  it('caps the figures one learner has waiting', async () => {
    const { client } = await serve({ pending: 1 });
    await client().publish(submission);
    const other = REFERENCE_SCENES.pendulum!;
    const second = { html: other.html, css: other.css, js: other.js };
    await expect(client().publish({ ticket: issueTicket(TICKETS, other.plan, second), fragments: second, prompt: 'A pendulum' })).rejects.toMatchObject({ code: 'gallery-limit' });
    // Another learner can still publish it.
    await expect(client('learner-2').publish({ ticket: issueTicket(TICKETS, other.plan, second), fragments: second, prompt: 'A pendulum' })).resolves.toMatchObject({ status: 'pending' });
  });

  it('lists only accepted figures, and gives one with a fresh ticket so a note can repair it', async () => {
    const { gallery, client } = await serve();
    const { id } = await client().publish(submission);
    expect(await client('learner-2').gallery()).toEqual([]);
    await expect(client('learner-2').galleryFigure(id)).rejects.toMatchObject({ status: 404 });
    const entry = (await gallery!.get(id))!;
    await gallery!.put({ ...entry, status: 'accepted', reviewedAt: '2026-10-22T10:00:00.000Z' });
    const cards = await client('learner-2').gallery();
    expect(cards).toEqual([
      { id, title: 'projectile motion', prompt: submission.prompt, idea: projectile.plan.idea, kind: projectile.plan.kind, sdkVersion: entry.sdkVersion, reviewedAt: '2026-10-22T10:00:00.000Z' },
    ]);
    expect(JSON.stringify(cards)).not.toContain(entry.submitter);
    const figure = await client('learner-2').galleryFigure(id);
    expect(figure.fragments).toEqual(fragments);
    expect(readTicket(TICKETS, figure.ticket, figure.fragments)).toEqual(projectile.plan);
  });

  it('is off without a store or a ticket secret', async () => {
    for (const options of [{ gallery: null }, { ticketSecret: null }]) {
      const { client } = await serve(options);
      await expect(client().gallery()).rejects.toMatchObject({ status: 404 });
    }
  });

  it('keeps entries as files that survive the service', async () => {
    const dir = await tempDir();
    const store = new FileGalleryStore(join(dir, 'gallery'));
    const entry: GalleryEntry = {
      id: galleryId(fragments),
      status: 'pending',
      prompt: submission.prompt,
      title: 'projectile motion',
      plan: projectile.plan,
      fragments,
      sdkVersion: '0.1.0',
      submittedAt: '2026-10-22T09:00:00.000Z',
      submitter: submitterOf('learner-1'),
    };
    await store.put(entry);
    expect(await new FileGalleryStore(join(dir, 'gallery')).get(entry.id)).toEqual(entry);
    expect(await store.list()).toEqual([entry]);
    expect(await store.get('../../etc/passwd')).toBeNull();
    expect(await new FileGalleryStore(join(dir, 'missing')).list()).toEqual([]);
  });
});

describe('reviewing and promoting gallery figures', () => {
  const entry = (status: GalleryEntry['status']): GalleryEntry => ({
    id: galleryId(fragments),
    status,
    prompt: 'Why does a ball thrown at 45 degrees go the furthest?',
    title: 'Throwing a ball',
    plan: projectile.plan,
    fragments,
    sdkVersion: '0.1.0',
    submittedAt: '2026-10-22T09:00:00.000Z',
    submitter: submitterOf('learner-1'),
  });

  it('makes an accepted figure a reviewed scene, with the words that will pick it out', async () => {
    expect(sceneSlug('Projectile motion: range!')).toBe('projectile-motion-range');
    expect(matchFor(entry('accepted'))).toEqual({ names: ['projectile motion', 'throwing a ball'], keywords: ['ball', 'thrown', 'degrees', 'furthest', 'projectile', 'motion'] });
    const files = sceneFiles(entry('accepted'));
    expect(Object.keys(files).sort()).toEqual(['match.json', 'plan.json', 'scene.css', 'scene.html', 'scene.js']);
    expect(JSON.parse(files['plan.json']!)).toEqual(projectile.plan);
    const scenes = await tempDir();
    const promoted = await promote(entry('accepted'), scenes, 'ball-throw', new Date('2026-10-22T11:00:00Z'));
    expect(promoted).toMatchObject({ status: 'promoted', sceneId: 'ball-throw', reviewedAt: '2026-10-22T11:00:00.000Z' });
    expect((await readdir(join(scenes, 'ball-throw'))).sort()).toEqual(['match.json', 'plan.json', 'scene.css', 'scene.html', 'scene.js']);
    expect(await readFile(join(scenes, 'ball-throw', 'scene.js'), 'utf8')).toBe(`${fragments.js.replace(/\n$/, '')}\n`);
    // Not twice, not before review, and not under a name that is not a slug.
    await expect(promote(entry('accepted'), scenes, 'ball-throw')).rejects.toThrow('already exists');
    await expect(promote(entry('pending'), scenes, 'other')).rejects.toThrow('Only an accepted figure');
    await expect(promote(entry('accepted'), scenes, 'Ball Throw')).rejects.toThrow('lower case words');
  });

  it('lists, shows, accepts, turns down and promotes from the command line', async () => {
    const store = new MemoryGalleryStore();
    await store.put(entry('pending'));
    const scenes = await tempDir();
    const lines: string[] = [];
    const run = (...args: string[]) => reviewGallery(args, { store, scenesDir: scenes, write: (line) => lines.push(line), now: () => new Date('2026-10-22T12:00:00Z') });
    const id = galleryId(fragments);
    expect(await run('list')).toBe(0);
    expect(lines.pop()).toBe(`${id}  pending   2026-10-22  Throwing a ball: "Why does a ball thrown at 45 degrees go the furthest?"`);
    expect(await run('show', id)).toBe(0);
    expect(lines).toContain('Checks today: the plan and the scene pass');
    expect(lines.at(-1)).toBe(fragments.js);
    expect(await run('promote', id)).toBe(1);
    expect(lines.pop()).toContain('Only an accepted figure');
    expect(await run('reject', id, 'too', 'close', 'to', 'the', 'reviewed', 'scene')).toBe(0);
    expect((await store.get(id))?.note).toBe('too close to the reviewed scene');
    expect(await run('accept', id)).toBe(0);
    expect(await store.get(id)).toMatchObject({ status: 'accepted', reviewedAt: '2026-10-22T12:00:00.000Z' });
    expect(await run('promote', id)).toBe(0);
    expect(await store.get(id)).toMatchObject({ status: 'promoted', sceneId: 'projectile-motion' });
    expect(await readdir(join(scenes, 'projectile-motion'))).toContain('plan.json');
    expect(await run('accept', id)).toBe(1);
    expect(await run('list', 'nonsense')).toBe(2);
    expect(await run('show', 'missing-entry')).toBe(1);
  });
});
