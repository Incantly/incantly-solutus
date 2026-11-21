# App modes: requirements

Area: `docs/features/app-modes/` (`design.md`, `ui.md`, `agent.md`, `errors.md`). Package: `packages/modes` (data and
pure logic, no DOM), with small hooks in the kernel and the screens in `apps/studio`. Branch: `feat/app-modes`.

### R1. A mode is one data record (design 3.1, 3.2)

1. THE SYSTEM SHALL describe each mode as a JSON-serialisable `ModeConfig` with views, tools, commands, expressions,
   defaults, features, keyboard, settings, ui options and exam support. A mode has no methods.
2. The registry SHALL hold the nine modes `figure`, `graphing`, `geometry`, `classic`, `scientific`, `probability`,
   `notes`, `cas` and `graphing3d`, with the values of the mode table (design 3.2, 3.2.1, 3.2.2).
3. A mode whose parts are not in this build (`notes`, `graphing3d`) SHALL be listed but unavailable: asking for it
   gives `mode_unavailable` with the modes that exist. An id not in the registry gives `unknown_mode` with the
   closest id.
4. Policies SHALL be compiled once per mode into sets, so a command, function, operator or tool check is a lookup
   (under 5 µs).
5. Command groups SHALL be the `group` of each `CommandSpec`. A mode's allow list names groups; `add` and `deny`
   name single commands.

### R2. Deriving a mode (design 3.3)

1. `deriveMode(base, restriction)` SHALL be pure and SHALL only narrow: allow lists intersect, features only turn off.
2. A restriction that tries to widen SHALL be ignored for that field with a `restriction_widens` warning.
3. Unknown names in a restriction SHALL give `restriction_invalid` with those names.

### R3. Lines in a mode (design 3.4, 3.6, 7; errors 1)

1. A line that uses a command, built-in function, operator or form the mode, a restriction or an exam forbids SHALL
   fail with `mode_forbids`, naming the thing, the mode, the reason (`mode`, `restriction`, `exam`), the exam profile
   when there is one, and up to five `allowedInstead` names from the mode's own allow list. Nothing changes.
2. Objects that already exist keep working when a restriction arrives; a redefinition that uses a forbidden command
   is refused.
3. `@mode`, `@restrict` and `@exam` SHALL be host-owned: a line from the model or a learner gets `bad_directive` with
   the legal directives. The host may write them.
4. `@angleunit`, `@rounding`, `@coords` and `@title` SHALL be checked: a bad value gives `bad_directive` with the
   legal values. During an exam the locked ones give `mode_forbids` with reason `exam`.
5. `2,5` written where a number is meant (outside brackets) SHALL give `decimal_comma` with the hint `Write 2.5.`
6. In modes with `autoSliders`, a human's `unknown_name` SHALL offer the "Create slider" chip. The model never gets a
   slider made for it.

### R4. Switching modes (design 3.5; ui 3)

1. `setMode(next)` SHALL dry-run the figure's script against `next` and return `ModeChangeResult`: objects kept, the
   dropped objects with reasons, and the views that changed.
2. When objects would be dropped and `force` is not given, nothing SHALL change (`mode_switch_loses_objects`).
3. With `force`, the switch SHALL apply as one undo step.

### R5. Exam mode (design 3.7; ui 5; errors 3)

1. Profiles `basic`, `no-calculator-tools`, `graphing-only` and `custom` SHALL each narrow the mode, lock settings,
   force settings, block actions and watch signals.
2. The controller SHALL move `idle -> preparing -> active -> finished -> idle`; any other step gives
   `exam_wrong_state` with the legal next steps. A mode with `exam.allowed: false` gives `exam_not_allowed`.
3. Start SHALL snapshot the settings and the figure; exit SHALL restore them (or keep the exam figure, per option).
4. Signals SHALL be recorded with times from a monotonic clock, at most one per second per kind.
5. The summary SHALL hold duration, signals, `flagged`, blocked commands, the object count and a SHA-256 of the
   script, and SHALL say that a web page records leaving but cannot prevent it.
6. State SHALL survive a reload (session storage): the exam resumes and records `reload`.

### R6. Settings (design 3.8; errors 4)

1. A typed registry SHALL hold every setting of the table with its scope (`file` or `user`), type, default (a value
   or the mode's), label and group.
2. `set` SHALL validate (`unknown_setting`, `setting_invalid`, `setting_locked`), `reset` SHALL restore mode
   defaults, and `snapshot`/`restore` SHALL serve the exam.
3. User settings SHALL persist under `incantly.settings.v1`; bad or future data gives defaults and keeps the bad
   record under another key (`storage_corrupt`); no storage keeps them in memory (`storage_unavailable`).
4. File settings SHALL be lines (`@angleunit degree`), so scripts reproduce them.

### R7. Languages (design 3.9; errors 5)

1. UI text SHALL come from a catalogue per locale with plurals and the fallback chain `fr-CA -> fr -> en`. A missing
   key shows English and warns once (`missing_message`).
2. Numbers SHALL show with the locale's format; lines always use `.` for decimals.
3. Right-to-left locales SHALL mirror the layout; maths stays left-to-right.
4. Digits of other scripts (Arabic-Indic, Devanagari) SHALL be turned into Latin digits before parsing.
5. Command names stay English; the catalogue given to the model is English.

### R8. Keyboard (design 3.10; ui 7; errors 6)

1. Layouts `standard`, `scientific`, `notes`, `geometry` and `probability` SHALL be data, every key with a spoken
   name. A validator SHALL reject a key with no `aria`, a duplicate id or an unknown command.
2. Keys for commands the mode forbids SHALL not be built.
3. The studio SHALL show the keyboard docked at the bottom, at most 36% of the height, opened by a button and on
   focus on touch devices.

### R9. Accessibility settings (design 3.11; ui 8)

1. `reducedMotion`, `highContrast`, `textScale` and `screenReaderMode` SHALL apply to the studio.

### R10. Studio (ui 1 to 6, 9, 10)

1. A start screen SHALL show tiles for the available modes only.
2. Each mode SHALL lay out its views and tools from its record: graphing (algebra and graphics), geometry (toolbar and
   graphics), scientific (a column of calc rows with `Ans` and `S↔D`), probability (the distribution view), cas (the
   CAS view), classic (everything), figure (graphics only).
3. The mode switcher SHALL list the modes and ask before dropping objects, with undo.
4. A settings sheet SHALL show only the settings the mode offers, apply them live, with per-setting reset.
5. Exam entry, banner, inline blocks, the left-the-window notice and the finish screen SHALL follow ui 5.
6. The model's mode card and `figure()` summary SHALL come from the same record (agent 1, 4).

### R11. Tests, speed, screenshots

1. Tests SHALL cover R1 to R10. Benches SHALL check the targets of design 5.
2. Screenshots SHALL show every mode, the switch dialog, the settings sheet, the exam and the keyboard.
