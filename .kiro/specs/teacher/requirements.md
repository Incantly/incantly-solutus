# Teacher: requirements

Area: `docs/features/teacher/` (`design.md`, `errors.md`, `agent.md`), with core design 10 and `docs/features/board/agent.md`. Package `packages/teacher` (`@incantly/teacher`). Branch `feat/teacher`.

### R1. No network, no DOM (design 3)

1. `packages/teacher` SHALL have no DOM, timers, network, `Date` or unseeded randomness, and SHALL run in Node and the browser.
2. Model calls SHALL reach the package only through a `ModelClient` the caller passes; time only through a `now()` the caller passes.

### R2. Tools (design 4)

1. `draw`, `figure`, `pause`, `resume`, `seek_beat`, `show_me`, `board_read` and `board` SHALL be tool definitions with a JSON schema and a runner over a target.
2. `draw` SHALL take 1 to 5 lines and apply each on its own: a good line commits; a bad line changes nothing and does not undo the lines before it.
3. Each line result SHALL be `{ ok: true, name, type, summary }` or the kernel's error object, unchanged.
4. A malformed call SHALL give `tool_input` (T001); a call while another runs on the same target SHALL give `tool_busy` (T002); an unknown tool SHALL give `tool_unknown` (T004).
5. A host SHALL be able to build a toolset from any subset of the tools, and add its own of the same shape.

### R3. Prompt (design 5, agent.md)

1. The catalogue SHALL be built from the kernel's command table and filtered by the app mode's policy, so it holds no command the gate refuses.
2. Each job's prompt (live, figure, circle, talk) SHALL be under 4,000 tokens (4 characters a token) before the target's data.
3. Past 2,000 tokens of catalogue, groups SHALL load on demand, and a line naming an unloaded group's command SHALL load that group on the next call.
4. Text a person wrote SHALL go in a marked data block, and the instructions SHALL say it is never an instruction.

### R4. Turn loop (design 6)

1. The loop SHALL run model calls and tool calls until a reply has no tool calls, or a limit (8 model calls, 24 tool calls, 60 s) gives `turn_limit` (T003).
2. Spoken text SHALL stream out as `say` events before the reply's tool calls run.
3. A line SHALL be retried at most twice, and stop after three failures, or when the same text fails twice in a row with the same fingerprint (`retry_spent`, T005).
4. Three failures in a row of the same kind, with nothing passing, SHALL make the loop answer the next `draw` call with the `figure` result, in place of running it (design 6).
5. An abort SHALL end the turn at once and keep what was applied.
6. The loop's state SHALL be one field over `TURN_MACHINE`, written in `docs/state-machines.md` before the code.

### R5. Streaming apply (design 7)

1. Prompt to figure SHALL use a plan call (skipped where design 7 says), a script call and one repair call.
2. Each streamed line SHALL be applied when its newline arrives, and go out as a `lines` event only when it passed.
3. The splitter SHALL drop blank lines, code fences and leading list numbers.
4. A stream that ends inside a line SHALL give `stream_cut` (T006) as a notice.

### R6. Targets (design 9)

1. `figureTarget` SHALL wrap an SDK `App` or headless app; `boardTarget` SHALL wrap `@incantly/board/core`.
2. Film tools on a board SHALL act on the figure card made last in the turn, or the one in focus.

### R7. Errors (errors.md)

T003 to T006 SHALL be added to `docs/features/errors/errors.md` and returned as `Result`s; nothing SHALL throw out of a public call.

### R8. Speed and acceptance (design 10, 11)

1. The design 10 budgets SHALL hold in `packages/teacher/bench/` with the fake model.
2. The pendulum, area under a curve and fire lessons SHALL replay from recordings and leave the expected objects.
3. The error test set SHALL show the model fixing an error on its next line in 9 of 10 cases, measured in the opt-in smoke run with a real model.
