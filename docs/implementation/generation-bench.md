# Generation bench

The bench measures what a learner waits for: the real pipeline (plan, scene by edits or written whole, validation, probe, one repair, the 25-second deadline) with real model replies. When no API key is at hand, the replies come from subagents of a coding agent, plans from Claude Haiku 5.5 and scenes and repairs from Claude Sonnet 5.5, one subagent per call, so the measurement needs no account and no network access of its own.

## How it works

`packages/generation/src/bench.ts` replays every generation in rounds. Each round runs the pipeline with the replies recorded so far, on a clock that advances by each reply's measured time, and stops a generation at its first call without a reply; those calls become the next round's prompts. Calls the pipeline starts together (a library build and its plan call) run side by side on that clock, and a call the pipeline stops ends there. Calls are cut off at the deadline less the 1.5 s kept for delivery, as the service cuts them, and a reply longer than its call's token limit arrives cut off. When nothing is pending, the report is the pipeline's own record of every generation.

`packages/generation/src/cli/bench.ts` writes each round as a workflow script, reads the replies back from the workflow's transcripts with their wall times and token counts, and writes the report:

```sh
node packages/generation/scripts/build.mjs
node packages/generation/dist/bench.mjs calibrate --dir bench/run    # 10 one-word calls: the subagent's own overhead
node packages/generation/dist/bench.mjs round --dir bench/run        # round-N.workflow.js, or "Complete"
node packages/generation/dist/bench.mjs ingest --dir bench/run --run <workflow transcript dir> [--calibration]
node packages/generation/dist/bench.mjs report --dir bench/run       # results.json and report.md
```

Two conditions cover the two kinds of request. **library**: every reviewed scene is available, so a request for a reviewed concept starts from its scene. **novel**: the concept's own scene is withheld, so the figure is written whole from the nearest other one, as for a concept the library does not have yet. The 24 requests are the launch set (PRD 17.8): two phrasings for each of the twelve reviewed concepts.

Subagents sometimes think before they answer; the service calls models with thinking off. By default (`--latency text`) each call counts from its start to the end of its reply, less the time until its thinking block closed, and the report adds the times as measured, thinking included. Each subagent call also carries a fixed overhead an API call does not (about 1.0 s on Haiku and 1.3 s on Sonnet, measured with one-word replies); the report subtracts it for an estimate of the API path.

## Results

All three runs on 22 October 2026, 48 generations each.

| Run | What changed before it | Library: approved, p50 / max (s) | Novel: approved, p50 / max (s) | Within 25 s |
| --- | --- | --- | --- | --- |
| 2 | Edits instead of rewrites when a plan names a reviewed concept; repairs as edits; thinking off | 21 of 24 (88%), 11.9 / 21.2 | 16 of 24 (67%), 15.2 / 22.7 | 100% |
| 3 | The library path: a request that names a reviewed concept is built from it at once, beside the plan call; handles, polylines and resistors scenes reach for; bounds failures that name the element and line | 24 of 24 (100%), 3.2 / 10.9 | 19 of 24 (79%), 15.1 / 21.0 | 100% |
| 4 | Repeated edits count as applied; a plan confirms a library build in its own words; repairs start with 2 to 4 s in hand; stage units explained; graph.part; a later drag replaces an earlier; suggestions for misnamed helpers | 24 of 24 (100%), 3.1 / 6.1 | 23 of 24 (96%), 15.6 / 19.2 | 100% |

Estimated for the API path, without the subagent overhead (run 4): library p50 1.8 s, max 3.5 s; novel p50 12.6 s, max 15.7 s. (The run 3 and run 4 reports subtract the overhead of a library build and of the plan call beside it both, though the learner waits for one; the figures here count it once, as the CLI now does.)

In run 4 the library path's output is a few edits (p50 92 output tokens, max 337), and a scene written whole is about 1,270 output tokens (max 1,756). Repairs took 0.7 to 2.8 s. The one failure, a gas scene whose formula named its parameters directly, led to formulas reading parameters by name (after run 4, not yet measured).

The reports: [run 2](bench/2026-10-22-run2.md), [run 3](bench/2026-10-22-run3.md), [run 4](bench/2026-10-22-run4.md). Each lists every generation with its path, the example it followed, its stage times, the checks it failed and why.

## Reading the numbers

- The bench's model calls are subagents, not API calls: their latencies include a harness and differ from a production endpoint. The pipeline's own work (validation and the probe) is measured on this machine and is under 0.5 s per generation.
- Two phrasings per concept is a small sample for pass rates; the evals (`npm run evals`) run 100 trials per concept against the API for the v0.1 gate.
- The novel condition is pessimistic for launch: every launch concept has a reviewed scene, so in production these requests take the library path.
