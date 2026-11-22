/**
 * Limits per client and for the day (docs/features/server/design.md 7). These are counters, not states: a sliding
 * minute of weighted requests per client, one model request at a time per client (a newer one aborts the older), and a
 * count of model calls that starts again at UTC midnight. Time comes from the clock the caller passes, so a test decides it.
 */
import { dailyBudget, rateLimited } from '../errors';
import type { ServerError } from '../errors';

export interface RateConfig {
  readonly ratePerMinute: number;
  readonly dailyModelCalls: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface Admission {
  readonly ok: true;
  /** Ends the request's hold on its client's slot. Safe to call more than once. */
  release(): void;
}

export interface AcquireOptions {
  /** What the request counts in the minute: 1 for a model request, 0.1 for one sentence of speech. */
  readonly weight?: number;
  /** A model request: the client's earlier one is aborted, and this one holds the slot until released. */
  readonly exclusive?: boolean;
  /** Aborted when a newer exclusive request of the same client arrives. */
  readonly controller?: AbortController;
}

interface Entry {
  readonly at: number;
  readonly weight: number;
}

export class RateLimiter {
  private readonly recent = new Map<string, Entry[]>();
  private readonly active = new Map<string, AbortController>();
  /** The UTC day number of `calls`. */
  private day = 0;
  private calls = 0;

  constructor(
    private readonly config: RateConfig,
    private readonly now: () => number,
  ) {}

  /**
   * Admits a request of `client`, or says why not: `rate_limited` with `retryAfterMs` when the minute is full. A
   * request that is admitted counts in the minute at once. An exclusive request aborts the client's earlier one.
   */
  acquire(client: string, options: AcquireOptions = {}): Admission | ServerError {
    const t = this.now();
    const weight = options.weight ?? 1;
    const entries = (this.recent.get(client) ?? []).filter((e) => e.at > t - MINUTE);
    const used = entries.reduce((n, e) => n + e.weight, 0);
    if (used + weight > this.config.ratePerMinute + 1e-9) {
      this.recent.set(client, entries);
      return rateLimited(this.waitFor(entries, used + weight - this.config.ratePerMinute, t));
    }
    entries.push({ at: t, weight });
    this.recent.set(client, entries);
    const controller = options.controller;
    if (options.exclusive !== true || controller === undefined) return { ok: true, release: () => undefined };
    this.active.get(client)?.abort();
    this.active.set(client, controller);
    return {
      ok: true,
      release: () => {
        if (this.active.get(client) === controller) this.active.delete(client);
      },
    };
  }

  /** Counts one model call against the day. `daily_budget` when the day's calls are used up. */
  takeModelCall(): { readonly ok: true } | ServerError {
    const t = this.now();
    const today = Math.floor(t / DAY);
    if (today !== this.day) {
      this.day = today;
      this.calls = 0;
    }
    if (this.calls >= this.config.dailyModelCalls) return dailyBudget((today + 1) * DAY - t);
    this.calls += 1;
    return { ok: true };
  }

  /** Model calls taken today (UTC). */
  get callsToday(): number {
    return Math.floor(this.now() / DAY) === this.day ? this.calls : 0;
  }

  /** Milliseconds until enough of the minute's weight has expired to free `needed`. */
  private waitFor(entries: readonly Entry[], needed: number, t: number): number {
    let freed = 0;
    for (const e of entries) {
      freed += e.weight;
      if (freed >= needed - 1e-9) return Math.max(1, e.at + MINUTE - t);
    }
    return MINUTE;
  }
}
