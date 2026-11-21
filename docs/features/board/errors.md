# Board: errors

All errors use the format in `docs/features/errors/design.md`. Nothing throws out of the board: every public call returns a `Result`, and a bad record, file, tool or agent answer never stops the board. A refused transaction changes nothing.

| Kind | When | What the user sees | Recovery |
|---|---|---|---|
| `board_invalid` | A file or pasted JSON fails the checks (wrong type, missing field, bad record) | "This board could not be opened" with the record and field | Nothing changes; a record that fails alone is kept raw and drawn as a grey box when the rest is good |
| `board_too_new` | The file's `version` is newer than the app knows | "This board was made with a newer version" | Opens read-only when the records still pass the checks |
| `record_invalid` | A write gives a shape props its kind refuses | Nothing on screen; the host's `onError` gets it | The transaction is refused |
| `kind_unknown` | A record names a kind that is not registered | A grey box with the kind's name | The record is kept and saved unchanged |
| `limit` | Over 10,000 shapes on a page, 100 pages, 2 million ink points on a page, or 50 MB of assets | "This page is full" with the limit | The transaction is refused; the hint says to add a page |
| `last_page` | Removing the only page | The menu item is disabled | — |
| `asset_invalid` | An image is not PNG, JPEG, WebP or a safe SVG, or is over 10 MB | "This image could not be added" | Nothing is added |
| `tool_unknown` | The toolbar or `setTool` names a tool that is not registered | The tool is left out | `onError` names the id and close ids |
| `shortcut_conflict` | Two actions get the same key | The later one has no key | `onError` names both actions |
| `icon_invalid` | A custom SVG icon has script, event attributes or outside links | The default icon | `onError` names the tool |
| `pen_unsupported` | The device gives no pressure or tilt | Ink uses simulated pressure | Not shown to the user; the style bar hides tilt options |
| `render_failed` | WebGL 2 is not available or the context is lost | The board redraws with Canvas 2D | Automatic; tiles are drawn again |
| `figure_failed` | A figure card's script fails or its mount fails | The card's picture and a small error badge, as Tiptap figures | The card's lines panel |
| `agent_unavailable` | No agent transport, or the server refused | The Ask box shows the reason | The user draws by hand |
| `agent_partial` | The agent stopped or failed partway | What it made stays; a notice lists what failed | Retry or undo |
| `agent_refused` | An agent action names a shape that is gone, a locked shape, or breaks a limit | Nothing for that action | The action's result carries the error; the agent fixes its next action |

Example:

```json
{
  "ok": false,
  "kind": "limit",
  "message": "This page has 10,000 shapes, which is the limit.",
  "hint": "Add a page, or group strokes into a frame on a new page.",
  "detail": { "page": "page:2", "limit": 10000 }
}
```
