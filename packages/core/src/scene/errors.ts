/** Thrown when a scene misuses the SDK API. Caught by the runtime's error boundary. */
export class SceneApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneApiError';
  }
}

export type DiagnosticKind = 'non-finite' | 'samples-capped' | 'budget';

/** A problem the scene did not throw for, recorded for the probe and for failure reports. */
export interface Diagnostic {
  readonly kind: DiagnosticKind;
  readonly message: string;
  readonly elementId?: number;
}
