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

The core rules (under 1,500 tokens) and the capability catalog open every call as one block marked for prompt caching, so the plan, scene and repair calls share a cache entry. The scene call adds only the declarations of the SDK's own type contract that the plan's capabilities need (extracted from `packages/core/src/api/types.ts` by `scripts/generate.mjs`) and the nearest reviewed example. The plan goes to `claude-haiku-5-5` at low effort; scenes and repairs to `claude-sonnet-5-5` at medium effort. Both are configurable. Model calls stream, carry a deadline, and retry once when the provider is busy and nothing has streamed yet.

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

`npm run evals -- --model anthropic --trials 100` runs the versioned prompts (`evals/prompts.json`) through the whole pipeline: 100 trials per concept, once with the reviewed examples and once with each concept's own example withheld, so 600 trials. It needs `ANTHROPIC_API_KEY`. The summary reports first-attempt and post-repair pass rates with 95% Wilson intervals, by concept and by condition, how well plans match the eval set, latency, tokens, prompt-cache hits and cost. Every approved scene is validated and probed again from scratch, and a scene that fails that is counted as a broken figure shown; the gate requires none. `--gate` exits non-zero unless the v0.1 targets are met.

`--model reference` runs the same suite against a stand-in that serves the reviewed scenes, and `--faults 0.3` injects faults into that share of trials: plan rejections, validator and probe failures, cut-off replies, and repairs that change nothing. It measures the pipeline, never a model, and is the fault-injection half of the gate.
