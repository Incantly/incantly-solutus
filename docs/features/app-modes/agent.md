# App modes: how the model uses it

The model works inside a mode it does not choose. The mode shows up for the model in three ways: which catalogue entries it receives, which defaults hold when it draws, and which errors it can get.

## 1. What the model is told

At the start of a session the host sends a short **mode card** with the catalogue (about 60 tokens):

```text
mode: geometry   angle: degree   window: -8 8 -5 5 (1:1)   axes: off   grid: off
labels: new objects   dragging: free points only   exam: off
```

The command catalogue is generated from the mode's `CommandPolicy`: forbidden commands are absent, so the model never sees them. In `figure` mode (the live teacher's usual mode) the catalogue is the full set the teacher has.

Token budgets for catalogue by mode (command lines only, one line per form):

| Mode | Approx. tokens |
|---|---|
| figure (teacher, v1 set) | 1,200 (core design) |
| graphing | 900 |
| geometry | 1,100 |
| classic | 1,600 |
| scientific | 150 |
| probability | 350 |

Mode card and directive summary: 60 + 130 tokens. Loadable command groups apply (core design section 10).

## 2. Defaults the model can rely on

- Angle unit: `degree` in geometry and scientific; `radian` elsewhere. `Angle(A, B, C)` returns radians in the core design; in a `degree` mode display is in degrees, and the model writes angle arguments in the displayed unit through the `deg` suffix: `Rotate(P, 90deg, O)`. (The `deg` literal suffix is a core-design addition, section 7 below.)
- In `geometry`, new points get labels; in `graphing`, new functions do not.
- In `graphing`, `autoSliders` is off for the model: it writes `a = 1 in -5..5` before using `a`.
- Dragging: the learner can drag free points only (`dragDependent: false`).

## 3. Lines the model may write for this area

Only the file-scope setting directives:

```text
@angleunit degree
@rounding 3
@rounding 4s
@coords polar
@title "Triangle centres"
```

The model cannot write `@mode`, `@restrict` or `@exam`. In exam mode `@angleunit` and `@rounding` are locked: `setting_locked`-like result as `mode_forbids` with `reason: 'exam'`.

## 4. What `figure()` returns for this area

```json
{
  "mode": "geometry",
  "angleUnit": "degree",
  "exam": { "state": "idle" },
  "allowedGroups": ["geometry", "transforms", "polygons", "conics", "measure"],
  "denied": ["Integral", "Derivative"]
}
```

`exam.state` is `active` during an exam; the model is told in a one-line system note: "Exam mode is on. Do not suggest ways around restrictions."

## 5. Fixing errors

| Result | What the model does |
|---|---|
| `mode_forbids` (reason mode) | Do not retry. Use an allowed command from `allowedInstead`, or say what this app cannot do |
| `mode_forbids` (reason exam) | Same, and never suggest leaving the exam or another app |
| `unknown_name` with `suggest` | Ignore `suggest`; write the slider line explicitly if it wants a slider |
| `decimal_comma` | Rewrite with a point |
| `bad_directive` on mode lines | Drop the line |

## 6. Worked lessons

### 6.1 A geometry lesson in degrees

Teacher: "I'll make a triangle and measure its angle at B."

```text
A = (-3, -1)
B = (2, -1)
C = (0, 3)
tri = Polygon(A, B, C)
ang = Angle(A, B, C)
```

Result for `ang`: `{ ok: true, name: "ang", type: "Number", summary: "56.31°" }`.

Teacher: "That angle at B is about fifty-six degrees."

The model reads the degree sign in the summary and says "degrees" because the mode card said `angle: degree`.

### 6.2 Recovering from a forbidden command

Mode: `graphing`, exam profile `basic`.

Teacher: "Let's find where the curve is steepest."

```text
d = Derivative(f)
```

Result: `mode_forbids`, `reason: exam`, `allowedInstead: [Tangent, Root, Extremum]`.

Teacher: "This test setting doesn't allow derivatives, so I'll show it with tangent lines instead."

```text
T = Tangent(f, 1)
```

Teacher: "Here is the tangent at x equals one. Watch the slope as we move along."

### 6.3 Setting a slider for a human who is typing (contrast)

The teacher is not shown a chip; it handles the same situation in one extra line:

```text
a = 1 in -5..5
g(x) = a x^2
```

### 6.4 Scientific mode

Teacher: "Let me work that out: three fifths plus one quarter."

```text
r1 = 3/5 + 1/4
```

(The host wraps calc lines; the model writes `r1 = …` itself and sees `{ summary: "17/20 = 0.85" }`.) Teacher: "Seventeen twentieths, which is point eight five."

## 7. Changes needed in the core design for the model

- A `deg` suffix on number literals (`90deg`) evaluates to radians; otherwise a model in degree mode could not state angles unambiguously. It is grammar: "number literal followed immediately by `deg`".
- The result summary of Angle and Number carries the unit mark for display only.

## 8. What the model must not do

- Suggest changing the mode, language or settings of the learner.
- Try variants of a forbidden command to get around the restriction.
- Write the exam profile name in speech except to say "this test setting".
