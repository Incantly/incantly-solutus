/**
 * The model client the loop talks to (teacher design 2, server design 4): one streamed chat call with tools. The
 * teacher never opens a socket; the server gives it a client, and tests give it `fakeModel`.
 */
import type { StreamError } from '../errors';
import type { ToolSpec } from '../tools/types';

/** A tool call the model made, with its arguments as JSON text. */
export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: string;
}

/** A picture the person sent (circle to ask, a photo of a page): PNG or JPEG bytes as base64. */
export interface ChatImage {
  readonly mime: 'image/png' | 'image/jpeg';
  readonly data: string;
}

export type ChatMessage =
  | { readonly role: 'user'; readonly content: string; readonly images?: readonly ChatImage[] }
  | { readonly role: 'assistant'; readonly content: string; readonly toolCalls?: readonly ModelToolCall[] }
  | { readonly role: 'tool'; readonly toolCallId: string; readonly name: string; readonly content: string };

export interface ChatRequest {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSpec[];
  /** True when a message holds a picture, so the server uses its vision models (round 3). */
  readonly vision?: boolean;
}

export type ChatEvent =
  /** A piece of the reply's text. */
  | { readonly text: string }
  /** A tool call with complete arguments. */
  | { readonly toolCall: ModelToolCall }
  | { readonly done: { readonly model: string; readonly inputTokens: number; readonly outputTokens: number } }
  /**
   * The call failed. Kind `stream_cut` means the reply stopped partway: the turn keeps what ran and ends with a
   * `stream_cut` notice. Any other kind ends the turn with this error.
   */
  | { readonly error: StreamError };

export interface ModelClient {
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
