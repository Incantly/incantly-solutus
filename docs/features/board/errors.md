# Board: errors

All errors use the shape of the SDK and the Tiptap extension, `{ ok: false, kind, message, hint?, detail? }`, not the kernel's line error (a board error has no line or column). `detail` holds the facts a host may use: the record and field, the limit, the page. Nothing throws out of the board: every public call returns a `Result`, and a bad record, file, tool or agent answer never stops the board. A refused transaction changes nothing.

| Kind | When | What the user sees | Recovery |
|---|---|---|---|
| `board_invalid` | A file or pasted JSON fails the checks (wrong type, missing field, bad record, a page, camera or binding that fails) | "This board could not be opened" with the record and field | Nothing changes. A shape whose props fail only its kind's check, on a page that exists, does not fail the load: it is kept raw (`record_kept_raw`) |
| `board_too_new` | The file's `version` is newer than the app knows | "This board was made with a newer version" | Opens read-only when the records still pass the checks. When any of its records fail the checks (a field, a kind's props, a missing id, a repeated id, a section that is not a list), the answer is `board_too_new`, not `board_invalid`: the version is the reason the reader can act on. A newer file keeps no record raw |
| `record_kept_raw` | A shape's props fail its registered kind's check on load, and its page exists (a notice, not an error: the load succeeds) | A grey box with the kind's name; the notice names the records | The shape is kept as it was, with `meta.invalid` `{ field, why }`; it can move, be deleted and be undone; new `props` are checked by the kind again; saving writes the record as the file had it (the note is not saved) |
| `record_invalid` | A write gives a shape props its kind refuses | Nothing on screen; the host's `onError` gets it | The transaction is refused |
| `bad_argument` | A call names something that does not exist or comes at the wrong moment: a page or record that is not there, a position out of range, a `change()` inside a `change()`, a `Tx` used after its callback, and a `Tx.update` that changes a record's id | Nothing on screen; the host's `onError` gets it | The call is refused and changes nothing. To change an id, remove the record and add a new one |
| `kind_unknown` | A record names a kind that is not registered | A grey box with the kind's name | The record is kept and saved unchanged |
| `limit` | Over 10,000 shapes on a page, 100 pages, 2 million ink points on a page, or 50 MB of assets | "This page is full" with the limit | The transaction is refused; the hint says to add a page. A load never gives `limit`: a board over a limit the host lowered opens (the pages state is `full`), and the next write that adds is refused |
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
| `agent_refused` | An agent action names a shape that is gone or on another page, a locked shape, a shape the model did not make (without the user's leave), or breaks a limit; or a call has more than 20 actions | Nothing for that action | The action's result carries the error; the agent fixes its next action |

A success can carry notices in `notices` (the Result of `docs/features/errors/design.md`): `{ severity, kind, message, detail }`. Round 1 has one, `record_kept_raw`, from `loadBoard`; `detail.records` lists `{ record, field, why }` for each shape kept raw. `meta.invalid` is reserved on a kept shape: the load writes it, and a host's own `meta.invalid` on such a shape is replaced.

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
