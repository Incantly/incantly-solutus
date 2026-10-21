/**
 * Per-learner rate and cost limits for the generation service: how many
 * generations a learner may start a minute and a day, how many may run at
 * once, and how much a learner's generations, and all of them together, may
 * cost in a day. Days are UTC days.
 */

export interface Limits {
  /** Generations a learner may start in any sixty seconds. */
  readonly perMinute: number;
  readonly perDay: number;
  /** Generations a learner may have running at once. */
  readonly concurrent: number;
  /** US dollars of model usage per learner per day. */
  readonly learnerDailyUsd: number;
  /** US dollars of model usage for the whole service per day. */
  readonly serviceDailyUsd: number;
}

export const DEFAULT_LIMITS: Limits = { perMinute: 4, perDay: 60, concurrent: 2, learnerDailyUsd: 1, serviceDailyUsd: 100 };

export type RefusalCode = 'rate-limit' | 'daily-limit' | 'busy' | 'cost-limit' | 'service-cost-limit';

export interface Refusal {
  readonly code: RefusalCode;
  readonly message: string;
  readonly retryAfterSeconds: number;
}

interface LearnerUsage {
  starts: number[];
  day: string;
  today: number;
  spentUsd: number;
  running: number;
}

const DAY_MS = 86_400_000;

export class LimitKeeper {
  private readonly learners = new Map<string, LearnerUsage>();
  private serviceDay = '';
  private serviceSpentUsd = 0;

  constructor(
    private readonly limits: Limits = DEFAULT_LIMITS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private day(at: number): string {
    return new Date(at).toISOString().slice(0, 10);
  }

  private secondsToMidnight(at: number): number {
    return Math.max(1, Math.ceil((DAY_MS - (at % DAY_MS)) / 1000));
  }

  private usageOf(learnerId: string, at: number): LearnerUsage {
    let usage = this.learners.get(learnerId);
    const day = this.day(at);
    if (!usage) {
      usage = { starts: [], day, today: 0, spentUsd: 0, running: 0 };
      this.learners.set(learnerId, usage);
    }
    if (usage.day !== day) {
      usage.day = day;
      usage.today = 0;
      usage.spentUsd = 0;
    }
    usage.starts = usage.starts.filter((t) => t > at - 60_000);
    if (this.serviceDay !== day) {
      this.serviceDay = day;
      this.serviceSpentUsd = 0;
    }
    return usage;
  }

  /** A refusal for spending more, or null. Repairs check this; new generations check it too. */
  checkSpend(learnerId: string): Refusal | null {
    const at = this.now();
    const usage = this.usageOf(learnerId, at);
    if (this.serviceSpentUsd >= this.limits.serviceDailyUsd) {
      return { code: 'service-cost-limit', message: 'Figure generation has reached its budget for today', retryAfterSeconds: this.secondsToMidnight(at) };
    }
    if (usage.spentUsd >= this.limits.learnerDailyUsd) {
      return { code: 'cost-limit', message: 'You have reached today’s limit for new figures', retryAfterSeconds: this.secondsToMidnight(at) };
    }
    return null;
  }

  /** Admits a new generation, or says why not. Call `release` when it ends. */
  admit(learnerId: string): { readonly ok: true; readonly release: () => void } | { readonly ok: false; readonly refusal: Refusal } {
    const at = this.now();
    const usage = this.usageOf(learnerId, at);
    const spend = this.checkSpend(learnerId);
    if (spend) return { ok: false, refusal: spend };
    if (usage.today >= this.limits.perDay) {
      return { ok: false, refusal: { code: 'daily-limit', message: 'You have made as many figures as you can today', retryAfterSeconds: this.secondsToMidnight(at) } };
    }
    if (usage.starts.length >= this.limits.perMinute) {
      const wait = Math.ceil((usage.starts[0]! + 60_000 - at) / 1000);
      return { ok: false, refusal: { code: 'rate-limit', message: 'Too many figures at once; wait a moment', retryAfterSeconds: Math.max(1, wait) } };
    }
    if (usage.running >= this.limits.concurrent) {
      return { ok: false, refusal: { code: 'busy', message: 'Your other figures are still being made', retryAfterSeconds: 5 } };
    }
    usage.starts.push(at);
    usage.today++;
    usage.running++;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        usage.running = Math.max(0, usage.running - 1);
      },
    };
  }

  spend(learnerId: string, usd: number): void {
    if (!(usd > 0)) return;
    const usage = this.usageOf(learnerId, this.now());
    usage.spentUsd += usd;
    this.serviceSpentUsd += usd;
  }

  usage(learnerId: string): { readonly today: number; readonly spentUsd: number; readonly running: number } {
    const usage = this.usageOf(learnerId, this.now());
    return { today: usage.today, spentUsd: usage.spentUsd, running: usage.running };
  }
}
