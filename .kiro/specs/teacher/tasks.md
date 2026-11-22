# Teacher: tasks

Built together with the server spec (`.kiro/specs/server/`), in the rounds below. Each round: build, test, one review, fix, merge.

- [x] 1. Round 1: `TURN_MACHINE` in `docs/state-machines.md`; tool types, `draw`, `figure`, `figureTarget`; T001 to T006 in the errors table; catalogue builder with mode filter and groups on demand; grammar summary; job instructions; `buildPrompt` with token counts; `runTurn` with limits, retry budget and batch fingerprints; `fakeModel` (R1, R2.1 to R2.5, R3, R4, R7)
- [x] 2. Round 2: the line splitter and `streamFigure` (plan, script, repair), used by the server's `/v1/figure/draw` (R5)
- [ ] 3. Round 3: `boardTarget`, `board_read` and `board` tools, the circle and talk jobs (R2.1, R6)
- [ ] 4. Round 4: film tools, the live job, `say` events; the three acceptance lessons as recordings (R2.1, R6.2, R8.2)
- [ ] 5. Round 5: benches against design 10; the error test set and the opt-in smoke run with a real model (R8.1, R8.3)
