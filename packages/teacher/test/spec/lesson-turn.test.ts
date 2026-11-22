/**
 * Lesson round 1, `lessonTurn` over a board target with `fakeModel` (docs/features/lesson/design.md 3, 4, 5, 7;
 * agent.md 1; requirements R2, R3; plan round 1 item 5; TR-9, TR-38, TR-49). Public exports only; no network.
 */
import { describe, expect, it } from 'vitest';
import { INTERRUPTED, TURN_LIMITS, fakeModel, isEndRequest, lessonTurn, memoryBlock, newMemory, recordInterrupted } from '../../src/index';
import type { ChatRequest, TurnEvent } from '../../src/index';
import { PAGE, modelItem } from './board-helpers';
import { PLAN_5, finalOf, lessonEvents, newPage, planReply, runLesson, sentActions, says, textReply, write } from './lesson-helpers';

const FIRST_TURN = [
  planReply('We will learn it in five steps: vectors, adding them, scaling, matrices as moves, and solving systems. ', PLAN_5, [newPage('Vectors'), write('A vector = a size + a direction', 40, 40)]),
  textReply('A vector is an arrow: how far, and which way. What do you think happens if I make it twice as long?'),
];

const toolNamesOf = (r: ChatRequest): string[] => r.tools.map((t) => t.name);
const allText = (r: ChatRequest): string => `${r.system}\n${r.messages.map((m) => m.content).join('\n')}`;

describe('the first turn: plan, say, write (design 3 and 1, agent.md 1 rule 1, snippet)', () => {
  it('says whole sentences: every say ends a sentence, and together they are what the teacher said', async () => {
    const { events } = await runLesson('Teach me about linear algebra', FIRST_TURN);
    const spoken = says(events);
    expect(spoken.length).toBeGreaterThanOrEqual(2);
    for (const s of spoken) expect(s, s).toMatch(/[.?!]$/);
    expect(spoken.join(' ')).toContain('We will learn it in five steps');
    expect(spoken.join(' ')).toContain('What do you think happens if I make it twice as long?');
  });

  it('a sentence is not cut in the middle by the pieces the model streamed', async () => {
    const pieces = ['We will learn it in fi', 've steps. A vec', 'tor is an arrow. Shall we ', 'go on?'];
    const { events } = await runLesson('Teach me about linear algebra', [{ pieces }]);
    expect(says(events)).toEqual(['We will learn it in five steps.', 'A vector is an arrow.', 'Shall we go on?']);
  });

  it('sends the board actions that passed, in one or more actions events', async () => {
    const { events } = await runLesson('Teach me about linear algebra', FIRST_TURN);
    const ops = sentActions(events).map((a) => a['op']);
    expect(ops).toEqual(['page', 'write']);
    expect(sentActions(events)[0]).toMatchObject({ op: 'page', to: 'new', name: 'Vectors' });
  });

  it('sends a lesson event { plan, step, state } when lesson_plan passed', async () => {
    const { events } = await runLesson('Teach me about linear algebra', FIRST_TURN);
    const lessons = lessonEvents(events);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ plan: PLAN_5, step: 1 });
    expect(lessons[0]?.state).toBe('teaching');
  });

  it('ends with exactly one final event, done, with no ended flag', async () => {
    const { events } = await runLesson('Teach me about linear algebra', FIRST_TURN);
    expect(events.filter((e) => 'done' in e || 'error' in e)).toHaveLength(1);
    const last = finalOf(events);
    expect(last).toEqual({ done: true });
  });

  it('writes the plan into the memory and records the turn as it was', async () => {
    const { memory } = await runLesson('Teach me about linear algebra', FIRST_TURN);
    expect(memory.plan).toEqual(PLAN_5);
    expect(memory.step).toBe(1);
    expect(memory.turns).toHaveLength(1);
    expect(memory.turns[0]?.learner).toBe('Teach me about linear algebra');
    expect(memory.turns[0]?.teacher).toContain('What do you think happens if I make it twice as long?');
  });

  it('the model is offered board_read, board, lesson_plan and lesson_step, and nothing that ends the lesson', async () => {
    const { model } = await runLesson('Teach me about linear algebra', FIRST_TURN);
    const names = toolNamesOf(model.requests[0] as ChatRequest);
    expect([...names].sort()).toEqual(['board', 'board_read', 'lesson_plan', 'lesson_step']);
  });

  it('a lesson with no plan yet tells the model so: lesson_plan is asked for in the first turn', async () => {
    const { model } = await runLesson('Teach me about linear algebra', FIRST_TURN);
    expect(allText(model.requests[0] as ChatRequest)).toContain('lesson_plan');
  });

  it('a plan that fails T001 (2 steps) sends no lesson event and the lesson goes on', async () => {
    const { events, memory } = await runLesson('Teach me about linear algebra', [planReply('Two steps. ', ['One', 'Two']), textReply('Let me try again. Shall we go on?')]);
    expect(lessonEvents(events)).toEqual([]);
    expect(memory.plan).toEqual([]);
    expect(finalOf(events)).toEqual({ done: true });
  });
});

describe('the memory comes back as the next turn\'s context (design 4, TR-9, TR-38)', () => {
  it('turn 2 sees turn 1: the learner\'s words and the teacher\'s sentences as history, the plan and the step in the system text', async () => {
    const first = await runLesson('Teach me about linear algebra', FIRST_TURN);
    const second = await runLesson('It gets bigger?', [textReply('Yes, its size doubles, and its direction stays. Shall we go on?')], { memory: first.memory });
    const request = second.model.requests[0] as ChatRequest;
    const text = allText(request);
    expect(text).toContain('Teach me about linear algebra');
    expect(text).toContain('What do you think happens if I make it twice as long?');
    for (const step of PLAN_5) expect(request.system).toContain(step);
    expect(request.system).toContain('LESSON MEMORY');
    expect(request.messages[request.messages.length - 1]?.content).toContain('It gets bigger?');
    expect(finalOf(second.events)).toEqual({ done: true });
  });

  it('the teacher\'s earlier words are sent as the assistant\'s own, not as the learner\'s material', async () => {
    const first = await runLesson('Teach me about linear algebra', FIRST_TURN);
    const second = await runLesson('Go on', [textReply('Next, adding vectors. Shall we go on?')], { memory: first.memory });
    const request = second.model.requests[0] as ChatRequest;
    const assistant = request.messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    expect(assistant.join(' ')).toContain('A vector is an arrow');
    const user = request.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(user.join(' ')).not.toContain('A vector is an arrow');
  });

  it('at most 6 turns are sent back: after 8 turns the first two are gone and the last six are there', async () => {
    const memory = newMemory();
    for (let i = 1; i <= 8; i++) await runLesson(`learner words number ${i}`, [textReply(`teacher words number ${i}.`)], { memory });
    expect(memory.turns).toHaveLength(6);
    const ninth = await runLesson('learner words number 9', [textReply('teacher words number 9.')], { memory });
    const text = (ninth.model.requests[0] as ChatRequest).messages.map((m) => m.content).join('\n');
    expect(text).not.toMatch(/learner words number 1\b/);
    expect(text).not.toMatch(/learner words number 2\b/);
    for (const n of [3, 4, 5, 6, 7, 8]) expect(text, `turn ${n}`).toContain(`learner words number ${n}`);
  });

  it('the summary and the hard notes a turn wrote reach the next turn\'s memory block', async () => {
    const first = await runLesson('Teach me about linear algebra', [
      { text: 'Good. ', toolCalls: [{ name: 'lesson_plan', args: { steps: PLAN_5 } }, { name: 'lesson_step', args: { to: 'next', summary: 'We met vectors and size.', hard: 'which way the arrow points' } }] },
      textReply('On to adding. Shall we go on?'),
    ]);
    expect(first.memory.step).toBe(2);
    expect(first.memory.summary).toBe('We met vectors and size.');
    const second = await runLesson('Go on', [textReply('Adding arrows. Ready?')], { memory: first.memory });
    const system = (second.model.requests[0] as ChatRequest).system;
    expect(system).toContain('We met vectors and size.');
    expect(system).toContain('which way the arrow points');
    expect(memoryBlock(first.memory)).toContain('We met vectors and size.');
  });

  it('lesson_step events carry the step to the learner\'s screen', async () => {
    const { events } = await runLesson('Go on', [
      { text: 'Next. ', toolCalls: [{ name: 'lesson_step', args: { to: 'next', summary: 'Done with vectors.' } }] },
      textReply('Now adding. Ready?'),
    ], { memory: (() => { const m = newMemory(); m.plan = [...PLAN_5]; m.step = 1; return m; })() });
    expect(lessonEvents(events).map((l) => l.step)).toEqual([2]);
  });

  // LR-3 (review-r1): a turn that was stopped is in the memory, so the next turn knows what the learner asked
  it('a turn whose signal was already aborted is in the memory: the learner\'s words and "(interrupted)" (LR-3)', async () => {
    const controller = new AbortController();
    controller.abort();
    const { memory } = await runLesson('Teach me about linear algebra', FIRST_TURN, { signal: controller.signal });
    expect(memory.turns).toEqual([{ learner: 'Teach me about linear algebra', teacher: INTERRUPTED }]);
    expect(INTERRUPTED).toBe('(interrupted)');
  });

  it('a stream the consumer closes after the first sentence keeps the learner\'s words and what was said so far, marked (interrupted) (LR-3)', async () => {
    const memory = newMemory();
    const model = fakeModel([textReply('A vector is an arrow. It has a size. And a direction. Shall we go on?')]);
    const events = lessonTurn({ client: model, memory, board: { page: PAGE, items: [], more: 0 }, text: 'What is a vector?', now: () => 0 })[Symbol.asyncIterator]();
    const first = await events.next();
    expect(first.value).toEqual({ say: 'A vector is an arrow.' });
    await events.return?.();
    expect(memory.turns).toEqual([{ learner: 'What is a vector?', teacher: `A vector is an arrow. ${INTERRUPTED}` }]);
  });

  it('a signal that fires in the middle is recorded at once, before the stream has seen it, so a newer turn already finds it (LR-3)', async () => {
    const memory = newMemory();
    const controller = new AbortController();
    const model = fakeModel([textReply('A vector is an arrow. It has a size. Shall we go on?')]);
    const events = lessonTurn({ client: model, memory, board: { page: PAGE, items: [], more: 0 }, text: 'What is a vector?', now: () => 0, signal: controller.signal })[Symbol.asyncIterator]();
    await events.next();
    controller.abort();
    expect(memory.turns).toEqual([{ learner: 'What is a vector?', teacher: `A vector is an arrow. ${INTERRUPTED}` }]);
    // the stream ends, and the turn is not recorded a second time
    for (let e = await events.next(); e.done !== true; e = await events.next()) void e;
    expect(memory.turns).toHaveLength(1);
  });

  it('the next turn is told what was asked and that the answer was cut short (LR-3)', async () => {
    const controller = new AbortController();
    controller.abort();
    const first = await runLesson('What is a vector?', FIRST_TURN, { signal: controller.signal });
    const second = await runLesson('Sorry, go on', [textReply('A vector is an arrow. Ready?')], { memory: first.memory });
    const request = second.model.requests[0] as ChatRequest;
    expect(request.messages.map((m) => m.content).join('\n')).toContain('What is a vector?');
    expect(request.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join(' ')).toContain(INTERRUPTED);
  });

  it('a long answer cut short keeps the mark: what was said is cut, "(interrupted)" is not', () => {
    const memory = newMemory();
    recordInterrupted(memory, 'question', 'word '.repeat(400));
    const teacher = memory.turns[0]?.teacher ?? '';
    expect(teacher.length).toBeLessThanOrEqual(800);
    expect(teacher.endsWith(` ${INTERRUPTED}`)).toBe(true);
  });

  it('an end request is not recorded, whole or cut short: the lesson is over', async () => {
    const controller = new AbortController();
    controller.abort();
    const { memory } = await runLesson('stop the lesson', [textReply('Goodbye.')], { signal: controller.signal });
    expect(memory.turns).toEqual([]);
  });

  it('a turn that ends with an error is not recorded', async () => {
    const { memory, events } = await runLesson('Teach me about linear algebra', FIRST_TURN, { limits: { modelCalls: 1 } });
    expect(finalOf(events)).toHaveProperty('error');
    expect(memory.turns).toEqual([]);
  });
});

describe('a board action that passed is never sent twice in the answer (design 5, agent.md rule 8, TR-49)', () => {
  const A = write('Vector = size + direction', 40, 40);
  const B = write('2v: same direction, twice as long', 40, 100);

  it('the same action in a second board call is answered, not sent: it reaches the board once', async () => {
    const { events, model } = await runLesson('Teach me about vectors', [
      { text: 'A vector is an arrow. ', toolCalls: [{ name: 'board', args: { actions: [A] } }] },
      { toolCalls: [{ name: 'board', args: { actions: [A, B] } }] },
      textReply('Does that make sense?'),
    ]);
    const sent = sentActions(events);
    expect(sent.filter((a) => a['text'] === A.text)).toHaveLength(1);
    expect(sent.filter((a) => a['text'] === B.text)).toHaveLength(1);
    // the model is told, in the tool result, that the repeat did not go out
    const results = (model.requests[model.requests.length - 1] as ChatRequest).messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
    expect(results.toLowerCase()).toContain('already');
    expect(finalOf(events)).toEqual({ done: true });
  });

  it('the same action twice in one call is sent once', async () => {
    const { events } = await runLesson('Teach me about vectors', [{ text: 'Look. ', toolCalls: [{ name: 'board', args: { actions: [A, A] } }] }, textReply('Clear?')]);
    expect(sentActions(events).filter((a) => a['text'] === A.text)).toHaveLength(1);
  });

  it('the same action in the same call is also not sent twice when the key order differs', async () => {
    const same = { at: { y: 40, x: 40 }, style: 'typed', text: A.text, op: 'write' };
    const { events } = await runLesson('Teach me about vectors', [{ text: 'Look. ', toolCalls: [{ name: 'board', args: { actions: [A, same] } }] }, textReply('Clear?')]);
    expect(sentActions(events).filter((a) => a['text'] === A.text)).toHaveLength(1);
  });

  it('two different actions are both sent', async () => {
    const { events } = await runLesson('Teach me about vectors', [{ text: 'Look. ', toolCalls: [{ name: 'board', args: { actions: [A, B] } }] }, textReply('Clear?')]);
    expect(sentActions(events).map((a) => a['text'])).toEqual([A.text, B.text]);
  });

  it('a new turn is a new answer: the same note may be written in the next turn', async () => {
    const first = await runLesson('Teach me about vectors', [{ text: 'Look. ', toolCalls: [{ name: 'board', args: { actions: [A] } }] }, textReply('Clear?')]);
    const second = await runLesson('Again', [{ text: 'Again. ', toolCalls: [{ name: 'board', args: { actions: [A] } }] }, textReply('Clear?')], { memory: first.memory });
    expect(sentActions(second.events).filter((a) => a['text'] === A.text)).toHaveLength(1);
  });
});

describe('the learner ends the lesson (design 3 last row, design 7, plan item 5 and 7)', () => {
  const memory = () => {
    const m = newMemory('Linear algebra');
    m.plan = [...PLAN_5];
    m.step = 3;
    m.summary = 'We covered vectors and adding them.';
    return m;
  };

  it('"stop the lesson": the turn says a summary and goodbye, and done carries ended: true', async () => {
    const { events } = await runLesson('stop the lesson', [textReply('Well done. Today we covered vectors and adding them. We will start with scaling next time.')], { memory: memory() });
    expect(says(events).length).toBeGreaterThanOrEqual(2);
    expect(finalOf(events)).toEqual({ done: true, ended: true });
  });

  it('a turn that is not an end has no ended flag in done', async () => {
    const { events } = await runLesson('go on', [textReply('Next, scaling. Ready?')], { memory: memory() });
    const last = finalOf(events) as Extract<TurnEvent, { done: true }>;
    expect(last.done).toBe(true);
    expect('ended' in last).toBe(false);
  });

  it('the model has no tool that ends the lesson: only the learner does (design 5)', async () => {
    const normal = await runLesson('go on', [textReply('Next. Ready?')], { memory: memory() });
    const ending = await runLesson('stop the lesson', [textReply('Goodbye. See you.')], { memory: memory() });
    for (const run of [normal, ending]) {
      for (const request of run.model.requests) {
        for (const name of toolNamesOf(request)) expect(name).not.toMatch(/end|stop|finish|quit/i);
      }
    }
  });

  it('the closing turn changes nothing on the board and moves no step', async () => {
    const m = memory();
    const { events } = await runLesson('stop the lesson', [textReply('Well done. Goodbye.')], { memory: m });
    expect(sentActions(events)).toEqual([]);
    expect(lessonEvents(events)).toEqual([]);
    expect(m.step).toBe(3);
  });

  it('the closing turn is told what the lesson covered: the plan and the summary are in its prompt', async () => {
    const { model } = await runLesson('stop the lesson', [textReply('Well done. Goodbye.')], { memory: memory() });
    const request = model.requests[0] as ChatRequest;
    expect(request.system).toContain('We covered vectors and adding them.');
    expect(request.system).toContain('Scaling');
  });

  it.each(['Stop', 'stop the lesson', 'Stop the lesson.', 'End the lesson', 'end the lesson!', "That's all", 'that is all', 'OK, stop the lesson', 'stop the lesson please'])('"%s" asks to end the lesson', (text) => {
    expect(isEndRequest(text)).toBe(true);
  });

  it.each(['I don\'t get it', 'go on', 'next', 'again', 'What is a vector?', 'What does a stop sign have to do with vectors?', 'Why does the lesson end with a matrix?', 'Change the plan', 'skip this', ''])('"%s" does not end the lesson', (text) => {
    expect(isEndRequest(text)).toBe(false);
  });
});

describe('a turn over a board with things on it (design 7: the board in view comes with the words)', () => {
  it('the items in view are in the model\'s first message', async () => {
    const { model } = await runLesson('What is this?', [textReply('A box. Shall we go on?')], { items: [modelItem('shape:m1', { kind: 'text', text: 'Vector = size + direction' })] });
    const last = (model.requests[0] as ChatRequest).messages.slice(-1)[0]?.content ?? '';
    expect(last).toContain('shape:m1');
    expect(last).toContain('Vector = size + direction');
  });

  it('a teacher reply of words only is a whole valid answer (talk ruling TR-28)', async () => {
    const { events } = await runLesson('Is it right?', [textReply('Yes, that is right. Shall we go on?')]);
    expect(says(events)).toEqual(['Yes, that is right.', 'Shall we go on?']);
    expect(finalOf(events)).toEqual({ done: true });
  });
});

describe('the turn limits of teacher design 6 hold in a lesson', () => {
  it('a model that never stops calling tools ends with turn_limit, as the other jobs do', async () => {
    const replies = Array.from({ length: TURN_LIMITS.modelCalls + 3 }, () => ({ toolCalls: [{ name: 'board_read', args: {} }] }));
    const { events } = await runLesson('Teach me', replies);
    const last = finalOf(events);
    expect('error' in last && last.error.kind).toBe('turn_limit');
  });
});
