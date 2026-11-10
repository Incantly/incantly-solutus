# Sound: errors

All errors use the format in `docs/features/errors/design.md`.

## Check-time errors

| Kind | When | Hint |
|---|---|---|
| `bad_option` | `wave` or `color` is not one of the listed words | Lists the allowed words |
| `bad_note_name` | `note("H4")` or another name that is not a note | "Use a letter A to G, an optional # or b, and an octave, like C#4" |
| `limit` | A 9th sound in one figure | "A figure plays at most 8 sounds at once. Mute or delete one." |
| `no_matching_form` | Wrong argument types, as for any command | Lists the forms |

## Runtime values

Sound values never throw while playing. A problem makes the sound silent, with a reason, and the figure keeps running:

| Reason | When |
|---|---|
| `out_of_range` | Frequency outside 20 to 20,000 Hz: clamped and a notice once |
| `input_undefined` | Its frequency or gain is undefined: silent until it is defined again |
| `rate_limited` | More than 24 notes in a second: extra notes dropped, a notice once |

## Playback problems

| Kind | When | Recovery |
|---|---|---|
| `audio_blocked` | The browser did not allow audio (no gesture yet) | The speaker button shows "Tap to hear"; nothing else changes |
| `audio_unavailable` | No Web Audio support, or the audio package failed to load | Sound objects stay as values; the speaker button is hidden; a notice once |

Example:

```json
{
  "ok": false,
  "kind": "bad_note_name",
  "line": 3, "col": 14, "endCol": 18,
  "token": "\"H4\"",
  "message": "\"H4\" is not a note name.",
  "hint": "Use a letter A to G, an optional # or b, and an octave, like C#4."
}
```
