# Board: design

Status: accepted for building, web first. Package `packages/board`, published as `@incantly/board`. Builds on `@incantly/view` (renderer, back-ends, scheduler) and `@incantly/sdk` (live figures), and follows `docs/design/performance.md`. The React Native side is designed here and built later; this document is the contract it must meet.

The board is a separate product from the Tiptap extension (`docs/features/tiptap/`). Tiptap puts live figures inside a document; the board is where a teacher or learner writes and works out solutions by hand. The board does not use Tiptap or ProseMirror; the two share only the engine (kernel, SDK, view).

Every state in the board is explicit: one field per part, changed only through a `*_MACHINE` table (`StateMachine` from `@incantly/kernel`), written in `docs/state-machines.md` before the code. `packages/board` has every lint rule of `AGENTS.md` ("Rules are checked by code") as an error.

## 1. What it does

An endless, paged board for teaching. A teacher or learner writes with a pen that feels like ink, draws shapes, drops live Incantly figures, and talks to an agent that writes and draws on the same board. The board is the surface the live teacher uses (core design section 10).

Sub-features:

1. A document of **pages**. Each page is an endless plane with its own camera.
2. **Ink** with pressure, tilt and every pen sample, drawn with no visible lag.
3. **Shapes**: rectangle, ellipse, triangle, diamond, star, line, arrow, text, sticky note, frame, image, and the **figure card** (a live figure from the SDK).
4. **Editing**: select, move, resize, rotate, group, align, snap, copy, paste, undo and redo.
5. **Shape fixing**: a rough hand-drawn shape held still becomes a clean shape.
6. **Two agent modes**: circle something and ask, or talk to an agent that writes and draws (section 11, `agent.md`).
7. **Customisation**: every tool, toolbar, icon, menu, key and string can be changed or removed by the host app (section 10).
8. **One core for web and mobile**: only the input layer and the drawing layer differ (section 3).

## 2. Words

| Word | Means |
|---|---|
| Document | One board file: its pages, records and assets |
| Page | An endless plane with its own records, camera and history position |
| Record | One plain JSON object in the store: a shape, a page, a binding, an asset, a camera |
| Shape | A record drawn on a page; it has a `kind` (`ink`, `rect`, `figure`, …) |
| Kind | A registered shape type: its default props, its geometry, how it draws |
| Binding | A link between two shapes, such as an arrow end stuck to a box |
| Tool | A state machine that turns input into store changes (pen, select, rect, …) |
| Page units | The coordinates of a page; 1 unit is 1 CSS pixel at zoom 1 |

## 3. Layers

The board has four layers. Layers 1 and 2 hold all logic and have no DOM, no timers of their own, no network and no `Date`; they run in Node, a worker, a browser and React Native.

| Layer | Holds | Web | React Native (later) |
|---|---|---|---|
| 1. Board core | Store, records, pages, history, camera, geometry, spatial index, tools as state machines, ink maths, shape fixing, file format, agent actions | `packages/board/src/core` | The same code |
| 2. Engine | Kernel, SDK headless app, teacher | Existing packages | The same code |
| 3. Input | Turns pen, touch, mouse and keys into one stream of `InputSample` and `KeyInput` | `src/web/input.ts`: Pointer Events | `react-native-gesture-handler` stylus data |
| 4. Drawing | Turns the core's draw list into pixels | `src/web/painter.ts` on the view package's WebGL 2 back-end, Canvas 2D as backup | A Skia surface that implements the same `BoardPainter` interface |

The UI shell (toolbar, menus, page list) sits on top. On the web it is Web Components in `src/web/ui/`. It reads and writes the core only through its public API, so a host can replace it, and React Native writes its own.

The two contracts between layers:

```ts
/** Layer 3 to layer 1: one pen, touch or mouse sample, in screen pixels. */
interface InputSample {
  readonly pointer: number;          // stable id while the pointer is down
  readonly device: 'pen' | 'touch' | 'mouse';
  readonly phase: 'down' | 'move' | 'up' | 'cancel' | 'hover';
  readonly x: number; readonly y: number;
  readonly pressure: number;         // 0..1; NaN when the device has no sensor
  readonly tiltX: number; readonly tiltY: number;   // degrees, 0 when unknown
  readonly twist: number;            // degrees, 0 when unknown
  readonly buttons: number;          // bit 1 tip, 2 barrel, 32 eraser end
  readonly time: number;             // ms, from the input layer's own clock
  readonly predicted: boolean;       // a guess of a future sample; never stored
}

/** Layer 1 to layer 4: what to draw this frame. */
interface BoardPainter {
  beginFrame(camera: CameraView, dpr: number): void;
  drawTile(tile: TileKey, content: TileContent): void;       // cached finished content
  drawItems(items: readonly DrawItem[]): void;               // the view package's draw items
  drawLiveStroke(stroke: LiveStroke): void;                  // the stroke being drawn, on its own layer
  drawOverlay(overlay: OverlayItems): void;                  // selection, handles, snap guides, laser, lasso
  endFrame(): void;
}
```

`DrawItem` is the view package's existing draw list item, so board shapes and figure pictures use one tessellator and one set of shaders.

## 4. The store

- One store per document. It holds records keyed by id (`shape:…`, `page:…`, `binding:…`, `asset:…`, `camera:…`). Every record is JSON.
- Every write is a **transaction**: `board.change(origin, fn)`. All the writes in one transaction are checked against the kind's schema, applied together, and sent to listeners as one diff `{ added, updated, removed }`. `origin` is `user`, `model`, `host` or `remote`, as for kernel lines.
- **Reactivity**: listeners get diffs; derived values (geometry, bounds, the spatial index, page thumbnails) are cached per record and dropped when that record changes. Nothing recomputes for a record that did not change.
- **History**: one undo stack per document. A transaction is one step; a drag or a stroke is one step however many samples it had. A model's transactions are steps too, so a learner can undo an agent. `history: false` writes (camera, selection, pictures) are not steps.
- **Props are never written in place; a change writes a new record.** A stored record and its `props` are frozen (shallow) when they are written, so a write in place fails. Every copy of a record (duplicate page, and paste in round 3) gives the copy its own `props` and `meta` through `copyProps`, a deep copy of plain data and typed arrays, so a copy shares nothing with the original or with the undo history.
- **Errors** have the shape of the SDK and the Tiptap extension, `{ ok: false, kind, message, hint?, detail? }`, not the kernel's line error (a board error has no line or column). `errors.md` lists the kinds.
- Limits: 10,000 shapes per page, 100 pages per document, 2 million ink points per page, 50 MB of assets per document. Over a limit, the transaction is refused (`errors.md`); a load does not test the limits, so a board that a lowered limit would refuse still opens.

Records:

```ts
interface ShapeRecord<K extends string = string, P = unknown> {
  readonly id: string;               // 'shape:…'
  readonly page: string;             // 'page:…'
  readonly kind: K;
  readonly x: number; readonly y: number;    // page units, the shape's origin
  readonly rotation: number;         // radians
  readonly parent: string | null;    // a frame or group id
  readonly index: string;            // fractional order key within the parent
  readonly locked: boolean;
  readonly opacity: number;
  readonly props: P;                 // the kind's own data
  readonly meta: Readonly<Record<string, unknown>>;   // the host's own data, kept and synced, never read by the board
}

interface PageRecord { readonly id: string; readonly name: string; readonly index: string; readonly background: 'none' | 'grid' | 'dots' | 'lines'; }
interface CameraRecord { readonly id: string; readonly page: string; readonly x: number; readonly y: number; readonly zoom: number; }
interface BindingRecord { readonly id: string; readonly kind: 'arrow'; readonly from: string; readonly to: string; readonly props: unknown; }
```

`index` keys are fractional strings, so moving one shape forward never rewrites the others.

## 5. Pages

- A document has one to 100 pages, in order. Each page is endless and has its own camera, which is saved.
- Only the **current page** is in the spatial index and the tile cache. Other pages keep their records but no derived data; switching builds the index from the records (budget in section 13).
- A page's thumbnail is a picture made when the page is left, not an undo step.
- Commands: `addPage`, `removePage` (the last page cannot be removed), `renamePage`, `movePage`, `duplicatePage`, `goToPage`. Each is one undo step except `goToPage`.
- Figure cards on other pages are not mounted; the scheduler only sees figure cards on the current page.

## 6. Ink

### 6.1 Samples to stroke

1. The input layer gives every sample, including the ones the browser merged (`getCoalescedEvents`), in screen pixels. The core turns them into page units with the camera.
2. A sample closer than 0.5 screen pixels to the previous one is dropped, unless pressure changed by more than 0.05.
3. Pressure: from the pen when it has a sensor. A mouse, or a pen that reports exactly 0.5 for every sample, gets **simulated pressure** from speed (fast is thin), so a mouse line still looks like ink.
4. Tilt makes the nib wider across the tilt direction for the `marker` and `highlighter` nibs; the `pen` nib ignores tilt.
5. A stroke is stored as its samples, not its outline: `points: Float32Array` of `x, y, pressure` triples (and `tiltX, tiltY` when the nib uses them), relative to the shape's origin. The outline is derived and cached.

### 6.2 Outline

Our own code in `core/ink/outline.ts` (no library; `docs/design/libraries.md` is unchanged):

1. Smooth the points with a short moving window weighted by distance (streamline), so a shaky hand gives a steady line.
2. Width at each point: `size * (1 - thinning + thinning * pressure)`, eased, with the speed taper for simulated pressure.
3. Offset each point left and right of the direction by half its width, on the bisector of the two segments; round caps at both ends; a turn of more than 30° gets its own offsets on each segment and a round arc on the outer side, so the line does not pinch (a turn over 120° always needs it).
4. The outline is written as indexed triangles of one winding: a quad for each segment, a fan for each cap and each arc. Their union is the stroke, so no general polygon tessellator is needed and a sharp turn cannot make the outline cross itself. The triangles are cached by what they are made of: the stroke's points array (a stored record keeps its array while the points are the same), its stride, size and nib, and the zoom step's tolerance. A move writes a new record with the same points array, so moving or panning never rebuilds them; a change of points is a new array and a new outline; a zoom step rebuilds the arcs only.
5. The live stroke does not rebuild its outline each frame: a point is final once the point eight after it exists (the streamlining, the width and the tilt read a few neighbours), so each frame keeps the triangles of the settled points and makes the last few segments again, and writes into arrays it keeps and doubles when they are full, so drawing makes no garbage. The result equals a full build of the same points.

### 6.3 Drawing it with no lag

- The stroke being drawn is on its own **live layer**. Each frame draws only the new segment onto it; nothing else on the board redraws.
- Predicted samples (`getPredictedEvents`) draw a short tail on the overlay, cleared every frame and never stored.
- On the web the live layer's canvas asks for a low-latency context (`desynchronized: true`) where the browser offers it.
- On release, the outline is built, the stroke joins the page, and its tile is redrawn once.

### 6.4 Ink tools

| Tool | Does |
|---|---|
| Pen | Pressure ink, nibs `pen`, `marker`, `pencil` |
| Highlighter | Wide, see-through, drawn under ink and shapes |
| Eraser | Whole-stroke mode removes any stroke it touches; partial mode cuts strokes where it passes. The pen's eraser end picks the eraser for as long as it is used |
| Laser | A fading trail for pointing; never stored, shown to others in a shared session |
| Lasso | Selects the items it encloses (more than half of a stroke's points, or a shape's centre). The index grid gives the strokes whose boxes meet the loop; a stroke whose box is wholly inside is in with no point test, and only the others count points, stopping as soon as the answer is known |

### 6.5 Palm and finger

While a pen is down or hovering, touches are ignored for drawing; two-finger touches still pan and zoom. A host can turn on "pen only" (touch never draws) or "touch draws" (for a finger on a phone).

## 7. Shapes

### 7.1 Kinds

| Kind | Props (main ones) | Notes |
|---|---|---|
| `ink` | `points`, `nib`, `size`, `color`, `opacity` | Section 6 |
| `rect`, `ellipse`, `triangle`, `diamond`, `star` | `w`, `h`, `fill`, `stroke`, `dash`, `size`, `label` | `label` is text inside |
| `line` | `points` (2 or more), `stroke`, `dash` | Points can be dragged |
| `arrow` | `start`, `end`, `bend`, heads | Ends stick to shapes through bindings |
| `text` | `text`, `font`, `size`, `align`, `w` (auto or fixed) | Maths between `$…$` is typeset by the view package's maths layout. An auto width is as wide as the laid-out boxes reach (the ink of an italic letter included), so no maths is cut off at the box |
| `sticky` | `text`, `color` | Fixed size, grows with text |
| `frame` | `w`, `h`, `name` | Holds children; clips them; can be a slide |
| `image` | `asset`, `w`, `h`, `crop` | PNG, JPEG, WebP, SVG (checked, as SDK files) |
| `figure` | `script`, `mode`, `w`, `h`, `picture` | A live Incantly figure (section 8) |

### 7.2 Geometry and kinds as plug-ins

Each kind is registered with a `KindDef`:

```ts
interface KindDef<P> {
  readonly kind: string;
  readonly defaults: P;
  check(props: unknown): Result<P>;                       // schema check on every write and load
  geometry(shape: ShapeRecord<string, P>): Geometry;      // outline, bounds, hit test; cached by the core
  draw(shape: ShapeRecord<string, P>, lod: Lod): readonly DrawItem[];   // cached until the shape changes or the LOD step changes
  handles?(shape: ShapeRecord<string, P>): readonly Handle[];
  onResize?(shape: ShapeRecord<string, P>, box: Box): Partial<P>;
  canCull?: boolean;                                      // default true
  migrate?(props: unknown, fromVersion: number): unknown;
}
```

A host adds its own kind with `board.kinds.register(def)`. Built-in kinds use the same interface.

**Default sizes.** The size of a shape made by a click is in the kind's `defaults` (`w` and `h`), and the shape tools read it from there, so a host's own kind in a shape tool follows the same rule and no tool keeps a size of its own. The built-in sizes: rect and ellipse 120 × 80, triangle and diamond 120 × 100, star 110 × 105, frame 400 × 300. A box kind's `check` fills a missing `w` or `h` from the same defaults.

### 7.3 Shape fixing

When a pen stroke ends and the pen is held still for 500 ms (or on "fix" from the toolbar), `core/ink/recognise.ts` looks at the stroke. An open stroke is a straight line, else an arrow (a line with a head). A closed stroke looks for its corners first: the stroke is simplified, points that lie on a side (the pen turns by under 20°) are dropped, and a corner is clear when the pen turns by more than 45° at it. With 3 to 6 clear corners the stroke is tried as a polygon (a rectangle when it has four right angles) before the ellipse, so a drawn pentagon or hexagon is a polygon and not a circle. The ellipse still wins when it is the closer fit (the mean distance to the ellipse is smaller than to the polygon), so a drawn circle stays a circle: a circle has no clear corners, and a hexagon laid over a circle is further from it than the circle is. A closed stroke with no such corners is tried as a circle or ellipse. A fit is kept only when the mean distance from the stroke to the clean shape is under 6% of the shape's size. The stroke is replaced by the clean shape in one undo step; undo gives the ink back. No match leaves the ink.

### 7.4 Editing

- Select by click, Shift-click, box drag or lasso. Selected shapes show handles: 8 resize handles, one rotate handle, and the kind's own handles (arrow bend, line points). A line or an arrow alone shows only its own handles (its ends and bend, or its points), because a box and a turn mean little for a line; with other shapes in the selection, the box with 8 handles and the rotate handle shows.
- A drag, a resize, a rotation, a shape being made and an eraser stroke write through one gesture (`beginGesture` in `core/edit.ts`, B25). Each write is one transaction with the gesture's merge key, so the whole gesture is one undo step. The gesture keeps what every write changed (read from the store's diffs: the shape, the arrows that followed it, a binding it dropped or added, the members of a group), so a cancel puts back every one of those records and leaves no undo step. A tool never lists what to put back; `eslint.config.js` makes a `.change(` call in `core/tools/` an error.
- Snap while moving and resizing: to other shapes' edges and centres, to equal gaps, and to the page grid when it is shown. Snap guides draw on the overlay.
- Align, distribute, bring forward, send back, group, ungroup, lock, duplicate, flip. Front, back, forward and backward keep the selection's own order: a selection moved to the back stays in the same order relative to itself.
- Copy and paste: inside a document and between documents as JSON records with a type tag; pasting plain text makes a text shape; pasting an Incantly script (header `# incantly 1`) makes a figure card; pasting an image makes an image shape.

## 8. Figure cards

- A figure card stores its script, mode and size, as the Tiptap figure node does (`docs/features/tiptap/design.md` 2). The script is the only source of truth; `picture` is a cache.
- Every figure card on the current page registers with one `SchedulerHost` (view package) per board. At most 3 are live; the rest show their picture inside the board's normal drawing.
- Web: a live figure is a `createApp` host element placed over the board canvas and moved with the camera (a CSS transform, no re-layout). The host is laid out for the steady zoom (between 0.5 and 3) and scaled by the rest. While the camera moves (a pan or a zoom), live figures show a snapshot of their canvas (the card's picture for 3D) and hide the app; 150 ms after the camera stops the host is sized for the new zoom and the app paints again (`web/figures.ts`, B26 to B28).
- The layer reads the figure shapes of the current page from the store and keeps one card for each; it tells the scheduler which are in view and near from the camera, so a card on another page is never mounted. A card with no `picture` that is not live gets one made from its script in a headless app, one at a time; a live card writes its picture 500 ms after it first paints. The picture is written with `history: false`, and a change of script or mode clears it in the same undo step.
- The card toolbar (edit lines, mode, play or pause, delete) is a bar over the selected card; edit lines is a panel with the script that writes through `setFigureScript`, so the live card follows the store like an undo does. A figure card in `readOnly` can be used (drag, play) but not changed.
- React Native: the same card uses the SDK core with the Skia painter. No other change.
- Double-click (or Enter) on a card gives it the input: drag points, move sliders. Esc gives the input back to the board.

## 9. Camera, culling, tiles

1. **Camera**: `x, y, zoom` per page; zoom from 0.05 to 20. Wheel and pinch zoom about the pointer; Space-drag, middle-drag and two fingers pan.
2. **Spatial index**: a sparse grid of 512-unit cells per page, each holding the ids of shapes whose bounds touch it. Insert, move and remove cost the cells a shape touches. Queries for the viewport, a hit point, a lasso or a box read only those cells.
3. **Culling**: only shapes in the viewport (plus a 256-pixel margin) are drawn. Selected shapes and the shape being edited are always drawn.
4. **Tiles**: finished content is drawn into 512 × 512 device-pixel tiles at power-of-two zoom steps. Panning draws tiles. A changed shape marks only the tiles it touches. Tiles are kept in a least-recently-used cache with a memory cap (64 MB default, 24 MB on a device with 4 GB or less).
5. **Steady zoom**: while the zoom changes, tiles of the nearest step are scaled; the exact step is drawn 150 ms after the zoom stops. Stroke widths and text use that steady zoom, so nothing re-tessellates mid-zoom.
6. **Level of detail**: below a shape's size threshold on screen, kinds draw less (sticky notes without a shadow, dashed lines solid, text under 4 px as a grey bar, images at a lower resolution, figure cards as their picture).

## 10. Customisation

The host app decides what the board looks like and which tools exist. Everything here is data or a plain function; there is no hidden default that cannot be changed.

```ts
const board = createBoard({
  container,                         // web only; omit for headless
  document,                          // a saved board, or nothing for a new one
  tools: defaultTools.without('star').with(myStampTool),
  toolbar: {
    position: 'bottom',              // 'top' | 'bottom' | 'left' | 'right' | 'none'
    groups: [['select', 'pen', 'highlighter', 'eraser'], ['rect', 'ellipse', 'arrow', 'text'], ['figure', 'ask']],
  },
  icons: { pen: myPenSvg, ask: (doc) => myIconElement(doc) },   // SVG text or a factory
  keys: { pen: 'p', eraser: 'e', undo: 'mod+z', redo: ['mod+shift+z', 'mod+y'] },   // or false to remove a key
  menus: { context: (items, target) => [...items, myItem] },     // add, remove or reorder items
  strings: { 'tool.pen': 'Stylo' },                             // every label, tooltip and spoken name
  theme: { /* CSS variables: colours, radius, font, toolbar size */ },
  ui: { pages: true, zoom: true, minimap: false, styleBar: true },
  pen: { touchDraws: 'auto' },       // 'auto' | 'never' | 'always'
  agent: { transport },              // section 11; no agent without it
  limits: { shapesPerPage: 10_000 },
  readOnly: false,
});
```

- **Tools** are registered with `ToolDef`: an id, an icon, a label, a key, and a state machine of handlers (`onDown`, `onMove`, `onUp`, `onKey`, `onCancel`) that call the core API. Built-in tools use the same interface; `defaultTools` is a list a host filters.
- **Toolbar** ids are tool ids and the buttons `image`, `figure`, `fix`, `undo`, `redo` and `more-shapes`; `ui.labels` shows each name beside its icon, and `toolbar.position` is `top`, `bottom`, `left`, `right` or `none`. Figure is a button that makes a card, not a tool. It is built from `toolbar.groups`; an unknown tool id is reported (`tool_unknown`) and left out. A host can hide the toolbar and call `board.setTool(id)` from its own UI. The default board view lists the tools in the order of `ui.md` and puts triangle, diamond and star in a More shapes menu on the rectangle's group, so the toolbar is one row.
- **Icons**: every built-in icon can be replaced by SVG text (checked: no script, no event attributes, no outside links) or by a factory that returns an element.
- **Keys**: one map from action to key strings; `mod` is Ctrl or Cmd. A key used twice is reported (`shortcut_conflict`) and the later one is dropped. The host's entries are read first, in the order it wrote them, so its key beats a default; `false` removes an action's keys. The actions are the tool ids and `undo`, `redo`, `delete`, `selectAll`, `duplicate`, `group`, `ungroup`, `forward`, `backward`, `front`, `back`, `zoomIn`, `zoomOut`, `zoom100`, `zoomFit`, `zoomSelection`, `nextPage`, `prevPage`, `figure` (`core/keymap.ts`, B30).
- **Menus**: the context menu, page menu and main menu are lists of `MenuItem { id, label, icon?, key?, enabled(target), run(target) }`, built by functions the host can wrap.
- **Theme**: CSS custom properties on the board element, so the host's styles win; light, dark and high contrast are built in.
- **Strings**: every visible or spoken string goes through one table: the host's `strings`, then its `translate` function (a studio gives the app-modes `I18n` over `board.<key>`), then the English table of `core/strings.ts`, then a tool's own label.
- **Read only**: `readOnly` keeps the hand and the laser, hides the style bar, the selection bar, the edit buttons and the context menu, and leaves figure cards usable.
- **Page paper**: a page's `background` (plain, grid, dots, lines) is drawn in each tile under the shapes (`drawBackground2D`), so it costs nothing while panning.
- **Headless**: without `container`, `createBoard` returns the core only (store, pages, tools, agent actions) for servers, tests and a host's own UI.

## 11. Agents on the board

Two ways in; both go through the same **board actions** (`agent.md`), and every agent change is a normal transaction with origin `model`, so it can be undone.

### 11.1 Circle to ask

1. With the **Ask** tool (or the pen's barrel button held), the user circles part of the board.
2. The core finds what is inside: shapes, ink, figure cards, text. It builds a short description of each: kind, text, a figure's summary, an ink group's recognised shape.
3. The board shows suggestions next to the circle, at once, from the item kinds alone:

| Inside the circle | Suggestions |
|---|---|
| A hand-drawn curve | Make it a graph; find its formula |
| Written or typed maths | Solve it; show the steps; graph it |
| A drawn triangle or polygon | Measure it; make it a geometry figure |
| A figure card | Explain it; animate it; add a slider |
| Anything | Ask something else (a text box) |

4. When the user picks one, the board sends the request, the description and, where the model reads pictures, a picture of the circled area to the server. Lines come back through the teacher package's `draw` tool.
5. The answer lands on the board: a new figure card beside the circle, joined to it by an arrow, plus any text the agent writes. Lines stream into the card as they arrive, as in Tiptap (`docs/features/tiptap/design.md` 9).

Handwriting is read only when the model can read pictures (open question 1). Without that, the circle works on shapes, typed text, figure cards and ink the shape fixer recognises.

### 11.2 Talking agent

The live teacher (core design section 10) gets two more tools, `board` and `board_read` (`agent.md`). With them it writes text in a hand style or typed, draws shapes and arrows, makes pen strokes that animate as if drawn by hand, highlights or circles things, points with the laser, makes figure cards from lines, moves the camera, and changes page. It reads the board as a list of items with their places, so it can say "the triangle on the left".

### 11.3 The client

`packages/board` defines the protocol and the client, as `packages/tiptap` does, because `packages/server` is not built yet. `BoardAgentTransport = (request, signal) => AsyncIterable<BoardAgentEvent>`; the default is an HTTP client for `POST {server}/v1/board/ask`, NDJSON answers. Without a transport, the Ask tool says the agent is unavailable (`agent_unavailable`).

## 12. Saving

- A document saves as `.incantly-board`: JSON `{ format: 'incantly-board', version: 1, pages, records, assets, meta }`, deterministic (sorted keys, fixed number format) so the same board gives the same bytes.
- Ink points are stored as base64 of delta-encoded 16-bit integers in hundredths of a unit, with pressure in 8 bits; about 5 bytes a point.
- Figure cards keep their script as text; a board opens with every figure from its lines, never from stored values.
- Assets are checked by magic number as SDK files are; SVG images with script or outside links are refused.
- Load checks every record against its kind (`board_invalid` names the record and the field), runs migrations, and keeps records of an unknown kind as they are, drawn as a grey box, so a newer board loses nothing in an older app.
- Autosave is the host's job; `board.on('change', diff)` gives every diff with its origin, and `board.snapshot()` gives the whole document.

## 13. Performance

All of `docs/design/performance.md` applies. The board's own budgets, measured on the 4 GB laptop (Chrome with the CPU 4× slower) and in Node:

| What | Budget |
|---|---|
| Pen sample to pixel on screen | under 16 ms; 8 ms on a 120 Hz screen |
| Core work per input sample | under 0.1 ms |
| One frame while drawing a stroke | under 2 ms of script |
| Pan and zoom with 10,000 shapes on the page | 60 fps; frame under 8 ms |
| Hit test at a point | under 0.1 ms |
| Lasso of 2,000 strokes | under 4 ms |
| Open a 1,000-shape board | under 200 ms to first picture |
| Switch to a page of 2,000 shapes | under 100 ms |
| Undo of a 500-shape paste | under 16 ms |
| Garbage while drawing | none (0 collections over a 10 s stroke) |
| Memory for 100,000 ink points | under 8 MB in the store |

How:

1. Flat typed arrays for points; one reused sample buffer in the input layer.
2. Derived data (geometry, outline, draw items) cached per record, dropped only when that record changes.
3. Transactions batch every change; listeners and the renderer see one diff.
4. Tiles for finished content; the live layer for the stroke being drawn; the overlay for handles and guides.
5. Culling through the spatial index; level of detail by on-screen size.
6. At most 3 live figure cards; the rest are pictures.
7. No per-shape animation: the laser and the agent's hand-drawn strokes animate on the overlay or the live layer only.
8. A performance monitor: frame times, the slowest 5% of frames, input lag, tiles drawn, shapes culled, as events (`board.perf.on(…)`) with no cost when nobody listens.

## 14. React Native (designed, not built)

- `@incantly/board/core` is imported as it is.
- Input: `react-native-gesture-handler` gives pen, touch and stylus data (pressure, tilt) on the native thread; an adapter turns each event into `InputSample`. A spike checks the stylus data on iPad and Android before the build.
- Drawing: a `BoardPainter` on React Native Skia. Tiles are Skia pictures; the live stroke is one path appended to each frame; only new points cross from JavaScript to native each frame.
- Figure cards: the SDK core with the same painter, under the same scheduler.
- UI shell: React Native components that call the same core API and read the same customisation options.
- The board file, the agent client and every test of the core are shared.

## 15. Changes to other areas

- `docs/design/libraries.md`: none. Ink outline and shape fixing are our own code.
- `packages/view`: the board uses its draw items, back-ends and scheduler; a tile cache may move there if the 2D view needs it too.
- `packages/teacher` and `packages/server`: gain the `board` and `board_read` tools and the `/v1/board/ask` route when they are built.
- `.kiro/steering/structure.md`: adds `packages/board`.
- App modes: the `notes` mode's view kind becomes the board.

## 16. Open questions

1. Can Muse Spark read pictures? If yes, circle to ask reads handwriting from a picture of the circle. If no, it works on shapes, typed text, figure cards and recognised ink only.
2. Shared boards (many people at once): the diffs and origins are ready for it, but a sync library (Yjs is not on the allowed list) or our own relay through `packages/server` is a later decision.

## Sources studied

- tldraw SDK public documentation on performance (viewport culling, reactive updates, batched store changes, steady zoom, geometry caching, level of detail, performance events) and on its store. Ideas only; we read no tldraw source, and use none of its code or names.
- MDN: `PointerEvent.getCoalescedEvents()`, `getPredictedEvents()`, `pressure`, `tiltX`, `tiltY`; the WICG ink-enhancement explainer on predicted points.
- React Native Gesture Handler and React Native Skia public documentation, for section 14.
- The pressure-stroke outline method (smoothing, pressure to width, offset, round caps), as described in public articles; our code is our own.
