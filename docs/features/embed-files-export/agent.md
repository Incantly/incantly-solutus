# Embedding, files, export, sharing: how the model uses it

The model never calls the embed API. It writes lines through `draw` and reads through `figure`. This area gives the model four things: directives that record settings in the script, the shape of the saved script, a way to ask the host to export or save, and the rule that its lines are the file.

## 1. What the model writes

The file is the script, so the model's lines are also what gets saved and shared. Rules it follows:

- Put `@view`, `@grid`, `@axes` and `@clock` first (settings the file records).
- One object per line; style on the same line with `with`.
- Use readable names; they are the names a page can listen to (`on('changed', {object: 'P'})`).
- Do not write comments except `# incantly …` header (the host adds it) and short `#` notes that explain a step to the next reader.

Directives it can write that this area owns:

```text
@view x0 x1 y0 y1            window
@axes on|off                 @grid on|off|minor
@angleunit degree|radian     @rounding 3  |  @rounding 4s
@coords cartesian|polar
@clock 0..30                 length of the film
@title "Quadratics"          file title
```

## 2. Catalogue entries (one line each)

```text
@view x0 x1 y0 y1        visible window
@axes on|off   @grid on|off|minor
@angleunit degree|radian   @rounding n | ns   @coords cartesian|polar
@title "text"
Export(format, name)     host asks the learner to save a picture (png, svg, gif, pdf); action
Share()                  host shows a link and embed code; action
```

`Export` and `Share` are actions that **request**; they never block. They return `{ok: true, requested: true}` and the host does the saving or shows a button. They fail with `mode_forbids` in exam mode.

Token budget: about 130 tokens for this area's entries (the six directives and two actions). They sit in the always-loaded grammar summary, not in a loadable group.

## 3. Results the model gets

`draw` returns the `LineResult` shape of the embed design (name, type, summary, `created`, `changed`, `undefined`). `figure()` includes `view`, `axes`, `grid`, `angleUnit`, `clock` range and `t`, so the model reads the window before it places things.

```json
{
  "view": { "x0": -6, "x1": 6, "y0": -4, "y1": 4 },
  "axes": true, "grid": "major", "angleUnit": "radian", "clock": { "range": [0, 30], "t": 4.2, "playing": true },
  "objects": [ { "name": "a", "type": "Number", "summary": "2", "free": true, "visible": true } ]
}
```

## 4. Fixing errors

| Result | Next line |
|---|---|
| `bad_directive` on `@view 5 -5 …` | `@view -5 5 -3 3` (x0 must be less than x1) |
| `mode_forbids` | Do not retry. Say what the mode does not allow; use a permitted command or stop |
| `export_*` | Not seen by the model: host handles it, and the host's note reaches the model as a one-line system message "Export failed: too large" |

## 5. Worked snippets

### 5.1 Setting the stage

Teacher: "Let's look at a parabola. I'll make the window a little taller than wide."

```text
@view -6 6 -2 10
@grid on
f(x) = x^2 - 2
```

Teacher: "That is the curve of x squared, shifted down by two."

### 5.2 Offering a keepsake

Teacher: "That moving point is nice. I'll offer you an animation you can keep."

```text
@clock 0..6
P = (3 cos(t), 2 sin(t)) with color = blue
Trace(P)
Export(gif, "orbit")
```

Result for the last line: `{ ok: true, requested: true }`. Teacher: "You'll see a save button."

### 5.3 Recovery from a bad window

Teacher: "Let me zoom in on the crossing."

```text
@view 3 1 0 2
```

Result: `bad_directive` at col 7: "x0 must be less than x1", hint "Swap the numbers."

Teacher (next line, no apology): 

```text
@view 1 3 0 2
```

### 5.4 A forbidden command in exam mode

Teacher: "Let's find the slope with a derivative."

```text
d = Derivative(f)
```

Result: `mode_forbids` ("Derivative is switched off in this exam mode"). Teacher: "This test mode doesn't allow that tool, so I'll show the slope by drawing a tangent line instead of calculating one," then, only if `Tangent` is allowed:

```text
T = Tangent(f, 1)
```

If that is also forbidden, the teacher says what it cannot do and stops; it does not look for ways around the restriction.

## 6. Boundaries

- The model cannot read or write files, call the network or choose where exports go.
- The model never sees a learner's saved files. It sees only the figure in front of it.
- The model does not change `@mode`; the host owns the mode. A `@mode` line from the model is `bad_directive` with hint "Mode is chosen by the host".
