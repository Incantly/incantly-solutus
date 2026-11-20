/**
 * Export (design 12): fresh pictures for every figure with no mount, and a Markdown writer. `editor.getHTML()` already
 * writes each figure as its picture with the script kept as data (the node's `renderHTML`).
 */
import type { Editor, JSONContent } from '@tiptap/core';
import { createHeadlessApp } from '@incantly/sdk';
import type { App, ExportEnv } from '@incantly/sdk';
import { FULL_WIDTH_PX, checkAttrs } from './attrs';
import type { IncantlyFigureAttrs } from './attrs';
import { figuresIn, findFigure } from './doc';
import { tiptapError } from './errors';
import type { TiptapError } from './errors';
import { evaluateExpr } from './formula';
import { makePicture } from './picture';

export interface RefreshReport {
  /** Figures whose picture changed. */
  readonly updated: number;
  readonly failed: readonly { readonly id: string; readonly error: TiptapError }[];
}

/**
 * Makes every figure's picture again from its script, in a headless app of its mode and size (`full` width is 720),
 * as SVG (PNG for 3D, which needs `env.canvas` outside a browser). All pictures are written in one transaction that is
 * not an undo step. Never throws.
 */
export async function refreshPictures(editor: Editor, env?: ExportEnv): Promise<RefreshReport> {
  const failed: { id: string; error: TiptapError }[] = [];
  const made = new Map<string, string>();
  const jobs = figuresIn(editor.state.doc).map((f) => ({ raw: f.node.attrs as Record<string, unknown> }));
  for (const job of jobs) {
    const rawId = typeof job.raw['id'] === 'string' ? job.raw['id'] : '';
    const checked = checkAttrs(job.raw);
    if (!checked.ok) {
      failed.push({ id: rawId, error: checked });
      continue;
    }
    const a = checked.value;
    const width = a.width === 'full' ? FULL_WIDTH_PX : a.width;
    let app: App | undefined;
    try {
      app = createHeadlessApp({ mode: a.mode, script: a.script, size: { width, height: a.height } });
      const p = await makePicture(app, a.mode, width, a.height, env);
      if (p.ok) made.set(a.id, p.url);
      else failed.push({ id: a.id, error: tiptapError('export_failed', `The picture of the figure could not be made: ${p.reason}`, { node: a.id }) });
    } catch (e) {
      failed.push({ id: a.id, error: tiptapError('export_failed', `The picture of the figure could not be made: ${e instanceof Error ? e.message : 'unknown reason'}.`, { node: a.id }) });
    } finally {
      try {
        app?.destroy();
      } catch {
        // nothing to free
      }
    }
  }
  let updated = 0;
  try {
    if (made.size > 0 && !editor.isDestroyed) {
      let tr = editor.state.tr;
      for (const [id, url] of made) {
        const found = findFigure(tr.doc, id);
        if (!found || found.node.attrs['picture'] === url) continue;
        tr = tr.setNodeAttribute(found.pos, 'picture', url);
        updated++;
      }
      if (updated > 0) editor.view.dispatch(tr.setMeta('addToHistory', false));
    }
  } catch (e) {
    failed.push({ id: '', error: tiptapError('export_failed', `The pictures could not be written to the document: ${e instanceof Error ? e.message : 'unknown reason'}.`) });
    updated = 0;
  }
  return { updated, failed };
}

/** The longest run of backticks in a text. */
const longestTicks = (s: string): number => Math.max(0, ...(s.match(/`+/g) ?? []).map((t) => t.length));

/** One figure as Markdown: the picture as an image, then the script in a fenced `incantly` block. */
export function figureToMarkdown(attrs: Pick<IncantlyFigureAttrs, 'script' | 'caption' | 'picture'>): string {
  const caption = typeof attrs.caption === 'string' ? attrs.caption : '';
  const script = typeof attrs.script === 'string' ? attrs.script : '';
  const parts: string[] = [];
  if (typeof attrs.picture === 'string' && attrs.picture !== '') parts.push(`![${caption.replace(/[[\]\n]/g, ' ')}](${attrs.picture})`);
  else if (caption !== '') parts.push(caption);
  const fence = '`'.repeat(Math.max(3, longestTicks(script) + 1));
  parts.push(`${fence}incantly\n${script.replace(/\n+$/, '')}\n${fence}`);
  return parts.join('\n\n');
}

interface Ctx {
  readonly figures: Map<string, { script: string; mode: IncantlyFigureAttrs['mode'] }>;
  readonly apps: Map<string, App | undefined>;
}

function collectFigures(node: JSONContent, out: Ctx['figures']): void {
  if (node.type === 'incantlyFigure' && node.attrs) {
    const id = node.attrs['id'];
    const c = checkAttrs(node.attrs);
    if (typeof id === 'string' && c.ok) out.set(id, { script: c.value.script, mode: c.value.mode });
  }
  for (const child of node.content ?? []) collectFigures(child, out);
}

function appOf(ctx: Ctx, id: string): App | undefined {
  if (ctx.apps.has(id)) return ctx.apps.get(id);
  const f = ctx.figures.get(id);
  let app: App | undefined;
  if (f) {
    try {
      app = createHeadlessApp({ mode: f.mode, script: f.script, readOnly: true });
    } catch {
      app = undefined;
    }
  }
  ctx.apps.set(id, app);
  return app;
}

function inline(node: JSONContent, ctx: Ctx): string {
  if (node.type === 'text') {
    let t = node.text ?? '';
    const marks = (node.marks ?? []).map((m) => m.type);
    if (marks.includes('code')) t = `\`${t}\``;
    if (marks.includes('bold')) t = `**${t}**`;
    if (marks.includes('italic')) t = `*${t}*`;
    return t;
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'incantlyFormula') {
    const a = node.attrs ?? {};
    const expr = typeof a['expr'] === 'string' ? a['expr'] : '';
    const figure = typeof a['figure'] === 'string' ? a['figure'] : '';
    const format = typeof a['format'] === 'string' ? a['format'] : '';
    let shown = expr;
    const app = figure === '' ? undefined : appOf(ctx, figure);
    if (app) {
      const r = evaluateExpr(app, expr, format);
      if (r.ok) shown = r.text;
    }
    return `\`${shown}\``;
  }
  return (node.content ?? []).map((c) => inline(c, ctx)).join('') || (node.text ?? '');
}

function block(node: JSONContent, ctx: Ctx): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((c) => block(c, ctx)).filter((s) => s !== '').join('\n\n');
    case 'paragraph':
      return (node.content ?? []).map((c) => inline(c, ctx)).join('');
    case 'heading': {
      const level = typeof node.attrs?.['level'] === 'number' ? Math.min(6, Math.max(1, node.attrs['level'])) : 1;
      return `${'#'.repeat(level)} ${(node.content ?? []).map((c) => inline(c, ctx)).join('')}`;
    }
    case 'incantlyFigure': {
      const a = node.attrs ?? {};
      const c = checkAttrs(a);
      if (c.ok) return figureToMarkdown(c.value);
      return figureToMarkdown({ script: typeof a['script'] === 'string' ? a['script'] : '', caption: typeof a['caption'] === 'string' ? a['caption'] : '', picture: null });
    }
    default: {
      // any other node: its text
      const kids = node.content ?? [];
      if (kids.length === 0) return node.text ?? '';
      if (kids.every((k) => k.type === 'text' || k.type === 'hardBreak' || k.type === 'incantlyFormula')) return kids.map((k) => inline(k, ctx)).join('');
      return kids.map((k) => block(k, ctx)).filter((s) => s !== '').join('\n\n');
    }
  }
}

/** A document (`editor.getJSON()`) as Markdown: headings, paragraphs, text, figures and formulas; other nodes as their text. */
export function docToMarkdown(json: JSONContent): string {
  const ctx: Ctx = { figures: new Map(), apps: new Map() };
  try {
    collectFigures(json, ctx.figures);
    return block(json, ctx);
  } catch {
    return '';
  } finally {
    for (const app of ctx.apps.values()) {
      try {
        app?.destroy();
      } catch {
        // nothing to free
      }
    }
  }
}
