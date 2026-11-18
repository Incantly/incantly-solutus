# Third-party libraries

Libraries the engine may depend on, with licences checked on 2026-11-10 against each repository's licence record on GitHub. Every licence below allows commercial use. Before adding a library, check its licence again at the version we pin, and keep its notice file in our distribution.

Rule: our own code does the core maths (kernel, language, numeric methods, symbolic layer). A library is used where it does a well-bounded job better than we would, or as a test oracle that never ships.

## Ship in the product

| Library | Licence | Job | Package |
|---|---|---|---|
| [decimal.js](https://github.com/MikeMcl/decimal.js) | MIT | High-precision numbers for exact display and the symbolic layer | `symbolic` |
| [KaTeX](https://github.com/KaTeX/KaTeX) | MIT | Rendering maths in texts and labels | `view`, `ui` |
| [MathLive](https://github.com/arnog/mathlive) | MIT | The maths input field and on-screen maths keyboard | `ui` |
| [Delaunator](https://github.com/mapbox/delaunator) | ISC | Triangulation for `DelaunayTriangulation`, Voronoi and meshes | `kernel` (discrete) |
| [robust-predicates](https://github.com/mourner/robust-predicates) | Unlicense | Exact orientation and in-circle tests for geometry | `kernel` (geometry) |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | MIT | Union, intersection and difference of polygons, including holes | `kernel` (polygons) |
| [Manifold](https://github.com/elalish/manifold) | Apache-2.0 | Boolean operations on solids (cut, union, difference), as WebAssembly | `view` (3D), loaded on demand |
| [Tone.js](https://github.com/Tonejs/Tone.js) | MIT | Sound: synths, noise, envelopes, scheduling on the audio clock | `audio`, loaded on demand |
| [Tiptap](https://github.com/ueberdosis/tiptap) | MIT | The editor our figure extension plugs into (peer dependency, not bundled) | `tiptap` |

The renderer, for 2D and 3D, is our own (`docs/design/performance.md`). We do not use three.js or any other scene library: the renderer must also run on mobile, so it is written against a small GPU interface we control.

Apache-2.0 asks us to keep its licence and notice files and to mark changes we make to its code. We do not change Manifold's code.

## Dev and test only (never shipped)

| Library | Licence | Job |
|---|---|---|
| [Nerdamer Prime](https://github.com/together-science/nerdamer-prime) | MIT | Cross-check our symbolic results in tests |
| [Algebrite](https://github.com/davidedc/Algebrite) | MIT (licence file read) | Second cross-check for integrals, factoring and roots |
| [Compute Engine](https://github.com/cortex-js/compute-engine) | MIT | Cross-check LaTeX parsing; may ship later if MathLive needs it |
| [mathjs](https://github.com/josdejong/mathjs) | Apache-2.0 | Cross-check numeric functions, matrices and units |

## Build tools

| Tool | Job |
|---|---|
| Rust (`rustc`, `cargo`, the `wasm32-unknown-unknown` target), no crates | Builds `packages/kernel/src/physics/wasm/kernels-wasm.ts` from `packages/kernel/wasm/src/lib.rs` with `npm run build:wasm` (physics design 11.6, approved by the product owner on 2026-11-18). The generated file is committed with the SHA-256 of its bytes in its header, so the repository, CI and every other developer need no Rust; `node packages/kernel/wasm/build.mjs --check` tells whether it matches the source. The crate has no dependencies (`Cargo.lock` lists only itself), so nothing here ships a third-party licence. |

## Not used

| Library | Licence | Why |
|---|---|---|
| Giac | GPL-3 | Would force our whole product under GPL |
| three.js, d3 and other scene or chart libraries | MIT | We build the renderer ourselves so it runs the same on web and mobile |
| Nerdamer (original, `jiggzson/nerdamer`) | Apache-2.0 | Superseded by the maintained Nerdamer Prime fork |
| Any code or asset of the reference app | EUPL 1.2, non-commercial terms | We learn from it only |

## Corrections to the feature studies

- `docs/features/cas/design.md` listed Algebrite's licence as unconfirmed and Compute Engine's as "from search results". Both are MIT, as above.
- The original Nerdamer is Apache-2.0. The MIT licence the CAS study names belongs to the Nerdamer Prime fork, which is the one we use.
