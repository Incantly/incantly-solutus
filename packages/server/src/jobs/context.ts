/** What a route handler gets (docs/features/server/design.md 2): the job that owns the response, and the server's parts. */
import type { ModelClient } from '@incantly/teacher';
import type { Settings } from '../env';
import type { LessonStore } from '../lessons/store';
import type { LogFn } from '../log';
import type { RateLimiter } from '../limits/rate';
import type { SpeechClient } from '../providers/speech';
import type { Job } from './job';

export interface Context {
  readonly job: Job;
  readonly settings: Settings;
  /** The model client, or undefined when the provider has no key (model endpoints answer `model_unavailable`). */
  readonly client: ModelClient | undefined;
  /** The voices of `/v1/speech`, or undefined when the provider has no key or no voice (the route answers `model_unavailable`). */
  readonly speech: SpeechClient | undefined;
  readonly limiter: RateLimiter;
  /** The lessons held in memory (`/v1/lesson/*`). */
  readonly lessons: LessonStore;
  readonly log: LogFn;
  /** The client's address, for the rate limits. */
  readonly clientId: string;
  /** The parsed JSON body of a POST; empty for a GET. */
  readonly body: Readonly<Record<string, unknown>>;
  readonly now: () => number;
}

export interface Route {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  /** The most bytes of the request body. */
  readonly bodyLimit: number;
  handle(ctx: Context): void | Promise<void>;
}
