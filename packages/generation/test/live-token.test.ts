/**
 * The Live token minter against a mocked fetch: the retention gate, model
 * discovery, the ephemeral token request shape, and key hygiene in errors.
 * No real Google call is made.
 */
import { describe, expect, it, vi } from 'vitest';
import { geminiLiveRetentionAccepted, geminiLiveTokenMinter, pickLiveModel } from '../src/live-token';

/** The bidi models one key lists today, in list order. */
const REAL_BIDI_MODELS = [
  'gemini-3.5-transcribe-live',
  'gemini-2.5-flash-native-audio-latest',
  'gemini-2.5-flash-native-audio-preview-09-2025',
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-3.1-flash-live-preview',
  'gemini-3.8-live',
  'gemini-3.8-live-extended-thinking',
  'gemini-robotics-er-2-streaming-preview',
  'gemini-3.5-live-translate-preview',
].map((name) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent', 'bidiGenerateContent'] }));

const MODELS = { models: REAL_BIDI_MODELS };

function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(route.body), { status: route.status });
  });
  return { calls, fetcher: fetcher as unknown as typeof fetch };
}

describe('the retention gate', () => {
  it('refuses to construct without retention acceptance, naming no key', () => {
    expect(() => geminiLiveTokenMinter({ apiKey: 'secret-key-abc', retentionAccepted: false })).toThrow(/GEMINI_LIVE_RETENTION_ACCEPTED=1/);
    try {
      geminiLiveTokenMinter({ apiKey: 'secret-key-abc', retentionAccepted: false });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('secret-key-abc');
    }
  });

  it('reads the flag the same way the Cartesia gate does', () => {
    expect(geminiLiveRetentionAccepted({ GEMINI_LIVE_RETENTION_ACCEPTED: '1' })).toBe(true);
    expect(geminiLiveRetentionAccepted({})).toBe(false);
    expect(geminiLiveRetentionAccepted({ GEMINI_LIVE_RETENTION_ACCEPTED: '0' })).toBe(false);
  });
});

describe('model discovery', () => {
  it('picks gemini-3.8-live from the real bidi list, skipping transcription, translation, robotics and extended-thinking', () => {
    expect(pickLiveModel(REAL_BIDI_MODELS)).toBe('gemini-3.8-live');
  });

  it('prefers the listed teachers in order when the top pick is missing', () => {
    const withoutTop = REAL_BIDI_MODELS.filter((m) => m.name !== 'models/gemini-3.8-live');
    expect(pickLiveModel(withoutTop)).toBe('gemini-3.1-flash-live-preview');
    const audioOnly = REAL_BIDI_MODELS.filter((m) => m.name.startsWith('models/gemini-2.5-flash-native-audio'));
    expect(pickLiveModel(audioOnly)).toBe('gemini-2.5-flash-native-audio-latest');
  });

  it('falls back to any remaining live model, then any bidi model, then null', () => {
    expect(pickLiveModel([{ name: 'models/x-live', supportedGenerationMethods: ['bidiGenerateContent'] }])).toBe('x-live');
    expect(pickLiveModel([{ name: 'models/x', supportedGenerationMethods: ['generateContent', 'bidiGenerateContent'] }])).toBe('x');
    expect(pickLiveModel([{ name: 'models/x', supportedGenerationMethods: ['generateContent'] }])).toBeNull();
    expect(pickLiveModel([{ name: 'models/gemini-3.5-transcribe-live', supportedGenerationMethods: ['bidiGenerateContent'] }])).toBeNull();
  });

  it('lets the explicit model override discovery', () => {
    expect(pickLiveModel([], 'custom-live')).toBe('custom-live');
  });
});

describe('geminiLiveTokenMinter', () => {
  it('discovers the Live model and mints a single-use short-lived token', async () => {
    const { calls, fetcher } = mockFetch({
      'https://generativelanguage.googleapis.com/v1beta/models': { status: 200, body: MODELS },
      'https://generativelanguage.googleapis.com/v1beta/auth_tokens': { status: 200, body: { name: 'token-123' } },
    });
    const before = Date.now();
    const minted = await geminiLiveTokenMinter({ apiKey: 'k', retentionAccepted: true, fetch: fetcher }).mint();

    expect(minted.token).toBe('token-123');
    expect(minted.model).toBe('gemini-3.8-live');
    expect(minted.expiresAt).toBeGreaterThanOrEqual(before + 29 * 60_000);
    expect(minted.expiresAt).toBeLessThanOrEqual(Date.now() + 31 * 60_000);

    const tokenCall = calls.find((c) => c.url.endsWith('/auth_tokens'))!;
    expect(tokenCall.init?.method).toBe('POST');
    expect(tokenCall.init?.headers).toMatchObject({ 'x-goog-api-key': 'k' });
    const body = JSON.parse(tokenCall.init?.body as string) as { uses: number; expireTime: string; newSessionExpireTime: string };
    expect(body.uses).toBe(1);
    const expire = Date.parse(body.expireTime) - before;
    const newSession = Date.parse(body.newSessionExpireTime) - before;
    expect(expire).toBeGreaterThanOrEqual(29 * 60_000);
    expect(expire).toBeLessThanOrEqual(31 * 60_000);
    expect(newSession).toBeGreaterThanOrEqual(50_000);
    expect(newSession).toBeLessThanOrEqual(70_000);
  });

  it('skips discovery when the model is explicit', async () => {
    const { calls, fetcher } = mockFetch({
      'https://generativelanguage.googleapis.com/v1beta/auth_tokens': { status: 200, body: { name: 'token-9' } },
    });
    const minted = await geminiLiveTokenMinter({ apiKey: 'k', retentionAccepted: true, fetch: fetcher, model: 'my-live' }).mint();
    expect(minted).toMatchObject({ token: 'token-9', model: 'my-live' });
    expect(calls).toHaveLength(1);
  });

  it('fails clearly when no Live model is reachable, without naming the key', async () => {
    const { fetcher } = mockFetch({
      'https://generativelanguage.googleapis.com/v1beta/models': {
        status: 200,
        body: { models: [{ name: 'models/text-only', supportedGenerationMethods: ['generateContent'] }] },
      },
    });
    await expect(geminiLiveTokenMinter({ apiKey: 'hidden-key', retentionAccepted: true, fetch: fetcher }).mint()).rejects.toThrow(
      /bidiGenerateContent/,
    );
  });

  it('keeps the key out of upstream failure messages', async () => {
    const { fetcher } = mockFetch({ 'https://generativelanguage.googleapis.com/v1beta/models': { status: 403, body: {} } });
    await expect(geminiLiveTokenMinter({ apiKey: 'hidden-key-xyz', retentionAccepted: true, fetch: fetcher }).mint()).rejects.toThrow(
      /403/,
    );
    try {
      await geminiLiveTokenMinter({ apiKey: 'hidden-key-xyz', retentionAccepted: true, fetch: fetcher }).mint();
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('hidden-key-xyz');
    }
  });
});
