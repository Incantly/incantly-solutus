import type { ProbeReport, ProbeSpec } from '../probe/probe';
import type { FigureStyle } from '../renderer/style';
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
  /** Formulas the learner edited, by index. */
  readonly formulas?: Readonly<Record<string, string>>;
  readonly step?: number | null;
  readonly autoplay?: boolean;
  readonly reducedMotion?: boolean;
  readonly seed?: number;
  readonly theme?: 'light' | 'dark' | 'auto';
  /** The integrator's style without its CSS, which the frame document carries. Checked again in the frame. */
  readonly style?: FigureStyle;
  /** The figure's number in its document, for the card's title. */
  readonly figureNumber?: number;
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
  /** For a frame booted before its scene (PRD 25.4): the markup and styles it was not made with. */
  readonly fragments?: ArrivingFragments;
}

/**
 * A validated scene's markup and styles, handed to a warm frame: the styles
 * carry the nonce its policy was made with, and `lang` is the document's.
 */
export interface ArrivingFragments {
  readonly html: string;
  readonly css: string;
  /** Trusted CSS from the integrator, already checked. */
  readonly hostCss?: string;
  readonly nonce: string;
  readonly lang?: string;
}

export type HostMessageBody =
  | InitMessage
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'setValues'; readonly values: Readonly<Record<string, number>> }
  | { readonly type: 'step'; readonly step: number | null }
  | { readonly type: 'reducedMotion'; readonly value: boolean }
  /** A picture of the drawing: a PNG (the default), or an SVG with the theme written in (SV-14). */
  | { readonly type: 'snapshot'; readonly id: number; readonly format?: 'png' | 'svg' }
  /** A short video of the drawing as it plays (6.10b). */
  | { readonly type: 'clip'; readonly id: number; readonly seconds?: number; readonly fps?: number }
  | { readonly type: 'ping'; readonly id: number }
  /** Moves keyboard focus into the figure, to its first or last control. */
  | { readonly type: 'focus'; readonly edge: 'first' | 'last' }
  /** Restyles the live figure; its CSS stays what the frame was made with. Checked again in the frame. */
  | { readonly type: 'style'; readonly style: FigureStyle }
  | { readonly type: 'theme'; readonly theme: 'light' | 'dark' | 'auto' }
  /** The figure's number in its document changed. */
  | { readonly type: 'number'; readonly figureNumber: number | null }
  | { readonly type: 'destroy' };

export type FrameMessageBody =
  | { readonly type: 'ready' }
  | { readonly type: 'mounted' }
  | { readonly type: 'error'; readonly error: ErrorView }
  | { readonly type: 'values'; readonly values: Readonly<Record<string, number>> }
  /** Formulas the learner edited, by index, for persistence. */
  | { readonly type: 'formulas'; readonly formulas: Readonly<Record<string, string>> }
  /** The teaching position, and how many steps there are. */
  | { readonly type: 'step'; readonly step: number | null; readonly count?: number }
  /** The text alternative changed, so the host can keep it for placeholders and print. */
  | { readonly type: 'description'; readonly text: string }
  /** Keyboard focus is leaving the figure: Escape, or Tab past either end. */
  | { readonly type: 'escape'; readonly direction: 'out' | 'forward' | 'backward' }
  | { readonly type: 'snapshot'; readonly id: number; readonly png: string | null; readonly svg?: string | null }
  /** The recorded video, or null where the frame could not record one. */
  | { readonly type: 'clip'; readonly id: number; readonly video: Blob | null }
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
  'clip',
  'ping',
  'focus',
  'style',
  'theme',
  'number',
  'destroy',
]);

export const FRAME_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'ready',
  'mounted',
  'error',
  'values',
  'formulas',
  'step',
  'description',
  'escape',
  'snapshot',
  'clip',
  'pong',
  'resize',
  'probe',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A language tag a frame document can carry: letters, then subtags of letters and digits, as in en-GB or ar-u-nu-latn. */
const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/** The language a frame is written in: the host's tag when it is one, or none, so the frame keeps its own. */
export function frameLang(lang: string | undefined): string | undefined {
  return lang !== undefined && lang.length <= 35 && LANG_TAG.test(lang) ? lang : undefined;
}

/** The longest exported picture, as a data URL, that the bridge carries back to the host. */
export const MAX_PICTURE_CHARS = 8_000_000;

/** The most markup or style a scene may hand a warm frame, in characters. */
const MAX_FRAGMENT = 400_000;

const isArriving = (value: unknown): value is ArrivingFragments =>
  isRecord(value) &&
  typeof value.html === 'string' &&
  value.html.length <= MAX_FRAGMENT &&
  typeof value.css === 'string' &&
  value.css.length <= MAX_FRAGMENT &&
  (value.hostCss === undefined || (typeof value.hostCss === 'string' && value.hostCss.length <= MAX_FRAGMENT)) &&
  typeof value.nonce === 'string' &&
  /^[A-Za-z0-9+/]{22}==$/.test(value.nonce) &&
  (value.lang === undefined || (typeof value.lang === 'string' && frameLang(value.lang) === value.lang));

const isValues = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.keys(value).length <= 16 && Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v));

const isStep = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);

/** Learner formulas: at most eight, keyed by index, each short text. */
export const isFormulas = (value: unknown): value is Record<string, string> =>
  isRecord(value) &&
  Object.keys(value).length <= 8 &&
  Object.entries(value).every(([key, text]) => /^[0-7]$/.test(key) && typeof text === 'string' && text.length <= 200);

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
        (m.probe === undefined || isRecord(m.probe)) &&
        (m.fragments === undefined || isArriving(m.fragments))
        ? (m as unknown as HostMessage)
        : null;
    case 'setValues':
      return isValues(m.values) ? (m as unknown as HostMessage) : null;
    case 'step':
      return isStep(m.step) ? (m as unknown as HostMessage) : null;
    case 'reducedMotion':
      return typeof m.value === 'boolean' ? (m as unknown as HostMessage) : null;
    case 'snapshot':
      return typeof m.id === 'number' && (m.format === undefined || m.format === 'png' || m.format === 'svg') ? (m as unknown as HostMessage) : null;
    case 'clip':
      return typeof m.id === 'number' && (m.seconds === undefined || typeof m.seconds === 'number') && (m.fps === undefined || typeof m.fps === 'number')
        ? (m as unknown as HostMessage)
        : null;
    case 'ping':
      return typeof m.id === 'number' ? (m as unknown as HostMessage) : null;
    case 'focus':
      return m.edge === 'first' || m.edge === 'last' ? (m as unknown as HostMessage) : null;
    case 'style':
      return isRecord(m.style) ? (m as unknown as HostMessage) : null;
    case 'theme':
      return m.theme === 'light' || m.theme === 'dark' || m.theme === 'auto' ? (m as unknown as HostMessage) : null;
    case 'number':
      return m.figureNumber === null || (typeof m.figureNumber === 'number' && Number.isInteger(m.figureNumber) && m.figureNumber > 0 && m.figureNumber < 10_000)
        ? (m as unknown as HostMessage)
        : null;
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
    case 'formulas':
      return isFormulas(m.formulas) ? (m as unknown as FrameMessage) : null;
    case 'step':
      return isStep(m.step) && (m.count === undefined || (isStep(m.count) && m.count !== null && m.count <= 100)) ? (m as unknown as FrameMessage) : null;
    case 'description':
      return typeof m.text === 'string' && m.text.length <= 2000 ? (m as unknown as FrameMessage) : null;
    case 'escape':
      return m.direction === 'out' || m.direction === 'forward' || m.direction === 'backward' ? (m as unknown as FrameMessage) : null;
    case 'snapshot':
      return typeof m.id === 'number' &&
        (m.png === null || (typeof m.png === 'string' && m.png.startsWith('data:image/png;base64,'))) &&
        (m.svg === undefined || m.svg === null || (typeof m.svg === 'string' && m.svg.startsWith('data:image/svg+xml;') && m.svg.length < MAX_PICTURE_CHARS))
        ? (m as unknown as FrameMessage)
        : null;
    case 'clip':
      // A video and nothing else, of a size a short clip can have.
      return typeof m.id === 'number' &&
        (m.video === null ||
          (typeof Blob !== 'undefined' && m.video instanceof Blob && /^video\/(webm|mp4)$/.test(m.video.type) && m.video.size > 0 && m.video.size <= 64 * 1024 * 1024))
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
