/** Shapes shared by the extension's files: its options and the AI protocol (design 6; the "AI request" section). */
import type { AppModeId, FigureSummary } from '@incantly/sdk';
import type { TiptapError } from './errors';

export interface IncantlyTiptapOptions {
  /** URL of `@incantly/server`, for the AI; no AI without it (or an `aiTransport`). */
  readonly server?: string;
  readonly readOnly?: boolean;
  /** The most figures live at once; default 3. */
  readonly liveLimit?: number;
  /** Mode of a new figure; default `figure`. */
  readonly defaultMode?: AppModeId;
  /** Default false: figures stay silent until a reader turns sound on. */
  readonly sound?: boolean;
  /** Called with every error the extension reports (it is also kept in `editor.storage.incantly.lastError`). */
  readonly onError?: (error: TiptapError) => void;
  /** Replaces the HTTP client for the AI (tests, other hosts). */
  readonly aiTransport?: AiTransport;
}

/** What the extension sends to the server (`POST {server}/v1/figure/draw`). */
export interface AiRequest {
  readonly request: string;
  readonly mode: AppModeId;
  readonly script: string;
  /** Only for an edit, that is a non-empty script. */
  readonly figure: FigureSummary | null;
  /** Up to 500 characters of document text before the figure. */
  readonly before: string;
  /** Up to 500 characters of document text after the figure. */
  readonly after: string;
}

/** One line of the NDJSON answer. */
export type AiEvent =
  | { readonly lines: readonly string[] }
  | { readonly done: true }
  | { readonly error: { readonly kind: string; readonly message: string } };

export type AiTransport = (request: AiRequest, signal: AbortSignal) => AsyncIterable<AiEvent>;

/** The fields of `insertIncantlyFigure` (`id` and `caption` are for hosts that make ids or captions themselves). */
export interface InsertFigureOptions {
  readonly script?: string;
  readonly mode?: AppModeId;
  readonly height?: number;
  readonly id?: string;
  readonly caption?: string;
}

export const DEFAULT_OPTIONS = {
  readOnly: false,
  liveLimit: 3,
  defaultMode: 'figure' as AppModeId,
  sound: false,
};
