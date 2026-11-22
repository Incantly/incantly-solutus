/**
 * Round 4, the sentence splitter (teacher design 8 "Sentences", design 6; requirements R8 and server R7.4): the voice takes
 * whole sentences, so `say` pieces of any size are cut at `.`, `!`, `?`, `…` and line breaks, a full stop inside `2.5` or
 * `e.g.` does not cut, a run of more than 400 characters is cut at a comma or a space (the voice takes 500), markdown marks
 * are dropped, and text with no letter or digit is dropped. Written from the docs and the public exports.
 */
import { describe, expect, it } from 'vitest';
import { SENTENCE_MAX, SentenceSplitter, speakable, splitSentences } from '../../src/index';

/** What a splitter gives for `pieces` pushed in order and then flushed. */
function run(pieces: readonly string[]): string[] {
  const s = new SentenceSplitter();
  const out: string[] = [];
  for (const p of pieces) out.push(...s.push(p));
  out.push(...s.flush());
  return out;
}

/** The text cut into pieces of `n` characters. */
const every = (text: string, n: number): string[] => text.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) ?? [];

describe('whole sentences only (design 8)', () => {
  it('a sentence is given when it ends, not before: nothing comes out while it is still being written', () => {
    const s = new SentenceSplitter();
    expect(s.push('Take a circle')).toEqual([]);
    expect(s.push(' of radius two')).toEqual([]);
    expect(s.push(', and a point on it')).toEqual([]);
    expect(s.push('. Now the')).toEqual(['Take a circle of radius two, and a point on it.']);
    expect(s.push(' tangent')).toEqual([]);
    expect(s.flush()).toEqual(['Now the tangent']);
  });

  it('several sentences in one piece come out in order, in one call', () => {
    const s = new SentenceSplitter();
    expect(s.push('One. Two! Three? Four')).toEqual(['One.', 'Two!', 'Three?']);
    expect(s.flush()).toEqual(['Four']);
  });

  it('. ! ? and … each end a sentence when a space follows', () => {
    expect(run(['A. B! C? D… E'])).toEqual(['A.', 'B!', 'C?', 'D…', 'E']);
  });

  it('a run of marks ends one sentence: "Really?! Yes." and "Wait... what?"', () => {
    expect(run(['Really?! Yes.'])).toEqual(['Really?!', 'Yes.']);
    expect(run(['Wait... what?'])).toEqual(['Wait...', 'what?']);
  });

  it('a closing quote or bracket stays with its sentence', () => {
    expect(run(['He said "go." Then we went.'])).toEqual(['He said "go."', 'Then we went.']);
    expect(run(['The slope (see above.) Next one.'])).toEqual(['The slope (see above.)', 'Next one.']);
  });

  it('a line break ends a sentence, so a list the model wrote line by line is spoken line by line', () => {
    expect(run(['First point\nSecond point\nThird'])).toEqual(['First point', 'Second point', 'Third']);
  });

  it('the end of the text with no mark is a sentence when flushed, and flush on nothing gives nothing', () => {
    const s = new SentenceSplitter();
    expect(s.flush()).toEqual([]);
    s.push('Last words');
    expect(s.flush()).toEqual(['Last words']);
    expect(s.flush()).toEqual([]);
  });

  it('white space is joined: a sentence has no line breaks or runs of spaces in it, and none at its ends', () => {
    expect(run(['  The   rod\t is  long.   Gravity   pulls. '])).toEqual(['The rod is long.', 'Gravity pulls.']);
  });

  it('the pieces can be as small as one character and the sentences are the same as for one piece', () => {
    const text = 'Take a circle of radius 2. It has e.g. a centre, i.e. a middle point! Is the radius 2.5 long? Yes. So x = 3. Done.';
    const whole = run([text]);
    for (const n of [1, 2, 3, 5, 7, 11]) expect(run(every(text, n)), `pieces of ${n}`).toEqual(whole);
  });

  it('every way to cut a text into two pieces gives the sentences of the whole text (the cut may fall inside 2.5 or e.g.)', () => {
    const texts = ['The radius is 2.5 metres. See Fig. 3 for it. Dr. Lee agrees!', 'It is, e.g. a circle. That is i.e. round? Yes... maybe. 3.14 is pi.', 'So x = 3. Then y = 4.5. End'];
    for (const text of texts) {
      const whole = run([text]);
      for (let i = 0; i <= text.length; i++) expect(run([text.slice(0, i), text.slice(i)]), `${text} cut at ${i}`).toEqual(whole);
    }
  });

  it('splitSentences gives the sentences of a whole text, flushed', () => {
    expect(splitSentences('One. Two. Three')).toEqual(['One.', 'Two.', 'Three']);
    expect(splitSentences('')).toEqual([]);
  });
});

describe('abbreviations and numbers do not end a sentence (design 8: "2.5 and e.g. stay whole")', () => {
  it('a decimal such as 2.5 or 3.14 stays whole, also when the cut falls after the point', () => {
    expect(run(['The radius is 2.5 metres.'])).toEqual(['The radius is 2.5 metres.']);
    expect(run(['The radius is 2.', '5 metres. Next.'])).toEqual(['The radius is 2.5 metres.', 'Next.']);
    expect(run(['Pi is about 3.14', '159 here.'])).toEqual(['Pi is about 3.14159 here.']);
  });

  it('a point at the end of the text so far waits for the next piece (it may be the start of 2.5)', () => {
    const s = new SentenceSplitter();
    expect(s.push('It is 2.')).toEqual([]);
    expect(s.push('5 long. Then')).toEqual(['It is 2.5 long.']);
  });

  it('e.g. and i.e. do not cut', () => {
    expect(run(['Use a slider, e.g. a for the radius. Then drag it.'])).toEqual(['Use a slider, e.g. a for the radius.', 'Then drag it.']);
    expect(run(['A circle, i.e. a round curve. Next.'])).toEqual(['A circle, i.e. a round curve.', 'Next.']);
  });

  it('Dr., Mr., Mrs., Ms., vs. and Fig. do not cut', () => {
    expect(run(['Dr. Lee and Mr. Smith agree.'])).toEqual(['Dr. Lee and Mr. Smith agree.']);
    expect(run(['Mrs. Jones asked Ms. Park.'])).toEqual(['Mrs. Jones asked Ms. Park.']);
    expect(run(['Compare this vs. that. Now look at Fig. 2 closely.'])).toEqual(['Compare this vs. that.', 'Now look at Fig. 2 closely.']);
  });

  it('a name with a dot inside and no space after it (a.txt, 1.2.3, www.x.org) is not cut', () => {
    expect(run(['Open a.txt and version 1.2.3 now.'])).toEqual(['Open a.txt and version 1.2.3 now.']);
  });
});

describe('maths at the end of a sentence ("x = 3.")', () => {
  it('"x = 3." at the very end of the text is a sentence with its point, when flushed', () => {
    const s = new SentenceSplitter();
    expect(s.push('So the answer is x = 3.')).toEqual([]);
    expect(s.flush()).toEqual(['So the answer is x = 3.']);
  });

  it('"x = 3." followed by a space and more cuts there, and the point stays with the maths', () => {
    expect(run(['Solve it: x = 3. Then check y = 4.'])).toEqual(['Solve it: x = 3.', 'Then check y = 4.']);
  });

  it('"x = 3." at the end, then 5 as the next piece continues the number (3.5), a space starts a new sentence', () => {
    expect(run(['x = 3.', '5 is the root.'])).toEqual(['x = 3.5 is the root.']);
    expect(run(['x = 3.', ' Next one.'])).toEqual(['x = 3.', 'Next one.']);
  });

  it('a question about maths: "Is x = 3?" is whole', () => {
    expect(run(['Is x = 3? Check it.'])).toEqual(['Is x = 3?', 'Check it.']);
  });
});

describe('what the voice should not read', () => {
  it('markdown marks and TeX dollars are dropped: ` * # $', () => {
    expect(run(['**Look** at `c` and $x^2$ now. # Next.'])).toEqual(['Look at c and x^2 now.', 'Next.']);
    expect(speakable('## A **bold** `idea`')).toBe('A bold idea');
  });

  it('text with no letter or digit is dropped: a stray "...", "-", "***" or "$$"', () => {
    expect(run(['... - *** $$ \n'])).toEqual([]);
    expect(run(['Yes.\n...\nNo.'])).toEqual(['Yes.', 'No.']);
    expect(speakable('...')).toBe('');
    expect(speakable('  ')).toBe('');
  });

  it('a sentence with a digit and no letter is kept ("42.")', () => {
    expect(run(['42. Then.'])).toEqual(['42.', 'Then.']);
  });

  it('letters of other scripts count: "θ = 1.2." is spoken', () => {
    expect(run(['θ.'])).toEqual(['θ.']);
  });
});

describe('a long run with no end (design 8: more than 400 characters is cut at a comma or a space; the voice takes 500)', () => {
  const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');

  it('SENTENCE_MAX is 400', () => {
    expect(SENTENCE_MAX).toBe(400);
  });

  it('a run of more than 400 characters is given before it ends, and no sentence is longer than 400', () => {
    const s = new SentenceSplitter();
    const early = s.push(words);
    expect(early.length).toBeGreaterThan(0);
    const all = [...early, ...s.flush()];
    for (const sentence of all) expect(sentence.length).toBeLessThanOrEqual(SENTENCE_MAX);
    expect(all.join(' ')).toBe(words);
  });

  it('it is cut at a comma when there is one in the second half of the run, and the comma stays', () => {
    const text = `${'a'.repeat(100)} ${'b'.repeat(150)}, ${'c'.repeat(100)} ${'d'.repeat(200)}`;
    const out = run([text]);
    expect(out[0]?.endsWith(',')).toBe(true);
    expect(out.join(' ')).toBe(text);
    for (const sentence of out) expect(sentence.length).toBeLessThanOrEqual(SENTENCE_MAX);
  });

  it('with no comma or space at all (one word of 1,000 characters) it is still cut, at 400', () => {
    const out = run(['x'.repeat(1000)]);
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const sentence of out) expect(sentence.length).toBeLessThanOrEqual(SENTENCE_MAX);
    expect(out.join('')).toBe('x'.repeat(1000));
  });

  it('a long run streamed in small pieces gives the same sentences as one piece', () => {
    expect(run(every(words, 13))).toEqual(run([words]));
  });

  it('a run that is long when its full stop arrives in the same piece is still cut: no sentence is over what the voice takes (500)', () => {
    const long = `${'word '.repeat(150)}end. Next one.`;
    const out = run([long]);
    for (const sentence of out) expect(sentence.length, sentence.slice(0, 40)).toBeLessThanOrEqual(500);
    expect(out.join(' ')).toBe(long.replace(/\s+/g, ' ').trim());
  });

  it('a long text flushed at the end is cut as well (a reply that ends with no full stop)', () => {
    const s = new SentenceSplitter();
    s.push('word '.repeat(60));
    const rest = s.flush();
    for (const sentence of [...rest]) expect(sentence.length).toBeLessThanOrEqual(500);
    const whole = splitSentences('w '.repeat(600));
    for (const sentence of whole) expect(sentence.length).toBeLessThanOrEqual(500);
  });

  it('a text of 400 characters or fewer with no end waits for the flush', () => {
    const s = new SentenceSplitter();
    expect(s.push('w '.repeat(150))).toEqual([]);
    expect(s.flush()).toHaveLength(1);
  });
});

describe('the splitter keeps what it was not given', () => {
  it('two splitters do not share text', () => {
    const a = new SentenceSplitter();
    const b = new SentenceSplitter();
    a.push('from a');
    expect(b.flush()).toEqual([]);
    expect(a.flush()).toEqual(['from a']);
  });

  it('after a flush the splitter is empty and starts a new text', () => {
    const s = new SentenceSplitter();
    s.push('half');
    s.flush();
    expect(s.push('New one. ')).toEqual(['New one.']);
  });
});
