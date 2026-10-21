import type { JSONContent } from '@tiptap/core';
import { defaultAttributes, type FigureAttributes } from './attributes';

/** Document sizes from the performance contract's required scale tests. */
export const SCALE_PROFILES = {
  small: 1,
  typical: 10,
  large: 50,
  veryLarge: 100,
  stress: 300,
} as const;

export interface FixtureOptions {
  readonly figures: number;
  readonly seed?: number;
  /** Optional per-figure attribute overrides, e.g. real fragments. */
  readonly figure?: (index: number) => Partial<FigureAttributes>;
}

const CONCEPTS = [
  {
    concept: 'sine wave',
    description: 'A sine wave whose height follows the amplitude and whose spacing follows the frequency.',
  },
  {
    concept: 'projectile motion',
    description: 'A ball launched at an angle follows a curved path and lands some distance away.',
  },
  {
    concept: 'thin lens',
    description: 'Three rays from an object pass through a convex lens and meet where the image forms.',
  },
] as const;

const WORDS = [
  'energy', 'wave', 'angle', 'velocity', 'gravity', 'lens', 'focus', 'image', 'object', 'distance',
  'frequency', 'amplitude', 'phase', 'period', 'motion', 'force', 'mass', 'graph', 'curve', 'slope',
  'the', 'a', 'of', 'and', 'changes', 'stays', 'grows', 'falls', 'when', 'because',
];

/** Small deterministic generator so fixtures are identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sentence(random: () => number): string {
  const length = 8 + Math.floor(random() * 10);
  const words: string[] = [];
  for (let i = 0; i < length; i++) words.push(WORDS[Math.floor(random() * WORDS.length)] ?? 'wave');
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

function paragraph(random: () => number): JSONContent {
  const count = 2 + Math.floor(random() * 3);
  const text = Array.from({ length: count }, () => sentence(random)).join(' ');
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'><rect width='160' height='90' fill='#ddd'/><circle cx='80' cy='45' r='20' fill='#999'/></svg>",
  );

/**
 * A representative TipTap document: headings, paragraphs, lists, quotes and
 * images around `figures` stored visualization nodes.
 */
export function createFixtureDocument(options: FixtureOptions): JSONContent {
  const random = mulberry32(options.seed ?? 1);
  const content: JSONContent[] = [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Study notes with ${options.figures} figures` }] },
    paragraph(random),
  ];
  for (let i = 0; i < options.figures; i++) {
    const kind = CONCEPTS[i % CONCEPTS.length] ?? CONCEPTS[0];
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Section ${i + 1}: ${kind.concept}` }] });
    content.push(paragraph(random));
    const variant = i % 4;
    if (variant === 1) {
      content.push({
        type: 'bulletList',
        content: [0, 1, 2].map(() => ({ type: 'listItem', content: [paragraph(random)] })),
      });
    } else if (variant === 2) {
      content.push({ type: 'blockquote', content: [paragraph(random)] });
    } else if (variant === 3) {
      content.push({ type: 'image', attrs: { src: IMAGE, alt: 'Diagram placeholder' } });
    }
    const attrs: FigureAttributes = {
      ...defaultAttributes(),
      figureId: `fig-${String(i + 1).padStart(3, '0')}`,
      concept: kind.concept,
      description: kind.description,
      ...(options.figure?.(i) ?? {}),
    };
    content.push({ type: 'incantlyFigure', attrs: { ...attrs } });
    content.push(paragraph(random));
  }
  return { type: 'doc', content };
}

export function countFigures(doc: JSONContent): number {
  let count = 0;
  const visit = (node: JSONContent) => {
    if (node.type === 'incantlyFigure') count++;
    node.content?.forEach(visit);
  };
  visit(doc);
  return count;
}
