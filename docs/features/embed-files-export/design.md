# Embedding API, file format, export and sharing: design

Status: draft. The embed API and file format are v1 (the product needs them to host the figure, save it and show it in a film). Export beyond PNG and SVG, and sharing links, are stage 2.

## 1. What it does

### For a learner

- A figure inside a lesson page, a film or a worksheet that behaves like the full app: drag, play, type lines.
- Save a figure, open it later, send it to a friend.
- Export a picture for homework, an animation for a message, or print the figure.

### For a teacher or a developer

- Put a figure in any web page with one call and control it from the page: add objects, move a slider when a video passes a time, react when a learner drags a point or finishes a task.
- Save the figure as a small text file that diffs in version control.
- Export crisp vector graphics for documents.

### Sub-features (complete list)

| # | Sub-feature | Stage |
|---|---|---|
| 1 | Create an app in a container with a mode and options | 1 |
| 2 | Run lines (single, many, atomic batch) and get structured results | 1 |
| 3 | Read objects: list, type, value, definition, style, undefined reasons | 1 |
| 4 | Change objects: set value, coordinates, text, visibility, style, rename, delete | 1 |
| 5 | Listen: added, removed, changed, restyled, renamed, redefined, dragged, selected, clicked, clock, view, mode, undo points, errors, export, load | 1 |
| 6 | View control: window, axes, grid, size, scaling | 1 |
| 7 | Clock control: play, pause, seek, speed | 1 |
| 8 | Undo and redo, undo point, saved/unsaved flag | 1 |
| 9 | Save and load: script text, JSON file, URL fragment | 1 |
| 10 | Export: PNG, SVG, animated GIF, PDF, print, TikZ source | PNG, SVG: 1. GIF, PDF, print: 2. TikZ: 3 |
| 11 | Cross-frame embedding (iframe) with a message protocol | 1 |
| 12 | Sharing: copy link, read-only embed code, short link service | link and embed: 2; service: 3 |
| 13 | Settings, languages and keyboard through options | see app-modes |

## 2. How GeoGebra does it

From the source (the JavaScript-facing API class, event types, io package) and the manual:

- **API shape.** One large object with several hundred methods, mostly string-in, string-out: set a value by object name, get a colour as a string, `eval` a command and get back true or false. Almost all methods take a name string and fail silently on a bad name.
- **Reading.** Methods exist per property (colour, thickness, point style, label style, layer, caption, and so on), plus value, definition and command strings, XML for an object or for the whole construction, and a list of all object names, optionally of one type.
- **Writing.** Evaluate a command; evaluate XML; set coordinates, a value, a text, visibility, layer, fixed, trace, label, colour, line and point style, animation, caption, font; delete and rename; set mode (the active tool); set the view window, axes and grid; change language and rounding.
- **Listening.** A listener per kind: add, remove, clear, rename, update (all objects or one named object), click (all or one), undo-store, plus a general "client" stream. There are about 100 event types in the engine (add, update, update style, remove, rename, redefine, moving and moved geos, delete, paste, undo, redo, select, deselect, set mode, view changed for 2D and 3D, mouse down, drag end, keyboard open and close, animation start and stop, page events for the notes app, panel selections, export, dialog open, macro add/remove/rename, editor key typed and many more). Only a subset is exposed in the public embed docs.
- **File.** A zip container. Main member: an XML file describing the construction. Other members: default styles, the optional JavaScript, a thumbnail picture, embedded images. The XML stores views, perspective, settings, kernel settings (rounding, angle unit, coordinates style), the construction in creation order with elements (value plus style) and commands (name, inputs, outputs), and macros (custom tools) with their own XML.
- **Export.** Image (PNG with scale, transparency, DPI), SVG, PDF, EPS-style vector, animated GIF (frames from a slider, speed, loop), print preview, PSTricks and TikZ source, HTML5 worksheet, and copy to clipboard.
- **What works:** the file stores definitions, so loading replays. The event stream is rich. The embed can be driven by a page script.
- **What is weak:**
  - String-typed API: no types, no errors (true/false only), no batch, no transaction.
  - Listeners get only a name; the page then has to ask for the value, and during a drag that is hundreds of round trips.
  - XML is verbose and unstable to diff; the zip hides everything.
  - A saved file can carry JavaScript that runs on load: a security hazard when files are shared.
  - Global state: one API object per page, in practice one per app instance, with callbacks as global function names.
  - Versioning is by app version, not by file format version, so old/new compatibility needs heuristics.

## 3. Our design: the embed API

### 3.1 Principles

1. **Typed, small, promise-based where it crosses a frame, synchronous where it does not.** In the same page, calls are synchronous; across an iframe they are promises. The same interface type serves both, with `Sync` and `Async` variants generated from one definition.
2. **Everything is a line.** Writing goes through the language. There is no per-property setter zoo. `style` is a line (`A with color = red`), and values are lines (`a = 3`). The API offers sugar for the common cases.
3. **Results are data.** No true or false, no strings to parse.
4. **Events carry the new value.** The page does not need to ask again, and drag streams are coalesced to one event per frame.
5. **No code execution from files.** A file is data. Actions on click or update are commands from the language (see controls-scripting), never host-language code.
6. **Versioned.** `apiVersion` number, additive changes only inside a major.

### 3.2 Creating an app

```ts
interface AppOptions {
  readonly container: HTMLElement;
  readonly mode?: AppModeId;                 // default 'graphing'
  readonly script?: string;                  // lines to run at start
  readonly file?: IncantlyFile | string;     // alternative to script: a parsed file or its JSON text
  readonly size?: { width: number | 'fill'; height: number | 'fill' };
  readonly ui?: Partial<UiOptions>;          // show/hide parts, see below
  readonly language?: LocaleId;              // default from browser
  readonly keyboard?: 'auto' | 'on' | 'off';
  readonly readOnly?: boolean;               // learner cannot change the construction
  readonly enforceLocks?: boolean;
  readonly exam?: ExamProfileId;             // start in exam mode (see app-modes)
  readonly allowOrigins?: readonly string[]; // for the iframe protocol
  readonly telemetry?: false;                // default false; no data leaves the page
}

interface UiOptions {
  algebra: boolean; sheet: boolean; toolbar: boolean; inputBar: boolean;
  menu: boolean; undoRedo: boolean; clockBar: boolean; styleBar: boolean;
  zoomButtons: boolean; resetButton: boolean; rightClick: boolean;
  dragPoints: boolean; panAndZoom: boolean; labelsDrag: boolean;
  borderColor: Color | 'none'; background: Color;
}

declare function createApp(opts: AppOptions): Promise<App>;
```

Defaults depend on the mode (`app-modes/design.md`); `ui` overrides.

### 3.3 The App interface

```ts
type ObjectName = string;

interface App {
  readonly apiVersion: 1;
  readonly mode: AppModeId;

  // --- run ---
  run(lines: string | readonly string[]): readonly LineResult[];
  runBatch(lines: readonly string[]): BatchResult;     // all-or-nothing

  // --- read ---
  list(filter?: ObjectFilter): readonly ObjectSummary[];
  get(name: ObjectName): ObjectDetail | undefined;
  exists(name: ObjectName): boolean;
  value(name: ObjectName): Value | undefined;          // typed value or undefined (not found)
  definition(name: ObjectName): string | undefined;    // the line that defines it
  undefinedObjects(): readonly { name: string; reason: string }[];
  figure(): FigureSummary;                             // same as the teacher's `figure` tool

  // --- write (sugar over run) ---
  set(name: ObjectName, value: number | boolean | string | [number, number]): LineResult;
  setStyle(name: ObjectName, style: StylePatch): LineResult;
  show(...names: ObjectName[]): void;  hide(...names: ObjectName[]): void;
  remove(name: ObjectName): DeleteResult;
  rename(oldName: ObjectName, newName: ObjectName): LineResult;
  clear(): void;

  // --- view ---
  readonly view: ViewControl;
  // --- clock ---
  readonly clock: ClockControl;
  // --- undo ---
  undo(): boolean;  redo(): boolean;  markUndoPoint(label?: string): void;
  readonly saved: boolean;  markSaved(): void;

  // --- events ---
  on<E extends EventType>(type: E, handler: (e: EventOf<E>) => void, opts?: ListenOpts): Unsubscribe;
  once<E extends EventType>(type: E, handler: (e: EventOf<E>) => void): Unsubscribe;

  // --- files, export, share ---
  save(): IncantlyFile;           saveText(): string;           // JSON text
  load(file: IncantlyFile | string): LoadResult;
  toScript(): string;
  export(opts: ExportOptions): Promise<ExportResult>;
  share(opts?: ShareOptions): Promise<ShareResult>;

  // --- app lifetime ---
  setMode(mode: AppModeId): ModeChangeResult;
  setLanguage(locale: LocaleId): Promise<void>;
  resize(width: number, height: number): void;
  destroy(): void;
}
```

Notes:

- `run` accepts one string with newlines or an array. Each line is its own transaction (core rule). Returns one `LineResult` per line.
- `runBatch` is the all-or-nothing form (kernel `applyBatch`).
- `value` returns a typed `Value` (a number, boolean, string, `{x,y}`, array, etc.), not a string, so the page does arithmetic without parsing. `valueText` is available through `get`.
- `set` is limited to free objects; for dependent objects it returns `not_free` error.
- All methods that take a name return `unknown_name` error data (via `LineResult`) or `undefined`, never throw. The only thrown errors are programming errors (wrong argument types), as `TypeError`.

### 3.4 Result and detail types

```ts
type LineResult = LineOk | KernelError;

interface LineOk {
  readonly ok: true;
  readonly line: number;
  readonly name?: string;             // object defined (absent for actions)
  readonly type?: TypeName;
  readonly summary?: string;          // short value
  readonly created: readonly string[];  // names created by this line (commands may create several)
  readonly changed: readonly string[];  // names whose value changed downstream
  readonly undefined: readonly { name: string; reason: string }[];
}

interface ObjectSummary {
  readonly name: string; readonly id: number; readonly type: TypeName;
  readonly visible: boolean; readonly free: boolean; readonly defined: boolean;
  readonly summary: string;
}

interface ObjectDetail extends ObjectSummary {
  readonly definition: string;
  readonly value: Value;                 // typed
  readonly undefinedReason?: string;
  readonly style: Style;
  readonly dependsOn: readonly string[]; // direct inputs
  readonly dependents: readonly string[]; // direct downstream
  readonly cell?: { col: number; row: number; locked: boolean };
}

interface ObjectFilter {
  readonly type?: TypeName | readonly TypeName[];
  readonly free?: boolean; readonly visible?: boolean;
  readonly namePattern?: string;          // glob, e.g. "P*"
  readonly dependsOn?: string;
}

type Value =
  | number | boolean | string
  | { readonly x: number; readonly y: number }
  | readonly Value[]
  | { readonly kind: 'undefined'; readonly reason: string };
```

### 3.5 View and clock

```ts
interface ViewControl {
  get(): { x0: number; x1: number; y0: number; y1: number; widthPx: number; heightPx: number };
  set(x0: number, x1: number, y0: number, y1: number, animateMs?: number): void;
  setAxes(show: boolean | { x: boolean; y: boolean }): void;
  setGrid(show: boolean | 'major' | 'minor'): void;
  keepRatio(on: boolean): void;
  fit(): void;                           // zoom to show visible objects
  suspendRepaint(): () => void;          // returns resume; repaints merge anyway
}

interface ClockControl {
  readonly t: number;
  readonly playing: boolean;
  play(): void; pause(): void;
  seek(t: number): void;                  // sets t, one update pass
  setSpeed(multiplier: number): void;     // 0.1..10
  setRange(from: number, to: number): void;
}
```

### 3.6 Events

Typed union; every event has `type`, `t` (clock time at the event), and `source`: `'user' | 'script' | 'api' | 'clock' | 'file'` so a page can tell a learner drag from its own call and avoid loops.

```ts
type EventType =
  | 'ready' | 'loaded' | 'modeChanged' | 'languageChanged'
  | 'added' | 'removed' | 'changed' | 'restyled' | 'renamed' | 'redefined' | 'cleared'
  | 'batch'                       // wraps a group of events from one transaction
  | 'dragStart' | 'drag' | 'dragEnd'
  | 'selected' | 'deselected' | 'clicked' | 'hoverChanged'
  | 'viewChanged' | 'clockChanged' | 'play' | 'pause'
  | 'toolChanged' | 'undoPoint' | 'undone' | 'redone'
  | 'cellEdited' | 'sheetSelected'
  | 'examStateChanged' | 'cheatingSignal'
  | 'keyboardOpened' | 'keyboardClosed'
  | 'exported' | 'shared' | 'error';

interface ChangedEvent {
  readonly type: 'changed'; readonly source: EventSource; readonly t: number;
  readonly objects: readonly { name: string; value: Value; defined: boolean }[];
}
interface DragEvent {
  readonly type: 'drag'; readonly source: 'user'; readonly t: number;
  readonly name: string; readonly value: Value;
}
interface ErrorEvent {
  readonly type: 'error'; readonly source: EventSource; readonly t: number; readonly error: KernelError;
}
// ... one interface per type; EventOf<E> maps the tag to its interface.

interface ListenOpts {
  readonly object?: string | readonly string[];  // only events about these names
  readonly types?: readonly TypeName[];          // only objects of these types
  readonly source?: EventSource | readonly EventSource[];
  readonly coalesce?: 'frame' | 'none' | number; // default 'frame' for changed/drag/viewChanged/clockChanged; number = min ms
}
```

Rules:

- `changed` events are **coalesced to one per frame**, carrying every object that changed in that frame, with new values. `coalesce: 'none'` gives one event per kernel update pass.
- `drag` carries the dragged object's value on every frame while dragging. `changed` also fires for downstream objects.
- `batch` events wrap a transaction: the page receives `batch` with the list of inner events, then (unless `opts.unwrapBatch`) the inner events are *not* delivered separately. Default: unwrapped delivery in order, preceded by `batchStart` marker via `e.batchId`.
- Handler errors are caught and delivered as an `error` event to other handlers; they never break the app.
- Delivery is on a microtask after the update pass, never inside the kernel's loop, so a handler that calls `run` sees consistent state and cannot recurse into an update pass. A handler that calls `run` for an object it is listening to gets `source: 'api'` and can ignore it.
- `on` returns an unsubscribe function. No global callback names.

### 3.7 Embedding across frames

When the app is in an iframe, the page uses a thin client:

```ts
declare function connectApp(iframe: HTMLIFrameElement, opts: { origin: string; timeoutMs?: number }): Promise<AsyncApp>;
// AsyncApp has the same methods as App; every method returns a Promise.
```

Wire protocol: `postMessage` of JSON, one envelope type.

```ts
type Envelope =
  | { v: 1; id: number; method: string; params: unknown[] }          // call
  | { v: 1; id: number; result: unknown }                             // answer
  | { v: 1; id: number; error: { kind: string; message: string } }    // protocol error
  | { v: 1; event: string; data: unknown; sub: number };              // event
```

Security rules: the frame accepts messages only from origins in `allowOrigins` (default: same origin only); the client accepts messages only from the frame's `contentWindow` and the expected origin; no `eval`; methods are a closed set; payloads are structured-clone safe; max message 2 MB; max 200 calls per second per origin (excess get `rate_limited`).

Drag streams over frames are coalesced to at most one message per frame.

### 3.8 Hosting in a film

The film host uses this same API in the same page. It sets the clock (`clock.seek`) from the film timeline, so the figure and film agree. A beat's lines are run by `runBatch`. `app.on('changed')` feeds the film's recorder when a learner explores.

Note: GeoGebra has options to randomise or seed random numbers on load. We need neither: `rand(seed)` is a pure function of its seed (core design), so a file always loads to the same figure.

## 4. Our design: the file format

### 4.1 Two forms, one meaning

1. **Script** (`.inc`, UTF-8 text): the canonical definition. One line per change, directives for the rest. Human-diffable. It is exactly what `toScript()` returns.
2. **File** (`.incantly`, JSON): the script plus what scripts cannot hold well: assets (images), thumbnail, metadata, state snapshot for fast load, and settings.

Loading either replays the script through the kernel. A file never contains executable host-language code. It never contains computed results except as an optional **cache** the loader may ignore.

### 4.2 Script details

```text
# incantly 1 mode=graphing
@view -6 6 -4 4
@grid on
a = 2 in 0..5 step 0.1
f(x) = a x^2 - 1
P = (1, 2) with color = blue
r = Root(f, 0, 3)
@sheet 26 100
A1 = 3
@cell A1 locked
```

- Line 1 is a comment `# incantly <formatVersion> mode=<id>`. Not required to parse; used for detection and migration.
- Free objects are written with their current value; dependent objects with their definition. The writer prints in `order`.
- Styles are written as `with` clauses on the same line. Long lines are split only at commas inside parentheses and joined by the reader (a continuation line begins with two spaces).
- Floats are written with the shortest string that round-trips (`Number.prototype.toString`), so no drift.
- Deterministic output: same figure, same bytes. This is tested.

### 4.3 JSON file

```ts
interface IncantlyFile {
  readonly format: 'incantly';
  readonly formatVersion: number;        // 1
  readonly appVersion: string;           // writer's version, informative only
  readonly mode: AppModeId;
  readonly script: string;               // the canonical text
  readonly settings: FileSettings;       // view, grid, angle unit, rounding, language, sheet view, keyboard
  readonly clock?: { range: [number, number]; t: number; speed: number; playing: boolean };
  readonly views: ViewLayout;            // which panes, sizes, order (UI only; ignored by the kernel)
  readonly assets: Record<AssetId, Asset>;   // images and fonts referenced by `Image("asset:…")`
  readonly meta: Meta;                   // title, author, description, created, modified, tags, license
  readonly thumbnail?: string;           // data URI, PNG or WebP, max 40 KB
  readonly cache?: { checksum: string; values: Record<string, Value> };   // optional fast path
  readonly extensions?: Record<string, unknown>;  // unknown keys preserved on save
}

interface FileSettings {
  view: { x0: number; x1: number; y0: number; y1: number; keepRatio: boolean };
  axes: { x: boolean; y: boolean }; grid: 'none' | 'major' | 'minor';
  angleUnit: 'radian' | 'degree'; rounding: { mode: 'decimals' | 'sig'; digits: number };
  coordinatesStyle: 'cartesian' | 'polar';
  language: LocaleId; sheet?: SheetSettings; keyboard?: 'auto' | 'on' | 'off';
}

interface Asset {
  readonly mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  readonly encoding: 'base64';
  readonly data: string;
  readonly width?: number; readonly height?: number;
  readonly sha256: string;
}
```

Notes:

- **What it stores:** definitions (as script), free values (in the script), styles (in the script), view window and display settings, clock, UI layout, assets, metadata, a thumbnail, optional cache. It does not store: undo history, selection, transient drag state, trace data (rebuilt), the live conversation.
- **Size.** A typical figure under 20 KB. Assets are the only large part. Limits: file 10 MB, 200 assets, 5 MB per asset. Images are checked by magic number, decoded in a worker, SVG is sanitised (no scripts, no external references).
- **Compression.** The file may be gzipped (`.incantly.gz`) or put in a URL fragment as `deflate` + base64url. The loader sniffs the first bytes.
- **Checksum and cache.** `cache.checksum` is SHA-256 of `script`. If it matches and the app version's kernel version tag matches, the loader may skip recomputing values of expensive objects (loci with many points) and use the cache; otherwise it recomputes. The cache is advisory and never trusted for correctness-critical output.

### 4.4 Loading rules

```ts
interface LoadResult {
  readonly ok: boolean;
  readonly migrated: boolean;
  readonly applied: number;               // lines applied
  readonly failed: readonly KernelError[]; // lines rejected; load continues after a failure (a partly valid file is still useful)
  readonly warnings: readonly Warning[];
  readonly modeAdjusted?: { from: AppModeId; to: AppModeId; reason: string };
}
```

1. Parse JSON (or sniff a script). Unknown `formatVersion` larger than ours: `file_too_new` error with the version (we refuse to guess). Smaller: run migrations in order (`migrate_1_to_2`, …); each migration is a pure function from file to file with tests.
2. Validate shape with a schema (hand-written type guards; no `any`). Wrong shapes: `file_invalid`.
3. Check limits.
4. Replace the construction atomically: build the new kernel state aside; swap on success. On a total failure (`file_invalid`), nothing changes.
5. Replay the script line by line. Lines that fail are collected (`failed`), the rest apply. The result tells the page how many were lost.
6. Apply settings, clock, layout.
7. Emit `loaded` then `ready` if first.

### 4.5 Versioning policy

- `formatVersion` increments only when old readers would misread (breaking). New optional fields don't bump it.
- Unknown fields under `extensions` and unknown top-level keys are kept on round trip.
- A file's `mode` is honoured if the host allows it, else adjusted (`modeAdjusted`), e.g. a 3D file in a build without 3D loads in the graphing mode with the 3D objects rejected and reported.

## 5. Our design: export

```ts
type ExportOptions =
  | { format: 'png'; scale?: number; width?: number; height?: number; transparent?: boolean; dpi?: number; region?: 'view' | 'all' | Rect; t?: number }
  | { format: 'svg'; region?: 'view' | 'all' | Rect; t?: number; text?: 'text' | 'outlines'; embedFonts?: boolean }
  | { format: 'pdf'; page?: 'fit' | 'a4' | 'letter'; margin?: number; region?: 'view' | 'all' | Rect; t?: number }
  | { format: 'gif'; from: number; to: number; fps?: number; width?: number; loop?: number | 'forever'; dither?: boolean }
  | { format: 'webm' | 'mp4'; from: number; to: number; fps?: number; width?: number }   // stage 3
  | { format: 'print'; page?: 'a4' | 'letter'; includeSheet?: boolean; includeAlgebra?: boolean }
  | { format: 'tikz'; region?: 'view' | 'all' | Rect };                              // stage 3

interface ExportResult {
  readonly format: ExportOptions['format'];
  readonly blob: Blob;
  readonly width: number; readonly height: number;
  readonly warnings: readonly Warning[];
  readonly bytes: number;
}
```

### 5.1 Pipeline

All formats use the same **scene to graphics interface** path (core design section 8): a recorder implements the graphics interface (`path`, `stroke`, `fill`, `text`, `image`, `transform`, `clip`). The view draws once into the target:

- **PNG:** an offscreen canvas at `width x scale` (max 8192 x 8192 px, max 64 megapixels). `dpi` writes the physical-size chunk (so print size is right). Transparent background supported.
- **SVG:** a recorder that emits SVG elements; text stays text unless `outlines` (then via font outlines so layout is exact anywhere). Particle objects are emitted as a bounded sample (at most 5,000 circles) with a warning. Gradients, clips and opacity map to SVG features.
- **PDF:** the same recorder with a minimal PDF writer (vector paths, text with embedded subset fonts, images). No server. Single page, fit to figure or A4/Letter with margin.
- **Animated GIF:** step `t` from `from` to `to` at `fps` (default 15; max 30), render each frame to canvas, quantise to 256 colours (median-cut, per frame palette with optional dither), LZW encode in a worker. Time is the clock, so the file is exact and independent of machine speed. Limits: 600 frames, 800 px wide, 20 MB; estimated size shown before the work starts. Progress events; cancel via `AbortSignal`.
- **Print:** an HTML print stylesheet with the SVG output scaled to the page, optional sheet and algebra list; uses the browser print dialog.
- **TikZ** (stage 3): an SVG-like recorder to a text emitter. Out of scope for the first build.

### 5.2 Determinism

Export at time `t` seeks the clock internally on a copy of the kernel state (a cheap checkpoint restore); the live figure does not flicker. For animated export we run on a cloned kernel in a worker where the browser supports it.

### 5.3 Accuracy

- Vector exports keep the plotter's adaptive sample points as they were at the export scale: before exporting we **replot at export resolution** so curves do not look polygonal when scaled up.
- PNG at 2x or 3x re-renders; it does not upscale pixels.

## 6. Our design: sharing

```ts
interface ShareOptions {
  readonly kind: 'link' | 'embed' | 'short';
  readonly readOnly?: boolean;             // default true for embed
  readonly includeClock?: boolean;
  readonly size?: { width: number; height: number };
}
interface ShareResult { readonly url: string; readonly html?: string; readonly bytes: number }
```

- **Link (stage 2):** the file, minified (no thumbnail, no cache), gzipped, base64url, placed in the URL **fragment**. The fragment never reaches a server. Limit about 8 KB of URL; larger figures get `too_large_for_link` and a suggestion to download or use a short link.
- **Embed (stage 2):** an `<iframe>` snippet with `sandbox="allow-scripts allow-same-origin"` limited as needed, loading the viewer with the link in the fragment. Read-only by default.
- **Short link (stage 3):** POST the file to our service, get an id. Needs an account and a privacy statement; not designed here.
- **Safety:** shared files are data; opening one never runs host-language code and never fetches an external URL except assets inside the file. Image links to other hosts are blocked by default (`external_url_blocked`).

## 7. Edge cases

- `run` called during a drag: queued until the drag frame ends (a few ms); returned results are for the line, not delayed.
- `load` during play: pauses, loads, restores `playing` from the file.
- Name clash on `rename`: `name_taken` error data.
- `destroy` during an event handler: deferred to after the handler.
- Two apps on one page: independent (no globals).
- Very large `list()` result: capped at 5,000 entries, with `truncated: true`.
- Event storm: coalescing bounds delivery at 1 per frame per type, per listener.
- File with the same name defined twice: the later line is a redefinition (normal rules); a type change is reported in `failed`.
- Floating-point output in `toScript`: `-0` is written as `0`; `NaN` and infinities are never stored (the object is undefined; the script writes its definition, or if free, `undefined` is not a legal value so the line is omitted with a warning).

## 8. Better than GeoGebra

- Typed, promise-or-sync API; errors as data; no silent failures.
- One writer door (lines), one reader door (`get`/`list`), not hundreds of getters and setters.
- Events carry values, are coalesced per frame, and tell the source, so pages stay in sync with no loops.
- Atomic batches.
- A text format that diffs and merges, deterministic output, versioned and migratable.
- No code in files: shared files are safe to open.
- Vector export replots at export resolution; PDF without a server; GIF is driven by the clock, so exact.
- Fragment-based links send nothing to a server.

## 9. Changes to the core design

1. `Kernel.applyBatch` (also required by the spreadsheet).
2. `LineOk` gains `created`, `changed`, `undefined` arrays (the teacher's `draw` result also benefits).
3. Add `@mode` handling to the line 1 comment and a `# incantly` header convention. Comments remain ignorable.
4. Events: the kernel emits typed change records with `source` tags; the view and API subscribe to the same stream.
5. `toScript()` must be deterministic and round-trip safe, and print long definitions with continuation lines (two leading spaces). The line grammar needs "a line starting with two spaces continues the previous one".
6. Directive `@clock` stays; add `@angleunit`, `@rounding`, `@coords` for settings that the file records (so a script alone reproduces the figure).
7. `Image(...)` command needs an `asset:` scheme (graphics area to define the command; this area defines the scheme).

## 10. Performance targets

| Measure | Target |
|---|---|
| `run` of one line from API | under 1 ms (core) plus under 0.2 ms API overhead |
| `list()` on 500 objects | under 1 ms |
| Event delivery latency from update pass | under one frame |
| `saveText()` for 500 objects | under 5 ms |
| `load` of 500 objects | under 60 ms |
| PNG export 2x of 1200 x 800 | under 150 ms |
| SVG export, 500 objects | under 50 ms |
| GIF, 3 s at 15 fps, 600 px | under 4 s in a worker |
| Iframe round trip | under 3 ms |

## Sources studied

GeoGebra source (read-only clone, commit 3608374), under `source/shared/common/src/main/java/org/geogebra/common/`:

- `plugin/` (the JavaScript-facing API class, event types, event dispatcher, listener plumbing, script types)
- `io/` (XML handlers, file container classes, layout)
- `io/file/` (zip containers, base64 containers)
- `export/` (text-format exporters), `export/pstricks/`
- `main/settings/` (what is saved with a file)

Manual:

- https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/
- https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_Embedding/
- https://geogebra.github.io/docs/reference/en/GeoGebra_App_Parameters/
- https://geogebra.github.io/docs/manual/en/Scripting/ (scripts attached to objects; why we keep code out of files)
