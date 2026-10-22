import type { ErrorView, ProbeReport } from '@incantly/core';
import type { SceneFragmentsMessage } from '../protocol';
import { approved, type ApprovedFigure, type DeviceProbe } from './flow';
import type { GenerationClient } from './service-client';
import type { ProductSignal } from './telemetry';

/**
 * A figure that hit a problem after it was live, repaired in the background
 * (PRD 27.5, RP-7). The figure stays frozen at its last good frame while this
 * runs. The service repairs the scene it signed, the device probes the repair
 * like any new scene, and at the learner's state too, and only a repair that
 * passes both is handed back to be swapped in at the learner's values.
 */

export interface StoredFigure {
  readonly fragments: SceneFragmentsMessage;
  /** The ticket that came with the scene. Without one, the figure cannot be repaired here. */
  readonly ticket: string | null;
}

export interface LiveProblem {
  readonly error: ErrorView;
  /** The learner's values when it happened. */
  readonly values: Readonly<Record<string, number>>;
  readonly playing?: boolean;
}

export interface FigureRepairRun {
  readonly client: GenerationClient;
  readonly probe: DeviceProbe;
  readonly figure: StoredFigure;
  readonly problem: LiveProblem;
  readonly signals?: (signal: ProductSignal) => void;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

/** What the device saw, as the report a repair quotes: the check, the learner's state and the real error. */
export function liveProblemReport(problem: LiveProblem): ProbeReport {
  const { error, values } = problem;
  const state = Object.entries(values)
    .map(([name, value]) => `${name} = ${Math.round(value * 1000) / 1000}`)
    .join(', ');
  return {
    ok: false,
    failures: [
      {
        check: 'runs',
        message: `The live figure threw ${state ? `with ${state}` : 'at its defaults'}, ${problem.playing ? 'playing' : 'paused'}`,
        values: { ...values },
        playing: problem.playing ?? false,
        error: {
          phase: error.phase,
          name: 'Error',
          message: error.message,
          ...(error.line !== undefined ? { line: error.line } : {}),
          ...(error.column !== undefined ? { column: error.column } : {}),
        },
      },
    ],
    stats: { configurations: 0, frames: 0, averageFrameMs: 0, elements: 0, durationMs: 0 },
  };
}

/** Repairs a live figure in the background; null when it cannot be repaired, and the figure keeps its working version. */
export async function repairFigure(run: FigureRepairRun): Promise<ApprovedFigure | null> {
  const ticket = run.figure.ticket;
  if (!ticket) return null;
  const now = run.now ?? (() => performance.now());
  const started = now();
  const done = (outcome: 'scene' | 'fallback' | 'error', figure: ApprovedFigure | null) => {
    run.signals?.({ type: 'repair', ms: now() - started, outcome });
    return figure;
  };
  try {
    const response = await run.client.repair({ ticket, fragments: run.figure.fragments, report: liveProblemReport(run.problem) }, run.signal);
    if (response.status !== 'scene') return done('fallback', null);
    // Probed like any new scene, and also where the old one broke.
    const spec = { ...response.spec, states: [run.problem.values] };
    const result = await run.probe(response.fragments, spec);
    if (run.signal?.aborted) return null;
    if (!result.ok) {
      // The service records the outcome; nothing more is tried in the background.
      if (result.report) void run.client.reportProbe(response.generationId, { ok: false, report: result.report }).catch(() => undefined);
      return done('fallback', null);
    }
    void run.client.reportProbe(response.generationId, { ok: true }).catch(() => undefined);
    return done('scene', approved(response, false));
  } catch {
    if (run.signal?.aborted) return null;
    return done('error', null);
  }
}
