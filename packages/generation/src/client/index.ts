/**
 * The learner device's side of generation. Browser-safe: nothing here
 * imports Node modules or the server pipeline.
 */
import { probeSandboxed } from '@incantly/core';
import type { Skeleton } from '../protocol';
import { runGeneration, type ApprovedFigure, type DeviceProbe, type GenerationStage } from './flow';
import type { GenerationClient } from './service-client';
import type { ProductSignal } from './telemetry';

export { GenerationClient, ServiceError } from './service-client';
export type { GenerationClientOptions } from './service-client';
export { runGeneration } from './flow';
export type { ApprovedFigure, DeviceProbe, DeviceProbeResult, GenerationOutcome, GenerationRun, GenerationStage } from './flow';
export { Telemetry, cleanSignal } from './telemetry';
export type { FallbackLevel, ProductSignal, TelemetryEvent, TelemetryOptions } from './telemetry';
export type { FallbackMessage, ProbeResponse, ProbeResult, SceneMessage, ServiceEvent, Skeleton } from '../protocol';

/** Probes scenes in a fresh hidden sandbox on this device, through the same adapter learners' figures use. */
export function sandboxProbe(container?: HTMLElement): DeviceProbe {
  return async (fragments, spec) => {
    const outcome = await probeSandboxed(fragments, { spec, ...(container ? { container } : {}) });
    return { ok: outcome.ok, report: outcome.report };
  };
}

/**
 * The function @incantly/tiptap's FigureGeneration extension calls to make a
 * figure: the whole learner-side flow, with the standard figure shown with its
 * notice and every other fallback ending in one quiet line.
 */
export function figureGenerator(options: {
  readonly client: GenerationClient;
  readonly probe?: DeviceProbe;
  readonly signals?: (signal: ProductSignal) => void;
}) {
  return async (
    request: { readonly prompt: string; readonly noteContext?: string },
    hooks: {
      readonly onSkeleton: (skeleton: Pick<Skeleton, 'concept' | 'parameters' | 'steps'>) => void;
      readonly onStage: (stage: GenerationStage) => void;
      readonly onText?: (purpose: 'plan' | 'scene' | 'repair', delta: string) => void;
      readonly signal: AbortSignal;
    },
  ): Promise<{ readonly kind: 'figure'; readonly figure: ApprovedFigure; readonly notice?: string } | { readonly kind: 'failed'; readonly message: string; readonly reason: string; readonly level: string }> => {
    const outcome = await runGeneration({
      client: options.client,
      request,
      probe: options.probe ?? sandboxProbe(),
      onSkeleton: hooks.onSkeleton,
      onStage: hooks.onStage,
      ...(hooks.onText ? { onText: hooks.onText } : {}),
      ...(options.signals ? { signals: options.signals } : {}),
      signal: hooks.signal,
    });
    if (outcome.kind === 'approved') return { kind: 'figure', figure: outcome.figure };
    if (outcome.level === 'standard' && outcome.figure) return { kind: 'figure', figure: outcome.figure, notice: outcome.message };
    return { kind: 'failed', message: outcome.message, reason: outcome.reason, level: outcome.level };
  };
}
