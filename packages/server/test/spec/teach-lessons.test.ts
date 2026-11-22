/**
 * The three acceptance lessons (teacher design 11, R8.2) replayed through `POST /v1/teach`: each recorded reply goes to the
 * server as the stream an OpenRouter model sends, and the client side (a headless app that applies the `lines` the server
 * sent) must end with the lesson's expected objects. The events must also be the ones the loop gives when it replays the
 * recording itself. No network.
 */
import { readFileSync } from 'node:fs';
import { createHeadlessApp } from '@incantly/sdk';
import { fakeModel, figureTarget, liveTurn } from '@incantly/teacher';
import type { RecordedReply, TurnEvent } from '@incantly/teacher';
import { describe, expect, it } from 'vitest';
import { bootVoice, replyAsAnswer, teach, teachBody } from './r4-helpers';

type Mode = NonNullable<NonNullable<Parameters<typeof createHeadlessApp>[0]>['mode']>;

interface Recorded {
  readonly mode: Mode;
  readonly request: string;
  readonly expect: { readonly objects: readonly string[]; readonly values: Readonly<Record<string, number>>; readonly sentences: number; readonly control: readonly Record<string, unknown>[] };
  readonly replies: readonly RecordedReply[];
}

const load = (name: string): Recorded => JSON.parse(readFileSync(new URL(`../../../teacher/test/fixtures/lesson-${name}.json`, import.meta.url), 'utf8')) as Recorded;

describe.each(['pendulum', 'area', 'fire'])('acceptance lesson through POST /v1/teach: %s', (name) => {
  const rec = load(name);
  const serve = async () => {
    const b = await bootVoice({ answers: (_call, i) => replyAsAnswer((rec.replies[Math.min(i, rec.replies.length - 1)] ?? {}) as Parameters<typeof replyAsAnswer>[0]) });
    return { b, r: await teach(b, teachBody({ text: rec.request, mode: rec.mode })) };
  };

  it('answers 200 and ends with a bare done, after as many model calls as the recording has replies', async () => {
    const { b, r } = await serve();
    expect(r.status).toBe(200);
    expect(r.events[r.events.length - 1]).toEqual({ done: true });
    expect(b.fake.calls).toHaveLength(rec.replies.length);
  });

  it('a client that applies the lines the server sent ends with exactly the expected objects', async () => {
    const { r } = await serve();
    const client = createHeadlessApp({ mode: rec.mode });
    const lines = r.events.flatMap((e) => (Array.isArray(e['lines']) ? (e['lines'] as string[]) : []));
    const results = client.run(lines, { independent: true });
    for (const line of results) expect(line.ok, JSON.stringify(line)).toBe(true);
    const names = figureTarget(client).objects().list.map((o) => o.name);
    expect([...names].sort()).toEqual([...rec.expect.objects].sort());
  });

  it('the sentences and the film controls are the recording\'s', async () => {
    const { r } = await serve();
    expect(r.events.filter((e) => 'say' in e)).toHaveLength(rec.expect.sentences);
    expect(r.events.flatMap((e) => (e['control'] !== undefined ? [e['control']] : []))).toEqual(rec.expect.control);
  });

  it('the events are the ones the teacher\'s own replay gives (the server adds and drops nothing)', async () => {
    const { r } = await serve();
    const app = createHeadlessApp({ mode: rec.mode });
    const own: TurnEvent[] = [];
    for await (const ev of liveTurn({ client: fakeModel(rec.replies), app, text: rec.request, now: () => 0 })) own.push(ev);
    expect(r.events).toEqual(JSON.parse(JSON.stringify(own)));
  });

  it('no line in a lesson was refused on the server\'s copy: every line the model wrote was sent', async () => {
    const { r } = await serve();
    const sent = r.events.flatMap((e) => (Array.isArray(e['lines']) ? (e['lines'] as string[]) : []));
    const written = rec.replies.flatMap((x) => (x.toolCalls ?? []).flatMap((c) => (c.name === 'draw' ? (c.args as { lines: string[] }).lines : [])));
    for (const line of written) expect(sent).toContain(line);
  });
});
