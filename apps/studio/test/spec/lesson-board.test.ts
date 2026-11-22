/**
 * Lesson round 2, the board's side of the conversation (lesson design 6 "the board", docs/state-machines.md LE2 "The board",
 * plan Round 2 item 4): `boardConversation` over a real board, and the conversation over that target with a fake server.
 * `actions` events go through the board's agent runner, and one answer of the teacher is one undo step however many `actions`
 * events it sends. No network, no sound.
 */
import { createBoard } from '@incantly/board';
import type { Board, BoardView } from '@incantly/board';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LessonConversation } from '../../src/lesson';
import { boardConversation } from '../../src/voice-targets';
import { FakeAudio, FakeLessonServer, until } from './lesson-helpers';

let container: HTMLElement;
let board: Board;
let view: BoardView;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  const made = createBoard({ container, canvas2dOnly: true, agent: { reducedMotion: true } });
  if (!made.ok || made.value.view === undefined) throw new Error('no board');
  board = made.value;
  view = made.value.view;
});
afterEach(() => {
  board.dispose();
  container.remove();
});

const page = (): string => view.core.pages.current as string;
const shapeCount = (): number => view.core.store.shapesOn(page()).length;
const rect = (x: number): unknown => ({ op: 'shape', kind: 'rect', at: { x, y: 20 }, w: 80, h: 40 });
const undo = (): void => void view.core.history.undo('user');

describe('boardConversation: the board in view and one gesture for each answer', () => {
  it('board() is the runner\'s read of the board in view: its items, how many more there are, and the page', async () => {
    const target = boardConversation(view);
    target.begin();
    await target.actions([rect(10)]);
    target.finish(false);
    const read = view.agent.runner.read();
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(target.board()).toEqual({ items: read.value.items, more: read.value.more, page: read.value.page });
    expect(typeof target.board().page).toBe('string');
  });

  it('three actions calls of one answer make three shapes and ONE undo step', async () => {
    const target = boardConversation(view);
    target.begin();
    await target.actions([rect(10)]);
    await target.actions([rect(120)]);
    await target.actions([rect(230), rect(340)]);
    target.finish(false);
    expect(shapeCount()).toBe(4);
    undo();
    expect(shapeCount()).toBe(0);
  });

  it('two answers are two undo steps: undoing once takes back the second answer only', async () => {
    const target = boardConversation(view);
    target.begin();
    await target.actions([rect(10), rect(120)]);
    target.finish(false);
    target.begin();
    await target.actions([rect(230)]);
    await target.actions([rect(340)]);
    target.finish(false);
    expect(shapeCount()).toBe(4);
    undo();
    expect(shapeCount()).toBe(2);
    undo();
    expect(shapeCount()).toBe(0);
  });

  it('a stopped answer (barge-in) is committed as one step too: what was made stays, and one undo takes it back', async () => {
    const target = boardConversation(view);
    target.begin();
    await target.actions([rect(10)]);
    await target.actions([rect(120)]);
    target.finish(true);
    expect(shapeCount()).toBe(2);
    undo();
    expect(shapeCount()).toBe(0);
  });

  it('a new answer begun without the last one finished commits the last one first (no step is lost, none is merged)', async () => {
    const target = boardConversation(view);
    target.begin();
    await target.actions([rect(10)]);
    target.begin();
    await target.actions([rect(120)]);
    target.finish(false);
    expect(shapeCount()).toBe(2);
    undo();
    expect(shapeCount()).toBe(1);
    undo();
    expect(shapeCount()).toBe(0);
  });

  it('an answer that made nothing leaves nothing to undo for it', async () => {
    const target = boardConversation(view);
    target.begin();
    target.finish(false);
    expect(view.core.history.canUndo).toBe(false);
  });
});

describe('the conversation on the real board (fake server, fake clips)', () => {
  function lesson(): { conversation: LessonConversation; server: FakeLessonServer; audio: FakeAudio } {
    const server = new FakeLessonServer();
    const audio = new FakeAudio();
    const conversation = new LessonConversation({ target: () => boardConversation(view), clips: audio.source, fetch: server.fetch });
    return { conversation, server, audio };
  }

  it('the actions of an answer are drawn as they arrive, and the whole answer is ONE undo step', async () => {
    const { conversation, server, audio } = lesson();
    conversation.start('Teach me about vectors');
    expect(await until(() => server.turns.length === 1)).toBe(true);
    const turn = server.turns[0];
    turn?.say('A vector is an arrow.');
    turn?.actions([{ op: 'write', text: 'Vector = size + direction', at: { x: 40, y: 40 }, style: 'typed' }]);
    turn?.say('It has a size.');
    turn?.actions([rect(300), rect(420)]);
    turn?.actions([{ op: 'write', text: 'v', at: { x: 300, y: 120 }, style: 'typed' }]);
    turn?.done();
    expect(await until(() => shapeCount() === 4)).toBe(true);
    expect(conversation.state === 'speaking' || conversation.state === 'thinking').toBe(true);
    for (const text of ['A vector is an arrow.', 'It has a size.']) {
      expect(await until(() => audio.clips.some((c) => c.text === text && c.playing))).toBe(true);
      audio.clip(text).end();
    }
    expect(await until(() => conversation.state === 'listening')).toBe(true);
    undo();
    expect(shapeCount()).toBe(0);
    conversation.dispose();
  });

  it('two answers of a lesson are two undo steps', async () => {
    const { conversation, server } = lesson();
    conversation.start('Teach me about vectors');
    expect(await until(() => server.turns.length === 1)).toBe(true);
    server.turns[0]?.actions([rect(10), rect(120)]);
    server.turns[0]?.done();
    expect(await until(() => conversation.state === 'listening')).toBe(true);
    conversation.type('go on');
    expect(await until(() => server.turns.length === 2)).toBe(true);
    server.turns[1]?.actions([rect(230)]);
    server.turns[1]?.done();
    expect(await until(() => conversation.state === 'listening' && shapeCount() === 3)).toBe(true);
    undo();
    expect(shapeCount()).toBe(2);
    undo();
    expect(shapeCount()).toBe(0);
    conversation.dispose();
  });

  it('a barge-in in the middle of an answer commits what was drawn as one undo step', async () => {
    const { conversation, server, audio } = lesson();
    conversation.start('Teach me about vectors');
    expect(await until(() => server.turns.length === 1)).toBe(true);
    const turn = server.turns[0];
    turn?.say('Look.');
    turn?.actions([rect(10)]);
    turn?.actions([rect(120)]);
    expect(await until(() => shapeCount() === 2)).toBe(true);
    expect(await until(() => audio.clips.some((c) => c.playing))).toBe(true);
    expect(conversation.interrupt()).toBe(true);
    expect(conversation.state).toBe('listening');
    expect(shapeCount()).toBe(2);
    undo();
    expect(shapeCount()).toBe(0);
    conversation.dispose();
  });
});
