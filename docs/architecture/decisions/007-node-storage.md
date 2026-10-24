# ADR 007: how a figure is stored in a note

- Status: accepted for v0.1
- Date: October 2026

## Context

A figure lives in a TipTap note as an atom node. The note must survive copy and paste, HTML export, collaboration, undo and offline use, and a note with 300 figures must stay cheap to edit. Snapshots are the pressure point: 300 inline PNGs can add megabytes to every transaction. TipTap attributes marked `rendered: false` are lost on copy and paste, because copying goes through HTML. And generation details must never reach the client ([PRD 18.6](../../Incantly%20SDK%20Product%20Requirements%20Document%20(1).md)).

## Decision

The node is `incantlyFigure`, with these attributes, all rendered as `data-*` attributes:

| Attribute | Content |
| --- | --- |
| `figureId` | Stable id. A pasted or duplicated figure gets a fresh one |
| `concept` | Short name, used for the frame's accessible name |
| `sdkVersion`, `schemaVersion` | See [ADR 006](006-scene-versioning.md) |
| `fragments` | The three approved fragments inline, or null |
| `fragmentsRef` | A content reference to the fragments when they are stored outside the node, or null |
| `defaults` | Authored parameter values |
| `values` | The learner's parameter values |
| `step` | Teaching-step position, or null outside step mode |
| `snapshotRef` | Content reference of the last snapshot, or null |
| `description` | The current text alternative, shown under placeholders and printed |
| `aspect` | Height over width of the live figure, so placeholders reserve the same space |
| `meta` | Only `generationId`, `approvedAt`, `validatorVersion` and `ticket`, the service's opaque signature on the scene, sent back to repair or change it |
| `formulas` | Formulas the learner edited, by index |
| `look` | The figure's own look over the editor's style: preset, tokens, classes, layout and shown parts; never CSS |
| `versions` | Earlier versions the learner can go back to, newest first, at most six (HO-9) |

- **Content references.** Snapshots are always stored outside the node, in a `FigureStore`, under `sha256:` plus the hex digest of the content. Fragments stay inline while their JSON is at most 16 KB (the three reference scenes are about 3 to 9 KB) and move to the store above that. The reference is an ordinary rendered attribute, so copy, paste and export carry it; identical content is stored once. A `CachedFigureStore` keeps content seen once in IndexedDB so figures work offline, and checks content against its reference before trusting it.
- **Nothing derived or transient** is stored: no model values, per-frame state, DOM, handles or timestamps.
- **Read defensively.** Attributes parsed from HTML are sanitized: values are finite numbers, fragments are three strings, references match the `sha256:` form, and `meta` keeps only its three keys, so a prompt, plan or model name pasted into a note is dropped. Fragments are validated again before every mount.
- **Persistence.** The live figure reports values (throttled to one message per 100 ms) and the node view saves them, with the step position and text alternative, in one transaction once interaction has settled for 600 ms, when the figure is suspended, and when the editor is destroyed. Nothing is dispatched when nothing changed.
- **Undo.** Learner exploration is not note editing: these transactions carry `addToHistory: false`. Undo and redo move through the note's text and structure only, and never reset a figure's sliders. Replacing a figure's fragments (for example after regeneration) is an ordinary, undoable edit.
- **Placeholders** show the snapshot, or a skeleton, at the stored aspect ratio, with the description underneath, so replacing them causes no scroll jump.
- **Version history (HO-9).** When a change in the learner's words, making the figure again or going back to an earlier version replaces a figure, the figure as it was joins `versions`: its fragments go to the store under their content reference, with its concept, description, a fresh snapshot, its ticket, what replaced it (`changed`, `remade` or `restored`) and when. A version holds content only, never the request that changed it, so the note still carries no prompts. Going back (`restoreFigureVersion`, or the list under the figure) is one ordinary, undoable edit that starts the version afresh at its own values, and the figure it replaces joins the history in turn. Background repairs fix the same figure and are not versions. Without a store there is nowhere to keep versions, and none are kept.

## Consequences

- A note's size grows by about 1 KB per figure plus inline fragments, not by its snapshots.
- A host must provide a `FigureStore`. Without one, figures still run but have no snapshots after suspension.
- Collaboration sees the same attributes; concurrent slider changes resolve last-writer-wins per attribute, which is acceptable for exploration state.
- A migration (ADR 006) can rewrite any attribute; references keep working because they name content, not locations.
