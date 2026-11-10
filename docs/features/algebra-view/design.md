# Algebra view and input bar: design

Status: draft for review. Builds on `docs/design/formula-language-and-kernel.md` and on `docs/features/language/design.md` (the grammar, type inference, previews, autocomplete and signature help it defines are used here without repeating them).

## 1. What the feature does

The Algebra view is a live, editable list of every object in the figure. It shows what each object is (its definition), what it is now (its value), and what it means (a short description). The input bar is where lines are typed. Together they are the text face of the figure: everything the canvas shows is also here in words and numbers, and everything here can be changed by typing.

### 1.1 For a learner

- See the algebra beside the geometry: a point's coordinates, a line's equation, a function's formula, a segment's length.
- Type a line, see it appear; edit a row, see the figure follow.
- Make a slider from any free number and drag it to see what depends on it.
- Show or hide objects with one click; click a row to select the object on the canvas.
- Understand why something is blank: undefined rows say why.
- Expand an object to see what it is built from and what depends on it.

### 1.2 For a teacher

- Pick how much the learner sees: value only, definition only, description only, or definition plus value. Hide helper objects (auxiliary) so the list shows only what the lesson is about.
- Reorder a view by creation, type, dependency, layer or name.
- Keep the list as the lesson script: the order is the order the teacher built it.
- Restrict the bar: read-only (list only), input allowed, or input restricted to a command list (a lesson that practises only `Midpoint`).

### 1.3 For the live teacher (the model)

The Algebra view's text projection is what `draw` returns in `summary` and what `figure` lists. The model and the learner read the same words.

### 1.4 Sub-features, complete list

| # | Sub-feature | Section |
|---|---|---|
| 1 | Row model and the four display modes (value, definition, description, definition and value) | 3.2 |
| 2 | Value formatting: rounding, fraction, scientific, angle display, undefined display | 3.3 |
| 3 | Definition text: pretty-printing of the stored tree | 3.4 |
| 4 | Descriptions generated from command templates | 3.5 |
| 5 | Sorting, grouping and filtering; auxiliary objects | 3.6 |
| 6 | Dependency expansion ("what is this made of") | 3.7 |
| 7 | Row editing, redefinition and rename in place | 3.8 |
| 8 | Visibility marble, selection, and canvas linking | 3.9 |
| 9 | Sliders in the list and sliders created from input | 3.10 |
| 10 | The input bar: submission, history, multi-line paste, restrictions | 3.11 |
| 11 | Previews while typing | 3.12 |
| 12 | Suggestions: quick fixes and "next step" prompts | 3.13 |
| 13 | Autocomplete and syntax help integration | 3.14 |
| 14 | Settings and persistence | 3.15 |
| 15 | Performance and update flow | 3.16 |
| 16 | Read-only projection for the teacher tools (`summarize`) | 3.17 |

## 2. How GeoGebra does it

Summarised from the source and the manual pages, in plain words.

- **Rows.** Each object has one or two rows: an input row showing how the object was made, and an output row showing the result. In "description" style the first row is a sentence, in "definition" style it is the formula, in "value" style only the result is shown, and "definition and value" shows both. A number of objects (simple numbers, sliders) squash into one compact row.
- **Display styles.** Five styles exist: value, description, definition, definition and value, and linear notation. The style switches in a cycle. Some apps hide some styles.
- **Output forms.** For algebraic results the output can be toggled between exact, fraction, approximation and engineering notation, filtered by what the object supports.
- **Sorting.** Four modes: by dependency (free objects, then dependent, then auxiliary), by object type, by layer, and by construction order. Groups collapse and the collapsed state is saved.
- **Auxiliary objects.** A flag hides an object from the list; a setting shows them anyway.
- **Editing.** Double-click a free object to edit its text in place; a dependent object opens a redefine dialog. In the app version the row itself is an equation editor.
- **Input.** At the bottom of the list (web) or in a bar (desktop). Pressing Enter commits; the up and down arrows walk the history; function keys insert a name, a value or a definition of the selected object.
- **Sliders.** Free numbers can show a slider inside their row. When a line mentions an undefined name, a dialog asks whether to create sliders for the missing names, and then creates them with a default range and increments. A simple number typed alone becomes a slider-able number.
- **Suggestions.** After a user creates certain objects, the list shows a small card offering a next step: solve, find intersections and extrema, or get statistics. A suggestion is shown only when the algorithm that would create its result does not already exist.
- **Preview.** While typing, a 200 ms timer evaluates the line in a sandbox and shows a ghost; a length limit applies.
- **Settings.** Style, sorting, auxiliary objects, rounding, collapsed groups, and output filters live in an algebra-settings object that notifies listeners, so views redraw.

What works: the two-row layout teaches the link between definition and value; sliders in the list make exploration fast; suggestion cards help beginners.

What is weak: styles are split across several mechanisms and each object decides its own row mode with long special cases; the input path asks questions (dialogs) in the middle of evaluation; sorting by dependency loses creation order; there is no way to see why a value is undefined; row text for the model has no stable form; wide changes (a slider drag on a heavy figure) refresh all visible rows.

## 3. Our design

### 3.1 Architecture

```text
 kernel events ──► AlgebraModel (pure) ──► rows (plain data) ──► AlgebraPanel (DOM)
 (add, update,       ▲   │                                         │
  remove, restyle)   │   └── summarize() ─► draw/figure tools      │ pointer, keyboard
                     │                                             ▼
                  settings                                    InputController ──► kernel.apply(line)
```

- `AlgebraModel` is in `packages/view` (no DOM). It subscribes to the kernel's events, keeps the row list, and produces `AlgebraRow` records. It is the only place that formats values and definitions.
- `summarize(obj, budget)` is a pure function in the kernel package (it needs only the kernel's data) used by both the model and the teacher tools. It is the single source of row text.
- `AlgebraPanel` (DOM) renders rows from the model. It has no maths.
- `InputController` turns user actions into script lines (all UI mutations are lines, so the script is the file and undo is uniform). It calls `kernel.preview` and `kernel.apply`, and `complete` and `signatureHelp` from the language area.

### 3.2 Rows and display modes

```ts
type DisplayMode = 'value' | 'definition' | 'description' | 'definitionAndValue';

interface AlgebraRow {
  id: ObjectId;
  name: string;                      // "A", "f", "P_1"
  type: TypeName;
  free: boolean;
  depth: number;                     // dependency depth: 0 for free objects
  visible: boolean;                  // shown on the canvas
  aux: boolean;
  layer: number;
  color: string;                     // object colour (CSS)
  definitionText: string;            // pretty source, e.g. "f(x) = x² − 2"
  valueText: string | null;          // null when mode hides the value or the object has none
  descriptionText: string;           // "Midpoint of A and B"
  lines: [string, string | null];    // what the panel shows for the active mode: first row, optional second row
  undefinedInfo: { reason: string; text: string; cause?: string } | null;
  slider: SliderSpec | null;
  approx: boolean;                   // value text was rounded or is a platform-approximate result
  version: number;                   // changes when any text changes; the panel diffs on it
}

interface SliderSpec { min: number; max: number; step: number; value: number; angle: boolean }
```

How each mode fills `lines`:

| Mode | First row | Second row |
|---|---|---|
| `definition` | `definitionText` | none |
| `value` | `name = valueText` for plain values; for functions and lines the formula | none |
| `description` | `descriptionText` | `valueText` if the type has one |
| `definitionAndValue` | `definitionText` | `= valueText` when it differs from the definition (a free point: both are the same, so one row) |

Rules for the second row:

1. Show it only when the value text adds information. For `A = (1, 2)` the value equals the definition; one row.
2. For `a = 3` a free number: one row `a = 3` with the slider affordance (3.10).
3. For a dependent number `h = sqrt(a² + b²)`: first row definition, second row `= 5`.
4. For a function: one row `f(x) = x² − 2` (the definition is the value). Its second row is empty. The AV may show `f(2) = 2` as a hint only on hover.
5. Text objects show the text, wrapped, clipped to 3 lines with an expander.
6. Lists show up to 8 items inline, then `… 120 items` with an expander; a numeric list shows min and max in the description.

Mode is a view setting (3.15), with a per-object override stored in the object's style (`with algebra = definition`) for the teacher to hide a value from learners.

### 3.3 Value formatting

```ts
interface ValueFormat {
  decimals: number;                  // default 2; range 0..10
  significant: number | null;        // when set, overrides decimals
  notation: 'decimal' | 'fraction' | 'scientific' | 'engineering';   // default 'decimal'
  angleUnit: 'degrees' | 'radians';  // default 'degrees' for tagged angles
  trimZeros: boolean;                // default true: 1.50 → 1.5
  thousands: ',' | ' ' | '';         // default ''
}
```

Algorithm for a Number `x` (pure, deterministic):

1. Undefined: `undefinedInfo`, `valueText = "—"` (dash).
2. Negative zero and values with `|x| < 0.5 × 10^-decimals` print `0`.
3. `notation = 'fraction'`: continued-fraction search for `p/q` with `q ≤ 1000` and relative error under 1e-12; if found print `p/q` (or `p/q π` when `x/π` has a simple fraction); else fall back to decimal.
4. Decimal: round half away from zero to `decimals` places on the decimal string of the shortest round-trip representation (avoids binary artefacts: 2.675 rounds to 2.68). Trim zeros if enabled.
5. If `|x| ≥ 1e9` or (`x ≠ 0` and `|x| < 1e-5`) in decimal mode, switch to scientific: `1.23 × 10⁹`.
6. Angle-tagged: convert to degrees, print with `°`; a second angle readout `= 0.52 rad` appears in the hover text.
7. `approx` is true if rounding changed the value by more than 1e-12 relative.

Other types (all with the same `ValueFormat`):

| Type | Text |
|---|---|
| Point | `(1.5, −2)` |
| Vector | `⟨3, 4⟩`, with length in the description |
| Line | `y = 2x + 1`; vertical `x = 3`; general `2x − 3y = 5` when it has no slope form; coefficients rounded and sign-normalised, leading coefficient positive |
| Segment, Ray | `5.83` (length) for segment; ray: its line equation |
| Circle | `(x − 1)² + (y − 2)² = 9`; description gives centre and radius |
| Arc | Length, with start and end angles in the description |
| Polygon | Area; vertices in the description |
| Function | The formula |
| Curve | Parametric formula or implicit equation |
| Region | Area when computable, otherwise `region` |
| List | `{1, 2, 3}` truncated as above |
| Bool | `true` or `false` |
| Text | The text |
| Color | A swatch plus `#rrggbb` |
| Particles | `1500 particles` |

### 3.4 Definition text

The stored syntax tree is printed by `formatExpr(tree, style)`:

```ts
type PrintStyle = 'source' | 'pretty' | 'speech';
function formatExpr(tree: Expr, style: PrintStyle): string;
```

- `source`: exactly the script text our grammar accepts (normalised spacing, minimal brackets). Used by `toScript`.
- `pretty`: Unicode maths for the panel: `x²`, `−` for minus, `×` only where the source had an explicit `*` between numbers and names that would otherwise be ambiguous, `π`, `√`, `°`, fractions as `a/b` with brackets as needed. Subscripts as real subscripts (`P₁`). Superscripts only for simple integer powers (`x²` to `x⁹`); other powers print as `x^(n+1)`.
- `speech`: words for the screen reader: `x squared`, `square root of`, `a over b`.

Both `pretty` and `speech` come from the same bracket-minimisation pass: precedence from the language table decides brackets, so printing then re-parsing yields the same tree (a round-trip test).

An operation that GeoGebra shows differently: command definitions print as the command call with arguments by name (`Midpoint(A, B)`), never expanded.

### 3.5 Descriptions

Each command form carries a template (an addition to the command table):

```ts
interface CommandForm { /* core fields */ describe?: string }   // e.g. "Midpoint of {0} and {1}"
```

`{n}` is the n-th argument's name (or its short value for numbers). Fallback when absent: `{command name} of {args}`. For free objects, descriptions come from the type:

| Object | Description |
|---|---|
| Free Point | `Point` |
| Free Number | `Number` (or `Slider` when it has a range) |
| `f(x) = …` | `Function` |
| `l = y == 2x + 1` | `Line` |
| Dependent number | `Number from a and b` (names of inputs) |
| Command result | Template text |
| Text | `Text` |

Templates are lower-risk text assets, written by us, one sentence each, no more than 60 characters. A localised bundle can replace them later.

### 3.6 Sorting, grouping, filtering, auxiliary

```ts
type SortKey = 'creation' | 'type' | 'dependency' | 'name' | 'layer';
interface AlgebraPrefs {
  sort: SortKey;                    // default 'creation'
  mode: DisplayMode;                 // default 'definitionAndValue'
  showAux: boolean;                  // default false
  format: ValueFormat;
  collapsed: string[];               // group keys
  filter: { text: string; types: TypeName[]; onlyUndefined: boolean; onlyHidden: boolean };
  input: { kind: 'any' } | { kind: 'commands'; names: string[] } | { kind: 'off' };   // restriction for lessons
}
```

| Mode | Order | Groups |
|---|---|---|
| `creation` | By `order` | none; the script reads top to bottom |
| `type` | Group order: Numbers and sliders, Points, Lines and segments, Circles and conics, Functions, Polygons and regions, Lists, Text and other; creation order within | collapsible groups |
| `dependency` | `Free` group (by creation), then `Dependent` ordered by depth then creation, then `Auxiliary` | collapsible; each dependent row shows a chain mark |
| `name` | Case-insensitive natural order (`P_2` before `P_10`) | none |
| `layer` | By layer ascending, creation within | one group per layer |

- Sorting is stable and pure; it is recomputed incrementally: add inserts at the right spot by binary search on the sort key; update changes only rows whose sort key changed.
- Hidden objects (not drawn) stay in the list; the marble shows empty.
- **Auxiliary** is a style flag `aux` (`A with aux = true`), also set by default on objects that the teacher tool creates as helpers when the model passes `aux`. Aux rows are filtered unless `showAux`.
- **Filter**: a search box in the panel header matches name, definition text and type; chips filter `undefined only` and `hidden only`. Filtering never reorders.

### 3.7 Dependency expansion

Each row has a disclosure triangle (when it has inputs or dependents). Expanded, it shows two lists:

```text
▼ M = Midpoint(A, B)            (3, 4)
    made from:   A   B
    used by:     s   h
```

Names are links: clicking selects the object, Alt+click scrolls the list to it. For the dependency sort the same data draws as an indented tree under free objects. Data comes from the kernel's input and downstream lists, no extra scan.

For an undefined row the expansion adds the chain: `undefined because B is undefined because …`, following `cause` links to the first cause, with the reason in words.

### 3.8 Editing rows

The edit box shows the object's `definitionText` in `source` style (so what is typed is accepted by the grammar). Behaviour:

1. Double-click a row, press Enter or F2-then-Enter on a focused row, or tap the pencil on touch, to enter edit. The row becomes the same line editor as the input bar (language `ui.md`), with the preview ghost.
2. Enter submits: the text is sent as a line. If the first token is not `Name =` or `Name(...) =` the editor fills the name: editing a free point shows `A = (1, 2)`, and the user changes the right side. Redefinition rules (design 3.12 of the language area) apply; errors show in the edit box.
3. Esc cancels. Tab commits and moves to the next row.
4. **Rename**: F2 on a row (not in edit) opens a name-only box; Enter issues `Rename(old, "new")`.
5. The edit of a value on a number row (`a = 3`) changes only the number; a slider keeps its range.
6. Multiple objects at once are not editable; selection of several rows enables Delete and visibility toggling only.
7. Deleting: Delete key or the row menu issues `Delete(A)`. The result lists what else vanished; the panel shows a toast with Undo.

### 3.9 Visibility, selection and canvas linking

- The **marble** at the row's left is a 24 px circle filled with the object's colour when visible and ringed (empty) when hidden. Click toggles via `A with visible = false` (a restyle line, undoable). Objects that cannot draw (a Text hidden by teacher, a number without a slider on canvas) still have a marble: for a Number with a slider, it toggles the on-canvas slider.
- **Selection**: clicking a row selects the object in the figure view (highlight), and clicking an object on the canvas scrolls the list to it and highlights the row. Selection state belongs to the view layer, not the kernel.
- Hover on a row highlights the object on the canvas (pulse outline); hover on a canvas object highlights its row.
- Shift-click and Ctrl/Cmd-click extend the selection; Arrow keys move; Space toggles the marble.

### 3.10 Sliders

A slider is a view of a free Number with a range (`in lo..hi step s`). It exists in the list row; whether it also appears on the canvas is a style flag (`slider = canvas | list | both`, default `list`).

```ts
interface RangeSpec { min: number; max: number; step: number }
function niceRange(value: number, unit?: 'angle'): RangeSpec;
```

`niceRange` for a number created without an explicit range (used when the user clicks "make slider"):

1. Angle tag: min 0, max 2π, step π/180 (1°).
2. `value = 0`: -5..5, step 0.1.
3. Otherwise `m = |value|`; the span is the smallest "1-2-5" number (1, 2, 5, 10, 20, 50 …) at least `2m`; positive values give `0..span`, negative give `-span..0`. Step: the largest "1-2-5" number not above `span / 100`, clamped at `0.001` minimum. Example: value 3 gives 0..10 step 0.1; value 12 gives 0..50 step 0.5; value -0.4 gives -1..0 step 0.01.

Sliders come into being in five ways, all of which are lines:

| Way | Line produced |
|---|---|
| Explicit input | `a = 3 in 0..10 step 0.5` |
| Number row affordance ("Make slider" button on a free number row) | `a in <niceRange(value)>` (the restyle-range form; value kept) |
| Quick fix on `unknown_name` in the input bar | `k = 1 in -5..5 step 0.1`, then the original line, as one undo group |
| Teacher tool | The model writes the first form |
| Changing a slider to a plain number | `a = 3` (range dropped) |

There is no dialog. The quick-fix chip is the only prompt, and it appears with the error, in the input bar's strip.

Slider interaction in the row:

```text
 ● a = 3.5                             [⏵]   ← play (explore mode)
   ├────────●──────────────────┤   0 ─ 10
```

- Drag or arrow keys change the value; each step is a single `a = value` update, merged into one undo entry per drag.
- Value snaps to `min + k × step`. Out-of-range values are clamped with the `clamped` notice.
- **Play** animates the slider in explore mode: the value moves at a speed set by the row's `speed` (default 1 unit of the range per 8 s), ping-ponging. It is a viewer-only effect, not recorded as a figure change and not part of the film's time (the film uses `t`). Stopping leaves the value at its current position; the figure records the final value as a normal update. A film that needs motion uses `t`.
- The range edit is double-click on the min or max label, editing the number in place; it issues `a in lo..hi step s`.
- Sliders for angle-tagged numbers show degrees in labels and use 1° steps.

### 3.11 The input bar

Placement: bottom of the Algebra view. It is not a separate panel in v1, so the list and the bar always agree on width and focus.

```ts
interface InputState {
  text: string;
  cursor: number;
  history: string[];                 // newest first, max 200
  historyIndex: number | null;
  mode: 'single' | 'multi';
  preview: PreviewResult | null;
  completion: Completion[] | null;
  signature: SignatureHelp | null;
  restrictions: { allowedCommands: string[] | null; maxLines: number | null; readOnly: boolean };
}
```

Behaviour:

1. **Submit.** Enter sends the text. Blank is ignored. The text may contain several lines (pasted); they are applied in order, each a transaction.
2. **Unnamed lines.** If the text parses as an object definition without a name (`unnamed_object`), the bar prefixes the suggested name and re-sends. This happens automatically in the bar only; the kernel and the `draw` tool stay strict. The new name is announced in the strip.
3. **Success.** The field clears, focus stays, the new row scrolls into view and flashes for 600 ms (no flash with reduced motion). A line that created several objects (`A, B = Intersect(c, d)`) flashes all.
4. **Failure.** The field keeps its text, the error strip shows (language `ui.md`), nothing is written.
5. **Redefinition notice.** If the line redefines an object (name exists), the strip shows a brief `redefined A` note and the old definition is available through Undo.
6. **History.** Up/Down as in the language `ui.md`; the history includes failed lines, marked with a red dot, so a learner can fix them.
7. **Restrictions** (teacher-set): `allowedCommands` rejects other commands with a `restricted` error kind (below), with the allowed list as `forms`.
8. **Read-only mode** hides the bar entirely and disables row editing; sliders remain active unless locked.
9. **Fast path**: a free number or point typed as a lone `name = value` is applied without the preview step.
10. **Focus**: Enter on the canvas focuses the bar (as in the manual's toggle idea); Esc in the bar returns focus to the canvas.

New error kind `restricted` (see `errors.md`): `{ kind: 'restricted', message: 'This activity allows Midpoint and Segment.', forms: ["Midpoint(...)", "Segment(...)"] }`.

### 3.12 Previews

On each pause (100 ms) the controller calls `kernel.preview(text)` (language design 3.16). Results drive:

- the one-line preview strip (pretty-printed definition, type, value);
- the ghost on the canvas;
- the suggested-name label.

The preview never opens the Algebra list. A multi-line text previews only the line containing the cursor.

### 3.13 Suggestions

Two kinds:

1. **Quick fixes** from errors (`fix`, `quickFixes`), already covered.
2. **Next-step cards**: after a successful line, the panel may show up to one card under the new row, dismissible, never modal. Cards are rules over the figure, evaluated on a settled figure only (not during drags):

```ts
interface SuggestionRule {
  id: string;
  applies(obj: AlgebraRow, fig: FigureView): boolean;       // pure, cheap
  alreadyDone(obj: AlgebraRow, fig: FigureView): boolean;   // do not suggest what exists
  text: string;                                              // "Find where f crosses the x-axis"
  lines(obj: AlgebraRow, fig: FigureView): string[];        // lines to send on accept
}
```

v1 rule set:

| Trigger | Card | Lines on accept |
|---|---|---|
| New Function | Mark roots | `r = Root(f, a, b)` for the visible interval, if defined |
| New Function with a bounded extremum in view | Mark the maximum or minimum | `Extremum` line |
| New pair of Functions or Lines that cross in view | Mark where they meet | `I = Intersect(…)` |
| New Number list | Show mean and total | `Readout` lines |
| New Line and a Circle | Mark intersection points | `Intersect` with index 1 and 2 |
| New slider unused by any object | Use the slider (offers to redefine a free number) | none; shows a hint |

A card appears only when its `alreadyDone` is false, shows at most once per object, and is switchable off in settings. The model is never shown cards (they cost tokens and it decides itself).

### 3.14 Autocomplete and syntax help in the bar

All logic is in the language area. The bar's responsibilities: pass the text, cursor and a figure view; render `Completion[]` and `SignatureHelp`; apply `insert` with placeholder handling; keep the list open only while the prefix matches.

### 3.15 Settings and persistence

- `AlgebraPrefs` is part of the view state, not of the script. Defaults per lesson can be set by `@algebra` directives in the script:

| Directive | Effect |
|---|---|
| `@algebra mode definitionAndValue` | Display mode |
| `@algebra sort creation` | Sorting |
| `@algebra round 2` | Decimals |
| `@algebra aux show` | Show helper objects |
| `@algebra input off` | Hide the input bar (read-only) |
| `@algebra input Midpoint Segment` | Restrict commands |

(`@algebra` is an addition to the directives in core section 3.)

- Collapsed groups, filter and history are per-learner UI state, saved in local storage keyed by figure id.

### 3.16 Update flow and performance

- The kernel emits events `added`, `updated` (value or definition changed), `removed`, `restyled`, `renamed`, `reordered`. The model coalesces them per animation frame and updates only the affected rows.
- Row text is cached by `(id, definitionVersion, valueVersion, settingsVersion)`. A frame that only moves `t` recomputes value text for objects in `t`'s downstream list that are visible in the viewport; others wait until scrolled into view.
- **Value update rate**: while playing, value text is refreshed at most 10 times a second per row, so numbers are readable; sliders and marbles are not throttled. Paused or dragging: every frame.
- **Virtualised list**: only rows within the viewport plus 10 above and below are in the DOM. Row height is fixed per mode (36 px single row, 60 px two rows, text rows measured once).
- Targets: add one row, 2,000 existing: under 2 ms including layout; slider drag on a figure with 5,000 objects: under 4 ms for the AV part per frame; initial render of 5,000 rows: under 100 ms (viewport only); memory: under 1 KB of row data per object.
- Row creation does not allocate strings for hidden modes: `valueText` is computed lazily by getter when the mode needs it.

### 3.17 `summarize`

The text form used by tools:

```ts
interface Summary { name: string; type: TypeName; def: string; value: string | null; text: string; undef?: { reason: string; cause?: string } }
function summarize(obj: ObjectView, opts?: { maxChars?: number; format?: ValueFormat }): Summary;
```

`text` is what `draw` returns in `summary`: `A = (1, 2)`, `f(x) = x² − 2`, `h = √(a² + b²) = 5`, `r = undefined (out_of_domain)`. Rules: free values print as `name = value`; functions print the formula; dependent values print `definition = value`; commands print `name = Command(args) → value`. Truncated to `maxChars` (default 80) with `…`.

## 4. Better than GeoGebra

1. **One text pipeline for learner and model.** `summarize` feeds both the list and the tools.
2. **The script is the file, and the list edits the script.** Every UI mutation is a line; undo is uniform; there is no separate property path.
3. **No dialog in the middle of input.** Missing sliders are a quick-fix chip, not a modal.
4. **Why is it undefined?** Reason and cause chain shown, not a question mark.
5. **Creation order is the default**, so the list reads like the lesson. Type and dependency views stay available.
6. **Dependency expansion** with "made from" and "used by" links, in every sort.
7. **Order-preserving sort modes with stable keys** and incremental updates, instead of rebuilding the tree.
8. **Rounding done on the shortest decimal form**, so 2.675 shows 2.68, and fractions found by continued fractions with a stated error bound.
9. **Value updates throttled while playing** so numbers are readable without costing frames.
10. **Teacher-controlled lesson modes**: `@algebra` directives for display mode, rounding, auxiliary visibility and restricted commands, stored with the film.
11. **Descriptions from data**: templates live in the command table, so the same table drives descriptions, docs and the model's catalogue.
12. **Suggestion cards as pure rules** over the figure, testable without UI, off by default for the model.

## 5. Changes to the core design

1. **Style**: add `aux`, `algebra` (display-mode override), and `slider` (`'list' | 'canvas' | 'both'`) to the style properties.
2. **Section 3**: add the line kind `rerange` (shared with the language area) and the directive `@algebra`.
3. **Section 5**: `CommandForm.describe` (template); `CommandSpec` unchanged otherwise.
4. **Section 6.6**: `Rename(obj, Text)` (shared with the language area).
5. **Section 9**: add error kind `restricted`.
6. **Section 10**: `draw` results include `summary` produced by `summarize`; `figure` accepts `names` and `type` filters.
7. **Section 2**: free numbers with a range are a view of a Number; animating them in explore mode is not an update the film records (clarifies the clock rule).
8. **Section 13, question 2** (dragging dependent points): the Algebra view only edits definitions; dragging stays a graphics matter.

## 6. Sources studied

GeoGebra source (commit 3608374, read-only):

- `source/shared/common/src/main/java/org/geogebra/common/gui/view/algebra/` (row logic, output formats, sort modes, suggestions, filters, context menu)
- `source/shared/common/src/main/java/org/geogebra/common/main/settings/` (algebra settings, display styles)
- `source/shared/common/src/main/java/org/geogebra/common/gui/inputbar/`
- `source/shared/common/src/main/java/org/geogebra/common/gui/inputfield/`
- `source/shared/common/src/main/java/org/geogebra/common/kernel/ScheduledPreviewFromInputBar.java`
- `source/shared/common/src/main/java/org/geogebra/common/kernel/commands/AlgebraProcessor.java` (how undefined names lead to slider creation)
- `source/shared/common/src/main/java/org/geogebra/common/kernel/geos/GeoNumeric.java` (slider properties)
- `source/shared/common/src/main/java/org/geogebra/common/main/localization/` (autocomplete)

Manual pages:

- https://geogebra.github.io/docs/manual/en/Algebra_View/
- https://geogebra.github.io/docs/manual/en/Input_Bar/
- https://geogebra.github.io/docs/manual/en/Predefined_Functions_and_Operators/
- https://geogebra.github.io/docs/manual/en/Naming_Objects/
