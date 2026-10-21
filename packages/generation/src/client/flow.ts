import type { ProbeReport, ProbeSpec } from '@incantly/core';
import type { LearnerRequest } from '../context';
import type { FallbackMessage, SceneFragmentsMessage, SceneMessage, Skeleton } from '../protocol';
import { ServiceError, type GenerationClient } from './service-client';
import type { FallbackLevel, ProductSignal } from './telemetry';

/**
 * A generation from the learner's side (PRD 27.1, RP-1, RP-9): show the
 * skeleton as soon as the plan arrives, probe every scene in a fresh hidden
 * sandbox on this device, send a failed probe back for its one repair, and
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
}

export type GenerationOutcome =
  | { readonly kind: 'approved'; readonly figure: ApprovedFigure; readonly repaired: boolean }
  | {
      readonly kind: 'fallback';
      readonly level: FallbackLevel;
      readonly reason: string;
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

function approved(scene: Omit<SceneMessage, 'generationId'> & { readonly generationId?: string }, standard: boolean): ApprovedFigure {
  return {
    fragments: scene.fragments,
    concept: scene.concept,
    description: scene.description,
    generationId: standard ? null : (scene.generationId ?? null),
    standard,
    approvedAt: new Date().toISOString(),
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

  while (candidate) {
    run.onStage?.('checking');
    const result = await run.probe(candidate.fragments, candidate.spec);
    if (run.signal?.aborted) throw new DOMException('The generation was cancelled', 'AbortError');
    if (result.ok) {
      // The service records the outcome; the learner does not wait for it.
      void run.client.reportProbe(candidate.generationId, { ok: true }).catch(() => undefined);
      run.signals?.({ type: 'generation', ms: now() - started, outcome: 'approved', repaired });
      return { kind: 'approved', figure: approved(candidate, false), repaired };
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

  const outcome = await ladder(run, fallback, reason);
  run.signals?.({ type: 'generation', ms: now() - started, outcome: 'fallback', repaired, fallback: outcome.level, reason });
  return outcome;
}

/** The fallback ladder (RP-9): the first rung that is available. */
async function ladder(run: GenerationRun, message: FallbackMessage | null, reason: string): Promise<Extract<GenerationOutcome, { kind: 'fallback' }>> {
  if (run.existing?.hasFragments) {
    return { kind: 'fallback', level: 'last-approved', reason, figure: null, message: 'The figure could not be remade, so the working version is kept.' };
  }
  const standard = message?.standard;
  if (standard) {
    // Reviewed, and still checked on this device like any other scene.
    const checked = await run.probe(standard.fragments, standard.spec);
    if (checked.ok) {
      return { kind: 'fallback', level: 'standard', reason, figure: approved(standard, true), message: 'This is a standard version of this figure.' };
    }
  }
  if (run.existing?.hasSnapshot) {
    return { kind: 'fallback', level: 'snapshot', reason, figure: null, message: 'The figure could not be remade. Its picture and description are kept.' };
  }
  const why = reason === 'off' ? 'Making new figures is switched off for now.' : reason === 'limit' ? 'You have reached the limit for new figures for now.' : '';
  return { kind: 'fallback', level: 'text', reason, figure: null, message: `This figure could not be built.${why ? ` ${why}` : ''}` };
}
