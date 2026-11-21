# Algebra view: requirements

Area: `docs/features/algebra-view/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Branch: `feat/algebra-view`.

### R1. One source of row text

**User story:** As a learner, I want the list to show what each object is, what it is now and what it means, in the
same words the live teacher reads.

1. THE SYSTEM SHALL format numbers by design 3.3: shortest-decimal rounding half away from zero, fractions with
   denominators up to 1,000 (and multiples of π), scientific form above 1e9 and below 1e-5, significant figures.
2. THE SYSTEM SHALL give the value text of every type in the table of design 3.3 (points, vectors, line equations,
   circle equations, segment lengths, polygon areas, lists truncated at 8 items).
3. Definitions SHALL be shown in Unicode maths (design 3.4) and descriptions from templates (3.5).
4. `summarize(object)` SHALL give the one-line text of design 3.17.
5. `niceRange(value)` SHALL give the slider ranges of design 3.10.

### R2. Rows, modes, sorting and filters

1. THE model SHALL build rows with the four display modes of design 3.2, and the second row only when it adds
   something.
2. Sorting by creation (default), type, dependency, name and layer, with collapsible groups; a text filter and
   "undefined only" and "hidden only"; helper objects (`aux`) hidden unless shown (design 3.6).
3. Each row SHALL know what it is made from, what uses it, and for an undefined row the chain of causes (design 3.7).

### R3. Editing and visibility

1. The marble SHALL write `A with visible = …` (undoable, saved) (design 3.9).
2. F2 SHALL select the name for a rename; editing a row redefines it (design 3.8).
3. "+ slider" SHALL write the range form `a in lo..hi step s` from `niceRange` (design 3.10).

### R4. The input line

1. A missing name SHALL offer one click that makes it a slider and runs the line, as one undo step (design 3.10).
2. Alt+Up and Alt+Down SHALL walk the history of lines typed (design 3.11).
3. `@algebra mode|sort|round|aux|input` directives SHALL set the view (design 3.15); `input Midpoint Segment` SHALL
   refuse other commands with the error kind `restricted`; `input off` SHALL hide the input line.

### R5. Next-step cards

1. After a line, at most one card SHALL be offered once per object: roots and turning points of a function, where two
   functions or a line and a circle meet, the mean and total of a number list; never when its result already exists
   (design 3.13).

### R6. Signature help

1. Inside a call, the box SHALL show the active form with the parameter being typed in bold, its summary, and how many
   forms there are and how many fit so far; Alt+Up and Alt+Down SHALL show the other forms (language ui.md).

## Decided against the design

- **History uses Alt+Up and Alt+Down**: plain Up and Down already move between rows in the studio.
- **The row model rebuilds all rows on each change** (7 ms at 2,000 objects) rather than updating rows incrementally
  and virtualising the list; the targets of design 3.16 for 5,000 objects are left for the view round that adds
  virtualisation.
- **Selection and canvas hover linking** (design 3.9) wait for the studio's selection model.
- **Value throttling while playing** (3.16) and per-object `with algebra = …` overrides are not done.
