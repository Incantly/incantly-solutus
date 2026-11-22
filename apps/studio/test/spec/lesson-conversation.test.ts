/**
 * Lesson round 2, the conversation on the board (lesson design 1, 6, 7; requirements R1 and R7.1; docs/state-machines.md LE2;
 * handoff/lesson/plan.md Round 2): `LessonConversation` with a fake server (NDJSON fed by hand), a fake recogniser, a fake
 * silence timer, fake clips and a fake board target. Start lesson, thinking, speaking, the microphone opening by itself after
 * the queue drains, barge-in by a tap or Space, 8 seconds of silence, where the browser cannot listen, the end of the
 * lesson (the learner's End, the server's `ended`, `lesson_unknown`), the plan view, the board's actions and the
 * transcript. Only the public API is used. Nothing reaches a network, a microphone or a speaker.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SILENCE_MS, microphoneMessage } from '../../src/lesson';
import { endRigs, json, playOut, reach, rig, tick, toListening, toSpeaking, turnOf, until } from './lesson-helpers';

afterEach(endRigs);

const PLAN = ['Vectors', 'Adding them', 'Scaling', 'Matrices as moves', 'Solving'];
const texts = (r: ReturnType<typeof rig>): string[] => r.conversation.transcript.map((l) => l.text);

/** A first turn that sent a plan (step 2) and one sentence, spoken to the end: the conversation is listening. */
async function toListeningWithPlan(r: ReturnType<typeof rig>): Promise<void> {
  r.conversation.start('Teach me about linear algebra');
  const turn = await turnOf(r);
  turn.lesson(PLAN, 2);
  turn.say('Hello.');
  turn.done();
  await playOut(r, 'Hello.');
  await reach(r, 'listening');
}

describe('Start lesson: thinking, speaking, and the microphone opening by itself (R1.1, R1.2, design 6)', () => {
  it('start(words) moves off to thinking at once, asks /v1/lesson/start with the board, then /v1/lesson/turn with the id, the words and the board', async () => {
    const r = rig();
    expect(r.conversation.start('Teach me about linear algebra')).toBe(true);
    expect(r.conversation.state).toBe('thinking');
    const turn = await turnOf(r);
    expect(r.server.starts).toHaveLength(1);
    expect(r.server.starts[0]?.body['board']).toEqual(r.target.boardNow);
    expect(turn.request).toEqual({ lessonId: 'lesson-1', text: 'Teach me about linear algebra', board: r.target.boardNow });
    expect(r.server.starts[0]?.url).toBe('/v1/lesson/start');
    expect(r.server.turnsSeen[0]?.url).toBe('/v1/lesson/turn');
    turn.done();
  });

  it('the learner\'s words are the first line of the transcript, as "you"', async () => {
    const r = rig();
    r.conversation.start('  Teach me about vectors  ');
    await turnOf(r);
    expect(r.conversation.transcript[0]).toMatchObject({ who: 'you', text: 'Teach me about vectors' });
  });

  it('thinking until the first sentence plays: speaking while a clip plays, and the first sentence is shown as text', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    expect(r.conversation.state).toBe('thinking');
    turn.say('We will learn it in five steps.');
    await reach(r, 'speaking');
    expect(r.audio.playingNow?.text).toBe('We will learn it in five steps.');
    expect(r.conversation.transcript.at(-1)).toMatchObject({ who: 'teacher', text: 'We will learn it in five steps.' });
    turn.done();
  });

  it('after the queue drains the microphone opens by itself: speaking, then listening with an open recogniser', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    turn.done();
    expect(r.recognisers).toHaveLength(0);
    await playOut(r, 'S1', 'S2');
    await reach(r, 'listening');
    expect(r.recognisers).toHaveLength(1);
    expect(r.recognisers[0]?.open).toBe(true);
    expect(r.conversation.micOpen).toBe(true);
  });

  it('the states of a first turn go thinking, speaking, listening, and never paused, off or a fault', async () => {
    const r = rig();
    await toListening(r);
    const seen = r.snapshots.map((s) => s.state).filter((s, i, all) => s !== all[i - 1]);
    expect(seen[0]).toBe('thinking');
    expect(seen).toContain('speaking');
    expect(seen.at(-1)).toBe('listening');
    expect(seen).not.toContain('paused');
    expect(seen).not.toContain('off');
  });

  it('listening opens only when the end of the turn is reached: the last clip ended but the stream is still open, so it is not the learner\'s turn yet', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    await playOut(r, 'S1', 'S2');
    await tick(40);
    expect(r.conversation.state).toBe('thinking');
    expect(r.recognisers).toHaveLength(0);
    turn.say('S3');
    await playOut(r, 'S3');
    await tick(20);
    expect(r.conversation.state).toBe('thinking');
    turn.done();
    await reach(r, 'listening');
    expect(r.recognisers).toHaveLength(1);
  });

  it('the stream\'s done while a clip still plays does not open the microphone: the sentences are spoken to the end first', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    turn.done();
    await tick(40);
    expect(r.conversation.state).toBe('speaking');
    expect(r.recognisers).toHaveLength(0);
    await playOut(r, 'S1');
    await tick(20);
    expect(r.recognisers).toHaveLength(0);
    await playOut(r, 'S2');
    await reach(r, 'listening');
  });

  it('a turn with no sentence, only board actions, goes from thinking straight to listening at its done', async () => {
    const r = rig();
    r.conversation.start('Draw it');
    const turn = await turnOf(r);
    turn.actions([{ op: 'write', text: 'v' }]);
    turn.done();
    await reach(r, 'listening');
    expect(r.recognisers).toHaveLength(1);
  });

  it('the sentences are spoken in order, one at a time, and the audio of all of them is asked for at once', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.say('A');
    turn.say('B');
    turn.say('C');
    await reach(r, 'speaking');
    expect(await until(() => r.audio.requested.length === 3)).toBe(true);
    expect(r.audio.requested).toEqual(['A', 'B', 'C']);
    expect(r.audio.clips.filter((c) => c.playing).map((c) => c.text)).toEqual(['A']);
    r.audio.clip('A').end();
    expect(await until(() => r.audio.clip('B').playing)).toBe(true);
    expect(r.audio.clip('C').played).toBe(false);
    await playOut(r, 'B', 'C');
    turn.done();
    await reach(r, 'listening');
  });

  it('a sentence whose audio is not available is spoken with the browser\'s voice, in its place', async () => {
    const r = rig();
    r.audio.missing.add('B');
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.say('A');
    turn.say('B');
    turn.say('C');
    turn.done();
    await playOut(r, 'A');
    expect(await until(() => r.voice.said.includes('B'))).toBe(true);
    expect(r.conversation.state).toBe('speaking');
    expect(r.audio.clip('C').played).toBe(false);
  });

  it('the lesson id is kept: the second turn asks /v1/lesson/turn with the same id and does not ask /v1/lesson/start again', async () => {
    const r = rig();
    await toListening(r);
    r.recognisers[0]?.hear('It gets bigger?', true);
    const second = await turnOf(r, 2);
    expect(second.request['lessonId']).toBe('lesson-1');
    expect(r.server.starts).toHaveLength(1);
    second.done();
    await reach(r, 'listening');
  });

  it('with no board to teach on the learner is told, nothing is asked of the server, and the conversation is off', () => {
    const r = rig({ board: false });
    r.conversation.start('Teach me about vectors');
    expect(r.conversation.state).toBe('off');
    expect(r.conversation.transcript.some((l) => l.who === 'notice')).toBe(true);
    expect(r.server.all).toHaveLength(0);
  });
});

describe('the microphone is closed while the teacher speaks (R1.3, design 6)', () => {
  it('no recogniser is open when a clip starts playing, over three turns, and the microphone is never open in thinking or speaking', async () => {
    const r = rig();
    await toListening(r);
    for (const words of ['one', 'two']) {
      r.recognisers.at(-1)?.hear(words, true);
      const turn = await turnOf(r, r.server.turns.length + 1);
      turn.say(`Answer to ${words}.`);
      turn.done();
      await playOut(r, `Answer to ${words}.`);
      await until(() => r.conversation.state === 'listening' && r.recognisers.at(-1)?.open === true);
    }
    expect(r.openWhilePlaying).toHaveLength(3);
    expect(r.openWhilePlaying.every((n) => n === 0)).toBe(true);
    for (const s of r.snapshots) {
      if (s.state === 'thinking' || s.state === 'speaking') {
        expect(s.micOpen, s.state).toBe(false);
        expect(s.openRecognisers, s.state).toBe(0);
      }
    }
  });

  it('the recogniser of the learner\'s turn is closed when the words are heard, before the teacher answers', async () => {
    const r = rig();
    await toListening(r);
    const mic = r.recognisers[0];
    mic?.hear('It gets bigger?', true);
    expect(mic?.open).toBe(false);
    expect(r.conversation.micOpen).toBe(false);
    expect(r.conversation.state).toBe('thinking');
  });

  it('a speech result that arrives after the learner has been answered is dropped: it starts no second turn', async () => {
    const r = rig();
    await toListening(r);
    const mic = r.recognisers[0];
    mic?.hear('first', true);
    await turnOf(r, 2);
    mic?.hear('second', true);
    await tick(40);
    expect(r.server.turns).toHaveLength(2);
    expect(texts(r)).not.toContain('second');
  });
});

describe('what the learner says: heard, interim and typed (LE2 listening rows)', () => {
  it('heard (a final text) moves listening to thinking and sends the text as the turn', async () => {
    const r = rig();
    await toListening(r);
    r.recognisers[0]?.hear('What is a unit vector?', true);
    expect(r.conversation.state).toBe('thinking');
    const second = await turnOf(r, 2);
    expect(second.request['text']).toBe('What is a unit vector?');
    expect(r.conversation.transcript.at(-1)).toMatchObject({ who: 'you', text: 'What is a unit vector?' });
  });

  it('interim text is shown and never sent, and an empty final text does nothing', async () => {
    const r = rig();
    await toListening(r);
    r.recognisers[0]?.hear('what is', false);
    expect(r.conversation.interim).toBe('what is');
    expect(r.conversation.state).toBe('listening');
    r.recognisers[0]?.hear('', true);
    await tick(30);
    expect(r.conversation.state).toBe('listening');
    expect(r.server.turns).toHaveLength(1);
  });

  it('typing while listening (listening --type--> thinking) closes the microphone and the timer and sends the typed text', async () => {
    const r = rig();
    await toListening(r);
    const timerNow = r.timer.entries.at(-1);
    expect(r.conversation.type('Twice as long?')).toBe(true);
    expect(r.conversation.state).toBe('thinking');
    expect(r.recognisers[0]?.open).toBe(false);
    expect(timerNow?.cancelled).toBe(true);
    const second = await turnOf(r, 2);
    expect(second.request['text']).toBe('Twice as long?');
  });

  it('a lesson can start by the microphone: off --listen--> listening, and the first words ask /start first and then the turn', async () => {
    const r = rig();
    expect(r.conversation.listen()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(r.recognisers).toHaveLength(1);
    expect(r.recognisers[0]?.open).toBe(true);
    expect(r.server.starts).toHaveLength(0);
    r.recognisers[0]?.hear('Teach me about vectors', true);
    expect(r.conversation.state).toBe('thinking');
    const turn = await turnOf(r);
    expect(r.server.starts).toHaveLength(1);
    expect(turn.request['text']).toBe('Teach me about vectors');
  });

  it('start() with no words, or while a lesson is on, is refused and asks nothing of the server', async () => {
    const r = rig();
    expect(r.conversation.start('   ')).toBe(false);
    expect(r.server.all).toHaveLength(0);
    await toListening(r);
    const before = r.server.all.length;
    expect(r.conversation.start('another lesson')).toBe(false);
    expect(r.server.all).toHaveLength(before);
  });
});

describe('8 seconds of silence pause the lesson (LE2 pause, design 6)', () => {
  it('the silence timer is 8 s, starts when the microphone opens, and there is none while the teacher thinks or speaks', async () => {
    expect(SILENCE_MS).toBe(8000);
    const r = rig();
    const turn = await toSpeaking(r);
    expect(r.timer.entries).toHaveLength(0);
    turn.done();
    await playOut(r, 'S1', 'S2');
    await reach(r, 'listening');
    expect(r.timer.entries).toHaveLength(1);
    expect(r.timer.entries[0]?.ms).toBe(8000);
    expect(r.timer.live).toHaveLength(1);
  });

  it('when the timer fires with nothing heard the conversation pauses: the microphone is closed, nothing runs, the lesson stays', async () => {
    const r = rig();
    await toListening(r);
    r.timer.elapse();
    expect(r.conversation.state).toBe('paused');
    expect(r.recognisers[0]?.open).toBe(false);
    expect(r.conversation.micOpen).toBe(false);
    expect(r.server.ends).toHaveLength(0);
  });

  it('words heard clear the timer: the silence no longer pauses, and the interim text is shown', async () => {
    const r = rig();
    await toListening(r);
    const entry = r.timer.entries[0];
    r.recognisers[0]?.hear('um', false);
    expect(entry?.cancelled).toBe(true);
    r.timer.elapse();
    expect(r.conversation.state).toBe('listening');
    expect(r.conversation.interim).toBe('um');
  });

  it('the browser ending the recognition with nothing heard is the same pause', async () => {
    const r = rig();
    await toListening(r);
    r.recognisers[0]?.end();
    expect(r.conversation.state).toBe('paused');
    expect(r.timer.entries[0]?.cancelled).toBe(true);
    expect(r.conversation.micOpen).toBe(false);
  });

  it('a microphone that failed pauses the lesson, says why and that typing works, and typing then goes on', async () => {
    const r = rig();
    await toListening(r);
    r.recognisers[0]?.end('not-allowed');
    expect(r.conversation.state).toBe('paused');
    const notice = r.conversation.transcript.find((l) => l.who === 'notice');
    expect(notice?.text.toLowerCase()).toContain('type');
    expect(notice?.text).toBe(microphoneMessage('not-allowed'));
    expect(r.conversation.type('I will type')).toBe(true);
    expect(r.conversation.state).toBe('thinking');
    expect((await turnOf(r, 2)).request['lessonId']).toBe('lesson-1');
  });

  it('another failure names its reason and still says that typing works', () => {
    const text = microphoneMessage('audio-capture');
    expect(text).toContain('audio-capture');
    expect(text.toLowerCase()).toContain('type');
  });

  it('a tap on the microphone while listening pauses (LE2, the tap on the microphone while listening)', async () => {
    const r = rig();
    await toListening(r);
    expect(r.conversation.tap()).toBe(true);
    expect(r.conversation.state).toBe('paused');
    expect(r.recognisers[0]?.open).toBe(false);
  });

  it('paused, a tap on the microphone listens again: a new recogniser and a new 8 s timer', async () => {
    const r = rig();
    await toListening(r);
    r.timer.elapse();
    expect(r.conversation.tap()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(r.recognisers).toHaveLength(2);
    expect(r.recognisers[1]?.open).toBe(true);
    expect(r.timer.live).toHaveLength(1);
    expect(r.timer.live[0]?.ms).toBe(8000);
  });

  it('paused, Space listens again too', async () => {
    const r = rig();
    await toListening(r);
    r.timer.elapse();
    expect(r.conversation.interrupt()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(r.recognisers[1]?.open).toBe(true);
  });

  it('paused, typing goes on with the same lesson: thinking, the same id, no new /start', async () => {
    const r = rig();
    await toListening(r);
    r.timer.elapse();
    expect(r.conversation.type('Still here')).toBe(true);
    expect(r.conversation.state).toBe('thinking');
    const second = await turnOf(r, 2);
    expect(second.request).toMatchObject({ lessonId: 'lesson-1', text: 'Still here' });
    expect(r.server.starts).toHaveLength(1);
  });

  it('pause while the teacher speaks (the panel was closed) stops everything: the clip, the queue, the turn, the board\'s gesture; the lesson stays', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    expect(r.conversation.pause()).toBe(true);
    expect(r.conversation.state).toBe('paused');
    expect(r.audio.clip('S1').stoppedBySignal).toBe(true);
    expect(r.audio.clip('S2').played).toBe(false);
    expect(turn.aborted).toBe(true);
    expect(r.target.log.at(-1)).toBe('finish:stopped');
    expect(r.recognisers).toHaveLength(0);
    expect(r.server.ends).toHaveLength(0);
  });

  it('pause while the teacher thinks aborts the turn', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    r.conversation.pause();
    expect(r.conversation.state).toBe('paused');
    expect(turn.aborted).toBe(true);
  });
});

describe('where the browser cannot listen the text box is the way in (R1.2, design 6)', () => {
  it('the conversation cannot listen, listen() from off is refused, and a lesson starts by typing', async () => {
    const r = rig({ listens: false });
    expect(r.conversation.canListen).toBe(false);
    expect(r.conversation.listen()).toBe(false);
    expect(r.conversation.state).toBe('off');
    expect(r.conversation.start('Teach me about vectors')).toBe(true);
    (await turnOf(r)).done();
    await reach(r, 'listening');
  });

  it('after the queue drains it is the learner\'s turn with nothing open: no recogniser, no silence timer, no pause, and the conversation waits for typing', async () => {
    const r = rig({ listens: false });
    await toListening(r);
    expect(r.conversation.micOpen).toBe(false);
    expect(r.recognisers).toHaveLength(0);
    expect(r.timer.entries).toHaveLength(0);
    await tick(60);
    expect(r.conversation.state).toBe('listening');
  });

  it('typing then goes on the same way: the next turn, the same lesson, and listening again after it', async () => {
    const r = rig({ listens: false });
    await toListening(r);
    expect(r.conversation.type('It gets bigger?')).toBe(true);
    expect(r.conversation.state).toBe('thinking');
    const second = await turnOf(r, 2);
    expect(second.request).toMatchObject({ lessonId: 'lesson-1', text: 'It gets bigger?' });
    second.say('Yes.');
    second.done();
    await playOut(r, 'Yes.');
    await reach(r, 'listening');
    expect(r.conversation.micOpen).toBe(false);
    expect(r.conversation.type('Why?')).toBe(true);
    expect((await turnOf(r, 3)).request['text']).toBe('Why?');
  });

  it('a tap or Space while the teacher speaks still interrupts: the teacher stops and the text box has the turn', async () => {
    const r = rig({ listens: false });
    const turn = await toSpeaking(r);
    expect(r.conversation.interrupt()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(r.audio.clip('S1').stoppedBySignal).toBe(true);
    expect(turn.aborted).toBe(true);
    expect(r.recognisers).toHaveLength(0);
    expect(r.conversation.micOpen).toBe(false);
  });
});

describe('barge-in: a tap on the microphone or Space (R1.3, design 6, LE2 invariants)', () => {
  it('a tap while the teacher speaks: the clip stops, the queued sentences are dropped, the turn is aborted, the board\'s gesture is committed, and the microphone opens', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    expect(r.conversation.tap()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(r.audio.clip('S1').stoppedBySignal).toBe(true);
    expect(r.audio.clip('S2').played).toBe(false);
    expect(turn.aborted).toBe(true);
    expect(r.target.log.at(-1)).toBe('finish:stopped');
    expect(r.recognisers).toHaveLength(1);
    expect(r.recognisers[0]?.open).toBe(true);
    expect(r.timer.live).toHaveLength(1);
  });

  it('Space does the same', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    expect(r.conversation.interrupt()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(turn.aborted).toBe(true);
    expect(r.audio.clip('S1').stoppedBySignal).toBe(true);
    expect(r.recognisers[0]?.open).toBe(true);
  });

  it('a tap while the teacher is still thinking aborts the turn and listens', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    expect(r.conversation.tap()).toBe(true);
    expect(r.conversation.state).toBe('listening');
    expect(turn.aborted).toBe(true);
    expect(r.recognisers[0]?.open).toBe(true);
  });

  it('the learner\'s words after a barge-in are the next turn of the same lesson', async () => {
    const r = rig();
    await toSpeaking(r);
    r.conversation.tap();
    r.recognisers[0]?.hear('Wait, what is a vector?', true);
    const second = await turnOf(r, 2);
    expect(second.request).toMatchObject({ lessonId: 'lesson-1', text: 'Wait, what is a vector?' });
    expect(r.server.starts).toHaveLength(1);
  });

  it('typing while the teacher speaks is a barge-in too: the old turn is aborted and a new one begins at once', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    expect(r.conversation.type('Slow down')).toBe(true);
    expect(r.conversation.state).toBe('thinking');
    expect(turn.aborted).toBe(true);
    expect(r.audio.clip('S1').stoppedBySignal).toBe(true);
    expect(r.audio.clip('S2').played).toBe(false);
    const second = await turnOf(r, 2);
    expect(second.request['text']).toBe('Slow down');
    expect(r.target.log).toEqual(['begin', 'finish:stopped', 'begin']);
  });

  it('typing while the teacher thinks aborts the open turn and sends the new text', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const first = await turnOf(r);
    r.conversation.type('Actually, matrices');
    expect(first.aborted).toBe(true);
    expect((await turnOf(r, 2)).request['text']).toBe('Actually, matrices');
  });

  it('an event of the old turn that arrives later is ignored: no line, no sound, no board action, and the new turn is not ended by it', async () => {
    const r = rig();
    // the old stream does not stop when aborted (a slow network): its events still arrive
    let lateStream: ReadableStreamDefaultController<Uint8Array> | undefined;
    r.server.turnAnswer = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            lateStream = c;
            c.enqueue(new TextEncoder().encode(`${JSON.stringify({ say: 'Old one.' })}\n`));
          },
        }),
        { status: 200 },
      );
    r.conversation.start('Teach me about vectors');
    await reach(r, 'speaking');
    r.conversation.type('Slow down');
    const second = await turnOf(r);
    const send = (event: unknown): void => lateStream?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
    send({ say: 'Old late.' });
    send({ actions: [{ op: 'write', text: 'old' }] });
    send({ lesson: { plan: ['Old plan'], step: 1, state: 'teaching' } });
    send({ done: true });
    lateStream?.close();
    await tick(50);
    expect(texts(r)).not.toContain('Old late.');
    expect(r.audio.requested).not.toContain('Old late.');
    expect(r.target.actionSets).toHaveLength(0);
    expect(r.conversation.view.plan).toEqual([]);
    expect(r.conversation.state).toBe('thinking');
    second.say('New.');
    second.done();
    await playOut(r, 'New.');
    await reach(r, 'listening');
  });

  it('a tap while the lesson is off does not touch a lesson that is not there: no request', () => {
    const r = rig({ listens: false });
    expect(r.conversation.tap()).toBe(false);
    expect(r.server.all).toHaveLength(0);
  });

  it('Space does nothing while the microphone is open (the learner\'s turn)', async () => {
    const r = rig();
    await toListening(r);
    expect(r.conversation.interrupt()).toBe(false);
    expect(r.conversation.state).toBe('listening');
    expect(r.recognisers[0]?.open).toBe(true);
  });
});

describe('ending the lesson (R1.1, R1.5, design 6 "End, or the server says the lesson ended")', () => {
  it('End while the teacher speaks: off, the clip and the turn stopped, the board\'s gesture committed, and the server is told with the lesson id', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    expect(r.conversation.end()).toBe(true);
    expect(r.conversation.state).toBe('off');
    expect(r.audio.clip('S1').stoppedBySignal).toBe(true);
    expect(turn.aborted).toBe(true);
    expect(r.target.log.at(-1)).toBe('finish:stopped');
    expect(await until(() => r.server.ends.length === 1)).toBe(true);
    expect(r.server.ends[0]?.url).toBe('/v1/lesson/end');
    expect(r.server.ends[0]?.body).toEqual({ lessonId: 'lesson-1' });
  });

  it('End while listening closes the microphone and the timer', async () => {
    const r = rig();
    await toListening(r);
    r.conversation.end();
    expect(r.conversation.state).toBe('off');
    expect(r.recognisers[0]?.open).toBe(false);
    expect(r.timer.entries[0]?.cancelled).toBe(true);
    expect(r.conversation.micOpen).toBe(false);
    expect(await until(() => r.server.ends.length === 1)).toBe(true);
  });

  it('End while paused, and End while thinking, work the same', async () => {
    const paused = rig();
    await toListening(paused);
    paused.timer.elapse();
    expect(paused.conversation.end()).toBe(true);
    expect(paused.conversation.state).toBe('off');
    expect(await until(() => paused.server.ends.length === 1)).toBe(true);

    const thinking = rig();
    thinking.conversation.start('Teach me about vectors');
    const turn = await turnOf(thinking);
    expect(thinking.conversation.end()).toBe(true);
    expect(thinking.conversation.state).toBe('off');
    expect(turn.aborted).toBe(true);
  });

  it('End when no lesson is on is refused and asks nothing', () => {
    const r = rig();
    expect(r.conversation.end()).toBe(false);
    expect(r.server.all).toHaveLength(0);
  });

  it('the transcript of the ended lesson stays until a new lesson starts, and the microphone stays shut', async () => {
    const r = rig();
    await toListening(r);
    r.conversation.end();
    expect(texts(r)).toEqual(['Teach me about vectors', 'Hello.']);
    expect(r.conversation.micOpen).toBe(false);
    await tick(40);
    expect(r.recognisers).toHaveLength(1);
  });

  it('a new lesson after End asks /start again (a new id) and clears the old transcript and plan view', async () => {
    const r = rig();
    await toListeningWithPlan(r);
    expect(r.conversation.view.plan).toEqual(PLAN);
    r.conversation.end();
    expect(r.conversation.start('Teach me about circles')).toBe(true);
    expect(r.conversation.view.plan).toEqual([]);
    expect(texts(r)).toEqual(['Teach me about circles']);
    const turn = await turnOf(r, 2);
    expect(r.server.starts).toHaveLength(2);
    expect(turn.request['lessonId']).toBe('lesson-2');
  });

  it('the server\'s done with ended: the last sentences are spoken first, then the conversation is off, and the microphone never opens', async () => {
    const r = rig();
    r.conversation.start('stop the lesson');
    const turn = await turnOf(r);
    turn.say('Well done. Today we covered vectors.');
    turn.say('We will start with scaling next time.');
    turn.done(true);
    await reach(r, 'speaking');
    await playOut(r, 'Well done. Today we covered vectors.');
    await tick(30);
    expect(r.conversation.state).toBe('speaking');
    await playOut(r, 'We will start with scaling next time.');
    await reach(r, 'off');
    expect(r.recognisers).toHaveLength(0);
    expect(r.timer.entries).toHaveLength(0);
    expect(r.conversation.micOpen).toBe(false);
    expect(r.target.log.at(-1)).toBe('finish:done');
  });

  it('after the server ended the lesson the client does not ask /v1/lesson/end (the server has already forgotten it), and the id is dropped', async () => {
    const r = rig();
    await toListening(r);
    r.recognisers[0]?.hear('ok, stop the lesson', true);
    const turn = await turnOf(r, 2);
    turn.say('Bye.');
    turn.done(true);
    await playOut(r, 'Bye.');
    await reach(r, 'off');
    await tick(40);
    expect(r.server.ends).toHaveLength(0);
    expect(r.conversation.start('again')).toBe(true);
    await turnOf(r, 3);
    expect(r.server.starts).toHaveLength(2);
  });

  it('a done with ended and no sentence ends the lesson at once', async () => {
    const r = rig();
    r.conversation.start('bye');
    (await turnOf(r)).done(true);
    await reach(r, 'off');
    expect(r.recognisers).toHaveLength(0);
  });

  it('lesson_unknown in the stream: the notice says the lesson ended and to start a new one, the conversation is off, and the server is not asked to end it', async () => {
    const r = rig();
    await toListening(r);
    r.recognisers[0]?.hear('more please', true);
    const turn = await turnOf(r, 2);
    turn.push({ error: { kind: 'lesson_unknown', message: 'This lesson has ended.' } });
    await reach(r, 'off');
    const notice = r.conversation.transcript.filter((l) => l.who === 'notice').map((l) => l.text.toLowerCase());
    expect(notice.some((t) => t.includes('start a new lesson'))).toBe(true);
    expect(r.recognisers).toHaveLength(1);
    expect(r.recognisers[0]?.open).toBe(false);
    await tick(40);
    expect(r.server.ends).toHaveLength(0);
  });

  it('lesson_unknown as the server\'s 404 on the turn is the same', async () => {
    const r = rig();
    await toListening(r);
    r.server.turnAnswer = () => json({ ok: false, kind: 'lesson_unknown', message: 'This lesson has ended.' }, 404);
    r.recognisers[0]?.hear('more please', true);
    await reach(r, 'off');
    expect(r.conversation.transcript.some((l) => l.who === 'notice' && l.text.toLowerCase().includes('start a new lesson'))).toBe(true);
    expect(r.server.ends).toHaveLength(0);
  });

  it('lesson_unknown while a sentence plays ends the lesson at once, by LE2 ("lesson_unknown ... at once")', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    turn.push({ error: { kind: 'lesson_unknown', message: 'This lesson has ended.' } });
    expect(await until(() => r.conversation.state === 'off', 500)).toBe(true);
  });

  it('a lesson that ended by lesson_unknown can be started again as a new one: a new id', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    (await turnOf(r)).push({ error: { kind: 'lesson_unknown', message: 'This lesson has ended.' } });
    await reach(r, 'off');
    expect(r.conversation.start('Teach me about circles')).toBe(true);
    expect((await turnOf(r, 2)).request['lessonId']).toBe('lesson-2');
  });
});

describe('a start that fails is a lesson that is over (LE2 invariants)', () => {
  it('the server\'s message is shown, the conversation goes off, no turn is asked, and the learner can start again', async () => {
    const r = rig();
    r.server.startAnswer = () => json({ ok: false, kind: 'model_unavailable', message: 'The teacher has no model key set.' }, 503);
    r.conversation.start('Teach me about vectors');
    await reach(r, 'off');
    expect(r.conversation.transcript.some((l) => l.who === 'notice' && l.text === 'The teacher has no model key set.')).toBe(true);
    expect(r.server.turns).toHaveLength(0);
    expect(r.conversation.micOpen).toBe(false);
    expect(r.conversation.start('Teach me about vectors')).toBe(true);
    (await turnOf(r)).done();
    await reach(r, 'listening');
  });

  it('a server that cannot be reached is a failed start too: a notice and off, not a hang in thinking', async () => {
    const r = rig();
    r.server.startAnswer = () => Promise.reject(new TypeError('connection refused'));
    r.conversation.start('Teach me about vectors');
    await reach(r, 'off');
    expect(r.conversation.transcript.some((l) => l.who === 'notice')).toBe(true);
    expect(r.server.turns).toHaveLength(0);
  });

  it('a lesson begun by the microphone that fails to start is the same', async () => {
    const r = rig();
    r.server.startAnswer = () => json({ ok: false, kind: 'model_unavailable', message: 'No key.' }, 503);
    r.conversation.listen();
    r.recognisers[0]?.hear('Teach me about vectors', true);
    await reach(r, 'off');
    expect(r.conversation.transcript.some((l) => l.text === 'No key.')).toBe(true);
  });

  it('an error in the turn that is not lesson_unknown is shown, and the lesson goes on to the learner\'s turn', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.say('One moment.');
    turn.push({ error: { kind: 'model_error', message: 'The teacher could not answer.' } });
    turn.end();
    await playOut(r, 'One moment.');
    await reach(r, 'listening');
    expect(r.conversation.transcript.some((l) => l.who === 'notice' && l.text === 'The teacher could not answer.')).toBe(true);
    expect(r.server.ends).toHaveLength(0);
  });

  it('a stream that is cut ends the turn and the lesson waits for the learner, not hangs', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.say('Half of it.');
    turn.end();
    await playOut(r, 'Half of it.');
    await reach(r, 'listening');
  });
});

describe('the plan and the current step come from `lesson` events (design 7, LE2 "plan view")', () => {
  it('the view holds the last lesson event as it came, and replaces the earlier one', async () => {
    const r = rig();
    r.conversation.start('Teach me about linear algebra');
    const turn = await turnOf(r);
    expect(r.conversation.view.plan).toEqual([]);
    turn.lesson(PLAN, 1, 'planning');
    expect(await until(() => r.conversation.view.plan.length === 5)).toBe(true);
    expect(r.conversation.view).toEqual({ plan: PLAN, step: 1, state: 'planning' });
    turn.lesson(PLAN, 2, 'teaching');
    expect(await until(() => r.conversation.view.step === 2)).toBe(true);
    expect(r.conversation.view).toEqual({ plan: PLAN, step: 2, state: 'teaching' });
    turn.lesson(['Only', 'Three', 'Steps'], 1);
    expect(await until(() => r.conversation.view.plan.length === 3)).toBe(true);
    turn.done();
  });

  it('a lesson event is applied when it arrives, whatever the state, and moves nothing in the machine', async () => {
    const r = rig();
    const turn = await toSpeaking(r);
    turn.lesson(PLAN, 1);
    expect(await until(() => r.conversation.view.plan.length === 5)).toBe(true);
    expect(r.conversation.state).toBe('speaking');
    await playOut(r, 'S1');
    turn.lesson(PLAN, 3);
    expect(await until(() => r.conversation.view.step === 3)).toBe(true);
    expect(r.faults).toEqual([]);
  });

  it('the view survives a turn, a pause and the learner\'s next words; a new lesson clears it', async () => {
    const r = rig();
    await toListeningWithPlan(r);
    expect(r.conversation.view.step).toBe(2);
    r.timer.elapse();
    expect(r.conversation.view.plan).toEqual(PLAN);
    r.conversation.type('go on');
    expect(r.conversation.view.plan).toEqual(PLAN);
    (await turnOf(r, 2)).done();
    await reach(r, 'listening');
    r.conversation.end();
    r.conversation.start('Something else');
    expect(r.conversation.view.plan).toEqual([]);
    expect(r.conversation.view.step).toBe(0);
  });

  it('the onChange hook is called when the plan changes, so the panel can draw it', async () => {
    const r = rig();
    r.conversation.start('Teach me about linear algebra');
    const turn = await turnOf(r);
    const before = r.snapshots.length;
    turn.lesson(PLAN, 1);
    expect(await until(() => r.snapshots.length > before)).toBe(true);
    turn.done();
  });
});

describe('`say` goes into the transcript, `actions` go to the board (R1, design 1, 6; LE2 "The board")', () => {
  it('each say is a teacher line, in order, after the learner\'s words', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.say('One.');
    turn.say('Two.');
    turn.say('Three.');
    turn.done();
    await until(() => r.conversation.transcript.length === 4);
    expect(r.conversation.transcript.map((l) => [l.who, l.text])).toEqual([
      ['you', 'Teach me about vectors'],
      ['teacher', 'One.'],
      ['teacher', 'Two.'],
      ['teacher', 'Three.'],
    ]);
    const ids = r.conversation.transcript.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the transcript keeps at most 60 lines, the newest', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    for (let i = 0; i < 70; i++) turn.say(`Line ${i}.`);
    turn.done();
    expect(await until(() => r.conversation.transcript.at(-1)?.text === 'Line 69.')).toBe(true);
    expect(r.conversation.transcript).toHaveLength(60);
    expect(r.conversation.transcript[0]?.text).toBe('Line 10.');
  });

  it('actions are applied to the board when they arrive, while the teacher is still speaking, and in order', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.say('A vector is an arrow.');
    turn.actions([{ op: 'write', text: 'Vector = size + direction' }]);
    turn.say('It has a size.');
    turn.actions([{ op: 'shape', kind: 'arrow' }, { op: 'write', text: 'v' }]);
    await reach(r, 'speaking');
    expect(await until(() => r.target.actionSets.length === 2)).toBe(true);
    expect(r.conversation.state).toBe('speaking');
    expect(r.target.actionSets[0]).toEqual([{ op: 'write', text: 'Vector = size + direction' }]);
    expect(r.target.actionSets[1]).toEqual([{ op: 'shape', kind: 'arrow' }, { op: 'write', text: 'v' }]);
    turn.done();
  });

  it('one answer is one gesture: begin before the first action, finish (done) once after the last, whatever the number of actions events', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.actions([{ op: 'write', text: 'a' }]);
    turn.actions([{ op: 'write', text: 'b' }]);
    turn.actions([{ op: 'write', text: 'c' }]);
    turn.say('Done.');
    turn.done();
    await playOut(r, 'Done.');
    await reach(r, 'listening');
    expect(r.target.log).toEqual(['begin', 'actions:start', 'actions:end', 'actions:start', 'actions:end', 'actions:start', 'actions:end', 'finish:done']);
  });

  it('two answers are two gestures: each turn has its own begin and finish', async () => {
    const r = rig();
    await toListening(r);
    r.recognisers[0]?.hear('go on', true);
    const second = await turnOf(r, 2);
    second.actions([{ op: 'write', text: 'b' }]);
    second.done();
    await reach(r, 'listening');
    expect(r.target.count('begin')).toBe(2);
    expect(r.target.count('finish:done')).toBe(2);
    expect(r.target.count('finish:stopped')).toBe(0);
  });

  it('a barge-in commits the gesture once as stopped, and the stopped turn is not finished a second time', async () => {
    const r = rig();
    await toSpeaking(r);
    r.target.log.length = 0;
    r.conversation.tap();
    await tick(40);
    expect(r.target.log).toEqual(['finish:stopped']);
  });

  it('actions that wait for the board when a barge-in comes: the conversation does not hang, and the old turn\'s later actions are not run', async () => {
    const r = rig();
    r.target.actionsDelay = 60;
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.actions([{ op: 'write', text: 'slow' }]);
    turn.say('Hi.');
    await reach(r, 'speaking');
    r.conversation.tap();
    turn.actions([{ op: 'write', text: 'late' }]);
    await tick(120);
    expect(r.target.actionSets.flat()).not.toContainEqual({ op: 'write', text: 'late' });
    expect(r.conversation.state).toBe('listening');
  });

  it('every turn sends the board as it is now: the second request carries the board of that moment', async () => {
    const r = rig();
    await toListening(r);
    r.target.boardNow = { items: [{ id: 'shape:n1', kind: 'text' }, { id: 'shape:n2', kind: 'arrow' }], more: 3, page: 'page-2' };
    r.recognisers[0]?.hear('next', true);
    const second = await turnOf(r, 2);
    expect(second.request['board']).toEqual(r.target.boardNow);
    expect(r.server.starts[0]?.body['board']).toEqual({ items: [{ id: 'shape:a', kind: 'text' }], more: 0, page: 'page-1' });
  });

  it('a junk line on the wire ends the turn with a notice and the lesson waits for the learner, not a hang', async () => {
    const r = rig();
    r.conversation.start('Teach me about vectors');
    const turn = await turnOf(r);
    turn.push({ hello: 'world' });
    await reach(r, 'listening');
    expect(r.conversation.transcript.some((l) => l.who === 'notice')).toBe(true);
  });
});
