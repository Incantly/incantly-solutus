# Generation pipeline

## Pipeline

```text
concept
  -> plan
  -> validate plan
  -> generate fragments
  -> static validation
  -> isolated probe
  -> reveal

failure after generation
  -> focused error report
  -> up to three repairs, while each makes progress
  -> validate and probe again
  -> reveal or fallback
```

## Plan

The plan is backend metadata, not an executable scene format. For v0.1 it contains:

- Concept and one-sentence teaching idea.
- Supported scene kind.
- Up to three parameters with units, bounds, defaults, and a short justification.
- Model inputs and outputs.
- Named visual parts.
- What moves or changes.
- Teaching-step outline.

Reject plans with unknown capabilities, excessive parts or controls, invalid bounds, unreachable outputs, or an unclear teaching idea.

## Generation context

The generator receives:

- Short core rules.
- The exact SDK contract needed by the plan.
- The nearest reviewed example when applicable.
- Source and complexity budgets.

It returns scene HTML, CSS, and JavaScript fragments. The authored formula and primitive operations must remain visible in the source; generated scenes must not hide behavior behind invented functions or scene-specific host code.

## Static validation

Validation parses every fragment and reports locations in fragment coordinates. It checks syntax, the JavaScript subset, SDK names, HTML and CSS allow-lists, source budgets, theme tokens, parameter count, and required teaching metadata.

## Probe run

An isolated probe instance mounts the scene through the configured execution adapter and checks:

- Successful mount and 60 frames without an exception.
- Finite model outputs and rendered attributes.
- Every parameter at minimum, default, and maximum while playing and paused.
- A visible drawing within stage bounds.
- Dirty redraw when a paused parameter changes.
- Element, sampled-point, execution-time, and frame-time budgets.
- Presence of the declared parts, teaching steps, and text description.

The probe has a host-enforced deadline. An execution instance that stops responding is destroyed and treated as failed.

## Offline checks

Some checks are too slow for a learner's device, and none should stand in a learner's way, so they run offline (PRD 17.7, CH-2): in CI over every reviewed scene and every ready-made 3D model, and in the evals over every approved figure, where they report without failing anything. `offlineChecks(scene)` in `@incantly/core` runs them on a scene at its defaults.

- **Depth order.** Every 3D stage is turned to 60 camera turns, every 30 degrees all the way round, from below, level and above, and drawn at each. Every pair of pieces that overlaps on the stage is sampled all over the overlap, and at each sample the depth of both is read from its own geometry. A nearer piece drawn underneath is a violation. Pieces that pass through each other, so that each is nearer somewhere, and pieces that lie in a ring, each over the next, have no right order; they are reported with the area drawn wrong, for review, and do not fail.
- **Line ends.** In a diagram every plain line must end on something: a shape, another line, a dot, a label or the edge of the stage. A wire that stops short of the resistor, or a leader short of its label, is reported with the point and the scene line that drew it. Dashed guides, arrows, curves drawn in many short pieces, symbols of many strokes such as a battery's plates, and lines that something rests on, hangs from or slides along (a floor, a ceiling, a track) are left alone, and so are graphs and 3D stages, which draw their own lines.
- **Pictures.** The browser checks mount every reviewed scene in its sandbox, in light and dark, keep every element and line end inside its drawing, and compare each figure with its golden image in `apps/playground/e2e/golden` at three widths, 360, 640 and 960 pixels. Figures are drawn paused, with reduced motion and in a pinned font, and shrunk to 240 pixels across. Where the golden images were made the comparison is strict, so a pendulum's bob drawn 3 units smaller fails it; on a machine that smooths text differently, which a fingerprint of the browser and of how it draws text tells, it is loose and catches a figure that changes its height or a good part of its picture. After a change meant to alter figures, look at the pictures the failing run saved, then write new golden images with `UPDATE_GOLDENS=1 npx playwright test golden --project=chromium`.

## Repair

A failed scene gets up to three automatic repairs, and stops early when a repair makes no progress. The repair request contains only:

- Failure kind and exact parameter state.
- Mapped fragment line and nearby source.
- The violated rule.
- Current fragments.
- Relevant SDK contract lines.

The repair returns only changed fragments. It must pass static validation and the complete probe again.

## Fallback

Use the first available option:

1. Last approved version of the figure.
2. Reviewed standard figure for the supported concept.
3. Approved snapshot plus text description and Retry action.
4. Plain concept text with a message that the figure could not be built.

## Learning from failure

Record the concept, plan, fragments before and after, validation or runtime report, SDK version, and outcome. Recurring failures should become a generic SDK capability, a clearer rule, or an executable regression test—not additional retries.

The dashboard (`npm run metrics --workspace @incantly/generation -- records/`) lists every failure seen at least twice, with what has closed its class so far (RP-12). `closed.ts` names, for a check and, where the check is broad, for the words its reports carry, the kit function or engine behaviour that removes the cause, or the core rule that only names it, and the test that keeps it closed; a test checks that every one of those tests exists. Each failure is matched on its own, so a broad check such as `mount` shows as partly closed when a closure covers only some of its failures. A recurring failure that no kit function or engine behaviour covers, rule or not, is listed as open, the next to close. Closed so far: a paused redraw that changed nothing (the engine redraws at dt = 0 when a parameter changes), too many elements (`stage.dots`, and a warning near the budget), a second drag on one element, liquids without a tone (`water`), asking a text for its handle, naming a part again (it renames the part, as a scene names a ready-made model's piece in its plan's words), labelling a 3D arrow made without a label (it gets one), and a plant cell's ER or Golgi (the kit draws both, as in an animal cell). Named by rules, and still open to a kit function: unknown helpers (the validator names the one meant) and planned parts not registered (`graph.part`, and plans name only drawn things).

## Implementation (v0.1)

The pipeline lives in `packages/generation`. Where each step runs:

| Step | Where | Module |
| --- | --- | --- |
| Plan, re-plan once with the problems | Service | `plan.ts`, `context.ts`, `pipeline.ts` |
| Scene, each fragment checked as it streams in | Service | `fragments.ts`, `pipeline.ts` |
| Static validation | Service, and again on the device before anything mounts | `@incantly/core` validator |
| Probe | The learner's device, in a fresh hidden sandbox | `@incantly/generation/client` with core's `probeSandboxed` |
| Up to three repairs | Service, from the device's probe report or a static failure | `report.ts`, `pipeline.ts` |
| Fallback ladder | The device | `client/flow.ts` |
| Skeleton and insertion into the note | The device | `@incantly/tiptap` `FigureGeneration` |
| Evals | Node, with the same probe in an isolated context | `evals.ts`, `probe.ts` |

### Context and models

The core rules and the capability catalog open every call as one block marked for prompt caching, so the plan, scene and repair calls share a cache entry. The scene call adds only the declarations of the SDK's own type contract that the plan's capabilities need (extracted from `packages/core/src/api/types.ts` by `scripts/generate.mjs`) and the nearest reviewed example. The plan goes to `claude-haiku-5-5` at low effort; scenes and repairs to `claude-sonnet-5-5` at medium effort; thinking is off for all three. All of it is configurable. Model calls stream, carry a deadline, and retry once when the provider is busy and nothing has streamed yet.

Google's Gemini models are a second provider (`GeminiClient` in `packages/generation/src/gemini.ts`): the same fixed blocks go first as the system instruction, so Gemini's implicit cache can reuse them, with thinking at its lowest level and room for it under the output cap, since Gemini counts thinking against it. Thought parts are never passed on, and a reply cut off at the limit is reported as `max_tokens`, as Anthropic reports it. The playground's settings choose the provider; a Gemini key is checked by listing the models it can reach. Gemini prices are not in the cost table yet, so its calls are counted at the most expensive known price.

An overloaded Gemini model sometimes sends no response headers for tens of seconds, so `GeminiClient` gives the first response its own limit (`firstResponseMs`, 20 seconds): when neither the headers nor the first body bytes arrive in time, that attempt fails as `overloaded` — retryable, unlike the per-gap `timeout`, which still governs an already-streaming reply alone. `fallbacks` then names, per purpose, the models to try after the primary's retries fail with a retryable error that streamed no text; a 404 for a listed model that the provider has since retired skips to the next fallback without spending retries. The reply's `model` names the model that actually answered, and a cancelled call never retries or falls back. The playground derives the chain from the key's model list with `geminiFallbackModels` — the next-newest text flash models for scenes and repairs, the next flash-lite for plans — listing the key's models once when no key check ran before, without holding up session creation.

Amazon Bedrock is a third provider (`BedrockClient` in `packages/generation/src/bedrock.ts`), for open-weight models only: GLM, DeepSeek, Qwen, Kimi and MiniMax. Models from Anthropic, OpenAI and xAI are refused. It streams from Bedrock's OpenAI-compatible Chat Completions endpoint in the chosen Region with a Bedrock API key as a bearer token, so it needs no request signing. The fixed blocks go as one system message, reasoning effort is low, reasoning text is never passed on, and a reply cut off at the limit is reported as `max_tokens`. DeepSeek V3 replies are capped at 8,192 tokens, which is less than a rich scene may ask for; a cut-off scene continues as it does on any provider. A model that refuses the reasoning effort or the reply's length is asked again without the effort, or with half the length. The defaults are GLM 4.7 Flash to plan and GLM 4.7 to build and repair; a Bedrock key check lists the models of these families the key can reach in its Region. Bedrock prices are not in the cost table either.

Meta Model API is a fourth provider (`SparkClient` in `packages/generation/src/spark.ts`): Muse Spark 1.1 through 1.3, in Standard and Contributor modes, and Muse Wonder 1.0, over Meta's OpenAI-compatible Chat Completions endpoint with a Model API key for auth. Contributor mode is the same model at a heavy discount in exchange for training use, and is the default; anything outside the documented text models is refused. The fixed blocks go as one system message, the reply cap is `max_completion_tokens`, reasoning runs at low effort since Spark always reasons, and a reply cut off at the limit is reported as `max_tokens`. Streamed usage is asked for and quietly dropped if refused. Meta's list prices are in the cost table, so its calls are counted exactly.

### Repair

A failed candidate gets up to three automatic repairs in total (`maxRepairs`), of any kind. Its report quotes the failing check, the parameter state with the bounds marked, the real error, the agent's own line with its neighbours, a likely cause from the failure taxonomy and the core rules broken (`report.ts`). The repair call sends only that report, the fragments as they stand, the capability lines and, when the failure is an unknown name or the probe caught it live, the contract. Guard errors are hinted by message rather than by check, since the same guard can surface under any check that runs the line. A further repair runs only while the one before made progress (`progressed`): a repair that returns the same fragments ends it, and so does one that fails the same check with the same failures again, or more of them, since repairs can otherwise go round in circles. Failing a different check, or the same check with fewer or different failures, counts as progress. A probe failure is told apart by its check and its message with the numbers taken out (`probeFaults`): a label pushed further off the stage is the same failure, while a loop that never ends and a read of undefined are different ones. On the service, a repair of a device's probe report that then fails validation is repaired again at once, within the same budget; the repaired scene goes back to the device, whose next failed probe asks for the next repair. Each repair also needs time left before the deadline.

### The service

`GenerationService` (`service.ts`) is an HTTP handler; `npm run serve` runs it from the environment (see `src/cli/serve.ts`).

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /v1/status` | | Whether generation is on, the SDK version and the retention rule |
| `POST /v1/generations` | `{ prompt, noteContext? }` | An event stream: `accepted`, `plan` (the skeleton: names and numbers only), `fragment` progress, then `scene` (validated fragments and the probe spec) or `fallback` |
| `POST /v1/generations/:id/probe` | `{ ok: true }` or `{ ok: false, report }` | `approved`, a repaired `scene`, or a `fallback` |

- **Learners.** Requests carry a short-lived bearer token that the host's backend mints with a secret it shares with the service (`mintToken`, `hmacAuthenticator`). The token holds an opaque learner id and an expiry, nothing else.
- **Limits.** Per learner: generations a minute, a day and at once, and model spend a day; and spend for the whole service a day. A refusal is a 429 with `Retry-After`.
- **Deadlines.** Every generation request and every repair has a deadline, and a learner who leaves cancels the model calls.
- **The switch.** When generation is off (`INCANTLY_GENERATION=off`, or while the file named by `INCANTLY_KILL_SWITCH_FILE` exists) new generations get a 503 and the device shows its fallback. Stored figures never call the service, so they are unaffected.
- **Device reports are untrusted.** They go into a prompt, so only known checks and phases, the plan's parameters and short text survive (`sanitizeDeviceReport`), and a repair always starts from the service's own copy of the fragments.
- **Retention.** The request and any note text are sent to the model provider for the plan call and are not stored, logged or recorded. A generation waiting for its device probe is kept in memory for 15 minutes. Failure records keep the plan, the fragments, the reports and the outcome, never the request, and are deleted after 30 days. Both periods are configurable and stated by `/v1/status`.

### Fallbacks on the device

When no candidate passes, the device takes the first available rung: the figure's last approved version (when regenerating), the reviewed figure for the same concept (sent by the service and probed on the device like any other scene, then shown with a notice that it is a standard version), the snapshot with its description, or one line saying the figure could not be built, with the request and Retry, which starts a fresh generation. Nothing is inserted into the note until a figure has passed.

### Records and signals

Every generation leaves a failure record (`records.ts`), written as daily JSON lines. The device reports product signals (`client/telemetry.ts`): time to skeleton, first paint and interactivity, generation and repair latency and outcome, parameter changes, step completion, figures left unused within a minute, failure kinds with parameter values, and restore failures. Each signal is checked field by field against its schema: ids, names, numbers and fixed words only, so no note content can leave the device.

### Evals

`npm run evals -- --model anthropic --trials 100` runs the versioned prompts (`evals/prompts.json`) through the whole pipeline: 100 trials per concept, once with the reviewed examples and once with each concept's own example withheld, so 600 trials. It needs `ANTHROPIC_API_KEY`. The summary reports first-attempt and post-repair pass rates with 95% Wilson intervals, by concept and by condition, how well plans match the eval set, latency, tokens, prompt-cache hits and cost. Every approved scene is validated and probed again from scratch, and a scene that fails that is counted as a broken figure shown; the gate requires none. The offline checks run on every approved figure, the line-end check only on diagrams, and the summary counts the figures that drew a 3D overlap out of order or left a line end in mid-air; they are reported, not gated. `--gate` exits non-zero unless the v0.1 targets are met.

`--model reference` runs the same suite against a stand-in that serves the reviewed scenes, and `--faults 0.3` injects faults into that share of trials: plan rejections, validator and probe failures, cut-off replies, and repairs that change nothing. It measures the pipeline, never a model, and is the fault-injection half of the gate.

## Speed

Every generation has a hard deadline of three minutes from the request to a checked scene (`DEFAULT_DEADLINE_MS`), of which 1.5 s is kept for the checks and delivery (`DELIVERY_MS`). The product target remains a figure within 10 seconds; the longer hard ceiling prevents a healthy real-model stream from being cancelled merely because it missed that target. A model call is cut off when only the delivery reserve remains; a repair starts only when its estimate, 2 to 4 s, fits in what remains; and when no candidate passes in time, the device takes the next rung of the fallback ladder.

A request takes one of four paths:

| Path | When | Calls | Bench, run 6 (p50 / max) |
| --- | --- | --- | --- |
| Library build | The request plainly names a reviewed concept | The scene call adapts that scene by edits at once; the plan call runs beside it only to confirm the concept, from its first words | 2.3 / 5.5 s, 34 of 34 approved |
| Plan, then edits | The plan names a reviewed concept the request did not | Plan, then edits to that scene | 13.1 s (run 4, one generation) |
| Plan, then written whole | No reviewed scene for the concept | Plan, then the scene written whole after the nearest reviewed example drawn on the same kind of stage | 15.4 / 23.3 s, 30 of 34 approved |
| Concept cache | The same request; the same plan as a figure approved before; or an approved figure the plan call chose for the request | No scene call | the plan call, or nothing |

Run 6 covers all seventeen reviewed concepts; run 7, on a slower day for the scene model, approved every library generation on its first attempt and 27 of 34 written whole, two of them cut off at the deadline (see the [bench](../implementation/generation-bench.md)).

### The concept cache, and why it never answers a similar request

An approved figure serves the next learner who asks for the same thing (`cache.ts`, PRD 25.6). A figure that answers a similar request instead, such as a plain sine wave for "a sine wave from Euler's formula, using circles", is a wrong figure, not a stale one, and the learner should never have to ask again to get the right one. So every way in is strict, and the loose one is checked twice:

- **The request.** The same meaningful words, whatever their order or case and however the learner asks ("I want", "show me", "could you"). No model call at all.
- **The plan.** The same plan, whole: concept, idea, moves, parts, steps, parameters and outputs, with prose reduced to its meaningful words. The scene call sees only the plan, so the cached figure is exactly what a new scene call would have been asked for. A plan that teaches something else or moves differently is another figure, even with the same concept and controls.
- **A figure the plan call chooses.** Before the plan call, the cache offers up to three approved figures, as one line each of concept and idea, in the request. A figure is offered only when its words, from the requests it answered and its plan, take in every meaningful word of this request, so a request that names anything more ("Euler", "circles", "damping") is never offered a figure without it. The plan call, which reads the whole request, adds `"reuse": "f1"` to its plan only when that figure answers the request fully; otherwise it plans the figure the request needs. This costs no extra call, and the request grows by about 80 tokens only when something is offered.

Keys carry the SDK version, which is checked again on every read, so figures made by an older kit are never served. The cache keeps the 500 keys used most recently in the service's memory. Figures made with note text are never stored under their request.

**Planned: a shared cache store.** The cache lives in each service process: servers behind a load balancer do not share it, and a restart or deploy empties it. A later release makes the store an interface (`get`, `put`, and `candidates` for the plan call's offer) with the in-memory store as the default and a Redis store beside it, so every server shares one cache that survives deploys, with its size and expiry set by the integrator.

What makes it fast, and what each saves:

- **Retrieval** (`retrieve.ts`). Each reviewed scene lists names and keywords in its `match.json`; a name counts three points and a keyword one, and a request needs three points, or two when no other concept scores at all, and more than any other concept. The scene call starts before any plan, and its system blocks are the same for every request about that concept, so they stay cached. The skeleton the learner sees is the reviewed plan, at once.
- **Confirmation, not waiting.** The plan call beside a library build confirms the concept as soon as its concept and idea have streamed in (they come first in the plan format) and score for that scene; once the build is in, a plan still writing is stopped, so the learner never waits for its last words and its tokens are spared. If it names another concept, the build is stopped and the pipeline goes on from that plan, having lost no time.
- **Edits, not rewrites** (`edits.ts`). Adapting and repairing reply with SEARCH/REPLACE edits: a library reply is often one empty edit block, six tokens, and a repair 35 to 220. Edits match exactly, or line by line ignoring indentation, or with every run of whitespace taken as one space (a SEARCH copied from the middle of a line with other indentation); an edit whose replacement already stands counts as applied, so a reply that repeats itself still works. When some edits of a reply fail and the others apply, the repair is shown the fragment as those left it and asked for the failed edits only, not the scene again.
- **The right starting point.** The plan call lists each reviewed concept with the stage it is drawn on, so a plan for one of them keeps that stage and its scene can be adapted rather than written whole; concepts match on the words that name them, never on "the"; and a scene written whole follows an example drawn on its own kind of stage before one that is merely close in words.
- **Small, cached prompts.** One cached block of rules and catalog; only the contract the plan needs; one example. Thinking off on every call; a small model for plans.
- **A short plan.** Both models write about 150 to 200 tokens a second, so every token out is the learner's wait. The plan format asks for one compact JSON line with a few words of prose per field and the quick size unless the learner asks for two views: on the acceptance prompts plans fell from 570 to 870 tokens (4 to 13 s) to 330 to 500 (2 to 4 s). A constant declared as a model output (φ with no dependencies) is dropped rather than re-planned, as a re-plan costs a whole call.
- **A short scene.** The scene call is told the js line budget and to write no comments or blank lines; a scene written whole follows an example of the same kind of figure (graph, motion, diagram) and, between near ties, the shorter example. Quick scenes fell from 120 to 150 lines (3,600 tokens) to 35 to 55 (1,100 to 1,600).
- **The scene prefix written ahead** (`warm`). The plan streams concept, kind, capabilities and parameters before its model, parts and steps, and those alone fix the scene call's system blocks. Once they are in (`planHead`), a `max_tokens: 0` request writes that prefix to the prompt cache while the plan finishes; it writes no reply and is not a model round trip on the path. The scene call waits for it at most until a second after it began (`WARM_MS`), then reads ten to fifteen thousand cached tokens instead of writing them: its first text came after about 1.5 s instead of about 2 s, in a bench of twelve runs each way.
- **Few repairs.** A validation report quotes one error of each kind before more of one kind, so a repair never leaves a kind it was not shown; rule 10 names the bounded loop (`i <= Math.min(n, 120)`) and the template string the model otherwise misses, and `toExponential` is allowed beside `toFixed` and `toPrecision`.
- **Budgets by size.** Quick, standard and rich figures have their own line, output-token, control and part budgets, and the scene call's token limit follows them.
- **Checks that cost no tokens.** The validator and the probe find the problem and the report quotes the failing check, the parameter state and the agent's own line, so one short repair usually fixes it.
- **On the device.** The probe frame boots while the plan and scene are still being written, with the plan's drawing kits preloaded; a warm frame saves 80 to 180 ms, and the probe takes 200 to 500 ms.

The [generation bench](../implementation/generation-bench.md) measures all of this with real model replies, every generation, every stage.

