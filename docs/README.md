# Incantly SDK documentation

Incantly turns a concept in a learner's notes into a safe, interactive teaching figure. The AI writes only concept-specific scene code; the SDK owns rendering, controls, interaction, teaching behavior, persistence, and safety.

## Start here

1. [Product vision](product/vision.md)
2. [v0.1 scope](product/v1-scope.md)
3. [Architecture overview](architecture/overview.md)
4. [Vertical-slice implementation](implementation/vertical-slice.md)
5. [Acceptance tests](implementation/acceptance-tests.md)
6. [Claude reference examples](implementation/reference-examples.md)
7. [Installing the SDK in other projects](installing.md): private packages from GitHub Packages, locally and when deploying

## Documentation map

### Product

- [Vision](product/vision.md): problem, users, product principles, and non-goals.
- [v0.1 scope](product/v1-scope.md): the deliberately narrow first release.
- [Success metrics](product/success-metrics.md): what proves the product works.
- [Video figures](product/video-figures.md): plan for narrated, interactive films of 30 seconds to 4 minutes (PRD 28).

### Architecture

- [Overview](architecture/overview.md): shell, engine, generated scene, host, and data flow.
- [Sandbox](architecture/sandbox.md): the trust boundary and restricted JavaScript model.
- [Generation pipeline](architecture/generation-pipeline.md): plan, generate, validate, probe, repair, and fallback.
- [Performance and TipTap integration](architecture/performance-tiptap.md): large-document lifecycle, DOM, events, transactions, measurement, and the 300-figure stress suite.
- [ADR 001](architecture/decisions/001-constrained-javascript.md): validated JavaScript against explicit SDK capabilities.
- [ADR 002](architecture/decisions/002-execution-adapter.md): scene code runs in a Worker inside a sandboxed frame.
- [ADR 003](architecture/decisions/003-javascript-parser.md): the validator parses scene JavaScript with acorn.
- [ADR 004](architecture/decisions/004-expression-evaluator.md): formulas compile to closures through a small Pratt parser.
- [ADR 005](architecture/decisions/005-content-security-policy.md): the figure frame's content security policy.
- [ADR 006](architecture/decisions/006-scene-versioning.md): every stored scene carries SDK and schema versions.
- [ADR 007](architecture/decisions/007-node-storage.md): how a figure is stored in a note, by content reference and outside the undo history.
- [ADR 008](architecture/decisions/008-generation-service.md): the service plans, builds and repairs; the learner's device probes.
- [ADR 009](architecture/decisions/009-film-scene-calls.md) (proposed): a film makes one scene call per scene, in parallel.

### SDK contracts

- [Core](sdk/core.md): state, parameters, lifecycle, controls, timing, and the one-model rule.
- [SVG](sdk/svg.md): the primary rendering layer.
- [Graph 2D](sdk/graph2d.md): the first higher-level visualization component.
- [Teaching](sdk/teaching.md): steps, explanations, descriptions, and pedagogical bounds.
- [Scene subset](sdk/scene-subset.md): the JavaScript, HTML and CSS a scene may use, rule by rule.
- [Styling figures](sdk/styling.md): presets, tokens, Tailwind classes per part, layout, size and shown parts, for every figure or one.
- [Touching the figure](sdk/interaction.md): dragging, tracing, zooming and turning figures with mouse, touch and keyboard.
- [Chemistry](sdk/chemistry.md): atoms, bonds and molecules from formulas, lone pairs, electron shells, reactions acted out with bond energies, and energy profiles.
- [Biology](sdk/biology.md): cells and their organelles, diffusion and active transport across a membrane, DNA's double helix, and flows along vessels.
- [3D models](sdk/models.md): ready-made models with named, labelled pieces and exploded views, models of your own as glTF-style data, and solids of revolution.
- [Extending the SDK](sdk/extending.md): how implementation agents promote repeated patterns into reusable capabilities.

### Delivery

- [Vertical slice](implementation/vertical-slice.md): build order and boundaries.
- [Acceptance tests](implementation/acceptance-tests.md): executable product and engineering expectations.
- [Generation bench](implementation/generation-bench.md): how long learners wait for a figure, measured with real model replies, and how it got there.
- [Reference examples](implementation/reference-examples.md): inspected Claude artifacts and the implementation lessons they establish.
- [Community gallery](implementation/gallery.md): publishing figures with their requests, review, the gallery for learners, and promotion to reviewed scenes.

### Research

- [Anatomy study](research/anatomy.md): ideas borrowed from the reference and ideas deliberately excluded.
- [Prototype findings](research/prototypes.md): practical rules learned from earlier experiments.

## Document ownership

Product files define why and what. Architecture files define system boundaries and decisions. SDK files define public behavior, not implementation details. Implementation files define sequencing and proof. Research files provide context and are not normative.
