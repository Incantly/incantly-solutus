# Server: design

The feature design is `docs/features/server/design.md`; this file says where each part lives.

## Package `packages/server/src/`

| Path | Holds |
|---|---|
| `env.ts` | `readSettings(env)`: every setting checked, `config_invalid` |
| `http/server.ts` | `createServer(options)` on `node:http`, the route table |
| `http/body.ts` | Body reading with limits, JSON parse, picture checks by magic number |
| `http/cors.ts` | Origin check and CORS headers |
| `http/ndjson.ts` | The NDJSON writer, flushed per event, aborts on close |
| `providers/openrouter.ts` | `openRouterClient(settings)`: chat with tools, streamed |
| `providers/sse.ts` | The server-sent events reader, tool-call argument joining |
| `providers/fallback.ts` | Model order, busy skips, `model_busy` |
| `limits/rate.ts` | Per-client minute counter, one-at-a-time, daily budget |
| `jobs/figure.ts` | `/v1/figure/draw` over the teacher's `streamFigure` |
| `jobs/board.ts` | `/v1/board/ask`, circle and talk |
| `jobs/teach.ts` | `/v1/teach`, the live job |
| `jobs/check.ts`, `jobs/svg.ts` | `/v1/check` and `/v1/export/svg` |
| `jobs/speech.ts` | `/v1/speech`: one sentence to audio, streamed, voices tried in order |
| `jobs/job.ts` | The job over `SERVER_JOB_MACHINE` |
| `log.ts` | Structured log lines, keys and bodies removed |
| `main.ts` | Loads `.env`, reads settings, starts listening |
| `index.ts` | Public exports for tests and hosts |

## Rules

- Node 22 only (`node:http`, `fetch`, web streams, `process.loadEnvFile`); no web framework and no new library.
- `console` stays out of the package; `log.ts` writes to a stream the caller passes, and `main.ts` passes `process.stdout`.
- Every state is one field over a `*_MACHINE` table; `SERVER_JOB_MACHINE` goes in `docs/state-machines.md` (section "server") first. Every lint rule is an error in `packages/server`.
- Tests use `fakeModel` and a server on a random port bound to `127.0.0.1`. No test calls the network. Recorded OpenRouter streams live in `packages/server/test/fixtures/`.
- Tests are written by the tester from the docs, in `packages/server/test/spec/`.

## Root and studio

- Root scripts: `server` builds the package with Vite (`packages/server/vite.config.ts`, SSR for Node, into the ignored `packages/server/dist/`) and runs `node --env-file-if-exists=packages/server/.env packages/server/dist/main.js`; no TypeScript runner is added. `smoke:models` is opt-in, needs a key, and is not part of `check`.
- `apps/studio/vite.config.ts`: proxy `/v1` to `http://127.0.0.1:8787`.
- `apps/studio`: a server probe at start; the board and Tiptap transports point at the same origin; the voice lesson panel (speech recognition, speech synthesis, text box fallback).
