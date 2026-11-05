import { resolveAskAnchor, type AskAnchor, type InsertHost } from './ask';
import { wordStarts, type CompiledFilm } from './storyboard';
import { SCENE_LIMITS, validateScene } from '../validation';

/**
 * The Another-example rung: a new scene through the scene pipeline, shown as
 * a side clip pinned to the anchor where the learner asked. The slowest rung;
 * the router (ask.ts) picks it only on explicit example words.
 *
 * The clip plays independently of the film on its own mounted figure: the
 * film stays paused where it was asked while the learner plays the example,
 * and Return to film closes the clip and resumes at the anchor word. The
 * anchor is beat ids and word indexes, never seconds, so re-timed audio never
 * breaks the return.
 */

/** A side-clip scene, pinned to the anchor it interrupted. */
export interface ExampleClip {
  readonly id: string;
  readonly anchor: AskAnchor;
  /** The new scene's fragments, through validation like any scene. */
  readonly html: string;
  readonly css: string;
  readonly js: string;
  /** One line under the clip: what the example shows. */
  readonly caption: string;
}

/** Longest a side-clip caption may be. */
export const EXAMPLE_MAX_CAPTION_CHARS = 200;

/**
 * Validates a generated side clip against its film: pinned to a beat that
 * exists, a caption of one line, and fragments that pass the scene validator.
 * The player re-validates the pin against its own film before opening.
 */
export function validateExampleClip(
  input: unknown,
  film: CompiledFilm,
): { readonly ok: true; readonly clip: ExampleClip } | { readonly ok: false; readonly problems: readonly string[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, problems: ['The example must be an object'] };
  const { id, anchor, html, css, js, caption } = input as { id?: unknown; anchor?: unknown; html?: unknown; css?: unknown; js?: unknown; caption?: unknown };
  if (typeof anchor !== 'object' || anchor === null) return { ok: false, problems: ['The example needs the anchor it interrupted'] };
  const pinned = anchor as Partial<AskAnchor>;
  const beat = film.beats.find((candidate) => candidate.id === pinned.beat && candidate.sceneId === pinned.scene);
  if (pinned.film !== film.id || pinned.version !== film.version || !beat) {
    return { ok: false, problems: ['The example is pinned to a beat this film does not have'] };
  }
  if (typeof html !== 'string' || typeof css !== 'string' || typeof js !== 'string') {
    return { ok: false, problems: ['The example needs its scene as html, css and js strings'] };
  }
  if (html.length > SCENE_LIMITS.htmlChars || css.length > SCENE_LIMITS.cssChars || js.length > SCENE_LIMITS.jsChars) {
    return { ok: false, problems: ['The example scene is larger than a scene may be'] };
  }
  const scene = validateScene({ html, css, js });
  if (!scene.ok) return { ok: false, problems: [`The example scene does not pass the checks: ${scene.diagnostics[0]?.message ?? 'invalid'}`] };
  const line = typeof caption === 'string' ? caption.trim().replace(/\s+/g, ' ') : '';
  if (line === '') return { ok: false, problems: ['The example needs a one-line caption'] };
  if (line.length > EXAMPLE_MAX_CAPTION_CHARS) return { ok: false, problems: [`The caption runs ${line.length} characters; at most ${EXAMPLE_MAX_CAPTION_CHARS}`] };
  const clipId = typeof id === 'string' && id !== '' ? id.slice(0, 80) : `example-${beat.id}`;
  return {
    ok: true,
    clip: {
      id: clipId,
      anchor: {
        film: film.id,
        version: film.version,
        scene: beat.sceneId,
        beat: beat.id,
        wordIndex: typeof pinned.wordIndex === 'number' ? Math.min(Math.max(Math.floor(pinned.wordIndex), 0), Math.max(0, beat.words.length - 1)) : 0,
        controlValues: {},
        readouts: [],
      },
      html: scene.scene?.html ?? html,
      css: scene.scene?.css ?? css,
      js,
      caption: line,
    },
  };
}

/** Film seconds the clip returns to: its anchor word's start, moving along with re-timed audio. */
export function exampleReturnSeconds(film: CompiledFilm, clip: ExampleClip): number | null {
  return resolveAskAnchor(film, clip.anchor);
}

/** The clip's pin as the film time it shows beside: the anchor word's start. */
export function examplePinSeconds(film: CompiledFilm, clip: ExampleClip): number | null {
  const beat = film.beats.find((candidate) => candidate.id === clip.anchor.beat && candidate.sceneId === clip.anchor.scene);
  if (!beat || beat.words.length === 0) return null;
  const index = Math.min(Math.max(clip.anchor.wordIndex, 0), beat.words.length - 1);
  return wordStarts(beat)[index] ?? beat.start;
}

export type SideClipPhase = 'open' | 'done';

export type SideClipEvent = { readonly type: 'open'; readonly clip: ExampleClip } | { readonly type: 'resume'; readonly anchor: AskAnchor; readonly seconds: number };

/**
 * Plays a side clip over a paused film: the clip's own figure plays
 * independently while the film waits, and Return to film closes the clip and
 * resumes at the anchor word. Return now works from anywhere in the clip.
 */
export class SideClipPlayer {
  private phase: SideClipPhase = 'open';
  private elapsed = 0;
  private opened = false;
  private readonly anchorSeconds: number | null;
  private readonly listeners = new Set<(event: SideClipEvent) => void>();

  constructor(
    private readonly host: InsertHost,
    private readonly film: CompiledFilm,
    private readonly clip: ExampleClip,
    private readonly options: { readonly onEvent?: (event: SideClipEvent) => void } = {},
  ) {
    this.anchorSeconds = resolveAskAnchor(film, clip.anchor);
    if (options.onEvent) this.listeners.add(options.onEvent);
  }

  on(listener: (event: SideClipEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SideClipEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get currentPhase(): SideClipPhase {
    return this.phase;
  }

  /** Seconds the clip has been open. */
  get elapsedSeconds(): number {
    return this.elapsed;
  }

  get currentClip(): ExampleClip {
    return this.clip;
  }

  /** Opens the clip, pausing the film. False when its anchor no longer resolves: the film plays on instead. */
  open(): boolean {
    if (this.anchorSeconds === null) {
      this.phase = 'done';
      this.host.play();
      return false;
    }
    this.opened = true;
    this.host.pause();
    this.emit({ type: 'open', clip: this.clip });
    return true;
  }

  /** Advances the clip's clock; the host ticks or polls while it runs. */
  tick(dt: number): void {
    if (!this.opened || this.phase === 'done' || !(dt > 0)) return;
    this.elapsed += dt;
  }

  /** Return to film: closes the clip and resumes at the anchor word. */
  closeToFilm(): void {
    if (!this.opened || this.phase === 'done') return;
    this.phase = 'done';
    const seconds = this.anchorSeconds ?? this.host.time;
    this.host.seek(seconds);
    this.host.play();
    this.emit({ type: 'resume', anchor: this.clip.anchor, seconds });
  }
}
