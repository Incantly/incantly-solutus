# Generation bench

34 generations: 34 requests (the launch set of PRD 17.8 and the concepts reviewed since) in 1 condition. Plans on haiku, scenes on haiku, repairs on sonnet, effort low, each call one subagent.
Times are what a learner waits for, on the pipeline's own clock: each model call's time plus this machine's validation and probe. Calls are cut off at the deadline as the service would cut them.
Subagents think before some replies; the service calls models with thinking off. A reply that began by thinking counts its model's time to a first token (the one-word replies of the calibration, below), then the time from the end of its thinking to the end of the reply; the others count as measured. The last section gives the times as measured, thinking included.

## Summary

| Condition | Generations | Approved | First attempt | Repaired | Failed | Total p50 / p90 / max / mean (s) | Within 25 s | 5 to 20 s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| novel | 34 | 26 (76%) | 20 (59%) | 6 | 8 | 11.1 / 16.3 / 19.2 / 11.9 | 100% | 100% |

## Stages (p50 / p90 / max / mean, seconds)

Each stage is its model calls' own time. A library build starts from the reviewed scene the request names and runs beside the plan call, so its time overlaps the plan's: the learner waits for the longer of the two.

| Condition | Plan | Scene, library build | Scene, adapted after the plan | Scene, written whole | Repair | Local checks |
| --- | --- | --- | --- | --- | --- | --- |
| novel | 3.4 / 4.2 / 7.1 / 3.6 | – | 7.7 / 8.6 / 8.6 / 8.1 | 6.1 / 7.9 / 10.6 / 6.0 | 5.0 / 7.9 / 9.6 / 5.6 | 0.1 / 0.2 / 0.9 / 0.1 |

## By path

| Condition | Path | Generations | Approved | Total p50 / p90 / max / mean (s) |
| --- | --- | --- | --- | --- |
| novel | plan, then edits | 2 | 1 | 12.6 / 15.6 / 15.6 / 14.1 |
| novel | plan, then written whole | 31 | 25 | 11.1 / 16.3 / 19.2 / 11.9 |
| novel | no scene | 1 | 0 | 6.2 / 6.2 / 6.2 / 6.2 |

## Output

| Condition | Mode | Scenes | Scene output tokens p50 / max | Script characters p50 / max |
| --- | --- | --- | --- | --- |
| novel | adapt | 2 | 10632 / 23601 | 4502 / 5440 |
| novel | write | 31 | 7173 / 21350 | 3290 / 7165 |

## Subagent overhead

Each call ran as a subagent, which adds its own fixed cost (its harness prompt and turn) to what an API call would take. Measured with one-word replies:

- claude-haiku-5-5: 1.4 s per call (median)
- claude-sonnet-5-5: 2.6 s per call (median)

Subtracting it from every call (2 models), once for a library build and the plan call beside it, gives a lower bound for the API path: a one-word reply's time also holds the API's own time to a first token, which an API call pays too. The measured totals above are the upper bound.

| Condition | API path, lower bound: total p50 / p90 / max / mean (s) | Within 25 s |
| --- | --- | --- |
| novel | 7.7 / 11.1 / 13.8 / 8.0 | 100% |

## Every generation

| Request | Condition | Path | Example | Plan s | Scene s | Repair s | Total s | Result | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| projectile-1 | novel | write | thin-lens | 3.5 | 5.6 | – | 9.2 | first attempt | – |
| projectile-2 | novel | write | magnets | 3.5 | 3.1 | 9.6 | 16.3 | failed | reply, validation |
| buoyancy-1 | novel | write | spring | 3.3 | 4.7 | – | 8.1 | first attempt | – |
| buoyancy-2 | novel | write | magnus | 3.9 | 7.2 | – | 11.1 | first attempt | – |
| magnets-1 | novel | write | thin-lens | 3.0 | 7.2 | 5.0 | 16.2 | repaired | probe:budget |
| magnets-2 | novel | write | cells | 3.8 | 6.6 | – | 10.5 | first attempt | – |
| sine-1 | novel | write | normal | 3.3 | 4.7 | – | 8.1 | first attempt | – |
| sine-2 | novel | write | normal | 3.4 | 4.2 | – | 7.8 | first attempt | – |
| pendulum-1 | novel | write | thin-lens | 2.5 | 5.6 | – | 8.2 | first attempt | – |
| pendulum-2 | novel | write | magnets | 7.1 | 7.1 | – | 14.4 | first attempt | – |
| spring-1 | novel | write | combustion | 3.3 | 4.5 | 3.9 | 11.7 | failed | probe:paused-change, probe:runs |
| spring-2 | novel | write | thin-lens | 3.3 | 6.1 | – | 9.4 | first attempt | – |
| ohm-1 | novel | write | gas | 3.1 | 5.5 | – | 8.6 | first attempt | – |
| ohm-2 | novel | write | magnus | 3.3 | 7.9 | 4.5 | 15.7 | failed | probe:mount, probe:mount |
| lens-1 | novel | write | normal | 4.2 | 10.6 | – | 14.8 | first attempt | – |
| lens-2 | novel | write | normal | 3.5 | 7.8 | 3.6 | 15.0 | repaired | probe:bounds |
| titration-1 | novel | write | normal | 3.5 | 7.4 | – | 11.1 | first attempt | – |
| titration-2 | novel | write | normal | 3.0 | 1.5 | 6.4 | 10.9 | failed | reply, validation |
| gas-1 | novel | write | thin-lens | 3.4 | 7.7 | – | 11.2 | first attempt | – |
| gas-2 | novel | write | magnets | 2.9 | 6.8 | – | 10.2 | first attempt | – |
| normal-1 | novel | write | magnets | 3.2 | 5.6 | – | 8.9 | first attempt | – |
| normal-2 | novel | write | titration | 3.6 | 5.1 | 7.9 | 16.5 | failed | reply, validation |
| derivative-1 | novel | write | titration | 2.8 | 4.5 | – | 7.3 | first attempt | – |
| derivative-2 | novel | write | titration | 2.6 | 4.4 | – | 7.0 | first attempt | – |
| cells-1 | novel | write | magnets | 3.8 | 9.3 | 6.0 | 19.2 | repaired | probe:bounds |
| cells-2 | novel | write | magnus | 2.8 | 5.2 | 4.4 | 12.5 | repaired | probe:mount |
| diffusion-1 | novel | write | magnus | 3.9 | 8.2 | 7.0 | 19.2 | repaired | validation |
| diffusion-2 | novel | – | – | 6.2 | 0.0 | – | 6.2 | failed | – |
| combustion-1 | novel | write | gas | 3.6 | 6.9 | – | 10.6 | first attempt | – |
| combustion-2 | novel | write | magnets | 5.9 | 1.5 | 7.6 | 14.9 | failed | reply, validation |
| seasons-1 | novel | adapt | magnus | 3.7 | 7.7 | 4.0 | 15.6 | failed | probe:paused-change, probe:paused-change |
| seasons-2 | novel | adapt | magnus | 3.8 | 8.6 | – | 12.6 | first attempt | – |
| magnus-1 | novel | write | projectile | 3.0 | 7.1 | – | 10.2 | first attempt | – |
| magnus-2 | novel | write | magnets | 3.8 | 7.7 | 3.2 | 15.2 | repaired | probe:bounds |

## Why generations failed

- projectile-2 (novel): unknown-global at js:27:42; unknown-global at js:28:47; unknown-global at js:29:48
- spring-1 (novel): runs: Unknown attribute "text". Colours come from tones, not attributes. at js:41:8
- ohm-2 (novel): mount: handle needs x and y, each a parameter name or a number at js:44:45
- titration-2 (novel): unknown-method at js:9:17
- normal-2 (novel): unknown-method at js:14:3
- diffusion-2 (novel): The plan was rejected: unknown-input
- combustion-2 (novel): stage-selector at js:6:23; not-a-function at js:10:16; not-a-function at js:11:16; unknown-method at js:15:3; unknown-method at js:16:3
- seasons-1 (novel): paused-change: Moving orbitAngle while paused does not change the drawing; redraw from the parameter, not only from time

## As measured, thinking included

| Condition | Approved | Total p50 / p90 / max / mean (s) | Within 25 s |
| --- | --- | --- | --- |
| novel | 3 of 34 | 23.5 / 23.5 / 23.5 / 21.9 | 100% |
