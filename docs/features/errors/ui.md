# Errors: what the learner sees

No error opens a dialog. Errors are shown where the learner is looking, in plain words, with a way to fix them. Undefined objects are shown in the figure and the lists, not as popups.

## 1. Input line errors

```text
 > c = Circle(O, P, 2)
       ^^^^^^^^^^^^^^^
   Circle has no form (Point, Point, Number).
   Try:  Circle(center, radius)  ·  Circle(center, through)  ·  Circle(a, b, c)
   [ Circle(O, P) ]  [ Circle(O, 2) ]             ← one-click fixes
```

- The offending token is underlined with a wavy red line (and, for colour-blind safety, also a small "!" marker at the left edge of the line).
- Message line below in the default text colour with a leading "!" glyph; never red text on its own.
- Fix buttons come from `suggest`. Click inserts the full corrected line into the input (not auto-run); Enter runs it. Keyboard: `Alt+1`, `Alt+2` choose a suggestion, `F8` jumps to the next error.
- Forms list appears for `no_matching_form`, `arg_count` and `bad_directive`, one per row, each with a "use" arrow that inserts a template with the parameter names as placeholders (Tab moves between them).
- The error clears as soon as the text changes; the preview ghost reappears when the line is valid.
- Live check runs through `dryRun` after 150 ms of typing quiet. Errors that only occur when the line ends (`unbalanced` at end of line) are shown softly (grey) until Enter or blur.

GeoGebra: a dialog or message box saying "Please check your input", with the text and no position. Command errors open a help panel.

## 2. Property and rule fields

Same inline pattern under the field. The field keeps its last good value (the object keeps its look); the error text says why the typed text was not applied. Esc restores.

## 3. Script loading

An import shows a summary:

```text
 Loaded 38 of 41 lines.   [ Show 3 problems ]
 ──────────────────────────────────────────
  line 12  unknown_command  Midpont → Midpoint     [ fix ]
  line 13  unknown_name     M (line 12 failed)      [ fix 12 first ]
  line 27  limit            Seq over 1,000,000 items
```

- The learner or author clicks a problem to jump to that line in an editor view with the same inline treatment as the input line.
- "Fix" applies the suggestion to the text and re-loads that line.
- The figure is usable immediately; missing objects are listed.

## 4. Undefined objects

- In the figure: not drawn. When the object is selected (from the list), a small badge appears near its last defined position (or at the figure corner if never defined) with the phrase: "No crossing: these lines are parallel".
- In the object list: dotted marble, value column shows the short phrase ("undefined: parallel lines"). Click the phrase to select the root `cause`; the root object is highlighted for 600 ms.
- Chains are shown in one line: "depends on I (parallel lines)".
- Colour is never the only cue: dotted marble, text, and badge.
- The step list shows the same phrase in the value column.

## 5. Toasts for accepted lines with notices

Toasts appear at the bottom left, stack up to 3, auto-dismiss in 4 s (6 s when they contain a list), stay while hovered or focused.

| Notice | Toast text |
|---|---|
| became_undefined | "I is undefined now: parallel lines." [Select I] |
| dependents_removed | "Also removed M and c." [Undo] |
| moved_for_order | "Moved B earlier so A can use it." |
| property_detached | "P's colour followed a; now plain blue." |
| confusable_name | "A and a are different names." |

Toasts are announced in a polite live region; the Undo button on the cascade toast calls undo for that group.

## 6. Errors from the teacher

The learner does not see teacher errors by default. If the learner opens the "lines" drawer (developer / author mode), each line the teacher sent is shown with its result; failed lines show the same inline treatment, greyed, with the retry that fixed them linked. This lets authors see where the model slips.

## 7. Internal errors

An `internal` error shows a toast "Something went wrong; nothing was changed." with a "Copy details" button that copies the error object (kind, code, fingerprint, line text if the learner agrees). It also writes to the log. The figure remains as before.

## 8. Accessibility

- Messages are in `aria-live="polite"` regions; the input line sets `aria-invalid` and `aria-describedby` to the message.
- Each message begins with the error's kind in words only when the learner turns on "technical messages" in settings; otherwise just the plain sentence.
- All fix buttons are real buttons with text labels equal to the corrected line.
- Underline contrast ≥ 3:1 against both themes; "!" glyph and text ensure it is not colour-only.
- Reduced motion: highlight flashes become a static outline.
- Language: English templates in v1; `messageKey` + `params` allow later translation without changing the engine.

## 9. Settings

| Setting | Default |
|---|---|
| Live check while typing | on |
| Show fix buttons | on |
| Technical messages (kind and code) | off |
| Toasts for notices | on |
| Send anonymous error statistics (kinds and codes only) | off |
