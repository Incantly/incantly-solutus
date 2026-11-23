# Server: design

`packages/server` is the only place that calls a model and the only place that holds a key. It is a small Node service: it takes a request from the studio, Tiptap or the board, runs the teacher's turn loop (`docs/features/teacher/design.md` 6) against a model, checks every line and action on a headless copy of the target, and streams the answer back as NDJSON.

## 1. What it does

| Job | Endpoint | Client already built |
|---|---|---|
| Prompt to figure, edit a figure | `POST /v1/figure/draw` | Tiptap `httpTransport` (`packages/tiptap/src/ai.ts`) |
| Circle to ask, talking agent | `POST /v1/board/ask` | Board `httpAgentTransport` (`packages/board/src/web/agent-http.ts`) |
| Live voice lesson | `POST /v1/teach` | New, in the studio |
| Conversation lesson (plan, memory, turns) | `POST /v1/lesson/start`, `/v1/lesson/turn`, `/v1/lesson/end` | Client in `apps/studio/src/lesson-client.ts`; the screen is round 2 (lesson design 7) |
| The teacher's voice | `POST /v1/speech` | New, in the studio |
| Check lines, no model | `POST /v1/check` | New |
| SVG of a script, no model | `POST /v1/export/svg` | New |
| Health and models | `GET /v1/health` | New |

The first two endpoints follow the contracts the clients already speak. The server adapts to them; the clients do not change.

## 2. Layers

```
packages/server/src/
  env.ts         read and check settings from process.env (loaded from .env by Node)
  http/          node:http server, routes, body limits, CORS, NDJSON writer
  providers/     ModelClient for OpenRouter, SSE reader, fallback across models
  limits/        rate limits per client, daily budget, concurrency
  jobs/          one file per endpoint: builds the teacher turn and its target, maps events to the stream
  lessons/       the lessons held in memory: `LessonStore`, `Lesson` and `LESSON_MACHINE` (lesson design 4, 6)
  log.ts         structured log lines with keys and bodies removed
  main.ts        start the server
  index.ts       createServer(options) for tests and hosts
```

No web framework and no new library. Node 22 gives `node:http`, `fetch`, `AbortController`, `process.loadEnvFile` and web streams.

May import: `@incantly/kernel`, `@incantly/teacher`, `@incantly/modes`, the SDK's headless app and SVG export, and `@incantly/board/core`.

## 3. Settings

All from `packages/server/.env` (ignored by git); `.env.example` lists them.

| Setting | Default | Meaning |
|---|---|---|
| `MODEL_PROVIDER` | `openrouter` | Only `openrouter`; any other value is `config_invalid` |
| `OPENROUTER_API_KEY` | none | Required for `openrouter` |
| `OPENROUTER_TEXT_MODELS` | the list in `.env.example` | Free model ids, tried in order |
| `OPENROUTER_VISION_MODELS` | the list in `.env.example` | Free model ids for requests with a picture |
| `OPENROUTER_SPEECH_MODELS` | `fish-audio/s2.1-pro-free:free,heygen/heygen-voice-1-turbo:free` | Free voice models for `/v1/speech`, tried in order |
| `OPENROUTER_SPEECH_VOICE` | `bram` | The voice for models that need one named (HeyGen) |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8787` | Port |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | Browser origins that may call the server |
| `RATE_PER_MINUTE` | `20` | Model requests a minute per client |
| `DAILY_MODEL_CALLS` | `900` | Model calls a day for the whole server, under OpenRouter's 1,000 |

- On start, every setting is checked. A model id that does not end in `:free` is refused: the server does not start (`config_invalid`). This keeps every call free, as `tech.md` requires.
- A missing key does not stop the server. Model endpoints then answer `model_unavailable`, and `/v1/check` and `/v1/export/svg` still work.
- `/v1/health` lists the provider, the model ids, whether a key is set (`keySet`, `true` or `false`, never the key), `ready`: `true` when a model client is set and its key is there, which is what the studio reads to choose between the server and the demo agent, and `voice`: `true` when `/v1/speech` has voices to use.

## 4. Providers

```ts
interface ModelClient {
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
type ChatEvent =
  | { text: string }                                   // a piece of the reply
  | { toolCall: { id: string; name: string; args: string } }   // complete arguments
  | { done: { model: string; inputTokens: number; outputTokens: number } };
```

**OpenRouter.** `POST https://openrouter.ai/api/v1/chat/completions` with `stream: true` and the toolset as OpenAI-style `tools`. The reader parses server-sent events itself, joins each tool call's argument pieces, and gives a `toolCall` only when its arguments are complete. A picture goes as an `image_url` part with a data URL. A reply is whole when a choice carries a `finish_reason` (the model's own end) or the stream ends with `[DONE]` (the transport's end); either one gives `done`. A stream that ends with neither is `stream_cut`.

**Fallback.** The models are tried in order. A model passes to the next on HTTP 429, 5xx, a network error, or no first byte within 15 s. The first byte is the first chat event with content (text, a tool call, `done` or an error); a keep-alive comment or a chunk that holds only the role does not count. A model that answers a request that carries tools with text only is treated as a text reply. A model that gave 429 is skipped for 60 s. When all are busy, the answer is `model_busy` with `retryAfterMs`. A model never changes in the middle of a reply that has already streamed text or a tool call.

**One provider.** OpenRouter is the only provider (product owner, 2026-11-22). Muse Spark is not used.

**Fake.** `fakeModel(script)` replays recorded replies. Every test and bench uses it. No test calls the network.

## 5. Headless checks

The server keeps a headless copy of the request's target for each job:

- For a figure, `createHeadlessApp` loaded with the request's `script` and `mode`, under the mode's gate.
- For a board, the request's `items` as read-only context, and a headless app per figure card the answer makes.

Every `draw` line runs on the copy first. A line that fails never reaches the client: the model gets its error and fixes it. So the client applies only lines that passed, and its own apply still checks them again. Board actions are checked against the board's action schema (`@incantly/board/core`) before they stream; placing and ids are the client's job, since only the client holds the whole board.

## 6. Streams

Every model endpoint answers `200` with `content-type: application/x-ndjson`, one JSON event a line, flushed at once.

| Endpoint | Events |
|---|---|
| `/v1/figure/draw` | `{ "lines": [...] }`, then `{ "done": true, "notices"? }` |
| `/v1/board/ask` | `{ "say": "..." }` pieces (a talk's words as they come; a circle's in one piece before `done`, only when it drew something), `{ "actions": [...] }`, then `{ "done": true, "notices"? }` |
| `/v1/teach` | `{ "say": "..." }`, `{ "lines": [...] }`, `{ "actions": [...] }`, `{ "control": { "op": "pause" \| "resume" \| "seek", "t"? } }`, then `{ "done": true, "notices"? }` |
| `/v1/lesson/turn` | `{ "say": "..." }`, `{ "actions": [...] }`, `{ "lesson": { "plan", "step", "state" } }`, then `{ "done": true, "ended"?, "notices"? }` |
| any | `{ "error": { "kind", "message", "hint"?, "detail"? } }`, which ends the stream |

- When the client closes the connection, the server aborts the model call at once.
- A request that fails a check answers with an HTTP status and one JSON error body: `400`, `413`, `403`, `429` with `retry-after`, and `503` when no key is set. The checks of a model route are the method, the origin, the size, the JSON, the fields, the rate limit, the daily budget and the key. Once they pass, the answer is `200` NDJSON, and every later error (`model_busy`, `model_timeout`, `model_bad_output`, a failed model, the turn limit) is the stream's last event. A model route never answers a model error with an HTTP status.
- `done` carries `notices` when the teacher reported any (`retry_spent` for a line left out, `stream_cut` for a cut answer); a client that does not read them still sees `done`.
- A request that a newer one from the same client replaced ends with `{ "error": { "kind": "superseded" } }`, not `done`, so the client does not take a half figure for a finished one.
- `/v1/lesson/start` takes `{ topic?, mode?, board }` and answers `200` `{ lessonId }` (a random id, with no model call; `model_unavailable` when no key is set). `/v1/lesson/turn` takes `{ lessonId, text, board }`, takes the client's model slot as `/v1/teach` does, and streams the teacher's turn of the `lesson` job; the server keeps what was said before (the memory, lesson design 4), so the client sends only the learner's words and the board in view. A check that fails answers with an HTTP status (`lesson_unknown` 404, `lesson_busy` 409 for a turn from another client, `lesson_full` 503). `/v1/lesson/end` takes `{ lessonId }`, answers `200` `{ ok: true }` and stops a turn that still runs. `/start` counts as one request in the client's minute and `/end` as a tenth. The lesson's states, limits and memory are in `docs/features/lesson/design.md` 4, 6 and 7.
- `/v1/check` answers one JSON body: the per-line results of the kernel, as `draw` gives them.
- `/v1/export/svg` answers `image/svg+xml`, painted by the SDK export.
- `/v1/speech` takes `{ "text": "…", "model"?, "instructions"? }`, one sentence of at most 500 characters (`instructions` at most 200, `model` at most 200), and streams the audio back as it comes from OpenRouter's `POST /api/v1/audio/speech`: `audio/mpeg` from Fish (`response_format: "mp3"`), or `audio/pcm` with `x-sample-rate` from HeyGen (`response_format: "pcm"` with the voice `OPENROUTER_SPEECH_VOICE`; the rate is the provider's `x-sample-rate` header, else the `rate=` of its content type, else 24,000). A model whose id starts with `heygen/` is asked for PCM and the voice; any other is asked for MP3 and gets `instructions`. It falls back across `OPENROUTER_SPEECH_MODELS` like the chat models (429, 5xx, a network error, no first byte within 15 s; 60 s skip after a 429), trying a held `model` first when the caller names one that is still configured (an unknown id is ignored, never an error). The answer names the voice that spoke in `x-voice`, exposed to the browser, so the studio holds one voice for the whole conversation: a sentence that falls back to another model changes the voice for that lesson, not for one sentence. A request counts toward the client's rate limit at one tenth of a model request, takes no model slot and no model call of the day, and answers `model_busy`, `model_timeout` or `model_unavailable` as an HTTP error (nothing is streamed before the first byte), so the studio uses the browser's voice. A closed connection aborts the provider request. The head goes out with the first byte of audio; an error after that ends the response where it is.

`/v1/board/ask` request: the board's `CircleRequest` or `TalkRequest` (board agent 3) with `items` at most 60 (each `{ id, kind, box, text?, summary?, shape?, madeBy? }`), `more`, `page`, and for a circle `choice`, `circle` and `text?` (needed for `ask`), for a talk `text` and `allowEdit`. A `picture` is a PNG or JPEG data URL, checked by its bytes (`checkPicture`), and sends the turn to `OPENROUTER_VISION_MODELS`. The route's body limit is the picture one (2.5 MB: a picture of 1.5 MB is 2 MB as base64, and the JSON around it comes on top); a request with no picture is held to 256 KB. The action results the model reads are `{ ok: true }` or an error, one for each action and without an `id`: ids are made by the client, and the model names the shape the previous action made as `$last`. A talk that ends with words and no action ends with `done`; a talk with neither, and a circle that drew nothing, end with `model_bad_output` ("The AI could not draw this.").

`/v1/teach` request:

```json
{ "text": "Take a circle of radius 2", "mode": "geometry", "script": "", "t": 0, "board": null, "history": [] }
```

`text` is required (at most 4,000 characters, else `413`); `mode` is a mode of the app (default `graphing`); `script` is the figure's script (the script of the card in focus, on a board; at most 64 KB); `t` is the film time in seconds. `history` holds the last turns as `{ role, text }`, at most 10 and 8,000 characters (more turns is `400`, more characters `413`). `board`, when present, is `{ items, more?, page }`, the board request's items (at most 60), and makes the lesson a board lesson. The server loads `script` into a headless copy of `mode`, with no clock ticker, and the teacher's `liveTurn` runs the model against it: `say` events are whole sentences, `lines` are the lines that passed on the copy, `actions` the board actions that passed their checks, and `control` the film tools' controls (`pause`, `resume`, `seek` with the time the copy stands at). The route takes a model slot like the other model routes, so a newer request of the same client ends the older with `superseded`.

## 7. Limits and safety

| Limit | Value |
|---|---|
| Request body | 2.5 MB with a picture (1.5 MB of picture is 2 MB as base64), 256 KB without, 16 KB for `/v1/speech` |
| Picture | PNG or JPEG by magic number, at most 1.5 MB, at most 2,048 px a side |
| Spoken or typed text | 4,000 characters (`413 payload_too_large`); one spoken sentence 500 characters |
| Script | the SDK's script limit; a caller option of the model job, default that limit (the figure route passes 64 KB less the request's script) |
| Model requests per client | 20 a minute (`RATE_PER_MINUTE`), one at a time; a newer one aborts the older |
| Model calls per day | 900 (`DAILY_MODEL_CALLS`) |
| Whole turn | 60 s |

- **Keys.** Read from the environment only, sent only in the `Authorization` header to the provider, never logged, never in an error, never in `/v1/health`. The log writer drops `authorization` and every field whose name holds `key` or `token`.
- **Origins.** Browser requests must come from `ALLOWED_ORIGINS`; others get `403 origin_blocked`. The server binds to `127.0.0.1` by default.
- **Data.** Request bodies are not logged. Free models may keep what they are sent, so the README and `.env.example` say: send no student data to free models.
- **Model output.** Only lines and board actions leave the server, and both are checked (section 5). Nothing the model writes runs as code.
- **Client identity.** A client is its address for rate limits. Behind a proxy, the server trusts `x-forwarded-for` only when `TRUST_PROXY=1`.

The rate limiter and the daily budget are counters, not states. The job of one request is one field over `SERVER_JOB_MACHINE`, written in `docs/state-machines.md` before the code:

| From | Event | To |
|---|---|---|
| `received` | checks pass | `running` (a model route goes on to `streaming` at once: the head is written with no event) |
| `received` | a check fails | `refused` |
| `running` | first event written | `streaming` |
| `running`, `streaming` | turn done | `done` |
| `running`, `streaming` | client closed | `aborted` |
| `running`, `streaming` | error | `failed` |
| `received` | error (a crash before the checks) | `failed` |

## 8. Running it

```sh
npm run server      # builds with Vite, then node --env-file-if-exists=packages/server/.env, on 127.0.0.1:8787
npm run studio      # the studio proxies /v1 to the server, so the browser makes same-origin calls
```

- The studio uses the server when it answers `/v1/health`. Otherwise the board keeps its scripted demo agent, labelled "no AI", and Tiptap shows `ai_unavailable`.
- `npm run smoke:models` sends one request per configured model and prints time and result. It needs a key and is never part of `npm run check`.

## 9. Performance

| Measure | Target |
|---|---|
| Server overhead per request, before the model | under 5 ms |
| Headless check of a 5-line `draw` | under 2 ms |
| Time from the model's first line to it leaving the server | under 5 ms |
| Memory per open request | under 20 MB |
| `/v1/check` of 100 lines | under 50 ms |

The benches use the fake model, so they measure our code only.

## 10. Open questions

1. Where the server runs for the demo: the developer's machine, or the Coolify VPS. The design holds for both; the VPS needs `ALLOWED_ORIGINS`, `HOST=0.0.0.0` behind its proxy, and `TRUST_PROXY=1`.
