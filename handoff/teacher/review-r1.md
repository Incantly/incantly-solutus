# Teacher and server, round 1: review

One review (Opus), after the tester's report (`test-report.md`, 7 failing of 577). Rulings and findings; the fixer fixes TR-1 to TR-8, then merges. TR-9 goes to `findings.md` (fix later).

## Rulings on the doc contradictions

| Question | Ruling |
|---|---|
| `TURN_MACHINE` rows `cut` (from `calling` and `running_tool`) and `modelError` from `running_tool` | Keep them. Teacher design 6 gets the three rows |
| `SERVER_JOB_MACHINE` row `received` + `fail` | Keep it (a crash before the checks). Server design 7 gets the row |
| Failure streak: R4.4 "before the next model call" vs design 6 "in place of the fourth call" | Design 6 wins. R4.4 is reworded to match |
| Retry stop wording | T005 wins: a line stops after three failures, or when the same text fails twice in a row with the same fingerprint. Errors design 6 rule 3 is reworded to say the same |
| A command outside the loaded groups | Design 5 is wrong: the kernel's gate allows the command, so the line runs. Its group is loaded on the next call (R3.3). Design 5 is reworded |
| `t = Tangent(P, c)` in `agent.md` 3 and `prompt/jobs.ts` | A doc error: `t` is the film time. Use `tg = Tangent(P, c)` in both |

## Findings, fix now

| Id | Where | Problem | Fix |
|---|---|---|---|
| TR-1 | `http/body.ts` | Over the limit, the reader stops listening and the answer is written while the client still uploads, so the client gets a connection reset, not the 413 (5 of 6 runs with 10 MB). The `content-length` early path does the same | After deciding 413, keep reading and dropping the rest of the body until it ends, then answer; past 16 MB of dropped bytes, answer and destroy the socket. Both paths. The tester's 10 MB test must pass 20 runs in a row |
| TR-2 | `checkPicture` | A picture over 1.5 MB is `picture_invalid`; `server/errors.md` says `payload_too_large` | `payload_too_large` for bytes; `picture_invalid` stays for type and pixel size |
| TR-3 | `packages/server/.env.example` | Missing `HOST`, `PORT`, `ALLOWED_ORIGINS`, `RATE_PER_MINUTE`, `DAILY_MODEL_CALLS`, `TRUST_PROXY`; no "send no student data to free models" note | Add them with their defaults and the note |
| TR-4 | `agent.md` 3, `prompt/jobs.ts` | The live example teaches a line the kernel refuses (`reserved_name`) | `tg = Tangent(P, c)` in both. Every example line in `jobs.ts` runs in a headless app in the tester's prompt test |
| TR-5 | `jobs/job.ts` `ensureEnded`, `writeError` | **A new kind of hidden state.** The job's machine and the response's own flags (`headersSent`, `writableEnded`) both say whether an answer was sent. `ensureEnded` writes an `internal` answer from the response's flags and leaves the machine in `running`, so the two disagree | `ensureEnded` goes through the machine: when the job is not final it calls `fail(internal)`. Only the low-level writers may read the response's flags, as a last guard. New lint rule `state-no-io-flags`: in a file that makes a `StateMachine`, reading `headersSent`, `writableEnded`, `writableFinished`, `destroyed` or `readyState` is an error outside a function whose name starts with `write`. Rule tests in `tools/eslint-rules/`, on for every package |
| TR-6 | `loop/turn.ts` | The 60 s turn limit is read only between events, and the teacher has no timers, so a model that sends nothing is never stopped by it | The caller's signal carries the deadline. When the signal is aborted with a `TimeoutError` reason, the turn ends with `turn_limit`, not as `stopped`. Design 6 says the caller passes `AbortSignal.timeout`. Round 2's plan item 3 adds the server side (the turn timer and the 15 s first byte) |
| TR-7 | docs | The rulings above | Write them into teacher design 5 and 6, server design 7, errors design 6 rule 3, teacher R4.4, `agent.md` 3 |
| TR-8 | `tools/draw.ts` | A line that reads a name an earlier failed line of the same call should get `blockedBy` and `recovery: 'fix_earlier'` (errors design 6 rule 2). The SDK's `run(lines)` gives `unknown_name` instead | Run the call's lines through the kernel's independent batch (`mode: 'independent'`) so `blockedBy` comes from the kernel, through the SDK if it needs a small option on `run`. If that is more than a small change, say so and move TR-8 to `findings.md` with what blocks it |

## Fix later

| Id | Problem |
|---|---|
| TR-9 | `history` comes from the client, so a client can write `assistant` turns the model will trust. The model's output is still checked before it leaves, so the harm is small. Later: keep the conversation on the server, or send earlier assistant turns inside the material block |
