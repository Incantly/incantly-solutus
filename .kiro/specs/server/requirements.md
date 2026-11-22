# Server: requirements

Area: `docs/features/server/` (`design.md`, `errors.md`), with `docs/features/teacher/`. Package `packages/server` (`@incantly/server`), Node only. Branch `feat/server`.

### R1. Settings and keys (design 3, 7)

1. Settings SHALL come from the environment, loaded from `packages/server/.env`, which git ignores; `.env.example` SHALL list every setting with no real key.
2. A model id that does not end in `:free` SHALL stop the server at start with `config_invalid`.
3. A key SHALL be sent only in the provider's `Authorization` header, and SHALL never appear in a log, an error, a response or `/v1/health`.
4. A missing key SHALL make model endpoints answer `model_unavailable`, while `/v1/check` and `/v1/export/svg` keep working.

### R2. Endpoints and streams (design 1, 6)

1. `POST /v1/figure/draw` SHALL take Tiptap's `AiRequest` and answer its NDJSON events unchanged in shape.
2. `POST /v1/board/ask` SHALL take the board's `CircleRequest` or `TalkRequest` and answer its NDJSON events unchanged in shape.
3. `POST /v1/teach` SHALL answer `say`, `lines`, `actions`, `control`, `done` and `error` events.
4. `POST /v1/check` SHALL return the per-line results without a model; `POST /v1/export/svg` SHALL return the SDK's SVG of a script; `GET /v1/health` SHALL list the provider, models and whether a key is set.
5. Every event SHALL be flushed when written; a closed connection SHALL abort the model call.

### R3. Providers (design 4)

1. The OpenRouter client SHALL stream chat completions with tools, read the events itself, and give a tool call only with complete arguments.
2. Models SHALL be tried in order; 429, 5xx, a network error or no first byte in 15 s SHALL pass to the next; a model that gave 429 SHALL be skipped for 60 s; all busy SHALL give `model_busy` with `retryAfterMs`.
3. A request with a picture SHALL use the vision list.
4. Muse Spark SHALL sit behind the same `ModelClient`, built from the owner's API documentation; until then it SHALL answer `model_unavailable`.
5. No test SHALL call the network; tests use `fakeModel`.

### R4. Headless checks (design 5)

1. Every `draw` line SHALL run on a headless copy of the target before it streams; a failed line SHALL never reach the client.
2. Every board action SHALL pass the board's action schema before it streams.

### R5. Limits and safety (design 7)

1. The body, picture, text and turn limits of design 7 SHALL hold, with the HTTP statuses of `errors.md`.
2. Browser requests from an origin outside `ALLOWED_ORIGINS` SHALL get `403 origin_blocked`; the server SHALL bind to `127.0.0.1` by default.
3. Each client SHALL get at most `RATE_PER_MINUTE` model requests a minute and one at a time; the server SHALL stop model calls at `DAILY_MODEL_CALLS`.
4. Request bodies SHALL not be logged; the log writer SHALL drop authorization headers and fields named like keys or tokens.
5. A request's job SHALL be one field over `SERVER_JOB_MACHINE`, written in `docs/state-machines.md` before the code.

### R6. Errors (errors.md)

Every error in `errors.md` SHALL be returned in the SDK shape; nothing SHALL throw out of a handler, and an unexpected exception SHALL become `internal` with a fingerprint in the log.

### R7. Studio (design 8)

1. `npm run server` SHALL start the server; the studio's dev server SHALL proxy `/v1` to it.
2. The studio SHALL use the server when `/v1/health` answers, and keep the board's demo agent and Tiptap's `ai_unavailable` otherwise.
3. The studio's voice lesson SHALL listen with the browser's speech recognition, with a text box where recognition is missing.
4. The studio SHALL speak each `say` sentence through `/v1/speech` as soon as it ends, in order, and SHALL use the browser's speech synthesis when the server's voice is busy, fails or is off.
5. `POST /v1/speech` SHALL stream audio from `OPENROUTER_SPEECH_MODELS` (free ids only), take at most 500 characters, fall back across the voices, and stop when the client closes.

### R8. Speed (design 9)

The design 9 budgets SHALL hold in `packages/server/bench/` with the fake model.
