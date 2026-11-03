import type { FragmentName, FragmentSet } from './fragments';

/**
 * Edits instead of whole fragments (PRD 25.5, RP-5): a reply that changes a
 * few lines costs a few lines of output, not the whole scene. Each edit names
 * text to find in a fragment and its replacement:
 *
 *     ```edit js
 *     <<<<<<< SEARCH
 *     const g = inc.param('g', { min: 1, max: 20, value: 9.8 });
 *     =======
 *     const g = inc.param('g', { min: 1, max: 25, value: 3.7 });
 *     >>>>>>> REPLACE
 *     ```
 */

export interface Edit {
  readonly search: string;
  readonly replace: string;
}

export interface ParsedEdits {
  /** Edits by fragment, in the order they came. */
  readonly edits: Partial<Record<FragmentName, Edit[]>>;
  readonly problems: readonly string[];
  /** Whether the reply held any edit block at all. */
  readonly found: boolean;
}

const EDIT_FENCE = /^\s*```\s*edit[\s_-]*(js|javascript|html|css)\s*$/i;
const CLOSE_FENCE = /^\s*```\s*$/;
const SEARCH = /^\s*<{5,9}\s*SEARCH\s*$/;
const DIVIDER = /^\s*={5,9}\s*$/;
const REPLACE = /^\s*>{5,9}\s*REPLACE\s*$/;

export function parseEdits(text: string): ParsedEdits {
  const edits: Partial<Record<FragmentName, Edit[]>> = {};
  const problems: string[] = [];
  let found = false;
  let block: { name: FragmentName; lines: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!block) {
      const fence = EDIT_FENCE.exec(line);
      if (fence) {
        const language = fence[1]!.toLowerCase();
        block = { name: language === 'javascript' ? 'js' : (language as FragmentName), lines: [] };
        found = true;
      }
      continue;
    }
    if (CLOSE_FENCE.test(line)) {
      readBlock(block.name, block.lines, edits, problems);
      block = null;
      continue;
    }
    block.lines.push(line);
  }
  if (block) problems.push(`The edit ${block.name} block was never closed`);
  return { edits, problems, found };
}

function readBlock(name: FragmentName, lines: readonly string[], edits: Partial<Record<FragmentName, Edit[]>>, problems: string[]): void {
  let state: 'outside' | 'search' | 'replace' | 'broken' = 'outside';
  let search: string[] = [];
  let replace: string[] = [];
  for (const line of lines) {
    if (state === 'outside') {
      if (SEARCH.test(line)) {
        state = 'search';
        search = [];
        replace = [];
      } else if (line.trim() !== '') {
        problems.push(`Text outside a SEARCH/REPLACE pair in the edit ${name} block: "${line.trim().slice(0, 60)}"`);
      }
    } else if (state === 'search') {
      if (DIVIDER.test(line)) state = 'replace';
      else search.push(line);
    } else if (state === 'broken') {
      // An edit with a second divider is dropped up to its end, or to the next edit's start.
      if (REPLACE.test(line)) state = 'outside';
      else if (SEARCH.test(line)) {
        state = 'search';
        search = [];
        replace = [];
      }
    } else if (REPLACE.test(line)) {
      (edits[name] ??= []).push({ search: search.join('\n'), replace: replace.join('\n') });
      state = 'outside';
    } else if (DIVIDER.test(line) || SEARCH.test(line)) {
      // Pairs chained without closing each one: the marker is never code, and the edit it broke is not applied.
      problems.push(`An edit in the ${name} block has a second ======= or a <<<<<<< SEARCH before its >>>>>>> REPLACE; close each edit with >>>>>>> REPLACE before the next`);
      if (SEARCH.test(line)) {
        state = 'search';
        search = [];
        replace = [];
      } else state = 'broken';
    } else {
      replace.push(line);
    }
  }
  if (state === 'search' || state === 'replace') problems.push(`An edit in the ${name} block has no closing >>>>>>> REPLACE`);
}

/** A line left over from an edit block: never part of a scene. */
export const MARKER_LINE = /^\s*(?:<{5,9}\s*SEARCH|={5,9}|>{5,9}\s*REPLACE)\s*$/m;

export interface Applied {
  readonly text: string;
  /** Why edits did not apply, by their number from 1. */
  readonly failed: readonly string[];
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0 && out.length < 3; at = haystack.indexOf(needle, at + 1)) out.push(at);
  return out;
}

/** Whether `wanted` stands in `text` exactly once, exactly or line by line with surrounding spaces ignored. */
function placedOnce(text: string, wanted: string): boolean {
  const exact = occurrences(text, wanted).length;
  if (exact > 0) return exact === 1;
  const want = wanted.split('\n').map((l) => l.trim());
  while (want.length > 0 && want[0] === '') want.shift();
  while (want.length > 0 && want.at(-1) === '') want.pop();
  if (want.length === 0) return false;
  const lines = text.split('\n');
  let found = 0;
  for (let s = 0; s + want.length <= lines.length && found < 2; s++) {
    if (want.every((w, k) => lines[s + k]!.trim() === w)) found++;
  }
  return found === 1;
}

/** Text with each run of spaces, tabs and line breaks as one space, and where each kept character stands in the original. */
function squeezed(text: string): { readonly text: string; readonly at: readonly number[] } {
  let out = '';
  const at: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (!space && out.length > 0) {
        out += ' ';
        at.push(i);
      }
      space = true;
    } else {
      out += c;
      at.push(i);
      space = false;
    }
  }
  return { text: out, at };
}

/**
 * Where `search` stands in `text` when runs of whitespace count as one
 * space: a SEARCH copied with other indentation, from the middle of a line,
 * or with a long line broken in two. 'many' when it stands in more than one
 * place, null when nowhere.
 */
function looseMatch(text: string, search: string): { readonly start: number; readonly end: number } | 'many' | null {
  const needle = squeezed(search.trim()).text;
  if (needle === '') return null;
  const hay = squeezed(text);
  const found = occurrences(hay.text, needle);
  if (found.length > 1) return 'many';
  if (found.length === 0) return null;
  const first = found[0]!;
  return { start: hay.at[first]!, end: hay.at[first + needle.length - 1]! + 1 };
}

/**
 * Applies edits in order. Each SEARCH must match once: exactly, or else line
 * by line with surrounding spaces ignored, or else with every run of
 * whitespace taken as one space. An empty SEARCH appends. An edit whose
 * SEARCH is gone but whose replacement stands once already is taken as
 * applied, as when a reply repeats its edits.
 */
export function applyEdits(source: string, edits: readonly Edit[]): Applied {
  let text = source;
  const failed: string[] = [];
  edits.forEach((edit, i) => {
    const number = i + 1;
    if (edit.search.trim() === '') {
      text = `${text.replace(/\n*$/, '\n')}${edit.replace}\n`;
      return;
    }
    const exact = occurrences(text, edit.search);
    if (exact.length === 1) {
      text = text.slice(0, exact[0]) + edit.replace + text.slice(exact[0]! + edit.search.length);
      return;
    }
    // Line by line, ignoring indentation and trailing spaces.
    const want = edit.search.split('\n').map((l) => l.trim());
    while (want.length > 0 && want[0] === '') want.shift();
    while (want.length > 0 && want.at(-1) === '') want.pop();
    const lines = text.split('\n');
    const starts: number[] = [];
    for (let s = 0; s + want.length <= lines.length && starts.length < 2; s++) {
      if (want.every((w, k) => lines[s + k]!.trim() === w)) starts.push(s);
    }
    if (starts.length === 1) {
      const s = starts[0]!;
      lines.splice(s, want.length, ...edit.replace.split('\n'));
      text = lines.join('\n');
      return;
    }
    // With every run of whitespace as one space: the text around the match, its indentation too, stays as it was.
    const loose = exact.length === 0 && starts.length === 0 ? looseMatch(text, edit.search) : null;
    if (loose && loose !== 'many') {
      text = text.slice(0, loose.start) + edit.replace.trim() + text.slice(loose.end);
      return;
    }
    // A reply that repeats an edit, correcting itself, finds its replacement already in place: nothing to do.
    if (exact.length === 0 && starts.length === 0 && loose === null && edit.replace.trim() !== '' && placedOnce(text, edit.replace)) return;
    failed.push(
      exact.length > 1 || starts.length > 1 || loose === 'many'
        ? `edit ${number} matches more than one place; include a line or two more so its SEARCH is unique`
        : `edit ${number} did not match: copy its SEARCH text exactly from the fragment`,
    );
  });
  return { text, failed };
}

/** Applies parsed edits to a set of fragments. */
export function applyFragmentEdits(fragments: FragmentSet, edits: ParsedEdits['edits']): { readonly fragments: FragmentSet; readonly failed: readonly string[]; readonly changed: readonly FragmentName[] } {
  const out: FragmentSet = { ...fragments };
  const failed: string[] = [];
  const changed: FragmentName[] = [];
  for (const name of ['html', 'css', 'js'] as const) {
    const list = edits[name];
    if (!list || list.length === 0) continue;
    const source = fragments[name];
    if (source === undefined) {
      failed.push(`there is no ${name} fragment to edit`);
      continue;
    }
    const applied = applyEdits(source, list);
    failed.push(...applied.failed.map((f) => `${name}: ${f}`));
    if (applied.text !== source) {
      out[name] = applied.text;
      changed.push(name);
    }
  }
  return { fragments: out, failed, changed };
}

/** The reply without its edit blocks, so whole fragments in it can be read as usual. */
export function withoutEditBlocks(text: string): string {
  const out: string[] = [];
  let inside = false;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!inside && EDIT_FENCE.test(line)) {
      inside = true;
      continue;
    }
    if (inside) {
      if (CLOSE_FENCE.test(line)) inside = false;
      continue;
    }
    out.push(raw);
  }
  return out.join('\n');
}
