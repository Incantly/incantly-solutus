# TipTap extension: errors

All errors use the format in `docs/features/errors/design.md`. A figure's errors never break the document: the editor keeps working, and the figure shows what went wrong in its own box.

| Kind | When | What the reader sees | Recovery |
|---|---|---|---|
| `bad_attrs` | The node's attributes fail validation on load (wrong types, unknown version, script over 64 KB) | The placeholder with "This figure could not be loaded" | The node keeps its raw attributes so nothing is lost; a writer can open the lines and fix them |
| Line errors (`syntax`, `unknown_name`, …) | A line in the script fails when the figure mounts | The figure with the good lines drawn, and a small error badge | The badge opens the code panel at the first bad line |
| `mount_failed` | The SDK could not create the figure (no GPU, out of memory) | The saved picture if there is one, else the caption, with "Live figure unavailable" | Retries once when the figure next becomes live; then stays a picture |
| `context_lost` | The shared GPU context was lost | All live figures show their last frame | The scheduler rebuilds the context and remounts live figures from saved state |
| `restore_failed` | Saved state does not match the script (edited elsewhere) | The figure starts from its script's defaults | A notice says the reader's changes were reset |
| `ai_unavailable` | No `server` option, or the server refused | The AI box shows the reason | The writer edits lines by hand |
| `ai_partial` | The model stopped or failed partway | The lines that worked stay; a notice lists the ones that did not | The writer can retry the request or fix lines |
| `collab_conflict` | Another writer committed the script first | A notice with the writer's own lines in the code panel | Re-apply or discard |

Example:

```json
{
  "ok": false,
  "kind": "bad_attrs",
  "message": "The figure's script is 80 KB; the limit is 64 KB.",
  "hint": "Split the figure into two, or remove unused objects.",
  "node": "fig_7Qk2"
}
```
