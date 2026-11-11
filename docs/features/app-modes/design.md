# App modes, exam mode, settings, languages, keyboard: design

Status: draft. Stage 1 builds the mode machinery and two modes (`figure`, `graphing`). The rest are configurations added as their features land. Nothing in the machinery changes when a mode is added.

## 1. What it does

### For a learner

Opening the program in a mode gives a tidy tool for one job: a graphing calculator, a geometry board, a scientific calculator, a probability explorer, a notes board. Fewer buttons, the right defaults (degrees for geometry, a 1:1 window), and only the commands that make sense.

### For a teacher

- Pick the mode for a task, then narrow it further (hide the algebra pane, remove a command) for a worksheet.
- Start an **exam**: a locked configuration with a visible banner, recorded focus-loss events and a summary at the end.
- Set the language for learners and a keyboard that suits the task.

### Sub-features (complete list)

| # | Sub-feature | Stage |
|---|---|---|
| 1 | Mode registry: each mode is a data record | 1 |
| 2 | Modes: `figure` (ours), `graphing`, `geometry`, `classic` (all), `scientific`, `probability`, `notes`, `cas`, `graphing3d` | figure, graphing: 1. geometry, classic: 2. scientific, probability: 2-3. notes, cas, 3d: 3 |
| 3 | Per-mode: views, tool groups, command policy, expression policy, defaults, feature flags, keyboard, settings panel | 1 |
| 4 | Derived modes: a teacher narrows a mode (`restrict`) | 2 |
| 5 | Mode switch at run time, keeping the figure where valid | 2 |
| 6 | Exam mode: profiles, restrictions, state machine, signals, summary | 2 |
| 7 | Settings: typed registry, file-bound vs user-bound, persistence | 1 |
| 8 | Languages: UI text, number formats, right-to-left, command-name aliases | UI text, formats: 1. aliases: 3 |
| 9 | On-screen maths keyboard: layouts as data, per mode; physical shortcuts | 2 |
| 10 | Accessibility settings: reduced motion, high contrast, text size, screen-reader mode | 1 |

## 2. How the reference app does it

From the source (`main/settings/config/`, `main/AppConfig.java`, `exam/`, `kernel/commands/filter/`) and manual:

- **One program, many configurations.** An interface of about 70 questions ("does this app have a spreadsheet?", "are sliders created automatically?", "does it show the Ans button?", "what keyboard?", "which commands are allowed?") is answered by one class per app, each extending a shared base. Differences from the default are small overrides.
- **Apps and what they set.**
  - *Graphing:* graphics and algebra views; sliders created automatically for unknown names; function-centric; dependent objects cannot be dragged; no automatic labels for new objects in the same way; radians; a restricted command list (no heavy geometry or scripting); suggestion buttons in the algebra list (e.g. special points).
  - *Geometry:* graphics view only; many construction tools; no sliders from algebra; degrees and Greek letters for angles; preview points while constructing; axes and grid off at start.
  - *3D graphing:* a 3D graphics view; both views can share; plane/ surface commands.
  - *CAS:* algebra view with symbolic rows; no graphics view at start; symbolic output.
  - *Scientific:* single column of expression and result rows; no graphics; a specific keyboard; very small command set; no tools panel; an `Ans` mechanism; fraction and decimal toggles.
  - *Probability:* a distribution view with parameters, probability calculator and statistics tab.
  - *Notes:* a board of pages: pen, shapes, text, images, media, with embedded maths widgets; no maths objects of its own.
  - *Classic:* everything: menu bar, input bar, all views, scripting, tools builder.
  - *A "suite"* that hosts several apps, switching with a menu.
- **Filters.** Command, command-argument, expression (operators and functions), operation, syntax, tool, context-menu, property and output-format filters, composed into a bundle per app or per exam. An exam type is such a bundle plus rules about settings and an on/off switch for CAS and 3D.
- **Exam.** A controller with states: idle, active, finished. Exam types exist per national rule set. It records events that look like cheating (leaving the window), shows a summary with elapsed time, applies the bundle, and restores settings afterwards.
- **Settings.** A tree of small setting objects (general, graphics, algebra, spreadsheet, CAS, probability, layout, fonts); each notifies listeners; defaults and "reset"; a subset is saved in the file; the rest in user preferences.
- **Keyboard.** A set of keyboard types (normal, scientific, notes, and geometry-specific); layouts shown in tabs; the editor behind it is a structured maths editor, not a text box.
- **Languages.** About 60 UI languages; command names are localised, with the English name always accepted; digits and decimal separators follow the language.
- **What works:** configuration as data-like overrides keeps one code base; filters compose; the exam mechanism reuses the same filters.
- **What is weak:**
  - 70 booleans in one interface: hard to see what a mode is; every new question forces changes in every class.
  - Mode behaviour is partly in the config classes and partly in `if (app is X)` checks elsewhere.
  - Command policies are code (filter classes), not data: hard to show to a teacher or model, hard to test as a table.
  - Localised command names make files and examples language-dependent.
  - Exam mode on the web cannot lock the device; the summary should be honest about that.

## 3. Our design

### 3.1 A mode is one data record

```ts
type AppModeId =
  | 'figure' | 'graphing' | 'geometry' | 'classic' | 'scientific'
  | 'probability' | 'notes' | 'cas' | 'graphing3d';

interface ModeConfig {
  readonly id: AppModeId;
  readonly title: LocaleKey;
  readonly stage: 1 | 2 | 3;                  // when it ships; informative
  readonly views: ViewPolicy;
  readonly tools: ToolPolicy;
  readonly commands: CommandPolicy;
  readonly expressions: ExpressionPolicy;
  readonly defaults: ModeDefaults;
  readonly features: FeatureFlags;
  readonly keyboard: KeyboardId;
  readonly settings: readonly SettingId[];    // which settings the panel offers
  readonly ui: UiOptions;                     // defaults for the embed `ui` options
  readonly exam: ExamSupport;
}
```

Every field is plain data (JSON-serialisable). A mode has no methods. Anything that needs different code (the scientific calculator's list of results, the notes board) is a **view kind** that the mode names; the mode itself stays data. Modes live in `packages/modes` as a table; the kernel imports nothing from it, the view and API read it.

```ts
interface ViewPolicy {
  readonly available: readonly ViewKind[];    // 'graphics' | 'algebra' | 'sheet' | 'cas' | 'graphics3d'
                                              // | 'distribution' | 'results' | 'board' | 'clock'
  readonly initial: readonly ViewKind[];      // shown at start, in order
  readonly layout: 'split' | 'single' | 'tabs';
  readonly canToggle: boolean;                // learner can show/hide views
}

interface ToolPolicy {
  readonly groups: readonly ToolGroupId[];    // from the tools-2d area, e.g. 'move','points','lines',...
  readonly toolbar: 'full' | 'compact' | 'none';
  readonly deny?: readonly ToolId[];
  readonly customTools: boolean;              // can learners build tools (stage 3)
}

interface CommandPolicy {
  readonly allow: 'all' | readonly CommandGroupId[];   // groups from the command table
  readonly add?: readonly string[];                    // extra single commands
  readonly deny?: readonly string[];                   // always forbidden
  readonly argumentRules?: readonly ArgumentRule[];    // e.g. derivative only of user functions
}

interface ExpressionPolicy {
  readonly functions: 'all' | readonly string[];       // built-ins allowed (sin, ln, ...)
  readonly operators: 'all' | readonly string[];
  readonly allowImplicitEquations: boolean;            // lines like x^2 + y^2 == 4
  readonly allowTextObjects: boolean;
  readonly allowLists: boolean;
  readonly allowStates: boolean;                       // state()/rates (physics)
  readonly allowParticles: boolean;
}

interface ModeDefaults {
  readonly angleUnit: 'radian' | 'degree';
  readonly rounding: { mode: 'decimals' | 'sig'; digits: number };
  readonly view: { x0: number; x1: number; y0: number; y1: number; keepRatio: boolean };
  readonly axes: boolean; readonly grid: 'none' | 'major' | 'minor';
  readonly autoSliders: boolean;      // see 3.4: how our "no guessing" rule applies
  readonly autoLabels: 'all' | 'points' | 'none' | 'new-points-only';
  readonly pointStyle: PointStyle; readonly pointSize: number; readonly lineWidth: number;
  readonly dragDependent: boolean;    // may a learner drag a dependent object's free parents
  readonly previewPoints: boolean;    // geometry: ghost point under the pointer while constructing
  readonly greekAngleLabels: boolean;
  readonly equationForm: 'implicit' | 'explicit' | 'general';
  readonly coordinates: 'cartesian' | 'polar';
}

interface FeatureFlags {
  readonly sheet: boolean; readonly cas: boolean; readonly threeD: boolean;
  readonly scripting: boolean; readonly inputBar: boolean; readonly menu: boolean;
  readonly fileOps: boolean; readonly share: boolean; readonly export: boolean;
  readonly suggestions: boolean;     // suggestion chips in algebra (special points, solve)
  readonly ansButton: boolean;       // previous result key
  readonly statistics: boolean;      // data analysis tools
  readonly clockBar: boolean;
  readonly undoRedo: boolean;
  readonly pageSet: boolean;         // notes pages
}

interface ExamSupport { readonly allowed: boolean; readonly profiles: readonly ExamProfileId[] }
```

### 3.2 The mode table

Shown here as data summary. "Cmd groups" are groups from the command table; the geometry-heavy ones come from the other areas.

| Mode | Views (initial) | Tools | Cmd groups | Angle | Axes / grid | Auto sliders | Labels | Drag dependent | Special |
|---|---|---|---|---|---|---|---|---|---|
| `figure` (ours; the live teacher's) | graphics, clock | none (view pan/zoom only) | all lines the teacher writes | radian | on / off | no | points | no | No menu, no algebra, no input bar. This is the film's figure |
| `graphing` | graphics, algebra | `move`, `points` (basic), `lines` (basic), `curve tools` (tangent, special points) | functions, calculus, lists, numbers, basic geometry, statistics basics | radian | on / major | **yes** (see 3.4) | none for functions, auto for points | no | Suggestion chips in algebra; function-first |
| `geometry` | graphics | full 2D construction tools | geometry, transforms, polygons, conics, measurements, limited functions | degree | off / off | no | all new objects | yes | Preview points, Greek angle labels, 1:1 ratio locked by default |
| `classic` | graphics, algebra, sheet, input bar | all tools | all groups | radian | on / major | yes | automatic | yes | Menu bar, scripting, custom tools, every view |
| `scientific` | results (single column) | none | numbers, `Mean`, `Sum`, basic stats only | degree (toggle) | n/a | n/a | n/a | n/a | No graphics. `Ans`. Fraction/decimal toggle. Scientific keyboard |
| `probability` | distribution, results | none | probability, statistics | n/a | n/a | n/a | n/a | n/a | Distribution picker, parameter fields, interval shading, summary table |
| `notes` | board | board tools (pen, shapes, text, image, mind-map) | none (embedded graphing widgets use `graphing`) | n/a | n/a | n/a | n/a | n/a | Pages, undo, sharing; the graph is an embedded object |
| `cas` | cas (rows), graphics on demand | `move`, `points`, `lines`, `curve tools` | all, with symbolic evaluation | radian | on / major | no | none | no | Symbolic rows, exact and numeric answers, see 3.2.1 |
| `graphing3d` | graphics3d, algebra | full 3D tools | 3D, functions, geometry, transforms | radian | on (3 axes) / floor grid | yes | points | yes | Rotate, surfaces, planes, solids, see 3.2.2 |

A mode whose packages have not loaded yet (the symbolic layer for `cas`, the 3D view for `graphing3d`) shows a loading state, then switches. If loading fails, `setMode` returns `mode_unavailable` with the reason and the app stays in the previous mode.

#### 3.2.1 The `cas` mode

- **Views:** the `cas` view (numbered rows) at start. The graphics view opens the first time a row is marked to plot, and stays open. The algebra and sheet views are available, not shown.
- **Rows:** each row is a line in our language whose result is a symbolic `Expr`, shown exactly (fractions, roots, `pi`) with a toggle to numeric. A row refers to an earlier row as `$3` (its result) or by the name it defines. Editing a row recomputes the rows that use it, through the normal kernel update pass.
- **Evaluation per row:** `exact` (default), `numeric`, `keep input` (no evaluation, only checks the line), and `check` (the row is a claim, answered true or false, as in `Simplify(a) == b`). These map to the `mode: 'symbolic'` parameter of the CAS commands (`docs/features/cas/design.md`).
- **Tools:** `move`, `points`, `lines` (basic), and the curve tools, for the graphics view only. The `cas` view has its own row toolbar: evaluate, numeric, keep input, factor, expand, substitute, solve, derivative, integral, plot.
- **Commands:** every group, symbolic first: Simplify, Factor, Expand, Solve, Solutions, NSolve, Substitute, Derivative, Integral, Limit, Sum, Product, Taylor polynomial, partial fractions, matrices exact. Free names are allowed as symbols inside symbolic parameters only; elsewhere unknown names stay errors.
- **Defaults:** radians, exact output, 10 significant figures for numeric, no auto sliders, no labels in graphics, dependent objects not draggable.
- **Features:** `cas: true`, `inputBar: false` (rows are the input), `suggestions: true` (factor, solve, plot chips under a row), `undoRedo: true`, `export: true` (rows as LaTeX or text), `clockBar: false`.
- **Keyboard:** the maths keyboard with a symbolic tab (`√`, `∫`, `d/dx`, `lim`, `Σ`, matrix).
- **Exam:** allowed. An exam profile can turn the whole mode off, or keep it with numeric only.
- **Heavy work:** symbolic commands run in a worker with a time budget. A row waiting shows `pending`, then its result, or `unsupported` and the numeric answer when the symbolic layer cannot do it.

#### 3.2.2 The `graphing3d` mode

- **Views:** `graphics3d` and `algebra` at start, side by side. A 2D `graphics` view can be added; it shows the `floor` plane or any plane the learner picks.
- **Tools:** the full 3D tool groups from `docs/features/space-3d/design.md`: move and rotate view, points (in space, on objects, intersection), lines and planes (through points, perpendicular, parallel), solids (prism, pyramid, cone, cylinder, sphere, cube, net), surfaces (extrude, revolve), measures (distance, angle, area, volume), transforms (reflect about plane, rotate about line, translate), and view tools (view in front of, change projection).
- **Commands:** 3D, functions (including `Function2` surfaces), geometry, transforms, lists, numbers. Boolean operations on solids load on demand (`docs/design/libraries.md`).
- **Defaults:** radians, three axes on, a floor grid, perspective camera, `keepRatio: true`, auto sliders yes (through the UI chip, as in 3.4), labels for points, dependent objects draggable through drag plans, `opacity` 0.6 for solids.
- **Features:** `threeD: true`, `inputBar: true`, `suggestions: true`, `clockBar: true` (rotating views and animations), `export: true` (PNG, 3D model file such as glTF or STL).
- **Keyboard:** the maths keyboard plus `x y z` and the 3D object keys.
- **Exam:** allowed. An exam profile can turn 3D off.
- **Devices:** on a device without WebGL 2 the mode is unavailable with reason `no_webgl`. AR placement is a view option where the device supports WebXR.

### 3.3 Deriving a mode

A teacher narrows a mode without writing a new one:

```ts
interface ModeRestriction {
  readonly base: AppModeId;
  readonly hideViews?: readonly ViewKind[];
  readonly denyTools?: readonly ToolId[];
  readonly denyCommands?: readonly string[];
  readonly allowOnlyCommands?: readonly string[];   // intersect with the base policy
  readonly features?: Partial<FeatureFlags>;        // may only turn things OFF, never on
  readonly defaults?: Partial<ModeDefaults>;
}
function deriveMode(base: ModeConfig, r: ModeRestriction): ModeConfig;
```

Rules: `deriveMode` is pure; it can only remove capabilities (allow lists intersect, flags only turn off) so a derived mode can never exceed its base. A derived mode is stored in the file as one directive, `@restrict …` (3.6). If the file asks for something the host's mode forbids, the host mode wins.

### 3.4 How "no guessing" meets "auto sliders"

The reference app's graphing mode turns an unknown name in a function into a slider. Our core rule: unknown names are errors, never guessed. We keep the rule in the language and move the convenience to the **UI layer**:

- The kernel always returns `unknown_name` with `hint` and `suggest: { create: "a = 1 in -5..5" }`.
- In modes with `autoSliders: true` and a human typing in the algebra input, the UI shows a chip under the error: "Create slider a". One tap applies the suggested line then re-applies the original. Nothing is guessed silently; the learner sees what is happening.
- The live teacher never gets auto sliders: it sees the error and writes the line itself.

### 3.5 Mode switching

```ts
interface ModeChangeResult {
  readonly ok: boolean;
  readonly kept: number;                              // objects kept
  readonly dropped: readonly { name: string; reason: string }[];   // objects the new mode cannot hold
  readonly viewsChanged: readonly ViewKind[];
  readonly error?: ApiError;                          // mode_unavailable
}
```

- `setMode(next)` first dry-runs: replays the figure's script against `next`'s policies. Lines forbidden in `next` would be dropped (they become the `dropped` list). If any, the UI asks; the API applies only with `{ force: true }` (not in the type above; options object).
- Switching from `classic` to `graphing` removes the sheet view but keeps the cell objects that are still valid lines; they just aren't shown (their names stay reserved).
- Undo works across a mode switch (one step).

### 3.6 Directives and the file

Modes and restrictions are recorded in the script as comments and directives so a file reproduces its setup:

```text
# incantly 1 mode=geometry
@restrict hide=algebra deny=Derivative,Integral
@exam off
```

Rules: the `mode=` in the header is a hint the loader checks; `@restrict` lines are honoured only if they narrow. The model cannot write `@mode` or `@restrict` (the host owns them); both are `bad_directive` from `draw`.

### 3.7 Exam mode

An exam is a **profile** that composes with a mode.

```ts
type ExamProfileId = 'basic' | 'no-calculator-tools' | 'graphing-only' | 'custom';

interface ExamProfile {
  readonly id: ExamProfileId;
  readonly title: LocaleKey;
  readonly restrict: ModeRestriction;               // narrows the current mode
  readonly lockSettings: readonly SettingId[];      // settings frozen during the exam
  readonly forceSettings: Partial<SettingValues>;   // e.g. language fixed, rounding fixed
  readonly outputRules: readonly OutputRule[];      // e.g. show decimals only; hide exact forms
  readonly block: { share: boolean; export: boolean; fileOpen: boolean; fileSave: boolean; network: boolean; paste: boolean; clipboardImages: boolean };
  readonly watch: { focusLoss: boolean; fullscreenExit: boolean; visibilityHidden: boolean; multiWindow: boolean };
  readonly durationMinutes?: number;
}

type ExamState = 'idle' | 'preparing' | 'active' | 'finished';

interface ExamController {
  readonly state: ExamState;
  prepare(profile: ExamProfile): Promise<void>;     // shows the start screen, asks for fullscreen
  start(): void;                                    // snapshot settings and figure, apply restrictions
  finish(): ExamSummary;                            // stop, show summary
  exit(): void;                                     // restore snapshot (settings), keep or discard figure per option
  on(listener: (s: ExamState, e?: ExamSignal) => void): Unsubscribe;
}

interface ExamSignal {
  readonly kind: 'focus_lost' | 'focus_back' | 'fullscreen_exit' | 'tab_hidden' | 'tab_visible' | 'paste_blocked' | 'command_blocked';
  readonly at: number;     // ms since exam start
  readonly detail?: string;
}

interface ExamSummary {
  readonly profile: ExamProfileId;
  readonly startedAt: string; readonly finishedAt: string; readonly durationMs: number;
  readonly signals: readonly ExamSignal[];
  readonly flagged: boolean;               // any signal beyond a threshold set by the profile
  readonly blockedCommands: readonly { command: string; count: number }[];
  readonly objectsAtEnd: number;
  readonly figureHash: string;             // SHA-256 of toScript() at the end
}
```

Behaviour:

1. **Prepare:** show rules in plain words; request fullscreen; the learner confirms.
2. **Start:** take a snapshot of settings; apply `restrict` through the same `deriveMode` as above; apply `forceSettings` and lock; show a persistent banner (timer if there is a duration, text "Exam mode") with a colour that is also shown as text, so the state is visible in screenshots and to assistive technology.
3. **During:** every blocked command gives `mode_forbids` with the command named. Signals are recorded. Leaving fullscreen or hiding the tab shows a notice and starts the focus-lost timer.
4. **Finish:** stop; the summary screen shows duration, signals in a table and the `flagged` result; the summary can be shown to a teacher or saved as JSON (`ExamSummary`) by the learner. The figure can be saved if the profile allows.
5. **Exit:** settings restored from the snapshot; the exam figure is kept or discarded per the teacher's choice.

Honesty rule: a web page cannot lock a device. The summary says "These checks detect some leaving of the page. They do not prevent it." A real lock needs a managed device or a kiosk host; the host can implement `ExamController`'s delegate to do so.

### 3.8 Settings

A typed registry, not a bag of booleans.

```ts
interface SettingDef<T> {
  readonly id: SettingId;
  readonly scope: 'file' | 'user';          // saved in the figure, or in the user's preferences
  readonly type: SettingType<T>;            // boolean | enum | int(min,max) | number | color | string
  readonly default: T | ((mode: ModeConfig) => T);
  readonly label: LocaleKey; readonly help?: LocaleKey;
  readonly group: 'general' | 'graphics' | 'algebra' | 'sheet' | 'keyboard' | 'accessibility' | 'language';
  readonly restartNeeded?: false;
}

interface Settings {
  get<T>(id: SettingId): T;
  set<T>(id: SettingId, value: T): SetResult;   // validates; locked settings refuse
  reset(group?: string): void;
  onChange(id: SettingId | '*', fn: (id: SettingId, v: unknown) => void): Unsubscribe;
  snapshot(): SettingValues;                     // used by exam
  restore(s: SettingValues): void;
}
```

Settings by group (name, scope, default):

| Group | Setting | Scope | Default |
|---|---|---|---|
| general | `angleUnit` | file | mode default |
| general | `rounding` (decimals 0-15, or significant digits 1-15) | file | 2 decimals |
| general | `coordinates` | file | cartesian |
| general | `undoLimit` | user | 200 steps |
| graphics | `axes`, `grid`, `keepRatio`, `snapToGrid`, `pointSnap` | file | mode default |
| graphics | `showLabels` (`all`/`points`/`none`/`new-points-only`) | file | mode default |
| graphics | `defaultLineWidth`, `defaultPointSize` | file | 3 and 5 |
| graphics | `fontSize` | user | 16 px |
| algebra | `sort` (`creation`/`type`/`dependency`/`layer`), `description` (`value`/`definition`/`both`) | user | creation, value |
| sheet | the SheetSettings of the spreadsheet design | file | see spreadsheet |
| keyboard | `keyboard` (`auto`/`on`/`off`), `keyboardLayout` | user | auto |
| accessibility | `reducedMotion` (`system`/`on`/`off`), `highContrast`, `textScale` (80-200%), `screenReaderMode` | user | system, off, 100%, off |
| language | `language`, `decimalSeparator` (`auto`/`.`/`,`) | user | browser |

Persistence: user-scope settings go to `localStorage` under `incantly.settings.v1` (JSON, validated on read; bad values fall back to defaults and are reported as a console warning, not a crash). File-scope settings are in the file's `settings` block and in `@` directives. A mode's defaults are used only where neither exists.

Reset: `reset('graphics')` restores mode defaults; the exam restores a snapshot.

Settings changes are lines when they are file-scope (`@angleunit degree`), so the model and scripts can set them; user-scope settings are not reachable from lines (a model should not change a learner's text size).

### 3.9 Languages

- **UI text:** message catalogue keyed by `LocaleKey`, one JSON per locale, ICU-style plurals. Fallback chain: `fr-CA -> fr -> en`. Missing key: shows the English text and logs a warning once. Locales load on demand (< 30 KB each).
- **Numbers:** `Intl.NumberFormat` with the locale for display; the decimal separator setting can override. Parsing in cells and input follows the same decimal separator, with an unambiguous rule: in the **language of lines**, the decimal separator is always `.` (the core grammar uses `,` as an argument separator). Learners typing `3,5` in a cell under a comma locale get the cell parser's conversion; in the algebra input it is the error `decimal_comma` with the hint `use 3.5`.
- **Direction:** `dir` follows the locale. Maths is always left-to-right inside an RTL UI (`<bdi dir="ltr">` around formulas); the canvas axes are not mirrored.
- **Command names:** the language of lines is English for all locales in the first versions (core design: localised command names are out of scope). Design for later: an alias table `{ locale: { 'Mittelpunkt': 'Midpoint' } }` applied by the tokenizer before the kernel, only to PascalCase command tokens, with scripts always saved in canonical English. The catalogue handed to the model is always English.
- **Text rendering:** Greek letters and subscripts via names `θ`, `x_1`; digit systems other than Latin digits are accepted in input fields and normalised to Latin digits before parsing (Arabic-Indic, Devanagari).
- **Switching:** `setLanguage` re-renders UI text, number formats and labels derived from locale; it does not change any object's definition.

### 3.10 Keyboard

The on-screen maths keyboard inserts text into the **structured maths editor**, which produces a line of our language. Layouts are data.

```ts
type KeyAction =
  | { kind: 'insert'; text: string; cursor?: number }                     // e.g. "sqrt()" with cursor inside
  | { kind: 'template'; template: 'fraction' | 'power' | 'subscript' | 'root' | 'abs' | 'pair' | 'list' | 'mixed' | 'sum' }
  | { kind: 'command'; name: string }                                      // inserts "Name(" with a placeholder for the first arg
  | { kind: 'edit'; op: 'backspace' | 'delete' | 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'enter' | 'clear' }
  | { kind: 'shift' } | { kind: 'switch'; tab: string } | { kind: 'close' };

interface Key {
  readonly id: string;
  readonly label: string;              // visible text, may be a maths glyph
  readonly aria: LocaleKey;            // spoken name, e.g. "square root"
  readonly action: KeyAction;
  readonly longPress?: readonly KeyAction[];
  readonly width?: number;             // in key units, default 1
  readonly style?: 'normal' | 'function' | 'action' | 'primary';
}

interface KeyboardLayout {
  readonly id: KeyboardId;             // 'standard' | 'scientific' | 'notes' | 'geometry' | 'probability'
  readonly tabs: readonly { id: string; label: LocaleKey; rows: readonly (readonly Key[])[] }[];
  readonly shiftRows?: Record<string, readonly (readonly Key[])[]>;
}
```

Layouts:

- `standard` (graphing, classic): tabs `123` (digits, operators, `x y`, `^`, fraction, root, parentheses, `=`, `<`, `>`, `|`, `pi`, `e`), `f(x)` (sin cos tan ln log abs sqrt, `Derivative(` etc. as command keys), `ABC` (QWERTY letters with shift and long-press for subscripts and accents), `αβγ` (Greek).
- `scientific`: one big page of calculator keys: digits, `+ − × ÷`, fraction, mixed number, powers, roots, `sin cos tan` and inverses, `ln log`, `e^x`, `10^x`, `π`, `Ans`, `EXP`, degree-minute-second, parentheses, `S↔D` (fraction/decimal toggle), memory (none in stage 1), shift for second functions.
- `notes`: text-friendly keyboard (letters and punctuation) with a maths tab.
- `geometry`: a small tab with point/segment/circle commands as keys plus digits and Greek angle letters.
- `probability`: digits plus `μ σ ≤ ≥ P(`.

Behaviour: open on focus of a maths field on touch devices when `keyboard: auto`; never on desktop with a physical keyboard unless asked; docks at the bottom of the app (attached) or the page (detached, option); height 36% of the viewport at most; resizes the figure area instead of covering it.

Physical keyboard: all of `0-9 + - * / ^ ( ) , . = < >` type directly; `/` makes a fraction in the editor when in "math mode"; typed `sqrt(`, `pi` and Greek names (`alpha`) convert on the fly. Shortcuts: `Ctrl/Cmd+Enter` run, `Esc` cancel, `Tab` accepts a completion, `Ctrl/Cmd+Z` undo.

### 3.11 Accessibility settings

- `reducedMotion` follows the OS by default; when on, view animations are instant, flashes become outlines, the clock does not autoplay on load.
- `highContrast` swaps to a palette with 7:1 text contrast and heavier strokes.
- `textScale` scales UI text and canvas labels (not object geometry).
- `screenReaderMode` turns on the hidden object list, live announcements for changes, and replaces drag with keyboard moves as the main path.

## 4. Edge cases

- A command allowed by the mode but forbidden by the exam: exam wins (intersection).
- A restriction that removes a command used in the current figure: existing objects keep working (they are already defined); only new uses are blocked. Redefinition of an object that already uses a forbidden command is blocked.
- Exam started with an unsaved figure: the figure is saved in memory under a snapshot key and restored on `exit()` if the profile says `keepFigure: true`.
- Page reload during an exam: state persists in `sessionStorage` (profile, start time, signals); on reload the exam resumes and records `reload` as a signal.
- Clock skew: durations use `performance.now()`, not wall time; the summary also records the wall times for humans.
- RTL with a physical keyboard: typed text is stored logically; the cursor moves visually.
- Locale with a decimal comma and a formula `f(x) = 2,5x`: `decimal_comma` error; no silent change.
- Two apps on one page in different modes and languages are independent.

## 5. Performance targets

| Measure | Target |
|---|---|
| Create app in `graphing` | under 150 ms to first paint |
| `setMode` dry run on 500 objects | under 30 ms |
| Open keyboard | under 50 ms |
| Locale switch (cached) | under 100 ms |
| Policy check per command call | under 5 µs (a `Set` lookup, built at mode load) |
| Exam signal recording | no more than one event per second per kind (debounced) |

Policy sets are compiled at mode load into `ReadonlySet<string>` for commands and tools; checking is a lookup.

## 6. Better than the reference app

- A mode is a readable data table, not 70 overridden methods; adding a mode adds a record.
- Command and tool policies are data: the catalogue given to the model is generated from the same table, so the model only sees what the mode permits.
- Derived modes that can only narrow.
- Exam rules are a profile, shown in plain words, with a summary and an honest note on what a browser can detect.
- Auto sliders are a visible chip, never a silent guess.
- Settings are typed, scoped (file vs user), and validated; file-scope settings are lines, so scripts reproduce them.
- Command names stay English in files; localisation is a front-end alias layer.
- Keyboard layouts are data with spoken names for every key.

## 7. Changes to the core design

1. Add directives: `@restrict`, `@exam` (host-owned, `bad_directive` if the model writes them), plus `@angleunit`, `@rounding`, `@coords`, `@title` (also in the embed doc).
2. The command table (`CommandSpec`) needs a stable `group` for each command so mode policies can name groups; add `groupId` values to the closed set.
3. `unknown_name` errors include `suggest: { create: string }` when a slider would resolve it (for the UI chip). The teacher ignores the field.
4. Add error kind `mode_forbids` and `decimal_comma`.
5. Unnamed expression lines are an error in the language (core 3). The scientific calculator needs "calc lines". Resolution: the UI wraps each calc line as `r1 = <expression>` (hidden names `r1`, `r2`, …, `ans` is an alias of the latest), so the language is unchanged.
6. A `figure` mode must exist in the core: it is what the teacher's tools and the film use.

## 8. Cross-area

Uses: the tool groups of tools-2d, the command groups of every command area, the kernel's `unknown_name`/`mode_forbids` kinds, the sheet settings, the embed API's `ui` options.

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
