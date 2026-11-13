# Lists and matrices: design

Lists built from rules, the everyday list commands, the `Matrix` and `Record` types, and linear algebra.

## Where the design lives

`docs/features/lists-matrices/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Cross-area decisions:
`docs/features/README.md` (decision 1: lists are 1-based).

## Code

- `packages/kernel/src/commands/lists/`: the area.
  - `types.ts`: `MatrixValue`, `RecordValue`, the area's type names, reasons and record schemas.
  - `rational.ts`: exact rationals on `BigInt` for the exact path.
  - `linalg.ts`: float linear algebra (LU, QR, Cholesky, SVD by one-sided Jacobi, symmetric eigen by Jacobi,
    general eigen by Hessenberg and shifted QR, eigenvectors by inverse iteration).
  - `exact.ts`: the exact path (Bareiss determinant, fraction-free Gauss–Jordan, Faddeev–LeVerrier, Krylov).
  - `list-commands.ts`, `matrix-commands.ts`: the command tables.
  - `ops.ts`: operators, indexing and fields for `Matrix` and `Record`, and list broadcasting.
  - `index.ts`: `registerLists(registry)`.
- Language hooks this area needs (generic, for any area type):
  - `registerBinaryOp` and `registerUnaryOp`: an area adds operator rows; the node keeps the area's implementation.
  - `registerIndexTyper` and `registerIndexReader`: indexing for an area type (`M[i]`).
  - Types `Record<Schema>`: `Ty.schema` names the schema; `registerRecordSchema` gives the field types; reading a
    field of a record value is the record's own `fields`.
  - Parameter types `@list`: a binder or value whose type is the element type of the list parameter `list`, and a
    return type `@list` for one element.

## How it fits

- A list of numbers is a `Float64Array`; any other list is an array of values (language 3.10).
- A matrix is `{ kind: 'matrix', rows, cols, data, exact? }`. `exact` holds `BigInt` numerators and denominators,
  row-major, and is present only when every entry came from a number literal (design 5.3).
- A record is `{ kind: 'record', schema, fields }`.
- Commands are ordinary command specs (groups `lists` and `matrices`); binders use the language's binder and body
  parameters.

## Decisions

- See "Decided against the design" in `requirements.md`.
- General eigenvectors use inverse iteration on `M - λI` for each real eigenvalue instead of back-substitution on the
  Schur form; the result is the same unit vectors.
- Symmetric eigen uses cyclic Jacobi (accurate, simple) rather than tridiagonal QL, within the same size limit.
