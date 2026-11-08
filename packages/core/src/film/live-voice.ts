/**
 * The live voice contract: one real-time voice model that reads a film's
 * beats aloud, listens to the learner, and calls the film's tools. Core
 * stays provider-agnostic; a provider client (Gemini Live today) implements
 * LiveVoice outside core. See docs/product/live-voice-films.md.
 */

/** A tool the voice may call, declared to the provider as JSON Schema. */
export interface LiveToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /** False lets the voice keep talking while the call runs (a slow tool such as make_example). */
  readonly blocking: boolean;
}

/** What a session starts with: the teacher's instructions, its tools, and an optional voice name. */
export interface LiveSetup {
  readonly instruction: string;
  readonly tools: readonly LiveToolDeclaration[];
  readonly voice?: string;
}

export type LiveEvent =
  /** The voice started speaking; turnId names the beat it was asked to say, or null for its own reply. */
  | { readonly type: 'speaking'; readonly turnId: string | null }
  /** What the voice actually said so far in this turn, from output transcription. */
  | { readonly type: 'transcript'; readonly text: string; readonly turnId: string | null }
  | { readonly type: 'turn-complete'; readonly turnId: string | null }
  /** The learner spoke over the voice and it stopped. */
  | { readonly type: 'interrupted' }
  | { readonly type: 'learner-transcript'; readonly text: string }
  | { readonly type: 'tool-call'; readonly callId: string; readonly name: string; readonly args: unknown }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'closed' };

export interface LiveVoice {
  connect(setup: LiveSetup): Promise<void>;
  /** Speak this line, verbatim where the provider allows; turnId comes back on its events. */
  say(text: string, turnId: string): void;
  /** A silent context update: no reply expected. */
  sendContext(text: string): void;
  respondTool(callId: string, result: unknown): void;
  close(): void;
  on(listener: (event: LiveEvent) => void): () => void;
}
