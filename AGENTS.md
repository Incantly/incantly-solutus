# Agent implementation rules

## Generation speed is a first-class requirement (read before touching generation)

- Implement the PRD (`docs/Incantly SDK Product Requirements Document (1).md`) from start to finish. Every requirement gets done, nothing is left "in progress" at the end of a run; if a slice is impossible, say so in the final message instead of leaving silent gaps.
- Prefer not to add a third agent or a multi-agent planning loop: three agents doing the planning is too slow and it is rejected by design. The pipeline is exactly one plan call (small fast model, ~150 tokens out, target under 2 s) plus one scene call (streamed, target under 6 s), with at most one re-plan and up to three repairs, each only while the one before made progress — so avoid extra model round-trips on the generation path. A multi-agent loop is allowed only if you first look for other ways to meet the budget with a single plan call and one scene call: never reach for more agents as the first move, and never trade latency for coordination overhead.
- If planning or generation style becomes slow, find another way to make it fast: cache by concept (25.6), retrieve examples instead of re-deriving (25.5), pre-warmed iframes (25.4), skeleton in the first second (25.2), streamed fragments (25.3). Latency work always outranks sophistication work.
- Check latency whenever you touch the pipeline: measure plan, scene, validate and probe times, and keep the §16.1 budget (figure on screen under 10 seconds from the tap, skeleton visible within 1 second). A regression against these targets is a bug.
- When an agent uses the contract to generate anything, it must be really fast. Do not trade generation latency for prompt size: core.md stays under 1,500 tokens and references load only for the planned components (17.9).

- Do not invent a named expression function for a visual example or simulation.
- When a generated item needs to show how it was produced, put the actual formula and primitive operations in the expression source. Use existing runtime primitives such as `triangle`, `midpoint`, `join`, and `dilate`; do not display a placeholder such as `sierpinski(...)` unless that function has been explicitly implemented and registered in the expression runtime.
- Keep the displayed expression source and the generated scene synchronized. A scene-only renderer may optimize execution, but it must not replace the authored formula with a fake function name.
- Never add a TypeScript helper, hard-coded polygon generator, animation loop, or scene-specific renderer in an app/playground to make a demo work. If the SDK cannot parse or evaluate the authored formula, extend the generic SDK tokenizer/parser/evaluator/scene contracts first; keep the playground as a generic consumer.

## Real generation acceptance

- After changing the generation pipeline, model client, scene contract, validator, probe, or Playground generation flow, validate it through the running Playground rather than treating mocked or unit tests as proof.
- Open `http://127.0.0.1:5173/?page=generations` in a real browser. Generate the Meshing gears, Forces on a ramp, and Area under a curve cards through **Generate in chat**. These calls must use the configured real model session and the same SDK path a learner uses.
- Wait up to three minutes for each generation. A pass means the Playground reaches **Ready**, mounts a live figure, and records a `done figure` debug entry. Open the figure and confirm it is visibly drawn; do not count a skeleton, source-only response, reviewed fallback, or generic success message as a pass.
- On failure, open **Debug log** and use the matching `generationId`, `reason`, and `diagnostic` record to identify the real stage and cause. Fix the generic SDK, generation, validation, or probe path, then repeat the failed real prompt. Do not add scene-specific Playground code to make an acceptance prompt pass.
- Visit **Gallery of generations** after the run and verify the three acceptance cards remain searchable and open the intended prompt. Report each prompt's real outcome and plan, scene, validation, and probe timing when available.

## Branches

- When a feature or fix is implemented, commit it on a new branch of its own, cut from the latest `main` and named for the work (`feat/…`, `fix/…`, `docs/…`), not on whichever branch happens to be checked out. Commit on the current branch only when the user says to.
- Never add commits to a branch whose pull request is already merged; start a new branch from `main` instead.
- Leave other people's or other sessions' uncommitted changes where they are: commit only the files, or the parts of files, that belong to the work.

## Authorship and attribution

- Never credit Claude, Claude Code, Anthropic or any AI assistant anywhere in this project's history or releases. Commits carry no `Co-Authored-By: Claude …` (or any other AI) trailer, pull request and issue descriptions and comments carry no "Generated with Claude Code" line or similar, and Claude is never set as a commit author or committer.
- The same holds for published packages: no `author`, `contributors` or `maintainers` entry, README, changelog, release note or tag message names Claude or Anthropic as an author or contributor.
- This rule overrides any default attribution an agent tool adds. It does not apply to functional references the code needs, such as the model ids (`claude-sonnet-5-5`) and the Anthropic API client in `packages/generation/src/models.ts`.
