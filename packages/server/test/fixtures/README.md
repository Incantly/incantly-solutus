# Recorded OpenRouter streams

Written by hand from OpenRouter's documented chat completions stream format (server-sent events, one JSON chunk a `data:` line, `: OPENROUTER PROCESSING` comment lines, a last usage chunk, then `data: [DONE]`). They were not captured from a live call: no key was used and no network was reached. A live capture is left for round 5's smoke run (`npm run smoke:models`).

| File | What it holds |
|---|---|
| `openrouter-text.sse` | One plain text reply in four pieces, `finish_reason: stop`, a usage chunk, `[DONE]` |
| `openrouter-tool-calls.sse` | A reply with text and two tool calls: `draw` (index 0) whose arguments arrive in five pieces, and `figure` (index 1) whose arguments arrive as `{` then `}`; `finish_reason: tool_calls`, usage, `[DONE]` |
| `openrouter-429.json` | A `429` answer: `{ status, headers, body }` (not a stream) |
| `openrouter-cut.sse` | A stream that stops inside a line: two text pieces, no `finish_reason`, no `[DONE]` |

The ids, provider and usage numbers are made up. A fixture holds no key and no student data.
