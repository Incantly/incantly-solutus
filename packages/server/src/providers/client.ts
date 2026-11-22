/** The model client the settings ask for, or `undefined` when the provider has no key (model endpoints then answer `model_unavailable`). */
import type { ModelClient } from '@incantly/teacher';
import type { Settings } from '../env';
import { openRouterClient } from './openrouter';
import { openRouterSpeech } from './speech';
import type { SpeechClient } from './speech';

export interface ClientOptions {
  /** The network, for tests and hosts. Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

/**
 * OpenRouter with the settings' free models when its key is set. Muse Spark waits for its API documentation (design 4,
 * open question 1), so that provider gives no client yet.
 */
export function clientFor(settings: Settings, options: ClientOptions = {}): ModelClient | undefined {
  if (settings.provider !== 'openrouter' || settings.secrets.openrouter() === undefined) return undefined;
  return openRouterClient(
    { apiKey: settings.secrets.openrouter, ...(options.fetch !== undefined ? { fetch: options.fetch } : {}) },
    { textModels: settings.textModels, visionModels: settings.visionModels, ...(options.now !== undefined ? { now: options.now } : {}) },
  );
}

/** The free voices of `/v1/speech` when the OpenRouter key is set; none otherwise (Muse Spark has no voice here). */
export function speechFor(settings: Settings, options: ClientOptions = {}): SpeechClient | undefined {
  if (settings.provider !== 'openrouter' || settings.secrets.openrouter() === undefined) return undefined;
  return openRouterSpeech({
    apiKey: settings.secrets.openrouter,
    models: settings.speechModels,
    voice: settings.speechVoice,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}
