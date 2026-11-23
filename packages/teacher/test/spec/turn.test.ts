/**
 * The turn loop (teacher design 6, errors.md, requirements R4): events, limits, the retry budget, the failure streak,
 * stop, and the errors that end a turn. Every turn runs over `fakeModel` or a small hand-made `ModelClient`; no network.
 */
import { describe, expect, it } from 'vitest';
import { RETRY_FAILURES, STREAK_LIMIT, TURN_LIMITS, fakeModel, runTurn } from '../../src/index';
import type { ChatEvent, ChatRequest, ModelClient, TurnEvent } from '../../src/index';
import { collect, countingTarget, drawReply, drawnLines, isDone, isError, isLines, isSay, lastOf, makeClock, makeRig, namesOn, tools, toolMessages, turnOver, wrapClient } from './helpers';

/** The events after the last final one: a turn sends exactly one final event, and it is the last. */
function expectOneFinal(events: readonly TurnEvent[]): void {
  const finals = events.filter((e) => isDone(e) || isError(e));
  expect(finals).toHaveLength(1);
  const last = lastOf(events);
  expect(isDone(last) || isError(last)).toBe(true);
}

/** Resolves when `signal` is aborted (at once when it already is). */
const untilAborted = (signal: AbortSignal): Promise<void> =>
  signal.aborted ? Promise.resolve() : new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));

describe('a plain turn (design 6)', () => {
  it('text only: say events, then done', async () => {
    const { events } = await turnOver([{ pieces: ['Hello', ' there.'] }]);
    expect(events.filter(isSay).map((e) => e.say).join('')).toBe('Hello there.');
    expect(lastOf(events)).toEqual({ done: true });
    expectOneFinal(events);
  });

  it('a spoken sentence and a draw call: say first, then the lines that were drawn, then the next reply, then done', async () => {
    const { events, rig, model } = await turnOver([drawReply(['c = Circle((0, 0), 2)'], 'Take a circle of radius 2.'), { text: 'There it is.' }]);
    const kinds = events.map((e) => Object.keys(e)[0]);
    expect(kinds).toEqual(['say', 'lines', 'say', 'done']);
    expect(drawnLines(events)).toEqual(['c = Circle((0, 0), 2)']);
    expect(namesOn(rig.target)).toEqual(['c']);
    expect(model.used).toBe(2);
  });

  it('a lines event holds only the lines that passed', async () => {
    const { events } = await turnOver([drawReply(['a = 1', 'b = (', 'c = a + 1']), { text: 'ok' }], { mode: 'graphing' });
    expect(drawnLines(events)).toEqual(['a = 1', 'c = a + 1']);
  });

  it('a call whose lines all fail sends no lines event', async () => {
    const { events } = await turnOver([drawReply(['b = (']), { text: 'ok' }], { mode: 'graphing' });
    expect(events.some(isLines)).toBe(false);
  });

  it('say events all come before the reply\'s tool calls run (R4.2)', async () => {
    const { events } = await turnOver([{ pieces: ['One ', 'sentence.'], toolCalls: [{ name: 'draw', args: { lines: ['a = 1'] } }] }, { text: 'Done.' }], { mode: 'graphing' });
    const firstLines = events.findIndex(isLines);
    const sayBefore = events.slice(0, firstLines).filter(isSay).map((e) => e.say).join('');
    expect(sayBefore).toBe('One sentence.');
  });

  it('speech starts before the reply ends: a say event is out while the model is still talking', async () => {
    const state = { seen: undefined as (() => void) | undefined };
    const seen = new Promise<void>((resolve) => {
      state.seen = resolve;
    });
    const client: ModelClient = {
      async *chat(): AsyncGenerator<ChatEvent> {
        yield { text: 'Take a circle.' };
        const arrived = await Promise.race([seen.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 800))]);
        if (!arrived) {
          yield { error: { ok: false, kind: 'model_timeout', message: 'the loop held the say event back' } };
          return;
        }
        yield { toolCall: { id: 'c1', name: 'draw', args: JSON.stringify({ lines: ['a = 1'] }) } };
        yield { done: { model: 'x', inputTokens: 0, outputTokens: 0 } };
      },
    };
    const rig = makeRig('graphing');
    const events: TurnEvent[] = [];
    let call = 0;
    const client2: ModelClient = {
      chat: (request, signal) => {
        call += 1;
        return call === 1 ? client.chat(request, signal) : fakeModel([{ text: 'ok' }]).chat(request, signal);
      },
    };
    for await (const e of runTurn({ job: 'live', client: client2, toolset: tools(), target: rig.target, request: { text: 'x' }, now: () => 0 })) {
      events.push(e);
      if (isSay(e)) state.seen?.();
    }
    expect(events.some(isError)).toBe(false);
    expect(namesOn(rig.target)).toEqual(['a']);
  });

  it('the messages of the next call are: the assistant reply with its calls, then one tool message per call in call order', async () => {
    const { model } = await turnOver(
      [
        { text: 'Two things.', toolCalls: [{ id: 'k1', name: 'draw', args: { lines: ['a = 1'] } }, { id: 'k2', name: 'figure', args: {} }] },
        { text: 'ok' },
      ],
      { mode: 'graphing' },
    );
    const second = model.requests[1] as ChatRequest;
    const roles = second.messages.map((m) => m.role);
    expect(roles.slice(0, 4)).toEqual(['user', 'assistant', 'tool', 'tool']);
    const assistant = second.messages[1];
    expect(assistant?.role === 'assistant' && assistant.toolCalls?.map((c) => c.id)).toEqual(['k1', 'k2']);
    expect(toolMessages(second).map((m) => [m.toolCallId, m.name])).toEqual([['k1', 'draw'], ['k2', 'figure']]);
    expect(roles).toHaveLength(4);
  });

  it('every model call is offered the toolset', async () => {
    const { model } = await turnOver([drawReply(['a = 1']), { text: 'ok' }], { mode: 'graphing' });
    for (const r of model.requests) expect(r.tools.map((t) => t.name)).toEqual(['draw', 'figure']);
  });

  it('an unknown tool is answered with tool_unknown in the result, and the turn goes on', async () => {
    const { model, events } = await turnOver([{ toolCalls: [{ id: 'u1', name: 'erase', args: {} }] }, { text: 'ok' }]);
    const content = toolMessages(model.requests[1] as ChatRequest)[0]?.content ?? '';
    expect(content).toMatch(/tool_unknown|There is no tool erase/);
    expect(lastOf(events)).toEqual({ done: true });
  });

  it('a call with arguments that are not JSON is answered with tool_input, and the turn goes on', async () => {
    const { model, events } = await turnOver([{ toolCalls: [{ id: 'u1', name: 'draw', args: '{"lines": ["a = 1"' }] }, { text: 'ok' }], { mode: 'graphing' });
    expect(toolMessages(model.requests[1] as ChatRequest)[0]?.content ?? '').toMatch(/tool_input|draw needs/);
    expect(lastOf(events)).toEqual({ done: true });
  });

  it('the same recording gives the same events twice (no unseeded randomness)', async () => {
    const replies = [drawReply(['c = Circle((0, 0), 2)', 'P = PointOn(c)'], 'Look.'), { text: 'Done.' }];
    const one = await turnOver(replies);
    const two = await turnOver(replies);
    expect(JSON.stringify(two.events)).toBe(JSON.stringify(one.events));
  });
});

describe('after a failing call the next call is told what did not draw (design 6)', () => {
  it('adds one line naming the object that did not draw', async () => {
    const { model } = await turnOver([drawReply(['zq = nothing_here(1)']), { text: 'ok' }], { mode: 'graphing' });
    const last = (model.requests[1] as ChatRequest).messages.at(-1);
    expect(last?.role).toBe('user');
    expect(last?.content).toContain('zq');
  });

  it('adds nothing when every line drew', async () => {
    const { model } = await turnOver([drawReply(['a = 1']), { text: 'ok' }], { mode: 'graphing' });
    expect((model.requests[1] as ChatRequest).messages.at(-1)?.role).toBe('tool');
  });

  it('the model is not handed an error kind to speak: the line is plain and says to say only what was drawn (errors design 6 rule 8)', async () => {
    const { model } = await turnOver([drawReply(['zq = nothing_here(1)']), { text: 'ok' }], { mode: 'graphing' });
    const last = (model.requests[1] as ChatRequest).messages.at(-1);
    expect(last?.content).not.toMatch(/unknown_name|retry_spent|fingerprint/);
  });
});

describe('limits (R4.1, design 6, T003)', () => {
  it('the limits are 8 model calls, 24 tool calls and 60 s', () => {
    expect(TURN_LIMITS).toEqual({ modelCalls: 8, toolCalls: 24, ms: 60_000 });
  });

  it('the 9th model call is not made: turn_limit, and what was drawn stays', async () => {
    const replies = Array.from({ length: 12 }, (_, i) => drawReply([`v${i} = ${i}`]));
    const { events, model, rig } = await turnOver(replies, { mode: 'graphing' });
    expect(model.used).toBe(8);
    expect(namesOn(rig.target)).toHaveLength(8);
    const last = lastOf(events);
    expect(isError(last) && last.error).toMatchObject({ ok: false, kind: 'turn_limit' });
    expect(isError(last) && last.error.message).toMatch(/^This answer stopped after .*8.*\.$/);
    expectOneFinal(events);
  });

  it('a turn of exactly 8 model calls is fine', async () => {
    const replies = [...Array.from({ length: 7 }, (_, i) => drawReply([`v${i} = ${i}`])), { text: 'Done.' }];
    const { events, model } = await turnOver(replies, { mode: 'graphing' });
    expect(model.used).toBe(8);
    expect(lastOf(events)).toEqual({ done: true });
  });

  it('the 25th tool call is not run: turn_limit, and the 24 before it stay', async () => {
    const calls = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, name: 'draw', args: { lines: [`w${i} = ${i}`] } }));
    const { events, rig } = await turnOver([{ toolCalls: calls }, { text: 'never' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toHaveLength(24);
    const last = lastOf(events);
    expect(isError(last) && last.error).toMatchObject({ kind: 'turn_limit' });
    expect(isError(last) && last.error.message).toMatch(/24/);
    expectOneFinal(events);
  });

  it('exactly 24 tool calls are fine', async () => {
    const calls = Array.from({ length: 24 }, (_, i) => ({ id: `t${i}`, name: 'draw', args: { lines: [`w${i} = ${i}`] } }));
    const { events, rig } = await turnOver([{ toolCalls: calls }, { text: 'Done.' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toHaveLength(24);
    expect(lastOf(events)).toEqual({ done: true });
  });

  it('tool calls count across model calls', async () => {
    const batch = (n: number): ReturnType<typeof drawReply> => ({ toolCalls: Array.from({ length: 5 }, (_, i) => ({ id: `b${n}_${i}`, name: 'figure', args: {} })) });
    const { events, model } = await turnOver([batch(1), batch(2), batch(3), batch(4), batch(5), { text: 'x' }], { mode: 'graphing' });
    const last = lastOf(events);
    expect(isError(last) && last.error.kind).toBe('turn_limit');
    expect(model.used).toBe(5);
  });

  it('60 s on the caller\'s clock: the next model call is not made, turn_limit, what was drawn stays', async () => {
    const clock = makeClock(1_000_000);
    const rig = makeRig('graphing');
    const model = fakeModel([drawReply(['a = 1']), drawReply(['b = 2']), { text: 'never' }]);
    const client = wrapClient(model, (n) => {
      if (n === 1) clock.advance(61_000);
    });
    const events = await collect(runTurn({ job: 'live', client, toolset: tools(), target: rig.target, request: { text: 'x' }, now: clock.now }));
    expect(model.used).toBe(1);
    expect(namesOn(rig.target)).toEqual(['a']);
    const last = lastOf(events);
    expect(isError(last) && last.error).toMatchObject({ kind: 'turn_limit' });
    expect(isError(last) && last.error.message).toMatch(/60 s/);
  });

  it('59 s is within the limit', async () => {
    const clock = makeClock(5);
    const rig = makeRig('graphing');
    const model = fakeModel([drawReply(['a = 1']), { text: 'Done.' }]);
    const client = wrapClient(model, (n) => {
      if (n === 1) clock.advance(59_000);
    });
    const events = await collect(runTurn({ job: 'live', client, toolset: tools(), target: rig.target, request: { text: 'x' }, now: clock.now }));
    expect(lastOf(events)).toEqual({ done: true });
  });

  it('time is read only from now(): a clock that never moves never limits a turn', async () => {
    const { events } = await turnOver([drawReply(['a = 1']), drawReply(['b = 2']), { text: 'ok' }], { mode: 'graphing', now: () => 42 });
    expect(lastOf(events)).toEqual({ done: true });
  });

  it('limits may be lowered by the caller', async () => {
    const { events, model } = await turnOver([drawReply(['a = 1']), drawReply(['b = 2']), { text: 'x' }], { mode: 'graphing', limits: { modelCalls: 2 } });
    expect(model.used).toBe(2);
    const last = lastOf(events);
    expect(isError(last) && last.error.kind).toBe('turn_limit');
  });
});

describe('the retry budget (R4.3, errors design 6 rule 3, T005)', () => {
  it('a line is retried at most twice: the fourth attempt at one object is not run', async () => {
    // four different kinds of failure, so the failure streak (three of one kind) does not interfere
    const replies = [drawReply(['P = zzz(1)']), drawReply(['P = (']), drawReply(['P = qqq + 1']), drawReply(['P = (1, 2, 3, 4']), { text: 'ok' }];
    const rig = makeRig('graphing');
    const { target, runs } = countingTarget(rig.target);
    const { events, model } = await turnOver(replies, { target });
    const attempts = runs.filter((r) => r.some((l) => l.startsWith('P ='))).length;
    expect(attempts).toBeLessThanOrEqual(1 + 2);
    const fourth = toolMessages(model.requests[4] as ChatRequest).at(-1)?.content ?? '';
    expect(fourth).toMatch(/retry_spent|left out after two tries/);
    const last = lastOf(events);
    expect(isDone(last) && last.notices).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'retry_spent', code: 'T005' })]));
  });

  it('the same text with the same fingerprint again and again is stopped, and reported as a notice, not an error', async () => {
    const same = drawReply(['P = zzz(1)']);
    const { events, model } = await turnOver([same, same, same, same, same, { text: 'ok' }], { mode: 'graphing' });
    const last = lastOf(events);
    expect(isDone(last)).toBe(true);
    expect(isDone(last) && last.notices?.some((n) => n.kind === 'retry_spent')).toBe(true);
    expect(events.some(isError)).toBe(false);
    expect(model.used).toBe(6);
  });

  it('the same text failing with the same fingerprint twice is spent: it is run at most twice (errors.md T005 "or with the same fingerprint twice")', async () => {
    const same = drawReply(['P = zzz(1)']);
    const rig = makeRig('graphing');
    const { target, runs } = countingTarget(rig.target);
    await turnOver([same, same, same, same, same, { text: 'ok' }], { target });
    expect(runs.filter((r) => r.includes('P = zzz(1)')).length).toBeLessThanOrEqual(2);
  });

  it('the notice says what was left out', async () => {
    const same = drawReply(['P = zzz(1)']);
    const { events } = await turnOver([same, same, same, same, { text: 'ok' }], { mode: 'graphing' });
    const last = lastOf(events);
    const notice = isDone(last) ? last.notices?.find((n) => n.kind === 'retry_spent') : undefined;
    expect(notice?.message).toMatch(/P was left out after two tries\./);
  });

  it('a line that passes on a retry leaves no notice', async () => {
    const { events, rig } = await turnOver([drawReply(['P = zzz(1)']), drawReply(['P = (1, 2)']), { text: 'ok' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toEqual(['P']);
    const last = lastOf(events);
    expect(isDone(last) && last.notices).toBeFalsy();
  });

  it('other lines in the same call still run when one line is spent', async () => {
    const bad = (extra: string): ReturnType<typeof drawReply> => drawReply(['P = zzz(1)', extra]);
    const { rig } = await turnOver([bad('a = 1'), bad('b = 2'), bad('c = 3'), bad('d = 4'), { text: 'ok' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the budget numbers are the documented ones', () => {
    expect(RETRY_FAILURES).toBe(3);
  });
});

describe('three failures of one kind in a row (R4.4, errors design 6 rule 10)', () => {
  const bad = (n: number): ReturnType<typeof drawReply> => drawReply([`q${n} = nothing${n}(1)`]);

  it('the next draw is answered with the figure and is not run', async () => {
    const { model, rig, events } = await turnOver([bad(1), bad(2), bad(3), drawReply(['d = 1']), { text: 'ok' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toEqual([]);
    const content = toolMessages(model.requests[4] as ChatRequest).at(-1)?.content ?? '';
    expect(content).toContain('objects');
    expect(lastOf(events)).toEqual({ done: true });
  });

  it('three bad lines in one call count the same as three calls', async () => {
    const { rig, model } = await turnOver([drawReply(['q1 = nothing1(1)', 'q2 = nothing2(1)', 'q3 = nothing3(1)']), drawReply(['d = 1']), { text: 'ok' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toEqual([]);
    expect(toolMessages(model.requests[2] as ChatRequest).at(-1)?.content ?? '').toContain('objects');
  });

  it('a line that passes in between resets the count', async () => {
    const { rig } = await turnOver([bad(1), bad(2), drawReply(['ok1 = 1']), bad(3), drawReply(['d = 1']), { text: 'ok' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toEqual(['d', 'ok1']);
  });

  it('failures of different kinds do not add up', async () => {
    const { rig } = await turnOver([bad(1), drawReply(['e1 = (']), bad(2), drawReply(['d = 1']), { text: 'ok' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toEqual(['d']);
  });

  it('after the figure was given, drawing goes on', async () => {
    const { rig } = await turnOver([bad(1), bad(2), bad(3), drawReply(['d = 1']), drawReply(['d = 1']), { text: 'ok' }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toEqual(['d']);
  });

  it('the streak is three', () => {
    expect(STREAK_LIMIT).toBe(3);
  });
});

describe('stop (R4.5, design 6)', () => {
  it('an abort before the start ends the turn with a final done and no model call', async () => {
    const controller = new AbortController();
    controller.abort();
    const { events, model } = await turnOver([drawReply(['a = 1']), { text: 'x' }], { mode: 'graphing', signal: controller.signal });
    expect(lastOf(events)).toEqual({ done: true });
    expect(events.some(isLines)).toBe(false);
    expect(model.used).toBe(0);
  });

  it('an abort after the first draw stops the turn at once and keeps what was applied', async () => {
    const controller = new AbortController();
    const rig = makeRig('graphing');
    const model = fakeModel([drawReply(['a = 1']), drawReply(['b = 2']), { text: 'x' }]);
    const events: TurnEvent[] = [];
    for await (const e of runTurn({ job: 'live', client: model, toolset: tools(), target: rig.target, request: { text: 'x' }, signal: controller.signal, now: () => 0 })) {
      events.push(e);
      if (isLines(e)) controller.abort();
    }
    expect(model.used).toBe(1);
    expect(namesOn(rig.target)).toEqual(['a']);
    expect(lastOf(events)).toEqual({ done: true });
    expectOneFinal(events);
  });

  it('an abort while the model is still talking ends the turn without waiting for it', async () => {
    const client: ModelClient = {
      async *chat(_request, signal): AsyncGenerator<ChatEvent> {
        yield { text: 'Hmm' };
        await untilAborted(signal);
      },
    };
    const controller = new AbortController();
    const rig = makeRig('graphing');
    const events: TurnEvent[] = [];
    for await (const e of runTurn({ job: 'live', client, toolset: tools(), target: rig.target, request: { text: 'x' }, signal: controller.signal, now: () => 0 })) {
      events.push(e);
      if (isSay(e)) controller.abort();
    }
    expect(lastOf(events)).toEqual({ done: true });
  }, 2000);

  it('a tool call that arrives after the abort is not run', async () => {
    const client: ModelClient = {
      async *chat(_request, signal): AsyncGenerator<ChatEvent> {
        yield { text: 'Hmm' };
        await untilAborted(signal);
        yield { toolCall: { id: 'late', name: 'draw', args: JSON.stringify({ lines: ['z = 1'] }) } };
        yield { done: { model: 'x', inputTokens: 0, outputTokens: 0 } };
      },
    };
    const controller = new AbortController();
    const rig = makeRig('graphing');
    const events: TurnEvent[] = [];
    for await (const e of runTurn({ job: 'live', client, toolset: tools(), target: rig.target, request: { text: 'x' }, signal: controller.signal, now: () => 0 })) {
      events.push(e);
      if (isSay(e)) controller.abort();
    }
    expect(namesOn(rig.target)).toEqual([]);
    expect(events.some(isLines)).toBe(false);
    expect(lastOf(events)).toEqual({ done: true });
  }, 2000);

  it('the target is free after a stop', async () => {
    const controller = new AbortController();
    const rig = makeRig('graphing');
    const model = fakeModel([drawReply(['a = 1']), { text: 'x' }]);
    for await (const e of runTurn({ job: 'live', client: model, toolset: tools(), target: rig.target, request: { text: 'x' }, signal: controller.signal, now: () => 0 })) {
      if (isLines(e)) controller.abort();
    }
    expect(rig.target.guard.busy).toBe(false);
  });
});

describe('errors that end a turn, and notices (errors.md, R7)', () => {
  it('a model error ends the turn with that error in the SDK shape, and what was drawn stays', async () => {
    const error = { ok: false as const, kind: 'model_busy', message: 'The AI is busy; try again in 5 s.', detail: { retryAfterMs: 5000 } };
    const { events, rig } = await turnOver([drawReply(['a = 1']), { error }], { mode: 'graphing' });
    const last = lastOf(events);
    expect(isError(last) && last.error).toEqual(error);
    expect(namesOn(rig.target)).toEqual(['a']);
    expectOneFinal(events);
  });

  it('a model error before anything: one error event, no lines', async () => {
    const error = { ok: false as const, kind: 'model_unavailable', message: 'The AI is not set up.' };
    const { events } = await turnOver([{ error }]);
    expect(events).toEqual([{ error }]);
  });

  it('a reply cut partway (stream_cut) ends the turn as done with a stream_cut notice and keeps the lines', async () => {
    const error = { ok: false as const, kind: 'stream_cut', message: 'cut' };
    const { events, rig } = await turnOver([{ toolCalls: [{ name: 'draw', args: { lines: ['a = 1'] } }], error }], { mode: 'graphing' });
    expect(namesOn(rig.target)).toEqual(['a']);
    const last = lastOf(events);
    expect(isDone(last)).toBe(true);
    expect(isDone(last) && last.notices).toEqual([expect.objectContaining({ kind: 'stream_cut', code: 'T006' })]);
    expect(isDone(last) && last.notices?.[0]?.message).toMatch(/The answer stopped partway; \d+ line\(s\) were drawn\./);
    expect(events.some(isError)).toBe(false);
  });

  it('nothing throws out of the loop when the client throws', async () => {
    const throwing: ModelClient = {
      chat() {
        throw new Error('boom: sk-secret');
      },
    };
    const rig = makeRig('graphing');
    const events = await collect(runTurn({ job: 'live', client: throwing, toolset: tools(), target: rig.target, request: { text: 'x' }, now: () => 0 }));
    const last = lastOf(events);
    expect(isError(last) && last.error).toMatchObject({ ok: false, kind: 'internal' });
    expect(JSON.stringify(events)).not.toContain('sk-secret');
    expectOneFinal(events);
  });

  it('nothing throws out of the loop when the stream throws midway', async () => {
    const throwing: ModelClient = {
      async *chat(): AsyncGenerator<ChatEvent> {
        yield { text: 'Hi' };
        throw new Error('network down');
      },
    };
    const rig = makeRig('graphing');
    const events = await collect(runTurn({ job: 'live', client: throwing, toolset: tools(), target: rig.target, request: { text: 'x' }, now: () => 0 }));
    expect(events.some(isSay)).toBe(true);
    expectOneFinal(events);
  });

  it('a host tool that throws is an error result and the turn goes on', async () => {
    const { toolset: build, defineTool } = await import('../../src/index');
    const boom = defineTool({
      name: 'boom',
      description: 'Fails inside.',
      schema: { type: 'object' },
      body: () => {
        throw new Error('inside');
      },
    });
    const set = build(['draw'], [boom]);
    if (!set.ok) throw new Error('toolset');
    const rig = makeRig('graphing');
    const model = fakeModel([{ toolCalls: [{ name: 'boom', args: {} }] }, { text: 'ok' }]);
    const events = await collect(runTurn({ job: 'live', client: model, toolset: set.value, target: rig.target, request: { text: 'x' }, now: () => 0 }));
    expect(lastOf(events)).toEqual({ done: true });
    expect(rig.target.guard.busy).toBe(false);
  });

  it('every turn ends with exactly one final event', async () => {
    const scenarios = [
      [{ text: 'hi' }],
      [drawReply(['a = 1']), { text: 'ok' }],
      [drawReply(['b = (']), drawReply(['b = (']), drawReply(['b = (']), drawReply(['b = (']), { text: 'ok' }],
      [{ toolCalls: [{ name: 'nope', args: {} }] }, { text: 'ok' }],
      Array.from({ length: 10 }, (_, i) => drawReply([`v${i} = ${i}`])),
    ];
    for (const replies of scenarios) expectOneFinal((await turnOver(replies, { mode: 'graphing' })).events);
  });
});

describe('fakeModel (design 11, server design 4)', () => {
  it('replays replies in order and records every request', async () => {
    const model = fakeModel([{ text: 'one' }, { text: 'two' }]);
    const signal = new AbortController().signal;
    const first = await collect(model.chat({ system: 's', messages: [], tools: [] }, signal));
    const second = await collect(model.chat({ system: 't', messages: [], tools: [] }, signal));
    expect(first[0]).toEqual({ text: 'one' });
    expect(second[0]).toEqual({ text: 'two' });
    expect(model.requests.map((r) => r.system)).toEqual(['s', 't']);
    expect(model.used).toBe(2);
  });

  it('gives a tool call with complete arguments as JSON text, with an id', async () => {
    const model = fakeModel({ replies: [{ toolCalls: [{ name: 'draw', args: { lines: ['a = 1'] } }] }] });
    const events = await collect(model.chat({ system: '', messages: [], tools: [] }, new AbortController().signal));
    const call = events.find((e): e is Extract<ChatEvent, { toolCall: unknown }> => 'toolCall' in e);
    expect(call?.toolCall.name).toBe('draw');
    expect(JSON.parse(call?.toolCall.args ?? '')).toEqual({ lines: ['a = 1'] });
    expect(call?.toolCall.id.length).toBeGreaterThan(0);
  });

  it('ends a reply with a done event that has the model and token counts', async () => {
    const events = await collect(fakeModel([{ text: 'x' }]).chat({ system: '', messages: [], tools: [] }, new AbortController().signal));
    const done = events.at(-1);
    expect(done && 'done' in done && Object.keys(done.done).sort()).toEqual(['inputTokens', 'model', 'outputTokens']);
  });

  it('stops sending when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(fakeModel([{ pieces: ['a', 'b'] }]).chat({ system: '', messages: [], tools: [] }, controller.signal));
    expect(events).toEqual([]);
  });

  it('opens no socket: a turn needs no network (R1.2)', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('the network was used');
    }) as typeof fetch;
    try {
      const { events } = await turnOver([drawReply(['a = 1']), { text: 'ok' }], { mode: 'graphing' });
      expect(lastOf(events)).toEqual({ done: true });
    } finally {
      globalThis.fetch = saved;
    }
  });
});
