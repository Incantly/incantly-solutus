import type { ProbeReport, ProbeSpec } from '../probe/probe';
import type { ErrorView } from './ui';

/**
 * The host-to-frame bridge (HO-3, EN-8). Messages travel over a MessagePort
 * the host transfers to the frame, and every message carries the bridge
 * version and the figure's unguessable channel id; anything else is dropped.
 * Nothing here carries prompts, plans, model names or check reports: the
 * probe spec is names and numbers the scene already contains.
 */

export const BRIDGE_VERSION = 1;

/** Sent once with window.postMessage, transferring the port. */
export interface ConnectMessage {
  readonly incantly: 'connect';
  readonly v: typeof BRIDGE_VERSION;
  readonly channel: string;
}

export interface LiveOptions {
  readonly values?: Readonly<Record<string, number>>;
  readonly step?: number | null;
  readonly autoplay?: boolean;
  readonly reducedMotion?: boolean;
  readonly seed?: number;
  readonly theme?: 'light' | 'dark' | 'auto';
}

export interface ProbeRequest {
  readonly spec?: ProbeSpec;
  readonly seed?: number;
  readonly frameBudgetMs?: number;
  readonly elementBudget?: number;
}

export interface InitMessage {
  readonly type: 'init';
  readonly mode: 'live' | 'probe';
  /** The bundled Worker runtime. */
  readonly worker: string;
  /** Validated, instrumented scene code (not yet wrapped). */
  readonly scene: string;
  /** Inserted text per line, to map columns back to the agent's source. */
  readonly shifts: Readonly<Record<number, ReadonlyArray<{ readonly column: number; readonly length: number }>>>;
  readonly live?: LiveOptions;
  readonly probe?: ProbeRequest;
}

export type HostMessageBody =
  | InitMessage
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'setValues'; readonly values: Readonly<Record<string, number>> }
  | { readonly type: 'step'; readonly step: number | null }
  | { readonly type: 'reducedMotion'; readonly value: boolean }
  | { readonly type: 'snapshot'; readonly id: number }
  | { readonly type: 'ping'; readonly id: number }
  /** Moves keyboard focus into the figure, to its first or last control. */
  | { readonly type: 'focus'; readonly edge: 'first' | 'last' }
  | { readonly type: 'destroy' };

export type FrameMessageBody =
  | { readonly type: 'ready' }
  | { readonly type: 'mounted' }
  | { readonly type: 'error'; readonly error: ErrorView }
  | { readonly type: 'values'; readonly values: Readonly<Record<string, number>> }
  /** The teaching position, and how many steps there are. */
  | { readonly type: 'step'; readonly step: number | null; readonly count?: number }
  /** The text alternative changed, so the host can keep it for placeholders and print. */
  | { readonly type: 'description'; readonly text: string }
  /** Keyboard focus is leaving the figure: Escape, or Tab past either end. */
  | { readonly type: 'escape'; readonly direction: 'out' | 'forward' | 'backward' }
  | { readonly type: 'snapshot'; readonly id: number; readonly png: string | null }
  | { readonly type: 'pong'; readonly id: number }
  | { readonly type: 'resize'; readonly height: number }
  | { readonly type: 'probe'; readonly report: ProbeReport };

export type Envelope<T> = T & { readonly v: typeof BRIDGE_VERSION; readonly channel: string };
export type HostMessage = Envelope<HostMessageBody>;
export type FrameMessage = Envelope<FrameMessageBody>;

export const HOST_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'init',
  'pause',
  'resume',
  'setValues',
  'step',
  'reducedMotion',
  'snapshot',
  'ping',
  'focus',
  'destroy',
]);

export const FRAME_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'ready',
  'mounted',
  'error',
  'values',
  'step',
  'description',
  'escape',
  'snapshot',
  'pong',
  'resize',
  'probe',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValues = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.keys(value).length <= 16 && Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v));

const isStep = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);

function envelope(data: unknown, channel: string, types: ReadonlySet<string>): Record<string, unknown> | null {
  if (!isRecord(data) || data.v !== BRIDGE_VERSION || data.channel !== channel) return null;
  return typeof data.type === 'string' && types.has(data.type) ? data : null;
}

/** The connect message, or null if it is not one for this channel. */
export function parseConnect(data: unknown, channel: string): ConnectMessage | null {
  return isRecord(data) && data.incantly === 'connect' && data.v === BRIDGE_VERSION && data.channel === channel
    ? (data as unknown as ConnectMessage)
    : null;
}

/** A host message for this channel with a valid shape, or null. Used by the frame. */
export function parseHostMessage(data: unknown, channel: string): HostMessage | null {
  const m = envelope(data, channel, HOST_MESSAGE_TYPES);
  if (!m) return null;
  switch (m.type) {
    case 'init':
      return (m.mode === 'live' || m.mode === 'probe') &&
        typeof m.worker === 'string' &&
        typeof m.scene === 'string' &&
        isRecord(m.shifts) &&
        (m.live === undefined || isRecord(m.live)) &&
        (m.probe === undefined || isRecord(m.probe))
        ? (m as unknown as HostMessage)
        : null;
    case 'setValues':
      return isValues(m.values) ? (m as unknown as HostMessage) : null;
    case 'step':
      return isStep(m.step) ? (m as unknown as HostMessage) : null;
    case 'reducedMotion':
      return typeof m.value === 'boolean' ? (m as unknown as HostMessage) : null;
    case 'snapshot':
    case 'ping':
      return typeof m.id === 'number' ? (m as unknown as HostMessage) : null;
    case 'focus':
      return m.edge === 'first' || m.edge === 'last' ? (m as unknown as HostMessage) : null;
    default:
      return m as unknown as HostMessage;
  }
}

/** A frame message for this channel with a valid shape, or null. Used by the host. */
export function parseFrameMessage(data: unknown, channel: string): FrameMessage | null {
  const m = envelope(data, channel, FRAME_MESSAGE_TYPES);
  if (!m) return null;
  switch (m.type) {
    case 'error':
      return isRecord(m.error) && typeof m.error.phase === 'string' && typeof m.error.message === 'string'
        ? (m as unknown as FrameMessage)
        : null;
    case 'values':
      return isValues(m.values) ? (m as unknown as FrameMessage) : null;
    case 'step':
      return isStep(m.step) && (m.count === undefined || (isStep(m.count) && m.count !== null && m.count <= 100)) ? (m as unknown as FrameMessage) : null;
    case 'description':
      return typeof m.text === 'string' && m.text.length <= 2000 ? (m as unknown as FrameMessage) : null;
    case 'escape':
      return m.direction === 'out' || m.direction === 'forward' || m.direction === 'backward' ? (m as unknown as FrameMessage) : null;
    case 'snapshot':
      return typeof m.id === 'number' && (m.png === null || (typeof m.png === 'string' && m.png.startsWith('data:image/png;base64,')))
        ? (m as unknown as FrameMessage)
        : null;
    case 'pong':
      return typeof m.id === 'number' ? (m as unknown as FrameMessage) : null;
    case 'resize':
      return typeof m.height === 'number' && Number.isFinite(m.height) && m.height >= 0 ? (m as unknown as FrameMessage) : null;
    case 'probe':
      return isRecord(m.report) && typeof m.report.ok === 'boolean' && Array.isArray(m.report.failures)
        ? (m as unknown as FrameMessage)
        : null;
    default:
      return m as unknown as FrameMessage;
  }
}
