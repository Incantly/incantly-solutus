---
inclusion: always
---

# Hackathon rules

These rules apply to every task in this repository. Where another rule disagrees, these win; if that is unclear, stop and ask the product owner.

1. **`.kiro/` stays at the repository root.** It must never be added to `.gitignore`, in whole or in part (no `.kiro`, `.kiro/`, `.kiro/*`, `.kiro/specs`, `.kiro/steering`, `.kiro/hooks` or any pattern that matches them).
2. **Spec first.** Every new feature starts as a spec in `.kiro/specs/<feature>/` with `requirements.md`, `design.md` and `tasks.md`, before any code is written. Areas already in progress have specs too.
3. **Public repository and open source licence.** The repository must be public on GitHub before submission and carry an open source licence file that GitHub detects.
4. **README.** It must explain how to install and run the project, and have a "Pre-existing work" section listing the code that existed before the fresh start (everything on the `legacy/v1` branch).
5. **No third-party trademarks, copyrighted music or other copyrighted material** without permission. Refer to the app we studied only as "the reference app".
6. **Only third-party SDKs, APIs and data we are licensed to use.** Libraries come only from `docs/design/libraries.md`; Muse Spark is used under our own API key and its terms.
7. **Keep the Kiro usage log.** Every use of a Kiro feature (specs, hooks, steering, MCP, custom agents, property-based tests, powers) gets a dated entry in `.kiro/steering/kiro-usage-log.md`. This log and a "built with Kiro" line in the README are the only places that credit an AI tool (see `AGENTS.md`, Attribution).
