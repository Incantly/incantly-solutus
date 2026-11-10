# Numbers, angles, sliders, booleans: errors

Error format: core design section 9 (`ok`, `line`, `col`, `endCol`, `kind`, `token`, `message`, `expected`, `forms`, `hint`). Runtime problems are not errors; they make values undefined with a reason code. Everything here is data returned to the caller. Nothing opens a dialog.

## 1. How GeoGebra handles these cases

| Case | GeoGebra | Problem |
|---|---|---|
| Unparsable input | One generic "check your input" message | Position and token lost |
| Range min above max | The slider quietly becomes undefined/hidden or the ends are swapped by the dialog | No message at definition time |
| Value outside range | Value is clamped silently | The author never learns |
| Step zero or negative | Falls back to a default step | Hidden change |
| Unknown name in a slider bound | Offers to create a slider | Typos create objects |
| Setting a dependent number with a slider command | A generic illegal-argument error | No hint on how to redefine |
| Animation of a non-slider | Illegal argument on the animation command | Does not say what is missing (a range) |
| Bound becomes undefined at runtime | Slider turns undefined and hides | No reason shown |
| Tiny step on a huge range | Allowed; UI becomes slow | No limit |

## 2. Our error kinds for this area

New `kind` values (the core kinds `syntax`, `unknown_name`, `type_mismatch`, `reserved_name`, `no_matching_form`, `cycle`, `limit` still apply).

| Kind | When | Fields beyond the core set | Recovery |
|---|---|---|---|
| `bad_range` | min >= max, step <= 0 or not finite, step below 1e-12 of the range, bound not a number | `min`, `max`, `step` as evaluated | Fix the numbers; hint shows a valid line |
| `not_free` | A range, `Animate`, `SetValue` or a slider property on a dependent object | `depends_on`: names of its inputs | Hint: redefine with a constant (`a = 3 in 0..10`) |
| `unit_mismatch` | Angle bounds written without the unit (`in 0..360` on a `deg` object); `deg` used on a Bool or Text | `unit` | Add `deg` to the bounds |
| `not_animatable` | `Animate(x)` where x has no range, is dependent, or is not a Number | `reason`: `no_range`, `dependent`, `wrong_type` | Hint with the line that adds a range |
| `animated_input` | A rate (`name' = ...`) reads a slider that is set to animate | `slider`, `rate` | Use a state, or a formula of `t` |
| `bad_format` | Unknown number format in text (`{r:x}`) | `spec`, `accepted` | List of accepted specs |
| `bad_style_value` | A `with` property value of the wrong type or outside its set (`loop = spin`, `digits = 20`) | `property`, `accepted` | Accepted values listed |
| `unknown_property` | `with` property that does not exist for this type | `property`, `accepted_for_type` | Closest match |
| `type_change` | Core kind: redefining a Number as a Bool, or a slider as text | `from`, `to` | `Delete` first |
| `limit` | More than 10^6 steps; more than 500 sliders animating; label longer than 120 characters | `limit`, `actual` | Increase step or reduce range |

### Parse-level cases

| Input | Kind | Message |
|---|---|---|
| `a = 3 in 0..` | `syntax` | "Expected a number or name after '..'." `expected: ["number","name","("]` |
| `a = 3 in 0 10` | `syntax` | "Expected '..' between the two ends." |
| `a = 3 step 1` | `syntax` | "'step' only follows a range." Hint: write `in 0..10 step 1`. |
| `a = 3 in 0..10 step` | `syntax` | "Expected a number after 'step'." |
| `a b = 3` | `missing_operator` | "Expected an operator between 'a' and 'b'." Hint: names have no spaces. |
| `a with colour = red` | `unknown_property` | Hint: "Did you mean color?" |

## 3. Runtime (values become undefined with a reason)

Reason codes added by this area: `range_undefined`, `empty_range`, `not_finite` (core), `input_invalid` (controls-scripting).

| Case | Value | Visible effect |
|---|---|---|
| A bound is undefined | slider undefined, reason `range_undefined` | Slider hidden; `figure` lists the reason and the bound name |
| Bounds cross at runtime (min >= max) | undefined, `empty_range` | Same |
| Step undefined | slider falls back to `auto`, notice `step_fallback` | Slider keeps working |
| Written value NaN or infinite | undefined, `not_finite` | Readout shows a dash |
| Animated slider with `once` reaches end | Stopped; no error | `figure` shows `animating: false` |
| `showif` Bool undefined | object hidden | `figure` shows `hidden_by: showif undefined` |
| `x = 1/0` | The line is accepted: the object is created with value undefined, reason `division_by_zero` | The line returns ok with an `undefined` summary and the reason |

Numeric limits:

- A value outside ±1.7976931348623157e308 becomes `not_finite`.
- Quantising a value whose `|value| / step` exceeds 2^52 cannot be exact; the value is returned clamped and unquantised, with notice `step_below_precision`.
- Angle values that are multiples of huge turns (`1e15 deg`) lose precision; `wrap` reduces to range first. A notice `precision_loss` is added when `|x| > 2^40 · unitScale`.

## 4. Example error objects

Range is empty:

```json
{
  "ok": false, "line": 1, "col": 12, "endCol": 17, "kind": "bad_range",
  "token": "10..0",
  "message": "The range 10..0 is empty: the minimum 10 is not below the maximum 0.",
  "min": 10, "max": 0, "step": null,
  "expected": [],
  "forms": ["a = <value> in <min>..<max> [step <step>]"],
  "hint": "Write the smaller number first: a = 3 in 0..10."
}
```

Slider on a dependent number:

```json
{
  "ok": false, "line": 2, "col": 1, "endCol": 2, "kind": "not_free",
  "token": "b",
  "message": "b is computed from a, so it cannot have a slider.",
  "depends_on": ["a"],
  "forms": [],
  "hint": "Make it a free number with a range: b = 4 in 0..10. Delete b first if other lines use it as a formula."
}
```

Unit missing:

```json
{
  "ok": false, "line": 1, "col": 25, "endCol": 31, "kind": "unit_mismatch",
  "token": "0..360",
  "message": "θ is an angle in degrees, but the bounds 0..360 have no unit. They would mean 360 radians.",
  "unit": "deg",
  "forms": ["θ = 30deg in 0deg..360deg step 1deg"],
  "hint": "Write 0deg..360deg."
}
```

Animation of a number with no range:

```json
{
  "ok": false, "line": 3, "col": 9, "endCol": 10, "kind": "not_animatable",
  "token": "r",
  "message": "r has no range, so it has nothing to sweep.",
  "reason": "no_range",
  "forms": ["Animate(n: Number, on: Bool = true)"],
  "hint": "Add a range first: r with min = 0, max = 5. Then Animate(r)."
}
```

Animated input to a rate:

```json
{
  "ok": false, "line": 6, "col": 1, "endCol": 12, "kind": "animated_input",
  "token": "ω' = -g * k",
  "message": "The rate of ω reads k, which is animating. Every frame would restart the motion.",
  "slider": "k", "rate": "ω",
  "hint": "Stop the animation of k, or write k as a formula of t instead of a slider."
}
```

Bad format in text:

```json
{
  "ok": false, "line": 4, "col": 17, "endCol": 21, "kind": "bad_format",
  "token": "{r:x}",
  "message": "'x' is not a number format.",
  "spec": "x",
  "accepted": [".N (N decimals)", "Nsf (N significant figures)", "deg", "rad", "turn", "grad", ".Ndeg"],
  "hint": "Use {r:.2} for two decimals."
}
```

A successful line with a notice (not an error):

```json
{ "ok": true, "name": "a", "type": "Number", "summary": "5 (slider 5..10)",
  "notices": [{ "code": "clamped", "from": 3, "to": 5, "reason": "value was below the minimum" }] }
```

## 5. Rules for error design in this area

1. Fail at the line, never at the first use. Property values and ranges are checked when the line is applied.
2. A hint is a valid line whenever one exists.
3. Never change a number silently. Clamping and snapping are reported as notices.
4. Undefined carries its reason in `figure`, with the name of the input that caused it.
5. Limits are reported with the limit and the actual value.
