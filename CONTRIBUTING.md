# Contributing

Thank you for wanting to help.

## Before your first pull request

Incantly's source code is under the European Union Public Licence 1.2 (`LICENSE`), and the product is also offered under other terms (`TERMS.md`). So the project owners must be able to offer every part of the code under both.

Your first pull request therefore needs a signed contributor licence agreement. It says that:

1. the work is yours, or you have the right to give it;
2. you give the project owners a lasting, worldwide, free licence to use, change and relicense it, including under terms other than the EUPL;
3. you keep the copyright in your own work.

The project owners send the agreement when you open your first pull request. A pull request is not merged until it is signed.

## How we work

- Read `AGENTS.md` first: it has the rules every change follows.
- Every feature starts as a spec in `.kiro/specs/<feature>/`.
- `npm run check` (lint, typecheck and every test) must pass.
- Add only libraries listed in `docs/design/libraries.md`.
