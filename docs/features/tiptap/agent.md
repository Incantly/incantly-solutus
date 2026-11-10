# TipTap extension: how an AI model uses it

## Two jobs

1. **Make a figure in a document.** The writer asks; the model writes lines through `draw`, exactly as in the core design section 10. The extension commits the lines as the node's script when the model finishes.
2. **Edit an existing figure.** The model first calls `figure` to read the current objects, then writes only the lines that change.

The model never writes Tiptap JSON or HTML. It only writes lines in our language, and the extension owns the document.

## Context the model gets

- The grammar summary and the command catalogue for the figure's mode.
- For an edit: the result of `figure` (names, types, values, undefined reasons).
- The surrounding paragraph text, up to 500 characters before and after the figure, so the figure matches the writing.

## Example

Writer, in a page about quadratics: "Show the parabola and where it crosses the x-axis."

```text
f(x) = x^2 - 2x - 3
r1 = Root(f, -5, 1)
r2 = Root(f, 1, 5)
Text("roots at x = {r1.x} and x = {r2.x}", (1, 4))
```

Results back to the model: four `ok` lines; `r1` is `(-1, 0)`, `r2` is `(3, 0)`.

Recovery example: the model writes `r = Roots(f)`. The result is `unknown_command` with hint `Root`, and forms `Root(f: Function, a: Number, b: Number) -> Point`. The model's next call writes the two `Root` lines above.

## Token budget

The extension adds nothing to the catalogue. The paragraph context costs up to about 250 tokens per request.
