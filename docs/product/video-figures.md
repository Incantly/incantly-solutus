# Video figures: narrated films a learner can play, touch and question

Status: plan. Supersedes the earlier proposal draft. Beyond v0.1, which defers video export ([v0.1 scope](v1-scope.md)). Requirements are in [PRD section 28](../Incantly%20SDK%20Product%20Requirements%20Document%20(1).md); the call-count decision is [ADR 009](../architecture/decisions/009-film-scene-calls.md).

Signatures and field names are sketches. Numbers marked "bench" are set from measured runs, not from this document.

## 1. Summary

A learner asks for a concept, or for how a team or process works, and gets a narrated film of 30 seconds to 4 minutes (presets 30 s, 1, 2, 3 and 4 min). It is not a rendered video file. It is the same figure engine, driven by a storyboard, so it can be played, scrubbed, touched and questioned, and exported to MP4 when wanted.

The approach:

1. One plan call writes a storyboard (scenes, beats, narration, cues) as data.
2. Each scene is one scene call that uses SDK kits and the beat fields, so the model never writes timing, camera, caption or audio code.
3. The engine runs every film on a fixed clock and can seek, so scrubbing, export and audio all agree.
4. Narration is made once at generation time with text-to-speech; the audio sets beat length.
5. A layout solver places text, and offline checks verify it at every beat before the film is shown.
6. Viewers get a normal player. Editing belongs to the generation pipeline, not the viewer.
7. Questions are answered from the source: the service knows which beat and which code lines the learner is on.

A film of one scene (30 s and 1 min) fits today's pipeline of one plan call and one scene call. Only films of several scenes need more scene calls, and only they wait on ADR 009.

## 2. Goals and non-goals

Goals
- Exact, inspectable, deterministic output suited to STEM; seeking to t gives the frame that playing to t gives.
- Much lower cost per film than pixel-space video generation, and near-zero cost per view.
- The first scene playable within the figure budget (PRD 16.1) while later scenes are still being made.
- A film that stays interactive: pause, touch controls, ask, get a demonstration.
- One artifact that exports as video with audio.

Non-goals
- Photorealistic video or a pixel world model.
- Running scene code on a server (vision.md non-goal). Playback and export happen on the viewer's device.
- Editing controls for viewers.
- A critic model or any other review agent on the generation path. Offline checks replace review (PRD 17.7, AGENTS.md).

## 3. What exists today, and the gaps

Checked in the repo at the time of writing.

| Capability | State |
| --- | --- |
| Determinism | `core.md` defines output as a function of source, SDK version, values, seed, size and elapsed time. But the runtime advances by the real gap between animation frames, capped (`advance` in `runtime/runtime.ts`). Simulations take fixed steps; frame functions, tweens and `inc.follow`-style motion take whatever the gap was. Two plays of the same seconds can differ slightly. |
| Seeking | None. `stepFrame()` moves a paused figure 1/60 s forward. There is no way to go to a time. |
| Clock | Injectable (`engine/clock.ts`); this is the hook for a fixed clock and for offline rendering. |
| Steps | `inc.steps` with `say`, `focus`, `set`, `hold`, `view`, `flat` (`api/types.ts`). The `ease` field shown in PRD 24.2 is not in the type. Leaving step mode restores the learner's values. |
| Timing | `inc.timeline` (up to 600 s, loop, once or ping-pong, easing), `inc.tween` with a queue, eased 3D camera moves. |
| Parts | Named parts, highlight and focus (PRD 23.6). |
| Sound | `inc.sound`: tones, noise and notes made in the renderer with WebAudio. No playback of recorded speech. A sound button and volume slider exist. |
| Snapshot | Each stage's SVG and canvases are copied onto a canvas (`sandbox/snapshot.ts`). |
| Clip export | `exportClip` (`sandbox/clip.ts`) records in real time through MediaRecorder: 0.5 to 20 s, 4 to 30 fps, up to 1280 px wide, 64 MB. WebM where the browser makes it, MP4 otherwise. Picture only. |
| Checks | Validator, device probe and Node probe cost no model tokens; repairs send only the failing check and line, up to three while each makes progress (RP-4). |
| Budgets | Scene calls capped at 6,000, 10,000 and 14,000 tokens for quick, standard and rich (`SIZE_BUDGETS`); a hard deadline of three minutes per generation, a target of 10 seconds. |

Gaps this plan fills: a fixed film clock and seek; the film timeline and beat fields; multi-scene sequencing and transitions; a text layout solver and film checks; a speech pipeline and mixing; the player and transcript; a source map from beats to code; offline export with audio; versions.

## 4. Product model

- Film: an ordered list of scenes plus metadata (title, length target, version, shared film context).
- Scene: one figure on one stage kit (graph2d, svg, space3d, physics2d, flow) plus its beats. A scene lasts at most 60 s (bench), which bounds seeking (section 6).
- Beat: one narrated line with cues. A beat extends today's `Step`.
- Layers: the base film is the bottom track. A learner's inserts (answers, demonstrations) are clips on layers above, pinned to a beat. Versions are patches over the base.

Roles
- The generation pipeline has the full editing vocabulary, through beat fields.
- The viewer can play, pause, scrub, change speed and volume, turn captions on or off and resize them, read the transcript, jump to chapters, go fullscreen, pick a version, use the figure's controls, ask, and ask to be shown. No cutting, no sound editing, no layout control.

## 5. Data model (sketch)

Storyboard (plan call output, streamed):

```json
{
  "film": {
    "title": "How a support team handles a ticket",
    "lengthTarget": 120,
    "context": { "palette": "default", "parts": ["queue", "ticket", "agent"], "units": {}, "tone": "plain" }
  },
  "scenes": [
    {
      "id": "s1",
      "idea": "Ticket arrives and is triaged",
      "kit": "flow",
      "beats": [
        {
          "id": "s1b1",
          "say": "A ticket arrives and lands in the triage queue.",
          "short": "Ticket arrives",
          "cam": { "to": "queue", "zoom": 1.5 },
          "mark": [{ "type": "pulse", "part": "queue" }],
          "sfx": "arrive"
        }
      ],
      "cut": "fade"
    }
  ]
}
```

Beat fields (the scene names them, the engine does the work)

| Field | Meaning |
| --- | --- |
| `say` | Spoken narration; also the caption and transcript source. |
| `short` | Short on-screen text for titles and callouts. |
| `focus`, `set`, `hold`, `view` | Existing step behaviour. |
| `ease` | Seconds over which `set` moves, as PRD 24.2 already shows. |
| `cam` | Zoom or pan to a part, eased; back to wide on the next beat unless set. |
| `show`, `hide` | Parts brought in or out. |
| `mark` | Emphasis: pulse, draw-on, arrow, callout, dim others. |
| `title` | Title card or lower third, placed by the layout solver. |
| `sfx` | Named cue from the sound kit. |
| `explore` | Pause and invite the learner to change a named control, then resume. |
| `predict` | A prediction question that waits for the learner (PRD 24.4). |

`cut` (cut, fade, wipe, push) belongs to the scene, since it is how the scene ends.

Source map, stored with the film and used for questions and repair:

```json
{ "beat": "s1b1", "scene": "s1", "lines": [14, 31], "parts": ["queue", "ticket"] }
```

Lines are the scene's own lines, as the repair path already maps them (RP-3).

Anchor (where a question or insert is pinned): `{ film, version, scene, beat, offsetMs }`. Anchors use beat ids, never absolute seconds, so changed audio or edited versions do not break them.

## 6. The film clock and seeking

Everything else depends on this, so it is built first.

- **Fixed steps.** In film mode the runtime advances scene time in fixed steps (1/60 s, bench), whatever the display's frame rate. A slow device draws fewer frames, never different ones. Figures outside film mode keep today's behaviour.
- **Seek by replay.** Scene state lives in the scene's own closures inside the Worker, so it cannot be saved and restored. Seeking to t restarts the scene and runs its fixed steps up to t, sending no drawing updates until the last step. A scene is at most 60 s, so a seek replays at most 3,600 steps, in its own scene only.
- **Probe check: seek equals play.** The probe plays each scene to three times and seeks to the same times, and compares readouts and part positions. A scene that keeps state outside the SDK fails and is repaired like any other failure.
- **Bench before building on it:** seek time for a 60 s physics scene and a 60 s 3D scene on the slowest supported iPad. If it is over about 150 ms, cap scene length lower or seek from the start of the beat where a beat restarts the model from its values.

## 7. Generation pipeline

Stages
1. **Plan.** One streamed call returns the storyboard and the shared film context (palette, part names, notation, units, tone). Its cap is larger than today's plan call (bench).
2. **Scenes.** A scene call starts as soon as its slice of the storyboard has streamed in, with the film context in the cached prefix. Reviewed scenes and the concept cache answer per scene before any model call. A one-scene film makes exactly one scene call. A film of several scenes makes one call per scene, in parallel (ADR 009).
3. **Narration.** Requested per beat as soon as its text exists, while scene code is still streaming.
4. **Compile.** The engine turns beat fields into the timeline, camera moves, cues and captions. Until a beat's audio arrives its length is estimated from its words (2.5 words per second, bench), so the first scene is not held back by speech; the real audio length replaces the estimate when it arrives.
5. **Check.** Validator, probe, seek-equals-play and the film checks (section 9) run per scene, offline. Failures take the existing repair path. Wording failures ("beat 4: 31 words for 6 s") are repaired in the storyboard text, with no scene code sent.
6. **Publish.** The first passing scene is playable at once; later scenes show a skeleton and join as they pass.

These are pipeline stages, not tools a model calls. Narration, compiling, checking and rendering are plain code. The only model calls are the plan, the scene calls and repairs.

Budgets

| Size | Scene call cap | Notes |
| --- | --- | --- |
| quick / standard / rich | 6,000 / 10,000 / 14,000 tokens | Unchanged. |
| film | Plan: larger, streamed. Scenes: normal size budgets, one per scene. | Plan cap and per-length deadlines from the bench. |

Latency targets: the first scene follows PRD 16.1 (skeleton within 1 s, playable within 10 s of the tap). The whole film has a deadline per length, set from the bench and inside the existing three-minute ceiling.

## 8. Audio

- **Narration** is text-to-speech made at generation time, never per viewer. A beat lasts its audio plus a minimum hold. Captions use the provider's word timings.
- **Provider** behind an interface. The first candidate is the provider being looked at for the launch video (Fish Audio); whether it is reachable through OpenRouter, and its latency, price, voice terms and retention, are unverified and must be checked before committing.
- **Mixing** is owned by the SDK: narration, cues and an optional quiet bed ducked under speech. Silent until the viewer turns sound on, which also satisfies browser autoplay rules. Captions can always be on. The existing sound button and volume slider stay.
- **Storage:** audio is stored with the film by content reference, outside the undo history, as ADR 007 stores figures.
- **Privacy:** narration text goes to the speech provider and nowhere else, under the generation pipeline's retention rule. The provider's own retention must match it before it is chosen.
- **On-demand speech** (for answers) is made per asker, so text comes first and voice is opt-in, cached by text hash.

## 9. Layout and readability

CSS cannot know what a caption covers inside an SVG, canvas or 3D drawing, so the SDK measures and solves in JavaScript.

1. **Part geometry.** Every named part reports its on-screen box (SVG bounding box, or the projected box in 3D). Per beat the solver builds an occupied map from the focused part, the other parts, their labels and the safe margins.
2. **Captions go in a band outside the drawing**, as step text already does (PRD 24.2, 22.4 rule 9), so they cannot cover it. Callouts and labels go through a slot solver that rejects any slot that overlaps a part or leaves the safe area.
3. **When text does not fit:** shrink to a floor, allow a second line, split into chunks timed to the word timings, and only then fail. Titles and callouts use `short`.
4. **Fonts:** a bundled font stack, and fonts are loaded before anything is measured, so layout and export match what was watched.

Film checks run offline per beat (start, middle, end), at 360, 640 and 960 px, light and dark:
- Safe margin; at most two caption lines; a minimum size relative to stage height.
- No text over text or parts; leaders connect labels; labels keep a minimum gap.
- Contrast against what is behind the text.
- The focused part is in frame and uncovered after the camera move.
- Reading speed within a limit (default 3.5 words per second).
- One emphasis moving at a time.
- Audio and captions within one frame of each other.

All thresholds are defaults to tune with learners.

## 10. Player

First release
- Play, pause, scrub with thumbnails (any frame can be drawn by seeking), speed, volume.
- A transcript built from the beats: click to seek, searchable.
- A chapter per scene.
- Captions on or off, and their size.
- Markers where the learner asked questions.
- Version picker.
- Export: MP4 and transcript.

Later
- Loop a beat, bookmarks, a link to a time, "simpler / deeper", language and voice choice, keyboard shortcuts, resuming where the learner left off. Reduced motion starts on a still beat with its caption, as figures already do.

## 11. Interaction and questions

Touching any control pauses the film and enters explore mode; Resume restores the film's values, as leaving step mode already does, and returns to the beat.

The question ladder, cheapest rung that fully answers:

1. **Answer:** a short streamed text reply from the small model, one call with a cached prefix, first words within about a second. Optionally spoken. The default.
2. **Show me:** a mini-storyboard of beat fields played on the existing scene (set controls, focus, zoom, a line or two). One call, no new scene code, and deterministic, so it replays identically.
3. **Another example:** a new scene through the scene pipeline, shown as a side clip. Slowest.
4. **Change the film:** only when asked to change the film itself; creates a new version through the existing edits and repair path.

Context sent with a question: the anchor, the beat's narration and its neighbours, the scene lines from the source map, a scene summary, current control values and readouts, the version, the thread so far, and the question. Note text only if the host supplies it (`noteContext`). The stable part is a cached prefix.

Versions and inserts
- The base film never changes.
- A learner's inserts are private to them and pinned by anchor.
- An edit creates version N+1 as a patch (changed beats and their audio) linked to its parent; older versions stay playable.
- Promoting an insert into the film is an author action and creates a new version.

Export choices: the film, the film with chosen inserts spliced in at their pins, or a single insert.

First release: Answer and Show me. The other two rungs follow.

## 12. Deck mode

The same format, with beats that advance on a click instead of the audio clock. A deck is a film whose `advance` is `click`; narration is optional; export produces slides or a video. Questions and Show me work the same way.

## 13. Export

An offline renderer drives the injectable clock with fixed steps, draws each frame with the snapshot code, encodes with WebCodecs and an MP4 muxer, and mixes narration and cue audio. It does not wait on real time, so it runs as fast as the device draws, and it can split a film across workers by scene because each scene seeks independently. Where WebCodecs is missing, export falls back to today's real-time recorder for short films. `exportClip` stays for short silent clips. Rendering stays on the viewer's device.

## 14. Cost and latency

Cost per film: plan tokens, scene tokens per scene, speech seconds. Per view: effectively nothing, since playback and export are local. Per question: one small call, plus speech if asked for.

Against pixel-space video generation there is no per-frame generation cost, and an edit touches a few beats instead of a re-render. This is a design expectation, not a measurement.

Measured on the bench: tokens and dollars per film by length; time to the first playable scene; time to the whole film; repair rate; seek time; export time per film minute; answer latency to first words; speech time per beat.

## 15. Acceptance

- Seeking to t equals playing to t for every reviewed scene, in every browser the e2e suite covers.
- Every beat of every reviewed film passes the film checks at three widths, light and dark.
- Narration and captions stay within one frame across a 4-minute film.
- Films of 30 s, 1, 2, 3 and 4 min are generated through the running Playground (AGENTS.md, Real generation acceptance), each reaching Ready with a playable first scene within the PRD 16.1 budget; plan, scene, speech, check and probe times are reported.
- Questions at three different scenes answer from that scene's plan and lines, never another scene's.
- Export of a 4-minute film matches the played film frame for frame and has synced audio.

## 16. Phases and exit criteria

1. **Film clock and seek.** Fixed steps in film mode, seek by replay, the seek-equals-play probe check. Exit: reference scenes (2D graph, SVG diagram, physics, 3D) pass at 60 s, and the seek time on the slowest supported device is reported.
2. **One-scene films.** Beat fields, compiled timeline, transitions within a scene, the layout solver and film checks, a basic player (play, pause, scrub, captions, transcript). Generation of 30 s and 1 min films with one plan call and one scene call: no change to the call rules. Exit: both lengths pass the Playground acceptance run, silent, with estimated beat lengths.
3. **Offline export.** WebCodecs and MP4, fallback to the recorder. Exit: a 1 min film exports frame-identical to playback, faster than real time on a laptop.
4. **Narration.** Provider interface, audio clock, mixing, word-timed captions, audio in export. Exit: sync within one frame on a 1 min film; first scene still within budget.
5. **Questions.** Source map, anchors, Answer and Show me, question markers.
6. **Films of several scenes.** Storyboard of scenes, shared film context, parallel scene calls (after ADR 009 is accepted), chapters, 2 to 4 min presets, evals and bench. Exit: section 15 in full.
7. **Later.** Another example, Change the film and versions, deck mode, sharing inserts, optional fine-tuning (section 18).

## 17. Risks

- **Seeking too slow on long scenes:** bounded by the scene cap; measured in phase 1 before anything else is built on it.
- **Scenes that keep state outside the SDK** break seek-equals-play: caught by the probe and repaired.
- **Parallel scenes drift apart:** shared film context in the plan and per-scene checks.
- **Long-film cost and wait:** stream, cache, reuse reviewed scenes, play the first scene early.
- **Speech latency and cost,** especially on demand: estimated lengths, text first, voice opt-in, cache.
- **Fonts breaking determinism:** bundled fonts, measured after loading.
- **Export speed on phones and tablets:** chunked rendering, quality tiers.
- **Moderation:** the existing safety checks apply to narration text and answers.
- **Music rights** if a bed ships: licensed or generated beds only.

## 18. Optional later: a cheaper model

Not needed until there is enough approved data and a measured cost or latency problem. If pursued:

1. Log from the start, within the retention rule: concept, storyboard, scene code, probe results, repairs, approval, edits, and the beats where learners ask questions (a question at a beat signals unclear content). Never the learner's request or note text.
2. Supervised fine-tuning of an open-weight coding model on verified scenes; rules learned into the weights also shorten prompts.
3. Rejection sampling: many candidates per concept, keep those that pass the validator, probe and film checks, retrain.
4. Reinforcement learning with those checks as verifiable rewards.
5. In production the small model writes scenes and the current model takes over when the probe fails.

Before any of this: check provider terms on training from model outputs, and consent and retention for any learner content. Which open-weight models and sizes are available is unverified here and must be checked at the time.

## 19. Open decisions

- Speech provider, voices, and where audio is stored.
- ADR 009: parallel scene calls for films of several scenes.
- Plan cap, scene length cap and deadlines per film length, from the bench.
- Whether a music bed ships in the first release.
- Whether inserts can be shared between learners.

## 20. References

Background reading, not normative.

- Code2Video (agentic code-to-video with Planner, Coder, Critic): https://nips.cc/virtual/2025/131666. Its critic loop is the part this plan does not adopt.
- TheoremExplainAgent: https://arxiv.org/html/2502.19400v2
- Paper2Video: https://neurips.cc/virtual/2025/124558
- SWE-agent (agent-computer interfaces): https://arxiv.org/abs/2405.15793
- CodeAct: https://arxiv.org/abs/2402.01030
- Voyager (skill library): https://arxiv.org/abs/2305.16291
- Code as Policies: https://arxiv.org/abs/2209.07753
- Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Code execution with MCP: https://www.anthropic.com/engineering/code-execution-with-mcp
- Building effective agents: https://www.anthropic.com/research/building-effective-agents
- Agent skills: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Remotion, deterministic frame rendering: https://v4.remotion.dev/docs/flickering
- Genie 4 (pixel-space world model, for contrast): https://deepmind.google/blog/genie-4-a-new-generation-of-world-simulation/
