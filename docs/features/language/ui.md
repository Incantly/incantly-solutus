# Input language: what the learner sees and does

The language itself has no screen. Its user-facing parts are the editing aids around a line of text: colouring, error marks, completion, signature help, previews and symbol entry. They live in the input bar and in the Algebra view's edit box (placement and row behaviour are in `docs/features/algebra-view/ui.md`). One editor component serves both.

## 1. The line editor

A single-line text field (it grows to multiple lines when the learner pastes several), built on a plain text model, not a structure editor. The text the learner sees is the text that is saved. Above or below the field (set by where the bar sits) is a one-line **preview strip**.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ f(x) = 2x^2 - 3x + 1█                                                   │
├────────────────────────────────────────────────────────────────────────┤
│ preview:  f(x) = 2x² − 3x + 1                         → Function  ✓     │
└────────────────────────────────────────────────────────────────────────┘
```

### Why not a 2D maths editor

GeoGebra's web app offers a structured editor. We start with text because: the teacher and the model write text, so the learner sees the same form; the saved script stays readable; and a text field works on every device and with screen readers. The preview strip typesets the line (superscripts, fractions) so the learner still sees the maths shape. A structured editor can be added later without changing the language, since it would emit the same text.

## 2. Syntax colouring

Colouring is done from the lexer plus the resolver's classification, no heuristics. Updated on every keystroke (lexing is under 0.2 ms for a full line).

| Class | Default colour (light theme) | Dark theme | Not by colour alone |
|---|---|---|---|
| Object name (exists) | ink | ink | underline dotted on hover shows the type |
| Unknown name | red | red | squiggle underline once the learner pauses |
| Command | blue | light blue | bold weight |
| Built-in function | teal | light teal | |
| Constant | purple | light purple | |
| Number | dark orange | orange | |
| Operator and brackets | grey | light grey | matched pair gets a box when the cursor is next to one |
| String | green | light green | `{ }` parts coloured as expressions |
| Comment | grey italic | grey italic | |
| Keyword (`if in step with and or not`) | pink | light pink | |

All colours meet a 4.5:1 contrast ratio on their background. The error underline uses a wavy red line plus a small marker in the gutter, so it is visible without colour vision.

**Bracket matching.** When the cursor touches a bracket, the matching one is boxed. Unmatched brackets get the red wavy underline immediately (not after a pause).

**Auto-close.** Typing `(`, `[` or `"` inserts the pair with the cursor inside. Typing the closer over an auto-inserted closer steps over it. Backspace between an empty pair removes both. This is off for `{` inside a string unless the text already has an open `{`.

## 3. Error display

Errors appear only after the learner pauses (about 400 ms) or presses Enter, so partly typed lines are not shouted at. The one exception is unmatched closers and bad characters, which show at once.

```text
│ c = Circle(A, 2, 3█)                                                   │
│                ~~~~                                                    │
├────────────────────────────────────────────────────────────────────────┤
│ ✗ Circle takes 2 or 3 arguments; argument 3 is a Number but needs a Point │
│   Circle(center, radius)  ·  Circle(center, through)  ·  Circle(a, b, c)  │
│   [Use Circle(A, 2)]                                                    │
└────────────────────────────────────────────────────────────────────────┘
```

- The squiggle spans `col` to `endCol` (in the learner's original text).
- The strip shows `message` first. `forms` are shown as short chips; the closest is bold. Clicking a chip replaces the call's arguments with that form's placeholders and selects the first one.
- If the error has a `fix`, a button labelled with the changed text appears; one click applies it into the field (not to the figure), and Enter then submits as usual.
- If the error has `quickFixes`, each is a button. A multi-line fix such as a slider creation sends all its lines as one undo step on Enter.
- **Incomplete input** (`incomplete: true` from the preview) is not an error: the strip shows the expected next tokens in grey, e.g. `expects: ) or ,`.
- Pressing Esc clears the strip but keeps the text.

On submit with an error, the field keeps the text, selects `col..endCol`, and the strip stays. The learner can fix and press Enter again. Nothing in the figure changes.

## 4. Completion

Opens automatically after 2 typed letters (1 after `.` or `@`), and on Ctrl+Space at any point. It is a floating list under the cursor, up to 8 rows, scrolling for more.

```text
│ M = Mid█                                                                │
│     ┌──────────────────────────────────────────────┐                    │
│     │ ⌘ Midpoint(A, B)             Point            │ ← selected          │
│     │ ⌘ Midpoint(s)                Point            │                    │
│     │ ƒ  mod(a, b)                 Number           │                    │
│     │ •  Mid_1                     Point  (object)  │                    │
│     └──────────────────────────────────────────────┘                    │
```

- Icons: `⌘` command, `ƒ` function, `•` object, `π` constant, `.` field, `≡` property or directive. Each row also shows its type in words, so the icon is not the only cue.
- Up/Down move; Enter or Tab accept; Esc dismisses; typing continues filtering.
- Accepting a command inserts `Midpoint(A, B)` with the parameter names as placeholders. Placeholders are real text selected one at a time; Tab jumps to the next, Shift+Tab back. The first placeholder is pre-filled with the best-fitting object by type and recency (for `Midpoint(A, B)`, the last two Points). The learner can overtype.
- Inside call arguments, objects whose type fits the current parameter float to the top and show a leading dot; others are dimmed, not hidden.
- Completion text is localisable later; command names are not (see core "Not in v1").
- A touch device shows the list above the on-screen keyboard.

## 5. Signature help

While the cursor is inside a call, a strip lists the forms for that command. It is the same strip as the error display, in a calmer style.

```text
│ c = Circle(A, █)                                                         │
├────────────────────────────────────────────────────────────────────────┤
│ Circle(center: Point, [radius: Number])                    ← active       │
│ Circle(center: Point, through: Point)                                    │
│ forms that no longer match the typed arguments are hidden                │
└────────────────────────────────────────────────────────────────────────┘
```

- The current parameter is underlined in the active form.
- Forms that already contradict what was typed are hidden after the first argument.
- Hover or focus on a command name anywhere in the line shows the summary line from the command table (one sentence) and the forms.
- Keyboard: Ctrl+Shift+Space opens the strip on demand.

## 6. Preview (ghost)

After 100 ms without typing, a valid line shows a ghost in the Graphics view: the object drawn at 40 percent opacity with a dashed outline, and no label commit. Unnamed input shows the suggested name in the ghost's label (`c`). Pressing Enter commits; any edit updates or removes the ghost. The ghost does not appear in the Algebra view list except as the input row's own preview strip.

A ghost never leaves anything behind: no id, no undo entry, no downstream list. Undefined results show a dashed placeholder at the origin of their inputs where one exists (for a segment, between its endpoints) or no ghost, with the reason in the strip.

## 7. Symbol entry

A palette button (Σ) at the right end of the field opens a popover with categories. On touch, the same content is the custom keyboard's second page.

| Category | Contents |
|---|---|
| Greek | α β γ δ ε θ λ μ π σ τ φ ω |
| Operators | + − × ÷ ^ ( ) [ ] , ; . == != <= >= and or not |
| Functions | sin cos tan asin acos atan sqrt abs ln exp floor ceil round min max mod |
| Constants | π τ e ° ∞ |
| Commands | Common commands by group, matching the toolbar groups |

Typing helpers:

- `pi` after a space or operator becomes a suggestion for `π`; Tab inserts it. The saved text keeps `pi` (ASCII) or `π`, depending on a setting; both mean the same.
- `<=`, `>=`, `!=` can be typed as ASCII. A setting "prettify operators" shows them as `≤ ≥ ≠` in the preview strip only.
- Alt+key shortcuts (macOS Option) for `π` (p), `°` (o), `θ` (t), `√` (v), `∞` (8). Alt is not required because the palette and the completion list cover them.
- Superscript digits typed into the field are converted to `^2` form on insert, with the cursor kept after the digits.

## 8. History

- Up and Down in an empty or unmodified field cycle through the learner's earlier submissions in this figure (up to 200, newest first). The list is saved with the figure's UI state, not in its script.
- Ctrl+R opens a filter list (type to search history).
- Alt+click a row in the Algebra view inserts its name at the cursor; Ctrl+Alt+click inserts its definition, replacing the field contents. Shift+click on a canvas object inserts its name. These replace the function-key shortcuts of desktop programs, which clash with laptop keyboards and browsers.

## 9. Paste

- Pasting multiple lines: each non-blank line is applied in order as its own transaction, with a progress count. A failing line stops the run and leaves that line and the rest in the field with the error shown on the first; the learner fixes and presses Enter to continue. Lines already applied can be undone as one group (Ctrl+Z once).
- Pasting text with smart quotes, `×`, `−`, and so on works through normalisation (section 3.2 of the design).
- Pasting rich text pastes plain text only.
- Pasting a GeoGebra-style line such as `A:(1,2)` or `Circle[A, 2]` gives a `syntax` error with a `fix` in our form when the rewrite is mechanical (colon label, square-bracket call). The rewrite is offered; it is never applied silently.

## 10. Keyboard summary

| Key | Action |
|---|---|
| Enter | Submit the line; with completion open and an item selected, accept it |
| Shift+Enter | Insert a newline (multi-line input) |
| Esc | Close completion or strip; clear ghost; second Esc clears the field after a confirm |
| Tab / Shift+Tab | Next / previous placeholder; accept completion |
| Up / Down | History when the field is empty or unchanged; completion list otherwise |
| Ctrl+Space | Open completion |
| Ctrl+Shift+Space | Open signature help |
| Ctrl+/ | Toggle comment on the line |
| Ctrl+Z / Ctrl+Y | Undo or redo text edits inside the field; when the field is empty, undo or redo figure changes |
| F2 on an Algebra row | Rename the object |

## 11. Screen reader and accessibility

- The field has role `textbox` with `aria-multiline` true and `aria-autocomplete="list"`; the completion list is a `listbox` linked by `aria-controls` and `aria-activedescendant`.
- The preview and error strip is a live region (`aria-live="polite"`). Error text is read once per change after the pause, not on every key. Format: `Error in column 12: Circle takes 2 or 3 arguments...`; a fix button is announced as `Suggested fix: …`.
- On submit success a short polite announcement: `f defined as function x squared minus 2`, generated from the same summary as the Algebra row.
- Operators read out in words in the preview strip's accessible name: `x caret 2` is announced as `x squared` for the common exponents.
- Colour is never the only signal (section 2).
- Targets are at least 44 by 44 CSS pixels on touch; the field respects the system font size and scales to 200 percent without clipping.
- Reduced motion: no animation in the completion list or ghost beyond an instant opacity change.

## 12. Touch

- The on-screen keyboard is the platform keyboard plus an accessory bar above it: `( ) [ ] , ^ * / = == < >` and a Σ button, so the learner rarely switches layouts.
- Long-press on `^` offers `² ³ √`; on `=` offers `== != <= >=`.
- Completion rows are 44 px tall; swipe left on a row to see the full form.
- Fix chips are large buttons under the field.

## 13. What GeoGebra does and what we change

| Aspect | GeoGebra | Ours |
|---|---|---|
| Editor | A structure (2D maths) editor in the web app and a plain bar in the desktop program | Plain text everywhere with a typeset preview; same text as the script |
| Error display | A dialog after Enter with a generic message | Inline underline, message, forms and fix buttons; no dialog |
| Completion | After 3 letters, command names only | After 2 letters, commands, functions, objects, fields, properties; ranked by type fit and recency |
| Insert help | Syntax shown in a bar with parameter names as placeholders | Real selectable placeholders pre-filled with fitting objects; Tab steps |
| Symbol keys | Alt shortcuts that clash on many keyboards | A palette plus completion; Alt shortcuts optional |
| Previews | Ghost shown after a delay | Ghost with suggested name, no side effects, undefined placeholders |
| Insert object name | Function keys | Alt+click on a row or Shift+click on the canvas |
