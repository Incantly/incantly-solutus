/** Where chats survive reloads. The API key is deliberately never kept: it stays in the page and the server session. */
export const CHATS_KEY = 'incantly-playground-chats';

/** A figure the chat built and approved, as its saved node keeps it. */
export interface SavedFigure {
  readonly concept: string;
  readonly fragments: { readonly html: string; readonly css: string; readonly js: string };
}

interface StoredMessage {
  readonly role?: string;
  readonly content?: unknown;
  readonly figure?: { readonly type?: string; readonly attrs?: { readonly concept?: unknown; readonly fragments?: unknown } };
}

/**
 * The latest approved figure the chat built for exactly this prompt, from the
 * saved chats: the gallery shows it on a card that has no reviewed scene.
 */
export function savedFigureFor(prompt: string): SavedFigure | null {
  let chats: Array<{ messages?: StoredMessage[] }>;
  try {
    const saved = JSON.parse(localStorage.getItem(CHATS_KEY) ?? 'null') as { chats?: Array<{ messages?: StoredMessage[] }> } | null;
    chats = saved?.chats ?? [];
  } catch {
    return null;
  }
  const wanted = prompt.trim();
  // Chats are kept newest first, and a chat's messages oldest first.
  for (const chat of chats) {
    const messages = chat.messages ?? [];
    for (let i = messages.length - 1; i > 0; i--) {
      const attrs = messages[i]!.figure?.type === 'incantlyFigure' ? messages[i]!.figure!.attrs : undefined;
      const fragments = attrs?.fragments as Partial<SavedFigure['fragments']> | null | undefined;
      if (!fragments || typeof fragments.html !== 'string' || typeof fragments.css !== 'string' || typeof fragments.js !== 'string') continue;
      // The figure answers the learner message just before it.
      const asked = messages.slice(0, i).reverse().find((m) => m.role === 'user');
      if (typeof asked?.content !== 'string' || asked.content.trim() !== wanted) continue;
      return { concept: typeof attrs?.concept === 'string' ? attrs.concept : wanted, fragments: { html: fragments.html, css: fragments.css, js: fragments.js } };
    }
  }
  return null;
}

/** Figures the dev server keeps for the chat, by prompt, so every browser's gallery sees them. */
export async function keptFigures(): Promise<ReadonlyMap<string, SavedFigure>> {
  try {
    const answer = await fetch('/api/dev/figures');
    if (!answer.ok) return new Map();
    const figures = (await answer.json()) as Array<{ prompt?: unknown; concept?: unknown; fragments?: SavedFigure['fragments'] }>;
    const kept = new Map<string, SavedFigure>();
    // Newest first: the first figure for a prompt is the one that stands.
    for (const f of figures) {
      if (typeof f.prompt !== 'string' || !f.fragments || kept.has(f.prompt.trim())) continue;
      kept.set(f.prompt.trim(), { concept: typeof f.concept === 'string' ? f.concept : f.prompt, fragments: f.fragments });
    }
    return kept;
  } catch {
    return new Map();
  }
}

/** Hands an approved figure to the dev server to keep; a server without the endpoint just answers no. */
export async function keepFigure(prompt: string, figure: SavedFigure): Promise<void> {
  try {
    await fetch('/api/dev/figures', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, concept: figure.concept, fragments: figure.fragments }),
    });
  } catch {
    // The chat's own saved copy still stands.
  }
}
