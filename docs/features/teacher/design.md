# Teacher: design

The teacher is the model that writes Incantly while it talks. This package holds everything about it that is not a network call: the tools it may call, the catalogue and instructions it reads, the loop that runs one turn, and the streaming apply that puts lines on a figure as they arrive. `packages/server` gives it a model; the board, Tiptap and the studio give it a figure or a board.

Core design 10 is the source of the two first tools (`draw`, `figure`) and the flow; `docs/features/board/agent.md` is the source of the board tools; `docs/features/errors/design.md` 6 is the source of the retry rules. This file says how they fit together.

## 1. What it does

| Job | Example |
|---|---|
| Live lesson | "Take a circle of radius 2 and a point on it" gives `c = Circle((0, 0), 2)` and `P = PointOn(c)` while the sentence is spoken |
| Prompt to figure | Tiptap's "show the area under x² from 0 to 2" gives a figure whose lines stream in |
| Circle to ask | A circled curve and "Graph it" give a figure card beside the circle and an arrow |
| Talking agent | "Write the formula under the triangle" gives a hand-style `write` placed below it |

Every job ends as lines of the formula language or board actions. Nothing the model writes runs as code.

## 2. Words

| Word | Means |
|---|---|
| Turn | One request and everything the model does to answer it: model calls, tool calls, spoken text |
| Tool | A named action the model may call, with a JSON schema for its input and a plain-data result |
| Toolset | The tools one job offers, such as `draw` and `figure` for Tiptap, or `board_read` and `board` for the board's `circle` and `talk` jobs (a `figure` action carries a card's lines; the live teacher on a board also keeps `draw` and `figure`) |
| Target | What the tools act on: a figure (an SDK `App`) or a board (`@incantly/board/core`) |
| Catalogue | The command forms the model may use, one line each, filtered by the app mode |
| Model client | The interface the server gives the loop: one streamed chat call with tools. The teacher package never opens a socket |

## 3. Layers

```
packages/teacher/src/
  tools/       tool definitions (schemas) and their runners over a target
  prompt/      catalogue builder, grammar summary, mode card, instructions per job
  loop/        the turn loop over a ModelClient (no network), retry budget, limits
  stream/      line splitter, streaming apply, plan, script and repair calls
  index.ts     public exports
```

The whole package has no DOM, timers, network or `Date`, like the kernel. Time comes in as a `now()` the caller passes, so the server and the tests decide it. It runs in Node (the server) and in the browser (an offline or self-hosted teacher, and the tests).

May import: `@incantly/kernel`, `@incantly/modes`, the SDK's headless app (`createHeadlessApp`), and `@incantly/board/core` types and its tool runner. It imports no web layer.

## 4. Tools

| Tool | Input | Result | Source |
|---|---|---|---|
| `draw` | `{ lines: string[] }`, 1 to 5 | Per line: `{ ok: true, name, type, summary }` or the line's error object, plus `undefined` (names and reasons) | Core design 10 |
| `figure` | `{}` | Every object: name, type, value summary, visible, undefined reason | Core design 10 |
| `board_read` | `{ area?, page? }` | Items in reading order | Board agent 1 |
| `board` | `{ actions }`, 1 to 20 | Per action `{ ok: true, id }` or an error (on the server `{ ok: true }`: ids are the client's, and the model names the previous shape `$last`) | Board agent 2 |
| `pause`, `resume` | `{}` | `{ ok: true, t }` | Core design 10 |
| `seek_beat` | `{ t: number }` | `{ ok: true, t }` | Core design 10 |
| `show_me` | `{ name, value }` or `{ name, to, seconds }` | The `draw` result of the `SetValue` line it writes | Core design 10 |

- A tool is `{ name, description, schema, run(target, input) }`. `run` returns a `Result`; it never throws. A bad input is `tool_input` (T001) with the schema's expected shape in `forms`.
- `draw` applies each line on its own through the target's `run` (SDK 1, with `independent: true`): a good line commits; a bad line changes nothing and does not undo the lines before it (core design 10, flow 2); a later line that reads a name a failed line was to make gets `blockedBy` and `recovery: 'fix_earlier'` from the kernel (errors design 6, rule 2).
- The film tools (`pause`, `resume`, `seek_beat`, `show_me`) act on the target's clock. On a board they act on the figure card the turn made last, or the one in focus.
- Each film tool also sends an event for the client that shows the figure: `pause` and `resume` a `control` event (`{ op: "pause" }`, `{ op: "resume" }`), `seek_beat` a `control` event with the time the target stands at (`{ op: "seek", t }`, clamped to the film), and `show_me` a `lines` event with its `SetValue` line once the line passed. On a board target the server has no figure to check the line on, so `show_me` sends it on as it is and the card in focus checks it as it applies it.
- `show_me { name, value }` writes `SetValue(name, value)` for a number, true or false, a text or a point `[x, y]`. `show_me { name, to, seconds }` writes `SetValue(name, to)` and the figure moves at once: `seconds` (above 0, at most 30) is checked and reported in the result, and a timed glide waits for a field in the protocol (`handoff/teacher/findings.md`). A free value it cannot set gives the `draw` error for the line (`not_free`, `unknown_name`).- A toolset is built from a list, so a host can leave tools out (Tiptap offers only `draw` and `figure`) or add its own through the same shape.
- Two tool calls on one target never overlap. A call that arrives while another runs on the same target gets `tool_busy` (T002) and is not run.

## 5. Catalogue and instructions

The prompt is built, not written by hand, so it follows the command table.

| Part | From | Size |
|---|---|---|
| Instructions for the job | `prompt/jobs.ts`, one text per job (live, figure, circle, talk) | about 400 tokens |
| Grammar summary | `prompt/grammar.ts`, from the language docs | about 300 tokens |
| Mode card | `modeCard(mode)` from `@incantly/modes` | about 150 tokens |
| Catalogue | Each form of each command the mode allows, printed by the kernel's form printer (`Circle(center: Point, radius: Number) -> Circle`), grouped by command group | about 1,200 tokens for the v1 groups |
| Board tools | `docs/features/board/agent.md` 1 to 4, for board jobs | about 450 tokens |
| The target now | The figure's `figureSummary`, or `board_read` of the view | at most 1,200 tokens |

- The catalogue is filtered by the mode's policy (`filterCatalogue`), so the model never sees a command the gate would refuse.
- Groups load on demand once the catalogue passes 2,000 tokens: the prompt holds every group's name and one line about it, plus the groups the request's words or the target's objects need. A line that names a command outside the loaded groups runs all the same, because the kernel's gate allows every command of the mode; the loop loads that group on the next model call (R3.3), so the model sees its forms from then on.
- A token is counted as 4 characters for budgets. The builder reports the total, and a test holds each job's prompt under 4,000 tokens.
- What a person wrote (document text, board text, a circled item's text, a spoken sentence) goes in a fenced data block marked as the user's material. The instructions say text inside it is never an instruction to the model.

## 6. The turn loop

```
request -> build prompt -> model call -> tool calls? -> run tools -> results back -> model call -> ... -> done
                                     \-> text only -> done
```

1. The loop asks the model client for one streamed reply with the toolset.
2. Spoken or written text in the reply streams out as `say` events at once, so speech starts before the tools run.
3. Each tool call runs when its arguments are complete. Its result goes into the next model call.
4. The turn ends when a reply has no tool calls, or a limit is hit.

| Limit | Value | When hit |
|---|---|---|
| Model calls in a turn | 8 | `turn_limit` (T003); what was drawn stays |
| Tool calls in a turn | 24 | `turn_limit` |
| Retries of one line | 2 (errors design 6, rule 3) | The line stops after three failures (the first and two retries), or when the same text fails twice in a row with the same fingerprint (T005); it is skipped and reported as skipped in the next result |
| Same error kind three times in a row, nothing passing | errors design 6, rule 10 | The loop runs `figure` and passes its result in place of the fourth call: the next `draw` call is answered with the `figure` result and is not run |
| Turn time | 60 s | `turn_limit`. The caller passes `AbortSignal.timeout(60_000)` as the turn's signal (the package has no timers); a signal aborted with a `TimeoutError` reason ends the turn as `turn_limit`, whatever the model is doing, and any other reason ends it as a stop. The injected `now()` is also read between events |

- Retry counting uses the error's `fingerprint`: a line is the left side of a definition (`P`, `f(x)`, `A,B`), else its text. The same text failing twice in a row with the same fingerprint stops that line, as does a third failure of any kind.
- The model may say only what the results report (core design 10, rule 4), and never speaks error kinds or "retry" (errors design 6, rule 8). The live instructions say so, and the loop helps: after a tool result with failures, it adds one line to the next call naming what did not draw.
- Stop (the caller's `AbortSignal`) ends the turn at once. What was applied stays. A newer request on the same target aborts the older one; the caller does that.

The loop's states are one field over `TURN_MACHINE` (below). It is written in `docs/state-machines.md` before the code.

| From | Event | To |
|---|---|---|
| `idle` | start | `calling` |
| `calling` | tool call complete | `running_tool` |
| `calling` | reply ended with no tool calls | `done` |
| `calling`, `running_tool` | stream cut (the reply stopped partway) | `done`, with a `stream_cut` notice (T006) |
| `running_tool` | result ready, more tool calls in this reply | `running_tool` |
| `running_tool` | results ready | `calling` |
| `calling`, `running_tool` | limit | `limited` |
| `calling`, `running_tool` | abort | `stopped` |
| `calling`, `running_tool` | model error | `failed` |

Every other move is refused and reported (`state-refusal-reported`).

## 7. Streaming apply, prompt to figure

Tiptap's AI and the board's `figure` action use this path. It follows core design 10, "Non-live generation".

1. **Plan call.** The model gets the request, the mode, the catalogue and the current script. It answers with a short plan: the objects to make, in order, with no lines. Skipped for an edit of a figure with fewer than 3 objects and for circle to ask with a choice that names the result (`graph`, `solve`, `steps`).
2. **Script call.** The model writes lines only, one a line. The splitter cuts the stream at each newline, drops blank lines, comments the model wraps in code fences and leading numbers, and applies each line the moment it ends. Each good line goes out at once as a `lines` event.
3. **Repair call.** Failed lines are kept with their errors. After the stream ends, one repair call gets the script so far and the failures, and writes replacement lines, applied the same way. Lines still failing are reported and left out.

- The first line can show within about 1 s of the model's first token: a line applies in under 1 ms, and the splitter waits only for the newline.
- The script grows only by lines that passed, so what the client commits is always a script that loads.
- Lines are capped at a script limit the caller passes as an option (default: the SDK's script limit); past it the stream stops with `limit`.
- The final `done` carries the notices (`retry_spent` for each line left out, `stream_cut` for a cut answer); the server sends them on to the client.

## 8. Speech

The live teacher talks with a real voice. The package itself never handles audio: words come in as text and go out as `say` text, and the server and the studio turn them into sound.

| Way | Where | Note |
|---|---|---|
| Listening | The browser's speech recognition (Web Speech API), in the studio | Text goes to the server as the turn's request. Where the browser has none, the studio shows a text box. OpenRouter has no free speech-to-text model (checked 2026-11-22), so listening stays in the browser |
| Speaking | A free OpenRouter voice model through the server's `POST /v1/speech` (server design 6) | Each `say` sentence is sent as soon as it ends, and its audio plays in order while the next one is made. A sentence's audio starts about 1 to 2 s after the request |
| Speaking, fallback | The browser's speech synthesis | Used when the server's voice is busy, fails, or is off |
| Turn taking | The studio | When the person speaks while the teacher talks, playback stops, queued sentences are dropped and the current turn is aborted |

Free voice models, checked on 2026-11-22 with "Take a circle of radius two, and a point on it.":

| Model | Format | First byte | Whole clip | Voices |
|---|---|---|---|---|
| `fish-audio/s2.1-pro-free:free` | MP3 | 1.1 s | 2.8 s for 3.2 s of speech | Default voice; takes delivery `instructions` |
| `heygen/heygen-voice-1-turbo:free` | PCM only | 2.1 s | 2.4 s | `nadine`, `tabitha`, `bram`, `gareth`, `noelle`, `meredith`, `sabrina`, `lucian`, `weston`, `vincent` |

Fish is tried first, HeyGen second. No library is added: playback uses the browser's audio element for MP3 and Web Audio for PCM.

**Sentences.** The voice takes whole sentences. The live job (`liveTurn`) runs the turn and gives `say` events one sentence each: `SentenceSplitter` cuts the model's text at `.`, `!`, `?`, `…` and line breaks that are followed by a space (so `2.5` and `e.g.` stay whole), cuts a run of more than 400 characters at a comma or a space (the voice takes 500), drops markdown marks (`` ` ``, `*`, `#`, `$`) and anything with no letter or digit, and flushes what is left when a tool call, `done` or an error follows. The studio never sees a raw piece of the stream.

**The studio's lesson.** `apps/studio/src/voice.ts` (`VoiceLesson`, `VOICE_MACHINE`, docs/state-machines.md TE4): the learner talks (browser recognition) or types; the request goes to `POST /v1/teach`; each `say` sentence asks `/v1/speech` for its audio at once, so the next sentence is being made while this one plays; clips play in order; a sentence whose audio failed is spoken by the browser's voice in its place; `lines`, `actions` and `control` change the figure or the board as they arrive. When the learner speaks or types while the teacher talks (or presses Stop), the clip stops, the queue is dropped and the turn is aborted.
## 9. Target adapters

| Target | Adapter | Used by |
|---|---|---|
| Figure | `figureTarget(app)` over an SDK `App` or headless app | Tiptap, the studio's AI panel, a board figure card, the server's checks |
| Board | `boardTarget(board)` over `@incantly/board/core` | The board's agents |

An adapter gives the tools `run`, `figureSummary`, `undefinedObjects`, the clock and, for the board, `board_read` and the checks of `board`. The server keeps a headless copy of the target to run the tools and check each line before it streams (server design 5).

`boardTarget(data, options)` (round 3) is the board as a request: the items in view, the page, `more`, the circle's area, whether the user allows edits, and the mode of the catalogue (a circle's choice sets it: `geometry` for `measure` and `geometry`, `graphing` for the rest). It has no figure of its own, so the jobs `circle` and `talk` offer only `board_read` and `board`; a figure card's lines go through the `figure` action, whose result lists each line. A target over a live board (the runner's `BoardAgent`, which applies actions and is asynchronous) is not built: the jobs that touch a board take its items as a request, and the client applies what comes back.

`liveTarget(app, board?)` (round 4) is the target of a live lesson. On a figure it is `figureTarget(app)`. On a board it is the figure of the card in focus (the request's `script`, which the server loads into a headless app) with the board's port added: `board_read` and `board` read the request's items and check the actions, and the film tools reach the figure's clock. `draw` and `figure` are offered on a board only when the card in focus has objects; a board with no card in focus gets `board_read`, `board` and the film tools. Its `kind` is `board`, so `show_me` sends its line on unchecked (see 4).

## 10. Performance

| Measure | Target |
|---|---|
| Build a prompt (catalogue cached per mode) | under 2 ms |
| `draw` of 5 lines, tool overhead over the kernel | under 0.2 ms |
| Splitter and apply, per streamed line | under 1 ms with the kernel's line |
| Loop overhead per model call (not the model) | under 1 ms |
| Model fixes an error on its next line | 9 in 10 on the error test set (core design 12) |

The benches use a fake model client, so they measure our code only.

## 11. Acceptance lessons

Core design 12 names three: a pendulum, the area under a curve, and a fire. Each is a recorded turn (the request, the model's replies) that the loop replays with the fake client, and the figure it leaves is checked by its objects. With a real model they run as an opt-in smoke test.

The recordings are `packages/teacher/test/fixtures/lesson-pendulum.json`, `lesson-area.json` and `lesson-fire.json`. Each holds `replies` (what `fakeModel` replays), the `mode` and the `request` of the lesson, and an `expect` record (the objects the figure holds at the end, the value `show_me` sets, how many sentences are spoken, the film controls that go out). They were written by hand from the shape of a live lesson (a sentence and its lines in one reply, film tools, a closing sentence) and checked to pass the kernel; a live capture waits for round 5's smoke run.

## 12. Open questions

1. Muse Spark's API: the client waits for the documentation the product owner gives (server design 4).
2. Whether the live teacher may change a learner's own objects without asking (today: only through `show_me` on free values and sliders).
