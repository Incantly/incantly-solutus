# Numbers, angles, sliders, booleans and checkboxes: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md` (the "core design"). Companion area: `docs/features/controls-scripting/` (buttons, dropdowns, input boxes, handlers, scripting). Nothing here copies the reference app's code or manual text.

## 1. What this area does

A teacher or the live teacher wants a number the learner can move ("change the radius"), an angle that sweeps, a switch that shows or hides part of the figure, and a number that moves by itself. All four are the same few objects:

- **Number**: a float64. Free numbers hold their value; dependent numbers come from a rule.
- **Slider**: a free Number that has a range (`in a..b`). The learner drags it, types into it, or lets it animate.
- **Angle**: a Number whose value is in radians and whose display unit is degrees (or turns, gradians, radians). It is not a separate type.
- **Bool**: true or false. A free Bool is a checkbox. A dependent Bool is a test (`a > 3`).
- **Visibility binding**: `with showif = <Bool>` shows an object only while the Bool is true. This is how a checkbox shows and hides things.

### Sub-features (each is in our syntax)

| Sub-feature | Lines |
|---|---|
| Free number | `a = 3` |
| Slider | `a = 3 in 0..10`, `a = 3 in 0..10 step 0.5` |
| Dynamic range | `a = 1 in 0..n`, `a = 0 in -r..r step r/10` |
| Angle slider | `θ = 30deg in 0deg..360deg step 1deg` |
| Angle from geometry | `α = Angle(A, B, C)` (value radians, shown in degrees) |
| Change range later | `a with min = 0, max = 20, step = auto` |
| Remove slider | `a with min = none` |
| Animation | `a with period = 4, loop = bounce` and `Animate(a)` |
| Animation modes | `loop = bounce \| up \| down \| once \| random` |
| Display unit | `θ with unit = deg` (`rad`, `turn`, `grad`, `none`) |
| Rounding | `x with digits = 2`; `x with sig = 3`; `@digits 3` for the whole figure |
| Number in text | `Text("r = {r:.2}", (0, 3))`, `{r:3sf}`, `{θ:deg}` |
| Checkbox | `show = true` with `with label = "Show tangent"` |
| Test | `big = a > 5` |
| Show/hide by Bool | `T with showif = show` |
| Toggle by code | `Toggle(show)`, `SetValue(show, false)` (see controls-scripting) |
| Placement | `a with place = screen(20, 20)` or `place = at(1, 2)` or default dock |
| Orientation, length | `a with vertical = true, length = 220` |
| Read the slider | `a.min`, `a.max`, `a.step`, `a.animating` |

New constants and functions this area adds (core change list in section 9): constant `deg` (π/180), `turn` (τ), `grad` (π/200); functions `round(x, n)` (decimals), `sig(x, n)` (significant figures), `snap(x, step)`, `wrap(x, lo, hi)`.

## 2. How the reference app does it (summary)

- **One class for numbers, sliders and angles.** A slider is not an object of its own: it is a free number with a range and a "show as slider" flag. Angles are numbers flagged as angles, stored in radians, with an "angle style" that decides the range of results (0 to 360, 0 to 180, reflex only, or unbounded).
- **Range ends are objects too.** Min and max can be numbers or formulas, so a slider can follow other values. If a bound is undefined the slider becomes undefined and hides.
- **Step, with an "automatic" setting.** A fixed increment quantises every set value. The automatic mode picks a "pretty" step (1, 2, 5 times a power of ten) from the range and the animation speed, with a separate finer floor for dragging. Angles use degrees for this choice.
- **Quantising.** A value is rounded to a multiple of the step counted from the minimum, then a "repair to a decimal fraction" pass removes noise such as 2.8000000000000003. It works, but it is a heuristic applied after the fact.
- **Animation is a timer that steps the stored value.** A manager owns the list of animating numbers and a timer that fires up to about 30 times per second; it lowers the frame rate when frames are slow. Each tick adds `range × speed / (10 s × frameRate)` to a hidden "animation value" and then quantises. Four modes: oscillate (bounce), increasing (wrap to the start), decreasing (wrap to the end), and increasing once (stop at the end). A random mode draws a new random value each time a hidden accumulator passes the step. Only free numbers with both bounds can animate. Speed 1 means one sweep in 10 seconds.
- **Animation is not a function of time.** The value depends on how many ticks happened, so a replay, a seek or a dropped frame gives a different result.
- **Booleans** are a single object. A free boolean is a checkbox; it can be fixed in place, and it can be registered as the "condition to show" of other objects, so toggling it updates those objects through a listener list. Dependent booleans come from tests and logic.
- **Showing and hiding by condition** is a per-object property that holds a boolean. It is evaluated at draw time.
- **Rounding** is global (a decimals or significant-figures setting for the whole file) with per-object overrides, applied only when text is made.
- **Weak spots:** animation tied to a timer; step repair is a heuristic; slider position in pixel versus maths coordinates is a mode with a lot of special cases; angle range rules live in several places; automatic sliders are created for any unknown free number, which hides typos.

## 3. Our design

### 3.1 Types

```ts
type AngleUnit = 'rad' | 'deg' | 'turn' | 'grad';

/** Display-only. The stored value is always radians for angle-unit numbers, and the plain number otherwise. */
interface NumberDisplay {
  unit: AngleUnit | 'none';              // 'none' = plain number, no symbol
  format:
    | { mode: 'auto' }                    // up to 3 decimals, trailing zeros trimmed, sci notation outside 1e-6..1e9
    | { mode: 'decimals'; n: number }     // 0..15
    | { mode: 'sig'; n: number };         // 1..15
  trim: boolean;                          // strip trailing zeros (default true for auto, false for fixed)
}

/** Range and step endpoints are rules, so they can follow other objects. Stored as object ids or constants. */
type Bound = { kind: 'const'; value: number } | { kind: 'rule'; ruleId: RuleId };

type LoopMode = 'bounce' | 'up' | 'down' | 'once' | 'random';

interface SliderSpec {
  min: Bound;
  max: Bound;
  step: number | 'auto';                  // in display-unit coordinates (see 3.3)
  loop: LoopMode;
  period: number;                         // seconds for one sweep from min to max (default 10)
  seed: number;                           // for loop = 'random'
  anim: AnimAnchor | null;                // null = not animating
  orientation: 'horizontal' | 'vertical';
  length: number;                         // CSS pixels when placed on screen (default 180)
}

/** The whole animation is a pure function of t and this anchor. */
interface AnimAnchor {
  t0: number;                             // film/clock time at which the anchor was set
  v0: number;                             // value at t0 (stored value, radians for angles)
  dir: 1 | -1;                            // direction at t0 for bounce
}

interface NumberObject {                  // extends the core Object
  type: 'Number';
  value: number | Undefined;
  slider: SliderSpec | null;              // only on a free Number
  display: NumberDisplay;
}

interface BoolObject {
  type: 'Bool';
  value: boolean | Undefined;
  label: string | null;                   // checkbox caption; null = use the name
}

type Placement =
  | { kind: 'dock' }                      // default: the control dock (see ui.md)
  | { kind: 'screen'; x: number; y: number; anchor: 'tl' | 'tr' | 'bl' | 'br' }
  | { kind: 'at'; x: number; y: number }; // maths coordinates, moves with the view
```

`showif` is a style property whose value is a rule of type Bool (or the constant true). It is stored on every object's style as `showIf: RuleId | null`. If the Bool is undefined, the object is hidden. (This is a "dynamic style property": see 9.)

### 3.2 Parsing: what each line makes

Using the grammar in the core design:

| Line | Result |
|---|---|
| `a = 3` | free Number |
| `a = 3 in 0..10` | free Number with slider, `step = auto` |
| `a = 3 in 0..10 step 0.5` | slider, fixed step |
| `a = 2n` | dependent Number |
| `a = 2n in 0..10` | error `not_free`: a range needs a free number |
| `θ = 30deg` | free Number, `unit` inferred as `deg` because the value expression ends in the angle constant |
| `θ = 30deg in 0deg..360deg step 1deg` | slider; bounds and step are converted to radians internally; `display.unit = 'deg'` |
| `x = true` | free Bool (checkbox) |
| `x = a > 3` | dependent Bool |

**Unit inference.** If a number literal is directly followed by `deg`, `turn` or `grad` (implicit multiplication after a number literal, already allowed by the core grammar), or the right-hand side is `Angle(...)`, the object gets that display unit. The rule does not guess from the name. `a = 1.2` is a plain number even if used as an angle later; use `a with unit = rad` to show it as an angle.

**Range literals and units.** `in 0deg..360deg step 1deg` are ordinary expressions that evaluate to radians. `in 0..360 step 1` on a number whose unit is `deg` is an error `unit_mismatch` with the hint to add `deg` to the bounds. (We do not silently reinterpret bounds. The reference app interprets bounds typed on an angle slider as degrees; that is friendly for humans but ambiguous for a model that wrote `2*pi`.)

**Initial value.** The initial value is clamped and snapped like any set value. If it was out of range the result carries a notice (section 5).

**Redefinition.** `a = 5 in 0..10` on an existing slider replaces value, range and step but keeps `period`, `loop`, `unit`, `place`, `label` and style. `a = 5` on a slider removes nothing: the range stays, and the value is clamped. To remove the range use `a with min = none`. (Reason: a model that corrects a value should not lose the slider by accident.)

**Style properties added by this area** (all go through `with`):

| Property | Applies to | Values |
|---|---|---|
| `min`, `max` | Number | expression or `none` |
| `step` | Number | expression or `auto` |
| `loop` | slider | `bounce \| up \| down \| once \| random` |
| `period` | slider | seconds, > 0 |
| `seed` | slider (random mode) | integer |
| `unit` | Number | `none \| rad \| deg \| turn \| grad` |
| `digits` | Number | 0..15 |
| `sig` | Number | 1..15 |
| `trim` | Number | true/false |
| `label` | Number, Bool | text; caption on the control |
| `showif` | any object | Bool expression, or `none` |
| `place` | Number (slider), Bool, controls | `dock \| screen(x, y) \| at(x, y)` |
| `vertical` | slider | true/false |
| `length` | slider | pixels |

`with` on several properties is one line and one transaction.

### 3.3 Value rules: clamp, snap, repair

All writes to a slider value (drag, keyboard, typed text, `SetValue`, redefinition, animation) go through one function `commit(slider, raw)`. The same function runs in the animation path. This is the single place where "what values are allowed" lives.

Inputs: `raw`, `lo`, `hi` (radians for angles), `step` (resolved), `unit`.

1. If `raw` is not finite: result is undefined with reason `not_finite`. (Never silently 0.)
2. Clamp: `raw = min(max(raw, lo), hi)`.
3. Work in **display-unit space** `u = raw / unitScale` (`unitScale` = π/180 for deg, τ for turn, π/200 for grad, 1 otherwise). `ulo = lo / unitScale`, `ustep = step / unitScale` (the step is stored in the unit the author typed; it is shown in that unit).
4. Count steps: `k = round((u - ulo) / ustep)` (half away from zero). If `ulo + k·ustep > uhi`, use `k − 1` (the last full step). If the range is not an exact multiple of the step, the top end is **reachable only by typing it**: the slider's maximum is `uhi`, and `snap` allows `hi` itself as a value (the learner sees the top value at the end of the track). Rule: the candidate set is `{ulo + k·ustep} ∪ {uhi}`; choose the nearest.
5. Reconstruct `v = ulo + k·ustep`, then remove binary noise by rounding to `d` decimals where `d = max(decimals(ustep), decimals(ulo), 0)` capped at 12. `decimals(x)` is the length of the shortest decimal string that reads back to `x`. This is exact and cheap (a few string operations; cache per slider since `ustep` rarely changes).
6. Convert back: `value = (v · unitScale)` computed as `v * PI / 180` (multiply then divide) so `30deg` gives exactly the same double as the literal `30deg`.

**Automatic step.** `step = auto` chooses `s = nice((hi − lo) / 100)` for dragging and keyboard, where `nice` rounds to the nearest of 1, 2, 5 times a power of ten (in display-unit space; a 0..360° slider gives 5°, a 0..1 slider gives 0.01). Typed values and `SetValue` are **not** quantised to the auto step, only clamped. While the slider is animating with `step = auto` the value is continuous (not quantised), so motion is smooth at any frame rate. With a fixed step, animation is quantised, which makes a stepped animation (a counter) possible.

**Limits.** If `(hi − lo) / step` is above 10⁶ the line fails with `limit` (too many steps); this protects the keyboard and track maths. A step smaller than 1e-12 of the range fails with `bad_range`.

**Dynamic bounds.** `min`, `max` and `step` can be rules. When their value changes the kernel re-commits the current value (it clamps and snaps again). If a bound becomes undefined the slider value becomes undefined with reason `range_undefined`; when the bound returns, the slider returns to its last defined value, clamped. If `lo >= hi` at runtime the slider is undefined with reason `empty_range`.

### 3.4 Animation: a function of the clock

The reference app's timer-stepped animation is replaced by a pure function of `t` and an anchor. Let `W = hi − lo` (in display space, `uhi − ulo`), `p0 = (v0 − lo) / W` (the anchor position as a fraction), and `s = (t − t0) / period` (sweeps elapsed; negative `s` clamps to 0, so seeking before the anchor shows `v0`).

| loop | fraction `f(s)` |
|---|---|
| `up` | `frac(p0 + s)`; one sweep takes `period` seconds; at the top it wraps to the bottom |
| `down` | `1 − frac((1 − p0) + s)` |
| `bounce` | let `m = (dir > 0 ? p0 : 2 − p0) + s`, `m' = mod(m, 2)`; `f = m' ≤ 1 ? m' : 2 − m'`. `dir` is the direction at the anchor. |
| `once` | `f = min(1, p0 + s)` (moves up and stops at the top; `anim` becomes `null` at the instant `t0 + period·(1 − p0)`, which is a function of `t`, so seeking past it shows the stopped state) |
| `random` | `f = rand(seed·1e6 + floor((t − t0) / period) + 1)`, a new value each period and the anchor value during the first period |

The slider value is then `commit(slider, lo + f·W)`.

Consequences:

- **No timer.** The player or the playground clock advances `t`. A slider that animates is a rule that reads `t`. It is in the downstream list of `t` and costs nothing when `t` is paused.
- **Deterministic.** Replay, seek, frame drops and screen refresh rates do not change the value. A film that starts a slider animating at 4.0 s and is sought to 9.3 s shows the exact value it would have after playing.
- **Free-play clock.** When no film is loaded, the playground and the learner view still have a clock that runs when anything animates (the clock only runs while at least one slider animates, a film plays, or a state exists). It is the same `t`; there is no second timer.
- **Dragging an animating slider.** On pointer down the animation pauses (the anchor is dropped); each drag value is committed; on release, if the author set `resume = true` (default true) a new anchor is set at the current `t` and value, with the direction set by the last pointer movement for `bounce`. If `resume = false` the animation stays stopped.
- **Starting and stopping.** `Animate(a)` sets the anchor `{ t0: t, v0: value, dir }`. `Animate(a, false)` clears it and freezes the value at the current computed value (it writes the stored value first).
- **Several sliders** start at the same instant when written in one `draw` call; each has its own anchor with the same `t0`.
- **Interaction with states (core 7.2).** Changing an animated slider that a rate reads restarts states, like any slider change. An animating slider that a rate reads would restart the states every frame, so the kernel rejects this at definition time with the error `animated_input` (the hint: put the quantity in a state or use a formula of `t`). A mere drag-and-release is fine.
- **Accuracy and cost.** `f(s)` needs two floating operations and one `mod`; a sub-microsecond per slider. Values can be off by at most 1 ulp of the double, independent of the number of frames.

### 3.5 Rounding and number text

Rounding is a display concern. Maths never reads it (consistent with the core rule that style is never read by maths); `round(x, n)` and `sig(x, n)` are the functions that change maths values.

`formatNumber(x, display) → string`:

1. `undefined` → "–" (a dash).
2. `x` is `NaN` or infinite → `undefined` with `not_finite` before it gets here, so this should not occur; as a fallback print `∞`, `−∞` or "–".
3. Convert to display unit (`x / unitScale`).
4. `decimals(n)`: round half away from zero **on the decimal expansion of the double** (use the shortest round-trip string and decide on its digits; avoids `1.005.toFixed(2)` = `1.00` surprises). `-0` prints as `0`.
5. `sig(n)`: same method with significant digits; trailing zeros are kept when `trim = false` (so 3sf of 2 prints `2.00`) and removed when `trim = true`.
6. `auto`: three decimals, trimmed. If `|x| ≥ 1e9` or `0 < |x| < 1e-6`, scientific notation `1.2×10⁻⁷` (Unicode superscript in text, `1.2e-7` in the aural string).
7. Append the unit symbol: `°` (no space), `rad`, `turn`, `grad` (with a thin space). `unit = none` appends nothing.

**Figure-wide default.** `@digits 3` or `@sig 4` sets the default for numbers that have no own `digits`/`sig`. Without it the default is `auto`.

**In text.** `{expr}` uses the object's own display; `{expr:.2}` fixes two decimals; `{expr:3sf}` three significant figures; `{expr:deg}` shows a radian value as degrees; `{expr:.1deg}` combines. A bad spec fails the `Text` line with `bad_format` and a hint listing forms.

### 3.6 Booleans and checkboxes

- A free Bool is a checkbox. The checkbox caption is `label` (default: the object name). Toggling by the learner is a write to the free value.
- `showif` ties visibility to a Bool. `T with showif = show` is one rule: the drawable asks the object for `visible && showIf`. When the Bool changes the kernel marks only the objects bound to it. There is no listener list to maintain: the dependency graph already knows the bound objects, because a `showif` rule is an input edge.
- `showif` accepts any Bool expression (`a > 3 and show`). A test like `a > 3` is a dependent Bool; it can be used directly: `T with showif = a > 3`.
- `showif` and `Hide/Show` are separate: `Hide(T)` sets the user-visible flag; `showif` is the condition. Both must pass. `figure` reports both so the model sees why something is not drawn.
- A checkbox bound to a hidden object stays visible. Hiding the checkbox itself is `show with visible = false` (a restyle; core style property).
- Equality on Bools is `==`. Numbers compare with a relative tolerance of 1e-12 in `==` and `!=` (a core design decision stated here because sliders make `a == 0.3` common). Use `approx(a, b, eps)` for looser tests.
- Undefined Bool: objects with `showif` bound to it are hidden. `if(...)` on an undefined Bool is undefined.
- A group of checkboxes that behave as radio buttons is a dropdown (see controls-scripting).

### 3.7 Kernel integration

- **Objects.** `Number` and `Bool` are core types. The additions above are fields on those objects; no new object type is needed in this area.
- **Rules.** A slider with dynamic bounds has one extra rule per dynamic bound (`min`, `max`, `step`) feeding a `clampRule` on the slider's value. An animating slider has a `sliderAnimRule` that reads `t`. Both are ordinary rules with declared inputs; the downstream-list machinery needs no change.
- **Command table.** `Animate` and the placement helpers are in the table (controls-scripting). `Angle`, `round`, `sig`, `snap`, `wrap` are functions or commands in the existing table.
- **Free value write path.** Pointer, keyboard, typed input and `SetValue` all call `kernel.setFree(id, value, why)` (for example `why = 'slider'`), which marks the source; `kernel.flush()` then runs the update pass. One undo entry is made per gesture (a drag from pointer down to up is one entry whose inverse is the value before the drag).

### 3.8 Interfaces for the view and teacher

```ts
interface SliderView {                       // what the view receives per slider
  id: ObjectId; name: string; label: string;
  value: number | Undefined; min: number; max: number; step: number;
  unit: AngleUnit | 'none'; text: string;   // formatted value, for the readout and screen readers
  animating: boolean; loop: LoopMode;
  orientation: 'horizontal' | 'vertical'; length: number; place: Placement;
}
interface BoolView { id: ObjectId; name: string; label: string; value: boolean | Undefined; place: Placement; }
```

The view never recomputes `text`; the kernel does, so the screen, SVG export and `figure` print the same string.

## 4. Edge cases

| Case | Behaviour |
|---|---|
| `a = 3 in 5..10` | The value is clamped to 5; the result notice says `clamped: 3 -> 5`. |
| `a = 3 in 10..0` | Error `bad_range`: the minimum must be below the maximum. |
| `a = 3 in 0..10 step 0` / negative / non-finite | Error `bad_range`. |
| `step` larger than the range | Allowed; only `lo` and `hi` are reachable. |
| Step does not divide range | Top end reachable (rule in 3.3). |
| Huge range with tiny step | `limit` error (more than 10⁶ steps). |
| `loop = once` at the top already | The slider does not move; `anim` is cleared. |
| Animation on a slider whose bounds are undefined | Value undefined (`range_undefined`); animation resumes when defined. |
| `Animate(b)` where `b` is dependent | Error `not_animatable`. |
| Angle slider `0deg..360deg` read as `0..2π` | Same thing; display is in degrees. |
| Negative angle slider `-180deg..180deg` | Allowed. Wrap helper `wrap(x, lo, hi)` for results of geometry. |
| Unit change on an object that is already used in text | Texts re-render; maths unaffected. |
| Large values | `1e300 * 1e300` makes `not_finite` before it reaches `commit`. |
| Concurrent writes in one frame | Last write wins; writes from one `draw` call are applied in line order. |
| Free number never shown as slider | Visible in the algebra/readout only. No hidden auto sliders. Unknown names stay errors (core goal 2). |

## 5. Notices

A line can succeed and still change a value. The `draw` result carries a `notices` array so the model sees it:

```json
{ "ok": true, "name": "a", "type": "Number", "summary": "5 (slider 5..10)",
  "notices": [{ "code": "clamped", "from": 3, "to": 5, "reason": "value was below the minimum" }] }
```

Notice codes: `clamped`, `snapped` (value moved to the nearest step), `range_kept` (a redefinition kept the old range), `unit_inferred`.

## 6. Better than the reference app

1. **Animation is a pure function of `t`.** Seekable, replayable, frame-rate independent, and part of film export. The reference app's tick-driven values cannot do this.
2. **No hidden sliders.** An unknown name is an error. The reference app's offer to make sliders for unknown variables hides typos; we ask the author to write the slider line.
3. **Exact decimals.** Values are `lo + k·step` with decimals derived from the step's text, not repaired afterwards.
4. **Angle bounds are explicit** and carry the unit symbol, so models and humans agree on what `360` means.
5. **Bounds can be reached** even when the step does not divide the range, so the top of a slider is never unreachable.
6. **Visibility bindings are graph edges**, not a side listener list. Cycles are caught by the normal cycle check; deleting the Bool is reported with everything that used it.
7. **Notices** tell the model when a value was changed by clamping.
8. **One commit function** for all writes, so drag, keyboard, typing, scripts and animation cannot disagree.
9. **Number formatting** rounds the decimal expansion, not the binary double.

## 7. Performance targets

| Operation | Target |
|---|---|
| `commit` on a value (clamp, snap, repair) | under 2 µs |
| Pointer drag, 500 objects | under 1 ms from event to kernel done |
| Frame with 20 animating sliders | under 0.1 ms for the animation rules |
| `formatNumber` | under 3 µs |
| Apply a slider line | under 0.2 ms (inside the 1 ms core target) |

## 8. Test plan (what builders write first)

- Table tests for `commit`: ranges where step divides, does not divide, fractions (`0.1`), huge, angles in degrees; assert exact doubles.
- Property tests: `commit(commit(x)) == commit(x)`; `lo ≤ commit(x) ≤ hi`; for any `t`, `anim(t)` equals the result of replaying frames from `t0`.
- Golden tests for `formatNumber` (rounding half away from zero on decimals, sig figs, trim, sci notation, `-0`).
- Parser golden tests for every row in 3.2.

## 9. Changes to the core design

1. **Constants `deg`, `turn`, `grad`** and functions `round(x, n)`, `sig(x, n)`, `snap(x, step)`, `wrap(x, lo, hi)`, `approx(a, b, eps)` in section 6.7. Unit symbols make angle sliders unambiguous.
2. **Style may hold rules.** Core says style is plain data never read by maths. `showif` (and a colour that depends on a value, in the style area) needs a style property that is a rule. We keep the separation: the rule is evaluated by the kernel into a plain boolean in the object's style before the view sees it, and maths rules never read style values.
3. **Number `==` uses a relative tolerance** of 1e-12.
4. **Animation anchors** are part of the object model (`SliderSpec.anim`). `Animate` is an action; film `Play`/`Pause` still only control the film clock. A free-play clock exists when no film is loaded.
5. **Reserved words** add `step` (already there), `in` (already), and the loop-mode words are values only after `loop =`. Unit words `deg turn grad rad none` are reserved as constants/values.
6. **Reason codes** for undefined add `range_undefined`, `empty_range`.
7. **Error kinds** add `bad_range`, `not_free`, `unit_mismatch`, `not_animatable`, `animated_input`, `bad_format`, `bad_style_value` (see errors.md).
8. `draw` results gain `notices`.
9. **`step`** is a context word: in `... in a..b step s` and `with step = ...`; as a name it stays reserved (core).

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
