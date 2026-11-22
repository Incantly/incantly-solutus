# Server: errors

Errors use the SDK shape `{ ok: false, kind, message, hint?, detail? }`. A check that fails answers with an HTTP error whose JSON body is the error; once a model route's checks pass (method, origin, size, JSON, fields, rate limit, daily budget, key) the answer is a stream and every later error is its last event, `{ "error": { … } }`. The clients turn any `error` event into their own kind (`ai_unavailable` in Tiptap, `agent_unavailable` or `agent_partial` on the board), and read the `kind` and `message` of an HTTP error body the same way, keeping `http_<status>` only when the body is not an error. Nothing in an error holds a key, a request body or a provider's raw answer.

| Kind | HTTP | When | Message | Recovery |
|---|---|---|---|---|
| `config_invalid` | none (start) | A setting is wrong: a model id without `:free`, a bad port, an unknown provider | Names the setting and why | Fix `.env`; the server does not start |
| `bad_request` | 400 | Not JSON, a missing or wrong field, an unknown mode | Names the field | Fix the request |
| `payload_too_large` | 413 | Over the body (256 KB, 2.5 MB with a picture), picture (1.5 MB) or text (4,000 characters) limits | Names the limit | Send less |
| `picture_invalid` | 400 | The picture is not PNG or JPEG, or too large in pixels | Names the reason | Send a PNG or JPEG |
| `origin_blocked` | 403 | The browser origin is not in `ALLOWED_ORIGINS` | "This site may not use the server." | Add the origin |
| `rate_limited` | 429 | Over `RATE_PER_MINUTE` for this client | "Too many requests; try again in {s} s." | `detail.retryAfterMs` |
| `daily_budget` | 429 | `DAILY_MODEL_CALLS` used up | "The AI has done its work for today." | Wait until the next day (UTC) |
| `model_unavailable` | 503 (no key) or stream | No key for the provider, or the provider cannot be reached | "The AI is not set up." | Set the key |
| `model_busy` | stream, or 503 on `/v1/speech` | Every model in the list is busy (429) | "The AI is busy; try again in {s} s." | `detail.retryAfterMs` |
| `model_timeout` | stream, or 504 on `/v1/speech` | No first byte from any model in 15 s, or the turn passed 60 s | "The AI took too long." | Retry |
| `model_bad_output` | stream | The model wrote no line or action that passed, after the repair call | "The AI could not draw this." | Rephrase |
| `superseded` | stream | A newer request from the same client replaced this one after the stream began | "A newer request replaced this one." | The client keeps or drops what it applied, as for any error |
| `not_found` | 404 | An unknown route | Lists the routes | — |
| `internal` | 500 or stream | A bug | "Something went wrong in the server; nothing was changed." | Report; the log has the fingerprint |

A stream that ends with an error after good events keeps what it sent: the client keeps the lines and actions it applied, as both clients already do.
