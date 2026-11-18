# Physics: findings

The checker's bugs, ranked by harm. Each review gets one round of fixes. A bug found after that round is added here
with `status: to be implemented` and fixed in a later batch; it does not hold up the merge.

| Id | Found | Where | What | How to see it | Harm | Status |
|---|---|---|---|---|---|---|
| PH-1 | 2026-11-18 | `packages/kernel/bench/` (3D liquid) | The 3D liquid bench is 1.52 ms against a 1.5 ms budget in Node; the same on integration before the soft step | `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts -t "3D liquid"` | low | to be implemented |
