import type { IncomingMessage, ServerResponse } from 'node:http';
import { SDK_VERSION, kitsFor, validateScene, type ProbeCheck, type ProbeFailure, type ProbeReport, type ScenePlan } from '@incantly/core';
import type { Authenticator, Learner } from './auth';
import { ConceptCache, planKey, requestKey } from './cache';
import { REQUEST_LIMITS, type LearnerRequest } from './context';
import { DEFAULT_LIMITS, LimitKeeper, type Limits, type Refusal } from './limits';
import type { ModelClient } from './models';
import { Generator, standardFigure, type GenerationState } from './pipeline';
import { probeSpecFor } from './probe';
import type { ChangeResponse, FallbackMessage, GalleryReceipt, RepairResponse, SceneMessage, Skeleton } from './protocol';
import { galleryCard, galleryFigure, galleryId, isListed, submitterOf, type GalleryStore } from './gallery';
import { failureRecord, type RecordSink } from './records';
import { issueTicket, readTicket } from './ticket';

/**
 * The generation service: an authenticated HTTP endpoint for the plan, scene
 * and repair calls. The plan and static validation run here; the learner's
 * device probes the scene in its sandbox and reports back, and a failed probe
 * is repaired, up to three times while each repair makes progress. Limits are per learner, every model call has a deadline,
 * a switch turns generation off without touching stored figures (they never
 * call this service), and nothing the learner wrote is kept.
 *
 *   GET  /v1/status
 *   POST /v1/generations              { prompt, noteContext? }  -> event stream
 *   POST /v1/generations/:id/probe    { ok, report? }           -> approved, a repaired scene, or a fallback
 *   POST /v1/repairs                  { ticket, fragments, report } -> a repaired scene to probe, or failed (RP-7)
 *   POST /v1/changes                  { ticket, fragments, prompt, noteContext? } -> the changed scene to probe, or failed (HO-8)
 *   POST /v1/gallery                  { ticket, fragments, prompt, title? } -> { id, status }: published for review (GL-1)
 *   GET  /v1/gallery                  -> { figures }: the accepted figures, newest first
 *   GET  /v1/gallery/:id              -> one accepted figure with its fragments and a fresh ticket
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
  /** Approved figures reused for the same request or plan (PRD 25.6); null turns the cache off. */
  readonly cache?: ConceptCache | null;
  /**
   * Signs every validated scene so figures can ask for a background repair
   * when they hit a problem while live (RP-7); at least 32 characters. Without
   * it the repairs endpoint is off.
   */
  readonly ticketSecret?: string;
  /**
   * The community gallery (GL-1, BR-13): figures learners publish, kept for
   * review. Needs the ticket secret, which proves a published figure was made
   * here. Without it the gallery endpoints are off.
   */
  readonly gallery?: GalleryStore | null;
  /** Figures one learner may have waiting for review at once. Default 20. */
  readonly galleryPendingLimit?: number;
  readonly now?: () => number;
}

export type { ChangeRequest, ChangeResponse, FallbackMessage, ProbeResponse, RepairRequest, RepairResponse, SceneMessage, Skeleton } from './protocol';

export const RETENTION = {
  noteText: 'The request and any note text are sent to the model provider for the plan call and are not stored by this service or written to logs or records.',
  records: 'Generation records keep the plan, the fragments, the check reports and the outcome, never the request or note text, and are deleted after the stated number of days.',
  sessions: 'A generation waiting for its device probe is kept in memory for the stated number of minutes.',
  gallery: 'A figure a learner publishes to the gallery is kept with the request they publish it with, its title, plan and fragments, and a one-way hash of the learner, until a reviewer removes it; only accepted figures are shown to others, without the hash.',
} as const;

interface Session {
  readonly state: GenerationState;
  readonly generator: Generator;
  readonly learner: Learner;
  expiresAt: number;
  busy: boolean;
  /** The request's cache key, when the figure may be shared: it was asked for without note text. */
  readonly requestKey: string | null;
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

/** Every phase a figure reports a problem in, at the probe or while live (ErrorPhase). */
const PHASES: ReadonlySet<string> = new Set(['mount', 'frame', 'model', 'readout', 'explain', 'describe', 'tween', 'plot', 'drag', 'action', 'hook', 'runaway', 'unresponsive']);

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
    kits: kitsFor(plan.capabilities),
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

/** Fragments from a device: three strings of a size a scene can be. */
function readFragments(value: unknown): { readonly html: string; readonly css: string; readonly js: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { html, css, js } = value as Record<string, unknown>;
  if (typeof html !== 'string' || typeof css !== 'string' || typeof js !== 'string') return null;
  if (html.length > 20_000 || css.length > 20_000 || js.length > 60_000) return null;
  return { html, css, js };
}

export class GenerationService {
  private readonly sessions = new Map<string, Session>();
  private readonly limits: LimitKeeper;
  private readonly now: () => number;
  private readonly prefix: string;
  private readonly sweeper: ReturnType<typeof setInterval>;
  readonly cache: ConceptCache | null;

  constructor(private readonly options: ServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.cache = options.cache === undefined ? new ConceptCache({ now: this.now }) : options.cache;
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
      if (req.method === 'POST' && path === `${this.prefix}/repairs`) return await this.repairStored(req, res);
      if (req.method === 'POST' && path === `${this.prefix}/changes`) return await this.changeStored(req, res);
      if (req.method === 'POST' && path === `${this.prefix}/gallery`) return await this.publish(req, res);
      if (req.method === 'GET' && path === `${this.prefix}/gallery`) return await this.galleryList(req, res);
      const listed = new RegExp(`^${this.prefix}/gallery/([\\w-]{8,40})$`).exec(path);
      if (req.method === 'GET' && listed) return await this.galleryEntry(req, res, listed[1]!);
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

  private async body(req: IncomingMessage, limit = 16_384): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, 'too-large', 'The body is too large');
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
    const fragments = { html: scene.html, css: scene.css, js: scene.js };
    const secret = this.options.ticketSecret;
    return {
      generationId: state.id,
      fragments,
      spec: probeSpecFor(plan),
      sdkVersion: SDK_VERSION,
      concept: plan.concept,
      description: plan.idea,
      ...(secret ? { ticket: issueTicket(secret, plan, fragments) } : {}),
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
    const key = requestKey(request.prompt);
    try {
      // The same request was answered before: no model call at all.
      const known = this.cache?.get(key) ?? null;
      if (known && generator.fromCache(state, known, 'request')) {
        send('plan', { generationId: state.id, skeleton: skeletonOf(state.plan!) });
      } else {
        await generator.run(
          state,
          request,
          {
            onPlan: (plan) => send('plan', { generationId: state.id, skeleton: skeletonOf(plan) }),
            // The model's text as it streams, for progress views and developer tools.
            onText: (purpose, text) => send('delta', { purpose, text }),
            onFragment: (name, ok) => send('fragment', { name, ok }),
            // A different request that plans the same figure: no scene call.
            cached: (plan) => {
              const planned = this.cache?.get(planKey(plan)) ?? null;
              return planned !== null && generator.fromCache(state, { ...planned, plan }, 'plan');
            },
          },
          signal,
        );
      }
      generator.finish(state);
    } finally {
      clearInterval(keepAlive);
      admitted.release();
      this.limits.spend(learner.id, state.cost);
    }

    if (state.status === 'validated' && state.scene) {
      this.sessions.set(state.id, {
        state,
        generator,
        learner,
        expiresAt: this.now() + (this.options.sessionMinutes ?? 15) * 60_000,
        busy: false,
        requestKey: request.noteContext ? null : key,
      });
      send('scene', this.sceneMessage(state));
    } else {
      const reason = timeout.aborted || state.deadlineHit ? 'timeout' : (state.failure?.stage ?? 'scene');
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
      // Approved on a device: the next learner to ask the same can have it at once.
      const scene = state.scene;
      if (this.cache && scene && state.plan) {
        this.cache.put([session.requestKey, planKey(state.plan)], { plan: state.plan, fragments: { html: scene.html, css: scene.css, js: scene.js }, sdkVersion: SDK_VERSION });
      }
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
      await generator.repairReported(state, repairReport, {}, timeout);
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

  /**
   * A figure in a note hit a problem after it was live (RP-7). Its ticket
   * proves the service signed these very fragments and gives back their plan;
   * the device's report says what went wrong, at the learner's values. It is
   * repaired, and the repaired scene goes back to the device to probe, reported
   * through the usual probe endpoint, which approves it with a new ticket.
   */
  private async repairStored(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const learner = this.learner(req);
    const secret = this.options.ticketSecret;
    if (!secret) throw new HttpError(404, 'not-found', 'Figures are not repaired here');
    if (!this.enabled) throw new HttpError(503, 'generation-off', 'Repairing figures is switched off for now');
    const body = (await this.body(req, 160_000)) as { ticket?: unknown; fragments?: unknown; report?: unknown };
    const fragments = readFragments(body.fragments);
    if (!fragments) throw new HttpError(400, 'invalid-request', 'fragments must be { html, css, js }, each a string');
    const plan = readTicket(secret, body.ticket, fragments);
    if (!plan) throw new HttpError(403, 'invalid-ticket', 'That figure cannot be repaired here');
    const report = sanitizeDeviceReport(body.report, plan, fragments.js.split('\n').length);
    if (!report) throw new HttpError(400, 'invalid-request', 'report must be { failures } from the device');
    const admitted = this.limits.admit(learner.id);
    if (!admitted.ok) this.refuse(admitted.refusal);

    const generator = this.generator();
    const state = generator.begin();
    const timeout = AbortSignal.timeout(this.options.generationTimeoutMs ?? 45_000);
    try {
      const adopted = generator.adopt(state, { plan, fragments });
      // A scene the validator now rejects is repaired from that; one it accepts, from what the device saw.
      const repairReport = adopted.passed ? generator.deviceFailed(state, report) : adopted.report!;
      if (generator.canRepair(state)) await generator.repairReported(state, repairReport, {}, timeout);
      generator.finish(state);
    } finally {
      admitted.release();
      this.limits.spend(learner.id, state.cost);
    }
    if (state.status === 'validated' && state.scene) {
      this.sessions.set(state.id, {
        state,
        generator,
        learner,
        expiresAt: this.now() + (this.options.sessionMinutes ?? 15) * 60_000,
        busy: false,
        requestKey: null,
      });
      this.json(res, 200, { status: 'scene', ...this.sceneMessage(state) } satisfies RepairResponse);
      return;
    }
    await this.record(state);
    this.json(res, 200, { status: 'failed', reason: timeout.aborted || state.deadlineHit ? 'timeout' : (state.failure?.stage ?? 'scene') } satisfies RepairResponse);
  }

  /**
   * A learner asks for a change to a figure they have (HO-8). The ticket
   * proves the service signed these fragments and gives back their plan; one
   * call replies with edits, which are checked and repaired like any scene,
   * and the changed scene goes to the device to probe. The request is sent to
   * the model and not stored, as for a new figure.
   */
  private async changeStored(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const learner = this.learner(req);
    const secret = this.options.ticketSecret;
    if (!secret) throw new HttpError(404, 'not-found', 'Figures are not changed here');
    if (!this.enabled) throw new HttpError(503, 'generation-off', 'Making new figures is switched off for now');
    const body = (await this.body(req, 160_000)) as { ticket?: unknown; fragments?: unknown; prompt?: unknown; noteContext?: unknown };
    const fragments = readFragments(body.fragments);
    if (!fragments) throw new HttpError(400, 'invalid-request', 'fragments must be { html, css, js }, each a string');
    const request = readRequest({ prompt: body.prompt, noteContext: body.noteContext });
    const plan = readTicket(secret, body.ticket, fragments);
    if (!plan) throw new HttpError(403, 'invalid-ticket', 'That figure cannot be changed here');
    const admitted = this.limits.admit(learner.id);
    if (!admitted.ok) this.refuse(admitted.refusal);

    const cancel = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) cancel.abort();
    });
    const timeout = AbortSignal.timeout(this.options.generationTimeoutMs ?? 45_000);
    const generator = this.generator();
    const state = generator.begin();
    try {
      await generator.change(state, { plan, fragments }, request, {}, AbortSignal.any([cancel.signal, timeout]));
      generator.settle(state);
      generator.finish(state);
    } finally {
      admitted.release();
      this.limits.spend(learner.id, state.cost);
    }
    if (state.status === 'validated' && state.scene) {
      this.sessions.set(state.id, {
        state,
        generator,
        learner,
        expiresAt: this.now() + (this.options.sessionMinutes ?? 15) * 60_000,
        busy: false,
        requestKey: null,
      });
      this.json(res, 200, { status: 'scene', ...this.sceneMessage(state) } satisfies ChangeResponse);
      return;
    }
    await this.record(state);
    const reason = state.failure?.reason === 'unchanged' ? 'unchanged' : timeout.aborted || state.deadlineHit ? 'timeout' : (state.failure?.stage ?? 'scene');
    this.json(res, 200, { status: 'failed', reason } satisfies ChangeResponse);
  }

  /** The gallery and the secret that proves a figure was made here, or a 404 where the gallery is off. */
  private galleryStore(): { readonly store: GalleryStore; readonly secret: string } {
    const store = this.options.gallery;
    const secret = this.options.ticketSecret;
    if (!store || !secret) throw new HttpError(404, 'not-found', 'There is no gallery here');
    return { store, secret };
  }

  /**
   * A learner publishes a finished figure with the request that made it
   * (GL-1, BR-13). The ticket proves these fragments were made and signed
   * here, and gives back their plan; the scene must still pass today's
   * validator. It waits for a reviewer, and the same figure published again
   * is the same entry.
   */
  private async publish(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const learner = this.learner(req);
    const { store, secret } = this.galleryStore();
    const body = (await this.body(req, 160_000)) as { ticket?: unknown; fragments?: unknown; prompt?: unknown; title?: unknown };
    const fragments = readFragments(body.fragments);
    if (!fragments) throw new HttpError(400, 'invalid-request', 'fragments must be { html, css, js }, each a string');
    const prompt = text(body.prompt, 500)?.trim() ?? '';
    if (prompt.length < 3) throw new HttpError(400, 'invalid-request', 'prompt must be the request the figure was made from, 3 to 500 characters');
    if (body.title !== undefined && typeof body.title !== 'string') throw new HttpError(400, 'invalid-request', 'title must be a string');
    const plan = readTicket(secret, body.ticket, fragments);
    if (!plan) throw new HttpError(403, 'invalid-ticket', 'Only figures made here can be published');
    if (!validateScene(fragments).ok) throw new HttpError(422, 'invalid-scene', 'That figure no longer passes the checks, so it cannot be published');
    const id = galleryId(fragments);
    const known = await store.get(id);
    if (known) {
      this.json(res, 200, { id, status: known.status } satisfies GalleryReceipt);
      return;
    }
    const submitter = submitterOf(learner.id);
    const waiting = (await store.list()).filter((entry) => entry.submitter === submitter && entry.status === 'pending').length;
    if (waiting >= (this.options.galleryPendingLimit ?? 20)) {
      throw new HttpError(429, 'gallery-limit', 'You have many figures waiting for review; publish more once some are reviewed', { 'retry-after': '3600' });
    }
    const title = text(body.title, 80)?.trim() || plan.concept;
    await store.put({
      id,
      status: 'pending',
      prompt,
      title,
      plan,
      fragments,
      sdkVersion: SDK_VERSION,
      submittedAt: new Date(this.now()).toISOString(),
      submitter,
    });
    this.json(res, 201, { id, status: 'pending' } satisfies GalleryReceipt);
  }

  /** The accepted figures, newest first, without who published them. */
  private async galleryList(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.learner(req);
    const { store } = this.galleryStore();
    const listed = (await store.list())
      .filter(isListed)
      .sort((a, b) => (b.reviewedAt ?? b.submittedAt).localeCompare(a.reviewedAt ?? a.submittedAt))
      .slice(0, 200);
    this.json(res, 200, { figures: listed.map(galleryCard) });
  }

  /** One accepted figure, with a fresh ticket so a note that adds it can have it repaired like its own. */
  private async galleryEntry(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    this.learner(req);
    const { store, secret } = this.galleryStore();
    const entry = await store.get(id);
    if (!entry || !isListed(entry)) throw new HttpError(404, 'not-found', 'No such figure in the gallery');
    this.json(res, 200, galleryFigure(entry, issueTicket(secret, entry.plan, entry.fragments)));
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
