# Interactive narrated films: full build plan (2026-11-03)

Status: full-scope plan for discussion. Covers **everything** in
[PRD §28](../Incantly%20SDK%20Product%20Requirements%20Document%20(1).md) and
[Video figures](../product/video-figures.md) plus the interruption + return-stack design agreed
2026-11-03 — not a v1 subset. This file is the runbook for the dev agents below; it is not a
product spec.

Note on agents: AGENTS.md forbids extra agents *on the runtime generation path*
(one plan call + one scene call). That rule is untouched. The agents in this file are
*development* agents (builders, reviewers, testers) working in this repo. They never add
model calls to the product pipeline.

## 1. Locked decisions (2026-11-03)

- Interruption v1 is **tap-to-ask** (no voice barge-in yet). Voice reuses the same anchors later.
- Narration provider is **Cartesia** (word timestamps + streaming + cancellation). Fish Audio is out.
  Voice terms, latency, price, and retention still need a verification spike before merging.
- After an insert, the film **auto-resumes** at the anchor word, with a short "back to film" beat.
- Learner gets a **player**; the CapCut-style layered timeline is the agent's data model plus a
  Playground debug view. Viewers play; they do not edit (PRD 28.1).
- Integrators style the player through **`FigureStyle` + slots + headless controller**, the same
  mechanism as figures (`docs/sdk/styling.md`). No second styling system.
- All visuals come from **existing SDK kits only** (graph2d, chart, svg, space3d, graph3d,
  physics2d, flow, chemistry, biology, anatomy). The film layer adds no new visuals.

## 2. Design choices (recorded)

- A film is **data played through the live engine**, never a video file. Three layers: timeline
  data (storyboard, inserts, anchors) → film controller (clock, scheduler, return stack, audio
  sync) → scenes (ordinary generated figures on kits).
- **Fixed clock + seek-by-replay.** Film mode advances in fixed 1/60 s steps. Seek restarts the
  scene and replays steps to the target without drawing (scene state lives in Worker closures,
  so no checkpoints). Scene length capped (~60 s) to bound worst-case seek to ~3,600 steps.
- **Beat fields are the agent's only editing vocabulary.** Beats extend `inc.steps`
  (`say/focus/set/hold/view/flat` + `ease/cam/show/hide/mark/title/short/sfx/explore/predict`,
  `cut` per scene). The model never writes timing, camera, caption, or audio code.
- **Word-boundary anchors.** Interruption pauses at the current word: anchor =
  `{film, version, scene, beatId, wordIndex, controlValues, readouts}`. Beat ids, never seconds.
- **Return stack, depth ≤ 2.** Inserts nest (a question inside an explanation); each pop resumes
  the parent at its anchor.
- **Narration:** base film audio made once at generation time (Cartesia), stored by content hash
  with the film, outside undo history. Beat length = audio length + minimum hold; estimated at
  2.5 wps until audio arrives so speech never blocks the first scene. On-demand answer speech is
  per asker, text first, voice opt-in, cached by text hash.
- **Layout:** captions in a band outside the drawing; callouts via slot solver fed by part boxes;
  bundled fonts measured after loading. Film checks per beat (start/mid/end) at 360/640/960 px,
  light+dark: overlap, contrast, focus-in-frame, reading speed ≤ 3.5 wps, one emphasis at a time.
- **Versions:** base film immutable; inserts private, pinned by anchor; edits create version N+1
  as a patch. Export flattens (film + chosen inserts spliced at pins) via offline fixed-clock
  render (WebCodecs + MP4 muxer, real-time recorder fallback).
- **Question ladder, all four rungs:** Answer (streamed text, TTS opt-in) → Show me (beat fields
  on the live scene, no new scene code) → Another example (new side-clip scene via scene
  pipeline) → Change the film (new version through edits + repair path). Cheapest rung that
  fully answers, always.

## 3. Full scope (everything ships)

### 3.1 Engine (`@incantly/core`)

- FV-1: film mode — scene time advances in fixed steps whatever the display frame rate.
- FV-2: seek to any time in a scene by replay, no drawing until the last step; scene length cap
  from the bench.
- FV-3: probe check — seek-to-t equals play-to-t (readouts + part positions) at three times.
- FV-4: beat fields on steps + `cut` per scene; timeline compiler (beats → scheduled film).
- FV-5: layout solver (caption band, callout slots, bundled fonts measured after load).
- FV-6: film checks per beat at 360/640/960 px, light + dark.
- FV-12: source map (beat → scene lines + parts); anchors by beat id.
- Non-film figures keep byte-identical behavior (film paths flag-gated).

### 3.2 Generation (`@incantly/generation`)

- FV-11: storyboard plan + shared film context; one scene call per scene in parallel (ADR 009);
  cache + reviewed scenes answer per scene first; per-length deadlines inside the 3-minute ceiling.
- FV-9: Cartesia narration per beat during streaming; word-timed captions; estimated lengths until
  audio arrives; provider behind an interface (`tts.ts`, `CartesiaClient` next to the model
  clients); key check on boot; retention rule enforced.
- FV-10: SDK-owned mixing (narration + cues + optional ducked bed); silent until sound on.
- FV-13: Answer + Show me endpoints (streamed, cached prefix, ~1 s to first words).
- Another example + Change the film endpoints (scene pipeline reuse; version patch path).
- FV-14: versions as patches over immutable base; private inserts pinned by anchor; insert
  promotion is an author action creating a new version.
- FV-15: deck mode (beats advance on click; narration optional; export to slides/video).
- Speech spend accounting in `limits.ts` (per-learner + service daily caps); bench reports speech
  seconds and dollars per film length.

### 3.3 Player (Playground + embeddable)

- FV-7: play, pause, scrub with thumbnails (any frame via seek), speed, volume, captions + size,
  transcript with seek, chapters, question markers, version picker.
- Full control list: loop-a-beat, bookmarks, link-to-time, simpler/deeper, language + voice
  choice, keyboard shortcuts, resume-where-left-off. Reduced motion starts on a still beat.
- Ask sheet (tap-to-ask): context line (beat + anchor words), streamed answer, Show me replay,
  Explain-deeper progress, insert banner with countdown + "Back now", auto-resume.
- Timeline debug view (Playground): V1 base / V2 inserts + anchor connectors / A1 narration
  waveform + word ticks / FX cues, clip inspector (beat fields), seek=play badge, check status.
- Styling: player chrome as `FigureStyle` slots + `show` flags; headless controller API
  (play/pause/seek/ask/events) for fully custom chrome.

### 3.4 Export

- FV-8: offline MP4 on-device (fixed clock, WebCodecs, scene-chunked workers, faster than
  real time on a laptop); real-time recorder fallback where WebCodecs is missing.
- Export choices: film alone / film + chosen inserts spliced at pins / single insert;
  transcript export (beat text only). Frame-for-frame match with playback, synced audio.

### 3.5 Gallery, bench, evals, telemetry, docs

- Gallery: films searchable, open intended prompt, keep acceptance cards (incl. the three
  existing figure cards as regression).
- Bench: tokens + dollars per film length; time to first playable scene; whole-film time;
  repair rate; seek time; export time per film minute; answer latency to first words; speech
  time per beat. Caps (plan, scene length, scene count, deadlines) set from the bench.
- Evals: film prompts versioned; approved films re-validated + re-probed from scratch; gate
  requires zero broken films shown.
- Telemetry (device, schema-checked): film start/complete/scrub/ask/insert/resume/export,
  beat-level question counts (unclear-content signal), all timings. No note content leaves.
- Docs: video-figures.md updated to this plan; PRD FV requirements kept in sync; ADR 009
  accepted; `docs/sdk/` teaching page for films; AGENTS.md gains the ADR 009 sentence.

## 4. Audio-cost discipline (Cartesia spend)

Real TTS calls cost money and the gallery will hold many films. Rules every agent follows:

- **Stub narrator by default.** All unit tests, probe runs, film checks, and E2E use a
  deterministic stub: silent audio + word timings derived from text. Real Cartesia is used only
  in the acceptance runs named below.
- **Estimated lengths everywhere in tests.** Beat timing uses 2.5 wps estimates unless a test
  specifically targets audio sync.
- **Checked-in fixtures, not audio files.** Word-timing JSON fixtures live in the repo; audio
  bytes are never committed.
- **Real-audio budget:** one 30 s acceptance film + two answer-speech spot checks per release
  cycle, run once, then cached by text hash and reused. Gallery seed films are silent/estimated
  except the acceptance films, generated once.
- **Enforced caps:** speech characters per learner/day and service/day in `limits.ts`, with 429
  + `Retry-After` on breach; bench reports speech cost per film so regressions are visible.
- **No retries on TTS beyond one**, and never in a loop; a failed narration falls back to
  estimated lengths + captions, never blocks the film.

## 5. Configuration: where the Cartesia key goes

Follows the existing provider-key pattern exactly (see `serve.ts`, Playground generate page):

- Server side: `CARTESIA_API_KEY` in the dev server / service environment (`.env` file, never
  committed). The service reads it at boot, verifies it with a cheap key check (like Gemini's
  list-models check), and refuses narration work with a clear error when missing — films still
  generate silent with estimated lengths.
- Playground: provider settings gain an optional Cartesia key field — pasted key goes to the dev
  server only, kept in memory on both ends, never saved; empty means use the server's env key.
- The key never reaches the browser bundle, localStorage, telemetry, logs, or failure records.
  Narration requests are service-side only; the device receives audio bytes + word timings.

## 6. Subagent organization

One orchestrator (this session), builders per slice, two review gates, dedicated E2E testers.
Builders writing code in parallel use isolated worktrees. All subagents use the default model
(same route as the orchestrator); no per-role model pins. No agent commits to another session's
branch; `docs/implementation/simulator-tier-spec.md` and its worktrees are out of bounds.
Builders never commit or push (repo safety rule) — the orchestrator commits green slices after
the user's standing authorization, and never pushes.

### 6.1 Orchestrator (planner)

Owns this plan, the phase order, exit criteria, and merges. Cuts one branch per slice,
chained: `feat/film-clock` from latest `main`, each later slice from the previous green slice
(`feat/film-beats`, `feat/film-narration`, `feat/film-ask`, `feat/film-ask-full`,
`feat/film-versions`, `feat/film-export`, `feat/film-multiscene`, `feat/film-deck`,
`feat/film-gallery-evals`). The last green slice carries the whole implementation for the final
PR to `main`. Runs the latency bench after every slice (§16.1: skeleton ≤ 1 s, first scene
playable ≤ 10 s). Accepts or rejects review verdicts.

### 6.2 Builders (slice order in §9; parallel-safe within a slice)

| Slice | Scope | Touches |
|---|---|---|
| film-clock | Fixed steps in film mode, seek-by-replay, seek-equals-play probe check | `runtime/runtime.ts` (behind `filmMode` flag), `engine/clock.ts`, probe |
| film-beats | Beat fields on `Step`, timeline compiler, layout solver + film checks, basic player | `api/types.ts` (additive), `runtime/film.ts` (new controller), sandbox seek/snapshot, Playground player page |
| film-narration | Cartesia spike + provider interface, audio clock, word-timed captions, mixing, spend caps | `packages/generation` narration pipeline, controller audio sync, storage by content hash, `limits.ts` |
| film-ask | Word-boundary anchors, Answer + Show me, insert clips, return stack, auto-resume, markers | service question endpoints, controller stack, player Ask sheet + insert banner, transcript |
| film-ask-full | Another example + Change the film rungs, full player controls (§3.3 list) | scene-pipeline reuse, version patch path, player UI |
| film-versions | Versions as patches, private inserts, promotion action, version picker, export choices | film storage, player UI, export flatten |
| film-export | Offline MP4 export (WebCodecs, fixed clock, scene-chunked), flatten with inserts | sandbox snapshot/clip, export worker path, player export UI |
| film-multiscene | Storyboard of scenes, shared film context, parallel scene calls (needs ADR 009), chapters, 2–4 min presets | `packages/generation` pipeline, bench, evals |
| film-deck | Deck mode (click-advance, optional narration, slide/video export) | controller advance modes, export, player |
| film-gallery-evals | Gallery integration, film bench + evals + telemetry, docs sync (§3.5) | Playground gallery, bench/evals, telemetry, docs |

Each builder delivers: files changed, tests run + outcomes, latency measurements for its slice,
evidence lines, and an `unresolved` list. No builder merges; all output goes through §6.3–6.4.

### 6.3 Implementation-quality reviewer ("did we build it right")

Runs on every builder diff before merge. Checks:

- Every requirement clause in the slice is implemented; nothing silently skipped; no scope creep.
- Generic SDK first: no scene-specific host/Playground code, no one-film helpers, no invented
  expression functions; displayed formulas use real primitives.
- No new model calls on the generation path (plan/scene/repair budgets unchanged; multiscene
  only via ADR 009 exception once accepted).
- Latency: slice keeps §16.1 budget; core.md stays under 1,500 tokens; references load only for
  planned components. Any regression is a bug.
- Contracts match siblings: error types, return shapes, naming follow surrounding code; Step
  additions are additive and optional.
- Committed tests exist for the touched area and pass; no narrowed runs, no skipped failures.
- Audio-cost discipline (§4): no real TTS in unit/probe/E2E except named acceptance runs.

Verdict: approve, request-changes (with exact failing check), or escalate to orchestrator.

### 6.4 Senior security reviewer ("is it safe to ship")

Runs on every builder diff before merge, after §6.3 passes. Threat-model checklist:

- **Untrusted scene code:** generated JS stays in the Worker/sandbox; no new host-surface APIs
  without allow-list + validation; `advance`/seek paths can't be driven into unbounded loops
  (step caps, deadlines, MAX_SUBSTEPS-style guards on replay).
- **Untrusted device reports:** question/insert/probe payloads sanitized (known checks, plan
  params, short text only); repair always starts from the service's own fragments.
- **Prompt injection via questions:** learner question + note text (`noteContext`) enter model
  context — bound length, isolate from system instructions, never log/store request text (retention
  rule); failure records keep plan/fragments/reports/outcome only, 30-day deletion.
- **Cartesia / TTS:** narration text is the only data sent; verify provider retention matches
  ours before committing; key server-side only (§5); audio stored by content hash, no executable
  content; word timings validated (monotonic, within beat bounds) before driving captions/clock.
- **Styling/custom player:** `FigureStyle` re-validated host-side and in-frame; trusted CSS by
  hash only; headless controller API exposes state + intents, never DOM/script injection.
- **Auth/limits:** film counts as one generation; all scene + narration + question calls count
  toward learner daily spend; per-learner concurrency caps cover parallel scene calls; kill
  switch + 503 path tested.
- **Export:** render stays on-device; no server-side scene execution; exported MP4 carries no
  note content beyond what the film shows; transcript export is beat text only.
- **Inserts/versions/deck:** private inserts never leak across learners; anchors can't reference
  another film's beats; version patches validated like scenes; deck slide export carries no
  hidden state.

Verdict: approve, request-changes (with severity + exploit sketch), or block (orchestrator must
resolve before any merge).

### 6.5 E2E testers (CUA Spaces only)

All end-to-end verification runs in **disposable CUA Spaces/sandboxes** (real Chromium, real
model session, same SDK path a learner uses) — never in the user's own browser, never mocked.
Each run: create a local Space with a browser (MCP `create_space` on `local`, or
`sandbox_create {"browser": true}`; CLI fallback `cua sb create --browser`), run the
Playground inside it (`space_bash` / `space_write`), drive the browser via the Space's
browser tools (`get_browser_state`, `browser_navigate`, `browser_click`, `browser_type`),
record outcome + timings, name the Space in the report so it can be inspected, then delete
it (`delete_space` / `cua sb rm`). The user can watch via `open_space_viewer`.
Stub narration (§4) in all runs except the named real-audio acceptance.
Learned 2026-11-03: with approval prompts disabled, `require_escalated` is refused — run
cua/docker commands under the default sandbox (works). `cua sb create`'s post-create spacesd
probe misreports here (guest 3211 is published but the CLI says otherwise, then auto-deletes
after the wait window): always create with `--keep-on-failure` and drive via a direct-URL
do-target with the guest `CUA_ENV_TOKEN`. If `cua sb create --on local` is unusable on the
host (no lume, hangs daemon-side), the accepted equivalent is a disposable Docker container
from the same cached cua linux image with a guest browser, driven via direct-URL do-target +
guest `CUA_ENV_TOKEN`, deleted after the run. Never use port 5173 (another checkout's
protected dev server); verify the chosen port is free first.

Film acceptance script (extends AGENTS.md Real generation acceptance):

1. Open Playground `?page=generations` in the sandbox browser; generate the three existing
   cards (Meshing gears, Forces on a ramp, Area under a curve) via Generate in chat — must
   still pass (no regressions).
2. Generate 30 s, 1, 2, 3, 4 min films; each must reach Ready with a playable first scene inside
   the §16.1 budget; record plan/scene/speech/check/probe times.
3. Interrupt mid-beat via Ask; confirm pause at a word boundary and anchor recorded in Debug log.
4. Full ladder: Answer (text) → Show me → Another example → Change the film (new version);
   confirm the insert plays pinned to the anchor and **auto-resumes** at the anchor word.
5. Scrub to three times per scene; confirm seek equals play (readouts + part positions match).
6. Questions at three different scenes answer from that scene's plan and lines, never another's.
7. Export: film alone, film + inserts, single insert; MP4 matches playback frame-for-frame with
   synced audio; transcript export is beat text only.
8. Deck mode: click-advance through a deck; export slides.
9. Gallery: films remain searchable and open the intended prompt.
10. Real-audio acceptance (once per release): the 30 s film with real Cartesia narration —
    narration + captions within one frame; two answer-speech spot checks.

A pass is Ready + live mounted figure + `done figure` debug entry + visibly drawn output.
Skeletons, source-only responses, and generic success messages never count.

## 7. Interaction protocol

1. Orchestrator opens a slice: branch from `main`, builder brief (scope + exit criteria + files).
2. Builder implements + self-verifies (typecheck, eslint on touched files, vitest for the area).
3. Builder hands off: `{files, tests, evidence, unresolved}` — result text, uncommitted worktree.
4. Quality reviewer (§6.3) reviews the diff; security reviewer (§6.4) reviews next.
5. On double approval, orchestrator merges to the slice branch, runs the slice exit check, and
   (when green) the E2E tester runs the relevant acceptance script in a fresh CUA Space.
6. E2E failure returns to step 2 with the `generationId`/`reason`/`diagnostic` from the Debug log.
   Repeated failures become a kit function, rule, or regression test — never more retries.

## 8. Phase order and exit criteria

1. **film-clock.** Exit: 2D graph, SVG, physics, and 3D reference scenes pass seek-equals-play
   at 60 s; seek-time bench on slowest supported iPad reported; non-film figures byte-identical
   behavior (flag-gated).
2. **film-beats.** Exit: 30 s + 1 min silent fixture films (storyboard JSON + scene code,
   no model calls yet — model-side storyboard lands in slice 8) play through the real
   controller/player/probe path in the Playground; every beat passes film checks at three
   widths, light + dark; CUA-sandbox E2E of the player flows green.
3. **film-narration.** Exit: Cartesia spike accepted (terms/latency/price/retention); narration
   + captions within one frame over 1 min (stub in tests, real in the one acceptance run);
   first scene still inside budget; spend caps enforced.
4. **film-ask.** Exit: interrupt → answer/show/insert → auto-resume at anchor word, all in
   sandbox E2E; question markers in player + transcript.
5. **film-ask-full.** Exit: all four ladder rungs + full player controls pass in sandbox E2E.
6. **film-versions.** Exit: version patches, private inserts, promotion, picker, export choices
   pass; no cross-learner leaks (security re-review).
7. **film-export.** Exit: export choices from §6.5 step 7 pass; 4 min film exports frame-identical
   with synced audio, faster than real time on a laptop. (May run parallel to 5–6; needs 1–3.)
8. **film-multiscene.** Exit: ADR 009 accepted; 2–4 min films pass full §28.5 acceptance.
9. **film-deck.** Exit: deck advance + slide/video export pass in sandbox E2E.
10. **film-gallery-evals.** Exit: gallery + bench + evals + telemetry live; docs in sync; full
    §6.5 acceptance green end to end.

## 9. Risks and open decisions

- ADR 009 (parallel scene calls) is still `proposed` — required before slice 8.
- Cartesia terms/latency/price/retention unverified — spike in slice 3, blocks narration merge.
- Scene length cap, plan cap, per-length deadlines come from the bench, not this file.
- Seek too slow on long physics/3D scenes → cap scene length lower or beat-level model restarts.
- Parallel scenes drifting apart → shared film context + per-scene checks (repair alone).
- Later product decisions: music bed in first release, sharing inserts between learners,
  fine-tuned small model (§18 of video-figures).
