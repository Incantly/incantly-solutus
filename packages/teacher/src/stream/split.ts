/**
 * The line splitter of prompt to figure (teacher design 7, R5.3): cuts a streamed reply at each newline and cleans what
 * the model wraps round a line. A line is complete at its newline; the splitter keeps only the text of the line being
 * written. It has no states: a code fence is dropped as a line, so nothing needs to know whether one is open.
 */

/** A list marker the model puts before a line: `1.`, `2)`, `-`, `*` or a bullet, followed by a space. */
const MARKER = /^(?:\d{1,3}[.)]|[-*•])\s+/u;

/**
 * One raw line as the line it holds, or `undefined` when nothing is left: a blank line, a code fence, a comment-only
 * line. A leading list number or bullet is cut off.
 */
export function cleanLine(raw: string): string | undefined {
  const text = raw.replace(/\r$/, '').trim();
  if (text === '' || text.startsWith('```') || text.startsWith('#')) return undefined;
  const bare = text.replace(MARKER, '').trim();
  return bare === '' || bare.startsWith('#') ? undefined : bare;
}

export interface SplitEnd {
  /** The last line, when the reply ended with no newline after it and the reply was whole. */
  readonly lines: readonly string[];
  /** The text of a line that was cut off with the reply (a `stream_cut`), left out. */
  readonly dropped?: string;
}

export class LineSplitter {
  private rest = '';

  /** Takes a piece of the reply; gives the lines it completed, in order. */
  push(piece: string): string[] {
    this.rest += piece;
    const out: string[] = [];
    let nl = this.rest.indexOf('\n');
    while (nl >= 0) {
      const line = cleanLine(this.rest.slice(0, nl));
      if (line !== undefined) out.push(line);
      this.rest = this.rest.slice(nl + 1);
      nl = this.rest.indexOf('\n');
    }
    return out;
  }

  /** The text of the line being written. */
  get pending(): string {
    return this.rest;
  }

  /**
   * The reply ended. A whole reply's last line needs no newline; a cut reply ends inside its last line, which is not a
   * line and is given back as `dropped`.
   */
  end(cut: boolean): SplitEnd {
    const text = this.rest;
    this.rest = '';
    if (cut) return text.trim() === '' ? { lines: [] } : { lines: [], dropped: text.trim() };
    const line = cleanLine(text);
    return { lines: line === undefined ? [] : [line] };
  }
}

/** Splits a whole reply (every line, the last one too). */
export function splitLines(text: string): string[] {
  const s = new LineSplitter();
  return [...s.push(text), ...s.end(false).lines];
}
