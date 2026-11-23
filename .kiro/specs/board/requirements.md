# Board: requirements

Area: `docs/features/board/` (`design.md`, `ui.md`, `errors.md`, `agent.md`). Package `packages/board` (`@incantly/board`), built on `@incantly/view` and `@incantly/sdk`. Web first; React Native is designed (design 14), not built. Branch `feat/board`.

### R1. Layers (design 3)

1. `packages/board/src/core` SHALL have no DOM, timers, network or `Date`, and SHALL run in Node.
2. Input SHALL reach the core only as `InputSample` and key events; drawing SHALL leave the core only through `BoardPainter`.
3. The web input and painter SHALL live in `src/web`; the web UI shell in `src/web/ui`.

### R2. Store and history (design 4)

1. Every record SHALL be plain JSON and checked against its kind on every write and load.
2. `board.change(origin, fn)` SHALL apply all writes together and send one diff with its origin.
3. One transaction SHALL be one undo step; a stroke or a drag SHALL be one step; camera, selection and pictures SHALL not be steps.
4. Over a limit, a transaction SHALL be refused with `limit` and change nothing.

### R3. Pages and the endless plane (design 5, 9)

1. A document SHALL hold 1 to 100 ordered pages, each an endless plane with its own saved camera.
2. Add, remove (not the last), rename, move and duplicate SHALL each be one undo step.
3. Only the current page SHALL have a spatial index, tiles and mounted figure cards.
4. Zoom SHALL range from 0.05 to 20, about the pointer; pan by wheel, Space-drag, middle-drag and two fingers.

### R4. Ink (design 6)

1. The web input SHALL read every coalesced sample, with pressure, tilt, twist and buttons.
2. A mouse, or a pen that only reports 0.5, SHALL get simulated pressure from speed.
3. Strokes SHALL be stored as samples in typed arrays; outlines SHALL be our own code, cached until the stroke changes.
4. The stroke being drawn SHALL draw on a live layer; predicted samples SHALL draw on the overlay and never be stored.
5. Pen, highlighter, eraser (whole and partial), laser and lasso SHALL work; the pen's eraser end SHALL erase.
6. While a pen is down or near, touches SHALL not draw.

### R5. Shapes and editing (design 7)

1. Kinds `ink`, `rect`, `ellipse`, `triangle`, `diamond`, `star`, `line`, `arrow`, `text`, `sticky`, `frame`, `image`, `figure` SHALL be registered through `KindDef`, the same interface a host uses.
2. Select, move, resize, rotate, group, align, distribute, order, lock, duplicate, flip, copy and paste SHALL work, with snap guides.
3. Arrows SHALL stick to shapes through bindings and follow them.
4. Shape fixing SHALL turn a held rough line, ellipse, polygon (3 to 6 corners) or arrow into a clean shape in one undo step, only under the 6% fit rule.
5. Paste SHALL accept board JSON, plain text, an Incantly script (a figure card) and images.

### R6. Figure cards (design 8)

1. A figure card SHALL store `script`, `mode`, size and `picture`; the script SHALL be the only source of truth.
2. At most 3 figure cards SHALL be live, under one `SchedulerHost` per board; the rest SHALL show their picture.
3. Double-click or Enter SHALL give a card the input; Esc SHALL give it back.

### R7. Customisation (design 10)

1. Tools, toolbar groups and position, icons, keys, menus, strings, theme and UI parts SHALL all be options of `createBoard`.
2. Built-in tools and kinds SHALL use the same `ToolDef` and `KindDef` a host uses; `defaultTools` SHALL be every built-in tool, a list a host filters; `inkTools` SHALL be the ink tools and the hand.
3. Custom SVG icons SHALL be checked (`icon_invalid`); unknown tools (`tool_unknown`) and duplicate keys (`shortcut_conflict`) SHALL be reported, not thrown.
4. Without `container`, `createBoard` SHALL return the headless core.

### R8. Agents (design 11, agent.md)

1. `board_read` and `board` SHALL be exported as tool definitions with the action types of `agent.md`.
2. Each action SHALL be one transaction with origin `model`; a failed action SHALL change nothing and not stop the rest.
3. Circle to ask SHALL find the items in the circle, show suggestions at once from their kinds, and send the request through `BoardAgentTransport`.
4. Without a transport, Ask SHALL report `agent_unavailable`.

### R9. Saving (design 12)

1. `.incantly-board` files SHALL be deterministic JSON; ink SHALL be delta-encoded (about 5 bytes a point).
2. Load SHALL check every record (`board_invalid`), migrate, and keep unknown kinds unchanged.

### R10. Errors (errors.md)

Every error in `errors.md` SHALL be returned as a `Result` in the errors format; nothing SHALL throw out of a public call.

### R11. Speed (design 13)

The budgets of design 13 SHALL hold in `packages/board/bench/` (Node) and in Chrome with the CPU 4× slower, including zero garbage collections over a 10 s stroke.
