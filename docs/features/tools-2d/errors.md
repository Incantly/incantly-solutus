# 2D tools: errors

Tools sit on top of the line pipeline, so there are two layers:

1. **Tool refusals**: the learner's click did not fit. These are gesture feedback with a stable `code`, shown as a hint line and spoken by the live region. They are not core error objects, because no script line exists yet.
2. **Line errors from a commit or dry run**: if the lines a tool wrote fail the transaction, the core error object comes back unchanged (core section 9), wrapped with the tool and step so the cause is clear. This should be rare and is treated as a defect in the tool spec.

Runtime conditions (collinear points, no intersection) are not errors. They are undefined values with reasons, and the tool explains them.

## 1. How the reference app handles these

- A click on the wrong kind of object is ignored; nothing says why. A tooltip shows the tool's generic instruction only.
- Degenerate constructions (three collinear points for a circle) create an object that shows as undefined in the algebra list. The object stays in the construction.
- Numeric dialogs validate the number and show a generic error on bad input.
- A cancelled tool may leave the points it created.
- A tool that needs a command that is missing from the app (in a restricted app configuration) is simply absent.

We keep "ignored click" quiet in the case of a stray click on empty space, but everything else gets a reason and a recovery.

## 2. Tool refusals

```ts
interface ToolRefusal {
  readonly code: ToolRefusalCode;
  readonly tool: ToolId;
  readonly step: number;            // slot index (0-based)
  readonly prompt: string;          // the slot's prompt
  readonly message: string;
  readonly hint: string;
  readonly accepted?: readonly string[];   // type names this slot takes
  readonly got?: readonly string[];        // types under the pointer
}
```

| Code | When | Message (example) | Hint | Recovery |
|---|---|---|---|---|
| `no_target` | Click found nothing of an accepted type | "No line under the pointer." | "Click a line, segment, ray, or vector." | Stay on the step |
| `wrong_type` | Candidates exist but none accepted (got `Circle`, wanted `Line`) | "That is a circle. This step needs a line." | Name the accepted types | Stay |
| `already_picked` | `distinct` slot picked twice | "You already chose this point." | "Pick a different point." | Stay |
| `not_a_path` | `point-on-object` on an interior or empty space | "A point can only sit on a line, curve or edge." | "Click on the edge." | Stay |
| `bad_number` | Inline field fails the checker | The core error's `message` | Core `hint` | Field stays open |
| `number_out_of_range` | Outside `range`, or `integer` violated | "Sides must be a whole number from 3 to 100." | | Field stays open |
| `degenerate` | Dry run is undefined with a reason (`collinear`, `coincident`, `parallel`, `zero_length`) | "These three points are in a line, so no circle goes through them." | "Move one of them." | Preview hidden; pick can still be committed if the learner insists (Alt+click) so that dragging fixes it |
| `mixed_types` | `create-list` over different types | "A list holds one kind of thing. You chose points and circles." | "Choose only points." | Stay |
| `conflicting_style` | `show-hide-object` on a formula show-if | "A has a condition `a > 2`. Change the condition instead." | Opens properties | No change |
| `locked` | Target is `fixed` or protected | "A is fixed." | | No change |
| `too_many_results` | `roots` or `extremum` would write more than the cap | "Found 31 roots; showing the first 20 in view." | "Zoom in to see the rest." | Writes the first N |
| `no_results` | Scan found none | "No roots in the view." | "Zoom out or move the view." | Nothing written |
| `no_path_here` | `attach-detach` target has no path under the point | | | |
| `tool_unavailable` | A needed command is missing from this build | "This tool needs `Ellipse`, which is not available yet." | | Toolbar hides the tool in release builds; tests fail in dev |
| `view_busy` | A tween or drag is in progress and the click would race it | none (the click is queued) | | |
| `limit` | Figure at 10,000 objects | "The figure is full." | | Core `limit` object included |

Every refusal is also a data record: `{ ok:false, source:'tool', ...ToolRefusal }`. The live region speaks `message` then `hint`.

## 3. Wrapped line errors

If the batch fails, the response is:

```json
{
  "ok": false,
  "source": "tool-commit",
  "tool": "circle-three-points",
  "step": 3,
  "batch": ["c = Circle(A, B, C)"],
  "error": {
    "ok": false,
    "line": 1, "col": 5, "endCol": 20,
    "kind": "no_matching_form",
    "token": "Circle(A, B, C)",
    "message": "Circle has no form (Point, Point, Point).",
    "forms": ["Circle(center: Point, radius: Number) -> Circle"],
    "hint": "Check the command table."
  },
  "internal": true
}
```

`internal: true` marks a defect in a tool spec or command table. The UI shows "That didn't work. The problem has been logged." and keeps the session on its last pick. A build test runs every tool's `emit` with example picks through the real checker, so this should fail in CI first.

## 4. Undefined results explained

When a dry run or a committed object is undefined, the tool names the reason in plain words. Table of reasons and their words:

| Reason (kernel) | Tools that can hit it | Words |
|---|---|---|
| `collinear` | circle by 3 points, conic by 5, arcs by 3 points | "These points are in a line." |
| `coincident` | two-point tools | "These two points are the same point." |
| `parallel` | intersect, perpendicular bisector | "These lines are parallel; they never meet." |
| `no_intersection` | intersect | "These two objects don't cross." |
| `zero_length` | segment-fixed, compass | "The length is zero." |
| `out_of_domain` | extremum, roots, tangents on functions | "The function has no value there." |
| `no_root` | roots | "No root in the view." |
| `not_finite` | any | "The result is too large or not a number." |
| `degenerate` | conics | "These points don't make a conic." |
| `point_inside` | tangents from an interior point | "A point inside the circle has no tangents." |

## 5. Better than the reference app

- Wrong clicks say why and what to click.
- Degenerate constructions are caught in the preview, before an undefined object exists.
- Cancelling leaves nothing behind.
- Number fields use the core checker and show its `hint`.
- Defects in tool specs are caught in CI by running every tool against the real command table.
- Refusals and line errors are data, so the teacher and tests read them.

## 6. Limits

| Limit | Value |
|---|---|
| Polygon vertices from one tool | 200 |
| Polyline points | 1,000 |
| Pen stroke points after simplification | 400 (the simplifier raises its tolerance until it fits) |
| Roots per `roots` | 20 |
| Extrema per `extremum` | 10 |
| Selection for `create-list` | 500 objects |
| Regular polygon sides | 3 to 100 |
| Pending points in a session | 200 |
| Dry run time per preview | 0.5 ms (skipped, not failed) |
