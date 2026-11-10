# Sound: design

Status: accepted for building. Kernel side in `packages/kernel` (sound objects are values like any other); playback in a new package `packages/audio`, built on [Tone.js](https://github.com/Tonejs/Tone.js) (MIT), loaded on demand. Learns from the legacy v1 sound kit (`packages/core/src/kits/sound/` and `packages/core/src/renderer/sound.ts`), which we wrote.

## 1. What it does

Lets a figure make sound that follows the maths: hear a wave's pitch rise as its frequency slider moves, hear a function as a sweep, hear beats when two tones are close, tick a metronome on a pendulum's swing, play notes of a scale as the teacher builds it.

Sub-features:

1. **Tones** whose frequency, loudness and pan are formulas, updated live.
2. **Noise** (white, pink, brown) with a formula loudness.
3. **Notes**: one-shot sounds of a set length, fired by an action, a handler or a time.
4. **Sonify a function**: play `f` over an interval as a pitch sweep.
5. **Melodies**: a list of notes played on the film clock.
6. Note names and MIDI numbers as built-in functions.
7. A global sound switch, off by default, that is also the user gesture the browser needs.
8. Sound in film export, rendered offline in step with the clock.

## 2. Language

Objects (named, like every object):

| Command | Forms | Type |
|---|---|---|
| `Tone` | `(frequency: Number)`, `(frequency: Number, gain: Number)`, named `wave = "sine" \| "square" \| "sawtooth" \| "triangle"`, `pan: Number` (−1..1) | `Sound` |
| `Noise` | `(color: Text)`, `(color: Text, gain: Number)`, named `pan` | `Sound` |
| `Melody` | `(notes: List<Number>, beat: Number)`: frequencies, one per beat of `beat` seconds; named `gain`, `wave`, `loop: Bool` | `Sound` |

Actions:

| Command | Effect |
|---|---|
| `Note(frequency, seconds)` | One note now; named `gain`, `wave` |
| `Sonify(f, a, b, seconds)` | Plays `f(x)` for `x` from `a` to `b`, mapped to pitch (named `low = 220`, `high = 880`); undefined parts are silent |
| `Mute(s)`, `Unmute(s)` | One sound |

Built-in functions: `note("A4")` gives 440, `midi(69)` gives 440, `semitones(f, n)` gives `f` moved by `n` semitones.

Style property `on = <Bool formula>`: the sound plays only while the condition holds, for example `metronome with on = abs(θ) < 0.02`.

Examples:

```text
f = 440 in 110..880
a = Tone(f, 0.3)
b = Tone(f + 3, 0.3)            # beats at 3 per second
scale = Melody([note("C4"), note("D4"), note("E4"), note("F4"), note("G4")], 0.4)
```

## 3. Model

- A `Sound` value is plain data: `{ kind: 'tone' | 'noise' | 'melody', frequency?, gain, pan, wave?, color?, notes?, beat?, loop?, on }`. The kernel computes it like any value, so formulas, sliders, `t` and states all drive it.
- The kernel never touches audio. It emits the sound values that changed, at most once per frame, in the same event stream the view reads.
- Notes, `Sonify` and melody steps are timed on the **film clock** `t`, not the wall clock, so a film that seeks or replays sounds the same each time.

## 4. Playback (`packages/audio`)

1. Loaded the first time a figure on the page contains a `Sound` or a sound action.
2. **Off by default.** Nothing plays until the reader turns sound on, from a click. That click is the gesture the browser requires to start audio.
3. **One audio context and one limiter per page.** Every figure's sounds go through one master limiter, so many figures cannot add up to a loud one.
4. **Smooth changes.** Each value change ramps over 10 ms, so a dragged slider never clicks. Sounds start from and end at silence.
5. **Clock sync.** Timed events are scheduled on Tone's transport, which follows the film clock: play, pause and seek on the film move the transport. A seek clears scheduled notes and schedules again from the new time.
6. **Visibility.** A figure that is paused by the scheduler (`docs/design/performance.md`) fades its sounds out over 50 ms. Resuming fades them back in.
7. **Export.** Film export renders the same sound values offline (Tone's offline rendering) for the film's length, so the audio track matches the frames exactly.
8. **Mobile.** Tone.js runs in mobile browsers and WebViews. A native app later reads the same sound values and plays them with its own audio engine; nothing in the kernel changes.

## 5. Limits

Kept from the legacy kit:

| Limit | Value |
|---|---|
| Frequency | 20 to 20,000 Hz; outside is clamped, with a notice |
| Sounds at once, per figure | 8 |
| Note length | 0.02 to 2 s |
| Notes per second, per figure | 24; extra notes are dropped, with a notice |
| Gain | 0 to 1 per sound; the page limiter caps the total |

## 6. Better than GeoGebra

- Sounds are objects with formulas, not one-off script calls, so they follow the figure live.
- Timing follows the film clock, so sound is exact on seek, replay and export.
- One limiter per page and silence by default protect the reader's ears.

## Sources studied

- Our legacy sound kit on `legacy/v1`: `packages/core/src/kits/sound/sound.ts`, `limits.ts`, and `packages/core/src/renderer/sound.ts`.
- GeoGebra's manual page for the PlaySound command, for the idea of playing a function as sound.
- Tone.js documentation for transport, offline rendering and synths.
