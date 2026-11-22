# Teacher and server, round 2: review

One review (Opus), after the tester's report (`test-report.md` "Round 2", 5 failing of 12,319). The fixer fixes TR-12 to TR-19, then merges. No new kind of hidden state this round: the figure stream (TE3) and the model call (SV2) are each one machine, and the rest are lists and counters.

## Rulings

| Question | Ruling |
|---|---|
| A stream with `finish_reason` (and usage) but no `[DONE]` | The reply is whole: OpenRouter's `finish_reason` is the model's own end, and `[DONE]` is the transport's. `stream_cut` is a stream that ends with neither. SV2 and plan round 2 are reworded; the tester's test changes to the ruling |
| Errors that come before the first event of a model route (`model_bad_output`, `model_timeout`, `model_busy`) | `errors.md` wins. Once a model route's checks pass (method, origin, size, JSON, fields, rate limit, daily budget, key), the answer is `200` NDJSON and every later error is the stream's last event. Only the checks answer with an HTTP status. SV1 is reworded: `checked` opens the stream on a model route |
| Plan skip: "fewer than 3 lines" vs fewer than 3 objects | Objects. Teacher design 7 says "an edit of a figure with fewer than 3 objects" |
| First byte | The first chat event with content; keep-alive comments and a role-only chunk do not count. Server design 4 says so |
| Script cap | A caller option, default the SDK's script limit. Design 7 says so |
| "a reply with tool calls when the model is known not to support them" (server design 4) | Dropped. Every model in the lists was checked with tools; a model that answers without tools is treated as a text reply |
| `ok: false` inside the error event | Fine; the clients read `kind` and `message` |

## Findings, fix now

| Id | Where | Problem | Fix |
|---|---|---|---|
| TR-12 | `jobs/figure.ts` | Text over 4,000 characters answers 400; `errors.md` says 413 `payload_too_large` | 413 for the text and history limits |
| TR-13 | `providers/sse.ts` | The ruling above | `finish_reason` ends the reply as whole; neither `finish_reason` nor `[DONE]` is `stream_cut` |
| TR-14 | `jobs/job.ts`, `jobs/figure.ts` | `model_bad_output`, `model_timeout` and `model_busy` come as HTTP 502, 504, 503 when nothing streamed first, so the writer sees only `http_502` | The ruling above: a model route opens the stream when its checks pass |
| TR-15 | `jobs/figure.ts` | The `stream_cut` and `retry_spent` notices are dropped, so Tiptap sees a plain `done` after a cut answer | Send them: `{ "done": true, "notices": [...] }`. Tiptap's `parseEvent` keeps reading `done` |
| TR-16 | `jobs/figure.ts` | A request that a newer one from the same client aborted ends with `done`, so Tiptap commits a half figure as if finished | It ends with `{ "error": { "kind": "superseded" } }`. New row in `server/errors.md`: `superseded`, stream only, "A newer request replaced this one.", the client keeps or drops what it applied as it does for any error |
| TR-17 | `packages/tiptap/src/ai.ts`, `packages/board/src/web/agent-http.ts` | On a non-200 answer both clients show only `http_<status>` and drop the server's JSON error | Read the body: when it is the SDK error shape, use its `kind` and `message`; else keep `http_<status>`. One shared helper per package is fine; no new dependency |
| TR-18 | docs | The rulings above | Teacher design 7, server design 4, 6 and 7, `server/errors.md` (`superseded`; the HTTP column says "stream" for the three model errors), `docs/state-machines.md` SV1 and SV2, plan round 2 |
| TR-19 | `packages/server/test/spec/` | The tests that rest on the rulings | Change only those tests to the rulings, and list each one |
