/** Column bookkeeping for instrumented scenes. No parser here, so the Worker can use it. */

export interface ColumnShift {
  /** 1-based column in the original line where text was inserted. */
  readonly column: number;
  readonly length: number;
}

export interface InstrumentedScene {
  readonly code: string;
  /** Inserted text per 1-based line, in column order. */
  readonly shifts: Readonly<Record<number, readonly ColumnShift[]>>;
}

/** Maps a 1-based column in an instrumented line back to the agent's original column. */
export function originalColumn(scene: Pick<InstrumentedScene, 'shifts'>, line: number, column: number): number {
  const shifts = scene.shifts[line];
  if (!shifts) return column;
  let shifted = 0;
  for (const shift of shifts) {
    const at = shift.column + shifted;
    if (column < at) break;
    if (column < at + shift.length) return shift.column;
    shifted += shift.length;
  }
  return column - shifted;
}
