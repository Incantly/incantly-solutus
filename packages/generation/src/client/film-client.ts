import type { FilmFixture, StoryboardSpec } from '@incantly/core';
import type { FilmKeptScene, FilmSkeleton, FilmTimings } from '../film';
import { ServiceError } from './service-client';
import type { GenerationClientOptions } from './service-client';

/**
 * The browser's side of film generation: prompt-to-film over POST /v1/films.
 * Browser-safe: the Playground's generate-film box and the player use this,
 * and the service implements the stream. Generic over any storyboard: no
 * scene-specific code.
 *
 * Events in order: skeleton (immediate, <=1s), plan, scene per passing scene
 * (the first playable at once), then film or fallback. Deltas carry plan and
 * scene text as it streams.
 */

export interface FilmGenerateRequest {
  readonly prompt: string;
  /** Length target in seconds: 30, 60, 120, 180 or 240. Default 60. */
  readonly lengthTarget?: number;
  readonly noteContext?: string;
}

export type FilmGenerateEvent =
  | ({ readonly type: 'skeleton' } & FilmSkeleton)
  | { readonly type: 'plan'; readonly scenes: ReadonlyArray<{ readonly scene: string; readonly title: string; readonly beats: readonly string[] }> }
  | { readonly type: 'scene'; readonly scene: string; readonly fragments?: { readonly html: string; readonly css: string; readonly js: string }; readonly failed?: string }
  | { readonly type: 'delta'; readonly purpose: 'plan' | 'scene' | 'repair'; readonly text: string }
  | {
      readonly type: 'film';
      readonly generationId: string;
      readonly storyboard: StoryboardSpec;
      readonly scenes: readonly FilmKeptScene[];
      readonly timings: FilmTimings;
      readonly speechChars: number;
      readonly partial: boolean;
    }
  | {
      readonly type: 'fallback';
      readonly generationId: string;
      readonly reason: string;
      readonly standard: { readonly id: string; readonly fragments: { readonly html: string; readonly css: string; readonly js: string }; readonly concept: string; readonly description: string } | null;
      readonly keptScenes: readonly FilmKeptScene[];
    };

const FILM_EVENT_TYPES = new Set(['skeleton', 'plan', 'scene', 'delta', 'film', 'fallback']);

/** Starts a film generation and yields its events as they arrive. */
export async function* generateFilmStream(options: GenerationClientOptions, request: FilmGenerateRequest, signal?: AbortSignal): AsyncGenerator<FilmGenerateEvent> {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const token = await options.token();
  let response: Response;
  try {
    response = await fetcher(`${options.baseUrl}/films`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ServiceError(0, 'network', 'The film service could not be reached');
  }
  if (!response.ok) {
    let code = 'error';
    let message = `The service answered ${response.status}`;
    try {
      const body = (await response.json()) as { code?: unknown; message?: unknown };
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Not JSON.
    }
    const retry = Number(response.headers.get('retry-after'));
    throw new ServiceError(response.status, code, message, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  if (!response.body) throw new ServiceError(response.status, 'protocol', 'The service sent no events');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = parseFilmEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFilmEvent(block: string): FilmGenerateEvent | null {
  let type = '';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!FILM_EVENT_TYPES.has(type) || data.length === 0) return null;
  try {
    return { type, ...(JSON.parse(data.join('\n')) as object) } as FilmGenerateEvent;
  } catch {
    return null;
  }
}

/** One line per timing: plan, scenes, speech, check, probe and the total. */
export function formatFilmTimings(timings: FilmTimings): string {
  const seconds = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  const lines = [
    `plan ${seconds(timings.planMs)}`,
    `first scene ${seconds(timings.firstSceneMs)}`,
    `speech ${seconds(timings.speechMs)}`,
    `check ${seconds(timings.checkMs)}`,
    `probe ${seconds(timings.probeMs)}`,
    `total ${seconds(timings.totalMs)}`,
  ];
  return lines.join(' · ');
}

/** A generated film as the dev server keeps it for the session: the storyboard plus each passing scene's fragments. */
export interface StoredFilm {
  readonly id: string;
  readonly storyboard: StoryboardSpec;
  readonly scenes: ReadonlyArray<{ readonly id: string; readonly html: string; readonly css: string; readonly js: string }>;
}

/**
 * Resolves ?film=<id> for the player: the dev store first, fixtures second.
 * Generic over any id: no per-film code. Null when neither has it.
 */
export async function resolveFilmSource(
  id: string,
  options: {
    readonly loadStored: (id: string) => Promise<StoredFilm | FilmFixture | null>;
    readonly fixtures: Readonly<Record<string, FilmFixture>>;
  },
): Promise<{ readonly source: 'store' | 'fixture'; readonly film: StoredFilm | FilmFixture } | null> {
  const stored = await options.loadStored(id);
  if (stored) return { source: 'store', film: stored };
  // Own properties only: prototype names (__proto__, toString, ...) are unknown ids, not fixtures.
  const fixture = Object.hasOwn(options.fixtures, id) ? options.fixtures[id] : undefined;
  if (fixture) return { source: 'fixture', film: fixture };
  return null;
}

/** A stored film as a fixture-shaped film for the player: storyboard plus scenes with probe counts. */
export function storedAsFixture(stored: StoredFilm | FilmFixture): FilmFixture {
  if ('probe' in (stored.scenes[0] ?? {})) return stored as FilmFixture;
  const film = stored as StoredFilm;
  return {
    id: stored.storyboard.film.id ?? stored.id,
    storyboard: stored.storyboard,
    scenes: film.scenes.map((scene) => ({
      id: scene.id,
      cut: (stored.storyboard.scenes.find((candidate) => candidate.id === scene.id)?.cut ?? 'cut') as FilmFixture['scenes'][number]['cut'],
      html: scene.html,
      css: scene.css,
      js: scene.js,
      probe: { parts: [], steps: stored.storyboard.scenes.find((candidate) => candidate.id === scene.id)?.beats.length ?? 0 },
    })),
  };
}
