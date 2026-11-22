/**
 * Whole sentences for the voice (teacher design 8): the model's `say` text arrives in pieces of any size, and the voice
 * takes a sentence at a time. `SentenceSplitter.push` gives the sentences that ended in what has arrived so far, and
 * `flush` gives the rest. The text since the last sentence end is data, as the line splitter's unfinished line is: the
 * splitter has no state. No DOM, timers, network or `Date`.
 */

/** A sentence is cut at a word boundary past this many characters (the speech route takes 500). */
export const SENTENCE_MAX = 400;

/** Words whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'vs', 'cf', 'fig', 'eq', 'approx', 'e.g', 'i.e']);

const END = /[.!?…]/;
const CLOSERS = /["'”’)\]]/;

/** The word before the full stop at `at`, in lower case (`e.g` for "e.g."), or ''. */
function wordBefore(text: string, at: number): string {
  let start = at;
  while (start > 0 && /[\p{L}.]/u.test(text.charAt(start - 1))) start -= 1;
  return text.slice(start, at).toLowerCase();
}

/**
 * What the voice should read of a sentence: markdown marks and TeX dollars are dropped and white space is joined.
 * Returns '' for text with no letter or digit (a stray "..." or "-").
 */
export function speakable(sentence: string): string {
  const text = sentence.replace(/[`*#$]/g, '').replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}

export class SentenceSplitter {
  private pending = '';

  /** Takes more text; returns the sentences that ended in it, in order. */
  push(text: string): string[] {
    this.pending += text;
    return this.take(false);
  }

  /** Ends the text: returns what is left as a sentence (none when it is blank). */
  flush(): string[] {
    return this.take(true);
  }

  private take(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const cut = this.cutAt(final);
      if (cut < 0) break;
      const sentence = speakable(this.pending.slice(0, cut));
      this.pending = this.pending.slice(cut);
      if (sentence !== '') out.push(sentence);
    }
    return out;
  }

  /** Where the first sentence of `pending` ends (the index after it), or -1 when none ended yet. */
  private cutAt(final: boolean): number {
    const text = this.pending;
    for (let i = 0; i < text.length; i++) {
      const c = text.charAt(i);
      if (c === '\n') return i + 1;
      if (!END.test(c)) continue;
      let j = i + 1;
      while (j < text.length && (END.test(text.charAt(j)) || CLOSERS.test(text.charAt(j)))) j += 1;
      // the end of the text so far is not yet a sentence end: "2." may be the start of "2.5"
      if (j >= text.length) {
        if (final) return text.length;
        break;
      }
      if (!/\s/.test(text.charAt(j))) {
        i = j - 1;
        continue;
      }
      if (c === '.' && ABBREVIATIONS.has(wordBefore(text, i))) continue;
      return j;
    }
    if (final) return text.length > 0 ? text.length : -1;
    if (text.length > SENTENCE_MAX) return this.breakAt(text);
    return -1;
  }

  /** A sentence that runs past `SENTENCE_MAX` is cut at the last comma, semicolon or space before it. */
  private breakAt(text: string): number {
    const head = text.slice(0, SENTENCE_MAX);
    const mark = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf(':'));
    if (mark > SENTENCE_MAX / 2) return mark + 1;
    const space = head.lastIndexOf(' ');
    return space > 0 ? space + 1 : SENTENCE_MAX;
  }
}

/** The sentences of a whole text, for a reply that is already complete. */
export function splitSentences(text: string): string[] {
  const splitter = new SentenceSplitter();
  return [...splitter.push(text), ...splitter.flush()];
}
