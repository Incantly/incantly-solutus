# Teacher: errors

Tool results use the kernel's error object (`docs/features/errors/design.md` 3) for line errors, since the model reads them to fix its next line. Errors that end a turn reach the caller as the server's stream error (`docs/features/server/errors.md`), in the SDK shape `{ ok: false, kind, message, hint?, detail? }`. Nothing throws out of the package.

| Kind / code | When | Template | Recovery |
|---|---|---|---|
| `tool_input` T001 | A tool call's arguments are not JSON, miss a field, or break the schema (6 lines to `draw`, 21 actions to `board`) | `{tool} needs {expected}.` | `fix_line`; `forms` holds the schema's shape |
| `tool_busy` T002 | A tool call arrives while another runs on the same target | `The figure is busy; try again.` | `skip` |
| `turn_limit` T003 | A turn passes 8 model calls, 24 tool calls or 60 s | `This answer stopped after {what}.` | `report`; what was drawn stays. On `/v1/teach` the server sends it as the stream kind `turn_limit` with this message (server `errors.md`) |
| `tool_unknown` T004 | The model calls a tool that is not in the job's toolset | `There is no tool {name}; the tools are {list}.` | `fix_line`; `expected` lists the tools |
| `retry_spent` T005 | A line failed again after two retries, or with the same fingerprint twice | `{name} was left out after two tries.` | `skip`; the result says what was left out |
| `stream_cut` T006 | A streamed script ends inside a line, or the model stops mid-call | `The answer stopped partway; {n} line(s) were drawn.` | `report` |

Notes:

- T001 and T002 are already in `docs/features/errors/errors.md`; this area adds T003 to T006 there.
- A line error inside a `draw` result is never changed by the teacher: the model gets the kernel's object as it is.
- `retry_spent` and `stream_cut` are notices in the turn's final event, not errors that end it.
- The model never speaks an error (errors design 6, rule 8). The `say` events carry only what it chose to say.
