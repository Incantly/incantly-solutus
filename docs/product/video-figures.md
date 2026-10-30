# Video figures: narrated films a learner can play, touch and question

Status: proposal. Beyond v0.1, which defers video export. Signatures below are sketches; names are placeholders until the SDK review.

## Outcome

A learner asks for a concept, or for how a team or process works, and gets a narrated film of 30 seconds to 4 minutes (presets 30 s, 1, 2, 3 and 4 min). It is not a rendered file. It is the same live figure engine, so the learner can:

- play, pause and scrub, with audio and captions that stay in step;
- touch any control at any moment: the film pauses, the learner explores, and Resume returns to the beat;
- ask the agent a follow-up about the scene they are watching;
- export an MP4 with audio.

## Principles

1. The SDK owns the editing. The agent names what it wants (zoom to this part, cut to the next scene, say this line); it never writes timers, camera maths, caption layout or audio mixing.
2. The storyboard is data, not code. Narration, cues and timing are fields the engine compiles, so a minute of film costs words, not lines.
3. One model drives everything, as today. Scrubbing to time t gives exactly the frame that playing to t gives (core.md, Determinism).
4. Layout is a solver. The agent never gives coordinates for captions, titles or callouts; the SDK places them and the probe checks them.
5. Latency still outranks sophistication. The first scene must be playable while later scenes are still being made.
6. No scene code runs on a server. Rendering to MP4 happens on the learner's device (vision.md non-goals).

## Structure

A film is an ordered list of scenes. A scene is one figure on one stage kit (graph2d, svg, space3d, physics2d, ...) plus its beats. A beat is one narrated line with cues.

A beat extends today's `Step` (`say`, `focus`, `set`, `view`, `hold`) with:

| Field | Meaning |
| --- | --- |
| `cam` | Zoom or pan to a named part, eased: `{ to: 'queue', zoom: 1.6 }`. Back to full view when omitted on the next beat. |
| `show`, `hide` | Parts to bring in or out. |
| `mark` | Emphasis: pulse, draw-on, arrow, callout, dim the rest. |
| `title` | A title card or lower third; placed by the layout solver. |
| `cut` | How the scene ends: cut, fade, wipe or push. |
| `sfx` | A named sound cue from the sound kit. |
| `explore` | Pause here and invite the learner to change a named control, then resume. |

The scene's own code stays concept-specific (the model, the parts, the formulas). Everything above is engine behaviour.

## Audio

- Narration is spoken text-to-speech made when the film is generated, never per viewer, so playback is instant and costs nothing per play. It sits behind a provider interface; the provider is an open decision.
- A beat lasts as long as its audio plus a minimum hold. The audio clock is the film clock; captions use word timings.
- Mixing is SDK-owned: narration, sound cues and an optional quiet bed, with the bed ducked under speech. The existing sound button and volume slider stay. Everything is silent until the learner switches sound on, and captions can always be on.
- Audio is stored with the figure by content reference, as ADR 007 stores figures, outside the undo history.
- Narration text goes to the speech provider and is not logged or kept beyond the retention rule in the generation pipeline.

## Editing layer

An After Effects-style set of moves, all deterministic and all scrub-safe:

- Camera: zoom, pan, follow a part, return; for 3D the existing eased camera moves.
- Transitions between scenes: cut, fade, wipe, push; audio may lead or trail the picture.
- Emphasis: highlight, dim others, pulse, draw-on a path, arrow, callout.
- Timing: easing, stagger, hold, all derived from the film clock.

## Readability, enforced

The layout solver and the probe own these rules. Defaults are starting values to be tuned with learners.

- Captions and titles keep inside a safe margin, at most two lines, with a minimum size relative to stage height at 360, 640 and 960 px wide.
- A caption stays up at least as long as its words take to read; a beat with too many words for its slot is a validation failure, not a rushed film.
- No text overlaps another text or a drawn part; leaders connect labels to what they name; labels keep a minimum gap.
- Text keeps readable contrast against what is behind it, in light and dark.
- The part a beat focuses on is in frame and not covered after the camera move.
- One emphasis at a time; no more than one thing moving for attention.

Probe additions (offline, no model tokens): sample every beat at its start, middle and end; check the rules above; report beat, rule and the scene line. Failures feed the same repair path, which already sends only the failing check and its line.

## Interaction

- The playhead is scene time. Scrubbing works because the engine is deterministic.
- Touching a control pauses the film and enters explore mode, as leaving step mode already restores the learner's prior values. Resume goes back to the beat.
- A beat with `explore` or a `predict` question waits for the learner.
- Reduced motion starts on a still beat with its caption.

## Ask about this scene

- A button on every scene opens a follow-up. The question goes to the service with the scene's plan, the current beat's narration, the control values and the model's readouts. Note text is sent only if the host supplies it (`noteContext`).
- Default answer: a short streamed text reply from the small model, one call, cached prefix, first words within about a second.
- Optional: "change the figure" sends the question down the existing edits and repair path, so the scene is edited, not rewritten.
- Optional: the answer can be spoken with the same voice.

## Generation and budgets

Today a scene call is capped at 6,000, 10,000 or 14,000 tokens by size (`SIZE_BUDGETS`), with one plan call and one scene call. A 4-minute film cannot be one scene call, so add a size above rich, `film`:

- One plan call returns the storyboard: scenes, beats, narration, cues. Its cap is larger, and it streams.
- Each scene is generated as soon as its part of the storyboard streams in, in parallel, each within a normal size budget. Reviewed scenes and the concept cache are used per scene before any model call.
- Narration audio is requested per beat while the scene code is still streaming.
- The first scene is shown as soon as it is approved; later scenes show a skeleton and join as they pass the probe.
- Deadlines scale with film length; the numbers come from the bench, not from this document.

Decision needed: AGENTS.md allows exactly one plan call and one scene call. Parallel scene calls are not a multi-agent planning loop, but they are extra model calls. The proposal is to apply the 10-second target to the first scene, not to the whole film, and to record this as an ADR.

## Export

An offline renderer steps the engine with a fixed clock, draws each frame, and encodes with WebCodecs and an MP4 muxer, mixing the narration and cue audio. It runs faster than real time and works on any film length; `exportClip` stays for short silent clips.

## Phases

1. Film timeline and the beat fields, with the layout solver and the new probe checks; no audio.
2. Audio: provider interface, narration clock, mixing, captions with word timing.
3. Explore, scrub and resume.
4. Ask about this scene.
5. Offline MP4 export with audio.
6. Generation: the `film` size, storyboard plan, parallel scenes, evals and the bench.

## Acceptance

- Scrubbing to t equals playing to t, in every browser the e2e suite covers.
- Every beat of every reviewed film passes the readability checks at three widths, light and dark.
- Narration and captions stay within one frame of each other across a 4-minute film.
- Films of 30 s, 1, 2, 3 and 4 min are generated through the running Playground (see AGENTS.md, Real generation acceptance), each reaching Ready with a playable first scene; plan, scene, audio and probe times are reported.
- A follow-up on three different scenes answers from that scene's plan and values, and never from another scene.

## Open decisions

- Speech provider, voice choices, and where audio is stored.
- Parallel scene calls versus the one-scene-call rule.
- Token caps and deadlines per film length, set from bench runs.
- Whether a music bed ships in the first release.
