# Errors: one format, one catalogue, one set of recovery rules

Area owner: the app-wide error system. Every other area (language, kernel, geometry, calculus, particles, physics, view, teacher) raises errors in this format and uses these recovery rules. This replaces core design section 9 and extends it; changes are listed at the end. Companion files: `errors.md` (the catalogue of every kind), `agent.md`, `ui.md`.

---

## 1. What the system does for people

### Learner
- A mistake in a typed line shows right under the line, at the exact spot, in plain words, with a one-click fix when we have one. Nothing opens a dialog. The figure never changes when a line fails.
- An object that cannot be computed says why, in words ("the lines never meet"), and a click goes to the cause.

### Teacher (AI model)
- Every failure comes back as data with: where, what, what was expected, the accepted forms, a hint, ready-made corrected lines, and what to do next (`recovery`). The model fixes most lines on the next try.
- Non-errors that matter (an object became undefined, a delete cascaded) come back as structured notices in the same result, so the teacher describes the figure from facts.

### Author / developer
- One schema, one place to add a kind, golden tests for every kind, stable machine codes, and a message template per kind (no free-text strings scattered through code).

---

## 2. What the reference app does (in plain words)

- **Two worlds.** Text that fails to parse is one generic "please check your input"; the line and column the parser knew are discarded. Text that parses but is wrong raises a named error carrying a localisation key and a few string parts. There are about fifty named errors (undefined variable, illegal argument, wrong number of arguments, unknown command, circular definition, redefinition failed, fixed or dependent object may not change, name in use, unbalanced brackets, illegal addition/subtraction/multiplication/division/exponent/comparison/boolean/list operation, number expected, function expected, invalid equation, invalid function, incomplete equation, file open/save failed, delete failed, rename failed, plus symbolic-engine ones such as timeout).
- **Command errors** add the command's accepted syntax lines to the message and open a help popup for that command. Argument errors name the offending argument as text; argument-count errors say how many were given.
- **Delivery.** Errors go to a handler object that shows a dialog or an inline message. The embedding API returns only true or false for "did my command work". A "silent" handler logs and drops. An analytics logger can record the error and the input.
- **Loss.** The error type is an enum plus a message string; callers get the message, not a structured object. The failing position is lost. An unknown variable may trigger an offer to create sliders rather than an error. A name that does not exist is sometimes silently split into a product.
- **Runtime failures** never throw: outputs go undefined and everything downstream follows.
- **In scripts**, the failing line number is added to the message.

Strengths: undefined as a value; command syntax shown on a bad call; a small closed set of kinds. Weaknesses: generic parse error, position lost, text-only result, dialogs, guessing, no machine-actionable fix, localised strings used as identity.

---

## 3. The error object (the unified format)

```ts
interface ErrorObject {
  ok: false;
  committed: false;                   // always false: a failing line changes nothing
  kind: ErrorKind;                    // stable, snake_case, section 4 and errors.md
  code: string;                       // stable machine code: area letter + 3 digits, e.g. "L003"
  phase: Phase;                       // where it was detected
  message: string;                    // one plain sentence, built from messageKey + params
  messageKey: string;                 // "kernel.cycle" - for later localisation
  params: Record<string, string | number | boolean | string[]>;

  // where
  line: number;                       // 1-based, in the submitted batch or file
  col: number;                        // 1-based, in characters (UTF-16 units; see 3.3)
  endCol: number;                     // exclusive
  token: string;                      // the offending text
  source?: string;                    // the full line, when line is short (<= 200 chars)

  // how to fix
  expected: string[];                 // tokens or names that would be accepted here
  forms: string[];                    // accepted forms of the command, one line each (max 6)
  formsOmitted?: number;              // how many more forms exist
  hint?: string;                      // one sentence of advice
  suggest: string[];                  // 0..3 complete replacement lines that are likely to pass
  recovery: Recovery;                 // what the caller should do next, section 6
  related?: string[];                 // object names involved
  path?: string[];                    // for cycles: the chain of names
  blockedBy?: { line: number; kind: ErrorKind };   // an earlier failure in this batch caused this one
  cause?: ErrorObject;                // a deeper error (e.g. inside a nested expression); at most 1 level
  fingerprint: string;                // kind + stable key, for "same error twice" detection
  severity: 'error';
}

type Phase = 'lex' | 'parse' | 'resolve' | 'typecheck' | 'plan' | 'commit' | 'load' | 'tool' | 'runtime-host';

type Recovery =
  | 'fix_line'        // rewrite this line using hint/expected
  | 'use_suggestion'  // one of suggest[] is very likely right
  | 'choose_form'     // pick one of forms[]
  | 'create_first'    // define a missing object, then resend this line
  | 'fix_earlier'     // blockedBy: fix that line first
  | 'choose'          // a decision is needed (unfix, rename, delete first)
  | 'rewrite'         // change inputs or names; same intent
  | 'skip'            // do not retry; continue without this line
  | 'report';         // internal fault; tell a human via logs
```

### 3.1 Notices (non-errors)

Results that are successes but carry facts the caller should know:

```ts
interface Notice {
  severity: 'info' | 'warning';
  code: string;                       // "K101"
  kind: NoticeKind;                   // e.g. became_undefined, dependents_removed, property_detached
  message: string;
  params: Record<string, ...>;
  names?: string[];
}
```

They live in `notices` on the result (the kernel also keeps the same array in `changed.warnings` so older readers work) and are never confused with errors: errors have `ok: false`.

### 3.2 Undefined reasons

Not errors, but part of the same family because they have `reason`, `cause` and plain-language text. The catalogue and the phrase table are in `errors.md` section 3 and `agent.md`.

### 3.3 Positions

- `line` counts lines of the submitted text starting at 1. For a batch of lines from `draw`, line 1 is the first line sent. For a file, file lines (so a comment or blank line counts).
- `col` and `endCol` count UTF-16 code units, which matches JavaScript string indexing and so editors and the model's own substring operations. Surrogate pairs count 2. The error also gives `token` so the model does not need to count.
- A zero-width error (something is missing) has `endCol === col` and `token === ""`; `expected` says what is missing, and `hint` says where.

### 3.4 Message style

- One sentence, present tense, names the thing: "M is not defined." "Circle has no form (Point, Point, Number)." "A would depend on itself: A -> M -> A."
- No blame, no "please", no exclamation marks.
- Numbers are written as written by the user; names exactly as spelled.
- Messages are built from `messageKey` + `params` through a table of templates in English. The key is the identity; the sentence can change without a breaking change.

### 3.5 Size

An error object must serialise to at most ~800 characters in the compact form sent to a model (full form kept for the UI). Compaction rules: drop `source` if the model sent the line; cap `forms` at 4 plus `formsOmitted`; cap `expected` at 8; cap `suggest` at 3.

---

## 4. Kinds (index; full catalogue in `errors.md`)

```ts
type ErrorKind =
  // lex and parse
  | 'syntax' | 'unbalanced' | 'bad_number' | 'unterminated_string' | 'bad_character'
  | 'unknown_directive' | 'bad_directive'
  // resolve
  | 'unknown_name' | 'unknown_command' | 'unknown_property' | 'reserved_name' | 'bad_name'
  | 'name_taken' | 'unnamed_object' | 'duplicate_param' | 'not_callable'
  // typecheck
  | 'no_matching_form' | 'arg_count' | 'type_mismatch' | 'type_change' | 'bad_property_value'
  | 'bad_range' | 'bad_argument'
  // graph
  | 'cycle' | 'forward_reference' | 'locked' | 'not_free' | 'missing_rate'
  // history
  | 'nothing_to_undo'
  // limits and io
  | 'limit' | 'load_failed' | 'version'
  // tools and host
  | 'tool_input' | 'tool_busy'
  // fault
  | 'internal';
```

(`bad_argument` is for a well-typed argument with an invalid value known at plan time, e.g. a polygon with 2 sides. Value-dependent failures at run time are undefined values, not errors.)

---

## 5. How errors are raised

Every area throws nothing across its public boundary. The functions return `Result<T, ErrorObject>`.

```ts
type Result<T> = { ok: true; value: T; notices: Notice[] } | ErrorObject;

function err(kind: ErrorKind, at: Span, params: Params, extra?: Partial<ErrorObject>): ErrorObject;
```

- `err` fills `code`, `message`, `messageKey`, `phase`, `recovery`, `fingerprint` from a table entry for `kind`, so call sites state only what is specific: the span, the params, and any `forms`, `expected`, `suggest`.
- A **registry** (`errorTable: Record<ErrorKind, ErrorSpec>`) holds for each kind: code, phase, message template, default recovery, whether it may carry `forms`, a description for docs. A unit test fails if a kind is missing, if two kinds share a code, or if a template uses a param the kind does not declare.
- **Suggestions** are produced by small pure helpers in the errors package: `closestNames(name, candidates, k)` (edit distance with transposition, case-insensitive tie-break, limit 3, distance threshold scaled by length), `fixesFor(kind, ctx)` for known patterns (missing `*` after a number, `=` vs `==` in a condition, missing closing bracket at end of line, degree sign), `defineLine(name, expectedType)` (produces `k = 1 in 0..10` for an unknown name used as a number). Helpers are deterministic and tested.
- Rules (area code) never format messages. They return `bad_argument` with params or return an undefined value with a reason.
- **Internal faults** are caught at the transaction boundary (kernel), the tool boundary (teacher) and the frame boundary (view). They become `internal` errors, with a stack kept in the log, not in the object.

### 5.0 Check-time hooks on commands

A rule runs only after a line is accepted, so on its own a command can only make its object undefined. Two hooks let a command fail the line instead, while it is still being checked:

- `CommandForm.check(c)` is called once the arguments fit that form. It is told, per argument, the type as text, the text as written, and the value when the argument is a literal (a number with or without a sign, a named constant, a boolean, a plain text, a point or list of literals). A value that is not a literal has no `literal`, so the hook leaves it to the rule: `Circle(O, -2)` is a `bad_argument` on the line, and `Circle(O, r)` with `r = -2` is an object that is undefined with `negative_radius`.
- `CommandSpec.refuse(c)` is called when the arguments fit no form, with the same facts for the arguments as written. A refusal replaces the general `no_matching_form` or `arg_count` with a specific error: `PointOn(3)` is `not_a_path`. When it returns nothing, the general error stands. A real error inside an argument (an unknown name) still comes first.

Both return a `Refusal`: a kind, one sentence, and optionally a hint, up to 3 suggested lines and the argument to point at. Both must be pure. The kind must be in the error table; a hook that names an unknown kind, or that throws, gives an `internal` error. A refused line changes nothing, like any other failing line.

### 5.1 Nested expressions

When the fault is deep inside a larger line, the outermost span is the line, but `col/endCol/token` point at the innermost token that is wrong. `cause` is used only when the outer problem is a different kind (e.g. the line is `no_matching_form` because the third argument failed to type; `cause` is the `type_mismatch` inside it). One level only; deeper chains are flattened to the innermost.

### 5.2 Multiple errors in a line

The first error in reading order wins and is returned. We do not return a list for one line: models fix one thing at a time and long lists cost tokens. Exception: `load` mode collects one error per line across a file.

---

## 6. Recovery rules

These are the rules every caller follows. They are part of the contract, tested in the golden suite.

1. **Atomic line.** A failed line changes nothing. Always (`committed: false`).
2. **Independent lines.** In a batch run with `mode: 'independent'`, lines run in order; a failure does not stop later lines (the default `atomic` mode rolls the whole batch back instead). A later line that reads an object an earlier line failed to make gets `blockedBy`, and `recovery: 'fix_earlier'`.
3. **Retry budget.** The teacher retries a line at most twice. The `fingerprint` of the second retry's error equal to the first means stop. After the budget, `skip`.
4. **Prefer `suggest`.** If `suggest` is non-empty and `recovery` is `use_suggestion`, send the first suggestion unchanged.
5. **No silent repair by the engine.** The engine never fixes a line itself. (A UI may apply a suggestion only on the learner's click.)
6. **Never loop on `internal`.** `recovery: 'report'` or `'skip'`: do not retry the same text.
7. **Say only what was drawn.** After any error the teacher describes the figure from `figure` or successful results only.
8. **Errors do not appear aloud.** The teacher does not speak error kinds or "retry". If a feature cannot be drawn, it says what it did draw, or draws another way.
9. **Dry-run first for risky edits.** Redefine or delete on objects with many dependents uses `dryRun` first when the teacher has not seen the dependents recently.
10. **Batch fingerprints.** If three lines in a row fail with the same `kind` and none succeeded, the teacher stops the batch and calls `figure` before writing more.

---

## 7. Delivery

| Channel | What is sent |
|---|---|
| Teacher tool result (`draw`) | compact error object (3.5), one per failed line, in line order |
| Learner input line | full error object; inline message under the caret, one-click `suggest` |
| Properties/rule fields | full error object, shown under the field |
| Script load | `LoadReport` with the list; a summary notice; errors pane |
| Logs | full error object plus the line; `internal` includes stack |
| Telemetry (opt-in) | `kind`, `code`, `fingerprint`, phase, area, and whether the next attempt succeeded. **Never** the source text or names unless the author enabled it. |

Telemetry measures the acceptance target: "model fixes an error on its next line in 9 of 10 cases"; the `fixedNext` flag is set when the next `draw` line with the same target name succeeded.

---

## 8. Numeric failures

Numbers live in rules, which return undefined with a reason; they do not raise errors. The numeric reasons and the policy:

- **Non-finite results** (`NaN`, `±Infinity`) from a formula are never stored as a Number value. The rule wrapper converts them: `0/0`, `sqrt(-1)`, `asin(2)` become `out_of_domain` or `not_finite`, `1/0` becomes `division_by_zero`. The reason is chosen by the built-in that produced it (each built-in declares its domain check) and falls back to `not_finite`.
- **Overflow:** results with `|x| > 1e300` become `overflow`, to avoid `Infinity` creeping in through products.
- **Convergence:** iterative methods (root finding, extremum, integral to tolerance, ODE steps) return `no_convergence` when they hit their iteration cap or error estimate cannot be reached, with the achieved estimate and the wanted one in the object's `detail`, a short text. They never return a half-converged number silently.
- **Tolerance:** equality tests in geometry (parallel, coincident, collinear) use a scale-relative tolerance (default `1e-9 * max(1, |scale|)`) set once in the figure; reasons `parallel`/`coincident`/`degenerate` use it.
- **Determinism:** the same inputs give the same reason; no wall-clock timeouts decide numerical outcomes (a per-rule *work* budget, counted in iterations, replaces time where results must be reproducible; the wall-clock budget exists only as a fallback and yields `timeout`).

The reference app: NaN flows as "undefined"; no reason; the symbolic engine has a timeout error.

---

## 9. Limits

Limits are errors at line time (`limit`) and undefined at run time (`limit` reason). The default table is in `kernel/errors.md` section 6; areas add their own entries (particles count, list size, tool call size) through the same `Limits` object so a host sets them in one place.

---

## 10. Better than the reference app

1. Positions kept from lexer to the user (line, column, token, expected).
2. A structured result in every channel, not a string.
3. Stable codes and keys: identity is not a translated sentence.
4. `suggest` lines: a repair a model or a button can apply.
5. `blockedBy`: one real fault, not a pile of copies.
6. `recovery` states the next move.
7. Undefined chains with `cause` and plain-language reason.
8. No guessing: unknown names, products, auto-sliders.
9. Atomic lines and exact rollback.
10. Registry + tests: no kind without a code, template, example and golden test.
11. Telemetry that measures fix rate without leaking content.

---

## 11. Changes to the core design (section 9)

1. The error object gains `committed`, `code`, `phase`, `messageKey`, `params`, `suggest`, `recovery`, `blockedBy`, `path`, `cause`, `fingerprint`, `formsOmitted`, `source`, `related`, `severity`.
2. New kinds: `unbalanced`, `bad_number`, `unterminated_string`, `bad_character`, `unknown_directive` (split from `bad_directive`), `unknown_property`, `bad_name`, `name_taken`, `arg_count`, `bad_property_value`, `bad_range`, `bad_argument`, `forward_reference`, `locked`, `not_free`, `nothing_to_undo`, `load_failed`, `version`, `tool_input`, `tool_busy`, `internal`.
3. `limit` carries a `limit` param naming which.
4. Undefined reasons are extended (`coincident`, `no_intersection`, `overflow`, `degenerate`, `index_out_of_range`, `empty_list`, `no_convergence`, `timeout`, `input_undefined`, `not_set`, `limit`) and carry `cause`.
5. Notices (`info`/`warning`) are a defined type.
6. Compact form for the model (size cap).
7. Telemetry fix-rate measure added to acceptance.
8. `Result<T>` as the boundary type in every package.

---

## 12. Sources studied

Removed before the repository was made public. The study notes above are in our own words.
