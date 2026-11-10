import type { LiveEvent, LiveSetup, LiveVoice } from './live-voice';

/**
 * A scripted LiveVoice for tests and hosts: it records what it was asked to
 * say, the silent context it was sent, the typed questions it was asked and
 * the tool answers it gave back, and a test drives it by emitting any
 * LiveEvent a provider could send.
 */
export class FakeLiveVoice implements LiveVoice {
  private readonly listeners = new Set<(event: LiveEvent) => void>();

  /** Every setup the voice connected with, in order. */
  readonly setups: LiveSetup[] = [];
  /** Every line it was asked to say, in order. */
  readonly said: Array<{ readonly text: string; readonly turnId: string }> = [];
  /** Every silent context update, in order. */
  readonly contexts: string[] = [];
  /** Every typed learner question, in order. */
  readonly questions: string[] = [];
  /** Every tool answer it gave back, in order. */
  readonly answers: Array<{ readonly callId: string; readonly result: unknown }> = [];
  /** True once close ran. */
  closed = false;

  get connected(): boolean {
    return this.setups.length > 0;
  }

  connect(setup: LiveSetup): Promise<void> {
    this.setups.push(setup);
    return Promise.resolve();
  }

  say(text: string, turnId: string): void {
    this.said.push({ text, turnId });
  }

  sendContext(text: string): void {
    this.contexts.push(text);
  }

  ask(text: string): void {
    this.questions.push(text);
  }

  respondTool(callId: string, result: unknown): void {
    this.answers.push({ callId, result });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit({ type: 'closed' });
  }

  on(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drives the voice as a provider would: any event lands on every listener. */
  emit(event: LiveEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
