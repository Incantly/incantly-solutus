# The scene subset

A generated scene is three fragments: HTML, CSS and JavaScript. Each is validated before it runs, on the server for every generation and again in the browser before a stored scene mounts ([ADR 006](../architecture/decisions/006-scene-versioning.md)). This page is the contract the validator enforces; `packages/core/src/validation` is its implementation and `packages/core/test/fixtures/validator-cases.ts` lists a rejected example and a valid twin for every rule.

Every problem is reported with a stable rule id and a line and column in the agent's own fragment, so a repair prompt can quote it.

## JavaScript

The validator parses with acorn (`ecmaVersion: 2020`, script) and walks the tree with an explicit allow-list. Anything it does not name is rejected.

### Allowed

- `const` and `let`, including destructuring with plain names and defaults.
- Literals (numbers, strings, booleans, `null`), arrays, plain objects, spread, template strings.
- Arrow functions, anywhere a value goes. Not `async`.
- `if`, `switch`, `return`, `break`, `continue` (no labels), the conditional operator, logical and arithmetic operators, optional chaining.
- `for` loops with one `let` counter, a comparison with a visible bound and a fixed step: `for (let i = 0; i < 200; i++)`. The bound is a number up to 5,000, a `const` number, an array's `length`, `Math.min(value, bound)` or one of those plus or minus a number.
- `for...of` over arrays.
- Free names: `inc`, `Math` (without `random`), `Number` (the members in `ALLOWED_NUMBER`), `isFinite`, `isNaN`, `Infinity`, `NaN`, `undefined`.
- SDK calls on `inc` and on the handles it returns, plus plain array, string and number methods.

### Rejected

| Rule | What it catches |
| --- | --- |
| `forbidden-global` | `window`, `document`, `globalThis`, `self`, `parent`, `top`, timers, `requestAnimationFrame`, `addEventListener`, `fetch`, `XMLHttpRequest`, `WebSocket`, storage, `eval`, `Function`, `Worker`, `importScripts` and other ambient names, each with the reason |
| `unknown-global` | any other free name, with a suggestion for typos |
| `unknown-sdk-call` | an `inc`, `inc.path` or `inc.geom` member that does not exist |
| `unknown-method`, `unknown-property` | a method or property a handle does not have; the validator follows the handle type each `const` holds |
| `blocked-property` | `constructor`, `prototype`, `__proto__`, `call`, `apply`, `bind` and the other routes to a function's internals |
| `forbidden-member` | `Math.random`; use `inc.random()`, which is seeded |
| `forbidden-syntax` | `var`, `function`, classes, `this`, `new`, `try`, `throw`, regular expressions, `delete`, `in`, `instanceof`, getters and setters, labels, dynamic `import`, `async` and `await` |
| `unbounded-loop` | `while`, `do...while`, `for...in`, and `for` loops without a visible bound or with a step that moves away from it |
| `loop-variable-assigned` | changing a loop counter inside its loop |
| `recursion` | a function that calls itself, directly or through other named functions |
| `mount-only` | `inc.param`, `inc.model`, `inc.onFrame`, `inc.steps` and the other declarations inside a function |
| `element-in-frame` | creating elements inside a callback that runs every frame or on every change |
| `assign-global`, `assign-const`, `assign-sdk` | assigning to an undeclared name, a `const`, or SDK objects |
| `hard-coded-colour`, `unknown-tone` | literal colours in strings; tones other than `lo`, `mid`, `hi`, `lit`, `faint`, `a`, `b`, `c` |
| `stage-selector`, `missing-stage-host`, `no-stage` | stage hosts must be literal ids that exist in the HTML, and a scene must draw |
| `too-many-params` | more than three parameters |
| `budget-size`, `budget-ast`, `budget-depth`, `budget-string` | 16,000 characters, 6,000 syntax nodes, 24 levels of nesting, 600-character strings |
| `reserved-name` | redeclaring `inc`, `Math` or another provided name, or any name starting with `__inc` |
| `number-in-text` (warning) | a typed decimal number in a readout, explanation or description; compute it from the model instead |

### At run time

Validated code is instrumented before it reaches the Worker. Every loop body and function body burns one unit of fuel, and the Worker refuels before each message (250,000 units), so a loop that never ends fails within milliseconds as a `runaway` error instead of freezing the figure. Every computed property key passes a guard that admits numbers and strings other than the blocked names. Text is only inserted, never on a new line, so errors still point at the agent's own line and column.

## HTML

A small structural fragment: containers for stages and short text.

- Elements: `div`, `span`, `p`, `section`, `strong`, `em`, `b`, `i`, `small`, `sub`, `sup`, `br`, `code`, `abbr`, `ul`, `ol`, `li`, `figure`, `figcaption`, `hr`.
- Attributes: `id`, `class`, `title`, `lang`, `dir`, `role` (`group`, `note`, `presentation`, `none`), `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-hidden`, `hidden`, `data-*`, and `start` on `ol`.
- Ids start with a letter and never with `inc`; classes never start with `inc-`. Those names belong to the engine.
- No scripts, styles, links, meta, base, images, media, canvas, inline SVG, forms, inputs, buttons, frames, event attributes, inline styles or URLs.
- Elements close in order; text-level elements hold only text-level content; at most 120 elements and 12 levels.

A passing fragment is re-serialized from its parsed tree. The frame receives that canonical HTML, never the original text.

## CSS

Layout and typography for the scene's own HTML, reading the theme tokens.

- Selectors: the allowed elements plus the SVG element names, classes, ids, attribute selectors, combinators and a short list of pseudo-classes (`:hover`, `:focus`, `:focus-visible`, `:first-child`, `:nth-child()`, `:not()`, `:is()` and similar). Not `html`, `body`, `:root`, pseudo-elements, or the engine's `inc-` classes and ids.
- Properties: an allow-list of layout, spacing, typography, border, opacity, transform, transition and SVG paint properties. Not `filter`, `backdrop-filter`, masks, shadows, blend modes, animations, `content` or fonts.
- Values: theme tokens through `var(--inc-…)`, numbers with ordinary units, `calc()`, `min()`, `max()`, `clamp()`, grid functions and transform functions. No literal colours (hex, named, or colour functions), no `url()` or other loading functions, no strings, no `!important`, no `position: fixed` or `sticky`.
- At-rules: only `@media` with width, reduced-motion, colour-scheme, pointer, hover or orientation features. Custom properties may be defined, but never `--inc-*`.
- No `<`, escapes, or characters outside ASCII outside strings and comments. The CSS goes into the frame verbatim and is allowed by its hash.
