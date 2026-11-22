# Server: design

`packages/server` is the only place that calls a model and the only place that holds a key. It is a small Node service: it takes a request from the studio, Tiptap or the board, runs the teacher's turn loop (`docs/features/teacher/design.md` 6) against a model, checks every line and action on a headless copy of the target, and streams the answer back as NDJSON.

## 1. What it does

| Job | Endpoint | Client already built |
|---|---|---|
| Prompt to figure, edit a figure | `POST /v1/figure/draw` | Tiptap `httpTransport` (`packages/tiptap/src/ai.ts`) |
| Circle to ask, talking agent | `POST /v1/board/ask` | Board `httpAgentTransport` (`packages/board/src/web/agent-http.ts`) |
| Live voice lesson | `POST /v1/teach` | New, in the studio |
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
  providers/     ModelClient for OpenRouter and Muse Spark, SSE reader, fallback across models
  limits/        rate limits per client, daily budget, concurrency
  jobs/          one file per endpoint: builds the teacher turn and its target, maps events to the stream
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
| `MODEL_PROVIDER` | `openrouter` | `openrouter` or `muse` |
| `OPENROUTER_API_KEY` | none | Required for `openrouter` |
| `OPENROUTER_TEXT_MODELS` | the list in `.env.example` | Free model ids, tried in order |
| `OPENROUTER_VISION_MODELS` | the list in `.env.example` | Free model ids for requests with a picture |
| `OPENROUTER_SPEECH_MODELS` | `fish-audio/s2.1-pro-free:free,heygen/heygen-voice-1-turbo:free` | Free voice models for `/v1/speech`, tried in order |
| `OPENROUTER_SPEECH_VOICE` | `bram` | The voice for models that need one named (HeyGen) |
| `MUSE_API_KEY` | none | Required for `muse` |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8787` | Port |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | Browser origins that may call the server |
| `RATE_PER_MINUTE` | `20` | Model requests a minute per client |
| `DAILY_MODEL_CALLS` | `900` | Model calls a day for the whole server, under OpenRouter's 1,000 |

- On start, every setting is checked. A model id that does not end in `:free` is refused: the server does not start (`config_invalid`). This keeps every call free, as `tech.md` requires.
- A missing key does not stop the server. Model endpoints then answer `model_unavailable`, and `/v1/check` and `/v1/export/svg` still work.
- `/v1/health` lists the provider, the model ids and whether a key is set (`true` or `false`), never the key.

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

**OpenRouter.** `POST https://openrouter.ai/api/v1/chat/completions` with `stream: true` and the toolset as OpenAI-style `tools`. The reader parses server-sent events itself, joins each tool call's argument pieces, and gives a `toolCall` only when its arguments are complete. A picture goes as an `image_url` part with a data URL.

**Fallback.** The models are tried in order. A model passes to the next on HTTP 429, 5xx, a network error, no first byte within 15 s, or a reply with tool calls when the model is known not to support them. A model that gave 429 is skipped for 60 s. When all are busy, the answer is `model_busy` with `retryAfterMs`. A model never changes in the middle of a reply that has already streamed text or a tool call.

**Muse Spark.** The second provider, behind the same `ModelClient`. It follows the Muse Spark API documentation the product owner gives; until then the client is a stub that answers `model_unavailable`.

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
| `/v1/figure/draw` | `{ "lines": [...] }`, then `{ "done": true }` |
| `/v1/board/ask` | `{ "actions": [...] }`, then `{ "done": true }` |
| `/v1/teach` | `{ "say": "..." }`, `{ "lines": [...] }`, `{ "actions": [...] }`, `{ "control": { "op": "pause" \| "resume" \| "seek", "t"? } }`, then `{ "done": true, "notices"? }` |
| any | `{ "error": { "kind", "message", "hint"?, "detail"? } }`, which ends the stream |

- When the client closes the connection, the server aborts the model call at once.
- A request that fails before streaming (bad JSON, too large, wrong origin, rate limit) answers with an HTTP status and one JSON error body: `400`, `413`, `403`, `429` with `retry-after`.
- `/v1/check` answers one JSON body: the per-line results of the kernel, as `draw` gives them.
- `/v1/export/svg` answers `image/svg+xml`, painted by the SDK export.
- `/v1/speech` takes `{ "text": "…", "instructions"? }`, one sentence of at most 500 characters, and streams the audio back as it comes from OpenRouter's `POST /api/v1/audio/speech`: `audio/mpeg` from Fish, or `audio/pcm` with `x-sample-rate` from HeyGen. It falls back across `OPENROUTER_SPEECH_MODELS` like the chat models, counts toward the client's rate limit at one tenth of a model request, and answers `model_busy` or `model_unavailable` when no voice is free, so the studio uses the browser's voice.

`/v1/teach` request:

```json
{ "text": "Take a circle of radius 2", "mode": "geometry", "script": "", "t": 0, "board": null, "history": [] }
```

`history` holds the last turns as `{ role, text }`, at most 10 and 8,000 characters. `board`, when present, is the board request's `items` and `page`.

## 7. Limits and safety

| Limit | Value |
|---|---|
| Request body | 2 MB with a picture, 256 KB without |
| Picture | PNG or JPEG by magic number, at most 1.5 MB, at most 2,048 px a side |
| Spoken or typed text | 4,000 characters |
| Script | the SDK's script limit |
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
| `received` | checks pass | `running` |
| `received` | a check fails | `refused` |
| `running` | first event written | `streaming` |
| `running`, `streaming` | turn done | `done` |
| `running`, `streaming` | client closed | `aborted` |
| `running`, `streaming` | error | `failed` |

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

1. Muse Spark's API documentation, for its client.
2. Where the server runs for the demo: the developer's machine, or the Coolify VPS. The design holds for both; the VPS needs `ALLOWED_ORIGINS`, `HOST=0.0.0.0` behind its proxy, and `TRUST_PROXY=1`.
