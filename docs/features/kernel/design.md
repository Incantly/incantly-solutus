# Kernel: objects, rules, update, undo, steps and saving

Area owner: core kernel. Fits `docs/design/formula-language-and-kernel.md` (sections 2, 4, 5, 9, 11). Companion files in this folder: `errors.md`, `agent.md`, `ui.md`. The app-wide error system is in `../errors/`.

The kernel is the part of Incantly that holds the figure. It knows nothing about screens, fonts or pointers. Every other area (geometry, functions, transforms, lists, particles, physics, the view) plugs rules and object types into it and reads values and events out of it.

---

## 1. What the kernel does for people

### For the learner

- Every object on screen is something they can name, point at and ask "how was this made?". Free objects can be dragged; dependent ones follow.
- A step-by-step build list (our counterpart of the construction protocol) shows how the figure was made, in order, and lets them scrub forwards and backwards to see it appear.
- Undo and redo work on what they did, one gesture at a time (a whole drag is one undo step).
- An object whose inputs make no sense (two parallel lines meeting) shows as "undefined" with a reason, not as a crash or a silent disappearance.
- Properties (colour, layer, "show only when...", fixed) change how things look and behave without changing the maths.

### For the teacher (the live AI voice)

- Each spoken sentence maps to one to five lines. Each line is applied or rejected on its own, in under a millisecond.
- After every line the kernel reports exactly what changed: objects added, redefined, deleted, which became undefined and why. The teacher narrates from that report, never from what it intended.
- `Undo()` lets the teacher take back its last utterance cleanly.
- The teacher can ask "what depends on `A`?" and "what does `M` depend on?" before it deletes or redefines anything.

### For the author (a person writing a script)

- A figure is a script. Loading the script rebuilds the same figure. Reading the script tells you how it was built.

---

## 2. Everything the kernel offers (full list)

Manual pages covered: Objects, Object Properties, Construction Protocol, Redefine, Layers, Conditional Visibility, Dynamic Colors, Fixed/auxiliary objects, Naming, Undo/Redo, Saving. Here is each sub-feature with our form.

| Sub-feature | Our form |
|---|---|
| Create a free object | `A = (1, 2)`, `a = 3`, `a = 3 in 0..10 step 0.5`, `flag = true`, `s = "text"` |
| Create a dependent object | `M = Midpoint(A, B)`, `h = sqrt(a^2 + b^2)` |
| Redefine in place | `A = (4, 4)`, `M = Midpoint(A, C)`; keeps id, style, position in lists |
| Free to dependent and back | `A = Midpoint(B, C)` then `A = (1, 1)` (same type only) |
| Delete with cascade | `Delete(A)`; result lists everything removed |
| Rename | `Rename(A, P)` (new action, section 14) |
| Style and properties | `A with color = red, layer = 3`; full table in section 9 |
| Visibility | `Show(A)`, `Hide(A)`, or `with visible = false` |
| Fixed | `A with fixed = true` |
| Selection allowed | `A with selectable = false` |
| Auxiliary | `A with aux = true` |
| Layers 0 to 9 | `A with layer = 4` |
| Condition to show | `A with showIf = (a < 2)` |
| Dynamic colour | `A with color = rgb(255 * a, 0, 128)`, `with color = hsl(360 * x(A) / 10, 1, 0.5)`, `with opacity = a` |
| Undo, redo | `Undo()`, `Redo()`, learner buttons; one step per line, per `draw` call, per gesture |
| Build list ("protocol") | `figure.steps()`; each step is one object, with grouped breakpoints from `@step` lines |
| Step replay | `figure.stepTo(n)` reveals the first `n` steps without recomputing |
| Save | `figure.toScript()`; a text file of lines |
| Load | `Figure.fromScript(text)`; per-line results, never half-loaded silently |
| Query | `figure` tool, `Describe(obj)`, `DependsOn(obj)`, `Uses(obj)` (section 14) |
| Undefined with reason | automatic; reason codes in section 6 |
| Animation of free values | sliders run on the clock (section 10); belongs with the clock owner, hooks here |

---

## 3. How the reference app does it (in plain words)

- **Model.** Every object is a node with a value. A dependent object has one parent "algorithm" that reads input objects and writes one or more output objects. All objects and all algorithms sit in one construction list, in creation order. That order is always a valid dependency order.
- **Lookup tables.** Names map to objects in a hash table; there is also a set per object class and a set ordered by label. Several sets mean every add and delete touches several structures.
- **Downstream sets.** Each object keeps a sorted set of algorithms that depend on it, directly or indirectly. Dragging a free point runs that set once, in order. Moving many things at once (animation, undo load) merges the sets.
- **Always recomputes.** Every algorithm in the set runs even if its inputs did not change in value. There is no early stop when an output comes out equal.
- **Redefinition.** The simple cases (same text, or an object with no children) are done in place. The general case is heavy: the program writes the whole construction out as XML text, edits the text to replace one object, and rebuilds the entire construction from the text. Selection, views and listeners are saved and restored around it. A circular redefinition is detected before this step by asking whether the new object depends on the old one; a few self-references (`a = a + 1`) are special-cased as "set the value".
- **Delete.** Deleting an object first deletes all algorithms that read it, which delete their outputs, recursively. Group members are deleted together. Views are told after the removal.
- **Undo.** Historically a stack of whole-construction XML snapshots (capped at 100). Newer code adds a list of small actions (style change, content change, order change) that are replayed on top of the last snapshot, and "stitching" so several entries undo together. Undo restores by reloading a snapshot, so ids are not stable across undo.
- **Construction protocol.** A table over the construction list: number, name, definition, value, breakpoint flag. A cursor ("step") hides everything after it by sending remove notifications to the views, and re-adds on the way forward. You can drag rows to reorder when dependencies allow, delete a row (which cascades), or insert at a position. Breakpoints group several objects into one stop.
- **Save and load.** Free objects store a value; dependent ones store their command or formula plus style, in an XML document. Loading replays the construction, then updates everything once.
- **Properties.** One big base object carries all of them: label and caption, colour (static or three or four formulas for red, green, blue, opacity, in RGB, HSV or HSL), line and point styles, fill pattern, layer (0 to 9, with a rule that new objects join the highest layer in use), fixed, selection allowed, auxiliary, condition to show, trace, tooltip, scripts. The condition and the colour formulas are themselves objects (a Boolean and a list of numbers) registered as listeners.

What works: creation order as dependency order; downstream sets; undefined as a value; definitions as the file format. What is weak: whole-document redefinition, snapshot undo with unstable identity, one giant object type, errors shown in dialogs, no early cut-off, and a layer rule that surprises people.

---

## 4. Our design: identity, objects, values

### 4.1 Ids and names

```ts
type ObjId = number & { readonly __brand: 'ObjId' };   // stable for the life of the figure
type Name = string;                                     // unique, case-sensitive, section 3.1 of core design

type TypeName =
  | 'Number' | 'Bool' | 'Text' | 'Point' | 'Vector' | 'Segment' | 'Ray' | 'Line'
  | 'Circle' | 'Arc' | 'Polygon' | 'Function' | 'Curve' | 'Region'
  | 'List' | 'Color' | 'Particles';                     // List carries its element type separately
```

An `ObjId` is issued once. Redefinition, undo of a delete and loading a saved script with the same ids all keep it. Names can change (`Rename`); ids never do. Everything outside the kernel (films, selections, view caches, the teacher's memory of "that point") may hold ids and must tolerate the id being gone.

### 4.2 Values

A value is immutable. Values are the language's raw runtime values (numbers, booleans, strings, points, lists, function values), not a `{ t, v }` tagged union (ruling K5). The type of a value is the `type` of the object that holds it. Immutability makes cut-off cheap and undo exact.

```ts
type Cell =
  | { defined: true; value: unknown }                                          // raw runtime value; its type is the object's `type`
  | { defined: false; reason: UndefReason; detail?: string; cause?: ObjId };   // detail = one short text; cause = the nearest undefined input (a direct input), if inherited; following cause links reaches the root

type UndefReason =
  | 'parallel' | 'coincident' | 'no_intersection' | 'out_of_domain' | 'division_by_zero'
  | 'no_root' | 'not_finite' | 'overflow' | 'degenerate' | 'index_out_of_range' | 'empty_list'
  | 'no_convergence' | 'timeout' | 'input_undefined' | 'not_set' | 'limit';
```

`input_undefined` is the reason on an object whose own maths is fine but one of its inputs is undefined; `cause` names the nearest undefined input: a direct input of this object, the first undefined one in rule order. It is not the root. A reader follows `cause` links, object by object, to reach the root. (The reference app just says "undefined" everywhere.) Details and the catalogue are in `errors.md`.

Equality (`sameValue(a, b)`) compares numbers bitwise-with-NaN-equal (so `NaN` equals `NaN`, `-0` differs from `0` only when a rule opts in), and compares composite values structurally. Functions and curves compare by their rule identity plus input cells, not by body, so a function whose parameters did not change counts as unchanged.

### 4.3 The object record

```ts
interface Obj {
  readonly id: ObjId;
  name: Name;
  readonly type: TypeName;
  def: Definition;             // how it was made; section 4.4
  cell: Cell;                  // current value or undefined+reason
  props: Props;                // everything non-mathematical; section 9
  order: number;               // dense index 0..n-1, always a valid dependency order
  // derived, rebuilt by the graph only when structure changes:
  readonly inputs: readonly ObjId[];       // direct reads (rule inputs + property rules)
  downstream: Int32Array;                  // order indices of every dependent, ascending
  free: boolean;
}
```

The value `cell` and the `props` are kept apart on purpose. A change to colour never marks a maths rule dirty; a change to a value marks drawables dirty but not props.

### 4.4 Definitions

```ts
type Definition =
  | { kind: 'free'; value: unknown; range?: { min: number; max: number; step?: number } }
  | { kind: 'rule'; text: string; ast: Node; rule: RuleInstance }   // command or formula
  | { kind: 'state'; initial: unknown }                               // see core design 7.2
  | { kind: 'rate'; of: ObjId; expr: Node }                         // name' = expr

interface RuleInstance {
  readonly spec: string;                       // command name or '=' for plain formulas
  readonly inputs: readonly ObjId[];
  eval(ctx: EvalCtx): Cell;                    // pure; reads input cells and t
}
```

Rules are single-output in v1. A command that the reference app would answer with several objects (two intersection points, a polygon with its sides) returns one `List` or the user asks for each by index (`Intersect(c1, c2, 1)`), which the core design already does. This removes a whole class of "which output is mine?" bugs (outputs that outlive their algorithm, labelling rules, `resetLabels`). If a later command truly needs several outputs, it returns a tuple object and the lines `P1 = Part(T, 0)` pick pieces.

### 4.5 The figure

```ts
class Figure {
  // lookup
  byName: Map<Name, Obj>;
  byId: Map<ObjId, Obj>;
  list: Obj[];                       // in order; list[i].order === i
  // clock and frame state
  t: number;
  // events out
  on(listener: (ev: FigureEvent) => void): () => void;

  apply(line: ParsedLine, ctx?: TxContext): TxResult;      // one transaction, section 5
  applyBatch(lines: ParsedLine[], opts: BatchOptions): BatchResult;   // mode 'atomic' (default) or 'independent', section 5
  setFree(id: ObjId, v: unknown, why: 'drag' | 'slider' | 'show_me' | 'api'): FrameDelta;
  setClock(t: number): FrameDelta;
  flush(): FrameDelta;               // run one update pass over everything marked

  undo(): UndoResult;  redo(): UndoResult;
  steps(): readonly Step[];  stepTo(n: number): void;
  toScript(opts?: ScriptOpts): string;
  static fromScript(text: string, opts?: LoadOpts): { figure: Figure; report: LoadReport };

  dependentsOf(id: ObjId): readonly ObjId[];
  ancestorsOf(id: ObjId): readonly ObjId[];
  suggestName(type: TypeName, hint?: string): Name;
}

type FigureEvent =
  | { ev: 'add'; id: ObjId }
  | { ev: 'remove'; id: ObjId; name: Name }
  | { ev: 'value'; ids: readonly ObjId[] }            // batched per pass
  | { ev: 'style'; ids: readonly ObjId[] }
  | { ev: 'rename'; id: ObjId; from: Name; to: Name }
  | { ev: 'reorder'; ids: readonly ObjId[] }
  | { ev: 'step'; n: number }
  | { ev: 'undo'; group: string }                      // informational
```

`value` and `style` events are batched: one event per pass with the list of ids, which maps one-to-one to "mark these drawables dirty". Views never get a per-object storm.

---

## 5. Applying a line: the transaction

Every `apply` runs the same five steps. The steps before the commit touch nothing in the figure.

1. **Parse** (language package): a tree or a `syntax` error.
2. **Resolve names**: every identifier becomes an `ObjId` or an error (`unknown_name`, `reserved_name`, `unknown_command`). Names defined earlier in the same `draw` batch resolve, since each line commits before the next is parsed.
3. **Type-check**: command form selection or operator typing; produce a `RuleInstance` and the output `TypeName`. For a redefinition, compare with the old type (`type_change`).
4. **Plan** the structural change as a small value (`Plan`): which object is added, replaced or removed, new input edges, any reorder moves needed. The plan is checked for:
   - **cycle**: the new inputs must not include the object itself or anything in its downstream list. This is a membership test on the cached sorted `downstream` array (binary search), not a graph walk.
   - **locked**: a fixed object cannot be redefined or deleted by a line unless the line unfixes it first (rule in section 8).
   - **limits** (objects, expression size).
5. **Compute once and commit**: evaluate the new rule against current inputs. If evaluation throws (a bug), roll back and return `internal`. Otherwise commit: update tables, write the journal entry, rebuild only the affected downstream arrays, run one pass for the object and anything downstream, emit events.

If any step fails, the figure is bit-for-bit what it was, the journal is unchanged, and the caller gets an error object (`../errors/design.md`).

```ts
interface TxResult {
  ok: boolean;
  line: number;
  error?: ErrorObject;                 // when !ok
  // when ok:
  name?: Name; id?: ObjId; type?: TypeName;
  op?: 'add' | 'redefine' | 'restyle' | 'delete' | 'action' | 'undo' | 'redo' | 'directive' | 'comment';
  summary?: string;                    // "M = (2, 3)"; the type is in `type`
  changed: ChangeReport;
  notices: Notice[];                   // facts worth saying, ../errors/design.md section 3.1 (ruling K3)
}

interface ChangeReport {
  added: Name[];
  removed: Name[];                     // deleted by cascade, in deletion order
  redefined: Name[];
  moved: Name[];                       // reorder moves caused by redefinition
  becameUndefined: { name: Name; reason: UndefReason; cause?: Name }[];
  becameDefined: Name[];
  warnings: Notice[];                  // the same array as TxResult.notices, kept so older readers work (ruling K3)
}

interface BatchResult {
  ok: boolean;                         // true when no line failed
  results: TxResult[];
  applied: number;                     // lines committed (0 after a rollback)
  rolledBack: boolean;                 // an atomic batch failed and was undone
  changed: ChangeReport;               // the merged change of the batch
  notices: Notice[];
}
```

`applyBatch` has two modes (ruling K6). `mode: 'atomic'` is the default: all lines or none, one undo step. `mode: 'independent'` runs every line on its own, as `errors.md` section 5 rule 2 describes.

The change report is what the teacher reads. It is also the data behind the learner's toast ("M is now undefined: the lines are parallel").

### 5.1 Why not "text in, text out"

The reference app's input pipeline for redefinition serialises and rebuilds. We never do. The plan is a structural edit of the graph, applied in place. This keeps `ObjId`s, cuts redefinition from a whole-figure rebuild to work proportional to the object's downstream list, and makes undo exact.

---

## 6. Update propagation, batching and undefined values

### 6.1 Order

`list[i].order === i`. Any line can only name existing objects, so appending is always valid. Redefinition can break order (a new input sits after the object), which the reorder step repairs.

**Reorder algorithm** (redefine object `X` to read inputs `I`):

1. `need` = every ancestor of every object in `I` (walk `inputs` backwards, stopping at objects whose `order < X.order`, since their ancestors are earlier still). If `X` is in `need`, it is a cycle.
2. Let `late` = members of `need` with `order > X.order`, sorted by order. If empty, no move.
3. Move `late` to sit immediately before `X`, preserving their relative order. Everything else keeps relative order.
4. Renumber `order` for the affected range only; rebuild `downstream` for objects whose dependents moved.

This is stable and minimal; the number of moved objects is what the change report calls `moved`. A "move" never changes any value, so no recompute is needed for moved objects themselves.

### 6.2 Downstream arrays

`downstream` of an object is an ascending `Int32Array` of order indices of everything that reads it, directly or indirectly. It is rebuilt only on structure changes, by a reverse sweep: for `i` from the end to the start, `down(i) = union(direct children of i, down(child) for each child)`, using a single scratch bitset. Cost is `O(edges * average closure width)` at worst, but incremental rebuild touches only ancestors of changed objects (their closure changed). Memory is bounded: a closure larger than 4096 entries is stored as a bitset instead.

Free objects, `t` and states are the **sources**. Drag and play never rebuild arrays.

### 6.3 One pass per frame

```ts
interface FrameDelta { valueIds: ObjId[]; undefinedChanges: UndefChange[]; ran: number; }

flush(): FrameDelta {
  // dirty = set of source order indices marked since the last flush
  // 1. candidates = merge of downstream arrays of dirty sources (k-way merge if k small,
  //    otherwise mark in an epoch-stamped Uint32Array and sweep from min(dirty).order)
  // 2. walk candidates in ascending order; for each, if it is marked "inputs changed",
  //    run its rule once; if the new cell is not sameValue as the old one, store it and
  //    mark its direct children; otherwise do not mark children (cut-off)
  // 3. return the ids whose cell changed
}
```

Key points:

- **One run per rule per flush.** Ascending order guarantees inputs are final when a rule runs.
- **Cut-off.** A rule runs only if at least one of its inputs actually changed value in this flush. A slider moving from `3.0000001` to `3.0000002` that rounds into the same display still changes the value (we compare exactly), but `if(a > 2, 1, 0)` staying `1` stops the pass there. This is the biggest saving available for films where most of the figure reacts to `t` only through a few gates.
- **Coalesced writes.** `setFree` may be called many times between flushes (a drag at pointer rate); the last write wins and marks the source once.
- **Clock.** `setClock` marks `t` as a source. The player calls `flush` once per frame. The downstream array of `t` is cached with the other arrays and is only rebuilt when a line changes what reads `t`.
- **Budget.** Target for 500 objects with `t` reaching 200 of them: under 0.5 ms for the pass itself on a mid-range laptop. A rule that exceeds a per-rule time budget (default 2 ms, per-rule override for heavy ones like integrals) is allowed to finish but the figure records `slowRules` for the profiler; there is no abort, since aborting mid-pass would leave an inconsistent figure. Rules with unbounded cost must be written to check their own budget (section 13).

### 6.4 Undefined values

- A rule returns `{ defined: false, reason }` for a maths failure. It does not throw.
- If any input cell is undefined, the engine does not even call a rule unless that rule is declared `acceptsUndefined` (only a few, such as `if(...)` in a branch not taken, `Count`, and the property rules for `showIf`). The output is `{ defined: false, reason: 'input_undefined', cause }`, with `cause` the first undefined input by input order, or that input's own `cause` if it was inherited, so `cause` always names a root.
- When an input becomes defined again the rule runs again (it is dirty like any other change).
- Drawables of undefined objects are not drawn. A free object cannot be undefined by a rule; it is undefined only when the user sets it to `?` (the literal `undefined`), which is allowed for Numbers and nothing else.
- `becameUndefined` and `becameDefined` lists in the change report are computed by diffing the `defined` bit across the pass. Cost is one compare per changed object.

---

## 7. Free versus dependent, and dragging

- `free` objects: `kind: 'free'`. Draggable if they are Points, sliders (Numbers with a range), Booleans (checkbox), Text positions in v1 excluded.
- **Dependent points are not draggable in v1.** The core design's open question 2 asks whether dragging a dependent point should move its free parents. Our answer for the kernel: expose `dragPlan(id, target)` that returns `{ writes, reason?, kind? }` (ruling K8): `writes` is the list of `{id, value}` free writes, and when the drag is refused it is empty and `reason` says why. `kind` is `free`, `path` or `inverted`. v1 returns writes only for a free point, a point on a path (projected parameter), and a point whose rule declares itself invertible (`Midpoint`, `Translate`, and `PointOn`). The kernel does the plumbing so tools can add invertible rules later without touching the view.
- A drag gesture is a sequence of `setFree(..., 'drag')` then `flush`. On release the gesture commits as **one** journal entry with the first and last value (section 11).
- Dragging a fixed object is refused by the kernel (`dragPlan` returns no writes, with reason `locked`), so no view has to remember to check.
- `show_me` (the teacher changing a slider) uses `setFree(..., 'show_me')` and is journalled as a value change that undo can reverse.

---

## 8. Redefinition rules

| Case | Result |
|---|---|
| Same type, new inputs earlier | In place. Id, style, position in lists kept. |
| Same type, new inputs later | In place; reorder moves (6.1); change report lists `moved`. |
| New inputs contain the object or a descendant | `cycle`, with `path` listing the chain `X -> ... -> X`. |
| Different type | `type_change` (hint: `Delete(X)` first, or pick another name). |
| Free object becomes rule, or the reverse | Allowed, same type. Style and id kept. Descendants recompute. |
| Self-reference on a free `Number`, `Point` or `Bool` (`a = a + 1`, `A = A + Vector((1, 1))`) | **Allowed**: evaluated once with the old value, stored as the new free value. It is an assignment, not a rule. Any other self-reference is `cycle`. |
| Fixed object | `locked` error. Hint: `X with fixed = false`. |
| Redefine to the same text | Runs a plain update (matters for `rand`-like or clock-dependent rules); no structural change. |
| Descendants become ill-typed | Not possible: types cannot change. A descendant that stops finding a valid argument shape becomes undefined, not an error (a rule's form was chosen when it was made). |

A **dry-run** mode (`apply(line, { dryRun: true })`) runs steps 1-4 and returns the plan summary and any error without committing. The teacher uses it when it is unsure; the live-input UI uses it to show a preview that is guaranteed to match what Enter will do.

Why the exception for `a = a + 1`: in a lesson, "now add one" is natural speech, and a free-value assignment is what people mean. The alternative (error) costs a retry on a very common pattern.

---

## 9. Object properties as kernel data

Properties are plain data in `props`, with a table that says what exists, its type, default and which object types accept it. The table drives `with` parsing, validation, saving, the properties panel and the catalogue for the model.

```ts
interface Props {
  visible: boolean;                 // default true
  label: 'name' | 'value' | 'both' | 'caption' | 'none';  // default by type
  caption?: string;                 // may contain {name} and {value}
  aux: boolean;                     // default false
  fixed: boolean;                   // default false
  selectable: boolean;              // default true
  layer: number;                    // integer 0..9, default 0
  showIf?: PropRule<'Bool'>;        // hidden when false or undefined
  color: StaticOrRule<ColorSpec>;   // default by type, section 9.3
  opacity: StaticOrRule<number>;    // 0..1
  width: number;                    // line width in px at 1x, 0.5..12
  lineStyle: 'solid' | 'dashed' | 'dotted' | 'dashdot';
  pointSize: number; pointStyle: 'dot' | 'circle' | 'cross' | 'plus' | 'diamond' | 'square' | 'triangle';
  fill: 'solid' | 'hatch' | 'cross' | 'dots' | 'checker';  // v1 subset of the manual's list
  fillAngle?: number; fillGap?: number;
  trace: boolean;                   // Points; maintained with the core design 7.5
  tip: 'auto' | 'name' | 'value' | 'caption' | 'off';
  tags?: string[];                  // our addition: free text groups ("step1", "legend")
}

type StaticOrRule<T> = { kind: 'static'; value: T } | { kind: 'rule'; rule: PropRule<any> };

interface PropRule<R> {
  readonly text: string;            // as written
  readonly inputs: readonly ObjId[];
  eval(ctx: EvalCtx): R | undefined;       // undefined => property falls back, section 9.4
}
```

### 9.1 `with` clause

`Name with key = value, key = value` (core design section 3). `value` is a literal or any expression. Keys:

| Key | Type | Notes |
|---|---|---|
| `visible` | Bool literal | `Show`/`Hide` are sugar |
| `label` | `name`/`value`/`both`/`caption`/`none` | |
| `caption` | Text | |
| `aux` | Bool literal | |
| `fixed`, `selectable` | Bool literal | |
| `layer` | integer 0..9 | out of range is `bad_property_value` (we do not clamp silently) |
| `showIf` | Bool expression | makes a property rule |
| `color` | colour name, `rgb(r,g,b)`, `hsl(h,s,l)`, `Gradient(...)`, or number expression driving a palette | expression makes a property rule |
| `opacity` | number in 0..1, expression allowed | |
| `width`, `pointSize` | number | |
| `lineStyle`, `pointStyle`, `fill` | enum | |
| `fillAngle`, `fillGap` | number | |
| `trace` | Bool | |
| `tip` | enum | |
| `tags` | text list | |
| `animate` | plain word | Every drawable type. The kernel accepts and stores it; the values and what they do are animation-time 5.2 (ruling K11) |

Unknown key: `unknown_property`, hint lists the keys valid for that object's type.

### 9.2 Property rules are in the graph

`showIf`, dynamic `color` and dynamic `opacity` are rules whose inputs are real objects. They are registered as extra edges from those inputs to the owner, flagged **style edges**. Consequences:

- A change to `a` marks the owner for restyle, not for a value recompute. The owner's `cell` is untouched, and no maths rule downstream runs because of a style edge.
- Style edges can never form a cycle, because a property rule reads other objects' *values* and nothing reads a style. A point whose colour reads its own `x`, or an object whose `showIf` reads its own value, is therefore legal. The cycle check on lines only follows value edges.
- When an input is deleted, the owner is not deleted (The reference app deletes dependents). The property rule is **detached** and the property reverts to its default, with a `property_detached` notice. Rationale: deleting a point because the slider that coloured it went away is a surprising cascade.
- Property rules are saved after the object's own line, in `with` form.

### 9.3 Defaults

| Type | Colour | Width | Notes |
|---|---|---|---|
| Free Point | blue `#2563eb` | size 5 | draggable cue: ring on hover |
| Dependent Point | dark grey `#374151` | size 4 | |
| Point on path | light blue `#60a5fa` | size 4 | |
| Line, Ray, Segment, Vector | black `#111827` | 2 | |
| Circle, Arc | black | 2 | fill opacity 0 |
| Polygon, Region | `#10b981` | 1.5 | fill opacity 0.15 |
| Function, Curve | `#dc2626` | 2.5 | |
| Number slider | inherits `#6b7280` | 2 | |
| Text | `#111827` | n/a | |

These are data in a `defaultsFor(type, free)` table, not code branches, and a figure can override them in a `@theme` directive later. The values are our choices; contrast ratios must pass 4.5:1 against the light and dark backgrounds (checked in a unit test).

### 9.4 Dynamic colours

- `color = rgb(r, g, b)` with each channel 0..255 (numbers clamp to range; `NaN` falls back to the static colour).
- `color = hsl(h, s, l)` with h in degrees, s and l in 0..1. Hue wraps. (The reference app offers HSV too; we offer HSL and `hsv(h, s, v)` both, converting to RGB at read time.)
- `color = Gradient(u, c1, c2, ...)` is the colour map from the core design's particles section, usable for any object.
- `opacity = expression` in 0..1; out of range clamps; `NaN` falls back.
- If the rule is undefined (an input is undefined) the property reverts to its static value while undefined and no notice is raised. Rationale: a colour that depends on a missing thing should not make the object vanish.
- Evaluating a property rule never allocates: it writes into a preallocated `Float32Array(4)` slot owned by the drawable.

### 9.5 Layers

- Layers are integers 0..9, higher on top; draw order is layer, then type band, then order (core design section 8).
- **New objects always start on layer 0.** (The reference app moves new objects up to the highest used layer; that surprises learners and is hard to explain. We do not copy it.) A script that wants a "background" says `with layer = 0` and a foreground `with layer = 5`.
- Selection and hit-testing prefer higher layers.
- SVG export groups by layer.
- A `Layer(n)` shorthand is not needed; `with layer = n` is enough.

### 9.6 Conditions to show

- `showIf` is a Bool rule. The effective visibility is `visible && (showIf is absent || showIf evaluates to true)`. Undefined means hidden.
- A free `Bool` that is shown becomes a checkbox in the view; `showIf = flag` ties an object to it.
- The `figure` tool reports both `visible` (the property) and `shown` (the effective result), so the teacher can say "it's hidden because `a` is over 2".

### 9.7 Fixed, selection, auxiliary

- `fixed = true`: no drag, no slider change from the learner, no redefinition from lines, no deletion by the learner's delete key. The teacher can still change values with `show_me` only if the teacher's tool explicitly passes `force: true`, which it does not by default.
- `selectable = false`: the pointer ignores it entirely (it does not eat clicks meant for something below), screen readers still list it.
- `aux = true`: excluded from the object list and the step list unless "show helpers" is on; still saved, still in `figure` tool output with `aux: true`. This is how helper objects stay out of the learner's way.

---

## 10. Clock, states and sliders: the hooks

The clock, states and ODE solver are owned by the motion area. The kernel provides:

- `t` as a built-in free source, set only by `setClock`.
- A `state` definition kind (4.4) whose value the solver writes through `setFree(..., 'solver')`; this write is **not journalled** (it is derived, not authored). Rates run as compiled closures (ruling K10); the flat `RateProgram` form in animation-time 7.2 is the motion area's job.
- Sliders: a free Number with `range`. `with animate = ...` is a property (ruling K11) that the player reads. The kernel accepts and stores any plain word; the values (`off`, `bounce`, `loop`, `loop-down`, `once`, `once-down`) and what each one does are defined in animation-time 5.2. It is *not* part of the maths and does not use wall time (it is a function of `t` and its settings, so it replays and seeks).

---

## 11. Undo and redo

### 11.1 Journal

```ts
type JournalEntry =
  | { k: 'add'; obj: ObjSnapshot; pos: number }
  | { k: 'remove'; objs: { snap: ObjSnapshot; pos: number }[] }          // cascade list, in removal order
  | { k: 'redefine'; id: ObjId; before: DefSnapshot; after: DefSnapshot; moves: Move[] }
  | { k: 'props'; id: ObjId; before: Partial<Props>; after: Partial<Props> }
  | { k: 'value'; id: ObjId; before: unknown; after: unknown }               // free write (coalesced)
  | { k: 'rename'; id: ObjId; from: Name; to: Name }
  | { k: 'reorder'; moves: Move[] }
  | { k: 'group'; label: string; entries: JournalEntry[] };              // one undo step

type Move = { id: ObjId; fromOrder: number; toOrder: number };
```

`ObjSnapshot` holds the id, name, definition source, props, free value (if free). It does **not** hold derived values; they are recomputed when an entry is applied.

### 11.2 Rules

- One entry per accepted line. One `group` per `draw` call (up to five lines) so the learner's Undo takes back the teacher's whole last utterance. The teacher's `Undo()` action takes back one **line** (not the group) so it can fix a single mistake. The two behaviours are different on purpose: learner buttons act on groups, the line action acts on lines. Both are exposed as `undo({ unit: 'group' | 'line' })`.
- A drag is a gesture: many `value` writes, one journal `value` entry from first to last on release; no entry if the end equals the start.
- Slider animation, the clock and solver writes are never journalled.
- Applying an entry in reverse or forward uses the same internal editing functions as `apply`, in "replay" mode: no parsing, no type-check; only the structural plan, cycle check (cheap) and one pass. Because ids are kept, selection and film references stay valid across undo.
- Undo of `remove` restores each object at its saved position with its saved id and props, then recomputes once. Position `pos` is the order index at removal time; because later entries are undone first, positions are exact.
- Redo stack is cleared by any new accepted line (not by a rejected one).
- Capacity: 500 entries or 4 MB of snapshot text, whichever first; oldest entries are dropped. When entries are dropped the figure reports `undoDepth` honestly through `figure.undoInfo()`.
- Undo/redo never touch `t`, the view window or the selection beyond removing deleted ids.

### 11.3 Cost

An entry for a line is a few hundred bytes. Undo cost is proportional to the entry (a redefine redoes one structural edit and one pass over its downstream), not the figure. Target: undo of one line in a 500-object figure under 1 ms.

(The reference app: whole-document snapshots with an action list on top, capped at 100, ids unstable.)

---

## 12. The step list (our construction protocol)

### 12.1 Model

```ts
interface Step {
  readonly index: number;          // 0-based, equals order of the object (aux objects optionally skipped)
  readonly id: ObjId;
  readonly name: Name;
  readonly type: TypeName;
  readonly definition: string;     // the line as written, normalised
  readonly valueText: string;      // short value summary, or "undefined (parallel)"
  readonly sentence: string;       // generated plain-language explanation, section 12.3
  readonly group?: { title: string; breakpoint: true };  // starts a new stop
  readonly visible: boolean;
}
```

- The step list is a view over `figure.list`, not a second structure, so it cannot drift from the truth.
- `@step "title"` is a new directive (see Changes). It does not create an object. It marks the next object as a breakpoint with a title. Steps without a title fall into the group of the last title. Without any `@step` line, every object is its own stop.
- `aux` objects are hidden from steps unless the learner turns on helpers.

### 12.2 Replay

`figure.stepTo(n)`:

- Sets the **reveal cursor** to `n`. Objects with `index >= n` are *not drawn and not listed in the object panel*, but they still exist, still hold values and still update. (The reference app emits remove/add notifications to views, which re-creates view state each time; we keep a single cursor and let views filter by it.)
- `stepTo` is O(number of steps crossed) in the view because it only flips visibility flags; it is O(1) in the kernel.
- `figure.stepTo(figure.list.length)` is the default state; `Hide` and `Show` are independent from the cursor.
- A film beat (`@beat`) can carry a `stepTo` value so a recorded lesson reveals the build in time with speech. The cursor is part of film state, not undo history.

Stepping in the kernel emits one `step` event; views react.

### 12.3 Generated sentences

Every command form in the command table carries an `explain` template with slots, e.g. `"{name} is the midpoint of {0} and {1}"`. The step list uses it for the sentence column and for screen-reader text. This keeps the explanation next to the definition of the command; there is no separate translation table to drift. (The command-table owner adds `explain` to each form; if missing, the sentence falls back to `"{name} = {definition}"`.)

### 12.4 Editing from the list

- **Delete a step:** same as `Delete`, with the cascade listed and confirmed in the UI; the kernel call is `deletePlan(id)` (what would go) then `apply`.
- **Insert at a position:** `figure.insertAt(index, line)`: the new object gets `order = index`, later objects shift. Inputs must have `order < index`, otherwise the error is `forward_reference` ("`A` is defined later; move it first"). Implementation is the normal transaction with an order hint.
- **Move a step:** drag in the list calls `reorder` with a target index. Legal iff no dependency crossing; the kernel gives `movePlan(id, to)` listing which objects must also move; the UI offers "move with its inputs".
- **Rename:** `Rename`.

---

## 13. Saving and loading

### 13.1 Format

```text
@fig 1
@view -5 5 -3 3
# Triangle and its midpoints
A = (0, 0)
B = (4, 0)
C = (1, 3) with color = red
a = 2 in 0..5 step 0.5 with animate = bounce
M = Midpoint(A, B)
@step "Bisect AC"
N = Midpoint(A, C) with showIf = (a < 3), layer = 2
```

- First line `@fig <version>` (integer). A loader that sees a larger version refuses with its own error kind `version` (code K042, ruling K7), not `load_failed`, listing the supported ones.
- One object per line in order, then `with` only for properties that differ from the type default.
- Free objects store their **current value** in the line (`A = (1, 2)`), dependent store their rule text. Slider ranges in `in a..b step s`.
- Numbers print as the shortest string that round-trips (`0.1`, not `0.1000000000000000055`); `NaN`/`Infinity` print as `undefined` for free values.
- Comments and directives are kept in place, so a human-edited script stays readable after a round trip.
- State, rate and particle objects store their lines like any other.
- The clock position is stored only in a film file, not in the figure.
- Dependent values are never stored. Loading recomputes.

### 13.2 Loading

```ts
interface LoadOpts { mode: 'lenient' | 'strict'; limits?: Partial<Limits>; }
interface LoadReport {
  applied: number; skipped: number;
  errors: ErrorObject[];             // every failed line, with its line number in the file
  warnings: Warning[];
}
```

- `lenient` (default): apply each line independently; a failed line is recorded and skipped; later lines that depended on it fail with `unknown_name` and `blockedBy` (so one real fault is not hidden in a pile of copies). The figure is usable and the report says exactly what is missing.
- `strict`: all or nothing; any error discards the new figure.
- A load is one journal group when loaded into an existing figure (`figure.append`), or a fresh figure with an empty journal.
- Performance: parse and apply 1,000 lines in under 100 ms (≈100 µs per line); the update pass is run once at the end rather than per line (bulk mode) since nothing is drawn mid-load.

### 13.3 Round-trip guarantee

`fromScript(toScript(f))` gives a figure `g` with: same names, ids renumbered in order (ids are not part of the file), same definitions, same free values, same props, and `sameValue(f.cell, g.cell)` for every object at the same `t`. A test generates random figures, round-trips them and compares. Ids are not saved because they would make hand-edited scripts fragile; films reference objects by name and re-resolve on load.

---

## 14. New actions and queries the kernel adds

Added to the action table (core design section 6.6). Each is one line.

| Command | Forms and effect |
|---|---|
| `Rename(obj, Text)` | Changes the name. `name_taken`, `reserved_name`, `bad_name` errors. Descendant definition texts are regenerated from trees, so they stay correct. |
| `Undo()`, `Redo()` | Undo / redo one line. Fails with `nothing_to_undo`. |
| `Describe(obj)` | Returns name, type, definition, value, props, inputs, dependents, effective visibility. For the teacher to read. |
| `DependsOn(obj)` | Names obj depends on (ancestors), in order. |
| `Uses(obj)` | Names that depend on obj (descendants), in order: "what would `Delete` take with it?" |

These return data in the `TxResult` (they do not create objects). `DependsOn` and `Uses` can also be called as `figure.ancestorsOf` and `figure.dependentsOf`.

### What a rule can ask the kernel

A rule sees the figure through its `RuleCall`. Besides its own arguments it has four services, all read-only:

- `call.notify(kind, params)`: adds a notice to the result of the line that ran the rule. It is for a value that is defined and still needs a remark, such as an ODE solution that stops at a blow-up. The kind is registered with `registerNotice`. One notice per kind and line is kept.
- `call.inputsOf(id)`: the objects another object's value reads directly, with their names and values.
- `call.argsOf(id)`: the values of the arguments of the command that defines another object. `P = PointOn(Segment(A, B), 0.3)` gives the segment and `0.3`.
- `call.slice(source, target, { override: true })`: a slice whose source is defined by a rule. `run(values)` puts each value in place of the source's own value and re-runs what lies between it and the target. `Locus(Q, P)` uses it to move `P` along its path: it finds the path with `argsOf` and feeds the path's points in. Without `override`, a source that is not free is still the error `not_free`.

### What an area can add to a line

Areas plug into how a line is read without changing the core. Each hook is registered once, when the area registers
its commands, and a hook that throws is skipped.

- `registerLineHandler(handler)`: a line kind the area owns outright, such as `on go click: SetValue(a, 0)`. The handler
  carries the line out and returns its summary with an `undo` and a `redo`; the kernel records them as one undo entry
  (`ext`). On a dry run the handler leaves nothing changed. It may also refuse the line with an error.
- `registerLineRewriter(rewriter)`: reads the line before it is parsed. It may put another line in its place
  (`a with min = 0, max = 20` becomes the slider's range line), add notices, refuse the line, or ask that a slider's
  range be dropped (`dropRange`).
- `registerLineCheck(check)`: runs after the language check and before anything is committed, and may refuse the line.
- `registerScriptTail(tail)`: lines the area adds at the end of `toScript`, after every object.
- `registerDeleteNotes(notes)`: notices the area adds to the result of a delete.
- `registerFieldReader(type, reader)` and `registerFieldTyper(type, typer)`: evaluate and type the fields an area adds to
  `FIELDS`. A typer types a field from the object itself (`d.value` has the type of the dropdown's options). A field that
  holds a function can be called: `g.value(x)`.

### Commands two areas both give

Two areas may register a command of the same name and kind (`Tangent` of a conic and of a function). The registry
merges them into one: the second area's forms are added after the first's, a form with the same parameter types as one
already there is left out, and both refusals are asked in turn.

### Dragging a number written in a line

An inverse may return a value for an argument that is a number written in the line itself (`P = PointOn(c, 0.25)`).
The drag plan then holds a write with `param` set, and the drag rewrites that number in the line. The whole gesture is
one undo entry on `commitDrag`, like a drag of a free point.

### What a rule and an action receive

- A rule factory gets each argument's checked tree in `BoundArg.expr`, so a rule can compile a formula further (the
  particle formulas go to GLSL).
- A body argument with names of its own (`u`, `age` in `Particles`) records each name's local slot in `scopeSlots`; the
  rule writes those slots before it evaluates the body.
- An area action gets the evaluated value of every argument that is not a plain object name in `ActionCall.values`;
  the objects are in `ActionCall.objects`.

### Work on each frame

`registerFrameTicker(ticker)` adds work an area does each time the player moves the clock, before the pass: traces add
their samples, and rebuild on a seek. The player itself is pure: the host gives it a time source and calls
`frame(now)` from its one animation-frame loop.

### Naming helper for tools

`suggestName(type, hint?)` uses the one name table in the language design (3.7): points `A, B, ... Z, A_1, B_1 ...`; vectors `u v w`; lines, rays and segments `l m n`; numbers `a b c d` (angles `α β γ δ`); functions `f g h p q r`; circles, arcs and curves `c d k`; lists `L M N`; polygons `poly1`; regions `reg1`; texts `text1`; booleans `cond1`. After the letters, a sequence continues with `_1`, `_2` (`l_1`). Skips taken and reserved names. This is for pointer tools and the playground; the teacher always names its own objects.

---

## 15. Numeric and performance targets

| Measure | Target | Notes |
|---|---|---|
| Apply a line, simple | < 0.3 ms | parse, resolve, check, commit |
| Apply a line, heavy (command with solve) | < 1 ms plus rule cost | core budget is 1 ms |
| Redefine with reorder of 50 objects | < 1 ms | |
| Delete with cascade of 200 objects | < 2 ms | |
| `flush` with 500 objects, 200 downstream | < 0.5 ms | |
| Undo of one line in 500 objects | < 1 ms | |
| Load 1,000-line script | < 100 ms | bulk mode |
| `toScript` for 1,000 objects | < 20 ms | |
| Memory per object | < 600 bytes plus value | Not met in v1: each object keeps its checked and compiled line (ruling K9). Revisit after the first areas plug in. |

Method notes: all lookups are `Map` or typed-array indexed; the `downstream` arrays are `Int32Array`; no per-frame allocation in the pass except new immutable values for changed cells (which are short-lived and small).

**Edge cases the kernel guarantees**

- Two references to the same input (`Midpoint(A, A)`) are one edge.
- A rule that reads `t` and `a` is a source-dependent rule on both; seeking and slider moves both mark it.
- Deleting `t`-dependent objects never touches `t`.
- Names that differ only by case are distinct (`a` and `A`); the error `name_taken` hint points out the near-collision with a notice (`confusable_name`), since a model can mistake them.
- A figure with zero objects still has `t`, axes settings and the view; `toScript()` yields the header and directives.
- Maximum limits (defaults, all overridable by the host): objects 5,000; expression nodes 400 per line; line length 2,000 chars; list size 100,000; journal 500 entries; rule nesting depth 64.

---

## 16. Better than the reference app

1. **In-place redefinition.** No serialise-edit-rebuild; stable ids; cost proportional to the downstream.
2. **Early cut-off.** Rules run only when an input actually changed value.
3. **Exact undo.** Small inverse entries, stable ids, per-gesture and per-utterance grouping. No snapshots.
4. **Undefined with a chain.** `cause` names the nearest undefined input; following the `cause` links reaches the root undefined object.
5. **Change report on every line.** Added, removed, moved, redefined, now-undefined, now-defined, and notices; the teacher can narrate correctly.
6. **Dry run.** Preview that is guaranteed to match commit.
7. **Style edges apart from value edges.** Colour and `showIf` never trigger a maths recompute.
8. **Detach, not cascade, for property rules.** Deleting a slider does not delete what it coloured.
9. **Single-output rules.** No orphaned outputs, no label juggling.
10. **Step replay by a cursor.** No remove/add notification storm.
11. **Layer rule that is predictable.** New objects start at 0; no "highest in use" surprise.
12. **Lenient load with `blockedBy`.** A damaged file opens with a precise to-do list instead of a dialog.
13. **Names are data, ids are stable.** Renaming does not break anything that holds an id.

---

## 17. Changes to the core design

1. **Section 3.1 / 6.6: new actions** `Rename`, `Undo`, `Redo`, `Describe`, `DependsOn`, `Uses` (section 14). Reason: the teacher needs to inspect and take back; the learner needs rename.
2. **Section 3.4 directives: add `@step "title"`** to mark breakpoints in the build list (section 12). Reason: lessons want "stops" in the build replay. Name chosen not to collide with `@beat` (a film beat); a step is a build stop.
3. **Section 2 redefinition: allow self-reference on free Number, Point and Bool** as assignment (section 8). Reason: `a = a + 1` is how people talk. Cycle error stays for everything else.
4. **Section 2 free objects: add the literal `undefined`** for a Number to be "unset". Reason: round-trip and "make it undefined" in lessons.
5. **Section 9 errors: extend the kind table** (see `../errors/design.md`): `forward_reference`, `locked`, `not_free`, `name_taken`, `bad_name`, `unknown_property`, `bad_property_value`, `nothing_to_undo`, `load_failed`, `internal`, `unbalanced`, `bad_number`, `unterminated_string`, `arg_count`, and `unknown_directive` split from `bad_directive`. Reason: finer kinds make model repair reliable.
6. **Error object**: add `phase`, `code`, `params`, `suggest`, `recovery`, `blockedBy`, `path`, `committed`, `fingerprint`. Reason: one format for every area.
7. **Section 2 "undefined is a value":** add `cause` and the reason catalogue.
8. **Section 5 CommandForm:** add optional `explain` template (for step sentences) and `acceptsUndefined` flag.
9. **Section 2 "order":** state that single-output rules are mandatory in v1.
10. **Property rules**: the core design is silent on colour/showIf as rules; this document adds style edges (section 9.2).
11. **Open question 2 (draggable dependent points):** answer in section 7: `dragPlan` exists in v1; only Free, PointOn and invertible rules write parents.

---

## 18. Sources studied

Removed before the repository was made public. The study notes above are in our own words.
