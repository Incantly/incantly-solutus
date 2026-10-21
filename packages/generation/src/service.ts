import type { IncomingMessage, ServerResponse } from 'node:http';
import { SDK_VERSION, type ProbeCheck, type ProbeFailure, type ProbeReport, type ProbeSpec, type ScenePlan } from '@incantly/core';
import type { Authenticator, Learner } from './auth';
import { REQUEST_LIMITS, type LearnerRequest } from './context';
import { DEFAULT_LIMITS, LimitKeeper, type Limits, type Refusal } from './limits';
import type { ModelClient } from './models';
import { Generator, standardFigure, type GenerationState } from './pipeline';
import { probeSpecFor } from './probe';
import { failureRecord, type RecordSink } from './records';

/**
 * The generation service: an authenticated HTTP endpoint for the plan, scene
 * and repair calls. The plan and static validation run here; the learner's
 * device probes the scene in its sandbox and reports back, and a failed probe
 * gets one repair. Limits are per learner, every model call has a deadline,
 * a switch turns generation off without touching stored figures (they never
 * call this service), and nothing the learner wrote is kept.
 *
 *   GET  /v1/status
 *   POST /v1/generations              { prompt, noteContext? }  -> event stream
 *   POST /v1/generations/:id/probe    { ok, report? }           -> approved, a repaired scene, or a fallback
 */

export interface ServiceOptions {
  readonly model: ModelClient;
  readonly authenticate: Authenticator;
  readonly limits?: Limits;
  /** The switch: when it returns false no generation starts, and stored figures carry on as before. */
  readonly enabled?: () => boolean;
  readonly records?: RecordSink | null;
  /** Deadline for one generation request, all model calls included. */
  readonly generationTimeoutMs?: number;
  /** How long a generation waits for the device's probe result. */
  readonly sessionMinutes?: number;
  readonly recordsRetentionDays?: number;
  readonly maxRepairs?: number;
  /** Browser origins allowed to call the service directly. */
  readonly allowedOrigins?: readonly string[];
  readonly prefix?: string;
  readonly now?: () => number;
}

/** What the skeleton needs from the plan: names and numbers only (PRD 18.6). */
export interface Skeleton {
  readonly concept: string;
  readonly kind: ScenePlan['kind'];
  readonly parameters: ReadonlyArray<{ readonly name: string; readonly unit?: string; readonly min: number; readonly max: number; readonly default: number }>;
  readonly parts: number;
  readonly steps: number;
}

export interface SceneMessage {
  readonly generationId: string;
  readonly fragments: { readonly html: string; readonly css: string; readonly js: string };
  readonly spec: ProbeSpec;
  readonly sdkVersion: string;
  readonly concept: string;
  readonly description: string;
}

export interface FallbackMessage {
  readonly generationId: string | null;
  readonly reason: 'plan' | 'scene' | 'model' | 'timeout' | 'off' | 'limit';
  /** The reviewed figure for the same concept, when there is one. */
  readonly standard: (Omit<SceneMessage, 'generationId'> & { readonly id: string }) | null;
}

export const RETENTION = {
  noteText: 'The request and any note text are sent to the model provider for the plan call and are not stored by this service or written to logs or records.',
  records: 'Generation records keep the plan, the fragments, the check reports and the outcome, never the request or note text, and are deleted after the stated number of days.',
  sessions: 'A generation waiting for its device probe is kept in memory for the stated number of minutes.',
} as const;

interface Session {
  readonly state: GenerationState;
  readonly generator: Generator;
  readonly learner: Learner;
  expiresAt: number;
  busy: boolean;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const CHECKS: ReadonlySet<string> = new Set<ProbeCheck>([
  'mount',
  'runs',
  'numbers',
  'sweep',
  'paused-change',
  'singular',
  'interior',
  'bounds',
  'budget',
  'frame-cost',
  'parts',
  'steps',
  'idea',
  'description',
  'timeout',
]);

const PHASES: ReadonlySet<string> = new Set(['mount', 'frame', 'model', 'readout', 'explain', 'describe', 'tween', 'plot', 'runaway', 'unresponsive']);

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Control characters out, and short: device reports go into a prompt.
  let clean = '';
  for (const char of value.slice(0, max)) {
    const code = char.charCodeAt(0);
    clean += code < 32 || code === 127 ? ' ' : char;
  }
  return clean;
}

/**
 * A probe report from a learner's device, reduced to what a repair may quote.
 * It is untrusted input bound for a prompt: checks and phases must be known,
 * values must be the plan's parameters, and text is short.
 */
export function sanitizeDeviceReport(input: unknown, plan: ScenePlan, jsLines: number): ProbeReport | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as { failures?: unknown };
  if (!Array.isArray(raw.failures) || raw.failures.length === 0) return null;
  const names = new Set(plan.parameters.map((p) => p.name));
  const failures: ProbeFailure[] = [];
  for (const item of raw.failures.slice(0, 8)) {
    if (typeof item !== 'object' || item === null) return null;
    const f = item as Record<string, unknown>;
    if (typeof f.check !== 'string' || !CHECKS.has(f.check)) return null;
    const message = text(f.message, 300);
    if (message === null) return null;
    const failure: { -readonly [K in keyof ProbeFailure]: ProbeFailure[K] } = { check: f.check as ProbeCheck, message };
    if (typeof f.values === 'object' && f.values !== null) {
      const values: Record<string, number> = {};
      for (const [name, value] of Object.entries(f.values as Record<string, unknown>)) {
        if (names.has(name) && typeof value === 'number' && Number.isFinite(value)) values[name] = value;
      }
      failure.values = values;
    }
    if (typeof f.playing === 'boolean') failure.playing = f.playing;
    if (typeof f.time === 'number' && Number.isFinite(f.time) && f.time >= 0) failure.time = f.time;
    if (typeof f.error === 'object' && f.error !== null) {
      const e = f.error as Record<string, unknown>;
      const errorMessage = text(e.message, 300);
      if (typeof e.phase === 'string' && PHASES.has(e.phase) && errorMessage !== null) {
        const line = typeof e.line === 'number' && Number.isInteger(e.line) && e.line >= 1 && e.line <= jsLines ? e.line : undefined;
        const column = line !== undefined && typeof e.column === 'number' && Number.isInteger(e.column) && e.column >= 1 && e.column <= 2000 ? e.column : undefined;
        failure.error = {
          phase: e.phase,
          name: typeof e.name === 'string' && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error',
          message: errorMessage,
          ...(line !== undefined ? { line } : {}),
          ...(column !== undefined ? { column } : {}),
        };
      }
    }
    failures.push(failure);
  }
  return { ok: false, failures, stats: { configurations: 0, frames: 0, averageFrameMs: 0, elements: 0, durationMs: 0 } };
}

export function skeletonOf(plan: ScenePlan): Skeleton {
  return {
    concept: plan.concept,
    kind: plan.kind,
    parameters: plan.parameters.map((p) => ({ name: p.name, ...(p.unit ? { unit: p.unit } : {}), min: p.min, max: p.max, default: p.default })),
    parts: plan.parts.length,
    steps: plan.steps.length,
  };
}

function readRequest(body: unknown): LearnerRequest {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'invalid-request', 'The body must be a JSON object');
  const { prompt, noteContext } = body as { prompt?: unknown; noteContext?: unknown };
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new HttpError(400, 'invalid-request', 'prompt must be a non-empty string');
  if (prompt.length > REQUEST_LIMITS.prompt * 2) throw new HttpError(400, 'invalid-request', `prompt must be at most ${REQUEST_LIMITS.prompt} characters`);
  if (noteContext !== undefined && typeof noteContext !== 'string') throw new HttpError(400, 'invalid-request', 'noteContext must be a string');
  return { prompt: prompt.trim(), ...(noteContext ? { noteContext: noteContext.slice(0, REQUEST_LIMITS.noteContext * 2) } : {}) };
}

export class GenerationService {
  private readonly sessions = new Map<string, Session>();
  private readonly limits: LimitKeeper;
  private readonly now: () => number;
  private readonly prefix: string;
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor(private readonly options: ServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.limits = new LimitKeeper(options.limits ?? DEFAULT_LIMITS, this.now);
    this.prefix = options.prefix ?? '/v1';
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  get enabled(): boolean {
    return this.options.enabled ? this.options.enabled() : true;
  }

  /** The request handler, for node:http or any connect-style server. */
  readonly handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      this.cors(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
      const path = (req.url ?? '/').split('?')[0]!;
      if (req.method === 'GET' && path === `${this.prefix}/status`) return this.status(res);
      if (req.method === 'POST' && path === `${this.prefix}/generations`) return await this.generate(req, res);
      const probe = new RegExp(`^${this.prefix}/generations/([\\w-]{1,80})/probe$`).exec(path);
      if (req.method === 'POST' && probe) return await this.probeResult(req, res, probe[1]!);
      throw new HttpError(404, 'not-found', 'No such endpoint');
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const http = error instanceof HttpError ? error : new HttpError(500, 'internal', 'The service failed');
      this.json(res, http.status, { code: http.code, message: http.message }, http.headers);
    }
  };

  /** Stops the session sweeper and records generations still waiting for their device. */
  async close(): Promise<void> {
    clearInterval(this.sweeper);
    await this.sweep(Number.POSITIVE_INFINITY);
  }

  usage(learnerId: string) {
    return this.limits.usage(learnerId);
  }

  // -------------------------------------------------------------------------

  private cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (origin && this.options.allowedOrigins?.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
  }

  private json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  }

  private status(res: ServerResponse): void {
    this.json(res, 200, {
      enabled: this.enabled,
      sdkVersion: SDK_VERSION,
      retention: {
        ...RETENTION,
        recordsDays: this.options.recordsRetentionDays ?? 30,
        sessionMinutes: this.options.sessionMinutes ?? 15,
      },
    });
  }

  private learner(req: IncomingMessage): Learner {
    const header = req.headers.authorization ?? '';
    const token = /^Bearer (\S+)$/.exec(header)?.[1];
    const learner = token ? this.options.authenticate(token) : null;
    if (!learner) throw new HttpError(401, 'unauthorized', 'A valid learner token is required', { 'www-authenticate': 'Bearer' });
    return learner;
  }

  private async body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > 16_384) throw new HttpError(413, 'too-large', 'The body is too large');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new HttpError(400, 'invalid-request', 'The body must be JSON');
    }
  }

  private refuse(refusal: Refusal): never {
    throw new HttpError(429, refusal.code, refusal.message, { 'retry-after': String(refusal.retryAfterSeconds) });
  }

  private sceneMessage(state: GenerationState): SceneMessage {
    const scene = state.scene!;
    const plan = state.plan!;
    return {
      generationId: state.id,
      fragments: { html: scene.html, css: scene.css, js: scene.js },
      spec: probeSpecFor(plan),
      sdkVersion: SDK_VERSION,
      concept: plan.concept,
      description: plan.idea,
    };
  }

  private fallback(state: GenerationState | null, reason: FallbackMessage['reason'], concept: string): FallbackMessage {
    const standard = standardFigure(concept);
    return {
      generationId: state?.id ?? null,
      reason,
      standard: standard
        ? {
            id: standard.id,
            fragments: { html: standard.html, css: standard.css, js: standard.js },
            spec: probeSpecFor(standard.plan),
            sdkVersion: SDK_VERSION,
            concept: standard.plan.concept,
            description: standard.plan.idea,
          }
        : null,
    };
  }

  private async record(state: GenerationState): Promise<void> {
    try {
      await this.options.records?.write(failureRecord(state, state.attempts.some((a) => a.probe) ? 'device' : 'none', new Date(this.now())));
    } catch {
      // Records must never break a learner's generation.
    }
  }

  private generator(): Generator {
    return new Generator({ model: this.options.model, probe: null, ...(this.options.maxRepairs !== undefined ? { maxRepairs: this.options.maxRepairs } : {}) });
  }

  private async generate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const learner = this.learner(req);
    if (!this.enabled) throw new HttpError(503, 'generation-off', 'Making new figures is switched off for now');
    const request = readRequest(await this.body(req));
    const admitted = this.limits.admit(learner.id);
    if (!admitted.ok) this.refuse(admitted.refusal);

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-accel-buffering': 'no',
    });
    const open = () => !res.writableEnded && !res.destroyed;
    const send = (event: string, data: unknown) => {
      if (open()) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const keepAlive = setInterval(() => {
      if (open()) res.write(': keep-alive\n\n');
    }, 10_000);
    const cancel = new AbortController();
    res.on('close', () => cancel.abort());
    const timeout = AbortSignal.timeout(this.options.generationTimeoutMs ?? 45_000);
    const signal = AbortSignal.any([cancel.signal, timeout]);

    const generator = this.generator();
    const state = generator.begin();
    send('accepted', { generationId: state.id });
    try {
      await generator.planStage(state, request, { onPlan: (plan) => send('plan', { generationId: state.id, skeleton: skeletonOf(plan) }) }, signal);
      if (state.plan) {
        await generator.buildStage(state, { onFragment: (name, ok) => send('fragment', { name, ok }) }, signal);
      }
      generator.finish(state);
    } finally {
      clearInterval(keepAlive);
      admitted.release();
      this.limits.spend(learner.id, state.cost);
    }

    if (state.status === 'validated' && state.scene) {
      this.sessions.set(state.id, { state, generator, learner, expiresAt: this.now() + (this.options.sessionMinutes ?? 15) * 60_000, busy: false });
      send('scene', this.sceneMessage(state));
    } else {
      const reason = timeout.aborted ? 'timeout' : (state.failure?.stage ?? 'scene');
      send('fallback', this.fallback(state, reason, state.plan?.concept ?? request.prompt));
      await this.record(state);
    }
    if (open()) res.end();
  }

  private async probeResult(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const learner = this.learner(req);
    const session = this.sessions.get(id);
    if (!session || session.learner.id !== learner.id || session.expiresAt <= this.now()) {
      throw new HttpError(404, 'unknown-generation', 'That generation has ended');
    }
    if (session.busy) throw new HttpError(409, 'busy', 'That generation is being repaired');
    const body = (await this.body(req)) as { ok?: unknown; report?: unknown };
    const { state, generator } = session;
    const plan = state.plan!;

    if (body.ok === true) {
      generator.deviceApproved(state, { ok: true, failures: [], stats: { configurations: 0, frames: 0, averageFrameMs: 0, elements: 0, durationMs: 0 } });
      this.sessions.delete(id);
      await this.record(state);
      this.json(res, 200, { status: 'approved', generationId: id });
      return;
    }
    const report = sanitizeDeviceReport(body.report, plan, (state.current?.fragments.js ?? '').split('\n').length);
    if (body.ok !== false || !report) throw new HttpError(400, 'invalid-request', 'Send { ok: true } or { ok: false, report: { failures } }');

    const repairReport = generator.deviceFailed(state, report);
    const stop = async (reason: FallbackMessage['reason']) => {
      this.sessions.delete(id);
      generator.finish(state);
      await this.record(state);
      this.json(res, 200, { status: 'fallback', ...this.fallback(state, reason, plan.concept) });
    };
    if (!generator.canRepair(state)) return stop('scene');
    if (!this.enabled) return stop('off');
    if (this.limits.checkSpend(learner.id)) return stop('limit');

    session.busy = true;
    const timeout = AbortSignal.timeout(this.options.generationTimeoutMs ?? 45_000);
    const before = state.cost;
    try {
      await generator.repair(state, repairReport, {}, timeout);
      generator.settle(state);
    } finally {
      session.busy = false;
      this.limits.spend(learner.id, state.cost - before);
    }
    if (state.status === 'validated' && state.scene) {
      session.expiresAt = this.now() + (this.options.sessionMinutes ?? 15) * 60_000;
      this.json(res, 200, { status: 'scene', ...this.sceneMessage(state) });
      return;
    }
    return stop(timeout.aborted ? 'timeout' : (state.failure?.stage ?? 'scene'));
  }

  /** Records and forgets generations whose device never reported. */
  private async sweep(at: number = this.now()): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt > at || session.busy) continue;
      this.sessions.delete(id);
      await this.record(session.state);
    }
  }
}

export function createService(options: ServiceOptions): GenerationService {
  return new GenerationService(options);
}
