/**
 * The size limits of a figure (docs/features/kernel/errors.md section 6). A host passes a partial `Limits` to lower or
 * raise them; areas add their own entries through `extra`.
 */

export interface Limits {
  /** Objects per figure. */
  readonly objects: number;
  /** Expression nodes per line. */
  readonly exprNodes: number;
  /** Characters per line. */
  readonly lineLength: number;
  /** Items in one list. */
  readonly listSize: number;
  /** Rule nesting depth. */
  readonly depth: number;
  /** Journal entries kept for undo. */
  readonly journalEntries: number;
  /** Bytes of snapshot text kept for undo. */
  readonly journalBytes: number;
  /** Time budget of one rule in milliseconds (a rule that overruns is recorded, never aborted). */
  readonly ruleBudgetMs: number;
  /** Bytes of a script file to load. */
  readonly fileSize: number;
  /** Comments and directives per figure. */
  readonly items: number;
  /** Lines in one batch or one loaded file. */
  readonly lines: number;
  /** Characters in a free Text value (the language's own cap for a text). */
  readonly textLength: number;
  /** Areas append their own limits here, by name. */
  readonly extra: Readonly<Record<string, number>>;
}

export const DEFAULT_LIMITS: Limits = Object.freeze({
  objects: 5000,
  exprNodes: 400,
  lineLength: 2000,
  listSize: 100000,
  depth: 64,
  journalEntries: 500,
  journalBytes: 4 * 1024 * 1024,
  ruleBudgetMs: 2,
  fileSize: 2 * 1024 * 1024,
  items: 5000,
  lines: 20000,
  textLength: 10000,
  extra: Object.freeze({}),
});

/** The defaults with the host's values on top. Values that are not positive finite numbers are ignored. */
export function resolveLimits(partial: Partial<Limits> | undefined): Limits {
  if (!partial) return DEFAULT_LIMITS;
  const out: { -readonly [K in keyof Limits]: Limits[K] } = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
    if (key === 'extra') continue;
    const v = partial[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) (out as Record<string, unknown>)[key] = v;
  }
  if (partial.extra) out.extra = Object.freeze({ ...partial.extra });
  return Object.freeze(out);
}
