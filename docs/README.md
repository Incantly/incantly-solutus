# Incantly SDK documentation

Incantly turns a concept in a learner's notes into a safe, interactive teaching figure. The AI writes only concept-specific scene code; the SDK owns rendering, controls, interaction, teaching behavior, persistence, and safety.

## Start here

1. [Product vision](product/vision.md)
2. [v0.1 scope](product/v1-scope.md)
3. [Architecture overview](architecture/overview.md)
4. [Vertical-slice implementation](implementation/vertical-slice.md)
5. [Acceptance tests](implementation/acceptance-tests.md)
6. [Claude reference examples](implementation/reference-examples.md)

## Documentation map

### Product

- [Vision](product/vision.md): problem, users, product principles, and non-goals.
- [v0.1 scope](product/v1-scope.md): the deliberately narrow first release.
- [Success metrics](product/success-metrics.md): what proves the product works.

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

### SDK contracts

- [Core](sdk/core.md): state, parameters, lifecycle, controls, timing, and the one-model rule.
- [SVG](sdk/svg.md): the primary rendering layer.
- [Graph 2D](sdk/graph2d.md): the first higher-level visualization component.
- [Teaching](sdk/teaching.md): steps, explanations, descriptions, and pedagogical bounds.
- [Scene subset](sdk/scene-subset.md): the JavaScript, HTML and CSS a scene may use, rule by rule.
- [Extending the SDK](sdk/extending.md): how implementation agents promote repeated patterns into reusable capabilities.

### Delivery

- [Vertical slice](implementation/vertical-slice.md): build order and boundaries.
- [Acceptance tests](implementation/acceptance-tests.md): executable product and engineering expectations.
- [Reference examples](implementation/reference-examples.md): inspected Claude artifacts and the implementation lessons they establish.

### Research

- [Anatomy study](research/anatomy.md): ideas borrowed from the reference and ideas deliberately excluded.
- [Prototype findings](research/prototypes.md): practical rules learned from earlier experiments.

## Document ownership

Product files define why and what. Architecture files define system boundaries and decisions. SDK files define public behavior, not implementation details. Implementation files define sequencing and proof. Research files provide context and are not normative.
