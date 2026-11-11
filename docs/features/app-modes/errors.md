# App modes, exam, settings, languages, keyboard: errors

Format: core `KernelError` for line-level problems; `ApiError` (embed doc) for the rest. New kinds are listed here and must be added to the core table.

## 1. Line-level errors (through `draw` and `run`)

| Kind | When | The reference app | Ours |
|---|---|---|---|
| `mode_forbids` | A command, function, operator, tool-made object or equation form is switched off by the mode or the exam | A general "illegal input" or a silent no-op; the learner is not told it is the mode | Names the thing, the mode (or exam profile), and a hint. Fields: `mode`, `command` or `function` or `operator`, `reason: 'mode' \| 'exam' \| 'restriction'` |
| `bad_directive` | `@mode`, `@restrict` or `@exam` written by the model or a learner line; bad value of `@angleunit`, `@rounding`, `@coords`, `@title`, `@view` | Not applicable | `expected` lists the legal values; hint says who owns the directive |
| `decimal_comma` | `2,5` where a number is expected, under a comma-decimal locale or not | Often reads it as two arguments or a list silently | Points at the comma and says `use 2.5` |
| `unknown_name` (extended) | Missing name, in a mode where sliders can be offered | Auto slider appears silently, or an error | Standard error plus `suggest.create`; the chip appears for a human, not for the model |
| `no_matching_form` for restricted forms | A form of a command is forbidden in a mode but others are not (for example derivative only of a function written by the learner) | Command filtered by arguments with a generic message | Lists only the allowed forms |

### `mode_forbids` fields

```ts
interface ModeForbids extends KernelError {
  readonly kind: 'mode_forbids';
  readonly mode: AppModeId;
  readonly examProfile?: ExamProfileId;
  readonly reason: 'mode' | 'exam' | 'restriction';
  readonly command?: string;
  readonly function?: string;
  readonly operator?: string;
  readonly allowedInstead?: readonly string[];   // up to 5 nearby permitted commands
}
```

Rule: the error never reveals more about the restricted feature than its name. `allowedInstead` is chosen from the mode's own allow list, by group and name similarity.

## 2. Mode and switch errors

| Kind | Area | When | Ours |
|---|---|---|---|
| `mode_unavailable` | api | `setMode` or a file asks for a mode this build does not have (`cas`, `graphing3d`, `notes` at first) | `detail.available` lists the modes that exist |
| `unknown_mode` | api | An id that is not in the registry | Closest mode id |
| `mode_switch_loses_objects` | api | `setMode` would drop objects and `force` was not given | Not an error object for the user: a result with `ok: false`, `dropped: [...]` so the UI can ask |
| `restriction_widens` | api | A `ModeRestriction` tries to turn on something the base forbids | Names the field; the field is ignored and a warning is returned (not fatal) |
| `restriction_invalid` | api | An unknown command, group, tool or view in a restriction | Which names are unknown |

## 3. Exam errors

| Kind | When | Ours |
|---|---|---|
| `exam_not_allowed` | The mode has `exam.allowed: false` | Says which modes allow it |
| `exam_wrong_state` | `start()` before `prepare()`, `finish()` when idle, `prepare()` while active | State and legal next steps |
| `exam_fullscreen_denied` | The browser refused fullscreen | The exam can still start if the profile's `watch.fullscreenExit` is false; otherwise blocked, with the reason |
| `exam_restore_failed` | Settings snapshot could not be restored | Falls back to mode defaults; warns |
| `exam_blocked` | Share, export, open, save, paste or network action blocked by the profile | `kind: exam_blocked`, `action`; the action is recorded as an `ExamSignal` of kind `command_blocked` or `paste_blocked` |
| `exam_profile_invalid` | Unknown profile id | List of profiles |

During an exam, errors are shown inline and never as a modal that could hide the banner.

## 4. Settings errors

| Kind | When | Ours |
|---|---|---|
| `unknown_setting` | `set` with an id not in the registry | Closest ids |
| `setting_invalid` | Value of the wrong type or outside range (`rounding` 16; `textScale` 500) | Range and allowed values |
| `setting_locked` | Exam or restriction has locked this setting | Who locked it |
| `storage_unavailable` | `localStorage` blocked or full | Settings still apply in memory; a one-time notice says they will not be saved |
| `storage_corrupt` | Stored JSON invalid or from a future version | Defaults used; the bad record is renamed, not deleted |

## 5. Language errors

| Kind | When | Ours |
|---|---|---|
| `locale_unavailable` | Locale not bundled | Falls back along the chain; returns which locale was used |
| `locale_load_failed` | Network or parse failure loading a catalogue | Keeps the current language; an `error` event |
| `missing_message` | Key not in the locale | English text; warning once per key (development builds raise it in tests) |
| `alias_conflict` (stage 3) | Two aliases map to the same name, or an alias equals another command | Build-time check fails the test suite |

## 6. Keyboard errors

| Kind | When | Ours |
|---|---|---|
| `layout_unknown` | `keyboardLayout` not registered | Standard layout is used |
| `layout_invalid` | A layout fails validation (key without `aria`, duplicate id, action with an unknown command) | Caught by a unit test over all layouts; at run time falls back to standard |
| `key_command_forbidden` | A command key inserts a command the mode forbids | Such keys are not built: layouts are filtered by the command policy when created. If it happens by shortcut, same `mode_forbids` |

## 7. Runtime: undefined with reasons

Modes add no new undefined reasons. The scientific mode's results show these existing ones in the results column as short text: `division by zero`, `out of domain`, `not finite`, with a tooltip; no dialog.

## 8. Example error objects

```json
{
  "ok": false, "line": 2, "col": 5, "endCol": 15,
  "kind": "mode_forbids",
  "token": "Derivative",
  "message": "Derivative is not available in exam profile 'basic' (mode: graphing).",
  "mode": "graphing", "examProfile": "basic", "reason": "exam",
  "command": "Derivative",
  "allowedInstead": ["Tangent", "Root", "Extremum"],
  "expected": [], "forms": [],
  "hint": "This test does not allow derivatives. Tangent, Root and Extremum are available."
}
```

```json
{
  "ok": false, "line": 1, "col": 1, "endCol": 6,
  "kind": "bad_directive",
  "token": "@mode",
  "message": "@mode is chosen by the host page, not by a line.",
  "expected": ["@view", "@grid", "@axes", "@clock", "@angleunit", "@rounding", "@coords", "@title"],
  "forms": [],
  "hint": "Remove this line."
}
```

```json
{
  "ok": false, "line": 3, "col": 9, "endCol": 12,
  "kind": "decimal_comma",
  "token": "2,5",
  "message": "A comma separates arguments. Decimals use a point.",
  "expected": [], "forms": [],
  "hint": "Write 2.5."
}
```

```json
{
  "ok": false, "area": "api", "kind": "mode_unavailable",
  "message": "The 3D mode is not part of this app yet.",
  "hint": "Use 'graphing' or 'classic'.",
  "detail": { "requested": "graphing3d", "available": ["figure", "graphing", "geometry", "classic"] }
}
```

```json
{
  "ok": false, "area": "api", "kind": "mode_switch_loses_objects",
  "message": "Switching to scientific would remove 12 objects.",
  "hint": "Save first, or pass force to switch anyway.",
  "detail": { "dropped": [ { "name": "f", "reason": "functions are not allowed in scientific" } ], "droppedCount": 12 }
}
```

An exam summary flag:

```json
{
  "profile": "basic", "durationMs": 3512000, "flagged": true,
  "signals": [
    { "kind": "focus_lost", "at": 1200400 },
    { "kind": "focus_back", "at": 1214100 },
    { "kind": "fullscreen_exit", "at": 2290000 }
  ],
  "blockedCommands": [ { "command": "Derivative", "count": 2 } ],
  "objectsAtEnd": 14,
  "figureHash": "9b1f…"
}
```

## 9. Recovery

- `mode_forbids`: the model does not retry; it picks an allowed way or says it cannot.
- `decimal_comma`: rewrite with a point.
- `bad_directive` on `@mode`: drop the line.
- Settings and language errors never stop the app; each has a safe fallback and a message.
- Exam errors keep the exam state valid; no error can end an exam by itself except `finish()`.
