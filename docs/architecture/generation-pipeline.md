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
