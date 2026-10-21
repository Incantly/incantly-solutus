# Agent implementation rules

## Generation speed is a first-class requirement (read before touching generation)

- Implement the PRD (`docs/Incantly SDK Product Requirements Document (1).md`) from start to finish. Every requirement gets done, nothing is left "in progress" at the end of a run; if a slice is impossible, say so in the final message instead of leaving silent gaps.
- Do NOT add a third agent or any multi-agent planning loop. Three agents doing the planning is too slow and it is rejected by design: the pipeline is exactly one plan call (small fast model, ~150 tokens out, target under 2 s) plus one scene call (streamed, target under 6 s), with at most one re-plan and one repair. Never add extra model round-trips on the generation path.
- If planning or generation style becomes slow, find another way to make it fast: cache by concept (25.6), retrieve examples instead of re-deriving (25.5), pre-warmed iframes (25.4), skeleton in the first second (25.2), streamed fragments (25.3). Latency work always outranks sophistication work.
- Check latency whenever you touch the pipeline: measure plan, scene, validate and probe times, and keep the §16.1 budget (figure on screen under 10 seconds from the tap, skeleton visible within 1 second). A regression against these targets is a bug.
- When an agent uses the contract to generate anything, it must be really fast. Do not trade generation latency for prompt size: core.md stays under 1,500 tokens and references load only for the planned components (17.9).

- Do not invent a named expression function for a visual example or simulation.
- When a generated item needs to show how it was produced, put the actual formula and primitive operations in the expression source. Use existing runtime primitives such as `triangle`, `midpoint`, `join`, and `dilate`; do not display a placeholder such as `sierpinski(...)` unless that function has been explicitly implemented and registered in the expression runtime.
- Keep the displayed expression source and the generated scene synchronized. A scene-only renderer may optimize execution, but it must not replace the authored formula with a fake function name.
- Never add a TypeScript helper, hard-coded polygon generator, animation loop, or scene-specific renderer in an app/playground to make a demo work. If the SDK cannot parse or evaluate the authored formula, extend the generic SDK tokenizer/parser/evaluator/scene contracts first; keep the playground as a generic consumer.
