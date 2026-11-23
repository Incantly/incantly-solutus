/**
 * The line splitter of prompt to figure (teacher design 7 step 2, requirements R5.3, R5.4): it cuts a streamed reply at
 * each newline and drops blank lines, code fences and leading list numbers. It holds only the line being written.
 * Round 2 tests, written from the docs and the public exports (`LineSplitter`, `cleanLine`, `splitLines`).
 */
import { describe, expect, it } from 'vitest';
import { LineSplitter, cleanLine, splitLines } from '../../src/index';

/** Feeds `pieces` to a splitter and gives every line it completes, then what the end gives. */
function run(pieces: readonly string[], cut = false): { lines: string[]; end: { lines: readonly string[]; dropped?: string | undefined } } {
  const s = new LineSplitter();
  const lines: string[] = [];
  for (const p of pieces) lines.push(...s.push(p));
  return { lines, end: s.end(cut) };
}

describe('a line is complete at its newline (design 7 step 2)', () => {
  it('a piece with no newline gives no line yet', () => {
    const s = new LineSplitter();
    expect(s.push('c = Circle((0, 0)')).toEqual([]);
    expect(s.push(', 2)')).toEqual([]);
  });

  it('the line comes out with the piece that holds its newline, and not before', () => {
    const s = new LineSplitter();
    expect(s.push('c = Circ')).toEqual([]);
    expect(s.push('le((0, 0), 2)\nP = Po')).toEqual(['c = Circle((0, 0), 2)']);
    expect(s.push('intOn(c)\n')).toEqual(['P = PointOn(c)']);
  });

  it('one piece with several newlines gives several lines, in order', () => {
    expect(new LineSplitter().push('a = 1\nb = 2\nc = 3\n')).toEqual(['a = 1', 'b = 2', 'c = 3']);
  });

  it('a newline at the very start of a piece ends the line begun by the piece before', () => {
    const s = new LineSplitter();
    expect(s.push('a = 1')).toEqual([]);
    expect(s.push('\nb = 2\n')).toEqual(['a = 1', 'b = 2']);
  });

  it('the same text cut at every position gives the same lines', () => {
    const text = 'c = Circle((0, 0), 2)\nP = PointOn(c)\nQ = Point(1, 2)\n';
    const want = splitLines(text);
    expect(want).toEqual(['c = Circle((0, 0), 2)', 'P = PointOn(c)', 'Q = Point(1, 2)']);
    for (let at = 0; at <= text.length; at++) {
      const r = run([text.slice(0, at), text.slice(at)]);
      expect([...r.lines, ...r.end.lines], `cut at ${at}`).toEqual(want);
    }
  });

  it('one character at a time gives the same lines', () => {
    const text = 'a = 1\n\nb = a + 1\n```\nc = b * 2';
    const r = run([...text]);
    expect([...r.lines, ...r.end.lines]).toEqual(splitLines(text));
  });

  it('the text of the line being written is readable as `pending`', () => {
    const s = new LineSplitter();
    s.push('a = 1\nb = ');
    expect(s.pending).toBe('b = ');
  });

  it('Windows line ends do not leave a carriage return on the line', () => {
    expect(splitLines('a = 1\r\nb = 2\r\n')).toEqual(['a = 1', 'b = 2']);
  });
});

describe('what the splitter drops (R5.3)', () => {
  it('blank lines, and lines of spaces only', () => {
    expect(splitLines('a = 1\n\n   \n\t\nb = 2\n')).toEqual(['a = 1', 'b = 2']);
  });

  it('a code fence line, with or without a language', () => {
    expect(splitLines('```\na = 1\n```\n')).toEqual(['a = 1']);
    expect(splitLines('```text\na = 1\n```\n')).toEqual(['a = 1']);
    expect(splitLines('```incantly\na = 1\nb = 2\n```')).toEqual(['a = 1', 'b = 2']);
  });

  it('the lines between two fences stay', () => {
    expect(splitLines('Here:\n```\nr = 2\nc = Circle((0, 0), r)\n```\n')).toContain('c = Circle((0, 0), r)');
  });

  it('a leading list number, as `1.` or `1)`', () => {
    expect(splitLines('1. a = 1\n2. b = a + 1\n3) c = b * 2\n')).toEqual(['a = 1', 'b = a + 1', 'c = b * 2']);
  });

  it('a double-digit list number', () => {
    expect(splitLines('10. a = 1\n11. b = 2\n')).toEqual(['a = 1', 'b = 2']);
  });

  it('a comment-only line', () => {
    expect(splitLines('# the circle\nc = Circle((0, 0), 2)\n')).toEqual(['c = Circle((0, 0), 2)']);
  });

  it('a number that is part of the line is not a list number', () => {
    expect(splitLines('2 + 3\n')).toEqual(['2 + 3']);
    expect(splitLines('1.5 + a\n')).toEqual(['1.5 + a']);
    expect(splitLines('f(x) = x^2\n')).toEqual(['f(x) = x^2']);
    expect(splitLines('a1 = 1\n')).toEqual(['a1 = 1']);
  });

  it('a line keeps its inner spaces and loses only the spaces round it', () => {
    expect(splitLines('   c = Circle((0, 0),   2)   \n')).toEqual(['c = Circle((0, 0),   2)']);
  });

  it('a reply of nothing but fences and blanks gives no line', () => {
    expect(splitLines('```\n\n```\n')).toEqual([]);
    expect(splitLines('')).toEqual([]);
  });
});

describe('the end of the reply (R5.4)', () => {
  it('a whole reply with no newline after its last line still gives that line', () => {
    const r = run(['a = 1\nb = 2'], false);
    expect(r.lines).toEqual(['a = 1']);
    expect(r.end.lines).toEqual(['b = 2']);
  });

  it('a cut reply ends inside its last line: that text is not a line', () => {
    const r = run(['a = 1\nb = Circ'], true);
    expect(r.lines).toEqual(['a = 1']);
    expect(r.end.lines).toEqual([]);
    expect(r.end.dropped).toBe('b = Circ');
  });

  it('a cut reply that ends on a newline drops nothing', () => {
    const r = run(['a = 1\n'], true);
    expect(r.lines).toEqual(['a = 1']);
    expect(r.end.lines).toEqual([]);
    expect(r.end.dropped).toBeUndefined();
  });

  it('after `end` the splitter holds no text', () => {
    const s = new LineSplitter();
    s.push('a = 1\nb = 2');
    s.end(false);
    expect(s.pending).toBe('');
  });

  it('a whole reply that ends with a fence or a blank gives no extra line', () => {
    expect(run(['a = 1\n```'], false).end.lines).toEqual([]);
    expect(run(['a = 1\n   '], false).end.lines).toEqual([]);
  });
});

describe('cleanLine', () => {
  it('gives the line a raw line holds', () => {
    expect(cleanLine('  a = 1  ')).toBe('a = 1');
    expect(cleanLine('1. a = 1')).toBe('a = 1');
  });

  it('gives undefined where nothing is left', () => {
    for (const raw of ['', '   ', '```', '```text', '# note']) expect(cleanLine(raw), JSON.stringify(raw)).toBeUndefined();
  });

  it('never throws on odd input', () => {
    for (const raw of ['\u0000', '\ud800', 'a'.repeat(100_000), '🙂', '1.', '1. ', '. a']) expect(() => cleanLine(raw), JSON.stringify(raw.slice(0, 10))).not.toThrow();
  });
});
