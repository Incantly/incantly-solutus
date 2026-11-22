/**
 * Lesson round 1, the server's lesson store and `LESSON_MACHINE` (docs/features/lesson/design.md 4 and 6, errors.md;
 * docs/state-machines.md LE1; requirements R3.2, R3.3, R5.2, R6). The clock is the one the test passes; there are no
 * timers. Public exports only; no network.
 */
import { StateMachine } from '@incantly/kernel';
import { describe, expect, it, vi } from 'vitest';
import { LESSON_MACHINE, LESSON_STORE_LIMITS, LessonStore, STATUS } from '../../src/index';
import type { Lesson, LessonMove, LessonState, ServerError } from '../../src/index';
import { makeClock } from './helpers';

const failed = (v: unknown): v is ServerError => typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false;
const lessonOf = (v: Lesson | ServerError): Lesson => {
  if (failed(v)) throw new Error(`not a lesson: ${v.kind}`);
  return v;
};
const turnOf = (v: number | ServerError): number => {
  if (failed(v)) throw new Error(`no turn: ${v.kind}`);
  return v;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIN = 60_000;

function rig(options: ConstructorParameters<typeof LessonStore>[1] = {}) {
  const clock = makeClock();
  const store = new LessonStore(clock.now, options);
  return { clock, store };
}

/** One whole turn of `client` on `lesson`: begin, then finish (as the route does). */
function runTurn(store: LessonStore, lesson: Lesson, client = 'a', endRequested = false) {
  const turn = turnOf(store.begin(lesson, client, () => undefined));
  return { turn, finished: store.finish(lesson, turn, endRequested) };
}

describe('the numbers of the store (design 4)', () => {
  it('15 minutes idle, 200 turns, at most 100 lessons', () => {
    expect(LESSON_STORE_LIMITS).toMatchObject({ idleMs: 15 * MIN, turns: 200, held: 100 });
  });
});

describe('lesson ids (design 4, R3.2)', () => {
  it('is a random UUID (crypto.randomUUID shape), different every time', () => {
    const { store } = rig();
    const ids = Array.from({ length: 50 }, () => lessonOf(store.start('Linear algebra', 'graphing')).id);
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(50);
  });

  it('an id that was never made is lesson_unknown (404, "This lesson has ended.")', () => {
    const { store } = rig();
    const e = store.check('11111111-2222-4333-8444-555555555555', 'a');
    expect(failed(e) && e.kind).toBe('lesson_unknown');
    if (failed(e)) {
      expect(e.message).toBe('This lesson has ended.');
      expect(STATUS.lesson_unknown).toBe(404);
    }
  });

  it('a guessed id near a real one is not the lesson', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    const guess = `${lesson.id.slice(0, -1)}${lesson.id.endsWith('0') ? '1' : '0'}`;
    expect(failed(store.check(guess, 'a'))).toBe(true);
    expect(failed(store.check(lesson.id, 'a'))).toBe(false);
  });
});

describe('the end of a lesson by the learner (design 4: the server forgets it)', () => {
  it('end answers true once; then the lesson is lesson_unknown, for end and for a turn', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    expect(store.end(lesson.id)).toBe(true);
    expect(lesson.state).toBe('ended');
    const again = store.end(lesson.id);
    expect(failed(again) && again.kind).toBe('lesson_unknown');
    const turn = store.check(lesson.id, 'a');
    expect(failed(turn) && turn.kind).toBe('lesson_unknown');
    expect(store.size).toBe(0);
  });

  it('ending a lesson stops its running turn', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    const stop = vi.fn();
    turnOf(store.begin(lesson, 'a', stop));
    store.end(lesson.id);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('15 minutes idle ends a lesson, read from the injected clock (design 4, R3.3)', () => {
  it('still held just under 15 minutes, gone after', () => {
    const { clock, store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    clock.advance(15 * MIN - 1000);
    expect(failed(store.check(lesson.id, 'a'))).toBe(false);
    clock.advance(2000);
    const e = store.check(lesson.id, 'a');
    expect(failed(e) && e.kind).toBe('lesson_unknown');
  });

  it('idle time counts from the last turn, not from the start', () => {
    const { clock, store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    clock.advance(10 * MIN);
    runTurn(store, lesson);
    clock.advance(10 * MIN);
    expect(failed(store.check(lesson.id, 'a'))).toBe(false);
    clock.advance(6 * MIN);
    expect(failed(store.check(lesson.id, 'a'))).toBe(true);
  });

  it('an idle lesson that nobody calls is dropped when another lesson starts (no timer needed)', () => {
    const { clock, store } = rig();
    lessonOf(store.start('old', 'graphing'));
    clock.advance(16 * MIN);
    lessonOf(store.start('new', 'graphing'));
    expect(store.size).toBe(1);
  });

  it('the store has no timers of its own: nothing is scheduled', () => {
    vi.useFakeTimers();
    try {
      const clock = makeClock();
      const store = new LessonStore(clock.now);
      lessonOf(store.start('x', 'graphing'));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('200 turns end a lesson (design 4, R3.3)', () => {
  it('after 200 turns the lesson is over and the next call is lesson_unknown', () => {
    const { clock, store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    let ended = false;
    for (let i = 1; i <= 200; i++) {
      const c = store.check(lesson.id, 'a');
      expect(failed(c), `turn ${i} may begin`).toBe(false);
      const r = runTurn(store, lesson);
      ended = r.finished.ended;
      clock.advance(1000);
    }
    expect(ended).toBe(true);
    const e = store.check(lesson.id, 'a');
    expect(failed(e) && e.kind).toBe('lesson_unknown');
    expect(lesson.state).toBe('ended');
  });

  it('199 turns do not end it', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    for (let i = 1; i <= 199; i++) expect(runTurn(store, lesson).finished.ended, `turn ${i}`).toBe(false);
    expect(failed(store.check(lesson.id, 'a'))).toBe(false);
  });

  it('the learner asking to end ends the lesson with that turn', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    expect(runTurn(store, lesson, 'a', true).finished.ended).toBe(true);
    expect(failed(store.check(lesson.id, 'a'))).toBe(true);
  });
});

describe('at most 100 lessons; the oldest idle one goes (design 4, R3.3, errors.md lesson_full)', () => {
  const fill = (store: LessonStore, clock: ReturnType<typeof makeClock>, n: number): Lesson[] =>
    Array.from({ length: n }, () => {
      clock.advance(1000);
      return lessonOf(store.start('x', 'graphing'));
    });

  it('the 101st start ends the oldest idle lesson, and 100 are held', () => {
    const { clock, store } = rig();
    const lessons = fill(store, clock, 100);
    expect(store.size).toBe(100);
    clock.advance(1000);
    const extra = lessonOf(store.start('x', 'graphing'));
    expect(store.size).toBe(100);
    expect(failed(store.check(lessons[0]?.id ?? '', 'a'))).toBe(true);
    for (const l of lessons.slice(1)) expect(failed(store.check(l.id, 'a')), l.id).toBe(false);
    expect(failed(store.check(extra.id, 'a'))).toBe(false);
  });

  it('"oldest idle" means the longest without a turn: a lesson that just had a turn is kept', () => {
    const { clock, store } = rig();
    const lessons = fill(store, clock, 100);
    clock.advance(5000);
    runTurn(store, lessons[0] as Lesson);
    clock.advance(1000);
    lessonOf(store.start('x', 'graphing'));
    expect(failed(store.check((lessons[0] as Lesson).id, 'a'))).toBe(false);
    expect(failed(store.check((lessons[1] as Lesson).id, 'a'))).toBe(true);
  });

  it('a lesson with a turn running is not the one that goes', () => {
    const { clock, store } = rig();
    const lessons = fill(store, clock, 100);
    turnOf(store.begin(lessons[0] as Lesson, 'a', () => undefined));
    clock.advance(1000);
    lessonOf(store.start('x', 'graphing'));
    expect(failed(store.check((lessons[0] as Lesson).id, 'a'))).toBe(false);
  });

  it('when all 100 are running a turn there is nothing to end: lesson_full, 503, "try again in a minute"', () => {
    const { clock, store } = rig();
    const lessons = fill(store, clock, 100);
    for (const l of lessons) turnOf(store.begin(l, 'a', () => undefined));
    const e = store.start('x', 'graphing');
    expect(failed(e) && e.kind).toBe('lesson_full');
    if (failed(e)) {
      expect(e.message).toBe('The server is teaching too many lessons; try again in a minute.');
      expect(STATUS.lesson_full).toBe(503);
    }
    expect(store.size).toBe(100);
  });

  it('the limit is a number the store takes: with held 2 the third start ends the oldest', () => {
    const { clock, store } = rig({ limits: { held: 2 } });
    const [a, b] = fill(store, clock, 2) as [Lesson, Lesson];
    clock.advance(1000);
    lessonOf(store.start('x', 'graphing'));
    expect(failed(store.check(a.id, 'a'))).toBe(true);
    expect(failed(store.check(b.id, 'a'))).toBe(false);
  });
});

describe('one turn at a time: lesson_busy and superseded (errors.md, review-r2 TR-16)', () => {
  it('another client\'s turn while one runs is lesson_busy (409, "The teacher is still answering.") and changes nothing', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    turnOf(store.begin(lesson, 'a', () => undefined));
    const e = store.check(lesson.id, 'b');
    expect(failed(e) && e.kind).toBe('lesson_busy');
    if (failed(e)) {
      expect(e.message).toBe('The teacher is still answering.');
      expect(STATUS.lesson_busy).toBe(409);
    }
    expect(lesson.running).toBe(true);
    expect(lesson.client).toBe('a');
  });

  it('the same client\'s newer turn replaces the running one: the older is stopped (it ends superseded) and the newer begins', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    const stop = vi.fn();
    const first = turnOf(store.begin(lesson, 'a', stop));
    const second = turnOf(store.begin(lesson, 'a', () => undefined));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(second).toBeGreaterThan(first);
    // the older turn ends late: it changes nothing
    expect(store.finish(lesson, first, false)).toEqual({ current: false, ended: false });
    expect(lesson.running).toBe(true);
    expect(store.finish(lesson, second, false).current).toBe(true);
    expect(lesson.running).toBe(false);
  });

  it('a turn that ended leaves the lesson free for any client', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    runTurn(store, lesson, 'a');
    expect(failed(store.check(lesson.id, 'b'))).toBe(false);
  });

  it('a turn number is never reused', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    const numbers = Array.from({ length: 10 }, () => runTurn(store, lesson).turn);
    expect(new Set(numbers).size).toBe(10);
  });
});

describe('LESSON_MACHINE: every row of design 6 and LE1, and nothing else (R6)', () => {
  const ROWS: readonly [LessonState, LessonMove, LessonState][] = [
    ['new', 'begin', 'planning'],
    ['planning', 'planned', 'teaching'],
    ['planning', 'turnEnd', 'waiting'],
    ['teaching', 'turnEnd', 'waiting'],
    ['waiting', 'speak', 'teaching'],
    ['waiting', 'replan', 'planning'],
    ['new', 'end', 'ended'],
    ['planning', 'end', 'ended'],
    ['teaching', 'end', 'ended'],
    ['waiting', 'end', 'ended'],
  ];
  const STATES: readonly LessonState[] = ['new', 'planning', 'teaching', 'waiting', 'ended'];
  const MOVES: readonly LessonMove[] = ['begin', 'planned', 'replan', 'turnEnd', 'speak', 'end'];

  it.each(ROWS)('%s --%s--> %s', (from, move, to) => {
    const faults: string[] = [];
    const m = new StateMachine(LESSON_MACHINE, from, (f, e) => faults.push(`${f}/${e}`));
    expect(m.send(move)).toBe(true);
    expect(m.state).toBe(to);
    expect(faults).toEqual([]);
  });

  it('every other state and move pair is refused, reported once, and leaves the state where it was', () => {
    const allowed = new Set(ROWS.map(([f, e]) => `${f}/${e}`));
    let pairs = 0;
    for (const from of STATES) {
      for (const move of MOVES) {
        if (allowed.has(`${from}/${move}`)) continue;
        const faults: string[] = [];
        const m = new StateMachine(LESSON_MACHINE, from, (f, e) => faults.push(`${f}/${e}`));
        expect(m.send(move), `${from}/${move}`).toBe(false);
        expect(m.state, `${from}/${move}`).toBe(from);
        expect(faults, `${from}/${move}`).toEqual([`${from}/${move}`]);
        pairs += 1;
      }
    }
    expect(pairs).toBe(STATES.length * MOVES.length - ROWS.length);
  });

  it('`ended` accepts nothing', () => {
    expect(Object.keys(LESSON_MACHINE.ended)).toEqual([]);
  });

  it('the table has the five states of LE1 and no other', () => {
    expect(Object.keys(LESSON_MACHINE).sort()).toEqual([...STATES].sort());
  });
});

describe('the lesson walks the machine (design 6)', () => {
  it('new -> planning (first turn) -> teaching (plan passed) -> waiting (turn ended) -> teaching (learner speaks) -> ended (end)', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('Linear algebra', 'graphing'));
    expect(lesson.state).toBe('new');
    const t1 = turnOf(store.begin(lesson, 'a', () => undefined));
    expect(lesson.state).toBe('planning');
    lesson.memory.plan = ['One', 'Two', 'Three'];
    lesson.memory.step = 1;
    lesson.planned(t1);
    expect(lesson.state).toBe('teaching');
    store.finish(lesson, t1, false);
    expect(lesson.state).toBe('waiting');
    const t2 = turnOf(store.begin(lesson, 'a', () => undefined));
    expect(lesson.state).toBe('teaching');
    store.finish(lesson, t2, false);
    expect(lesson.state).toBe('waiting');
    store.end(lesson.id);
    expect(lesson.state).toBe('ended');
  });

  it('a first turn that ended with no plan leaves the lesson waiting; its next turn plans again (LE1 replan)', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('Linear algebra', 'graphing'));
    runTurn(store, lesson);
    expect(lesson.state).toBe('waiting');
    turnOf(store.begin(lesson, 'a', () => undefined));
    expect(lesson.state).toBe('planning');
  });

  it('a plan that passes in a turn that is no longer the current one changes nothing', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    const first = turnOf(store.begin(lesson, 'a', () => undefined));
    turnOf(store.begin(lesson, 'a', () => undefined));
    lesson.memory.plan = ['One', 'Two', 'Three'];
    lesson.planned(first);
    expect(lesson.state).toBe('planning');
  });

  it('a refused move is reported once to the store\'s onFault and the state stays: a turn begun while one runs', () => {
    const faults: string[] = [];
    const { store } = rig({ onFault: (from, event) => faults.push(`${from}/${event}`) });
    const lesson = lessonOf(store.start('x', 'graphing'));
    expect(lesson.begin('a', () => undefined, 0)).toBeGreaterThan(0);
    expect(lesson.state).toBe('planning');
    expect(lesson.begin('a', () => undefined, 0)).toBe(0);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.startsWith('planning/')).toBe(true);
    expect(lesson.state).toBe('planning');
  });

  it('a lesson that has ended takes no turn', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    store.end(lesson.id);
    const e = store.begin(lesson, 'a', () => undefined);
    expect(failed(e)).toBe(true);
    expect(lesson.state).toBe('ended');
  });
});

describe('the running turn follows the machine and nothing else (LR-1, review-r1)', () => {
  it('a turn that is refused sets nothing: the running turn keeps its client and its number', () => {
    const { store } = rig({ onFault: () => undefined });
    const lesson = lessonOf(store.start('x', 'graphing'));
    const first = lesson.begin('a', () => undefined, 0);
    expect(lesson.begin('b', () => undefined, 0)).toBe(0);
    expect(lesson.client).toBe('a');
    expect(lesson.current(first)).toBe(true);
    expect(lesson.turns).toBe(1);
  });

  it('the client is "" and no turn is current after each move that leaves a running state: finish, interrupt, end', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    const t1 = turnOf(store.begin(lesson, 'a', () => undefined));
    expect(lesson.client).toBe('a');
    store.finish(lesson, t1, false);
    expect(lesson.client).toBe('');
    expect(lesson.current(t1)).toBe(false);

    const t2 = turnOf(store.begin(lesson, 'b', () => undefined));
    expect(lesson.client).toBe('b');
    lesson.interrupt(0);
    expect(lesson.state).toBe('waiting');
    expect(lesson.client).toBe('');
    expect(lesson.current(t2)).toBe(false);

    const t3 = turnOf(store.begin(lesson, 'c', () => undefined));
    expect(lesson.client).toBe('c');
    lesson.end();
    expect(lesson.state).toBe('ended');
    expect(lesson.client).toBe('');
    expect(lesson.current(t3)).toBe(false);
  });

  it('the older turn is stopped when a newer one of the same client begins, and only the newer is current', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    let stopped = 0;
    const t1 = turnOf(store.begin(lesson, 'a', () => (stopped += 1)));
    const t2 = turnOf(store.begin(lesson, 'a', () => undefined));
    expect(stopped).toBe(1);
    expect(lesson.current(t1)).toBe(false);
    expect(lesson.current(t2)).toBe(true);
    expect(store.finish(lesson, t1, false).current).toBe(false);
    expect(lesson.state).toBe('planning');
  });
});

describe('a refused move of a lesson is never silent (LR-2, review-r1)', () => {
  it('with no onFault given, the store still counts the refusal', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    expect(store.refusals).toBe(0);
    expect(lesson.begin('a', () => undefined, 0)).toBeGreaterThan(0);
    expect(lesson.begin('a', () => undefined, 0)).toBe(0);
    expect(store.refusals).toBe(1);
    expect(lesson.state).toBe('planning');
  });

  it('with onFault given, it hears the same refusal, and the count agrees', () => {
    const faults: string[] = [];
    const { store } = rig({ onFault: (from, event) => faults.push(`${from}/${event}`) });
    const lesson = lessonOf(store.start('x', 'graphing'));
    lesson.begin('a', () => undefined, 0);
    lesson.begin('a', () => undefined, 0);
    expect(faults).toHaveLength(1);
    expect(store.refusals).toBe(1);
  });

  it('a lesson that ends and is ended again reports the second end', () => {
    const { store } = rig();
    const lesson = lessonOf(store.start('x', 'graphing'));
    lesson.end();
    expect(store.refusals).toBe(0);
    lesson.end();
    expect(store.refusals).toBe(1);
  });
});
