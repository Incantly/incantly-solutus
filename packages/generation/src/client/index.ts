/**
 * The learner device's side of generation. Browser-safe: nothing here
 * imports Node modules or the server pipeline.
 */
import { preloadKits, warmProbe, type ErrorView, type WarmProbe } from '@incantly/core';
import type { Skeleton } from '../protocol';
import { runChange, runGeneration, type ApprovedFigure, type DeviceProbe, type GenerationStage } from './flow';
import { repairFigure } from './repair';
import type { GenerationClient } from './service-client';
import type { ProductSignal } from './telemetry';

export { GeminiLiveVoice, LIVE_ENDPOINT } from './live-gemini';
export type { GeminiLiveVoiceOptions, LiveAudioListener, LiveSocket, LiveSocketFactory } from './live-gemini';
export {
  createPcmPlayer,
  downsampleTo16kMono,
  floatToPcm16,
  LIVE_INPUT_CHUNK_SAMPLES,
  LIVE_INPUT_SAMPLE_RATE,
  LIVE_OUTPUT_SAMPLE_RATE,
  LiveCaptureResampler,
  pcm16ToFloat32,
  pipeVoiceAudio,
  startMicrophone,
} from './live-audio';
export type { MicrophoneHandle, PcmPlayer } from './live-audio';
export { GenerationClient, ServiceError } from './service-client';
export type { GenerationClientOptions } from './service-client';
export { formatFilmTimings, generateFilmStream, resolveFilmSource, storedAsFixture } from './film-client';
export type { FilmGenerateEvent, FilmGenerateRequest, StoredFilm } from './film-client';
export { runChange, runGeneration } from './flow';
export { liveProblemReport, repairFigure } from './repair';
export type { FigureRepairRun, LiveProblem, StoredFigure } from './repair';
export type { ApprovedFigure, ChangeOutcome, ChangeRun, DeviceProbe, DeviceProbeResult, GenerationOutcome, GenerationRun, GenerationStage } from './flow';
export { Telemetry, cleanSignal } from './telemetry';
export type { FallbackLevel, ProductSignal, TelemetryEvent, TelemetryOptions } from './telemetry';
export type {
  ChangeRequest,
  ChangeResponse,
  FallbackMessage,
  GalleryCard,
  GalleryFigure,
  GalleryReceipt,
  GalleryStatus,
  GallerySubmission,
  ProbeResponse,
  ProbeResult,
  RepairRequest,
  RepairResponse,
  SceneMessage,
  ServiceEvent,
  Skeleton,
} from '../protocol';

/**
 * Probes scenes in a fresh hidden sandbox on this device, through the same
 * adapter learners' figures use. A frame boots as soon as this is made, while
 * the plan and scene are still being written, and another as each is used,
 * for a repair (PRD 25.4). `dispose` closes the one left over.
 */
export function sandboxProbe(container?: HTMLElement): DeviceProbe & { dispose(): void } {
  const warm = () => warmProbe(container ? { container } : {});
  let next: WarmProbe | null = null;
  const probe = async (fragments: Parameters<DeviceProbe>[0], spec: Parameters<DeviceProbe>[1]) => {
    const current = next ?? warm();
    next = warm();
    const outcome = await current.probe(fragments, { spec });
    return { ok: outcome.ok, report: outcome.report };
  };
  next = warm();
  return Object.assign(probe, {
    dispose() {
      next?.dispose();
      next = null;
    },
  });
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
  ): Promise<{ readonly kind: 'figure'; readonly figure: ApprovedFigure; readonly notice?: string } | { readonly kind: 'failed'; readonly message: string; readonly reason: string; readonly level: string; readonly generationId: string | null }> => {
    const own = options.probe ? null : sandboxProbe();
    const outcome = await runGeneration({
      client: options.client,
      request,
      probe: options.probe ?? own!,
      onSkeleton: (skeleton) => {
        // The plan names its drawing kits: fetch them while the scene is written.
        preloadKits(skeleton.kits ?? []);
        hooks.onSkeleton(skeleton);
      },
      onStage: hooks.onStage,
      ...(hooks.onText ? { onText: hooks.onText } : {}),
      ...(options.signals ? { signals: options.signals } : {}),
      signal: hooks.signal,
    }).finally(() => own?.dispose());
    if (outcome.kind === 'approved') return { kind: 'figure', figure: outcome.figure };
    if (outcome.level === 'standard' && outcome.figure) return { kind: 'figure', figure: outcome.figure, notice: outcome.message };
    return { kind: 'failed', message: outcome.message, reason: outcome.reason, level: outcome.level, generationId: outcome.generationId };
  };
}

/**
 * The function @incantly/tiptap's FigureNode calls to repair a figure that hit
 * a problem while live (RP-7): the service repairs the scene it signed, and
 * this device probes the repair, at the learner's values too, before it is
 * swapped in.
 */
export function figureRepairer(options: {
  readonly client: GenerationClient;
  readonly probe?: DeviceProbe;
  readonly signals?: (signal: ProductSignal) => void;
}) {
  return async (
    request: {
      readonly fragments: { readonly html: string; readonly css: string; readonly js: string };
      readonly ticket: string;
      readonly error: ErrorView;
      readonly values: Readonly<Record<string, number>>;
    },
    signal: AbortSignal,
  ): Promise<{ readonly fragments: ApprovedFigure['fragments']; readonly generationId: string | null; readonly approvedAt: string; readonly ticket: string | null } | null> => {
    const own = options.probe ? null : sandboxProbe();
    try {
      const figure = await repairFigure({
        client: options.client,
        probe: options.probe ?? own!,
        figure: { fragments: request.fragments, ticket: request.ticket },
        problem: { error: request.error, values: request.values },
        ...(options.signals ? { signals: options.signals } : {}),
        signal,
      });
      return figure ? { fragments: figure.fragments, generationId: figure.generationId, approvedAt: figure.approvedAt, ticket: figure.ticket } : null;
    } finally {
      own?.dispose();
    }
  };
}

/**
 * The function @incantly/tiptap's FigureGeneration extension calls to change
 * a figure the learner has, in their words (HO-8): the service edits the
 * scene it signed, and this device probes the change before it replaces the
 * figure. When the change cannot be made, the figure keeps its working
 * version and one quiet line says why.
 */
export function figureChanger(options: {
  readonly client: GenerationClient;
  readonly probe?: DeviceProbe;
  readonly signals?: (signal: ProductSignal) => void;
}) {
  return async (
    request: {
      readonly fragments: { readonly html: string; readonly css: string; readonly js: string };
      readonly ticket: string | null;
      readonly prompt: string;
      readonly noteContext?: string;
    },
    hooks: { readonly onStage: (stage: GenerationStage) => void; readonly signal: AbortSignal },
  ): Promise<{ readonly kind: 'figure'; readonly figure: ApprovedFigure } | { readonly kind: 'failed'; readonly message: string }> => {
    const own = options.probe ? null : sandboxProbe();
    try {
      const outcome = await runChange({
        client: options.client,
        probe: options.probe ?? own!,
        figure: { fragments: request.fragments, ticket: request.ticket },
        request: { prompt: request.prompt, ...(request.noteContext ? { noteContext: request.noteContext } : {}) },
        onStage: hooks.onStage,
        ...(options.signals ? { signals: options.signals } : {}),
        signal: hooks.signal,
      });
      return outcome.kind === 'changed' ? { kind: 'figure', figure: outcome.figure } : { kind: 'failed', message: outcome.message };
    } finally {
      own?.dispose();
    }
  };
}

