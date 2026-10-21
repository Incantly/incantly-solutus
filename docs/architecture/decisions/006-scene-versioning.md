# ADR 006: version every stored scene

- Status: accepted for v0.1
- Date: October 2026

## Context

Approved scenes are stored inside notes and must keep rendering after the SDK changes. The JavaScript subset, the validator rules and the `inc` API are product APIs ([ADR 001](001-constrained-javascript.md)), so a change to any of them can break stored scenes.

## Decision

- Every stored scene records `sdkVersion` (the SDK that approved it, for example `0.1.0`) and `schemaVersion` (the shape of the stored node, starting at `1`).
- The SDK follows semantic versioning for the scene API. A minor version may add calls; removing or changing a call is a major version.
- On mount, the host compares versions:
  - Same major version: mount as is.
  - Older major version: run the registered deterministic migration, then re-validate and re-probe before showing the live figure. Until that passes, show the stored snapshot and text alternative.
  - Newer major version, or no migration: show the snapshot and text alternative, and offer to regenerate.
- Migrations are pure functions from one stored node to the next, tested with recorded fixtures, and kept out of the frame-rendering path.
- Fragments loaded from a note are always validated again before they mount, because paste and import can carry any HTML.

## Consequences

- Old notes never show an empty box: the snapshot and text alternative are always the fallback.
- Changing the API or the validator means writing a migration and a fixture in the same change.
