# Films SDK contract

A film is the same figure engine driven by a storyboard, so a film scene is
an ordinary scene whose `inc.steps` carry beat cues. The scene names what it
wants on each beat; the engine does the timing, camera, captions and audio.
See [Video figures](../product/video-figures.md) for the product model and
[Teaching](teaching.md) for steps in figures.

## Beats

A beat is a step with cues. Every field is optional and additive, so a beat
is still a step:

```js
inc.steps([
  { say: 'A pendulum hangs from its pivot.', focus: 'Pivot' },
  {
    say: 'Pull the bob aside, let go, and watch the swing begin.',
    set: { angle: 0.9 },
    ease: 1.2,
    explore: { control: 'angle', hint: 'Drag the slider to start wider.' },
  },
  {
    say: 'It moves fastest through the very bottom.',
    focus: 'Bob',
    cam: { to: 'Bob', zoom: 1.5 },
    mark: [{ type: 'pulse', part: 'Bob' }],
  },
  {
    say: 'Every swing takes the same time.',
    short: 'Same time',
    title: { text: 'Same swing, same time', kind: 'card' },
  },
]);
```

| Field | Meaning |
| --- | --- |
| `say` | Spoken narration; also the caption and transcript source. One or two sentences. |
| `short` | Short on-screen text for titles and callouts. |
| `focus`, `set`, `hold`, `view` | Existing step behaviour. |
| `ease` | Seconds over which `set` moves. |
| `cam` | Zoom or pan to a part, eased; back to wide on the next beat unless set. |
| `show`, `hide` | Parts brought in or out. Annotation parts are drawn by the scene, hidden, and brought in by the beat. |
| `mark` | Emphasis: `pulse`, `draw`, `arrow`, `callout`, `dim`. At most one moving at a time. |
| `title` | Title card or lower third, placed by the layout solver. |
| `sfx` | Named cue from the sound kit, such as `arrive` or `chime`. |
| `explore` | Pause and invite the learner to change a named control, then resume. |
| `predict` | A prediction question that waits for the learner; never scored. |

`cut` (`cut`, `fade`, `wipe`, `push`) belongs to the scene, since it is how
the scene ends.

## The shared context

A film of several scenes shares one context — palette, part names,
notation, units, tone — and every scene keeps it exactly:

- Tones only, never colour values.
- Part names spelled exactly as the context spells them.
- Parameters measured in the context's units.
- `si` notation never uses imperial words; `plain` tone keeps lines short
  with one idea per sentence.

A scene that drifts from the context fails its check and is repaired
alone. The storyboard's beat lines must also match the scene's steps
verbatim, so the compiler can match them.

## Timing

A beat lasts its narration audio plus a hold. Until the audio arrives the
length is estimated from the words (2.5 per second), so the first scene is
never held back by speech. Captions use the provider's word timings and
stay within one video frame of the audio. Scenes run at most 60 seconds on
the fixed film clock and seek by replay, so seeking to t draws what
playing to t draws.

## Narration

Beats narrate with the stub's silent timing by default, so a film never
waits on speech. For Cartesia voices, set `CARTESIA_API_KEY` and
`CARTESIA_VOICE_ID` (a Voice Library id) on the dev server: opening a film
and pressing Narrate with Cartesia then works with both fields empty, the
player shows the key and voice sources at a glance, and films stay silent
until Sound is on. Pasted values override the server's, and the key is kept
in memory on both ends and never saved.

## What the engine owns

Layout, checks, player, questions, versions and export are the engine's,
not the scene's: captions in a band outside the drawing, callouts in
placed slots, film checks per beat at three widths in light and dark, and
offline MP4 export on the fixed clock. The scene gives no coordinates for
captions or callouts and writes no timing, camera, caption or audio code.
