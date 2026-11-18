# Physics research: liquids, smoke, cloth, bodies and speed on the web

Research notes from 2026-11-18, gathered with Firecrawl (its paper index and web search), checked against our code in
`packages/kernel/src/physics/` and `packages/sdk/src/screen/`. The papers are summarised in our own words; read the
sources for the details. Nothing here is decided: each change still needs a docs and spec update before code.

## 1. Where we stand

| Area | Our method | What is wrong or missing |
|---|---|---|
| 2D liquid look | Each drop drawn as its own circle (`packages/sdk/src/screen/physics.ts`, the liquid painter) | It looks like small balls, not water |
| Liquid physics (2D and 3D) | Position-based fluids, 2 density passes a step, XSPH viscosity | No anti-clumping term, no swirl term, no surface tension, too few passes for tall piles |
| Smoke (2D) | Stable fluids (Stam) on a staggered grid, 20 over-relaxed pressure passes | No swirls (vorticity confinement), carrying along the flow smears, no diffusion step, no 3D smoke |
| Waves | Height grid, wave equation | Fine for now |
| Cloth | XPBD, 4 small steps a world step | Two cloths 12.4 ms a frame in Chrome with the CPU 4× slower (limit 10) |
| 2D bodies | Sequential impulses, Box2D v2 style (block solver, speculative contacts, position passes) | Fixed 2026-11-18: dropped stacks never slept (section 6). Tall ball columns still breathe for about 10 s |
| 3D bodies | Sequential impulses, 4-point faces | Slow frames when many boxes land (10 to 14 ms for 500 boxes); a tower sways about 10 s |

## 2. Liquids

| Paper | Source | What it gives us |
|---|---|---|
| Position Based Fluids (Macklin and Müller, 2013) | [preprint](https://mmacklin.com/pbf_sig_preprint.pdf) | The method we use. Its artificial pressure term stops drops clumping and gives a light surface pull; its vorticity confinement puts back swirls. We have neither. |
| Versatile Surface Tension and Adhesion for SPH Fluids (Akinci et al., 2013) | [paper](https://cg.informatik.uni-freiburg.de/publications/2013_SIGGRAPHASIA_surfaceTensionAdhesion.pdf) | Cohesion plus curvature reduction: drops pull into round blobs and merge; adhesion makes water cling to walls and cloth. Fixes water spreading too thin and spilling. |
| Accelerating Surface Tension Calculation in SPH (Zorilla et al., 2019) | [arXiv 1912.01942](https://arxiv.org/abs/1912.01942) | Works out the pull only on surface drops, so surface tension costs less |
| Adaptive Position-Based Fluids (Köster and Krüger, 2016) | [arXiv 1608.04721](https://arxiv.org/abs/1608.04721) | Each drop gets as many solver passes as it needs, so calm water costs less |
| Small Steps in Physics Simulation (Macklin et al., 2019) | [paper](https://mmacklin.com/smallsteps.pdf) | Several small steps with one pass each beat one step with many passes. For the liquid: stiffer water for the same cost. |
| Droplet Simulations in Computer Graphics (survey, 2024) | [arXiv 2411.15880](https://arxiv.org/abs/2411.15880) | Overview of surface tension and free-surface methods for drops |
| Cell-Constrained Particles for Incompressible Fluids (Levi, 2024) | [arXiv 2402.17088](https://arxiv.org/abs/2402.17088) | Keeps volume strictly (100 to 102%) with a per-cell limit; heavier, for later |
| MLS-MPM (Hu et al., 2018) | [project page](https://yuanming.taichi.graphics/publication/2018-mlsmpm/) | A different method (particles plus a grid), very liquid-like, short to write. A fallback if PBF stays poor. |

### Drawing the liquid

| Method | Source | Use |
|---|---|---|
| Screen space fluid rendering with curvature flow (van der Laan et al., 2009) | [ACM](https://dl.acm.org/doi/10.1145/1507149.1507164) | 3D: draw the drops' depth, smooth it, shade it as a surface, in WebGL 2. About 1 to 2 ms on the GPU. |
| Metaballs or marching squares over the drops' field | standard method | 2D: one smooth outline round the drops, so they read as one body of water |

Both are drawing only, so the film stays exact.

## 3. Smoke

| Paper | Source | What it gives us |
|---|---|---|
| Real-Time Fluid Dynamics for Games (Stam, 2003) | [PDF](https://graphics.cs.cmu.edu/nsp/course/15-464/Fall09/papers/StamFluidforGames.pdf) | Add sources, diffuse, carry along the flow (back-tracing), project. We do all of it except diffusion, with a better pressure solve (his: 20 plain Gauss–Seidel passes). He names the method's weakness: the flow loses energy too fast, and points to vorticity confinement. |
| Visual Simulation of Smoke (Fedkiw, Stam and Jensen, 2001) | [ACM](https://dl.acm.org/doi/10.1145/383259.383260) | Vorticity confinement: keeps curls and eddies |
| An Unconditionally Stable MacCormack Method (Selle et al., 2008) | not fetched | Sharper carrying along the flow, less smearing |

## 4. Cloth and speed on the web

| Paper | Source | What it says |
|---|---|---|
| Real-Time Cloth Simulation Using WebGPU (2025) | [arXiv 2507.11794](https://arxiv.org/abs/2507.11794) | WebGPU held 60 fps up to its 640K-node memory limit; WebGL struggled beyond about 10K nodes. GPU float results differ between makers, so this does not fit our exact replay for the physics itself. |
| Principles towards Real-Time MPM on Modern GPUs (2021) | [arXiv 2111.00699](https://arxiv.org/abs/2111.00699) | For small real-time scenes, memory access and syncing cost more than the maths |
| MGPBD: Multigrid Accelerated Global XPBD (2025) | [arXiv 2505.13390](https://arxiv.org/abs/2505.13390) | A faster global solve for stiff cloth; for later |

Conclusion so far: Rust compiled to WebAssembly for the solvers that decide the film (cloth, liquid, 3D smoke), the GPU
only for drawing.

## 5. Rigid bodies: our engine against Box2D v3, Rapier and Jolt

All four have web builds on npm: `box2d3-wasm` 6.0 (MIT), `@dimforge/rapier2d-deterministic-compat` and
`rapier3d-deterministic-compat` 0.21 (Apache-2.0, a build that gives the same result on every computer), `jolt-physics`
1.1 (MIT). They were installed in a scratch folder for these runs, not in the repo, and are not on
`docs/design/libraries.md`.

Same scenes in each engine, Node on this Mac, a frame = two steps of 1/120 s, 6 s of film after 0.5 s, friction 0.6,
Rapier at 8 solver passes, Box2D at its default 4 sub-steps. Milliseconds: mean / slow frames (95%) / worst.

### 2D, bounce 0.2 in every engine, after the fix in section 6

| Scene | Ours | Box2D v3 | Rapier |
|---|---|---|---|
| 100 boxes into a pile | 0.14 / 0.41 / 0.98 | 0.04 / 0.22 / 0.28 | 0.13 / 0.47 / 0.68 |
| 300 boxes | 0.36 / 0.98 / 1.61 | 0.05 / 0.29 / 0.41 | 0.32 / 1.22 / 1.60 |
| 500 boxes | 0.60 / 1.59 / 3.44 | 0.08 / 0.47 / 0.69 | 0.49 / 1.84 / 2.07 |
| 2,000 balls | 4.84 / 7.77 / 9.90 (never slept in 6 s) | 0.85 / 2.40 / 2.92 | 3.11 / 6.48 / 24.79 |
| Tower of 20 boxes, drift of the top | 0.00 mm | 5.42 mm | 0.00 mm |

Before the fix, ours was 0.36, 1.10 and 1.87 ms for the three piles, and none of them slept.

### 3D, bounce 0 in every engine

| Scene | Ours | Rapier | Jolt |
|---|---|---|---|
| 50 boxes into a pile | 0.16 / 1.01 / 2.81 | 0.08 / 0.37 / 1.01 | 0.02 / 0.03 / 0.38 |
| 100 boxes | 0.37 / 1.83 / 2.13 | 0.11 / 0.91 / 0.99 | 0.03 / 0.20 / 0.74 |
| 200 boxes | 0.48 / 3.39 / 7.49 | 0.18 / 0.41 / 1.69 | 0.05 / 0.01 / 1.25 |
| 500 boxes | 1.55 / 8.98 / 9.52 | 0.46 / 2.36 / 4.29 | 0.13 / 0.01 / 3.22 |
| Tower of 10 boxes, drift of the top | 8.1 mm (still awake after 6 s) | 9.5 mm | 22.4 mm |

Still to check before choosing an engine: the same film on every computer (Rapier's build promises it; Box2D v3 claims
it; unknown for this Jolt build), Chrome with the CPU slowed 4×, and what our features (force arrows by kind, `on b hit`,
the input log, seek) cost on top.

### Solver research for bodies

| Source | What it gives us |
|---|---|
| [Solver2D (Catto, 2024)](https://box2d.org/posts/2024/02/solver2d/) | Eight solvers compared on stacks, piles and joints; "soft step" (small steps, soft contacts, a relax pass and a separate bounce pass) came out steadiest. Box2D v3 uses it. Candidate for our 2D and 3D solvers. |
| Small Steps (Macklin et al., 2019) | Same idea from the position-based side |

## 6. The 2D stacking fix (2026-11-18)

Found while comparing engines: our 2D piles never fell asleep, while the other engines' piles did.

- **Cause.** A box landing flat touches with two points. The bounce (default 0.2) was applied one point after the other,
  so the first point took the whole bounce and the second little: each landing set the box spinning. A dropped tower of
  20 tilted about 0.1 rad at the top and walked 0.75 m sideways in 10 s; nothing ever slowed below the sleep speed.
- **Fix.** Both points of a face bounce in one block solve, as the velocity passes already did
  (`World2.blockTo`). The dropped tower now stands within 2 mm and sleeps by 3 s; piles of 100 to 500 sleep.
- **Tests.** `packages/kernel/test/spec/physics-bodies.test.ts`: a dropped tower of 20 stands and sleeps, a pile of 100
  sleeps within 5 s. The far-seek test now keeps its pile awake with `world with sleep = false`, since a pile that sleeps
  catches up at once.
- **Still open.** Tall columns of balls (50 high) breathe for about 10 s before sleeping; 3D towers of touching boxes
  sway for about 10 s (3D has no block solve for four points). Both point to the soft-step solver.
