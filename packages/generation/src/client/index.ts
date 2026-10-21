/**
 * The learner device's side of generation. Browser-safe: nothing here
 * imports Node modules or the server pipeline.
 */
import { probeSandboxed } from '@incantly/core';
import type { DeviceProbe } from './flow';

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
