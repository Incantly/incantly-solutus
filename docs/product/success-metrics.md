# Success metrics

## v0.1 release gates

All three gold-standard concepts must meet these gates on the supported baseline devices and execution hosts:

| Area | Release gate |
| --- | --- |
| First render after scene delivery | Under 1 second at p95 |
| Interactive frame rate | At least 30 fps at p95; target 60 fps |
| Parameter response while paused | Visible on the next animation frame |
| Persistence | Values and learner position restore after reopening the note |
| Accessibility | Keyboard-operable controls, visible focus, text alternative, reduced-motion behavior |
| Determinism | Same scene, seed, values, and SDK version produce the same result |
| First-attempt generation pass rate | At least 85% across the three-concept eval set |
| Pass rate after one repair | At least 95% |
| Broken figure exposure | 0; only probe-approved scenes are revealed |

## Product signals

During a pilot, record:

- Share of figures where the learner changes a parameter.
- Share of learners who complete at least one teaching step.
- Figures deleted or abandoned within one minute.
- Time to skeleton, first paint, and interactivity.
- Generation and repair latency.
- Failure kind and parameter combination.
- Restore failures after reopening a note.

These are hypotheses, not promises. Initial targets are 50% parameter interaction, 35% step completion, and under 15% immediate abandonment. Recalibrate after the first meaningful pilot.

## Expansion criteria

A new SDK capability is justified when one of these is true:

- It unlocks a high-priority learner concept that cannot be expressed cleanly today.
- The same generated pattern appears repeatedly and belongs in the engine.
- It closes a recurring failure class.
- It materially improves accessibility, correctness, or measured performance.

Feature count is not a success metric.
