/**
 * Round 4, the three acceptance lessons (teacher design 11, requirements R8.2; core design 12): a pendulum, the area under a
 * curve and a fire. Each is a recorded turn in `test/fixtures/` that the live job replays with `fakeModel`; the figure it
 * leaves is checked by its objects. The numbers to check come from each recording's `expect` record (design 11 names what it
 * holds: the objects, the value `show_me` sets, how many sentences are spoken, the film controls that go out).
 * With a real model these run as an opt-in smoke test (round 5); here no network is used.
 */
import { readFileSync } from 'node:fs';
import { createHeadlessApp } from '@incantly/sdk';
import { describe, expect, it } from 'vitest';
import { fakeModel, liveTarget, liveTurn } from '../../src/index';
import type { RecordedReply, TurnEvent } from '../../src/index';
import { collect, isDone, isError, isLines, isSay, lastOf } from './helpers';

type Mode = NonNullable<NonNullable<Parameters<typeof createHeadlessApp>[0]>['mode']>;

interface Recorded {
  readonly lesson: string;
  readonly mode: Mode;
  readonly request: string;
  readonly expect: {
    readonly objects: readonly string[];
    readonly values: Readonly<Record<string, number>>;
    readonly sentences: number;
    readonly control: readonly { readonly op: string; readonly t?: number }[];
  };
  readonly replies: readonly RecordedReply[];
}

const load = (name: string): Recorded => JSON.parse(readFileSync(new URL(`../fixtures/lesson-${name}.json`, import.meta.url), 'utf8')) as Recorded;

async function replay(rec: Recorded): Promise<{ events: TurnEvent[]; app: ReturnType<typeof createHeadlessApp>; model: ReturnType<typeof fakeModel> }> {
  const app = createHeadlessApp({ mode: rec.mode });
  const model = fakeModel(rec.replies);
  const events = await collect(liveTurn({ client: model, app, text: rec.request, now: () => 0 }));
  return { events, app, model };
}

describe.each(['pendulum', 'area', 'fire'])('acceptance lesson: %s (R8.2)', (name) => {
  const rec = load(name);

  it('the recording is a lesson: a request, a mode, replies and an expect record', () => {
    expect(rec.lesson.startsWith(name)).toBe(true);
    expect(rec.request.length).toBeGreaterThan(10);
    expect(rec.replies.length).toBeGreaterThanOrEqual(3);
    expect(rec.expect.objects.length).toBeGreaterThan(2);
    expect(rec.expect.sentences).toBeGreaterThan(3);
  });

  it('the turn ends with done: no error, no turn_limit, no notice, and every reply was used', async () => {
    const { events, model } = await replay(rec);
    const last = lastOf(events);
    expect(isError(last)).toBe(false);
    expect(last).toEqual({ done: true });
    expect(model.used).toBe(rec.replies.length);
  });

  it('the figure ends with exactly the expected objects', async () => {
    const { app } = await replay(rec);
    const names = liveTarget(app, undefined).objects().list.map((o) => o.name).sort();
    expect(names).toEqual([...rec.expect.objects].sort());
  });

  it('the value show_me sets is on the figure, and no object is undefined', async () => {
    const { app } = await replay(rec);
    const target = liveTarget(app, undefined);
    for (const [object, value] of Object.entries(rec.expect.values)) {
      const found = target.objects().list.find((o) => o.name === object);
      expect(found, object).toBeDefined();
      expect(found?.summary ?? '', object).toContain(String(value));
    }
    expect(target.undefinedObjects()).toEqual([]);
  });

  it('every line the lesson sent passed on the figure: the lines events are exactly the lines of its draw calls that the kernel took', async () => {
    const { events } = await replay(rec);
    const sent = events.filter(isLines).flatMap((e) => e.lines);
    const drawn = rec.replies.flatMap((r) => (r.toolCalls ?? []).filter((c) => c.name === 'draw').flatMap((c) => ((c.args as { lines: string[] }).lines)));
    const shows = rec.replies.flatMap((r) => (r.toolCalls ?? []).filter((c) => c.name === 'show_me').map((c) => c.args as { name: string; value: number }));
    expect(sent.filter((l) => !l.startsWith('SetValue'))).toEqual(drawn);
    expect(sent.filter((l) => l.startsWith('SetValue'))).toEqual(shows.map((s) => `SetValue(${s.name}, ${s.value})`));
  });

  it('the sentences spoken are as many as the recording says, each whole and no longer than the voice takes (500)', async () => {
    const { events } = await replay(rec);
    const spoken = events.filter(isSay).map((e) => e.say);
    expect(spoken).toHaveLength(rec.expect.sentences);
    for (const s of spoken) {
      expect(s.length).toBeGreaterThan(3);
      expect(s.length).toBeLessThanOrEqual(500);
      expect(s).toMatch(/[.!?…]$/);
      expect(s).toBe(s.trim());
      expect(s).not.toMatch(/[`*#$]/);
    }
  });

  it('the words the model wrote are all spoken, in order', async () => {
    const { events } = await replay(rec);
    const written = rec.replies.map((r) => (r.pieces !== undefined ? r.pieces.join('') : (r.text ?? ''))).join(' ').replace(/\s+/g, ' ').trim();
    const spoken = events.filter(isSay).map((e) => e.say).join(' ').replace(/\s+/g, ' ').trim();
    expect(spoken).toBe(written);
  });

  it('the film controls that go out are the ones the recording expects, in order', async () => {
    const { events } = await replay(rec);
    const controls = events.flatMap((e) => ('control' in e ? [e.control] : []));
    expect(controls).toEqual(rec.expect.control);
  });

  it('a sentence comes before the lines it explains: the first event is a sentence', async () => {
    const { events } = await replay(rec);
    expect(isSay(events[0] as TurnEvent)).toBe(true);
    expect(events.some(isDone)).toBe(true);
  });

  it('every tool result the model was given says ok: nothing the lesson did failed', async () => {
    const { model } = await replay(rec);
    const results = model.requests.flatMap((r) => r.messages.filter((m) => m.role === 'tool').map((m) => (m as { content: string }).content));
    expect(results.length).toBeGreaterThan(0);
    for (const content of results) {
      expect(content).not.toMatch(/"ok":\s*false/);
      expect(content).not.toMatch(/tool_input|tool_unknown|tool_busy/);
    }
  });

  it('the figure is the same when the same lesson is replayed again (the replay is deterministic)', async () => {
    const a = await replay(rec);
    const b = await replay(rec);
    expect(a.app.toScript()).toBe(b.app.toScript());
    expect(a.events).toEqual(b.events);
  });
});

describe('what each lesson shows (core design 12)', () => {
  it('the pendulum has a pivot, a rod and a bob that moves with the swing equation, and the rod ends at 2.5', async () => {
    const { app } = await replay(load('pendulum'));
    const script = app.toScript();
    expect(script).toContain('Segment(pivot, bob)');
    expect(script).toMatch(/θ''/);
    expect(script).toMatch(/L = 2\.5/);
  });

  it('the area lesson ends with 40 rectangles under x squared, and the integral next to them', async () => {
    const { app } = await replay(load('area'));
    const script = app.toScript();
    expect(script).toMatch(/n = 40/);
    expect(script).toContain('Riemann');
    expect(script).toContain('Integral');
  });

  it('the fire lesson has a flame leaning with the draught, and pauses the film for the question', async () => {
    const rec = load('fire');
    const { app, events } = await replay(rec);
    expect(app.toScript()).toContain('Fire(');
    expect(app.toScript()).toMatch(/draught = 0\.6/);
    const kinds = events.map((e) => ('control' in e ? `control:${e.control.op}` : Object.keys(e)[0]));
    expect(kinds.indexOf('control:pause')).toBeLessThan(kinds.indexOf('control:resume'));
  });
});
