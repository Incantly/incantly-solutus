---
inclusion: always
---

# Tech

## Stack

- **Language:** TypeScript, strict, ES2022 modules. Node 22.12 or later.
- **Monorepo:** npm workspaces (`packages/*`, `apps/*`).
- **Build and dev server:** Vite.
- **Tests:** Vitest, with happy-dom for UI components.
- **Lint and types:** ESLint with typescript-eslint, `tsc` project references.
- **UI:** plain TypeScript Web Components (no React), so they drop into any framework.
- **Rendering:** our own 2D and 3D renderer on WebGL 2 (WebGPU later), with SVG and Canvas 2D fallbacks.
- **AI:** Muse Spark, called only from `packages/server`, so API keys never reach the browser.

Core packages (`kernel`, `plot`, `symbolic`, `modes`, `view/src/core`) have no DOM, timers, network or `Date`. They run in Node, a worker and on mobile.

## Allowed libraries

Only these, from `docs/design/libraries.md`. Adding any other library needs the product owner's approval first.

| Library | Licence | Used for | Package |
|---|---|---|---|
| decimal.js | MIT | High-precision numbers | `symbolic` |
| KaTeX | MIT | Maths in texts and labels | `view`, `ui` |
| MathLive | MIT | Maths input field and keyboard | `ui` |
| Delaunator | ISC | Triangulation, Voronoi, meshes | `kernel` |
| robust-predicates | Unlicense | Exact geometry tests | `kernel` |
| polygon-clipping | MIT | Polygon union, intersection, difference | `kernel` |
| Manifold | Apache-2.0 | Boolean operations on solids (WebAssembly) | `view`, on demand |
| Tone.js | MIT | Sound | `audio`, on demand |
| Tiptap | MIT | Editor the figure extension plugs into (peer dependency) | `tiptap` |

Test only, never shipped: Nerdamer Prime (MIT), Algebrite (MIT), Compute Engine (MIT), mathjs (Apache-2.0).

Not used: three.js, d3 and other scene libraries; Giac (GPL-3); any code or asset of the reference app.

Dev tools already in the repo: TypeScript, Vite, Vitest, ESLint, typescript-eslint, happy-dom, `@types/node`, globals.

## Commands

```sh
npm install        # install all workspaces
npm run check      # lint, typecheck and all tests; must pass before a change is done
npm run studio     # the web app (Vite dev server) at http://127.0.0.1:5173
npm run lint       # ESLint only
npm run typecheck  # tsc only
npm test           # Vitest only
npm run bench      # benchmarks
```
