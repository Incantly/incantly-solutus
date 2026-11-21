/**
 * Note names and pitches (sound design 2): `note("A4")` is 440 Hz, `midi(69)` is 440 Hz, `semitones(f, n)` moves `f` by
 * `n` equal-tempered semitones. A4 = 440 Hz, MIDI 69.
 */

const STEPS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The MIDI number of a note name such as `C4`, `C#4`, `Db4` or `A-1`, or undefined when it is not a note name. */
export function midiOfNote(name: string): number | undefined {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d{1,2})$/.exec(name.trim());
  if (!m) return undefined;
  const letter = (m[1] as string).toUpperCase();
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const octave = Number(m[3]);
  if (octave < -1 || octave > 9) return undefined;
  const n = (octave + 1) * 12 + (STEPS[letter] as number) + acc;
  return n >= 0 && n <= 127 ? n : undefined;
}

export function midiToFrequency(n: number): number {
  return 440 * 2 ** ((n - 69) / 12);
}

export function noteFrequency(name: string): number | undefined {
  const n = midiOfNote(name);
  return n === undefined ? undefined : midiToFrequency(n);
}

export function semitonesUp(f: number, n: number): number {
  return f * 2 ** (n / 12);
}

export const NOTE_NAME_HINT = 'Use a letter A to G, an optional # or b, and an octave, like C#4.';
