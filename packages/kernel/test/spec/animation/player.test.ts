/**
 * The player (animation-time design 3 and 4): modes, frame delta, end and loop, seek, frame steps, speed, time sources,
 * beats, and determinism.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_STEP, MAX_FRAME_DELTA, playerOf } from '@incantly/kernel';
import type { PlayerEvent } from '@incantly/kernel';
import { fig, manualClock, pt } from './helpers';

const CIRCLE = ['@clock 0..10', 'P = (cos(t), sin(t))'];

function playing(lines = CIRCLE) {
  const f = fig(lines);
  const clock = manualClock();
  const p = playerOf(f, clock);
  const events: PlayerEvent[] = [];
  p.subscribe((e) => events.push(e));
  return { f, clock, p, events };
}

describe('3.2 state and modes', () => {
  it('a new player is stopped at the start of the film, at speed 1, with the film length as duration', () => {
    const { p } = playing();
    expect(p.state).toMatchObject({ mode: 'stopped', t: 0, rate: 1, duration: 10, loop: null, source: 'wall' });
  });
  it('without @clock the duration is Infinity', () => {
    expect(playerOf(fig(['P = (t, 0)'])).state.duration).toBe(Infinity);
  });
  it('play, pause and toggle change the mode and emit mode events', () => {
    const { p, events } = playing();
    p.play();
    expect(p.state.mode).toBe('playing');
    p.pause();
    expect(p.state.mode).toBe('paused');
    p.toggle();
    expect(p.state.mode).toBe('playing');
    expect(events.filter((e) => e.kind === 'mode').map((e) => (e as { mode: string }).mode)).toEqual(['playing', 'paused', 'playing']);
  });
  it('needsFrame is true only while playing (zero idle cost)', () => {
    const { p } = playing();
    expect(p.needsFrame()).toBe(false);
    p.play();
    expect(p.needsFrame()).toBe(true);
    p.pause();
    expect(p.needsFrame()).toBe(false);
  });
});

describe('3.3 rule 3: the frame delta', () => {
  it('t advances by the source time between frames, and the figure follows t', () => {
    const { f, clock, p } = playing();
    p.play();
    clock.set(0.05);
    p.frame();
    expect(p.state.t).toBeCloseTo(0.05, 12);
    expect(pt(f, 'P').x).toBeCloseTo(Math.cos(0.05), 12);
  });
  it('a long gap gives one capped step of 0.1 s, not a fast-forward', () => {
    const { clock, p } = playing();
    p.play();
    clock.set(30);
    p.frame();
    expect(MAX_FRAME_DELTA).toBe(0.1);
    expect(p.state.t).toBeCloseTo(0.1, 12);
  });
  it('the speed multiplies the delta, and a negative speed plays backward', () => {
    const { clock, p } = playing();
    p.seek(5);
    expect('kind' in p.setRate(-2)).toBe(false);
    p.play();
    clock.set(0.05);
    p.frame();
    expect(p.state.t).toBeCloseTo(4.9, 12);
  });
  it('a speed outside 0.1..4 (either way) is refused', () => {
    const { p } = playing();
    expect((p.setRate(5) as { kind?: string }).kind).toBe('bad_argument');
    expect((p.setRate(0.05) as { kind?: string }).kind).toBe('bad_argument');
    expect(p.state.rate).toBe(1);
  });
  it('three capped frames in a row report that the figure fell behind', () => {
    const { clock, p, events } = playing();
    p.play();
    for (let k = 1; k <= 3; k++) {
      clock.set(k);
      p.frame();
    }
    expect(events.some((e) => e.kind === 'behind')).toBe(true);
  });
});

describe('3.3 rule 1: the end and loops', () => {
  it('reaching the end emits end, pauses, and t stays at the duration', () => {
    const { clock, p, events } = playing();
    p.seek(9.95);
    p.play();
    clock.set(0.08);
    p.frame();
    expect(p.state.t).toBe(10);
    expect(p.state.mode).toBe('paused');
    expect(events.some((e) => e.kind === 'end')).toBe(true);
  });
  it('with a loop, t wraps to the loop start instead of ending', () => {
    const { clock, p } = playing();
    expect('kind' in p.setLoop({ from: 2, to: 4 })).toBe(false);
    p.seek(3.95);
    p.play();
    clock.set(0.1);
    p.frame();
    expect(p.state.t).toBeCloseTo(2.05, 12);
    expect(p.state.mode).toBe('playing');
  });
  it('a loop outside the film or empty is refused', () => {
    const { p } = playing();
    expect((p.setLoop({ from: 4, to: 2 }) as { kind?: string }).kind).toBe('bad_argument');
    expect((p.setLoop({ from: 2, to: 20 }) as { kind?: string }).kind).toBe('bad_argument');
  });
  it('play at the end starts again from the beginning', () => {
    const { p } = playing();
    p.seek(10);
    p.play();
    expect(p.state.t).toBe(0);
  });
});

describe('3.3 rule 5: seeking', () => {
  it('seek sets t, runs one pass and emits seek with its reason', () => {
    const { f, p, events } = playing();
    p.seek(2, 'beat');
    expect(pt(f, 'P').x).toBeCloseTo(Math.cos(2), 12);
    expect(events.at(-1)).toEqual({ kind: 'seek', t: 2, why: 'beat' });
  });
  it('a seek outside the film is clamped and says so (seek_clamped)', () => {
    const { p } = playing();
    p.seek(50);
    expect(p.state.t).toBe(10);
    expect(p.notices.map((n) => n.kind)).toEqual(['seek_clamped']);
  });
  it('seeking is free of history: the same t gives the same figure however it was reached', () => {
    const { f, clock, p } = playing();
    p.play();
    for (let k = 1; k <= 90; k++) {
      clock.set(k / 60);
      p.frame();
    }
    const played = pt(f, 'P');
    const g = fig(CIRCLE);
    playerOf(g).seek(p.state.t);
    expect(pt(g, 'P')).toEqual(played);
  });
});

describe('3.4 frame steps', () => {
  it('stepFrames pauses and moves by n / 60 s', () => {
    const { p } = playing();
    p.play();
    p.stepFrames(3);
    expect(p.state.mode).toBe('paused');
    expect(p.state.t).toBeCloseTo(3 * FRAME_STEP, 12);
    p.stepFrames(-1);
    expect(p.state.t).toBeCloseTo(2 * FRAME_STEP, 12);
  });
});

describe('3.3 rule 2: time sources', () => {
  it('switching the source never jumps t', () => {
    const { clock, p } = playing();
    p.play();
    clock.set(0.05);
    p.frame();
    const audio = manualClock(1000);
    p.setSource(audio, 'external');
    audio.set(1000.02);
    p.frame();
    expect(p.state.t).toBeCloseTo(0.07, 12);
    expect(p.state.source).toBe('external');
  });
});

describe('3.1 beats', () => {
  it('crossing the start of a beat emits beat with its index, and bt counts from the beat', () => {
    const { f, p, events } = playing(['@clock 0..10', 'b = bt']);
    f.setBeats([0, 2, 5]);
    p.seek(3);
    expect(events.some((e) => e.kind === 'beat' && e.index === 1)).toBe(true);
    expect(f.value('b')).toBeCloseTo(1, 12);
  });
});

describe('Play() and Pause() as lines (core 6.6)', () => {
  it('Play() and Pause() set the player mode', () => {
    const f = fig(CIRCLE);
    expect(f.apply('Play()').ok).toBe(true);
    expect(playerOf(f).state.mode).toBe('playing');
    expect(f.apply('Pause()').ok).toBe(true);
    expect(playerOf(f).state.mode).toBe('paused');
  });
});
