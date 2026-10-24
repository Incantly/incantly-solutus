/** The bounds every sound is held to, by the runtime and again by the host that plays it. */
export const SOUND_LIMITS = {
  /** Hertz. */
  minFrequency: 20,
  maxFrequency: 20_000,
  /** Tones and noises sounding at once, per figure. */
  voices: 8,
  /** Seconds. */
  minNote: 0.02,
  maxNote: 2,
  /** Notes per second, per figure; more are dropped. */
  notesPerSecond: 24,
} as const;
