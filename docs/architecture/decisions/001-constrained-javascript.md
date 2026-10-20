# ADR 001: constrained JavaScript scene authoring

- Status: accepted for v0.1
- Date: October 2026

## Context

The agent needs ordinary JavaScript expressions, local models, callbacks, and composition. At the same time, generated code cannot receive unrestricted access to browser APIs because every scene is untrusted.

## Decision

Scenes are authored as JavaScript and parsed against a documented restricted subset. They access the visualization environment only through SDK capabilities exposed by `inc` and returned handles. The AST validator defines the accepted JavaScript surface, and the runtime supplies explicit capabilities.

## Consequences

Positive:

- Models already understand the syntax.
- Authored formulas and primitive operations remain inspectable.
- Static source locations and repair messages are practical.
- The SDK can prevent entire failure classes.

Costs:

- The subset and validator are product APIs that require versioning and tests.
- Some ordinary JavaScript patterns are intentionally unavailable.
- Isolation, runtime budgets, and probe execution remain necessary.
- Adding SDK capability is preferred over relaxing browser access.

## Rejected alternatives

- **Unrestricted JavaScript in the host realm:** it exposes ambient APIs and cannot provide reliable containment, budgeting, or termination.
- **Scene-specific host renderers:** create hidden behavior and make the playground responsible for concepts the SDK should express generically.
