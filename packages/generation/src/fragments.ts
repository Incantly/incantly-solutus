/**
 * Reading the model's replies: the plan as JSON, and scene fragments as
 * fenced blocks. Fragments can be read while they stream (PRD 25.3): each one
 * is handed on as soon as its fence closes, so it can be checked before the
 * rest has arrived. Prose outside the fences is ignored.
 */

export type FragmentName = 'html' | 'css' | 'js';

export const FRAGMENT_NAMES: readonly FragmentName[] = ['html', 'css', 'js'];

export type FragmentSet = Partial<Record<FragmentName, string>>;

export interface ParsedFragments {
  readonly fragments: FragmentSet;
  readonly problems: readonly string[];
}

const LANGUAGES: Readonly<Record<string, FragmentName>> = { html: 'html', css: 'css', js: 'js', javascript: 'js' };
const FENCE = /^\s*```\s*([A-Za-z]*)\s*$/;

export class FragmentStream {
  private buffer = '';
  private open: { readonly name: FragmentName | null; readonly language: string; readonly lines: string[] } | null = null;
  private found: FragmentSet = {};
  private problems: string[] = [];
  private ended = false;

  constructor(private readonly onFragment?: (name: FragmentName, source: string) => void) {}

  /**
   * Starts the reply over. A call retried after a max_tokens cut-off
   * re-streams from its top: what the first attempt left half-parsed must
   * not stand, so the fragments found so far and the problems they caused
   * are dropped too.
   */
  reset(): void {
    this.buffer = '';
    this.open = null;
    this.found = {};
    this.problems = [];
    this.ended = false;
  }

  /** Feeds the next piece of the reply. */
  push(delta: string): void {
    if (this.ended) return;
    this.buffer += delta;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      this.line(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
  }

  /** The reply is complete. */
  end(): ParsedFragments {
    if (!this.ended) {
      if (this.buffer !== '') this.line(this.buffer);
      this.buffer = '';
      if (this.open) this.problems.push(`The ${this.open.language || 'last'} block was never closed`);
      this.open = null;
      this.ended = true;
    }
    return { fragments: { ...this.found }, problems: [...this.problems] };
  }

  /** Fragments complete so far. */
  get completed(): FragmentSet {
    return { ...this.found };
  }

  private line(raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const fence = FENCE.exec(line);
    if (!this.open) {
      if (fence) {
        const language = (fence[1] ?? '').toLowerCase();
        this.open = { name: LANGUAGES[language] ?? null, language, lines: [] };
      }
      return;
    }
    if (!fence || fence[1] !== '') {
      this.open.lines.push(line);
      return;
    }
    const { name, language, lines } = this.open;
    this.open = null;
    if (!name) {
      this.problems.push(`A \`\`\`${language || ' '} block is not one of html, css or js`);
      return;
    }
    // A second block of the same fragment is the model revising its first, as when it moves a figure from #stage to
    // two panels: the later one stands, and validation checks it against the script as always.
    const source = `${lines.join('\n')}\n`;
    this.found[name] = source;
    this.onFragment?.(name, source);
  }
}

export function parseFragments(text: string): ParsedFragments {
  const stream = new FragmentStream();
  stream.push(text);
  return stream.end();
}

/** Missing fragments in a complete scene reply. */
export function missingFragments(fragments: FragmentSet): FragmentName[] {
  return FRAGMENT_NAMES.filter((name) => fragments[name] === undefined);
}

export interface ParsedJson {
  readonly value: unknown;
  /** Why the reply could not be read as JSON, or null. */
  readonly problem: string | null;
}

/**
 * The first complete JSON value in the text, or null: braces inside strings
 * do not count, and a mismatched closer is not salvageable.
 */
function firstJsonValue(body: string): string | null {
  const start = body.search(/[{[]/);
  if (start < 0) return null;
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') closers.push('}');
    else if (c === '[') closers.push(']');
    else if (c === '}' || c === ']') {
      if (closers.pop() !== c) return null;
      if (closers.length === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

/** The plan object in a reply: the first ```json block, or else the outermost braces. */
export function parsePlanReply(text: string): ParsedJson {
  const fenced = /```json\s*\n([\s\S]*?)\n\s*```/i.exec(text);
  let body = fenced?.[1];
  if (body === undefined) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) return { value: null, problem: 'The reply has no JSON object' };
    body = text.slice(start, end + 1);
  }
  try {
    return { value: JSON.parse(body) as unknown, problem: null };
  } catch (error) {
    const problem = `The plan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    // A complete plan followed by trailing prose still parses from the front;
    // the schema judges what it reads, so only a real plan survives this.
    const first = firstJsonValue(body);
    if (first !== null) {
      try {
        return { value: JSON.parse(first) as unknown, problem: null };
      } catch {
        // Genuinely broken: report the strict error.
      }
    }
    return { value: null, problem };
  }
}
