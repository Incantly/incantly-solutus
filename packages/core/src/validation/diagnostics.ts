/** Problems the validator reports, always located in the agent's own fragment. */

export type Fragment = 'html' | 'css' | 'js' | 'scene';
export type Severity = 'error' | 'warning';

export interface Diagnostic {
  readonly fragment: Fragment;
  /** A stable rule id, used for repair hints and failure statistics. */
  readonly rule: string;
  readonly message: string;
  /** 1-based line within the fragment. */
  readonly line: number;
  /** 1-based column within the line. */
  readonly column: number;
  readonly severity: Severity;
}

export interface Position {
  readonly line: number;
  readonly column: number;
}

/** Maps string offsets to 1-based lines and columns. */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  position(offset: number): Position {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - this.starts[low]! + 1 };
  }

  get lineCount(): number {
    return this.starts.length;
  }
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

/** One line per problem, the way the repair report quotes them. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.fragment === 'scene' ? 'SCENE' : `AGENT_${d.fragment.toUpperCase()}`;
  return `${d.severity.toUpperCase()} ${d.rule}: ${d.message} (${where} line ${d.line}, column ${d.column})`;
}
