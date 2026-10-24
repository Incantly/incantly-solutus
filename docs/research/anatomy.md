# Anatomy reference study

This file records research context. It is not a normative SDK contract.

Sources: the Anatomy skill's page (skills.wheresryan.sh/anatomy) and its repository (github.com/wheresryan22/anatomy, MIT licence, 2026), read in October 2026.

## What Anatomy is

Anatomy is a Claude skill that builds detailed isometric explanatory figures (engines, gauges, machines) as ordinary JavaScript and SVG, with an optional WebGL layer and a beta 3D mode. Claude reads a short `SKILL.md` and opens long-form references (`craft.md`, `kit.md`, `motion.md`, `verify.md`, `3d.md` and others) when it needs them. A drawing kit (`kit/iso-kit`, `lathe.mjs`, `tube.mjs`, `gl.mjs`) does the geometry, and eight complete examples range from a dial gauge of about 300 lines to a Raptor engine.

Its workflow has ten steps: size the figure; collect the real numbers into a small model; invent an object whose mechanism maps onto the idea; list at least forty parts; plan the world and camera; build geometry once and move it; paint back to front, proven by an audit; frame it in a card with a title, a hint and a live readout; make it live with pointer, keyboard and reduced motion; and verify like a critic with screenshots, contact sheets, crops at four times and automatic checks.

### What it costs

| Size | Parts | Time |
| --- | --- | --- |
| Figure | 40 to 80 | 30 to 90 minutes, built without asking |
| Hero | 80 to 150 | 2 to 4 hours, announced first |
| Epic | a whole vehicle, building or plant | 6 hours or more, never started without the user |

Measured active times on its own examples: a watch movement 1 h 54 min, seasons 1 h 57 min, the Raptor engine 10 h 33 min (first working version in 38 minutes), a turbofan 14 hours (first build 4 h 41 min, then five review and fix rounds). Its 3D orbit audit takes 15 to 20 minutes for 30 parts. The time goes into model turns that look at screenshots and fix what they see, which is also where the tokens go: every review round reads images and rewrites code.

### How it checks a figure

- `kit/audit.mjs` proves the geometry: nothing passes through anything, every end sits on a mount, every overlap is drawn in depth order (the Trent 970 audit measured 6,320 overlapping pairs across 541 solids).
- `scripts/lines.mjs` with `line-ends.mjs` fails any line that ends in mid-air.
- `scripts/capture.mjs` takes screenshots and close-ups; `scripts/drive.mjs` runs scripted sessions into slowed-down contact sheets; `turn-check.mjs` and `turn-fidelity.mjs` check 3D figures.
- `scripts/print.mjs` writes three A4 PDFs from a built page: a poster, a drawing with its parts list, and a two-to-four-page handout.
- Five themes (dark, light, paper, blueprint, sepia) and 26 `--anatomy-*` tokens that outside CSS can override.

## The product difference

Incantly has to produce a figure in seconds, inside a learner's note, on the learner's device, from untrusted model output, and keep it working when the note is opened again. Anatomy optimises the opposite end: one spectacular figure, hours of a developer's attention, and a human who reviews the result. So Incantly borrows Anatomy's craft and its discipline of checking, and replaces every step that needs a model to look at pictures with something the SDK does or checks itself.

## What Incantly took, and what it became

| Anatomy | In Incantly |
| --- | --- |
| A short always-read rule set, references opened when needed | One cached block of core rules and the capability catalog (about 1,700 tokens) opens every call. A scene call adds only the type declarations for the capabilities its plan names and one reviewed example ([context.ts](../../packages/generation/src/context.ts)). |
| Size it first: Figure, Hero, Epic | The plan's `size`: quick, standard or rich, each with a budget of lines, output tokens, controls and parts (`SIZE_BUDGETS`). Quick is the default; rich only when the learner asks for that much. |
| Truth first: a small model drives motion and readout | Core rule 1: one model drives everything; every number the learner sees is computed. |
| List the parts | The plan names its parts; the probe fails a scene that does not register each one, and steps point at them. |
| Build geometry once, move it | Core rule 4; the validator rejects elements created inside callbacks. |
| Frame it: title, hint, live readout, no words in the drawing | The SDK owns the card: title, a hint written from what can be dragged, readouts, legend, steps, description. |
| Make it live: pointer, keyboard, reduced motion | The SDK's pointer controller: drags, tracing, zoom, pinch, orbit, arrow-key nudges, reduced motion ([interaction.md](../sdk/interaction.md)). |
| Verify like a critic | A deterministic probe in a hidden sandbox on the learner's device: mount, 60 frames, every parameter at minimum, default and maximum, playing and paused; finite numbers; every element inside its stage, naming the element and the line that drew it; parts, steps, element and frame budgets. It costs no model tokens and takes a fraction of a second. |
| `lines.mjs`: no line ends in mid-air | `stage.connector` and `stage.callout` tie line ends to the elements they join, so they follow them instead of floating. |
| Themes and tokens | Presets including paper, blueprint and sepia, light and dark, and `--inc-*` tokens an integrator sets per editor or per figure ([styling.md](../sdk/styling.md)). |
| Open the closest example first | Retrieval: each reviewed scene lists the words that name it (`match.json`); a request that plainly names one is built from that scene at once. Otherwise the scene call follows the nearest reviewed example. |
| The first figure is a draft; most quality comes from the second look | Adapting and repairing are edits to a scene, never rewrites, and a repair report quotes the failing check, the parameter state and the agent's own line. |
| A kit of drawing helpers grown from examples | Kits loaded on demand (space3d, physics2d, chart, flow) and helpers promoted from repeated scene code: `shapes.resistor`, `path.polyline`, `graph.part`, a later drag replacing an earlier one ([extending.md](../sdk/extending.md)). |

## Where the tokens and seconds went instead

Measured on the [generation bench](../implementation/generation-bench.md) (24 launch requests in two conditions, plans on Haiku, scenes and repairs on Sonnet, thinking off, October 2026; see also [the generation pipeline](../architecture/generation-pipeline.md#speed)):

- A request for a reviewed concept is answered from that scene, adapted by edits beside the plan call. Many replies are one empty edit block, six output tokens, because the reviewed figure already answers the request; the rest are a few edits, at most about 340 tokens. All 24 were approved, half of them in 3.1 seconds or less, the slowest in 6.1.
- A concept the library does not have is written whole, about 1,300 output tokens, following the nearest reviewed example: 23 of 24 approved, half in 15.6 seconds or less, the slowest in 19.2.
- A repair is a few edits, 35 to 220 output tokens, and 1 to 3 seconds.
- A figure the concept cache already holds costs no scene call at all.

Against Anatomy's 30 minutes to 14 hours, the difference is not a faster model. It is that the SDK, not the model, owns the frame, the controls, the interaction, the theme and the checks, so the model writes only the concept: about 60 lines for a quick figure, 100 for a standard one and 150 for a rich one.

## Ideas Incantly does not adopt

- Invented machines standing in for the real phenomenon: Incantly draws the real thing with its real formula and units.
- Figures with dozens or hundreds of decorative parts: a quick figure has up to eight, a rich one sixteen.
- Multi-hour generation and visual review loops, and screenshots read by a model.
- A Node build step at learner request time.
- Trusting a developer to review every generated result: every result is validated and probed instead.
- Anatomy as a runtime dependency. Ideas are reimplemented; no source is copied.

## Next ideas from Anatomy, and where they went

- **Line ends.** Built as an offline check, like `lines.mjs`: in a diagram every plain line must end on a shape, another line, a dot, a label or the stage's edge. It leaves arrows, dashed guides, curves, symbols, floors and tracks alone, runs over every reviewed scene in CI and every approved figure in the evals, and reports rather than fails ([offline checks](../architecture/generation-pipeline.md#offline-checks)).
- **Contact sheets for reviewers.** The playground's gallery page draws every reviewed scene in its sandbox, in light and dark, and the browser checks save each picture with the test results and compare it with its golden image at three widths. Still an idea: one sheet with each parameter at its ends and each step, from the probe's states.
- **A printable handout.** Printing a note prints each live figure as a still of its drawing, as the learner left it, with its description. Still an idea: a page with the figure's states and steps.
- **A growing library.** The community gallery: a figure a learner publishes with its request is reviewed, and an accepted one is promoted to a reviewed scene with match words from its concept, title and request, so the library path covers more requests over time.

## Licensing note

Anatomy is MIT licensed. Incantly reimplements ideas and copies no source; if source is ever reused, keep its copyright and licence notice with it.
