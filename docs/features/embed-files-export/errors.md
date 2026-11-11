# Embedding, files, export, sharing: errors

Language errors (parse, type, argument) come back from `run` as the core `KernelError`. This file covers the errors of the API itself, of files, of export and of sharing. All are data with the same shape plus `area`.

```ts
interface ApiError {
  readonly ok: false;
  readonly area: 'api' | 'file' | 'export' | 'share' | 'frame';
  readonly kind: string;
  readonly message: string;
  readonly hint?: string;
  readonly detail?: Record<string, unknown>;     // per-kind fields below
}
```

Programming errors (wrong argument types to the API) throw `TypeError` in development builds and return `{ kind: 'bad_argument' }` in production builds; they are never silent.

## 1. API errors

| Kind | When | The reference app | Ours |
|---|---|---|---|
| `unknown_name` | `get`, `set`, `remove` on a missing object | Returns empty or default values; no signal | Error data with closest names in `hint` |
| `not_free` | `set` on a dependent object | Often overridden silently or ignored | Says which inputs it depends on, hint to set those or redefine with `run` |
| `name_taken` | `rename` to an existing name | Returns false | Names the existing object |
| `reserved_name` | Rename to a command or keyword | Returns false | As the core |
| `read_only` | A write when `readOnly` is on | Not available | Hint to turn off or use a copy |
| `locked` | Write to a locked cell or object | n/a | Names it |
| `mode_forbids` | A line uses a command or tool the current mode forbids (exam, scientific, notes) | Command rejected with a general message | `kind: mode_forbids`, `mode`, `command`, `allowed` hint |
| `destroyed` | Any call after `destroy()` | Undefined behaviour | Always `destroyed` |
| `bad_argument` | Wrong shape of arguments, NaN where a finite number is required | Silent | Names the argument |
| `limit` | More than 5,000 objects; more than 2 MB of lines in one call | None | `limit: {name, max, actual}` |
| `busy` | A long operation (export, load) is running and the call needs the figure | n/a | Retry after the `exported` or `loaded` event |
| `listener_failed` | A handler threw | The page sees an error in the console | Delivered as an `error` event; the app continues |

## 2. Frame (iframe) errors

| Kind | When | Behaviour |
|---|---|---|
| `origin_blocked` | Message from an origin not allowed | Dropped; one `error` event per origin per minute |
| `protocol_version` | Envelope `v` not supported | Answer `error` with supported versions |
| `unknown_method` | Method outside the closed set | Answer `error`; nothing runs |
| `payload_too_large` | Message over 2 MB | Dropped; error answer |
| `rate_limited` | Over 200 calls per second | Answer `error` with `retryAfterMs` |
| `timeout` | Client: no answer within `timeoutMs` (default 10 s) | Promise rejects with this data; the late answer is ignored |
| `frame_gone` | The iframe was removed | All pending promises reject with this |

## 3. File errors

| Kind | When | Ours |
|---|---|---|
| `file_not_text` | Binary that is not gzip or JSON | Says what was seen in the first bytes (hex) |
| `file_invalid` | JSON that does not match the schema | Path to the first bad field, e.g. `settings.view.x0 must be a finite number` |
| `file_too_new` | `formatVersion` above ours | Says the file version and ours; no guessing |
| `file_too_large` | Over 10 MB, over 200 assets, asset over 5 MB | Which limit |
| `asset_invalid` | Bad magic number, decode failure, MIME mismatch, SVG with script | The asset id and what failed; the asset is dropped, the rest loads (a warning) |
| `asset_missing` | Script refers to `asset:id` not in file | The line fails with this; others load |
| `checksum_mismatch` | `cache.checksum` differs | Not an error: cache ignored, warning |
| `script_line_failed` | A line fails on load | Collected in `failed[]`; load continues |
| `mode_unavailable` | The file's mode is not in this build | Loads in the nearest mode, `modeAdjusted` |
| `migration_failed` | A migration step threw | File untouched; report the step |

How the reference app handles them: a failed load usually shows a generic dialog, or loads as much as it can without telling you what was lost. Ours: the same partial-load policy (it is helpful), but the loss is itemised in `LoadResult.failed`.

## 4. Export errors

| Kind | When | Ours |
|---|---|---|
| `export_too_large` | PNG beyond 8192 px on a side or 64 MP; GIF beyond 600 frames or 20 MB | Suggests the largest allowed scale for this view: `detail.maxScale` |
| `export_empty` | `region: 'all'` and nothing visible | Hint: set `region: 'view'` |
| `export_unsupported` | A format not in this build (`tikz`, `mp4`) | Lists supported formats |
| `export_cancelled` | `AbortSignal` fired | No file |
| `export_font` | Font could not be embedded (PDF) | Falls back to outlines with a warning; error only if that fails too |
| `export_canvas_tainted` | An external image tainted the canvas | Cannot happen for our assets (data URIs); external URLs are blocked at load |
| `export_oom` | Allocation failed | Suggests a smaller scale and a lower frame count |
| `export_worker` | Worker unavailable (GIF) | Falls back to the main thread in chunks with a warning |
| `export_bad_time` | `t` outside the clock range or `from >= to` | Names the range |

Warnings (not errors): particles sampled; blend modes unsupported in PDF and flattened; text outlines used.

## 5. Sharing errors

| Kind | When | Ours |
|---|---|---|
| `too_large_for_link` | Compressed file over 8 KB | `detail.bytes`; hint: download or short link |
| `external_url_blocked` | A figure includes an image or link to another host | Lists the first 3 URLs |
| `share_unavailable` | Short links requested and not set up | Says so |
| `share_denied` | Mode forbids sharing (exam) | Names the mode |

## 6. Example error objects

```json
{
  "ok": false, "area": "api", "kind": "not_free",
  "message": "M depends on A and B, so it cannot be set directly.",
  "hint": "Set A or B, or redefine with run('M = (1, 2)').",
  "detail": { "name": "M", "dependsOn": ["A", "B"] }
}
```

```json
{
  "ok": false, "area": "file", "kind": "file_invalid",
  "message": "settings.view.x0 must be a finite number, got null.",
  "hint": "Re-export the figure or fix the field.",
  "detail": { "path": "settings.view.x0" }
}
```

```json
{
  "ok": false, "area": "file", "kind": "file_too_new",
  "message": "This file uses format 3; this app reads up to format 2.",
  "hint": "Update the app, or ask the author to export for format 2.",
  "detail": { "fileVersion": 3, "supported": 2 }
}
```

A partly loaded file (success with losses):

```json
{
  "ok": true, "migrated": false, "applied": 41,
  "failed": [
    { "ok": false, "line": 17, "col": 5, "endCol": 14, "kind": "unknown_command",
      "token": "Spline3D", "message": "Spline3D is not a command.", "hint": "Not available in this app mode." }
  ],
  "warnings": [ { "kind": "asset_dropped", "id": "img2", "message": "img2 has the wrong MIME type." } ]
}
```

An export limit:

```json
{
  "ok": false, "area": "export", "kind": "export_too_large",
  "message": "A PNG of 12000 x 9000 px is over the limit of 64 megapixels.",
  "hint": "Use scale 2.5 or less for this view.",
  "detail": { "maxScale": 2.5, "limitMegapixels": 64 }
}
```

A mode restriction:

```json
{
  "ok": false, "line": 3, "col": 1, "endCol": 12, "kind": "mode_forbids",
  "token": "Derivative",
  "message": "Derivative is switched off in exam mode 'basic-calculator'.",
  "expected": [], "forms": [],
  "hint": "Ask the teacher, or use the numeric tools allowed in this mode.",
  "mode": "scientific", "command": "Derivative"
}
```

## 7. Recovery

- API callers branch on `kind`; every `hint` is plain text safe to show.
- `load` is idempotent on failure for `file_*` errors (nothing changed).
- Export errors never alter the figure; the clock is restored in a `finally`.
- For the live teacher (agent.md): only `mode_forbids`, `unknown_name` and language errors are possible through `draw`; others belong to the host page.
