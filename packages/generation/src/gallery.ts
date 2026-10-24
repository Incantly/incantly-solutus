import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateScene, type ScenePlan } from '@incantly/core';
import { validatePlan } from './plan';
import type { GalleryCard, GalleryFigure, GalleryStatus, SceneFragmentsMessage } from './protocol';

/**
 * The community gallery (GL-1, BR-13). A learner publishes a finished figure
 * with the request that made it; nobody else sees it until a reviewer accepts
 * it. Accepted figures are listed for other learners to add to their notes,
 * and a figure a reviewer promotes becomes a reviewed scene in
 * packages/core/scenes, so it feeds the examples the pipeline builds from:
 * its starting scenes, its library builds and its fallbacks.
 */

export interface GalleryEntry {
  readonly id: string;
  readonly status: GalleryStatus;
  /** The request the figure was made from, as the learner published it. */
  readonly prompt: string;
  /** What it shows: the learner's title, or the plan's concept. */
  readonly title: string;
  readonly plan: ScenePlan;
  readonly fragments: SceneFragmentsMessage;
  readonly sdkVersion: string;
  readonly submittedAt: string;
  /** A one-way hash of the learner who published it, so each learner's waiting entries can be counted; never shown. */
  readonly submitter: string;
  readonly reviewedAt?: string;
  /** Why a reviewer turned it down. */
  readonly note?: string;
  /** The reviewed scene it became. */
  readonly sceneId?: string;
}

/** Where gallery entries are kept. */
export interface GalleryStore {
  get(id: string): Promise<GalleryEntry | null>;
  put(entry: GalleryEntry): Promise<void>;
  list(): Promise<GalleryEntry[]>;
}

const ID = /^[\w-]{8,40}$/;

/** An entry's id: the same figure published twice is one entry. */
export function galleryId(fragments: SceneFragmentsMessage): string {
  return createHash('sha256').update(JSON.stringify({ html: fragments.html, css: fragments.css, js: fragments.js })).digest('base64url').slice(0, 16);
}

/** A learner as the gallery keeps them: a hash that cannot be turned back into their id. */
export function submitterOf(learnerId: string): string {
  return createHash('sha256').update(`incantly-gallery:${learnerId}`).digest('base64url').slice(0, 16);
}

export function galleryCard(entry: GalleryEntry): GalleryCard {
  return {
    id: entry.id,
    title: entry.title,
    prompt: entry.prompt,
    idea: entry.plan.idea,
    kind: entry.plan.kind,
    sdkVersion: entry.sdkVersion,
    reviewedAt: entry.reviewedAt ?? null,
  };
}

export function galleryFigure(entry: GalleryEntry, ticket?: string): GalleryFigure {
  return { ...galleryCard(entry), fragments: entry.fragments, ...(ticket ? { ticket } : {}) };
}

/** Listed for learners: accepted, or promoted to a reviewed scene. */
export function isListed(entry: GalleryEntry): boolean {
  return entry.status === 'accepted' || entry.status === 'promoted';
}

export class MemoryGalleryStore implements GalleryStore {
  readonly entries = new Map<string, GalleryEntry>();

  get(id: string): Promise<GalleryEntry | null> {
    return Promise.resolve(this.entries.get(id) ?? null);
  }

  put(entry: GalleryEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    return Promise.resolve();
  }

  list(): Promise<GalleryEntry[]> {
    return Promise.resolve([...this.entries.values()]);
  }
}

/** One JSON file per entry in a directory, written whole and renamed into place. */
export class FileGalleryStore implements GalleryStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    if (!ID.test(id)) throw new Error(`Not a gallery id: ${id}`);
    return join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<GalleryEntry | null> {
    if (!ID.test(id)) return null;
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as GalleryEntry;
    } catch {
      return null;
    }
  }

  async put(entry: GalleryEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(entry.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  }

  async list(): Promise<GalleryEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const entries = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => this.get(name.slice(0, -'.json'.length))));
    return entries.filter((entry): entry is GalleryEntry => entry !== null);
  }
}

// ---------------------------------------------------------------------------
// Promotion: an accepted figure becomes a reviewed scene.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  'a an and are as at be by can do does explain for from how i in into is it its me of on or show that the their them this to use using what when where which why with you your about please make draw figure diagram'.split(' '),
);

/** A reviewed scene's id: lower case words joined by dashes. */
export function sceneSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'figure'
  );
}

/**
 * The words that will pick the promoted scene out of a learner's request:
 * its concept and title as names, and the content words of the request and
 * the concept as keywords.
 */
export function matchFor(entry: Pick<GalleryEntry, 'prompt' | 'title' | 'plan'>): { names: string[]; keywords: string[] } {
  const names = [...new Set([entry.plan.concept, entry.title].map((name) => name.toLowerCase().trim()).filter((name) => name.length >= 3))];
  const keywords: string[] = [];
  for (const word of `${entry.prompt} ${entry.plan.concept}`.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 4 || STOPWORDS.has(word) || keywords.includes(word)) continue;
    keywords.push(word);
    if (keywords.length === 10) break;
  }
  return { names, keywords };
}

/** The files of the reviewed scene an entry becomes, by name. */
export function sceneFiles(entry: GalleryEntry): Record<string, string> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const end = (text: string) => (text.endsWith('\n') ? text : `${text}\n`);
  return {
    'scene.js': end(entry.fragments.js),
    'scene.html': end(entry.fragments.html),
    'scene.css': end(entry.fragments.css),
    'plan.json': json(entry.plan),
    'match.json': json(matchFor(entry)),
  };
}

/** Why an entry cannot become a reviewed scene now, or null when it can. */
export function promotionProblem(entry: GalleryEntry): string | null {
  if (entry.status !== 'accepted') return `Only an accepted figure can be promoted; this one is ${entry.status}`;
  const plan = validatePlan(entry.plan);
  if (!plan.plan) return `Its plan no longer passes: ${plan.problems.map((p) => p.message).join('; ')}`;
  const scene = validateScene(entry.fragments);
  if (!scene.ok) return `Its scene no longer validates: ${scene.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ')}`;
  return null;
}

/**
 * Writes an accepted entry into the scenes directory as a reviewed scene and
 * returns the entry as promoted. The reviewer then regenerates the scene
 * registry, runs the checks and reads the scene, as for any reviewed scene.
 */
export async function promote(entry: GalleryEntry, scenesDir: string, sceneId: string, now = new Date()): Promise<GalleryEntry> {
  const problem = promotionProblem(entry);
  if (problem) throw new Error(problem);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(sceneId) || sceneId.length > 40) throw new Error(`A scene id is lower case words joined by dashes, got "${sceneId}"`);
  const dir = join(scenesDir, sceneId);
  if (existsSync(dir)) throw new Error(`A reviewed scene "${sceneId}" already exists`);
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(sceneFiles(entry))) await writeFile(join(dir, name), text, 'utf8');
  return { ...entry, status: 'promoted', sceneId, reviewedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Review: what the gallery command does.
// ---------------------------------------------------------------------------

export interface ReviewOptions {
  readonly store: GalleryStore;
  /** The reviewed scenes, packages/core/scenes. */
  readonly scenesDir: string;
  readonly write: (line: string) => void;
  readonly now?: () => Date;
}

const STATUSES: readonly GalleryStatus[] = ['pending', 'accepted', 'rejected', 'promoted'];

/**
 * Reviews the gallery from the command line, and returns the exit code:
 *
 *   list [status]          entries, newest first; pending by default, or all
 *   show <id>              one entry in full, with its scene and whether it still passes
 *   accept <id>            lists it for learners
 *   reject <id> [reason]   keeps it out, with the reason
 *   promote <id> [scene]   makes an accepted figure a reviewed scene in the scenes directory
 */
export async function reviewGallery(args: readonly string[], options: ReviewOptions): Promise<number> {
  const { store, write } = options;
  const now = () => (options.now ? options.now() : new Date());
  const [command = 'list', id, ...rest] = args;
  const entryOf = async (): Promise<GalleryEntry | null> => {
    const entry = id ? await store.get(id) : null;
    if (!entry) write(id ? `No gallery entry ${id}` : 'Give the id of an entry');
    return entry;
  };
  switch (command) {
    case 'list': {
      const wanted = id === 'all' ? null : ((id ?? 'pending') as GalleryStatus);
      if (wanted !== null && !STATUSES.includes(wanted)) {
        write(`Status must be all, ${STATUSES.join(', ')}`);
        return 2;
      }
      const entries = (await store.list()).filter((entry) => wanted === null || entry.status === wanted).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      if (entries.length === 0) write(`No ${wanted ?? ''} entries`.replace('  ', ' '));
      for (const entry of entries) write(`${entry.id}  ${entry.status.padEnd(8)}  ${entry.submittedAt.slice(0, 10)}  ${entry.title}: "${entry.prompt}"`);
      return 0;
    }
    case 'show': {
      const entry = await entryOf();
      if (!entry) return 1;
      const problem = promotionProblem({ ...entry, status: 'accepted' });
      write(`${entry.id} (${entry.status}) ${entry.title}`);
      write(`Request: "${entry.prompt}"`);
      write(`Idea: ${entry.plan.idea}`);
      write(`Plan: ${entry.plan.kind}, ${entry.plan.size ?? 'quick'}; parameters ${entry.plan.parameters.map((p) => p.name).join(', ')}; parts ${entry.plan.parts.join(', ')}; ${entry.plan.steps.length} steps`);
      write(`Made with SDK ${entry.sdkVersion}, published ${entry.submittedAt}${entry.reviewedAt ? `, reviewed ${entry.reviewedAt}` : ''}`);
      if (entry.note) write(`Turned down: ${entry.note}`);
      if (entry.sceneId) write(`Reviewed scene: ${entry.sceneId}`);
      write(problem ? `Checks today: ${problem}` : 'Checks today: the plan and the scene pass');
      write('');
      write(entry.fragments.js);
      return 0;
    }
    case 'accept':
    case 'reject': {
      const entry = await entryOf();
      if (!entry) return 1;
      if (entry.status === 'promoted') {
        write(`${entry.id} is already the reviewed scene ${entry.sceneId ?? ''}`.trim());
        return 1;
      }
      const reason = rest.join(' ').trim();
      if (command === 'accept') {
        await store.put({ ...entry, status: 'accepted', reviewedAt: now().toISOString() });
        write(`${entry.id} accepted: learners can now add it to their notes`);
      } else {
        await store.put({ ...entry, status: 'rejected', reviewedAt: now().toISOString(), ...(reason ? { note: reason } : {}) });
        write(`${entry.id} turned down${reason ? `: ${reason}` : ''}`);
      }
      return 0;
    }
    case 'promote': {
      const entry = await entryOf();
      if (!entry) return 1;
      const sceneId = rest[0] ?? sceneSlug(entry.plan.concept);
      try {
        const promoted = await promote(entry, options.scenesDir, sceneId, now());
        await store.put(promoted);
      } catch (error) {
        write(error instanceof Error ? error.message : String(error));
        return 1;
      }
      write(`${entry.id} is now the reviewed scene ${sceneId} in ${join(options.scenesDir, sceneId)}.`);
      write('Run npm run generate and npm run check, read the scene and its match words, and commit it like any reviewed scene.');
      return 0;
    }
    default:
      write('Commands: list [status|all], show <id>, accept <id>, reject <id> [reason], promote <id> [scene-id]');
      return 2;
  }
}
