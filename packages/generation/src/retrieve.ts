import { REFERENCE_SCENES, type ReferenceScene } from '@incantly/core/scenes';
import type { LearnerRequest } from './context';

/**
 * Retrieval (PRD 25.5): the reviewed scene a learner's request is about, if
 * it plainly names one. Each reviewed scene lists names, which count three,
 * and keywords, which count one; a request needs three points and a clear
 * lead over the next concept, or two when no other concept scores at all.
 * A word ending in * matches any word it starts;
 * the others match whole words or phrases. It never reads the learner's
 * note: only the request names the figure.
 */

const NAME = 3;
const NEEDED = 3;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const patterns = new Map<string, RegExp>();

function pattern(word: string): RegExp {
  let found = patterns.get(word);
  if (!found) {
    const prefix = word.endsWith('*');
    const body = (prefix ? word.slice(0, -1) : word).toLowerCase();
    // A whole word ends where the letters do; one ending in a symbol, such as sin(, ends there anyway.
    const whole = !prefix && /[a-z0-9]$/.test(body);
    found = new RegExp(`(?:^|[^a-z0-9])${escape(body)}${whole ? '(?![a-z0-9])' : ''}`);
    patterns.set(word, found);
  }
  return found;
}

function count(text: string, words: readonly string[]): number {
  let n = 0;
  for (const word of words) if (pattern(word).test(text)) n++;
  return n;
}

/** Every reviewed concept with how strongly the text names it, strongest first. */
export function conceptScores(
  text: string,
  examples: Readonly<Record<string, ReferenceScene>> = REFERENCE_SCENES,
): Array<{ readonly scene: ReferenceScene; readonly score: number }> {
  const lower = text.toLowerCase();
  return Object.values(examples)
    .map((scene) => ({ scene, score: NAME * count(lower, scene.match?.names ?? []) + count(lower, scene.match?.keywords ?? []) }))
    .sort((a, b) => b.score - a.score || a.scene.id.localeCompare(b.scene.id));
}

/** The reviewed scene the request plainly asks for, or null when none clearly leads. */
export function retrieveExample(
  request: LearnerRequest,
  options: { readonly examples?: Readonly<Record<string, ReferenceScene>>; readonly withhold?: readonly string[] } = {},
): ReferenceScene | null {
  const examples = Object.fromEntries(Object.entries(options.examples ?? REFERENCE_SCENES).filter(([id]) => !options.withhold?.includes(id)));
  const [best, next] = conceptScores(request.prompt, examples);
  const rival = next?.score ?? 0;
  if (!best || best.score <= rival) return null;
  return best.score >= NEEDED || (best.score >= 2 && rival === 0) ? best.scene : null;
}
