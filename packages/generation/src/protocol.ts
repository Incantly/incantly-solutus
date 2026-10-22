import type { KitName, ProbeReport, ProbeSpec, SceneKind } from '@incantly/core';

/**
 * The messages between the generation service and the learner's device.
 * Browser-safe: the client imports this module, the service implements it.
 */

/** What the skeleton needs from the plan: names and numbers only (PRD 18.6). */
export interface Skeleton {
  readonly concept: string;
  readonly kind: SceneKind;
  readonly parameters: ReadonlyArray<{ readonly name: string; readonly unit?: string; readonly min: number; readonly max: number; readonly default: number }>;
  readonly parts: number;
  readonly steps: number;
  /** The drawing kits the scene will load, so the device can fetch them while the scene is written. */
  readonly kits: readonly KitName[];
}

export interface SceneFragmentsMessage {
  readonly html: string;
  readonly css: string;
  readonly js: string;
}

/** A validated scene for the device to probe. */
export interface SceneMessage {
  readonly generationId: string;
  readonly fragments: SceneFragmentsMessage;
  readonly spec: ProbeSpec;
  readonly sdkVersion: string;
  readonly concept: string;
  /** The idea sentence, the figure's text alternative until it reports its own. */
  readonly description: string;
  /**
   * The service's signature on this scene's plan and fragments, when it can
   * repair figures in the background (RP-7). The device keeps it with the
   * figure and sends it back with a repair request.
   */
  readonly ticket?: string;
}

/** Why no scene came: the plan, the scene or the model failed, time ran out, generation is off, a limit was reached, or a change changed nothing. */
export type FallbackReason = 'plan' | 'scene' | 'model' | 'timeout' | 'off' | 'limit' | 'unchanged';

export interface FallbackMessage {
  readonly generationId: string | null;
  readonly reason: FallbackReason;
  /** The reviewed figure for the same concept, when there is one. */
  readonly standard: (Omit<SceneMessage, 'generationId'> & { readonly id: string }) | null;
}

/** Events of POST /generations, in order: accepted, plan, fragment..., then scene or fallback. */
export type ServiceEvent =
  | { readonly type: 'accepted'; readonly generationId: string }
  | { readonly type: 'plan'; readonly generationId: string; readonly skeleton: Skeleton }
  | { readonly type: 'fragment'; readonly name: 'html' | 'css' | 'js'; readonly ok: boolean }
  | ({ readonly type: 'scene' } & SceneMessage)
  | ({ readonly type: 'fallback' } & FallbackMessage);

/** What the device sends after probing a scene. */
export type ProbeResult = { readonly ok: true } | { readonly ok: false; readonly report: ProbeReport };

/** The answer to a probe result: done, a repaired scene to probe, or a fallback. */
export type ProbeResponse =
  | { readonly status: 'approved'; readonly generationId: string }
  | ({ readonly status: 'scene' } & SceneMessage)
  | ({ readonly status: 'fallback' } & FallbackMessage);

/**
 * A figure in a note hit a problem after it was live (RP-7): its fragments as
 * stored, the ticket that came with them, and what went wrong, as a probe
 * report of the learner's state.
 */
export interface RepairRequest {
  readonly ticket: string;
  readonly fragments: SceneFragmentsMessage;
  readonly report: ProbeReport;
}

/** The answer to a repair request: a repaired scene to probe, then report like any other, or nothing that works. */
export type RepairResponse = ({ readonly status: 'scene' } & SceneMessage) | { readonly status: 'failed'; readonly reason: FallbackReason };

/** A change to a figure the learner has, in their words (HO-8): its fragments, its ticket, and what to change. */
export interface ChangeRequest {
  readonly ticket: string;
  readonly fragments: SceneFragmentsMessage;
  readonly prompt: string;
  readonly noteContext?: string;
}

/** The answer to a change: the changed scene to probe, then report like any other, or why there is none. */
export type ChangeResponse = ({ readonly status: 'scene' } & SceneMessage) | { readonly status: 'failed'; readonly reason: FallbackReason };

