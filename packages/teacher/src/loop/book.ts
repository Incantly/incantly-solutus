/**
 * The data a turn keeps about the lines it ran (errors design 6, rules 3, 6 and 10): how often each line failed, and how
 * many lines in a row failed with the same kind. These are counts and lists, not states.
 */
import type { ErrorObject, Recovery } from '@incantly/kernel';

/** A line is retried at most twice: the first failure plus two retries is the budget. */
export const RETRY_FAILURES = 3;
/** Three lines in a row with the same error kind, none passing, make the loop read the figure (errors design 6, rule 10). */
export const STREAK_LIMIT = 3;

const DEFINES = /^\s*([^=()#@]+?(?:\([^)]*\))?'?)\s*=(?!=)/u;

/** What names a line across retries: the left side of a definition (`P`, `f(x)`, `A, B`), else the line itself. */
export function lineKey(line: string): string {
  const m = DEFINES.exec(line);
  return m !== null && m[1] !== undefined ? m[1].replace(/\s+/g, '') : line.trim();
}

/** The PascalCase names a line calls (`Circle`, `PointOn`), in order. */
export function commandsIn(line: string): string[] {
  return [...line.matchAll(/\b([A-Z][A-Za-z0-9]*)\s*\(/g)].map((m) => m[1] as string);
}

interface Failures {
  readonly texts: string[];
  readonly prints: string[];
  /** Texts the error said not to send again (recovery `skip` or `report`). */
  readonly barred: Set<string>;
}

/** The failures of each line of a turn, keyed by `lineKey`. */
export class RetryBook {
  private readonly failures = new Map<string, Failures>();

  /** True when the line may not run again: its retries are spent, or its error said not to retry this text. */
  isSpent(key: string, text: string): boolean {
    const f = this.failures.get(key);
    if (f === undefined) return false;
    if (f.barred.has(text)) return true;
    if (f.prints.length >= RETRY_FAILURES) return true;
    const n = f.prints.length;
    // the same text with the same fingerprint twice: the retry changed nothing
    return n >= 2 && f.texts[n - 1] === f.texts[n - 2] && f.prints[n - 1] === f.prints[n - 2];
  }

  /** Records a failure; true when the line is now spent. */
  failed(key: string, text: string, e: { readonly fingerprint?: string; readonly kind: string; readonly recovery?: Recovery }): boolean {
    const f = this.failures.get(key) ?? { texts: [], prints: [], barred: new Set<string>() };
    f.texts.push(text);
    f.prints.push(e.fingerprint ?? e.kind);
    if (e.recovery === 'skip' || e.recovery === 'report') f.barred.add(text);
    this.failures.set(key, f);
    return this.isSpent(key, text);
  }

  /** A line that passed forgets its failures. */
  passed(key: string): void {
    this.failures.delete(key);
  }
}

/** How many lines in a row failed with one kind, and which kind. A line that passes ends the run. */
export class Streak {
  private kind = '';
  private count = 0;

  /** Counts one line's result: the error's kind, or undefined for a line that passed. */
  add(failure: Pick<ErrorObject, 'kind'> | undefined): void {
    if (failure === undefined) {
      this.kind = '';
      this.count = 0;
    } else if (failure.kind === this.kind) {
      this.count += 1;
    } else {
      this.kind = failure.kind;
      this.count = 1;
    }
  }

  get length(): number {
    return this.count;
  }

  reset(): void {
    this.kind = '';
    this.count = 0;
  }
}
