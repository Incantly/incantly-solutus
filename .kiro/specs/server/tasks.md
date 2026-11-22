# Server: tasks

Built together with the teacher spec (`.kiro/specs/teacher/`), in the same rounds. Each round: build, test, one review, fix, merge.

- [x] 1. Round 1: `SERVER_JOB_MACHINE` in `docs/state-machines.md`; settings and `config_invalid`; the HTTP server, body limits, CORS, NDJSON writer; rate limits and daily budget; the log writer; `/v1/health` and `/v1/check` (R1, R2.4, R2.5, R5, R6)
- [ ] 2. Round 2: the OpenRouter client, the events reader and fallback; `/v1/figure/draw` over the teacher's `streamFigure`; the studio proxy and Tiptap on the real server (R2.1, R3, R4.1, R7.1, R7.2)
- [ ] 3. Round 3: `/v1/board/ask` for circle and talk, with pictures on the vision list; the studio board switches from the demo agent to the server when it answers (R2.2, R3.3, R4.2, R7.2)
- [ ] 4. Round 4: `/v1/teach`, `/v1/speech` with the free voices, and the studio's voice lesson (listening in the browser, the teacher's voice from the server, the browser's voice as fallback, barge-in) (R2.3, R7.3 to R7.5)
- [ ] 5. Round 5: `/v1/export/svg`; benches against design 9; `smoke:models`; the Muse Spark client if its API docs are in (R2.4, R3.4, R8)
