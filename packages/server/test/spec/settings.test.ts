/**
 * Settings and keys (server design 3, 7; requirements R1; errors.md `config_invalid`): defaults, `:free` only, a missing
 * key does not stop the server, a key never leaves `secrets`, `.env` is ignored by git and `.env.example` lists every setting.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIGINS, DEFAULT_SPEECH_MODELS, DEFAULT_TEXT_MODELS, DEFAULT_VISION_MODELS, readSettings } from '../../src/index';
import { SECRET_KEY, getJson, settingsOf, start } from './helpers';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

const failure = (env: Record<string, string>): { kind: string; message: string; hint?: string; detail?: Record<string, unknown> } => {
  const r = readSettings(env);
  if (r.ok) throw new Error('settings were accepted');
  return r;
};

/** Every string leaf of a value. */
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) leaves(x, out);
  return out;
}

describe('defaults (design 3)', () => {
  const s = settingsOf({});

  it('provider openrouter, host 127.0.0.1, port 8787', () => {
    expect(s.provider).toBe('openrouter');
    expect(s.host).toBe('127.0.0.1');
    expect(s.port).toBe(8787);
  });

  it('20 requests a minute and 900 model calls a day', () => {
    expect(s.ratePerMinute).toBe(20);
    expect(s.dailyModelCalls).toBe(900);
  });

  it('allowed origins: the studio on 127.0.0.1:5173 and localhost:5173', () => {
    expect([...s.allowedOrigins]).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
    expect([...DEFAULT_ORIGINS]).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
  });

  it('speech models are Fish then HeyGen, and the voice is bram', () => {
    expect([...s.speechModels]).toEqual(['fish-audio/s2.1-pro-free:free', 'heygen/heygen-voice-1-turbo:free']);
    expect([...DEFAULT_SPEECH_MODELS]).toEqual([...s.speechModels]);
    expect(s.speechVoice).toBe('bram');
  });

  it('every default model id is free', () => {
    for (const id of [...DEFAULT_TEXT_MODELS, ...DEFAULT_VISION_MODELS, ...DEFAULT_SPEECH_MODELS, ...s.textModels, ...s.visionModels, ...s.speechModels]) expect(id.endsWith(':free'), id).toBe(true);
  });

  it('the default text and vision lists are the ones in .env.example', () => {
    const example = readFileSync(`${root}packages/server/.env.example`, 'utf8');
    expect(example).toContain(`OPENROUTER_TEXT_MODELS=${[...s.textModels].join(',')}`);
    expect(example).toContain(`OPENROUTER_VISION_MODELS=${[...s.visionModels].join(',')}`);
  });

  it('proxy headers are not trusted unless TRUST_PROXY=1', () => {
    expect(s.trustProxy).toBe(false);
    expect(settingsOf({ TRUST_PROXY: '1' }).trustProxy).toBe(true);
    expect(settingsOf({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
  });

  it('every setting can be changed from the environment', () => {
    const t = settingsOf({
      MODEL_PROVIDER: 'openrouter',
      OPENROUTER_TEXT_MODELS: 'a/b:free,c/d:free',
      OPENROUTER_VISION_MODELS: 'e/f:free',
      OPENROUTER_SPEECH_MODELS: 'g/h:free',
      OPENROUTER_SPEECH_VOICE: 'nadine',
      HOST: '0.0.0.0',
      PORT: '9000',
      ALLOWED_ORIGINS: 'https://one.example,https://two.example',
      RATE_PER_MINUTE: '5',
      DAILY_MODEL_CALLS: '50',
    });
    expect(t).toMatchObject({ provider: 'openrouter', host: '0.0.0.0', port: 9000, ratePerMinute: 5, dailyModelCalls: 50, speechVoice: 'nadine' });
    expect([...t.textModels]).toEqual(['a/b:free', 'c/d:free']);
    expect([...t.visionModels]).toEqual(['e/f:free']);
    expect([...t.speechModels]).toEqual(['g/h:free']);
    expect([...t.allowedOrigins]).toEqual(['https://one.example', 'https://two.example']);
  });

  it('a blank value (NAME=) counts as unset', () => {
    expect(settingsOf({ PORT: '', RATE_PER_MINUTE: ' ', OPENROUTER_TEXT_MODELS: '' }).port).toBe(8787);
  });
});

describe('only free models: config_invalid (R1.2, errors.md)', () => {
  const lists = ['OPENROUTER_TEXT_MODELS', 'OPENROUTER_VISION_MODELS', 'OPENROUTER_SPEECH_MODELS'] as const;
  for (const name of lists) {
    it(`${name}: an id that does not end in :free is refused, and the message names the setting`, () => {
      const e = failure({ [name]: 'good/model:free,paid/model' });
      expect(e.kind).toBe('config_invalid');
      expect(e.message).toContain(name);
      expect(e.message).toContain('paid/model');
    });

    it(`${name}: ":free" in the middle of an id is not free`, () => {
      expect(failure({ [name]: 'x/y:free-extra' }).kind).toBe('config_invalid');
    });

    it(`${name}: a list of free ids is accepted`, () => {
      expect(readSettings({ [name]: 'x/y:free,z/w:free' }).ok).toBe(true);
    });
  }

  it('an id with spaces around it is read as the id', () => {
    expect(readSettings({ OPENROUTER_TEXT_MODELS: ' x/y:free , z/w:free ' }).ok).toBe(true);
  });

  it('openrouter is the only provider: muse is refused', () => {
    expect(failure({ MODEL_PROVIDER: 'muse' }).kind).toBe('config_invalid');
  });
});

describe('wrong settings: config_invalid, never a throw (errors.md)', () => {
  const bad: readonly [string, Record<string, string>][] = [
    ['an unknown provider', { MODEL_PROVIDER: 'gpt' }],
    ['a port that is not a number', { PORT: 'abc' }],
    ['a port above 65535', { PORT: '70000' }],
    ['a negative port', { PORT: '-1' }],
    ['a port with a fraction', { PORT: '80.5' }],
    ['a rate that is not a number', { RATE_PER_MINUTE: 'many' }],
    ['a rate of zero or less', { RATE_PER_MINUTE: '0' }],
    ['a daily budget that is not a number', { DAILY_MODEL_CALLS: 'lots' }],
  ];
  for (const [name, env] of bad) {
    it(name, () => {
      const e = failure(env);
      expect(e.kind).toBe('config_invalid');
      expect(e.message).toContain(Object.keys(env)[0] as string);
    });
  }

  it('the error holds no key even when a key is set next to the wrong setting', () => {
    const e = failure({ OPENROUTER_API_KEY: SECRET_KEY, PORT: 'abc' });
    expect(JSON.stringify(e)).not.toContain(SECRET_KEY);
  });

  it('nothing throws for odd values', () => {
    for (const v of ['', ' ', '\u0000', 'NaN', 'Infinity', '1e999', '{}', '[]', 'null', '0x10']) {
      expect(() => readSettings({ PORT: v, RATE_PER_MINUTE: v, DAILY_MODEL_CALLS: v, MODEL_PROVIDER: v, ALLOWED_ORIGINS: v, TRUST_PROXY: v })).not.toThrow();
    }
  });
});

describe('keys (R1.3, design 7)', () => {
  it('a missing key does not stop the server: settings are fine and say no key is set', () => {
    const s = settingsOf({});
    expect(s.keySet).toBe(false);
  });

  it('the OpenRouter key makes keySet true; nothing else does', () => {
    expect(settingsOf({ OPENROUTER_API_KEY: SECRET_KEY }).keySet).toBe(true);
    expect(settingsOf({}).keySet).toBe(false);
  });

  it('a blank key is no key', () => {
    expect(settingsOf({ OPENROUTER_API_KEY: '   ' }).keySet).toBe(false);
  });

  it('the settings object holds the key nowhere a log, a JSON dump or a string can reach', () => {
    const s = settingsOf({ OPENROUTER_API_KEY: SECRET_KEY });
    expect(JSON.stringify(s)).not.toContain('TESTONLY');
    expect(leaves(s).join('\n')).not.toContain('TESTONLY');
    expect(String(s)).not.toContain('TESTONLY');
    expect(Object.keys(s).filter((k) => /key|token|secret/i.test(k) && typeof (s as unknown as Record<string, unknown>)[k] === 'string')).toEqual([]);
  });

  it('and still serves the key to the provider call that needs it', () => {
    const s = settingsOf({ OPENROUTER_API_KEY: SECRET_KEY });
    expect(s.secrets.openrouter()).toBe(SECRET_KEY);
  });

  it('/v1/health never shows a key', async () => {
    for (const env of [{ OPENROUTER_API_KEY: SECRET_KEY }]) {
      const run = await start(env);
      try {
        const r = await getJson(run.port, '/v1/health');
        expect(r.status).toBe(200);
        expect(r.text).not.toContain('TESTONLY');
        expect(r.text).not.toContain(SECRET_KEY);
        expect(r.text).not.toMatch(/sk-or|bearer/i);
        expect(JSON.stringify(r.headers)).not.toContain('TESTONLY');
      } finally {
        await run.close();
      }
    }
  });
});

describe('.env and .env.example (R1.1)', () => {
  it('git ignores packages/server/.env', () => {
    // `check-ignore` reads no file content: it answers from the ignore rules
    const out = execFileSync('git', ['check-ignore', '-q', 'packages/server/.env'], { cwd: root, stdio: 'pipe' });
    expect(out.length).toBe(0);
  });

  it('git does not ignore .env.example', () => {
    expect(() => execFileSync('git', ['check-ignore', '-q', 'packages/server/.env.example'], { cwd: root, stdio: 'pipe' })).toThrow();
  });

  it('.env.example lists every setting of design 3', () => {
    const example = readFileSync(`${root}packages/server/.env.example`, 'utf8');
    for (const name of [
      'MODEL_PROVIDER', 'OPENROUTER_API_KEY', 'OPENROUTER_TEXT_MODELS', 'OPENROUTER_VISION_MODELS', 'OPENROUTER_SPEECH_MODELS', 'OPENROUTER_SPEECH_VOICE',
      'HOST', 'PORT', 'ALLOWED_ORIGINS', 'RATE_PER_MINUTE', 'DAILY_MODEL_CALLS',
    ]) {
      expect(example, name).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'));
    }
  });

  it('.env.example holds no real key: key settings are empty', () => {
    const example = readFileSync(`${root}packages/server/.env.example`, 'utf8');
    expect(example).toMatch(/^OPENROUTER_API_KEY=$/m);
    expect(example).not.toMatch(/sk-or-|sk-[A-Za-z0-9]{20,}/);
  });

  it('.env.example says to send no student data to free models (design 7)', () => {
    const example = readFileSync(`${root}packages/server/.env.example`, 'utf8').toLowerCase();
    expect(example).toMatch(/student|personal|private/);
  });

  it('every free-model id in .env.example is free', () => {
    const example = readFileSync(`${root}packages/server/.env.example`, 'utf8');
    for (const m of example.matchAll(/^(OPENROUTER_(?:TEXT|VISION|SPEECH)_MODELS)=(.*)$/gm)) {
      for (const id of (m[2] ?? '').split(',')) expect(id.trim().endsWith(':free'), `${m[1]}: ${id}`).toBe(true);
    }
  });
});
