# Generation bench

The bench measures what a learner waits for: the real pipeline (plan, scene by edits or written whole, validation, probe, one repair, the 25-second deadline) with real model replies. When no API key is at hand, the replies come from subagents of a coding agent, plans from Claude Haiku 5.5 and scenes and repairs from Claude Sonnet 5.5, one subagent per call, so the measurement needs no account and no network access of its own.

## How it works

`packages/generation/src/bench.ts` replays every generation in rounds. Each round runs the pipeline with the replies recorded so far and stops a generation at its first call without a reply; those calls become the next round's prompts. When nothing is pending, the report is the pipeline's own record of every generation.

The replay keeps the learner's clock. Each recorded call takes the time it took; calls the pipeline starts together (a library build and its plan call) wait on the clock, which moves on to the earliest of their times once the pipeline has nothing else to do, so they end in the order of their times and the pipeline can act on one before the other ends. A reply streams in pieces from its model's first token to its end, so the pipeline reads a scene as it comes and confirms a library build from a plan's first words; a call the pipeline stops ends when it is stopped. Calls are cut off at the deadline less the 1.5 s kept for delivery, as the service cuts them, and a reply longer than its call's token limit arrives cut off. Validation and the probe run on this machine and count as they take.

`packages/generation/src/cli/bench.ts` writes each round as a workflow script, reads the replies back from the workflow's transcripts with their wall times and token counts, and writes the report:

```sh
node packages/generation/scripts/build.mjs
node packages/generation/dist/bench.mjs calibrate --dir bench/run --set all    # 10 one-word calls: each model's time to a first token through a subagent
node packages/generation/dist/bench.mjs round --dir bench/run --set all        # round-N.workflow.js, or "Complete"
node packages/generation/dist/bench.mjs ingest --dir bench/run --set all --run <workflow transcript dir> [--calibration]
node packages/generation/dist/bench.mjs report --dir bench/run --set all       # results.json and report.md
```

Two conditions cover the two kinds of request. **library**: every reviewed scene is available, so a request for a reviewed concept starts from its scene. **novel**: the concept's own scene is withheld, so the figure is written whole after the nearest other one, as for a concept the library does not have yet. `--set launch` is the launch set of PRD 17.8, two phrasings for each of the twelve launch concepts (24 requests); `--set all` adds the five concepts reviewed since, cells, diffusion, combustion, the seasons and the Magnus effect, which bring in the biology and chemistry kits, a ready-made 3D model and a fluid (34 requests, 68 generations). `--plan`, `--scene` and `--repair` name the models.

Subagents sometimes think before they answer; the service calls models with thinking off. By default (`--latency text`) a reply that began by thinking counts its model's time to a first token, measured by the calibration's one-word replies, then the time from the end of its thinking to the end of the reply; the others count as measured, and the report gives the times as measured too. Each subagent call also carries a fixed cost an API call does not; the report subtracts the calibration's median for a lower bound of the API path, as a one-word reply's time also holds the API's own time to a first token. The measured totals are the upper bound.

## Results

All runs on 22 October 2026.

| Run | Set | What changed before it | Library: approved, p50 / max (s) | Novel: approved, p50 / max (s) | Within 25 s |
| --- | --- | --- | --- | --- | --- |
| 2 | launch | Edits instead of rewrites when a plan names a reviewed concept; repairs as edits; thinking off | 21 of 24 (88%), 11.9 / 21.2 | 16 of 24 (67%), 15.2 / 22.7 | 100% |
| 3 | launch | The library path: a request that names a reviewed concept is built from it at once, beside the plan call; handles, polylines and resistors scenes reach for; bounds failures that name the element and line | 24 of 24 (100%), 3.2 / 10.9 | 19 of 24 (79%), 15.1 / 21.0 | 100% |
| 4 | launch | Repeated edits count as applied; a plan confirms a library build in its own words; repairs start with 2 to 4 s in hand; stage units explained; graph.part; a later drag replaces an earlier; suggestions for misnamed helpers | 24 of 24 (100%), 3.1 / 6.1 | 23 of 24 (96%), 15.6 / 19.2 | 100% |
| 5 | all | The five concepts reviewed since launch join the bench; a thought-out reply counts from a first token | 32 of 34 (94%), 4.8 / 23.5 | 24 of 34 (71%), 17.8 / 23.5 | 100% |
| 6 | all | What run 5 found, below; a library build confirmed by the plan's first words | 34 of 34 (100%), 2.3 / 5.5 | 30 of 34 (88%), 15.4 / 23.3 | 100% |
| 7 | all | What run 6 found, below; a scene written whole follows an example drawn on its own kind of stage | 34 of 34 (100%), 3.1 / 12.7 | 27 of 34 (79%), 17.3 / 23.5 | 100% |

Lower bounds for the API path, without the subagent's own cost: run 6 library p50 1.1 s (max 4.4 s), novel p50 12.7 s (max 19.8 s). The subagents' own cost differs from run to run (run 5: 1.4 s on Haiku and 2.6 s on Sonnet; run 6: 1.1 s and 1.2 s; run 7: 1.2 s and 2.6 s, with one-word Sonnet replies taking up to 10.9 s), so runs compare best on the approvals and on the stage times in their reports. Run 7's slower Sonnet shows in its library builds (p50 3.0 s against 2.2 s) and in its two novel scenes cut off at the deadline after streaming for 21 and 26 seconds; every library generation still passed on its first attempt.

The reports: [run 2](bench/2026-10-22-run2.md), [run 3](bench/2026-10-22-run3.md), [run 4](bench/2026-10-22-run4.md), [run 5](bench/2026-10-22-run5.md), [run 6](bench/2026-10-22-run6.md), [run 7](bench/2026-10-22-run7.md). Each lists every generation with its path, the example it followed, its stage times, the checks it failed and why.

### What run 5 found, and what closed it

Run 5 was the first over all seventeen reviewed concepts. Every generation ended within 25 s, but twelve of 68 failed, and each failure was traced to a cause in the pipeline or the kit rather than retried:

| Failure | Cause | Closed by |
| --- | --- | --- |
| Two seasons scenes adapted the Magnus scene | "the seasons" shared "the" with "the Magnus effect" | Concepts match on the words that name them, never on stop words |
| A diffusion request missed the library path, and its plan picked SVG over the biology kit | The match word was the whole word "diffusion"; the plan call did not say which stage each reviewed concept is drawn on | `diffus*`; the plan format names each reviewed concept with its stage, and every stage capability |
| An active-transport plan was rejected twice | Its gradient depended on the inside concentration, an output | An output may depend on another output, and so on that one's inputs |
| A library build failed on one edit and ran out of time repairing | The edit's SEARCH had two more spaces of indentation and began mid-line; the report then blamed a cut-off reply, so the repair rewrote the scene (7,000 characters) | Edits also match with whitespace taken loosely; after failed edits among applied ones, the repair asks for the failed edits only |
| A magnet scene threw at mount, then on frame 1 | It named the model's north piece "north pole" again; then it labelled an arrow made without a label | Naming a part again renames it; a 3D arrow gets a label when it is first labelled |
| Diffusion and seasons scenes failed validation | Loops to a particle count the controls change; `Array.from` | The messages name the fix: `Math.min(n, 5000)`, a bounded `for` loop |
| A diffusion scene registered its dots as a part; a spring scene gave a width as a function, another set `{ text }` | Canvas dots have no element; attributes are values | Messages that say why and what to use instead |
| Two novel scenes were cut off at the deadline | Slow streams: 4,700 characters in 25 s, and 6,700 in 23 s | Not closed in the pipeline: see the next section |

Run 6 then found these, closed before run 7: a graph tangent or secant running off the figure (graph segments are cut to the plot area, as curves are), `const X = graph.toX` losing its graph (SDK and kit methods are bound to their objects), `pi: Math.PI` in a formula's variables (a constant bound to its own value is the built-in), particle counts worked out from the model (rounded), `sym(...)` without `inc.` (pointed at `inc.sym`), a plant cell's ER asked for a second time (the kit draws a plant cell's ER and Golgi), and scenes written whole after an example drawn with another kit (the nearest example shares the plan's stage first).

Run 7's failures after their one repair, closed since: `world.part(...)`, as rule 8 reads, on a kit object that had no `part` (every kit object now names parts), and `set(...)` on a 3D label pointed at `at` rather than `text`. The commonest failure of scenes written whole in runs 5 to 7 is the paused-change check, a drawing that does not change when a control moves before time has run; a repair usually fixes it, and rule 5 now says so in the prompt. The rest named their own fix and ran out of repairs: a `function` declaration, `toLocaleString`, a step focused on a part never registered.

### Writing scenes with the small model

The novel path's time is mostly the scene written whole: about 1,100 tokens at Sonnet's pace of roughly 120 tokens a second. With every novel scene written by Haiku 5.5 instead, and repairs still on Sonnet ([report](bench/2026-10-22-run5-haiku-scenes.md), the run 5 plans), the scene took 6.1 s at the median instead of 14.0 s and the novel generation 11.1 s instead of 17.8 s, with 26 of 34 approved against 24. Two things keep it out of the default. Haiku's subagents thought for 13 to 93 seconds before every scene, which the service would turn off, so its approval rate without thinking is not measured; and the scenes it wrote were leaner: in the same pendulum, Sonnet drew the law as an equation and gave readouts and an explanation that Haiku left out. The models are a setting of the service (`models.scene`), so a deployment that values speed over that richness can choose it.

## Reading the numbers

- The bench's model calls are subagents, not API calls: their latencies include a harness and vary with the load on it, as the calibration shows. The pipeline's own work (validation and the probe) is measured on this machine and is under 0.5 s per generation.
- Two phrasings per concept is a small sample for pass rates; the evals (`npm run evals`) run 100 trials per concept against the API for the v0.1 gate.
- The novel condition is pessimistic for launch: every launch concept has a reviewed scene, so in production these requests take the library path. A failure there falls back to the reviewed or nearest figure within the deadline; it never makes the learner wait longer.
