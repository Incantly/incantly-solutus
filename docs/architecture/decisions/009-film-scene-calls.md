# ADR 009: one scene call per film scene, in parallel

- Status: accepted
- Date: October 2026
- Accepted: 2026-11-04

## Context

A figure is made with one plan call and one scene call, with at most one re-plan and up to three repairs (AGENTS.md, PRD 16.1, RP-4). Scene calls are capped at 6,000, 10,000 or 14,000 tokens by size.

A film ([video figures](../../product/video-figures.md), PRD 28) of 2 to 4 minutes has several scenes, each a figure of its own on its own stage kit. One scene call cannot write them all: the output would be far over any size budget, and the learner would wait for the last scene before seeing the first. Making the scenes one after another would multiply the wait by the number of scenes.

AGENTS.md rejects extra agents and multi-agent planning loops because they add latency and coordination. Parallel scene calls are neither: they do not talk to each other, plan nothing, and review nothing. But they are extra model calls on the generation path, so the rule needs an explicit exception.

Films of one scene (30 s and 1 min) do not need this ADR. They are one plan call and one scene call.

## Decision

- **A film makes one plan call and one scene call per scene.** The plan call returns the storyboard and a shared film context (palette, part names, notation, units, tone). Each scene call receives its slice of the storyboard and the film context in its cached prefix, and is capped by a normal size budget.
- **Scene calls run in parallel** and start as soon as their slice has streamed in. They never see each other's output and never call back to the plan.
- **No other calls are added.** No critic, no reviewer, no film-level planning loop. Each scene has the same re-plan and repair limits as a figure. Narration, compiling, checking and rendering are code, not model calls.
- **Cache and examples first.** Reviewed scenes and the concept cache answer per scene before any model call.
- **The latency target applies to the first scene.** The skeleton within 1 s and the first scene playable within 10 s of the tap, as PRD 16.1. Later scenes join as they pass their checks. The whole film has a deadline per length, set from the bench and within the three-minute generation ceiling.
- **The number of scenes is capped** (bench; about one scene per 30 to 60 s of film), and with it the number of parallel calls and the cost per film.

## Consequences

- Cost per film grows with its number of scenes; the bench reports tokens and dollars per film length, and the cap keeps it bounded.
- Model rate limits are hit by bursts: a 4-minute film may start several scene calls within a second. The service's limits count generations and dollars (`packages/generation/src/limits.ts`); a film counts as one generation, and its scene calls all count towards the learner's daily dollars.
- Scenes made apart can drift in style or naming; the shared film context and per-scene checks are the defence, and a scene that breaks the context fails its check and is repaired alone.
- If the first scene fails all repairs, the film falls back like a figure does; later scenes that pass are kept for a retry.
- AGENTS.md gains one sentence pointing to this ADR once it is accepted.
