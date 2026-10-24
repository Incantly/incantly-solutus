import type { ProbeReport, ProbeSpec } from '@incantly/core';
import type { LearnerRequest } from '../context';
import type { ChangeResponse, FallbackMessage, SceneFragmentsMessage, SceneMessage, Skeleton } from '../protocol';
import { ServiceError, type GenerationClient } from './service-client';
import type { FallbackLevel, ProductSignal } from './telemetry';

/**
 * A generation from the learner's side (PRD 27.1, RP-1, RP-9): show the
 * skeleton as soon as the plan arrives, probe every scene in a fresh hidden
 * sandbox on this device, send a failed probe back for its repair, and
 * reveal only a scene that passed. When nothing passes, take the first rung
 * of the fallback ladder that is available. A learner never sees a broken
 * figure, a raw error or an empty box.
 */

export interface DeviceProbeResult {
  readonly ok: boolean;
  /** Null when the scene did not even pass validation on the device. */
  readonly report: ProbeReport | null;
}

/** Probes a scene in a hidden sandbox on this device: core's probeSandboxed. */
export type DeviceProbe = (fragments: SceneFragmentsMessage, spec: ProbeSpec) => Promise<DeviceProbeResult>;

/** A scene that passed the probe on this device, ready to store in the note. */
export interface ApprovedFigure {
  readonly fragments: SceneFragmentsMessage;
  readonly concept: string;
  readonly description: string;
  /** The service's generation record, or null for the reviewed standard figure. */
  readonly generationId: string | null;
  /** The reviewed standard figure, shown because generation failed. */
  readonly standard: boolean;
  readonly approvedAt: string;
  /** The service's signature on the scene, kept with the figure for a background repair (RP-7); null when there is none. */
  readonly ticket: string | null;
}

export type GenerationOutcome =
  | { readonly kind: 'approved'; readonly figure: ApprovedFigure; readonly repaired: boolean }
  | {
      readonly kind: 'fallback';
      readonly level: FallbackLevel;
      readonly reason: string;
      /** The service record to inspect in developer tooling, when a run began. */
      readonly generationId: string | null;
      /** The standard figure, for that rung. */
      readonly figure: ApprovedFigure | null;
      /** One quiet line for the learner. */
      readonly message: string;
    };

export type GenerationStage = 'planning' | 'building' | 'checking' | 'repairing';

export interface GenerationRun {
  readonly client: GenerationClient;
  readonly request: LearnerRequest;
  readonly probe: DeviceProbe;
  /** When regenerating a figure that exists: its approved version and its snapshot are fallbacks. */
  readonly existing?: { readonly hasFragments: boolean; readonly hasSnapshot: boolean };
  readonly onSkeleton?: (skeleton: Skeleton) => void;
  readonly onStage?: (stage: GenerationStage) => void;
  readonly onText?: (purpose: 'plan' | 'scene' | 'repair', delta: string) => void;
  readonly signals?: (signal: ProductSignal) => void;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

const NOT_VALID: ProbeReport = {
  ok: false,
  failures: [{ check: 'mount', message: 'The scene did not pass validation on the learner’s device' }],
  stats: { configurations: 0, frames: 0, averageFrameMs: 0, elements: 0, durationMs: 0 },
};

export function approved(scene: Omit<SceneMessage, 'generationId'> & { readonly generationId?: string }, standard: boolean): ApprovedFigure {
  return {
    fragments: scene.fragments,
    concept: scene.concept,
    description: scene.description,
    generationId: standard ? null : (scene.generationId ?? null),
    standard,
    approvedAt: new Date().toISOString(),
    ticket: standard ? null : (scene.ticket ?? null),
  };
}

function reasonOf(error: unknown): string {
  if (error instanceof ServiceError) {
    if (error.code === 'generation-off') return 'off';
    if (error.status === 429) return 'limit';
    if (error.status === 401) return 'unauthorized';
  }
  return 'network';
}

export async function runGeneration(run: GenerationRun): Promise<GenerationOutcome> {
  const now = run.now ?? (() => performance.now());
  const started = now();
  let candidate: SceneMessage | null = null;
  let fallback: FallbackMessage | null = null;
  let reason = 'scene';
  let repaired = false;

  run.onStage?.('planning');
  try {
    for await (const event of run.client.generate(run.request, run.signal)) {
      if (event.type === 'delta') {
        run.onText?.(event.purpose, event.text);
      } else if (event.type === 'plan') {
        run.signals?.({ type: 'time-to-skeleton', ms: now() - started });
        run.onSkeleton?.(event.skeleton);
        run.onStage?.('building');
      } else if (event.type === 'scene') {
        candidate = event;
      } else if (event.type === 'fallback') {
        fallback = event;
        reason = event.reason;
      }
    }
  } catch (error) {
    if (run.signal?.aborted) throw error;
    reason = reasonOf(error);
  }

  if (candidate) {
    const checked = await checkOnDevice(run, candidate, now);
    repaired = checked.repaired;
    if (checked.figure) {
      run.signals?.({ type: 'generation', ms: now() - started, outcome: 'approved', repaired });
      return { kind: 'approved', figure: checked.figure, repaired };
    }
    if (checked.fallback) fallback = checked.fallback;
    if (checked.reason) reason = checked.reason;
  }

  const outcome = await ladder(run, fallback, reason);
  run.signals?.({ type: 'generation', ms: now() - started, outcome: 'fallback', repaired, fallback: outcome.level, reason });
  return outcome;
}

/**
 * Probes a scene on this device and, when it fails, sends the report back for
 * its repair and probes the repair (RP-1, RP-4): the approved figure, or the
 * fallback the service sent and why.
 */
async function checkOnDevice(
  run: Pick<GenerationRun, 'client' | 'probe' | 'onStage' | 'signals' | 'signal'>,
  first: SceneMessage,
  now: () => number,
): Promise<{ readonly figure: ApprovedFigure | null; readonly repaired: boolean; readonly fallback: FallbackMessage | null; readonly reason: string | null }> {
  let candidate: SceneMessage | null = first;
  let repaired = false;
  let fallback: FallbackMessage | null = null;
  let reason: string | null = null;
  while (candidate) {
    run.onStage?.('checking');
    const result = await run.probe(candidate.fragments, candidate.spec);
    if (run.signal?.aborted) throw new DOMException('The generation was cancelled', 'AbortError');
    if (result.ok) {
      // The service records the outcome; the learner does not wait for it.
      void run.client.reportProbe(candidate.generationId, { ok: true }).catch(() => undefined);
      return { figure: approved(candidate, false), repaired, fallback, reason };
    }
    run.onStage?.('repairing');
    const repairStarted = now();
    try {
      const response = await run.client.reportProbe(candidate.generationId, { ok: false, report: result.report ?? NOT_VALID }, run.signal);
      run.signals?.({ type: 'repair', ms: now() - repairStarted, outcome: response.status === 'scene' ? 'scene' : 'fallback' });
      if (response.status === 'scene') {
        candidate = response;
        repaired = true;
        continue;
      }
      if (response.status === 'fallback') {
        fallback = response;
        reason = response.reason;
      }
    } catch (error) {
      if (run.signal?.aborted) throw error;
      run.signals?.({ type: 'repair', ms: now() - repairStarted, outcome: 'error' });
      reason = reasonOf(error);
    }
    candidate = null;
  }
  return { figure: null, repaired, fallback, reason };
}

/** A change to a figure the learner has (HO-8), from their device: the change, checked here like any new scene. */
export interface ChangeRun {
  readonly client: GenerationClient;
  readonly probe: DeviceProbe;
  readonly figure: { readonly fragments: SceneFragmentsMessage; readonly ticket: string | null };
  readonly request: LearnerRequest;
  readonly onStage?: (stage: GenerationStage) => void;
  readonly signals?: (signal: ProductSignal) => void;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export type ChangeOutcome =
  | { readonly kind: 'changed'; readonly figure: ApprovedFigure; readonly repaired: boolean }
  /** The figure keeps its working version; one quiet line says why. */
  | { readonly kind: 'kept'; readonly reason: string; readonly message: string };

/** Asks for a change to a figure, probes the changed scene on this device, and hands it back only when it passed. */
export async function runChange(run: ChangeRun): Promise<ChangeOutcome> {
  const now = run.now ?? (() => performance.now());
  const started = now();
  const kept = (reason: string): ChangeOutcome => {
    run.signals?.({ type: 'generation', ms: now() - started, outcome: 'fallback', repaired: false, fallback: 'last-approved', reason });
    const message =
      reason === 'unchanged'
        ? 'That change is not one this figure can make, so it is unchanged.'
        : reason === 'off'
          ? 'Changing figures is switched off for now, so this one is unchanged.'
          : reason === 'limit'
            ? 'You have reached the limit for figures for now, so this one is unchanged.'
            : 'The figure could not be changed, so the working version is kept.';
    return { kind: 'kept', reason, message };
  };
  if (!run.figure.ticket) return kept('unsigned');
  run.onStage?.('building');
  let response: ChangeResponse;
  try {
    response = await run.client.change({ ticket: run.figure.ticket, fragments: run.figure.fragments, ...run.request }, run.signal);
  } catch (error) {
    if (run.signal?.aborted) throw error;
    return kept(reasonOf(error));
  }
  if (response.status !== 'scene') return kept(response.reason);
  const checked = await checkOnDevice(run, response, now);
  if (!checked.figure) return kept(checked.reason ?? 'scene');
  run.signals?.({ type: 'generation', ms: now() - started, outcome: 'approved', repaired: checked.repaired });
  return { kind: 'changed', figure: checked.figure, repaired: checked.repaired };
}

/** The fallback ladder (RP-9): the first rung that is available. */
async function ladder(run: GenerationRun, message: FallbackMessage | null, reason: string): Promise<Extract<GenerationOutcome, { kind: 'fallback' }>> {
  const generationId = message?.generationId ?? null;
  if (run.existing?.hasFragments) {
    return { kind: 'fallback', level: 'last-approved', reason, generationId, figure: null, message: 'The figure could not be remade, so the working version is kept.' };
  }
  const standard = message?.standard;
  if (standard) {
    // Reviewed, and still checked on this device like any other scene.
    const checked = await run.probe(standard.fragments, standard.spec);
    if (checked.ok) {
      return { kind: 'fallback', level: 'standard', reason, generationId, figure: approved(standard, true), message: 'This is a standard version of this figure.' };
    }
  }
  if (run.existing?.hasSnapshot) {
    return { kind: 'fallback', level: 'snapshot', reason, generationId, figure: null, message: 'The figure could not be remade. Its picture and description are kept.' };
  }
  const why =
    reason === 'off'
      ? 'Making new figures is switched off for now.'
      : reason === 'limit'
        ? 'You have reached the limit for new figures for now.'
        : reason === 'timeout'
          ? 'It ran out of time building the figure. Try asking again.'
          : reason === 'plan'
            ? 'No plan for the figure could be made. Try phrasing the request a little differently.'
            : reason === 'model'
              ? 'The model did not answer as expected. Check the connection, then try again.'
              : reason === 'scene'
                ? 'What the model wrote did not pass the checks. Try again, or ask for it a different way.'
                : '';
  return { kind: 'fallback', level: 'text', reason, generationId, figure: null, message: `This figure could not be built.${why ? ` ${why}` : ''}` };
}
