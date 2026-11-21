# Findings: the Tiptap extension

The one review round (Opus 5.5) of PR #126 at commit `20d5770` on `feat/tiptap`, with the state-machine check of `docs/state-machines.md` (section "tiptap", T1 to T4). Paths are under `packages/tiptap/src/`. Builder notes TT-1 to TT-9 are in `builder-notes.md`.

Status: **Fix now** means the fixer of this round fixes it with a spec test; **Later** means the fix-later list.

## Fix now

### TT-R1. A formula of a bare name shows an error (R8.1)

- **Status:** Fixed in 0d57b98.
- **Where:** `formula.ts` `evaluateExpr`.
- **What:** `incantlyFormula` with `expr: 'a'` on a figure with `a = 2` shows `formula_failed` ("A name alone defines nothing…") instead of `2`. The kernel's `preview` reads a lone name as an incomplete definition. A formula of one object's value is the most common use (`{a}` in text-logic).
- **Evidence:** the tester's two failing tests in `test/spec/formula.test.ts`.
- **Fix:** a bare name of an object in the figure reads that object's value (the value text the figure shows, then the format word). A bare name that is not an object keeps a clear `formula_failed` with close names when the kernel gives them.

### TT-R2. A replaced AI request resets the figure under the newer request

- **Status:** Fixed in 733cda0.
- **Where:** `ai.ts` the superseded branch (line 243) calls `view?.resetToNode()`.
- **What:** request B on a figure aborts request A. A leaves its loop only at its next `await`, after B has run `beginAi` and maybe applied lines. A's `resetToNode` then loads the node's script into the live figure and the panel, wiping B's lines so far. B's next lines run on a figure without its own earlier lines, so lines that read them (`P = PointOn(c)` after `c = …`) fail and are dropped from B's commit.
- **Fix:** a replaced request touches neither the figure nor the panel when a newer request on the same figure is running (`map.get(id)` is not its controller). Spec test with a fake `aiTransport`: B's lines that depend on B's earlier lines are all committed.

### TT-R3. The AI's off-screen fallback starts from the old script

- **Status:** Fixed in 733cda0.
- **Where:** `ai.ts` `applyTo` (line 194): `createHeadlessApp({ mode, script: base })`.
- **What:** when the figure is saved (scrolled away) during a stream, `runLines` returns `undefined` and a headless app is made from `base`, without the lines already accepted (`good`). Later lines that read them fail and are dropped.
- **Fix:** the headless app starts from `joinScript(base, good)`. Spec test: save the figure after the first chunk; later dependent lines are kept.

### TT-R4. A figure fixed after being bad stays a placeholder while in view

- **Status:** Fixed in 21e9362.
- **Where:** `node-view.ts` `render` (line 197).
- **What:** a live figure whose attributes turn bad unmounts (`wantsMount = false`), but the page scheduler still holds it as `live` and sends no new order. When the attributes are good again (undo, or a fix in the panel), the figure stays a placeholder until it leaves the view and comes back.
- **Fix:** on the bad to good change, ask for a mount again if the scheduler's record is `live` (`goLive`) or `ready` (`build`). Spec test: make a live figure bad, then good, with no scroll; it is live again.

### TT-R5. Remounts skip the live cap and a save order

- **Status:** Fixed in 21e9362.
- **Where:** `node-view.ts` `modeChanged` (line 803) and `onContextRestored` (line 899).
- **What:** both set `wantsMount = false`, queue an unmount, then set `wantsMount = true` and call `doMount` without `hasRoom`/`makeRoom`. A `save` order that arrives in between is dropped (`save` returns when `!wantsMount`), so the figure mounts again while it is off screen, and the count of mounted figures can pass `liveLimit` (R2.2, a hard cap).
- **Fix:** the remount goes through the same path as `goLive` (make room first), and a `save` order during the wait wins: the figure stays saved. Spec test: change the mode of one of 3 live figures and scroll it away in the same tick; at most 3 are mounted and that one is saved.

## Later

### TT-R6. The AI's commit leaves the writer's typed lines pending

- **Where:** `ai.ts` commit via `view.commitScript`; `code-panel.ts` `pending`.
- **What:** if the writer types in the panel while the AI streams, the AI's own commit is skipped by `scriptChanged` (it is `ownCommit`), so the panel's `outsideScript` never runs. The panel's 300 ms timer then commits the writer's text over the AI's lines with no `collab_conflict`. Rare: the panel shows the streamed lines, so the writer types over them.

### TT-R7. Inserting over a selected figure replaces it

- **Where:** `insertIncantlyFigure`.
- **What:** with a figure selected (a node selection), the insert replaces it; ProseMirror's default for a node selection. The docs do not say. Decide: insert after the selected figure, or document the replace.

### TT-R8. Sound in document figures (TT-1)

- The SDK screen has no sound control, so R2.7 can only keep sound off.

### TT-R9. A figure whose mode changes while it is being made never mounts

- **Where:** `node-view.ts` `doMount`, the branch after `createApp` where `attrs.mode !== first.mode`.
- **What:** the app is destroyed and the function returns, with `wantsMount` still true and no new order. The comment says "start again in the new one", and the state table of T1 lists "mount again", but nothing calls `doMount` again. The figure stays a placeholder while it counts against `liveLimit`. Found by reading; no test was run for it.
- **Fix idea:** call `doMount` again from that branch (the mode check then holds), or queue a remount.

### TT-R10. A figure that yields to a save during a remount keeps the picture of its old mode

- **Where:** `node-view.ts` `remount`.
- **What:** when a `save` order wins over a remount after a mode change, no new picture is made, so the placeholder shows the picture of the old mode until the figure is live and saved again. The picture is a cache, so nothing is lost.
