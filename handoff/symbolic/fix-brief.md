# Fixer brief (Incantly): make the renderer pass the gates

You are a FIXER for the `symbolic` area (packages/symbolic). A builder wrote this package without a shell, so it has never been compiled or linted. Read `AGENTS.md`, `handoff/symbolic/builder-notes.md`, `docs/features/cas/design.md`, `docs/design/libraries.md` and `docs/design/performance.md` first.

## Job

1. Run `npx tsc -p tsconfig.json` and `npx eslint .` from the repo root. Fix every error in `packages/symbolic/` (about 52 type errors). Also install `decimal.js` (allowed in libraries.md) into the package with `npm install decimal.js --workspace packages/symbolic` and wire the exact numeric path the builder left behind its `toDecimal` interface. Fix the real cause; do not silence rules with disable comments or `any`.
2. Vitest 5 in this repo has no `bench` export. Rewrite `packages/symbolic/bench/cas.bench.ts` as a plain script with `performance.now()` that prints timings, so it typechecks and can be run with `npx tsx` or `node` later. Do not add a bench runner to the repo.
3. Run `npx vitest run`: all existing tests must still pass.
4. Measure the speed numbers in the builder notes with your bench script where you can, and replace the estimates with measured numbers, saying how you measured.
5. Add a 'Gate fixes' section to `handoff/symbolic/builder-notes.md`: what you fixed and why.

Write only under `packages/symbolic/` and `handoff/symbolic/`. Write no tests.
## Shell rules (you have a real terminal; these are hard rules)

Allowed:
- `npx tsc`, `npx eslint`, `npx vitest`, `npm run <script>` from the repo root.
- `npm install <pkg> --workspace packages/<package>`, only for a library listed as allowed in `docs/design/libraries.md`.
- `git status`, `git diff`, `git log`, `git add <your paths>`, `git commit`.
- Reading any file in this repository; small probe scripts inside your own paths that you delete before committing.

Never:
- `git push`, `git pull`, `git fetch`, `git merge`, `git rebase`, `git reset`, `git checkout` or `git switch` of another branch, `git stash`, `git branch -D`, `git worktree`, `git config`, or any `--no-verify`.
- Anything touching `main`, `master`, `legacy/v1` or `integration`.
- `rm -rf`, deleting files outside your own paths, or writing outside this repository.
- `sudo`, changing system settings, reading credentials (`~/.ssh`, `~/.aws`, `.env`, tokens), or `gh` commands.
- Network calls other than `npm install` of an allowed library: no `curl`, `wget`, or uploads.
- Long-running servers or watchers (`vite dev`, `vitest --watch`).

If a task seems to need anything on the "Never" list, stop and write it in your notes under "Needs the integrator".

## Saving work

- Commit after each major part with a clear message. Stage only your own paths with `git add <paths>`.
- The integrator pushes your branch. You do not push.
- Use the file tools to write files. Avoid very large shell heredocs.
- Before you stop, run `npx eslint .`, `npx tsc -p tsconfig.json` and `npx vitest run` from the repo root. All existing tests must still pass, and lint and typecheck must be clean. Your last message must say the commits and whether these pass.

## Extra permission for this run

Installing decimal.js changes `package-lock.json` at the repo root. You may stage and commit `package-lock.json` together with `packages/symbolic/package.json` for that one change.
