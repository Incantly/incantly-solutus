# Sound: requirements

Area: `docs/features/sound/` (`design.md`, `ui.md`, `agent.md`, `errors.md`). Kernel side in
`packages/kernel/src/commands/sound/`, playback in `packages/audio` (Tone.js, loaded on demand), screens in
`apps/studio`. Branch: `feat/sound-*`.

### R1. Sound objects (design 2, 3)

1. `Tone(frequency)`, `Tone(frequency, gain)` with named `wave` and `pan`; `Noise(color)`, `Noise(color, gain)` with
   named `pan`; `Melody(notes, beat)` with named `gain`, `wave`, `loop` SHALL make a `Sound` value.
2. A `Sound` value SHALL be plain data `{ kind, frequency?, gain, pan, wave?, color?, notes?, beat?, loop?, on }`, computed
   like any value, so sliders, `t` and states drive it.
3. `with on = <Bool formula>` SHALL make the sound play only while the condition holds.
4. `wave` SHALL be `sine`, `square`, `sawtooth` or `triangle`; `color` SHALL be `white`, `pink` or `brown`; other words
   give `bad_option` with the allowed words.

### R2. Actions and functions (design 2)

1. `Note(frequency, seconds)` with named `gain`, `wave` SHALL play one note from the film time it runs at.
2. `Sonify(f, a, b, seconds)` with named `low = 220`, `high = 880` SHALL play `f` from `a` to `b` as a pitch sweep;
   undefined parts are silent.
3. `Mute(s)` and `Unmute(s)` SHALL silence and restore one sound.
4. `note("A4")` = 440, `midi(69)` = 440, `semitones(f, n)` = `f` moved by `n` semitones. A note name that is not one gives
   `bad_note_name` with the hint of errors.md.

### R3. Film time and limits (design 3, 5; errors)

1. Notes, sweeps and melody steps SHALL be timed on the film clock: what plays at film time `t` is a pure function of the
   figure and `t`, so seek and replay sound the same.
2. Frequency outside 20 to 20,000 Hz SHALL be clamped with an `out_of_range` notice; gain SHALL be 0 to 1; pan −1 to 1.
3. A 9th sound in one figure SHALL be refused with `limit` and the hint of errors.md.
4. Note length SHALL be 0.02 to 2 s; more than 24 notes in one second of film time are dropped with a `rate_limited`
   notice.
5. An undefined frequency or gain SHALL make the sound silent until it is defined again.

### R4. Playback (design 4; errors)

1. `packages/audio` SHALL load on demand, the first time a figure has a sound.
2. Sound SHALL be off by default; turning it on is the user gesture.
3. One audio context and one limiter SHALL serve the page; every change SHALL ramp over 10 ms; sounds start and end at
   silence.
4. Play, pause and seek on the film SHALL move what is heard; a paused figure fades out over 50 ms.
5. No Web Audio, or a failed load, SHALL give `audio_unavailable`: sound objects stay values, the speaker is hidden.

### R5. Studio (ui)

1. A speaker button, off by default, on a figure that has a sound; bars that move with the level while playing.
2. A `Sound` row shows its frequency and gain and a mute toggle.
3. Settings: master volume, "Start with sound on" (off by default).
4. Examples: beats, a scale, a sonified function, a pendulum metronome. Screenshots.

### R6. Export (design 4.7)

1. Film export SHALL render the same sounds offline for the film's length. Marked `to be implemented` until the studio
   has film export.
