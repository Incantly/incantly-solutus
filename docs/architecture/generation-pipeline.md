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
  -> one repair attempt
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

v0.1 permits one automatic repair. The repair request contains only:

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

## Implementation (v0.1)

The pipeline lives in `packages/generation`. Where each step runs:

| Step | Where | Module |
| --- | --- | --- |
| Plan, re-plan once with the problems | Service | `plan.ts`, `context.ts`, `pipeline.ts` |
| Scene, each fragment checked as it streams in | Service | `fragments.ts`, `pipeline.ts` |
| Static validation | Service, and again on the device before anything mounts | `@incantly/core` validator |
| Probe | The learner's device, in a fresh hidden sandbox | `@incantly/generation/client` with core's `probeSandboxed` |
| One repair | Service, from the device's probe report or a static failure | `report.ts`, `pipeline.ts` |
| Fallback ladder | The device | `client/flow.ts` |
| Skeleton and insertion into the note | The device | `@incantly/tiptap` `FigureGeneration` |
| Evals | Node, with the same probe in an isolated context | `evals.ts`, `probe.ts` |

### Context and models

The core rules and the capability catalog open every call as one block marked for prompt caching, so the plan, scene and repair calls share a cache entry. The scene call adds only the declarations of the SDK's own type contract that the plan's capabilities need (extracted from `packages/core/src/api/types.ts` by `scripts/generate.mjs`) and the nearest reviewed example. The plan goes to `claude-haiku-5-5` at low effort; scenes and repairs to `claude-sonnet-5-5` at medium effort; thinking is off for all three. All of it is configurable. Model calls stream, carry a deadline, and retry once when the provider is busy and nothing has streamed yet.

### Repair

A failed candidate gets one automatic repair. Its report quotes the failing check, the parameter state with the bounds marked, the real error, the agent's own line with its neighbours, a likely cause from the failure taxonomy and the core rules broken (`report.ts`). The repair call sends only that report, the fragments as they stand, the capability lines and, when the failure is an unknown name, the contract. A repair that returns the same fragments ends the attempt. `maxRepairs` above one allows a further repair only when the previous one changed something (RP-4); v0.1 keeps one.

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

Every generation has a deadline of 25 seconds from the request to a checked scene (`DEFAULT_DEADLINE_MS`), of which 1.5 s is kept for the checks and delivery (`DELIVERY_MS`). A model call is cut off when only that is left; a repair starts only when its estimate, 2 to 4 s, fits in what remains; and when no candidate passes in time, the device takes the next rung of the fallback ladder. So no learner waits longer than the deadline.

A request takes one of four paths:

| Path | When | Calls | Bench, run 4 (p50 / max) |
| --- | --- | --- | --- |
| Library build | The request plainly names a reviewed concept | The scene call adapts that scene by edits at once; the plan call runs beside it only to confirm the concept | 3.1 / 6.1 s, all approved |
| Plan, then edits | The plan names a reviewed concept the request did not | Plan, then edits to that scene | 13.1 s (one generation) |
| Plan, then written whole | No reviewed scene for the concept | Plan, then the scene written whole after the nearest reviewed example | 16.1 / 19.2 s, 22 of 23 approved |
| Concept cache | The same request, or a plan for a figure approved before | No scene call | the plan call, or nothing |

What makes it fast, and what each saves:

- **Retrieval** (`retrieve.ts`). Each reviewed scene lists names and keywords in its `match.json`; a name counts three points and a keyword one, and a request needs three points, or two when no other concept scores at all, and more than any other concept. The scene call starts before any plan, and its system blocks are the same for every request about that concept, so they stay cached. The skeleton the learner sees is the reviewed plan, at once.
- **Confirmation, not waiting.** The plan call beside a library build confirms the concept when its concept and idea score for that scene. If it names another concept, the build is stopped and the pipeline goes on from that plan, having lost no time.
- **Edits, not rewrites** (`edits.ts`). Adapting and repairing reply with SEARCH/REPLACE edits: a library reply is often one empty edit block, six tokens, and a repair 35 to 220. Edits match exactly, or line by line ignoring indentation; an edit whose replacement already stands counts as applied, so a reply that repeats itself still works.
- **Small, cached prompts.** One cached block of rules and catalog; only the contract the plan needs; one example. Thinking off on every call; a small model for plans.
- **Budgets by size.** Quick, standard and rich figures have their own line, output-token, control and part budgets, and the scene call's token limit follows them.
- **Checks that cost no tokens.** The validator and the probe find the problem and the report quotes the failing check, the parameter state and the agent's own line, so one short repair usually fixes it.
- **On the device.** The probe frame boots while the plan and scene are still being written, with the plan's drawing kits preloaded; a warm frame saves 80 to 180 ms, and the probe takes 200 to 500 ms.

The [generation bench](../implementation/generation-bench.md) measures all of this with real model replies, every generation, every stage.

