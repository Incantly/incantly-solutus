import { SDK_VERSION, type ScenePlan } from '@incantly/core';
import type { FragmentSet } from './fragments';
import { STOP_WORDS } from './words';

/**
 * The concept cache (PRD 25.6). Figures are generic, so an approved figure
 * can serve the next learner who asks the same thing, in well under a second
 * with no model call. Three ways find one, each strict, because a figure that
 * answers a similar request instead of this one is wrong, not merely stale:
 *
 * - the request: the same meaningful words, before the plan call;
 * - the plan: the same plan, whole, after it. The scene call sees only the
 *   plan, so the figure is what a new scene call would have been asked for;
 * - reuse: a figure the plan call chose for the request (see candidates).
 *
 * Keys hold the kit version and never anything from a learner's note, and
 * only figures made without note text are stored under their request, so
 * nothing from one learner's note reaches another.
 */

export interface CachedFigure {
  readonly plan: ScenePlan;
  readonly fragments: Required<FragmentSet>;
  readonly sdkVersion: string;
}

interface Entry {
  readonly figure: CachedFigure;
  /** Every meaningful word of the requests and the plan it was made for: what it can be said to answer. */
  readonly vocabulary: Set<string>;
  readonly storedAt: number;
  hits: number;
}

/** Words a request uses to ask for something, which say nothing about what it asks for. */
const ASKING: ReadonlySet<string> = new Set('want need like see would could should help give let we us some something'.split(' '));

function words(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !ASKING.has(w))
        .map((w) => w.replace(/(ing|es|s)$/, '')),
    ),
  ].sort();
}

/** Prose as its meaningful words, so wording that differs only in case, order or filler still matches. */
function prose(text: string): string {
  return words(text).join(' ');
}

/** Every meaningful word of a plan. */
function planWords(plan: ScenePlan): string[] {
  return words([plan.concept, plan.idea, plan.moves, ...plan.parts, ...plan.steps, ...plan.parameters.map((p) => p.name.replace(/([a-z])([A-Z])/g, '$1 $2'))].join(' '));
}

/** The request as a key: its meaningful words, in order, with the kit version. */
export function requestKey(prompt: string): string | null {
  const meaningful = words(prompt);
  return meaningful.length === 0 ? null : `r|${SDK_VERSION}|${meaningful.join(' ')}`;
}

/**
 * The plan as a key: the whole plan, as the scene call is given it, with
 * prose reduced to its meaningful words. A plan that differs in what the
 * figure teaches or how it moves is another figure, even with the same
 * concept and controls.
 */
export function planKey(plan: ScenePlan): string {
  const signature = {
    concept: prose(plan.concept),
    idea: prose(plan.idea),
    kind: plan.kind,
    size: plan.size ?? 'quick',
    capabilities: [...plan.capabilities].sort(),
    parameters: plan.parameters.map((p) => [p.name, p.unit ?? '', p.min, p.max, p.default, p.control ?? 'slider', p.options ?? []]),
    outputs: plan.model.outputs.map((o) => [o.name, [...o.dependsOn].sort()]),
    parts: plan.parts.map(prose),
    moves: prose(plan.moves),
    steps: plan.steps.map(prose),
    singularPoints: plan.singularPoints ?? [],
  };
  return `p|${SDK_VERSION}|${JSON.stringify(signature)}`;
}

/** A cached figure the plan call may choose for a request, under a short id that lives for that one call. */
export interface ReuseCandidate {
  readonly id: string;
  readonly figure: CachedFigure;
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

  private fresh(entry: Entry): boolean {
    return entry.figure.sdkVersion === SDK_VERSION && (this.options.ttlMs === undefined || this.now - entry.storedAt <= this.options.ttlMs);
  }

  get(key: string | null): CachedFigure | null {
    if (key === null) return null;
    this.lookups++;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (!this.fresh(entry)) {
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

  /**
   * Stores a figure under its keys. `request` is what the learner asked for
   * it, when that may be stored: its words join the plan's in what the figure
   * can be said to answer.
   */
  put(keys: ReadonlyArray<string | null>, figure: CachedFigure, request?: string): void {
    const max = this.options.max ?? 500;
    const vocabulary = new Set([...planWords(figure.plan), ...(request ? words(request) : [])]);
    for (const key of keys) {
      if (key === null) continue;
      // A figure stored before under this key keeps the words it was asked for with too.
      for (const w of this.entries.get(key)?.vocabulary ?? []) vocabulary.add(w);
      this.entries.delete(key);
      this.entries.set(key, { figure, vocabulary, storedAt: this.now, hits: 0 });
      while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value!);
    }
  }

  /**
   * Figures that may answer a request, for the plan call to choose from:
   * only those whose words take in every meaningful word of the request, so a
   * request that asks for anything more ("a sine wave from Euler's formula,
   * with circles") is never offered a figure without it ("a sine wave"). The
   * plan call then judges the meaning; this keeps it from ever seeing a
   * figure that lacks something the learner named. Most recently used first.
   */
  candidates(request: string, limit = 3): ReuseCandidate[] {
    const asked = words(request);
    if (asked.length === 0) return [];
    const found: CachedFigure[] = [];
    for (const entry of [...this.entries.values()].reverse()) {
      if (found.length >= limit) break;
      if (found.includes(entry.figure) || !this.fresh(entry)) continue;
      if (asked.every((w) => entry.vocabulary.has(w))) found.push(entry.figure);
    }
    return found.map((figure, i) => ({ id: `f${i + 1}`, figure }));
  }

  stats(): CacheStats {
    return { size: this.entries.size, lookups: this.lookups, hits: this.hits };
  }
}
