import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { hmacAuthenticator, mintToken } from '../src/auth';
import {
  ASK_LANGUAGES,
  answerPrompt,
  changePrompt,
  examplePrompt,
  generateExample,
  generateFilmPatch,
  insertPrompt,
  parseExampleReply,
  sanitizeAnswerAssembly,
  sanitizeChangeAssembly,
  sanitizeInsertAssembly,
  streamAnswer,
  type AnswerAssembly,
  type ChangeAssembly,
} from '../src/ask';
import { referenceModel } from '../src/reference-model';
import { STUB_VOICES, StubNarrator } from '../src/tts';
import { ScriptedModel } from '../src/models';
import { MemoryRecords } from '../src/records';
import { GenerationService, type ServiceOptions } from '../src/service';

const SECRET = 'a-test-secret-that-is-long-enough-to-use';
const servers: Array<{ server: Server; service: GenerationService }> = [];

async function start(options: Partial<ServiceOptions> = {}) {
  const records = new MemoryRecords();
  const model = options.model ?? new ScriptedModel(() => 'The bob moves fastest at the bottom.');
  const service = new GenerationService({ model, authenticate: hmacAuthenticator(SECRET), records, ...options });
  const server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push({ server, service });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = mintToken(SECRET, 'learner-1');
  const post = (path: string, body: unknown, as = token) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${as}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = (path: string, as = token) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${as}` } });
  return { base, records, service, token, post, get, model: model as ScriptedModel };
}

afterEach(async () => {
  for (const { server, service } of servers.splice(0)) {
    await service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

const ANCHOR = { film: 'pendulum', version: 1, scene: 's1', beat: 's1b3', wordIndex: 1 };

function askBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    question: 'Why does it keep time?',
    anchor: ANCHOR,
    beat: { beat: 's1b3', say: 'It trades height for speed, moving fastest through the very bottom.' },
    sceneSummary: 'A pendulum swinging from its pivot.',
    ...over,
  };
}

function assembly(over: Partial<AnswerAssembly> = {}): AnswerAssembly {
  const sanitized = sanitizeAnswerAssembly(askBody());
  if (!sanitized.ok) throw new Error(sanitized.problems.join('; '));
  return { ...sanitized.assembly, ...over };
}

function changeAssembly(over: Partial<ChangeAssembly> = {}): ChangeAssembly {
  return {
    prompt: 'Say what pulls the pendulum down.',
    film: 'pendulum',
    version: 1,
    beats: [
      { beat: 's1b1', scene: 's1', say: 'A pendulum hangs from its pivot, pulled straight down by gravity.' },
      { beat: 's1b2', scene: 's1', say: 'Pull the bob aside, let go, and watch the swing begin.' },
    ],
    ...over,
  };
}

function exampleReply(): string {
  const scene = Object.values(REFERENCE_SCENES)[0]!;
  return `Here is another example.\n\`\`\`html\n${scene.html.replace(/\n$/, '')}\n\`\`\`\n\`\`\`css\n${scene.css.replace(/\n$/, '')}\n\`\`\`\n\`\`\`js\n${scene.js.replace(/\n$/, '')}\n\`\`\`\nCaption: The same idea, shown another way.\n`;
}

describe('ask full: depth and language', () => {
  it('defaults to standard English and bounds both', () => {
    const sanitized = sanitizeAnswerAssembly(askBody());
    expect(sanitized.ok).toBe(true);
    if (!sanitized.ok) return;
    expect(sanitized.assembly.depth).toBe('standard');
    expect(sanitized.assembly.language).toBe('en');
    expect(sanitizeAnswerAssembly(askBody({ depth: 'sideways' })).ok).toBe(false);
    expect(sanitizeAnswerAssembly(askBody({ language: 'xx' })).ok).toBe(false);
    expect(sanitizeAnswerAssembly(askBody({ depth: 'simpler', language: 'es' })).ok).toBe(true);
    expect(sanitizeInsertAssembly({ ...askBody({ depth: 'deeper' }), params: ['angle'] }).ok).toBe(true);
  });

  it('re-runs Answers and inserts at another depth', () => {
    expect(answerPrompt(assembly()).user).not.toContain('simpler than the film');
    expect(answerPrompt(assembly({ depth: 'simpler' })).user).toContain('Keep the answer simpler than the film: plain words, one idea per sentence.');
    expect(answerPrompt(assembly({ depth: 'deeper' })).user).toContain('Take the answer one level deeper than the film: name the mechanism and one consequence.');
    const insert = sanitizeInsertAssembly({ ...askBody(), params: ['angle'] });
    if (!insert.ok) throw new Error(insert.problems.join('; '));
    expect(insertPrompt({ ...insert.assembly, depth: 'simpler' }).user).toContain('Keep every line simpler than the film');
    expect(insertPrompt({ ...insert.assembly, depth: 'deeper' }).user).toContain('Take every line one level deeper than the film');
  });

  it('asks the model to translate: the prompt names the language', () => {
    expect(Object.keys(ASK_LANGUAGES)).toContain('es');
    expect(answerPrompt(assembly({ language: 'es' })).user).toContain('Answer in Spanish.');
    expect(examplePrompt(assembly({ language: 'fr' })).user).toContain('Write the lines in French.');
    // English asks for nothing extra: the default prompt is unchanged.
    expect(answerPrompt(assembly({ language: 'en' })).user).not.toContain('Answer in English');
  });

  it('streams a mock-translated answer when the model translates', async () => {
    // The mock translation: a scripted model that answers in the asked language.
    const model = new ScriptedModel((call) => (call.prompt.user.includes('Answer in Spanish.') ? 'La pesa se mueve más rápido por el punto más bajo.' : 'The bob moves fastest at the bottom.'));
    const reply = await streamAnswer(model, assembly({ language: 'es' }));
    expect(reply.text).toBe('La pesa se mueve más rápido por el punto más bajo.');
    expect(model.calls[0]?.prompt.user).toContain('Answer in Spanish.');
  });
});

describe('ask full: another-example generation', () => {
  it('writes a side-clip scene through the scene pipeline', async () => {
    const model = new ScriptedModel(() => exampleReply());
    const prompt = examplePrompt(assembly());
    expect(prompt.system[0]?.cache).toBe(true);
    expect(prompt.user).toContain('The learner asked: "Why does it keep time?"');
    const generated = await generateExample(model, assembly());
    expect(model.calls[0]?.purpose).toBe('scene');
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    expect(generated.example.anchor).toMatchObject({ film: 'pendulum', beat: 's1b3', wordIndex: 1 });
    expect(generated.example.caption).toBe('The same idea, shown another way.');
    expect(generated.example.js).toContain('inc.');
    expect(typeof generated.example.usd).toBe('number');
  });

  it('repairs a rejected side clip once, then fails', async () => {
    const good = exampleReply();
    const model = new ScriptedModel((_call, index) => (index === 0 ? 'Here is a broken clip.\n```js\nfetch("https://example.com");\n```\nCaption: Broken.\n' : good));
    const generated = await generateExample(model, assembly());
    expect(generated.ok).toBe(true);
    expect(model.calls.map((call) => call.purpose)).toEqual(['scene', 'repair']);
    if (!generated.ok) return;
    expect(generated.example.caption).toBe('The same idea, shown another way.');

    const stubborn = new ScriptedModel(() => 'no fences here at all');
    const failed = await generateExample(stubborn, assembly());
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.problems.length).toBeGreaterThan(0);
    expect(stubborn.calls).toHaveLength(2);
  });

  it('rejects replies without a scene or a caption', () => {
    expect(parseExampleReply('nothing fenced').value).toBeNull();
    expect(parseExampleReply('```html\n<div></div>\n```\nCaption: Only html.\n').value).toBeNull();
    const scene = Object.values(REFERENCE_SCENES)[0]!;
    const noCaption = `\`\`\`html\n${scene.html}\n\`\`\`\n\`\`\`css\n${scene.css}\n\`\`\`\n\`\`\`js\n${scene.js}\n\`\`\`\n`;
    expect(parseExampleReply(noCaption).value).toBeNull();
    expect(parseExampleReply(noCaption).problems.join(' ')).toContain('Caption');
  });

  it('answers example calls from the reference model', async () => {
    const generated = await generateExample(referenceModel(), assembly());
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    expect(generated.example.caption).toBe('The same idea, shown another way.');
    expect(generated.example.js).toContain('inc.');
  });
});

describe('ask full: film-patch generation', () => {
  it('bounds the change request', () => {
    expect(sanitizeChangeAssembly({ prompt: 'Change it.', film: 'pendulum', version: 1, beats: [{ beat: 's1b1', scene: 's1', say: 'A line.' }] }).ok).toBe(true);
    expect(sanitizeChangeAssembly({ prompt: '', film: 'pendulum', version: 1, beats: [{ beat: 's1b1', scene: 's1', say: 'A line.' }] }).ok).toBe(false);
    expect(sanitizeChangeAssembly({ prompt: 'Change it.', film: '', version: 1, beats: [{ beat: 's1b1', scene: 's1', say: 'A line.' }] }).ok).toBe(false);
    expect(sanitizeChangeAssembly({ prompt: 'Change it.', film: 'pendulum', version: 0, beats: [{ beat: 's1b1', scene: 's1', say: 'A line.' }] }).ok).toBe(false);
    expect(sanitizeChangeAssembly({ prompt: 'Change it.', film: 'pendulum', version: 1, beats: [] }).ok).toBe(false);
    expect(sanitizeChangeAssembly({ prompt: 'Change it.', film: 'pendulum', version: 1, beats: [{ beat: 's1b1', say: 'A line.' }] }).ok).toBe(false);
  });

  it('writes version N+1 through the edits and repair path', async () => {
    const prompt = changePrompt(changeAssembly());
    expect(prompt.system[0]?.cache).toBe(true);
    expect(prompt.user).toContain('s1/s1b1: "A pendulum hangs');
    const model = new ScriptedModel(() => 'Here is the patch.\n```json\n{"beats": [{"beat": "s1b1", "scene": "s1", "say": "A pendulum hangs from its pivot, pulled down by gravity."}]}\n```\n');
    const generated = await generateFilmPatch(model, changeAssembly());
    expect(model.calls[0]?.purpose).toBe('scene');
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    expect(generated.generated.patch).toMatchObject({ film: 'pendulum', parent: 1, version: 2 });
    expect(generated.generated.patch.beats).toHaveLength(1);
    expect(generated.generated.patch.beats[0]?.say).toContain('pulled down by gravity');
  });

  it('repairs a rejected patch once, then fails', async () => {
    const model = new ScriptedModel((_call, index) =>
      index === 0 ? '```json\n{"beats": [{"beat": "s1b1", "scene": "s1", "say": "", "set": {"angle": 1}}]}\n```\n' : '```json\n{"beats": [{"beat": "s1b1", "scene": "s1", "say": "A pendulum hangs, pulled down by gravity."}]}\n```\n',
    );
    const generated = await generateFilmPatch(model, changeAssembly());
    expect(generated.ok).toBe(true);
    expect(model.calls.map((call) => call.purpose)).toEqual(['scene', 'repair']);
    const stubborn = new ScriptedModel(() => 'no json here at all');
    expect((await generateFilmPatch(stubborn, changeAssembly())).ok).toBe(false);
    expect(stubborn.calls).toHaveLength(2);
  });

  it('answers change calls from the reference model', async () => {
    const generated = await generateFilmPatch(referenceModel(), changeAssembly());
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    expect(generated.generated.patch.version).toBe(2);
    expect(generated.generated.patch.beats[0]?.beat).toBe('s1b1');
  });
});

describe('ask full: stub voices', () => {
  it('lists stable stub voices the stub accepts', async () => {
    expect(STUB_VOICES.length).toBeGreaterThanOrEqual(2);
    const ids = STUB_VOICES.map((voice) => voice.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const voice of STUB_VOICES) {
      expect(voice.name.trim()).not.toBe('');
      const reply = await new StubNarrator().speak({ text: 'A short line.', voice: voice.id });
      expect(reply.words.length).toBeGreaterThan(0);
    }
  });
});

describe('ask full: service endpoints', () => {
  it('generates a side clip pinned to its anchor and records nothing', async () => {
    const { post, records, model } = await start({ model: new ScriptedModel(() => exampleReply()) });
    const example = await post('/v1/ask/example', askBody());
    expect(example.status).toBe(200);
    const body = (await example.json()) as { status: string; clip?: { anchor: unknown; html: string; css: string; js: string; caption: string } };
    expect(body.status).toBe('clip');
    expect(body.clip?.anchor).toMatchObject({ film: 'pendulum', beat: 's1b3', wordIndex: 1 });
    expect(body.clip?.caption).toBe('The same idea, shown another way.');
    expect(body.clip?.js).toContain('inc.');
    expect(records.records).toHaveLength(0);
    expect(model.calls[0]?.purpose).toBe('scene');
  });

  it('fails a side clip the scene cannot play, and reports a switched-off service', async () => {
    const { post } = await start({ model: new ScriptedModel(() => 'no fences here at all') });
    expect(((await (await post('/v1/ask/example', askBody())).json()) as { reason: string }).reason).toBe('invalid');
    const off = await start({ model: new ScriptedModel(() => exampleReply()), enabled: () => false });
    expect(((await (await off.post('/v1/ask/example', askBody())).json()) as { reason: string }).reason).toBe('off');
  });

  it('changes the film to version N+1 with the changed beats spoken', async () => {
    const { post, records } = await start({
      model: new ScriptedModel(() => '```json\n{"beats": [{"beat": "s1b1", "scene": "s1", "say": "A pendulum hangs from its pivot, pulled down by gravity."}]}\n```'),
    });
    const change = await post('/v1/ask/change', { prompt: 'Say what pulls it down.', film: 'pendulum', version: 1, beats: [{ beat: 's1b1', scene: 's1', say: 'A line.' }] });
    expect(change.status).toBe(200);
    const body = (await change.json()) as { status: string; patch?: { film: string; parent: number; version: number; beats: Array<{ beat: string; say: string }>; audio: Array<{ beat: string; seconds: number; words: number[]; audioBase64: string | null; sampleRate: number }> } };
    expect(body.status).toBe('patch');
    expect(body.patch).toMatchObject({ film: 'pendulum', parent: 1, version: 2 });
    expect(body.patch?.beats).toHaveLength(1);
    expect(body.patch?.beats[0]?.say).toContain('pulled down by gravity');
    expect(body.patch?.audio).toHaveLength(1);
    expect(body.patch?.audio[0]?.beat).toBe('s1b1');
    expect(body.patch?.audio[0]?.seconds).toBeGreaterThan(0);
    expect(body.patch?.audio[0]?.words.length).toBeGreaterThan(0);
    expect(typeof body.patch?.audio[0]?.audioBase64).toBe('string');
    expect(records.records).toHaveLength(0);
  });

  it('rejects unauthenticated and malformed change and example requests', async () => {
    const { post } = await start({ model: referenceModel() });
    expect((await post('/v1/ask/example', askBody(), 'bad-token')).status).toBe(401);
    expect((await post('/v1/ask/change', { prompt: 'x', film: 'pendulum', version: 1, beats: [] })).status).toBe(400);
    expect((await post('/v1/ask/change', { prompt: '', film: 'pendulum', version: 1, beats: [{ beat: 's1b1', scene: 's1', say: 'A line.' }] })).status).toBe(400);
    expect((await post('/v1/ask/example', { question: '' })).status).toBe(400);
  });

  it('serves the stub voice list to learners', async () => {
    const { get } = await start();
    const answer = await get('/v1/voices');
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { voices: Array<{ id: string; name: string }> };
    expect(body.voices).toEqual(STUB_VOICES.map((voice) => ({ ...voice })));
    expect((await get('/v1/voices', 'bad-token')).status).toBe(401);
  });

  it('streams an Answer at another depth and in another language', async () => {
    const { post, model } = await start({ model: new ScriptedModel(() => 'Una respuesta corta.') });
    const answer = await post('/v1/ask', askBody({ depth: 'simpler', language: 'es' }));
    expect(answer.status).toBe(200);
    const text = await answer.text();
    expect(text).toContain('Una respuesta corta.');
    expect(model.calls[0]?.prompt.user).toContain('Keep the answer simpler than the film');
    expect(model.calls[0]?.prompt.user).toContain('Answer in Spanish.');
  });
});
