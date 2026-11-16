# Sound: design

The feature design is `docs/features/sound/design.md`. This file says where each part lives.

## Kernel (`packages/kernel/src/commands/sound/`)

- `registerSound(registry)` adds `Tone`, `Noise`, `Melody` (objects, type `Sound`) and `Note`, `Sonify`, `Mute`,
  `Unmute` (actions, group `sound`).
- `with on = cond` is read as the named argument `on = cond` (a line rewrite, like the CAS `domain`), so the condition
  is an ordinary formula and part of the value.
- `note`, `midi` and `semitones` are built-in functions (`language/notes.ts` parses note names).
- Notes and sweeps are kept in a per-figure log of `{ at, … }` in film time. `soundsAt(figure, t)` returns what plays
  at film time `t`: every defined, unmuted `Sound` object whose `on` holds, the melody step at `t`, and the notes and
  sweeps under way. The design says the kernel emits changed sound values each frame; reading `soundsAt` once a frame
  gives the player the same values and keeps the kernel free of audio and of time.
- Limits are the table of design 5; the 8-sounds limit is a line check.

## Playback (`packages/audio`)

- `SoundEngine` takes what `soundsAt` returns each frame and drives a `Backend`. `ToneBackend` (Tone.js, its own
  chunk) is the real one; tests use a recording backend, so no Web Audio is needed in Node.
- One engine per page: one context, one limiter, a master gain.

## Studio

- A speaker button and level bars in the graph, a mute toggle in `Sound` rows, master volume and start-with-sound in
  settings.
