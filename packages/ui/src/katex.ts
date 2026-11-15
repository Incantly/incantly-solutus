/**
 * Full LaTeX for texts with `latex = full` (text-logic design 6.4): KaTeX, loaded on first use, renders each `$…$` part
 * to HTML. The plain parts are escaped. KaTeX runs with `trust: false`, so `\href`, `\url` and the like never make a
 * link, and with caps on size and macro expansion so one text cannot stall the page.
 */

interface KatexLike {
  renderToString(src: string, opts: Record<string, unknown>): string;
}

let katex: KatexLike | undefined;
let loading: Promise<KatexLike | undefined> | undefined;

const OPTIONS = { throwOnError: false, trust: false, strict: 'ignore', output: 'html', maxSize: 20, maxExpand: 1000, displayMode: false } as const;

/** Starts loading KaTeX and its style sheet; resolves to `true` once it is ready, `false` when it could not load. */
export function loadFullLatex(): Promise<boolean> {
  if (katex) return Promise.resolve(true);
  loading ??= (async () => {
    try {
      const mod = (await import('katex')) as unknown as { default?: KatexLike } & KatexLike;
      // the style sheet comes with it where a bundler handles CSS; tests and Node have none, and that is fine
      try {
        await import('katex/dist/katex.min.css');
      } catch {
        /* no CSS loader */
      }
      katex = mod.default ?? mod;
      return katex;
    } catch {
      return undefined;
    }
  })();
  return loading.then((k) => k !== undefined);
}

/** True once KaTeX has loaded. */
export function fullLatexReady(): boolean {
  return katex !== undefined;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * A text's HTML with each `$…$` part rendered by KaTeX, or `undefined` while KaTeX has not loaded (call
 * `loadFullLatex` and render again when it resolves). A `$` with no closing `$` stays plain text.
 */
export function fullLatexHtml(s: string): string | undefined {
  const k = katex;
  if (!k) return undefined;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const a = s.indexOf('$', i);
    const b = a < 0 ? -1 : s.indexOf('$', a + 1);
    if (a < 0 || b < 0) {
      out += escapeHtml(s.slice(i));
      break;
    }
    out += escapeHtml(s.slice(i, a));
    const src = s.slice(a + 1, b);
    try {
      out += k.renderToString(src, OPTIONS);
    } catch {
      out += `<span class="latex-error">${escapeHtml(src)}</span>`;
    }
    i = b + 1;
  }
  return out;
}
