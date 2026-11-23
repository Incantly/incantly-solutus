/**
 * Settings from the environment (docs/features/server/design.md 3). `readSettings` checks every setting and gives
 * `config_invalid` for a wrong one: a model id that does not end in `:free`, a bad port, an unknown provider. Keys are
 * held behind functions, so a settings object that is logged or sent as JSON never holds one.
 */
import { serverError } from './errors';
import type { ServerError } from './errors';

export type Provider = 'openrouter';

export interface Secrets {
  /** The OpenRouter key, or undefined when none is set. */
  openrouter(): string | undefined;
}

export interface Settings {
  readonly provider: Provider;
  readonly textModels: readonly string[];
  readonly visionModels: readonly string[];
  readonly speechModels: readonly string[];
  readonly speechVoice: string;
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly ratePerMinute: number;
  readonly dailyModelCalls: number;
  /** Trust `x-forwarded-for` for the client's address (only behind a proxy). */
  readonly trustProxy: boolean;
  /** Whether the chosen provider has a key. The key itself is in `secrets`. */
  readonly keySet: boolean;
  readonly secrets: Secrets;
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

export const DEFAULT_TEXT_MODELS = [
  'baidu/ernie-5.5-flash-preview:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'particle-ai/particle-1:free',
  'inclusionai/ling-3.2-flash:free',
] as const;
export const DEFAULT_VISION_MODELS = ['particle-ai/particle-1:free', 'nvidia/nemotron-3.5-super-vl:free', 'inclusionai/ling-3.2-flash:free'] as const;
export const DEFAULT_SPEECH_MODELS = ['fish-audio/s2.1-pro-free:free', 'heygen/heygen-voice-1-turbo:free'] as const;
export const DEFAULT_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'] as const;

const invalid = (setting: string, why: string): ServerError =>
  serverError('config_invalid', `${setting}: ${why}`, { hint: 'Fix packages/server/.env (see .env.example); the server does not start with a wrong setting.', detail: { setting } });

/** A setting's value with blanks counted as unset (a `.env` line `NAME=` is no value). */
const read = (env: EnvLike, name: string): string | undefined => {
  const v = env[name]?.trim();
  return v === undefined || v === '' ? undefined : v;
};

function list(env: EnvLike, name: string, fallback: readonly string[]): string[] {
  const v = read(env, name);
  return v === undefined ? [...fallback] : v.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

function wholeNumber(env: EnvLike, name: string, fallback: number, min: number, max: number): number | ServerError {
  const v = read(env, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < min || n > max) return invalid(name, `"${v}" is not a whole number from ${min} to ${max}.`);
  return n;
}

function freeModels(name: string, ids: readonly string[]): ServerError | undefined {
  if (ids.length === 0) return invalid(name, 'at least one model id is needed.');
  const paid = ids.find((id) => !id.endsWith(':free'));
  return paid === undefined ? undefined : invalid(name, `"${paid}" does not end in :free; only free models are allowed.`);
}

/** An origin as the browser sends it: scheme, host and port, nothing else. */
function originOf(value: string): string | undefined {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === value.replace(/\/$/, '') ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

export function readSettings(env: EnvLike): { readonly ok: true; readonly value: Settings } | ServerError {
  const providerText = read(env, 'MODEL_PROVIDER') ?? 'openrouter';
  if (providerText !== 'openrouter') return invalid('MODEL_PROVIDER', `"${providerText}" is not a provider; the only provider is openrouter.`);
  const textModels = list(env, 'OPENROUTER_TEXT_MODELS', DEFAULT_TEXT_MODELS);
  const visionModels = list(env, 'OPENROUTER_VISION_MODELS', DEFAULT_VISION_MODELS);
  const speechModels = list(env, 'OPENROUTER_SPEECH_MODELS', DEFAULT_SPEECH_MODELS);
  const bad =
    freeModels('OPENROUTER_TEXT_MODELS', textModels) ?? freeModels('OPENROUTER_VISION_MODELS', visionModels) ?? freeModels('OPENROUTER_SPEECH_MODELS', speechModels);
  if (bad) return bad;
  const port = wholeNumber(env, 'PORT', 8787, 0, 65535);
  if (typeof port !== 'number') return port;
  const rate = wholeNumber(env, 'RATE_PER_MINUTE', 20, 1, 100000);
  if (typeof rate !== 'number') return rate;
  const daily = wholeNumber(env, 'DAILY_MODEL_CALLS', 900, 1, 10000000);
  if (typeof daily !== 'number') return daily;
  const allowedOrigins: string[] = [];
  for (const raw of list(env, 'ALLOWED_ORIGINS', DEFAULT_ORIGINS)) {
    const origin = originOf(raw);
    if (origin === undefined) return invalid('ALLOWED_ORIGINS', `"${raw}" is not an origin such as http://127.0.0.1:5173.`);
    allowedOrigins.push(origin);
  }
  const trust = read(env, 'TRUST_PROXY');
  if (trust !== undefined && trust !== '0' && trust !== '1') return invalid('TRUST_PROXY', `"${trust}" is not 0 or 1.`);
  const host = read(env, 'HOST') ?? '127.0.0.1';
  const openrouterKey = read(env, 'OPENROUTER_API_KEY');
  const secrets: Secrets = { openrouter: () => openrouterKey };
  return {
    ok: true,
    value: {
      provider: providerText,
      textModels,
      visionModels,
      speechModels,
      speechVoice: read(env, 'OPENROUTER_SPEECH_VOICE') ?? 'bram',
      host,
      port,
      allowedOrigins,
      ratePerMinute: rate,
      dailyModelCalls: daily,
      trustProxy: trust === '1',
      keySet: openrouterKey !== undefined,
      secrets,
    },
  };
}
