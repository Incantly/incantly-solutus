/**
 * Lesson round 1, the numbers of design 8: the server's work per turn before the model under 5 ms, and the memory per
 * lesson under 64 KB. The model is a fake; the real clock is used only to measure. The median of many runs is the number,
 * so one slow run (a garbage collection) does not decide it. No network.
 */
import { performance } from 'node:perf_hooks';
import type { AgentItem } from '@incantly/board/core';
import { lessonTurn, newMemory } from '@incantly/teacher';
import type { ChatEvent, ChatRequest, LessonMemory, ModelClient } from '@incantly/teacher';
import { describe, expect, it } from 'vitest';
import { LessonStore } from '../../src/index';
import type { Lesson } from '../../src/index';
import { says } from './board-helpers';
import { makeClock } from './helpers';
import { bootVoice, rawRequest } from './r4-helpers';

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

/** A memory with every part as full as the design lets it be. */
function fullMemory(): LessonMemory {
  const m = newMemory('T'.repeat(120));
  m.plan = Array.from({ length: 8 }, (_v, i) => `${i + 1}`.padEnd(80, 's'));
  m.step = 4;
  m.summary = 'S'.repeat(1200);
  m.hard = Array.from({ length: 10 }, (_v, i) => `${i}`.padEnd(80, 'h'));
  m.turns = Array.from({ length: 6 }, (_v, i) => ({ learner: `L${i}`.padEnd(800, 'l'), teacher: `T${i}`.padEnd(800, 't') }));
  return m;
}

const items = (n: number): AgentItem[] => Array.from({ length: n }, (_v, i) => ({ id: `shape:i${i}`, kind: 'text', box: [0, i * 40, 200, 30] as const, text: `Note number ${i} about vectors` }));

/** A model client that records when the first model call was asked for, and then answers with one sentence. */
function stampedClient(box: { at: number }): ModelClient {
  return {
    async *chat(_request: ChatRequest): AsyncGenerator<ChatEvent> {
      if (box.at === 0) box.at = performance.now();
      yield { text: 'Yes, that is right. Ready?' };
    },
  };
}

const postJson = async (port: number, path: string, body: unknown): Promise<string> => {
  const raw = await rawRequest(port, path, JSON.stringify(body), { 'content-type': 'application/json' });
  return Buffer.concat(raw.chunks).toString('utf8');
};

describe('the server\'s work per turn, before the model (design 8: under 5 ms)', () => {
  it('store check and begin, then the prompt over a full memory and 60 items, up to the first model call: median under 5 ms', async () => {
    const clock = makeClock();
    const store = new LessonStore(clock.now);
    const lesson = store.start('Linear algebra', 'graphing') as Lesson;
    Object.assign(lesson.memory, fullMemory());
    const times: number[] = [];
    for (let i = 0; i < 60; i++) {
      const box = { at: 0 };
      const t0 = performance.now();
      const found = store.check(lesson.id, 'a') as Lesson;
      const controller = new AbortController();
      const turn = store.begin(found, 'a', () => controller.abort());
      const events = lessonTurn({
        client: stampedClient(box),
        memory: lesson.memory,
        board: { page: 'page:1', items: items(60), more: 0 },
        text: 'What happens to the arrow if I double it?',
        now: () => performance.now(),
        signal: controller.signal,
      });
      for await (const ev of events) void ev;
      times.push(box.at - t0);
      store.finish(found, turn as number, false);
      clock.advance(1000);
    }
    expect(median(times)).toBeLessThan(5);
  });

  it('over HTTP: from the request leaving the client to the model call, median under 5 ms on the loopback', async () => {
    const stamps: number[] = [];
    const b = await bootVoice({
      env: { RATE_PER_MINUTE: '100000' },
      answers: () => {
        stamps.push(performance.now());
        return says('Yes. Ready?');
      },
    });
    const started = JSON.parse(await postJson(b.run.port, '/v1/lesson/start', { board: { items: [], more: 0, page: 'page:1' } })) as { lessonId: string };
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      await postJson(b.run.port, '/v1/lesson/turn', { lessonId: started.lessonId, text: `question ${i}`, board: { items: items(20), more: 0, page: 'page:1' } });
      times.push((stamps[stamps.length - 1] as number) - t0);
    }
    expect(stamps).toHaveLength(40);
    expect(median(times)).toBeLessThan(5);
  });
});

describe('the memory of a lesson (design 8: under 64 KB)', () => {
  it('a lesson with every part full is under 64 KB as data', () => {
    expect(Buffer.byteLength(JSON.stringify(fullMemory()))).toBeLessThan(64 * 1024);
  });

  it('300 lessons with full memories hold under 64 KB each on the heap', () => {
    const store = new LessonStore(makeClock().now, { limits: { held: 1000 } });
    const before = process.memoryUsage().heapUsed;
    const held: Lesson[] = [];
    for (let i = 0; i < 300; i++) {
      const lesson = store.start('Linear algebra', 'graphing') as Lesson;
      Object.assign(lesson.memory, fullMemory());
      held.push(lesson);
    }
    const per = (process.memoryUsage().heapUsed - before) / held.length;
    expect(held).toHaveLength(300);
    expect(per).toBeLessThan(64 * 1024);
  });
});
