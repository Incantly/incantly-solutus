/** Sound, kernel side (.kiro/specs/sound R1 to R3; docs/features/sound). */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, SOUND_LIMITS, geometry, isMuted, isSoundValue, registerAnimation, registerFunctions, registerNumbers, registerSound, soundsAt, soundEvents } from '../../../src/index';
import type { SoundValue } from '../../../src/index';

function fig(lines: readonly string[] = []): Figure {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerSound(r);
  const f = new Figure({ commands: r });
  for (const l of lines) {
    const x = f.apply(l);
    if (!x.ok) throw new Error(`${l}: ${x.message}`);
  }
  return f;
}
const sound = (f: Figure, n: string): SoundValue => {
  const v = f.value(n);
  if (!isSoundValue(v)) throw new Error(`${n} is not a sound`);
  return v;
};

describe('sound objects (R1)', () => {
  it('Tone, Noise and Melody make plain Sound values', () => {
    const f = fig(['a = Tone(440, 0.3)', 'n = Noise("pink", 0.1, pan = -0.5)', 'm = Melody([262, 294, 330], 0.4, loop = true)']);
    expect(sound(f, 'a')).toEqual({ schema: 'Sound', kind: 'tone', frequency: 440, gain: 0.3, pan: 0, wave: 'sine', on: true });
    expect(sound(f, 'n')).toMatchObject({ kind: 'noise', color: 'pink', gain: 0.1, pan: -0.5 });
    expect(sound(f, 'm')).toMatchObject({ kind: 'melody', notes: [262, 294, 330], beat: 0.4, loop: true });
    expect(f.get('a')?.type).toBe('Sound');
    expect(JSON.parse(JSON.stringify(sound(f, 'm')))).toEqual(sound(f, 'm'));
  });

  it('formulas drive the value live', () => {
    const f = fig(['fr = 440 in 110..880', 'a = Tone(fr, 0.3)', 'b = Tone(fr + 3, 0.3, wave = "square")']);
    f.setFree('fr', 220);
    f.flush();
    expect(sound(f, 'a').frequency).toBe(220);
    expect(sound(f, 'b')).toMatchObject({ frequency: 223, wave: 'square' });
  });

  it('with on = <condition> plays only while it holds (R1.3)', () => {
    const f = fig(['k = 1 in -1..1', 'a = Tone(440) with on = k > 0']);
    expect(sound(f, 'a').on).toBe(true);
    f.setFree('k', -0.5);
    f.flush();
    expect(sound(f, 'a').on).toBe(false);
    expect(soundsAt(f).sounds).toEqual([]);
  });

  it('wave and colour words are checked (R1.4)', () => {
    const f = fig();
    const r = f.apply('a = Tone(440, wave = "zigzag")');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('bad_option');
      expect(r.expected).toEqual(['"sine"', '"square"', '"sawtooth"', '"triangle"']);
    }
    const n = f.apply('n = Noise("purple")');
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.kind).toBe('bad_option');
  });

  it('an undefined frequency is silent until it is defined again (R3.5)', () => {
    const f = fig(['k = 1 in -2..2', 'a = Tone(440 * sqrt(k))']);
    f.setFree('k', -1);
    f.flush();
    expect(f.get('a')?.cell.defined).toBe(false);
    expect(soundsAt(f).sounds).toEqual([]);
    f.setFree('k', 1);
    f.flush();
    expect(soundsAt(f).sounds).toHaveLength(1);
  });
});

describe('limits (R3)', () => {
  it('frequency is clamped to 20..20000 Hz with a notice; gain to 0..1; pan to -1..1', () => {
    const f = fig();
    const r = f.apply('a = Tone(50000, 3, pan = 4)');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices.map((n) => n.kind)).toContain('out_of_range');
    expect(sound(f, 'a')).toMatchObject({ frequency: 20000, gain: 1, pan: 1 });
  });

  it('a 9th sound is refused with limit', () => {
    const f = fig(Array.from({ length: 8 }, (_, i) => `s${i} = Tone(${200 + i * 10})`));
    const r = f.apply('s8 = Tone(300)');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('limit');
      expect(r.hint).toBe('A figure plays at most 8 sounds at once. Mute or delete one.');
    }
    expect(f.apply('s0 = Tone(999)').ok).toBe(true);
  });

  it('more than 24 notes in a second of film time are dropped with a notice', () => {
    const f = fig();
    for (let i = 0; i < SOUND_LIMITS.notesPerSecond; i++) expect(f.apply('Note(440, 0.1)').ok).toBe(true);
    const r = f.apply('Note(440, 0.1)');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices.map((n) => n.kind)).toContain('rate_limited');
    expect(soundEvents(f)).toHaveLength(24);
  });

  it('a note lasts 0.02 to 2 s', () => {
    const f = fig();
    f.apply('Note(440, 9)');
    f.apply('Note(440, 0)');
    expect(soundEvents(f).map((e) => e.seconds)).toEqual([2, 0.02]);
  });
});

describe('notes and functions (R2)', () => {
  it('note, midi and semitones', () => {
    const f = fig(['a4 = note("A4")', 'c4 = note("C4")', 'cs = note("C#4")', 'db = note("Db4")', 'm = midi(69)', 'up = semitones(440, 12)', 'fifth = semitones(440, 7)']);
    expect(f.value('a4')).toBe(440);
    expect(f.value('c4') as number).toBeCloseTo(261.6256, 3);
    expect(f.value('cs')).toBe(f.value('db'));
    expect(f.value('m')).toBe(440);
    expect(f.value('up')).toBe(880);
    expect(f.value('fifth') as number).toBeCloseTo(659.255, 2);
  });

  it('a note name that is not one is bad_note_name with the hint', () => {
    const r = fig().apply('nn = note("H4")');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('bad_note_name');
      expect(r.message).toBe('"H4" is not a note name.');
      expect(r.hint).toBe('Use a letter A to G, an optional # or b, and an octave, like C#4.');
      expect(r.col).toBe(11);
    }
  });

  it('Note(note("A4"), 1) is the fixed form of the model recovery in agent.md', () => {
    const f = fig();
    expect(f.apply('Note("A4", 1)').ok).toBe(false);
    expect(f.apply('Note(note("A4"), 1)').ok).toBe(true);
  });

  it('Mute and Unmute', () => {
    const f = fig(['a = Tone(440)']);
    expect(f.apply('Mute(a)').ok).toBe(true);
    expect(isMuted(f, f.get('a')?.id as never)).toBe(true);
    expect(soundsAt(f).sounds).toEqual([]);
    f.apply('Unmute(a)');
    expect(soundsAt(f).sounds).toHaveLength(1);
  });
});

describe('film time (R3.1)', () => {
  it('a note plays from the film time it ran at, the same on every replay', () => {
    const f = fig(['@clock 0..10']);
    f.setClock(2);
    f.apply('Note(440, 1)');
    const at = (t: number): number => soundsAt(f, t).sounds.length;
    expect([at(1.9), at(2), at(2.5), at(2.99), at(3)]).toEqual([0, 1, 1, 1, 0]);
    // seek back and play again: the same
    f.setClock(0);
    expect(at(2.5)).toBe(1);
  });

  it('a melody plays the note of the beat t falls in; it stops unless it loops', () => {
    const f = fig(['@clock 0..10', 'm = Melody([262, 294, 330], 0.5)', 'r = Melody([100, 200], 0.5, loop = true)']);
    const pitch = (n: string, t: number): number | undefined => soundsAt(f, t).sounds.find((s) => s.name === n)?.frequency;
    expect([pitch('m', 0.1), pitch('m', 0.6), pitch('m', 1.1), pitch('m', 1.6)]).toEqual([262, 294, 330, undefined]);
    expect([pitch('r', 1.1), pitch('r', 1.6)]).toEqual([100, 200]);
  });

  it('Sonify plays f as a pitch sweep from low to high; undefined parts are silent', () => {
    const f = fig(['@clock 0..10', 'g(x) = x', 'h(x) = sqrt(x)']);
    expect(f.apply('Sonify(g, 0, 1, 2)').ok).toBe(true);
    const at = (t: number): number | undefined => soundsAt(f, t).sounds[0]?.frequency;
    expect(at(0) as number).toBeCloseTo(220, 3);
    expect(at(1.999) as number).toBeGreaterThan(860);
    expect(at(1) as number).toBeCloseTo(440, -1);
    expect(at(2)).toBeUndefined();
    const f2 = fig(['@clock 0..10', 'h(x) = sqrt(x)']);
    f2.apply('Sonify(h, -1, 1, 2, low = 300, high = 600)');
    expect(soundsAt(f2, 0.5).sounds).toEqual([]);
    expect(soundsAt(f2, 1.9).sounds[0]?.frequency as number).toBeGreaterThan(550);
  });

  it('a figure with no sound says so', () => {
    expect(soundsAt(fig(['A = (1, 2)'])).hasSound).toBe(false);
    expect(soundsAt(fig(['a = Tone(440) with on = false'])).hasSound).toBe(true);
  });

  it('the text of a sound row', () => {
    const f = fig(['a = Tone(440, 0.3)', 'n = Noise("brown", 0.2)']);
    expect(f.get('a')?.cell.defined && f.get('a')?.type).toBe('Sound');
  });
});
