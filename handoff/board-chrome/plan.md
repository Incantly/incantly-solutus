# Board chrome

Branch `feat/board-chrome`, from `integration`.

Spec: `.kiro/specs/board-chrome/`. The four pieces are the pen row, label alignment, edge pan, and one toolbar button per figure mode. The zoom bar is not moved. Graph-point dragging without a card is not in this piece.

Done when `npm run lint`, `npm run typecheck`, the board spec tests, and `npx vitest run --config packages/board/bench/vitest.config.ts` pass, and the board in the studio shows the row, the alignment, the pan, and the five buttons.
