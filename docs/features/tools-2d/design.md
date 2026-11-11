# 2D tools: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md`. Pointer and canvas behaviour (hit lists, snapping, dragging) is in `../graphics-view/design.md`; this document uses it. Time and states are in `../animation-time/`.

## 1. What the feature does

A **tool** lets a learner build an object by clicking instead of typing. Every tool in this design does one thing in the end: it writes one to five script lines (the same lines the live teacher writes) and hands them to the kernel as one batch. There is no second construction path. The learner and the model make the same figure from the same language, and the script is the file.

### For a learner

- Picks a tool, sees a hint for the next click, sees a ghost of the result under the pointer, clicks, and gets the object.
- Can start with objects already selected (object first) and then pick the tool.
- Can undo a whole construction in one step, and read the lines it wrote.

### For a teacher

- Does not use tools; writes lines with `draw`. The teacher is told when the learner builds something (`learner_lines` event) and sees the same names and lines the learner's tool produced.

### Coverage

The manual's tool pages for the 2D Graphics view (about 110 pages including 3D and variants) reduce to **75 distinct 2D tools** here (about 95 behaviours once multi-variant tools are counted), in 12 groups. Section 6 lists each with its click sequence and what it writes. A few are deferred and are marked with the reason.

## 2. How GeoGebra does it (plain words)

- A toolbar of about 110 tools in toolboxes. Each tool is a number (a mode). A single controller of about 12,600 lines switches on the mode for every pointer event. Each tool has its own handler method plus hand-written preview code.
- A tool collects **picks**: it asks the hit list for the objects of the right types (points, lines, circles, ...), or creates a point where the user clicks in empty space. When it has enough picks it calls the matching command, so the tool is the command with a mouse.
- Many tools accept **several selections** (Angle: three points, two lines, two vectors, two segments, or a polygon). The mode code inspects the selected objects and decides.
- **Auto point creation**: a click on empty space makes a free point; a click on a path makes a point on that path; a click on a crossing of two objects makes an intersection point.
- **Preselection**: if the right objects are already selected when the tool is activated, it uses them at once.
- **Previews**: a tentative object follows the pointer between clicks.
- **Tool tips**: the active tool shows a one-line instruction.
- **Custom tools** are macros made from a construction, usable like built-ins and as commands.
- Tools and commands are two interfaces over the same operations.

### What works

- Tool = command with a mouse. The user's picks are the command's arguments.
- Auto point creation (free, on path, intersection) makes tools fast to use.
- Preselection avoids a lot of clicking.
- Previews tell the learner what will happen.

### What is weak

- One controller file with a branch per mode; adding a tool means touching it.
- Tool hints and the accepted-pick rules are code, not data, so they cannot be listed, tested, translated or shown to a model.
- A cancelled tool can leave points it already created.
- Undo granularity is uneven (a tool that made three objects may need three undos).
- Behaviours (what does the second click mean?) are discoverable only by trying.
- Numeric inputs (radius, angle) open a modal dialog.

## 3. Principles of our design

1. **Tools are data.** A tool is a `ToolSpec`: its id, group, a list of **variants** (each a sequence of **slots**), a hint per slot, and an **emit** function that turns picks into script lines. No tool has its own event handler.
2. **One engine runs every tool.** A single `ToolSession` state machine consumes pointer, key and number-entry events.
3. **Tools only write lines.** Everything a tool creates is a script line produced from the command table of the core design (section 5). A tool that needs a command that does not exist is a signal to add the command, not to add special code.
4. **Nothing is committed until the tool completes.** While picking, points that would be created exist only in the session. Cancelling leaves no trace. On completion, one batch of lines is applied as one transaction and one undo step.
5. **Previews use a dry run.** The same lines are applied to a scratch copy of the values by `kernel.dryRun`, so the preview is exactly what will be created.
6. **The catalogue comes from the data.** The toolbar, the hints, the docs and the list of tools in the model's prompt are all printed from the table.

## 4. Types

```ts
type ToolId = string;                 // 'circle-center-point', 'perpendicular', ...

type ToolGroup =
  | 'move' | 'point' | 'line' | 'special-line' | 'polygon' | 'circle-arc' | 'conic'
  | 'measure' | 'transform' | 'special' | 'action' | 'general';

interface ToolSpec {
  readonly id: ToolId;
  readonly group: ToolGroup;
  readonly label: string;               // message key; localisable
  readonly icon: string;                // icon key
  readonly variants: readonly ToolVariant[];
  readonly kind: 'construct' | 'query' | 'mode' | 'edit';
  readonly sticky: boolean;             // stays active after completing (default true for construct)
  readonly since: 'v1' | 'v1.5' | 'v2'; // when it ships
  readonly needs?: readonly string[];   // command names it relies on; checked against the table at build time
  readonly template?: undefined;        // reserved: user-made tools carry a script template
}

interface ToolVariant {
  readonly id: string;
  readonly slots: readonly Slot[];      // fixed length, or a repeating tail
  readonly tail?: { slot: Slot; min: number; max: number; closeBy: readonly CloseRule[] };
  readonly emit: (picks: Picks, ctx: EmitContext) => EmitPlan;
}

type CloseRule = 'click-first' | 'enter' | 'double-click' | 'dblclick-last' | 'count';

type Slot =
  | ObjectSlot
  | PointSlot
  | NumberSlot
  | PositionSlot
  | TextSlot
  | ChoiceSlot;

interface ObjectSlot {
  readonly kind: 'object';
  readonly accept: readonly TypeName[];     // 'Segment', 'Line', 'Circle', ...; 'Shape' = any transformable
  readonly part?: readonly HitPart[];       // 'edge' | 'fill' | 'body'; default any
  readonly prompt: string;                  // message key: "Select the line"
  readonly distinct?: boolean;              // may not repeat an earlier pick (default true)
}

interface PointSlot {
  readonly kind: 'point';
  readonly create: readonly ('existing' | 'free' | 'on-path' | 'intersection')[];
  readonly prompt: string;
  readonly role?: 'vertex' | 'centre' | 'focus' | 'start' | 'end';   // for hints and the live preview
}

interface NumberSlot {
  readonly kind: 'number';
  readonly prompt: string;
  readonly unit?: 'length' | 'angle' | 'count' | 'factor';
  readonly default?: number;
  readonly range?: readonly [number, number];
  readonly integer?: boolean;
  readonly allowFormula: true;             // any Number expression or object name
}

interface PositionSlot { kind: 'position'; prompt: string; snap: boolean }   // an anchor in the view
interface TextSlot     { kind: 'text'; prompt: string; multiline: boolean }
interface ChoiceSlot   { kind: 'choice'; prompt: string; options: readonly { id: string; label: string }[] }

type Pick =
  | { slot: number; kind: 'object'; id: ObjectId; hitParam?: number }
  | { slot: number; kind: 'point'; how: PointPick }
  | { slot: number; kind: 'number'; expr: string; value: number }
  | { slot: number; kind: 'position'; at: MathsPoint | { space: 'view'; p: PxPoint } }
  | { slot: number; kind: 'text'; value: string }
  | { slot: number; kind: 'choice'; option: string };

type PointPick =
  | { how: 'existing'; id: ObjectId }
  | { how: 'free'; at: MathsPoint }
  | { how: 'on-path'; path: ObjectId; s: number; at: MathsPoint }
  | { how: 'intersection'; a: ObjectId; b: ObjectId; index: number; at: MathsPoint };

interface EmitPlan {
  readonly lines: readonly EmitLine[];      // ordered; earlier lines define names later ones use
  readonly selectAfter: readonly string[];  // placeholder names to select after commit
  readonly focusAfter?: string;
}
interface EmitLine { readonly text: string; readonly role: 'new-point' | 'result' | 'helper' | 'style' }
```

`emit` is a pure function. It writes placeholders such as `{P1}`, `{c1}` for new object names. The engine replaces them with real names from the allocator just before commit, so previews and finished objects share one code path.

`kind` meaning:

| Kind | Meaning |
|---|---|
| `construct` | Writes lines that create objects |
| `query` | Shows a result without adding an object to the figure (Relation) |
| `mode` | Changes how the pointer behaves (Move, Move view, Zoom) and writes nothing |
| `edit` | Changes existing objects by redefining or restyling (Attach, Show/Hide, Copy style, Delete) |

## 5. The engine

### 5.1 Session

```ts
interface ToolSession {
  readonly spec: ToolSpec;
  picks: Pick[];
  alive: ReadonlySet<string>;           // variant ids still consistent with the picks
  preview: PreviewState | null;
  prompt: PromptState;                  // what the hint line says now
}

type ToolInput =
  | { kind: 'hover'; at: PxPoint; hits: HitList }
  | { kind: 'click'; at: PxPoint; hits: HitList; mods: Mods }
  | { kind: 'key'; key: 'Enter' | 'Escape' | 'Backspace' }
  | { kind: 'entry'; slot: number; text: string }          // a number / text typed in the inline field
  | { kind: 'pre-select'; ids: readonly ObjectId[] };

type ToolOutcome =
  | { kind: 'continue'; session: ToolSession }
  | { kind: 'done'; batch: EmitPlan; names: readonly string[] }
  | { kind: 'cancel' }
  | { kind: 'refused'; code: ToolRefusal; hint: string };      // gesture feedback, see errors.md
```

### 5.2 Variants narrow as picks arrive

At the start `alive` holds every variant. After each pick, a variant stays alive if its next slots can still accept the pick sequence so far. If one pick matches slots in several variants, they all stay alive.

- If, after a pick, exactly one variant is alive and it is full, the tool completes.
- If a variant is full but others are alive and can still take more picks (for example Angle with two points picked and a third expected), the tool waits.
- If a full variant is alive together with a longer variant that shares its picks, the tool waits for one more click; Enter or a click on empty space finalises the shorter one. In v1 no tool needs this; the rule is stated so a spec cannot be ambiguous (the build step fails any spec where two full variants accept the same pick sequence: `ambiguous_variants`).

Example, Angle: picks `[Point]` keeps `three-points` alive; `[Segment]` keeps `two-segments`; `[Polygon]` keeps `polygon`. A second `Segment` completes `two-segments`.

### 5.3 Turning a click into a pick

Inputs: `hits` (ranked by the view, filtered for this slot), `at` (snapped position), the slot.

For an **ObjectSlot**:

1. Take the first candidate whose object type is in `accept` and whose part is allowed. Exclude objects already picked when `distinct`.
2. If there is none, refuse with `no_target` (hint: "Select a line, segment, ray, or vector.").

For a **PointSlot** (what GeoGebra calls auto point creation, but explicit and bounded by `create`):

1. `existing`: an existing Point within slack (not an object on the excluded list). Take it.
2. `intersection`: two or more path-like candidates within slack of the click that have an intersection near `at` (within 12 px): take the intersection, choosing the index whose point is nearest to `at`. Emit as an `Intersect` point.
3. `on-path`: exactly one path-like candidate: take a point on it by projecting `at` (graphics-view 12.4). Emit as `PointOn(path, s)`.
4. `free`: a free point at the snapped position.
5. Only the options listed in `create` are tried, in the order above. A tool that must not put points on paths (the Compass centre, say, does not mind; the Point tool does) lists only what it allows.

The point is held as a **pending point** in the session. Pending points get placeholder names `{P1}`, `{P2}`. They are drawn on the overlay as hollow rings and become real objects only at commit.

For **NumberSlot / TextSlot**: after the last needed click the engine opens an inline field at the pointer (not a modal dialog). Enter commits, Esc cancels the slot but keeps earlier picks. The text is parsed as a Number expression and run through the checker with `kernel.dryRun`; an error shows under the field with the core error's `message` and `hint`.

For **PositionSlot**: the click position (snapped) becomes the pick; `Shift` selects a view-anchored position (a pixel anchor) instead of a maths one.

### 5.4 Preselection

If, at activation, the view's selection contains objects, the engine tries to read them as picks in **selection order**: for each selected object, find a variant slot (in order) that accepts it. If the picks complete a variant, the tool commits at once. If they fill some slots only, the session starts with those picks and waits for the rest. Selected objects that fit no slot are ignored (the selection is cleared when the tool starts).

### 5.5 Previews

After each hover with enough picks to compute something, the engine builds the lines for the shortest completion that uses the pointer position for the missing point slot, and runs `kernel.dryRun`. The result (type + value) is drawn on the overlay in the object's default style at 60% opacity, dashed for strokes. The preview obeys:

- Run at most once per animation frame (coalesce pointer moves).
- Cost per dry run under 0.5 ms for the v1 tool set; over that, the preview is skipped for the frame (and no error is shown).
- If the dry run returns an error or an undefined value, the preview is not drawn, and the hint line explains why in plain words (for example "These three points are in a line, so no circle goes through them").
- Previews never create names, never change `order`, never touch undo.

### 5.6 Commit

1. Allocate names for the placeholders (5.7).
2. Substitute, producing `string[]`.
3. `kernel.applyBatch(lines)`: each line passes the five-step transaction; if one fails, the whole batch is rejected, the session stays at its last pick, and a refusal with the error is shown. This should only happen if a tool spec is wrong or a command changed; the build tests exercise every tool.
4. All lines form one undo group (core change C7 in graphics-view).
5. Select the new result objects (`selectAfter`).
6. Send `learner_lines` to the teacher's inbox (agent.md).
7. If `sticky`, start a new session with the same spec.

### 5.7 Names

A single allocator, shared with the language (core section 3 says a name must be unique and not reserved).

| Object kind | Sequence |
|---|---|
| Points | `A`, `B`, ..., `Z`, then `A_1`, `B_1`, ... |
| Vectors | `u`, `v`, `w`, then `u_1`, ... |
| Lines, rays, segments | `l`, `m`, `n`, then `l_1`, ... |
| Numbers (including measurements) | `a`, `b`, `c`, `d`, then `a_1`, ..., skipping reserved names |
| Angles | `α`, `β`, `γ`, `δ`, then `α_1`, ... |
| Functions | `f`, `g`, `h`, `p`, `q`, `r`, then `f_1`, ... |
| Circles, arcs, curves | `c`, `d`, `k`, then `c_1`, ... |
| Polygons, regions | `poly1`, `poly2`, ...; `reg1`, `reg2`, ... |
| Texts | `text1`, `text2`, ... |
| Lists | `L`, `M`, `N`, then `L_1`, ... |
| Booleans | `cond1`, `cond2`, ... |
| Images of a point under a transformation | `A_1`, `A_2` (suffix numbers), because `'` is reserved for rate rules in the grammar |
| Helper objects (hidden by a tool) | the next name for their type, hidden by `Hide(...)` in the same batch |

This is the table in the language design (3.7). The first free name in a sequence wins, and names that are reserved or already used are skipped.

Rules: a name is never reused while an object has it; deleted names are not reused within a session for the sake of undo; the allocator skips names the figure already uses.

Names are for the model and the learner; there is no hidden mapping. A user can rename later (redefinition keeps the id).

## 6. The tools

Notation: `[P]` means a point slot (any of existing / free / on a path / intersection unless stated). `[Obj:Type]` is an object slot. `(n)` is a number slot with inline entry. Lines are the script the tool writes; `{A}` stands for a name the tool allocates. Commands marked † are assumed from other areas' design docs (see section 10).

### 6.1 Move group (`move`)

| Tool id | Clicks and drags | Writes |
|---|---|---|
| `move` | Press on an object and drag (graphics-view 12). Click selects. Background drag pans. Drag on an axis rescales it. | On release, for dragged free values: `A = (1.5, 2)` etc., one batch. No lines for a pure pan. |
| `rotate-around` | `[P centre]`, then drag a draggable object. Its free points rotate about the centre by the pointer's angle change. Shift snaps to 15 degrees. | On release: new values of the free points as `A = (x, y)` lines. |
| `freehand-shape` (v2) | Draw a sketch with the pointer. A recogniser turns it into the nearest of segment, circle, ellipse, triangle, rectangle, polygon. | The recognised command, with new free points where the sketch's corners were. Deferred: needs a recogniser; v2. |
| `record-to-table` | Not applicable: no spreadsheet in v1. A table view could be added later. | |

### 6.2 Points (`point`)

| Tool id | Clicks | Writes |
|---|---|---|
| `point` | `[P free\|on-path\|intersection\|existing]` | The pick as a line: `A = (x, y)`, `A = PointOn(path, s)`, or `A = Intersect(a, b, i)`. If the click hit an existing point, nothing is created and the point is selected. |
| `point-on-object` | `[Obj: path-like]` (click on a path) | `A = PointOn(path, s)`. Clicking on empty space or an interior gives `not_a_path` hint. |
| `attach-detach` | Variant 1: `[Obj:Point free]`, `[Obj: path-like]`. Variant 2: `[Obj:Point on path]`. | Variant 1 redefines: `A = PointOn(path, s)` where `s` is the parameter nearest the point's current position (the point does not jump). Variant 2: `A = (x, y)` at its current value. Both keep id and style. |
| `intersect` | Variant 1: `[Obj: path-like]`, `[Obj: path-like]`. Variant 2: click near a crossing. | Variant 1: one line per intersection, up to 4 (`A = Intersect(a, b, 1)` ...). Variant 2: the single `Intersect` whose index is nearest the click. Functions use `Intersect(f, g, from, to)` with the view's x-range. |
| `midpoint` | Variant 1: `[P]`, `[P]`. Variant 2: `[Obj:Segment]`. Variant 3: `[Obj: Circle\|Conic]` for the centre. | `M = Midpoint(A, B)`, `M = Midpoint(s)`, `O = Center(c)`†. |
| `complex-number` | Deferred: no complex numbers in v1; a point stands for one. | |
| `extremum` | `[Obj:Function]`, then optionally click near a turning point. | Scans the view range for sign changes of the numeric derivative. One line per found extremum, up to 10: `A = Extremum(f, a, b)` where `[a, b]` is the bracket around it. Clicking near one gives just that line. |
| `roots` | `[Obj:Function]` | Scans the view range for sign changes. One line per root, up to 20: `A = Root(f, a, b)`. |

### 6.3 Lines (`line`)

| Tool id | Clicks | Writes |
|---|---|---|
| `line` | `[P]`, `[P]` | `l = Line(A, B)` |
| `segment` | `[P]`, `[P]` | `s = Segment(A, B)` |
| `segment-fixed-length` | `[P start]`, `(length)` | `c = Circle(A, 3)`, `B = PointOn(c, 0)`, `s = Segment(A, B)`, `Hide(c)`. The end point is draggable around the start; the length does not change. |
| `ray` | `[P]`, `[P]` | `r = Ray(A, B)` |
| `polyline` | `[P]` ... repeating; close by Enter or double-click | `p = Polyline(A, B, C, ...)`† |
| `vector` | `[P]`, `[P]` | `v = Vector(A, B)` |
| `vector-from-point` | `[Obj:Point]`, `[Obj:Vector]` | `w = Vector(A, A + v)` (a copy of `v` that starts at `A`). |

### 6.4 Special lines (`special-line`)

| Tool id | Clicks | Writes |
|---|---|---|
| `perpendicular` | `[P]` then `[Obj: Line\|Segment\|Ray\|Vector]`, in either order | `l = Perpendicular(A, m)`. Also accepts `xaxis`/`yaxis` (built-in Line constants, change T7 in section 10). |
| `parallel` | same | `l = Parallel(A, m)` |
| `perpendicular-bisector` | Variant 1: `[Obj:Segment]`. Variant 2: `[P]`, `[P]` | `l = Bisector(A, B)` (core). For a segment: `l = Bisector(s)`†. |
| `angle-bisector` | Variant 1: `[P]`, `[P vertex]`, `[P]`. Variant 2: `[Obj:Line]`, `[Obj:Line]` | `l = Bisector(A, B, C)`, or `l = Bisector(a, b, 1)` and `m = Bisector(a, b, 2)`† for two lines. |
| `tangents` | Variant 1: `[P on conic]` and `[Obj:Conic]`. Variant 2: `[P off conic]`, `[Obj:Conic]`. Variant 3: `[Obj:Function]`, `[P]`. Variant 4: `[Obj:Line]`, `[Obj:Conic]`. Variant 5: `[Obj:Circle]`, `[Obj:Circle]` (common tangents). | `t = Tangent(A, c, 1)`†, `u = Tangent(A, c, 2)` as many as exist (up to 2 from a point, 4 common). Function: `t = Tangent(f, x(A))` (core). |
| `polar-diameter` | Variant 1: `[P]`, `[Obj:Conic]` (polar). Variant 2: `[Obj: Line\|Vector]`, `[Obj:Conic]` (diameter). | `l = Polar(A, c)`†, `l = Diameter(m, c)`† |
| `best-fit-line` | Drag a rectangle around points, or select points in turn and press Enter | `L = [A, B, C, ...]` (hidden helper list) and `l = FitLine(L)`† |
| `locus` | `[Obj:Point dependent]`, `[Obj:Point on path]` | `L = Locus(P, Q)`† (the point `P` as `Q` moves along its path) |

### 6.5 Polygons (`polygon`)

| Tool id | Clicks | Writes |
|---|---|---|
| `polygon` | `[P]` ... repeating, close by clicking the first point or Enter | `p = Polygon(A, B, C, ...)` |
| `regular-polygon` | `[P]`, `[P]`, `(sides)` | `p = RegularPolygon(A, B, n)`†. The first side is `A` to `B`; the polygon is counterclockwise. |
| `rigid-polygon` (v2) | Like `polygon` | `p = RigidPolygon(A, B, C, ...)`† (moves as a body; needs the physics kit) |
| `vector-polygon` (v2) | `[P]` ... repeating | `p = Polygon(...)`, then `p with arrow = edges`. Shown as a closed path of vectors. |

### 6.6 Circles and arcs (`circle-arc`)

| Tool id | Clicks | Writes |
|---|---|---|
| `circle-center-point` | `[P centre]`, `[P through]` | `c = Circle(A, B)` |
| `circle-center-radius` | `[P centre]`, `(radius)` | `c = Circle(A, 3)`; the radius may be an expression such as `r` or `2 * r` (then it is dependent). |
| `compass` | Variant 1: `[Obj:Segment]` or `[Obj:Circle]` for the radius, then `[P centre]`. Variant 2: `[P]`, `[P]`, `[P centre]` | `c = Circle(C, Distance(A, B))` (dependent radius, copies a length). |
| `circle-three-points` | `[P]`, `[P]`, `[P]` | `c = Circle(A, B, C)` |
| `semicircle` | `[P]`, `[P]` | `a = Semicircle(A, B)`† |
| `arc-center` | `[P centre]`, `[P start]`, `[P end]` | `a = Arc(O, A, B)`† (counterclockwise from the start towards the end) |
| `arc-three-points` | `[P]`, `[P]`, `[P]` | `a = CircumArc(A, B, C)`† |
| `sector-center` | `[P centre]`, `[P start]`, `[P end]` | `r = Sector(O, A, B)`† |
| `sector-three-points` | `[P]`, `[P]`, `[P]` | `r = CircumSector(A, B, C)`† |

### 6.7 Conics (`conic`)

| Tool id | Clicks | Writes |
|---|---|---|
| `ellipse` | `[P focus]`, `[P focus]`, `[P on curve]` | `c = Ellipse(F, G, A)`† |
| `hyperbola` | same | `c = Hyperbola(F, G, A)`† |
| `parabola` | `[P focus]`, `[Obj: Line\|Segment\|Ray directrix]` | `c = Parabola(F, l)`† |
| `conic-five-points` | `[P]` x 5 | `c = Conic(A, B, C, D, E)`† (undefined with reason `collinear` or `degenerate` when the points do not define a conic) |

### 6.8 Measurement (`measure`)

All measurement tools write a Number or Angle and give it a readout in the view at the position of the last click (`with readout = ...`, change T8 in section 10). Dragging the readout moves it.

| Tool id | Clicks | Writes |
|---|---|---|
| `angle` | Variant 1: `[P]`, `[P vertex]`, `[P]`. Variant 2: `[Obj:Segment]` x 2. Variant 3: `[Obj:Line]` x 2. Variant 4: `[Obj:Vector]` x 2. Variant 5: `[Obj:Polygon]` | `α = Angle(A, B, C)`; for pairs of segments/lines/vectors `α = Angle(a, b)`†; for a polygon one angle per vertex, `α = Angle(p, k)`†. Orientation: counterclockwise from the first side to the second, so pick order matters. A modifier (Alt) takes the reflex complement. |
| `angle-fixed` | `[P]`, `[P vertex]`, `(angle)` | `A_1 = Rotate(A, 0.6981, V)` and `α = Angle(A, V, A_1)` (40 degrees typed, stored as radians). Direction: counterclockwise by default; Alt for clockwise. Degrees are accepted in the field (`40°`) and stored as radians. |
| `distance-length` | Variant 1: `[P]`, `[P]`. Variant 2: `[P]`, `[Obj:Line]`. Variant 3: `[Obj:Line]`, `[Obj:Line]` (parallel). Variant 4: `[Obj:Segment\|Vector\|Arc]`. Variant 5: `[Obj:Circle]` (circumference). | `d = Distance(A, B)`, `d = Distance(A, l)`, `d = Distance(l, m)`†, `d = Length(s)`, `d = Perimeter(c)`† |
| `area` | `[Obj: Polygon\|Circle\|Conic\|Region]` | `s = Area(p)` |
| `slope` | `[Obj:Line\|Segment\|Ray]` | `m = Slope(l)`†. A slope triangle is v1.5. |
| `create-list` | Select objects in turn or drag a rectangle; Enter | `L = [A, B, C]` (all the same type; mixed types are a refusal) |
| `relation` (query) | `[Obj]`, `[Obj]` | No object is created. The inline popup shows the result of `Relation(a, b)`† (equal, parallel, perpendicular, point on object, intersect, ...). Tolerance and "numerically" are stated. |
| `function-inspector` (v2) | `[Obj:Function]` | A side panel with a table of values and the derivative over a chosen interval. Not a construction. |

### 6.9 Transformations (`transform`)

Object first, then the reference. Preselection works (select a polygon, then pick the tool, then click the mirror).

| Tool id | Clicks | Writes |
|---|---|---|
| `reflect-line` | `[Obj:Shape]`, `[Obj:Line]` | `A_1 = Reflect(A, l)`; for a polygon `p_1 = Reflect(p, l)` |
| `reflect-point` | `[Obj:Shape]`, `[P]` | `A_1 = Reflect(A, M)` |
| `reflect-circle` (inversion) | `[Obj:Shape]`, `[Obj:Circle]` | `A_1 = Reflect(A, c)`† |
| `rotate-angle` | `[Obj:Shape]`, `[P centre]`, `(angle)` | `A_1 = Rotate(A, 0.7854, O)`; the number may be an expression or a slider name. |
| `translate-vector` | `[Obj:Shape]`, `[Obj:Vector]` | `A_1 = Translate(A, v)` |
| `dilate` | `[Obj:Shape]`, `[P centre]`, `(factor)` | `A_1 = Dilate(A, 2, O)` |

`Shape` = Point, Segment, Ray, Line, Circle, Polygon, Curve (core 6.3).

### 6.10 Special objects (`special`)

| Tool id | Clicks | Writes |
|---|---|---|
| `text` | `[Position]` or click a point to attach, then `(text)` in an inline field | `text1 = Text("hello", (x, y))`; attached: `text1 = Text("hello", A)`. The field accepts `{expr}` and `$maths$`. |
| `image` (v2) | `[Position]`, then pick a file | `img = Image(asset, A, B)`† (needs assets) |
| `pen` (v1.5) | Press and draw | `s = Polyline([(…), (…), …])`; the stroke is simplified to a 0.5 px tolerance before saving, typically 20 to 80 points. Not draggable. |
| `freehand-function` (v2) | Press and draw | A fitted function; needs a recogniser. |
| `probability-calculator` | Not in this area; belongs to the statistics area. | |

### 6.11 Action objects (`action`)

These are drawn controls. Their semantics belong to the controls-scripting area; here are their click sequences and the lines assumed.

| Tool id | Clicks | Writes |
|---|---|---|
| `slider` | `[Position]`, then an inline form: name, kind (number / integer / angle), min, max, step, speed | `a = 1 in 0..10 step 0.1`, `a with place = screen(120, 40)` (change T9 in section 10). Angle: `α = 0.5 in 0..tau step 0.01 with unit = angle`. |
| `button` (v1.5) | `[Position]`, then text | `b = Button("Reset", ...)`† |
| `check-box` | `[Position]`, then caption, then select objects to show or hide (click them, Enter) | `cb = true with place = screen(x, y), caption = "Show tangent"`, then `tan with show = cb` for each chosen object. A free Bool is a check box (core section 3). |
| `input-box` (v1.5) | `[Position]`, `[Obj: free Number\|Point]` | `InputBox(a, screen(x, y))`† |

### 6.12 General tools (`general`)

| Tool id | Clicks | Writes |
|---|---|---|
| `move-view` (mode) | Drag the background; wheel zoom | No lines. Changes the view only (the view is not part of the figure's definitions until an `@view` line is written). |
| `zoom-in` (mode) | Click: zoom 1.5x about the click. Drag: zoom to that rectangle. | None |
| `zoom-out` (mode) | Click: zoom out 1.5x about the click | None |
| `show-hide-object` (edit) | Click objects to toggle. While active, hidden objects appear ghosted at 25% so they can be clicked. | `Show(A)` or `Hide(A)`; refused with `conflicting_style` on a formula show-if (the click shows the hint). |
| `show-hide-label` (edit) | Click objects to cycle `name`, `none` (and `value` for numbers) | `A with label = none` |
| `copy-style` (edit) | `[Obj source]`, then click targets | `B with color = ..., width = ..., ...` (the source's whole resolved style, written explicitly) for each target |
| `delete` (edit) | Click an object | `Delete(obj)`. The toast names what went: "Removed circle c and 2 objects built on it. Undo". |

**Count.** Move 4, Point 8, Line 7, Special line 9, Polygon 4, Circle and arc 9, Conic 4, Measurement 8, Transformation 6, Special 5, Action 4, General 7 = 75 listed rows. Counting each multi-variant tool by its variants (Angle has five, Tangents five, Distance five, Intersect two, Midpoint three, Polar two, Compass two, Perpendicular two, and so on) gives about 95 behaviours. The manual's 110 includes the 3D tools, notes-app drawing tools and per-variant icons, which are out of scope.

## 7. Behaviour details

### 7.1 Escape, undo and repeat

- `Esc`: remove the last pick if there is one; with no picks, switch to Move. `Backspace` removes the last pick without leaving the tool.
- Tools stay active after finishing (`sticky`), except `move*`, `delete`, and tools that open a form (slider, text), which return to the tool the user was in before a short grace period.
- Ctrl+Z after a tool undoes the whole construction (one group).

### 7.2 Moving while building

A pending point can be dragged before the next click (touch): press, drag, release moves it, so a learner can place a point precisely on touch. This replaces the double-tap hacks of other apps.

### 7.3 What counts as a path-like object

`Line`, `Ray`, `Segment`, `Circle`, `Arc`, `Polygon` (boundary), any conic, `Function`, `Curve`, `Vector`. `Region` and `Sector` borders are paths; their interiors are not.

### 7.4 Tool filters from the view

Each pick asks the view's hit index with the slot's type filter (graphics-view 10.6). Because the filter runs before ranking, clicking a point that lies on a line selects the point for a Point slot and the line for a Line slot, with no special code.

### 7.5 Numbers entered by the learner

- Accepts `3`, `2.5`, `1/3`, `2*r`, `r`, `40°`, `pi/4`. Any Number expression the language accepts.
- If the expression refers to a free number, the new object depends on it (so the radius follows the slider).
- A literal number is saved as-is; a hold-down Alt on commit turns a literal into a new slider `r = 3 in 0..10` and uses its name, for a learner who wants to animate the radius.
- Angle fields default to degrees when the typed text ends in `°` or `deg`, and radians otherwise; the field shows the unit.

### 7.6 Pointer types

Mouse: hover previews. Touch: no hover; the preview appears at the finger while it is down, the pick commits on release. Pen: as mouse with larger slack.

### 7.7 Accessibility of tools

- The toolbar is a roving-tabindex toolbar with arrow keys; each tool has a name and a description of its steps.
- A tool can be run entirely from the keyboard: arrow keys move a virtual cursor (nudge by grid step), Enter acts as a click, Tab cycles the hit list at the cursor.
- The hint line is an `aria-live="polite"` region ("Circle. Click the centre point.", "Now click a point on the circle.").
- Results are announced: "Created circle c with centre A through B."

## 8. Performance targets

| Measure | Target |
|---|---|
| Hit list for a slot | under 0.3 ms at 1,000 objects |
| Dry run for a preview | under 0.5 ms |
| Commit (parse to paint) for a 3-line batch | under 3 ms |
| Tool switch | under 1 frame |
| Build-time check of all specs against the command table | under 100 ms, fails the build on a mismatch |

## 9. Better than GeoGebra

- **Tools as data**: listable, testable, translatable, and printable for the model (it learns which constructions a learner can do and speaks about them with the same words).
- **No orphan objects**: nothing exists until the last click.
- **One undo step per construction.**
- **Same lines as the model writes**: a learner's construction is readable and editable as text.
- **Previews from dry runs**: what you see is what you get, with explained refusals.
- **Typed ambiguity checks at build time** for variants.
- **Inline numeric entry with formulas**, not a modal dialog, and dependent values from names.
- **Many-object tools do not need extra code**: Roots, Intersect and Tangents emit as many lines as needed.
- **Hit cycling** at ambiguous clicks.
- **Keyboard-complete**, with a virtual cursor.
- **Custom tools are the same type**: a `ToolSpec` with a `template` (a script with parameters) and slots from its inputs; no macro engine is needed. (Designed here; built after v1.)

## 10. Changes to the core design

| # | Change | Why |
|---|---|---|
| T1 | `kernel.dryRun(lines)` (graphics-view C6) and `kernel.applyBatch(lines)` with one undo group (C7). | Previews and atomic tools. |
| T2 | A name allocator service owned by the kernel, with the sequences of section 5.7. | Tools and the teacher both need fresh names; they must not collide. |
| T3 | Image names use `A_1`, not `A'`, because `'` is reserved for rate rules. | Grammar. |
| T4 | `Hide` and `Show` accept several objects (already in core 6.6) and return the list of names changed. | `show-hide-object` batch. |
| T5 | Free redefinition across `Point` kinds is allowed: `A = (x, y)` ↔ `A = PointOn(path, s)`, since both are `Point`. | `attach-detach`. Core says type must match; this is satisfied, but the doc should name it. |
| T6 | Add the commands marked † to the command table owner lists (points-lines, conics, curves-loci, polygons-transforms, controls-scripting). The names are ordinary maths words. | Tools need them; see cross-area. |
| T7 | Built-in constants `xaxis` and `yaxis` of type `Line`. | Tools need to pick axes; scripts need to write `Perpendicular(A, xaxis)`. |
| T8 | Style property `readout` on a Number or Angle: draws `name = value` as text at a maths or view anchor. | Measurement tools. |
| T9 | Style property `place` for sliders, check boxes and other widgets: a view anchor `screen(x, y)` or `screen(x, y, from)`. | Widgets must sit at a fixed spot of the view. |
| T11 | Actions `Suggest(toolId)` (pulse a tool for the learner) and directive `@tools group...` (limit the toolbar). Neither is saved in a figure's objects. | Teacher steering of learner tools (agent.md, ui.md). |
| T10 | A learner-events channel to the teacher: `learner_lines`, `learner_moved`, `learner_selected`, `learner_view`. | The teacher sees what the learner built. |

## 11. Sources studied

GeoGebra source (read-only, commit 3608374), under `source/shared/common/src/main/java/org/geogebra/common/`:

- `euclidian/EuclidianConstants.java` (list of tool modes)
- `euclidian/EuclidianController.java` (structure and size; how modes read picks)
- `euclidian/modes/`
- `euclidian/Hits.java`, `euclidian/HitDetector.java`
- `euclidian/EuclidianView.java` (selection and hit loops)
- `euclidian/PathTracker.java`
- `euclidian/SnapController.java`

Manual pages (https://geogebra.github.io/docs/manual/en/):

- `Tools/`, `Tools_Menu/`
- `tools/Angle/`, `tools/Tangents/`, `tools/Attach_Detach_Point/`
- `Graphics_View/`
- Tool groups checked from the manual's tool listing and from the mode list above: Movement, Point, Line, Special Line, Polygon, Circle and Arc, Conic, Measurement, Transformation, Special Object, Action Object, General.
