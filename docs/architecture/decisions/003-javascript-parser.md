# ADR 003: validate scene JavaScript with acorn

- Status: accepted for v0.1
- Date: October 2026

## Context

[ADR 001](001-constrained-javascript.md) makes the restricted JavaScript subset a product API. The validator must parse every fragment into a syntax tree, reject everything outside the subset, and report problems in fragment-relative lines and columns so the repair prompt can quote them. It runs on the server for every generation and again in the browser before a stored scene mounts.

## Decision

Use [acorn](https://github.com/acornjs/acorn), pinned to an exact version.

- Parse as a script with `ecmaVersion: 2020` and `locations: true`.
- The same build runs in Node and in the browser.
- The validator walks the ESTree syntax tree itself, with one `switch` per node kind: any node type it does not handle is rejected. acorn-walk is not used, because a generic walker visits node types the allow-list never names.

## Consequences

- acorn is small, MIT licensed, dependency-free and returns a standard ESTree syntax tree.
- Locations are off by default in acorn, so the validator always passes `locations: true`.
- Capping `ecmaVersion` keeps newer syntax out of scenes until the validator handles it.

## Rejected alternatives

- **Regular expressions:** cannot validate a language.
- **@babel/parser:** larger, and its ESTree output needs a plugin.
- **oxc-parser or swc:** faster native parsers, but heavy WebAssembly builds for the browser. oxc's syntax tree matches acorn's, so it remains an option if validation speed ever matters.
