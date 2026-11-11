---
inclusion: manual
---

# Kiro usage log

A running record of how Kiro was used to build Incantly, for the hackathon write-up. Add one row per use of a Kiro feature: specs, hooks, steering, MCP, custom agents, property-based tests and powers. Newest rows go at the bottom. The `log-spec-task` hook adds a row each time a spec task completes.

Features: **Spec** (`.kiro/specs/`), **Spec task**, **Hook** (`.kiro/hooks/`), **Steering** (`.kiro/steering/`), **MCP**, **Custom agent**, **Property-based test**, **Power**.

## Entries

| Date | Feature | Where | What was done |
|---|---|---|---|
| 2026-11-11 | Steering | `.kiro/steering/product.md`, `tech.md`, `structure.md` | Added always-included steering for the product, the stack, the allowed libraries, the commands and the package layout. |
| 2026-11-11 | Steering | `.kiro/steering/hackathon-rules.md` | Added the hackathon rules as always-included steering, so every task follows them. |
| 2026-11-11 | Steering | `.kiro/steering/kiro-usage-log.md` | Started this log (manual inclusion). |
| 2026-11-11 | Spec | `.kiro/specs/language/`, `kernel/` | Recorded the two finished areas as specs (requirements, design, tasks) from their feature design docs. |
| 2026-11-11 | Spec | `.kiro/specs/geometry/`, `numbers/`, `functions/`, `view/`, `plot/`, `symbolic/` | Wrote specs for the six areas in progress, with tasks showing each area's pipeline step. |
| 2026-11-11 | Hook | `.kiro/hooks/check-on-save.kiro.hook` | Runs `npm run check` when a source file in `packages/` or `apps/` is saved. |
| 2026-11-11 | Hook | `.kiro/hooks/log-spec-task.kiro.hook` | After each spec task, asks the agent to append a row to this log. |
| 2026-11-11 | Hook | `.kiro/hooks/warn-kiro-gitignored.kiro.hook` | Warns and fails when `.gitignore` would exclude `.kiro` or a folder inside it. |
