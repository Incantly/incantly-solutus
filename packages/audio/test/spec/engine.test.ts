/** The sound engine (.kiro/specs/sound R4), with a recording backend so no Web Audio is needed. */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, registerNumbers, registerSound, soundsAt } from '@incantly/kernel';
import type { PlayingSound } from '@incantly/kernel';
import { PAUSE_FADE_S, RAMP_S, SoundEngine, VOICES_PER_FIGURE } from '../../src/index';
import type { Backend, Voice, VoiceParams } from '../../src/index';

class Recorder implements Backend {
  readonly log: string[] = [];
  readonly live = new Map<string, VoiceParams>();
  started = 0;
  refuse = false;
  master = 0;
  start(): Promise<void> {
    this.started++;
    return this.refuse ? Promise.reject(new Error('blocked')) : Promise.resolve();
  }
  voice(s: PlayingSound): Voice {
    this.log.push(`new ${s.key}`);
    return {
      set: (p, r) => {
        this.live.set(s.key, p);
        this.log.push(`set ${s.key} ${p.frequency ?? s.color} ${p.gain} ramp=${r}`);
      },
      stop: (f) => {
        this.live.delete(s.key);
        this.log.push(`stop ${s.key} fade=${f}`);
      },
    };
  }
  setMaster(g: number): void {
    this.master = g;
  }
  level(): number {
    return this.live.size > 0 ? 0.5 : 0;
  }
  close(): void {
    this.log.push('close');
  }
}

const fig = (lines: string[]): Figure => {
  const r = new CommandRegistry();
  registerNumbers(r);
  registerSound(r);
  const f = new Figure({ commands: r });
  for (const l of lines) {
    const x = f.apply(l);
    if (!x.ok) throw new Error(x.message);
  }
  return f;
};

describe('the sound engine (R4)', () => {
  it('is off until enabled; nothing is loaded before (R4.1, R4.2)', async () => {
    let loads = 0;
    const rec = new Recorder();
    const e = new SoundEngine(() => {
      loads++;
      return Promise.resolve(rec);
    });
    const ch = e.channel();
    const f = fig(['a = Tone(440, 0.3)']);
    ch.update(soundsAt(f));
    expect(e.state).toBe('off');
    expect(loads).toBe(0);
    expect(rec.log).toEqual([]);
    expect(ch.hasSound()).toBe(true);
    expect(await e.enable()).toBe('on');
    expect(loads).toBe(1);
    expect(rec.master).toBe(0.8);
    ch.update(soundsAt(f));
    expect(rec.log).toEqual(['new 1', `set 1 440 0.3 ramp=${RAMP_S}`]);
  });

  it('every change ramps; a sound that goes fades out (R4.3)', async () => {
    const rec = new Recorder();
    const e = new SoundEngine(() => Promise.resolve(rec));
    await e.enable();
    const ch = e.channel();
    const f = fig(['fr = 440 in 100..900', 'a = Tone(fr, 0.3)']);
    ch.update(soundsAt(f));
    f.setFree('fr', 550);
    f.flush();
    ch.update(soundsAt(f));
    f.apply('Delete(a)');
    ch.update(soundsAt(f));
    expect(rec.log.slice(-3)).toEqual([`set 2 440 0.3 ramp=${RAMP_S}`, `set 2 550 0.3 ramp=${RAMP_S}`, `stop 2 fade=${RAMP_S}`]);
  });

  it('a paused figure fades out over 50 ms and comes back on resume (R4.4)', async () => {
    const rec = new Recorder();
    const e = new SoundEngine(() => Promise.resolve(rec));
    await e.enable();
    const ch = e.channel();
    const f = fig(['a = Tone(300)']);
    ch.update(soundsAt(f));
    ch.pause();
    expect(rec.log.at(-1)).toBe(`stop 1 fade=${PAUSE_FADE_S}`);
    ch.update(soundsAt(f));
    expect(rec.live.size).toBe(0);
    ch.resume();
    expect(rec.live.size).toBe(1);
  });

  it('play, pause and seek on the film move what is heard (R4.4)', async () => {
    const rec = new Recorder();
    const e = new SoundEngine(() => Promise.resolve(rec));
    await e.enable();
    const ch = e.channel();
    const f = fig(['@clock 0..10', 'm = Melody([200, 300], 1)']);
    ch.update(soundsAt(f, 0.2));
    expect([...rec.live.values()].map((p) => p.frequency)).toEqual([200]);
    ch.update(soundsAt(f, 1.2));
    expect([...rec.live.values()].map((p) => p.frequency)).toEqual([300]);
    ch.update(soundsAt(f, 0.5));
    expect([...rec.live.values()].map((p) => p.frequency)).toEqual([200]);
    ch.update(soundsAt(f, 5));
    expect(rec.live.size).toBe(0);
  });

  it('at most 8 voices per figure', async () => {
    const rec = new Recorder();
    const e = new SoundEngine(() => Promise.resolve(rec));
    await e.enable();
    const ch = e.channel();
    const f = fig(['@clock 0..10', ...Array.from({ length: 8 }, (_, i) => `s${i} = Tone(${200 + i})`)]);
    f.apply('Note(900, 1)');
    ch.update(soundsAt(f));
    expect(rec.live.size).toBe(VOICES_PER_FIGURE);
  });

  it('turning sound off fades everything; turning it on again resumes', async () => {
    const rec = new Recorder();
    const e = new SoundEngine(() => Promise.resolve(rec));
    await e.enable();
    const ch = e.channel();
    const f = fig(['a = Tone(300)']);
    ch.update(soundsAt(f));
    e.disable();
    expect(e.state).toBe('off');
    expect(rec.live.size).toBe(0);
    await e.enable();
    ch.update(soundsAt(f));
    expect(rec.live.size).toBe(1);
  });

  it('a refused start is audio_blocked; a failed load is audio_unavailable (R4.5)', async () => {
    const rec = new Recorder();
    rec.refuse = true;
    const blocked = new SoundEngine(() => Promise.resolve(rec));
    expect(await blocked.enable()).toBe('blocked');
    expect(blocked.problem?.kind).toBe('audio_blocked');
    rec.refuse = false;
    expect(await blocked.enable()).toBe('on');
    const gone = new SoundEngine(() => Promise.reject(new Error('no Web Audio')));
    expect(await gone.enable()).toBe('unavailable');
    expect(gone.problem).toEqual({ kind: 'audio_unavailable', message: 'Sound is not available in this browser.' });
    expect(await gone.enable()).toBe('unavailable');
  });

  it('master volume and the level for the speaker bars', async () => {
    const rec = new Recorder();
    const e = new SoundEngine(() => Promise.resolve(rec));
    expect(e.level()).toBe(0);
    await e.enable();
    e.setVolume(0.4);
    expect(rec.master).toBe(0.4);
    e.setVolume(9);
    expect(e.masterVolume).toBe(1);
    const ch = e.channel();
    ch.update(soundsAt(fig(['a = Tone(300)'])));
    expect(e.level()).toBe(0.5);
  });

  it('a note heard while the film clock stands still still ends (eventsAt)', async () => {
    const f = fig(['@clock 0..10']);
    f.apply('Note(440, 0.5)');
    expect(soundsAt(f, 0, 0.2).sounds).toHaveLength(1);
    expect(soundsAt(f, 0, 0.6).sounds).toHaveLength(0);
  });
});
