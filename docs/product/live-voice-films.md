# Live voice films: a teacher you can interrupt

Status: proposed (November 2026). Builds on [Video figures](video-figures.md), which is implemented. Signatures and field names are sketches; the implementing branches settle them.

## 1. Summary

Today a film is a storyboard played on the figure engine: one simulation per scene, a caption band, and narration that is silent unless someone presses Narrate. Questions go through a typed Ask sheet. It works, but it does not feel like an explainer video, and you cannot talk to it.

This design adds two things:

1. **One live voice.** A single real-time voice model (Gemini Live) reads the film's beats aloud, listens to the learner, and answers in the same voice. Because the same session narrated everything so far, it already knows what it has said when the learner cuts in.
2. **Explainer layers.** Beats can write an equation or a line of text onto the stage as it is spoken, show the simulation beside step-by-step notes, and open or close a section with a card. The planner picks them per beat; the engine draws them.

The voice model never draws. It talks, listens and calls tools. Every visual still comes from the engine and the existing generation pipeline, so figures stay exact, seekable and replayable.

## 2. The experience

1. The learner opens a film and turns on **Live voice**. The teacher starts reading beat one; the simulation, captions and layers follow its voice.
2. The learner speaks over it: "Wait, what does this angle mean?" The teacher stops mid-sentence, the film pauses on the current frame, and the teacher answers about *this* angle, using what it has said so far and the scene's live values.
3. "Show me with a bigger angle." The teacher changes the angle on the paused figure and talks through what changed.
4. "Give me another example." The teacher says it will draw one and keeps talking while the existing pipeline makes a private insert pinned at that point. The insert plays as a detour.
5. "Okay, carry on." The film returns to the exact word where it paused, and the teacher continues with the next beat. Nothing else in the film changed.

## 3. What exists and what is missing

| Piece | On main | Missing |
| --- | --- | --- |
| Fixed clock, seek, transport | `FilmController` (`packages/core/src/runtime/film.ts`) | Nothing. |
| Click-advanced beats | Deck mode: `FilmAdvance = 'time' \| 'click'` (`film/storyboard.ts`) | A driver that advances on the voice's turn end. |
| Ask: Answer, Show me, Another example, Change | `/v1/ask`, `/v1/ask/insert`, `/v1/ask/example`, `/v1/ask/change`; `beginShowMe`; `InsertPlayer` with resume at the anchor word | A way for a voice model to call them as tools. |
| Narration | `Narrator` interface, Cartesia, stub; Narrate button | A live voice; generated films are silent by default. |
| Visuals | One stage kit per scene; caption band; `title`, `mark`, callouts | Write-on text and equations, split notes, section cards. |

## 4. Decisions

- **Provider: Gemini Live** (Live API, bidirectional WebSocket, native audio). Chosen for price ($3 / $12 per million audio tokens in / out, about $0.005 / $0.018 a minute at the time of writing), tool calls that can run without stopping speech (`NON_BLOCKING`), and an existing Gemini provider in the Playground. The model id is discovered at runtime from the models list (a model whose methods include `bidiGenerateContent`), never hard-coded alone.
- **Provider-agnostic core.** `packages/core` defines a `LiveVoice` interface and a fake. Gemini is one implementation in `packages/generation/src/client`. OpenAI Realtime or Qwen-Omni can be added later behind the same interface.
- **The learner's browser connects directly** with a short-lived token minted by the server. The real key never reaches the page.
- **Fail closed on retention.** Learner audio goes to Google. The token endpoint refuses unless the operator sets `GEMINI_LIVE_RETENTION_ACCEPTED=1`, mirroring `CARTESIA_RETENTION_ACCEPTED`.
- **Not on the generation path.** The voice model sits on the question path. Anything it asks to be drawn goes through the existing plan call plus scene call (Another example) or no model call at all (Show me). AGENTS.md's one-plan-one-scene rule is unchanged.
- **Pre-made narration stays** for MP4 export, offline viewers and viewers without a token. Live voice is a playback mode, not a new film format.

## 5. Architecture

```
 Learner mic ──► Gemini Live session (browser, short-lived token)
                    │  audio out ──► speaker
                    │  output transcription ──► captions
                    │  turn complete ──► LiveDriver.next beat
                    │  tool calls ──► LiveTools ──► FilmController / beginShowMe /
                    │                               /v1/ask/insert / /v1/ask/example / InsertPlayer
                    ▲
 LiveDriver ── "say this beat" + context ──┘
```

### 5.1 `LiveVoice` (core, provider-agnostic)

```ts
interface LiveVoice {
  connect(setup: LiveSetup): Promise<void>;       // system instruction, tool declarations, voice
  say(text: string, turnId: string): void;        // speak this line, verbatim where possible
  sendContext(text: string): void;                 // silent context update (no reply expected)
  respondTool(callId: string, result: unknown): void;
  close(): void;
  on(listener: (event: LiveEvent) => void): () => void;
}
type LiveEvent =
  | { type: 'speaking'; turnId: string | null }
  | { type: 'transcript'; text: string; turnId: string | null }       // what it actually said
  | { type: 'turn-complete'; turnId: string | null }
  | { type: 'interrupted' }                                              // learner spoke over it
  | { type: 'learner-transcript'; text: string }
  | { type: 'tool-call'; callId: string; name: string; args: unknown }
  | { type: 'error'; message: string }
  | { type: 'closed' };
```

A `FakeLiveVoice` in core drives every unit test with scripted events.

### 5.2 `LiveDriver` (core)

Owns the film while live voice is on.

- Switches the controller to click advance (deck mode) so beats wait for the voice, not the clock.
- Sends each beat with `say(beat.step.say, beat.id)`; on `turn-complete` for that beat, advances to the next and sends it.
- Captions show the voice's own transcript for the current beat, falling back to the beat text.
- On `interrupted`, pauses the controller and records the anchor (beat id and word index), as Ask does today.
- On leaving live mode, restores the previous advance mode and position.

### 5.3 `LiveTools` (core declarations, host-bound handlers)

| Tool | Does | Blocking |
| --- | --- | --- |
| `pause()` | Pause, record the anchor. | yes |
| `resume()` | Return to the anchor word and continue with the next beat. | yes |
| `seek_beat(beat)` | Jump to a beat by id or index (for "go back to the triangle part"). | yes |
| `get_context()` | Current beat, beats said so far, the scene's lines from the source map, control values and readouts. | yes |
| `show_me(set, say?)` | Change control values on the paused scene (`beginShowMe`), no model call. | yes |
| `make_example(request)` | Another example through `/v1/ask/example` or an insert through `/v1/ask/insert`, played as a detour by `InsertPlayer`, then back to the anchor. | no |

Tool arguments are validated against the film (known beats, known controls, values in range) before anything runs; a bad call returns an error result to the model, never an exception to the page.

### 5.4 Gemini client and token (generation)

- `packages/generation/src/client/live-gemini.ts`: `GeminiLiveVoice implements LiveVoice` over the Live API WebSocket with a short-lived token. Requests audio responses, output and input transcription, and declares tools with `make_example` as non-blocking.
- `POST /v1/live/token` on `GenerationService`, enabled only when a `live` option is supplied; returns `{ token, model, expiresAt }`. The Playground dev server supplies it from `GEMINI_API_KEY` and the retention flag.
- Session length: Live sessions are time-capped; the client uses session resumption so a 4-minute film plus questions does not drop. Confirm current caps at build time.

### 5.5 Explainer layers (core)

New optional beat fields, compiled and drawn by the engine, placed by the layout solver, checked by the film checks:

| Field | Shape | Effect |
| --- | --- | --- |
| `write` | `{ text: string, math?: boolean }` | Writes the text or equation onto the stage over the beat's spoken length, stroke by stroke, in a solver-placed slot that does not cover parts. |
| `notes` | `string[]` (≤ 4 short lines) | Split layout: simulation on one side, the notes on the other, revealed one per beat. Stacks under the stage below 640 px. |
| `card` | `{ kind: 'section' \| 'recap', text: string }` | A full-stage card for a section start or a recap; the scene stays mounted behind it. |

Seeking to t draws what playing to t draws for every layer. The planner's `FILM_PLAN_FORMAT` gains one short paragraph naming these fields; core.md stays under 1,500 tokens (AGENTS.md).

Later, not in this run: illustration panels from an image model. They add a model call, cost and a retention review per image, so they wait until the layers above have been tested with learners.

## 6. Latency and cost

- First spoken word within 1 s of turning live voice on (measured from `connect` to first `speaking`).
- Interrupt to silence under 500 ms; answer's first word under 1.5 s.
- `show_me` visible under 200 ms; `make_example` keeps the voice talking until the insert is ready, inside the existing generation budget.
- The figure budget (PRD 16.1) is untouched: live voice starts after the first scene is playable.
- Cost: about $0.02–0.05 per viewer for a 2-minute film with a few questions at the prices above. Measured in stage 5.

## 7. Privacy

- Learner audio and transcripts go to Google under the operator's acceptance, and nowhere else; the service does not store them.
- Telemetry stays as `film-ask` defines it: film, beat, rung and counts. No audio, no transcript.
- The token is short-lived, single-use for a new session, and scoped to the Live API.

## 8. Build stages

Each stage is its own branch cut from `main` and named for the work.

| Stage | Branch | Scope | Done when |
| --- | --- | --- | --- |
| A | `feat/live-voice-core` | `LiveVoice`, `FakeLiveVoice`, `LiveDriver`, `LiveTools` with validation, exported from core. | Unit tests drive a film end to end with the fake: beats spoken in order, interrupt pauses at the right word, each tool works and rejects bad arguments, resume returns to the anchor, leaving live mode restores state. |
| B | `feat/live-voice-gemini` | `GeminiLiveVoice`, `/v1/live/token`, retention gate, dev-server wiring, model discovery. | Unit tests with a mocked socket cover setup, audio, transcripts, interruption, tool round trips and errors; the token route refuses without the flag. |
| C | `feat/film-explainer-layers` | `write`, `notes`, `card` beat fields: types, compile, draw, layout, checks, seek-equals-play, plan format, docs. | Unit and film-check tests pass at 360/640/960 px, light and dark; existing film tests unchanged. |
| D | `feat/live-voice-playground` | Player page: Live voice toggle, mic permission, voice panel with both transcripts, tool progress, fallback to pre-made narration. Merges A and B. | Real Playground run (section 9) passes. |
| E | — | Bug hunt over A–D, and stage 5 measurements. | Bugs reported, fixed and re-checked. |

## 9. Acceptance

Following AGENTS.md, with a real Gemini session in the running Playground at `http://127.0.0.1:5173`:

1. Generate a Pythagoras film (60 s) through the film box; it reaches Ready and plays.
2. Turn on Live voice; the teacher reads the first beats, and captions and layers follow the voice.
3. Interrupt by voice at two different beats with a question about what is on screen; each answer refers to that beat's content and live values.
4. Ask for a bigger angle; the figure changes without a new scene.
5. Ask for another example; the voice keeps talking, the insert plays, and the film resumes at the paused word.
6. Report: time to first word, interrupt-to-silence, answer latency, tool success rate, how closely beats were read (word overlap with the script), and cost for the run.

## 10. Open questions

- Whether live voice can replace pre-made narration for export by recording the session's audio (likely not: replay must be deterministic).
- Matching the pre-made narration voice to the live voice, or using Gemini speech for both.
- Whether a teacher persona (name, tone) is configurable per host.
