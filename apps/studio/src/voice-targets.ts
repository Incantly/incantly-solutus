/**
 * What a voice lesson acts on in the studio (teacher design 9): the studio's own figure (graph views), or the board.
 * The server checks every line and board action on its own copy before it streams; these apply them, and the figure and
 * the board check them again as they apply.
 */
import type { BoardView, Gesture } from '@incantly/board';
import { beginGesture } from '@incantly/board';
import type { ConversationTarget } from './lesson';
import type { LessonBoard } from './lesson-client';
import type { KernelSession } from './session';
import type { FilmControl } from './teach-client';
import type { LessonTarget } from './voice';

/** The lesson on the studio's figure: lines go in as one undo step, and film controls move the studio's clock. */
export function figureLesson(session: KernelSession, mode: () => string): LessonTarget {
  return {
    context: () => ({ mode: mode(), script: session.save(), t: session.time() }),
    begin: () => undefined,
    lines: (lines) => void session.applyLines(lines, 'The teacher', 'independent', 'model'),
    actions: () => Promise.resolve(),
    control(c: FilmControl) {
      if (c.op === 'pause') session.pause();
      else if (c.op === 'resume') session.play();
      else if (c.t !== undefined) void session.setTime(c.t);
    },
  };
}

/** The figure card a board lesson works on: the one it made last, else the one that has the input. */
function cardOf(view: BoardView, last: string | undefined): ReturnType<BoardView['figures']['cards']['get']> {
  const cards = view.figures.cards;
  return (last !== undefined ? cards.get(last) : undefined) ?? (view.figures.inputId !== undefined ? cards.get(view.figures.inputId) : undefined);
}

/** The board in view as the server's `{ items, more, page }`; an empty page when the board cannot be read. */
function boardInView(view: BoardView): LessonBoard {
  const read = view.agent.runner.read();
  return read.ok ? { items: read.value.items, more: read.value.more, page: read.value.page } : { items: [], more: 0, page: 'page' };
}

/**
 * The lesson as a conversation on the board (`lesson.ts`). Actions go to the board's agent runner, all inside one gesture
 * that `begin` makes and `finish` commits, so one answer of the teacher is one undo step however many `actions` events it
 * sends. A stopped turn (a barge-in or the end) stops the runner first, so the actions still waiting are not run; what was
 * made stays.
 */
export function boardConversation(view: BoardView): ConversationTarget {
  /** The gesture of the answer in progress (data: committed and dropped by `finish`, or by the next `begin`). */
  const answer: { gesture?: Gesture } = {};
  const settle = (): void => {
    answer.gesture?.commit();
    delete answer.gesture;
  };
  return {
    board: () => boardInView(view),
    begin() {
      settle();
      view.agent.runner.forget();
      answer.gesture = beginGesture(view.agent.runner.core, 'model');
    },
    async actions(actions) {
      await view.agent.runner.run({ actions }, answer.gesture !== undefined ? { gesture: answer.gesture } : {});
    },
    finish(stopped) {
      if (stopped) view.agent.runner.stop();
      settle();
    },
  };
}

/**
 * The lesson on the board. The request carries the items in view and the script of the card in focus; actions go to the
 * board's runner (one undo step for each call); lines and film controls act on the figure card the lesson made last, or the
 * one in focus.
 */
export function boardLesson(view: BoardView): LessonTarget {
  /** The figure card the lesson made last (data: the shape's id), forgotten when a turn begins. */
  const made: { last?: string } = {};
  return {
    context() {
      const card = cardOf(view, made.last);
      return {
        mode: card?.mode ?? 'graphing',
        script: card?.app?.toScript() ?? '',
        t: card?.app?.clock.t ?? 0,
        board: boardInView(view),
      };
    },
    begin() {
      view.agent.runner.forget();
      delete made.last;
    },
    lines(lines) {
      cardOf(view, made.last)?.app?.run(lines, { independent: true });
    },
    async actions(actions) {
      const run = await view.agent.runner.run({ actions });
      if (!run.ok) return;
      run.value.forEach((result, i) => {
        const raw = actions[i];
        const op = typeof raw === 'object' && raw !== null ? (raw as { op?: unknown }).op : undefined;
        if (result.ok && op === 'figure' && result.id !== undefined) made.last = result.id;
      });
    },
    control(c: FilmControl) {
      const clock = cardOf(view, made.last)?.app?.clock;
      if (clock === undefined) return;
      if (c.op === 'pause') clock.pause();
      else if (c.op === 'resume') clock.play();
      else if (c.t !== undefined) clock.seek(c.t);
    },
  };
}
