# App modes: design

The feature design is `docs/features/app-modes/design.md`. This file says where each part lives and how the parts meet.

## Where things live

| Part | Place | Notes |
|---|---|---|
| Types, the nine mode records, exam profiles | `packages/modes/src/types.ts`, `modes.ts`, `exam-profiles.ts` | Plain data |
| Compiled policies, checks, `allowedInstead`, catalogue filter, mode card | `packages/modes/src/policy.ts`, `card.ts` | Sets built once per mode |
| `deriveMode`, restriction checks | `packages/modes/src/derive.ts` | Pure, only narrows |
| The line gate (`mode_forbids`) | `packages/modes/src/gate.ts` | Built from a policy; handed to the figure |
| Mode switch dry run | `packages/modes/src/switch.ts` | Replays the script in a scratch figure |
| Exam controller | `packages/modes/src/exam.ts`, `sha256.ts` | Clock and storage are passed in |
| Settings registry | `packages/modes/src/settings.ts` | Storage is passed in |
| Languages | `packages/modes/src/i18n.ts`, `locales/*.ts` | `en`, `fr`, `ar` catalogues |
| Keyboard layouts | `packages/modes/src/keyboard.ts` | Layouts, validator, policy filter |
| Kernel hooks | `packages/kernel/src/graph/tx.ts`, `language/uses.ts`, `language/lines.ts` | The gate, the line origin, host directives, `decimal_comma` |
| Screens | `apps/studio/src/modes/*.ts` | Start tiles, switcher, settings sheet, exam, keyboard, scientific rows |

The kernel imports nothing from `packages/modes`. It offers two hooks:

1. `lineUses(checked)` lists the commands (with their group), built-in functions and operators a checked line uses,
   and whether it is an equation, a text, a list or a state.
2. `Figure.setGate(gate)` installs a function that gets those uses and the line's origin (`host`, `learner`,
   `model`) and may refuse the line with an error. The gate runs after the areas' own line checks.

`ApplyOptions.origin` and `BatchOptions.origin` carry where a line came from (default `host`). Lines from a learner
or the model may not write `@mode`, `@restrict` or `@exam`.

## Decisions

- A mode names command groups that already exist in the command table (`geometry`, `conics`, `polygons`,
  `transforms`, `functions`, `lists`, `matrices`, `stats`, `charts`, `fits`, `probability`, `distributions`,
  `random`, `symbolic`, `text`, `logic`, `controls`, `animation`, and the kernel's own actions). No group ids are
  added to the kernel.
- `figure` mode allows everything: it is the teacher's mode, and its catalogue is the full one.
- The `scientific` calc rows are hidden names `r1`, `r2`, … with `ans` for the latest (design 7.5). The language
  does not change.
- Exam durations use the monotonic clock passed in; wall times are only written in the summary.
- SHA-256 is our own small pure function, so the summary works in Node, a worker and a browser alike.
- `notes` and `graphing3d` are records with `available: false` until their views exist.
