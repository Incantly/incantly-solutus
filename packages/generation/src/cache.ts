import { SDK_VERSION, type ScenePlan } from '@incantly/core';
import type { FragmentSet } from './fragments';

/**
 * The concept cache (PRD 25.6). Figures are generic, so an approved figure
 * can serve the next learner who asks the same thing, in well under a second
 * with no model call. Two keys find it: the request, normalised, before the
 * plan call; and the plan, after it, so a differently worded request that
 * plans the same figure skips the scene call. Keys hold the kit version and
 * never anything from a learner's note, and only figures made without note
 * text are stored, so nothing from one learner's note reaches another.
 */

export interface CachedFigure {
  readonly plan: ScenePlan;
  readonly fragments: Required<FragmentSet>;
  readonly sdkVersion: string;
}

interface Entry {
  readonly figure: CachedFigure;
  readonly storedAt: number;
  hits: number;
}

const STOP_WORDS = new Set(
  'a an the of to in on for and or with how what why when does do is are be show me explain please can you i my about from by as at that this it its into figure diagram visualise visualize draw make interactive simulation simulate'.split(' '),
);

function words(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
        .map((w) => w.replace(/(ing|es|s)$/, '')),
    ),
  ].sort();
}

/** The request as a key: its meaningful words, in order, with the kit version. */
export function requestKey(prompt: string): string | null {
  const meaningful = words(prompt);
  return meaningful.length === 0 ? null : `r|${SDK_VERSION}|${meaningful.join(' ')}`;
}

/** The plan as a key: everything the scene is built from. */
export function planKey(plan: ScenePlan): string {
  const signature = {
    concept: words(plan.concept).join(' '),
    size: plan.size ?? 'quick',
    capabilities: [...plan.capabilities].sort(),
    parameters: plan.parameters.map((p) => [p.name, p.min, p.max, p.default, p.control ?? 'slider', p.options ?? []]),
    outputs: plan.model.outputs.map((o) => o.name).sort(),
    parts: plan.parts,
    steps: plan.steps.length,
  };
  return `p|${SDK_VERSION}|${JSON.stringify(signature)}`;
}

export interface CacheStats {
  readonly size: number;
  readonly lookups: number;
  readonly hits: number;
}

export class ConceptCache {
  private readonly entries = new Map<string, Entry>();
  private lookups = 0;
  private hits = 0;

  constructor(
    private readonly options: { readonly max?: number; readonly ttlMs?: number; readonly now?: () => number } = {},
  ) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  get(key: string | null): CachedFigure | null {
    if (key === null) return null;
    this.lookups++;
    const entry = this.entries.get(key);
    if (!entry || entry.figure.sdkVersion !== SDK_VERSION) return null;
    if (this.options.ttlMs !== undefined && this.now - entry.storedAt > this.options.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    // Least recently used goes first: a hit moves to the end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    entry.hits++;
    this.hits++;
    return entry.figure;
  }

  put(keys: ReadonlyArray<string | null>, figure: CachedFigure): void {
    const max = this.options.max ?? 500;
    for (const key of keys) {
      if (key === null) continue;
      this.entries.delete(key);
      this.entries.set(key, { figure, storedAt: this.now, hits: 0 });
      while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value!);
    }
  }

  stats(): CacheStats {
    return { size: this.entries.size, lookups: this.lookups, hits: this.hits };
  }
}
