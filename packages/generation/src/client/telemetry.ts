/**
 * Pilot telemetry (the product signals): whether learners change parameters
 * and finish walkthroughs, how fast figures appear, how generation and repair
 * go, and what fails. Every signal is ids, names, numbers and fixed words,
 * checked field by field, so no note content can leave the device: anything
 * that does not fit is dropped and counted.
 */

export type FallbackLevel = 'last-approved' | 'standard' | 'snapshot' | 'text';

export type ProductSignal =
  /** A figure drew for the learner. */
  | { readonly type: 'figure-shown'; readonly figureId: string; readonly generationId?: string }
  /** The learner changed a parameter: once per figure and parameter in a session. */
  | { readonly type: 'parameter-changed'; readonly figureId: string; readonly parameter: string }
  | { readonly type: 'step-reached'; readonly figureId: string; readonly step: number; readonly count: number }
  /** The learner reached the last step of the walkthrough. */
  | { readonly type: 'steps-completed'; readonly figureId: string; readonly count: number }
  /** A shown figure went away; abandoned when it was left within a minute without being used. */
  | { readonly type: 'figure-left'; readonly figureId: string; readonly visibleMs: number; readonly interacted: boolean; readonly abandoned: boolean }
  | { readonly type: 'time-to-skeleton'; readonly ms: number }
  /** From the request, or from mounting a stored figure, to its first drawing. */
  | { readonly type: 'first-paint'; readonly figureId: string; readonly ms: number }
  /** From the request, or from mounting, to controls that respond. */
  | { readonly type: 'interactive'; readonly figureId: string; readonly ms: number }
  | {
      readonly type: 'generation';
      readonly ms: number;
      readonly outcome: 'approved' | 'fallback';
      readonly repaired: boolean;
      readonly fallback?: FallbackLevel;
      readonly reason?: string;
    }
  | { readonly type: 'repair'; readonly ms: number; readonly outcome: 'scene' | 'fallback' | 'error' }
  /** A figure ran into a problem: its kind and the parameter values it happened at. */
  | {
      readonly type: 'figure-failure';
      readonly figureId: string;
      readonly generationId?: string;
      readonly kind: string;
      readonly fatal: boolean;
      readonly values: Readonly<Record<string, number>>;
    }
  /** A stored figure could not be restored. */
  | { readonly type: 'restore-failure'; readonly figureId: string; readonly reason: string };

export type TelemetryEvent = ProductSignal & { readonly at: number; readonly session: string };

export interface TelemetryOptions {
  /** Receives batches of events; the host sends them to its own analytics. */
  readonly sink: (events: readonly TelemetryEvent[]) => void | Promise<void>;
  readonly batchSize?: number;
  readonly flushMs?: number;
  readonly session?: string;
  readonly now?: () => number;
}

/** Ids and names: letters, digits and - _ . : only, no spaces, so text cannot pass. */
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

type Field = 'token' | 'count' | 'ms' | 'boolean' | 'values' | readonly string[];

const OUTCOMES = ['approved', 'fallback'] as const;
const LEVELS = ['last-approved', 'standard', 'snapshot', 'text'] as const;

/** Every signal's fields and what each may hold; anything else is dropped. */
const SCHEMA: Readonly<Record<ProductSignal['type'], Readonly<Record<string, readonly [Field, boolean]>>>> = {
  'figure-shown': { figureId: ['token', true], generationId: ['token', false] },
  'parameter-changed': { figureId: ['token', true], parameter: ['token', true] },
  'step-reached': { figureId: ['token', true], step: ['count', true], count: ['count', true] },
  'steps-completed': { figureId: ['token', true], count: ['count', true] },
  'figure-left': { figureId: ['token', true], visibleMs: ['ms', true], interacted: ['boolean', true], abandoned: ['boolean', true] },
  'time-to-skeleton': { ms: ['ms', true] },
  'first-paint': { figureId: ['token', true], ms: ['ms', true] },
  interactive: { figureId: ['token', true], ms: ['ms', true] },
  generation: { ms: ['ms', true], outcome: [OUTCOMES, true], repaired: ['boolean', true], fallback: [LEVELS, false], reason: ['token', false] },
  repair: { ms: ['ms', true], outcome: [['scene', 'fallback', 'error'], true] },
  'figure-failure': { figureId: ['token', true], generationId: ['token', false], kind: ['token', true], fatal: ['boolean', true], values: ['values', true] },
  'restore-failure': { figureId: ['token', true], reason: ['token', true] },
};

function fits(field: Field, value: unknown): boolean {
  if (Array.isArray(field)) return typeof value === 'string' && field.includes(value);
  switch (field) {
    case 'token':
      return typeof value === 'string' && TOKEN.test(value);
    case 'count':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000;
    case 'ms':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
    case 'boolean':
      return typeof value === 'boolean';
    case 'values':
      return (
        typeof value === 'object' &&
        value !== null &&
        Object.keys(value).length <= 8 &&
        Object.entries(value).every(([k, v]) => TOKEN.test(k) && typeof v === 'number' && Number.isFinite(v))
      );
    default:
      return false;
  }
}

/** The signal with only its known fields, or null when it does not fit its schema. */
export function cleanSignal(signal: unknown): ProductSignal | null {
  if (typeof signal !== 'object' || signal === null) return null;
  const raw = signal as Record<string, unknown>;
  const schema = typeof raw.type === 'string' ? SCHEMA[raw.type as ProductSignal['type']] : undefined;
  if (!schema) return null;
  const out: Record<string, unknown> = { type: raw.type };
  for (const [name, [field, required]] of Object.entries(schema)) {
    const value = raw[name];
    if (value === undefined) {
      if (required) return null;
      continue;
    }
    if (!fits(field, value)) return null;
    out[name] = name === 'ms' || name === 'visibleMs' ? Math.round(value as number) : value;
  }
  return out as ProductSignal;
}

function sessionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `s-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class Telemetry {
  readonly session: string;
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private droppedCount = 0;
  private readonly now: () => number;

  constructor(private readonly options: TelemetryOptions) {
    this.session = options.session ?? sessionId();
    this.now = options.now ?? (() => Date.now());
  }

  /** Signals that did not fit their schema and were never sent. */
  get dropped(): number {
    return this.droppedCount;
  }

  readonly emit = (signal: ProductSignal): void => {
    const clean = cleanSignal(signal);
    if (!clean) {
      this.droppedCount++;
      return;
    }
    this.queue.push({ ...clean, at: this.now(), session: this.session });
    if (this.queue.length >= (this.options.batchSize ?? 20)) void this.flush();
    else if (this.timer === null) this.timer = setTimeout(() => void this.flush(), this.options.flushMs ?? 5000);
  };

  async flush(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    try {
      await this.options.sink(batch);
    } catch {
      // Telemetry never breaks a note.
    }
  }
}
