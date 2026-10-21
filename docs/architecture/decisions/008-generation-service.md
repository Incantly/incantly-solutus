# ADR 008: the generation service and the device probe

- Status: accepted for v0.1
- Date: October 2026

## Context

Generation needs a model key, rate and cost limits and a place to keep failure records, so it runs on a server. The probe must run the scene exactly as a learner's figure runs, in the browser sandbox, and a scene must never be shown before it passes (RP-1). Running a headless browser per generation on the server would duplicate the sandbox and add seconds. The prompt, plan and repair history must not reach the client (PRD 18.6).

## Decision

- **The service plans, builds, validates and repairs; the device probes.** A validated scene goes to the learner's device with a probe spec of names and numbers. The device probes it in a fresh hidden sandbox, and reports the result. A failed probe is repaired once on the service from its own copy of the fragments, and the repaired scene is probed on the device again.
- **A generation is a short-lived session.** The service keeps the plan and fragments in memory, keyed by an opaque generation id, for 15 minutes, so the device's report can be repaired without sending fragments back. Sessions are per learner: another learner's report for the same id is refused.
- **Device reports are untrusted input to a prompt.** Only known checks and phases, the plan's parameters and short text survive.
- **Learners are identified by short-lived tokens** minted by the host's backend with a shared secret. The service never sees accounts or note content beyond the request it is given.
- **Nothing the learner wrote is stored.** The request and note context are sent to the model provider and kept nowhere else.
- **Evals probe in Node.** The eval harness runs the same core probe on scenes compiled in an isolated `vm` context with no Node globals and no code generation from strings, after the same validation, instrumentation and wrapper. It is not a security boundary on its own and is used only for evals of model output, never for learners.
- **A stand-in model** answers from the reviewed scenes with injected faults, so the pipeline, the service, the device flow and the browser journey are tested without a model or a key.

## Consequences

- Each repair costs the device a second probe, about a second, and the learner keeps seeing the skeleton meanwhile.
- A service restart forgets sessions; their devices get 404 and fall back, and the learner can retry.
- Pass rates measured by the evals use the Node probe. The browser probe is the same code, but a difference in floating point or timing would show up first as a gap between eval pass rates and device pass rates in the failure records.
