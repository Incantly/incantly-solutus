/**
 * Measure and place a box tree (docs/features/text-logic/design.md 6.1, 6.6) into a flat draw list: glyphs at
 * baselines, rules, and stroked paths for radicals, fences and accents. Pure; the caller passes how to measure a glyph
 * (canvas `measureText` in the studio, a fixed table in tests). Sizes: text 100 %, script 70 %, scriptscript 50 %.
 */
import type { MBox, MathFont } from './tex';
import { parseTex, splitMath } from './tex';

export interface GlyphMetrics {
  readonly w: number;
  readonly asc: number;
  readonly desc: number;
}

/** Measures `s` drawn in `font` at `px` pixels. */
export type Measure = (s: string, font: MathFont, px: number) => GlyphMetrics;

export type DrawItem =
  | { readonly k: 'glyph'; readonly x: number; readonly y: number; readonly s: string; readonly font: MathFont; readonly px: number; readonly color?: string }
  | { readonly k: 'rule'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color?: string }
  | { readonly k: 'path'; readonly pts: readonly (readonly [number, number])[]; readonly lw: number; readonly color?: string };

export interface MathLayout {
  /** Width, and height above and below the baseline, in pixels. */
  readonly w: number;
  readonly asc: number;
  readonly desc: number;
  /** Items relative to the left end of the baseline; y grows downwards. */
  readonly items: readonly DrawItem[];
}

/** A rough measure for code with no canvas: 0.55 em per character, 0.72 em up, 0.22 em down. */
export const roughMeasure: Measure = (s, _font, px) => ({ w: Array.from(s).length * px * 0.55, asc: px * 0.72, desc: px * 0.22 });

interface Placed {
  w: number;
  asc: number;
  desc: number;
  items: DrawItem[];
}

const shift = (items: readonly DrawItem[], dx: number, dy: number): DrawItem[] => items.map((it) => {
  if (it.k === 'path') return { ...it, pts: it.pts.map(([x, y]) => [x + dx, y + dy] as const) };
  return { ...it, x: it.x + dx, y: it.y + dy };
});

/** Space before an item of a class, after an item of another (thin, medium, thick space in em). */
function gap(prev: string | undefined, cur: string | undefined): number {
  if (prev === undefined) return 0;
  if (cur === 'rel' || prev === 'rel') return prev === 'open' || cur === 'close' ? 0 : 5 / 18;
  // a binary sign has a medium space on both sides (a unary one was turned into an ordinary sign before)
  if (cur === 'bin') return prev === 'open' || prev === 'punct' ? 0 : 4 / 18;
  if (prev === 'bin') return cur === 'close' ? 0 : 4 / 18;
  if (prev === 'punct') return 3 / 18;
  if (cur === 'op' && prev !== 'open') return 3 / 18;
  if (prev === 'op' && cur !== 'open' && cur !== 'close' && cur !== 'punct') return 3 / 18;
  return 0;
}

const classOf = (b: MBox): string | undefined => {
  if (b.b === 'glyph') return b.cls ?? 'ord';
  if (b.b === 'bigop') return 'op';
  if (b.b === 'scripts') return classOf(b.base);
  if (b.b === 'space') return undefined;
  return 'ord';
};

/** Lays out a box at `px` pixels. `color` tints everything that has no colour of its own. */
export function layoutBox(box: MBox, px: number, measure: Measure, color?: string): MathLayout {
  const axis = (p: number): number => p * 0.25;
  const rule = (p: number): number => Math.max(1, p * 0.055);

  function place(b: MBox, p: number, col: string | undefined, displayFrac: boolean): Placed {
    switch (b.b) {
      case 'glyph': {
        // a bare minus or operator at the start of a row is unary: no extra space either side
        const m = measure(b.ch, b.font, p);
        return { w: m.w, asc: m.asc, desc: m.desc, items: [{ k: 'glyph', x: 0, y: 0, s: b.ch, font: b.font, px: p, ...(col ? { color: col } : {}) }] };
      }
      case 'space': return { w: b.em * p, asc: 0, desc: 0, items: [] };
      case 'color': return place(b.body, p, b.color, displayFrac);
      case 'row': {
        let x = 0;
        let asc = 0;
        let desc = 0;
        const items: DrawItem[] = [];
        let prev: string | undefined;
        b.items.forEach((it, k) => {
          let cls = classOf(it);
          // a binary sign after nothing, an opening bracket or a relation is unary
          if (cls === 'bin' && (k === 0 || prev === 'open' || prev === 'rel' || prev === 'bin' || prev === 'punct')) cls = 'ord';
          x += gap(prev, cls) * p;
          // italic correction: a slanted letter before an upright bracket or digit leans into it
          const before = b.items[k - 1];
          if (before?.b === 'glyph' && (before.font === 'math' || before.font === 'italic') && ((it.b === 'glyph' && it.font !== 'math' && it.font !== 'italic') || it.b === 'fence')) x += p * (it.b === 'fence' ? 0.12 : 0.08);
          const q = place(it, p, col, displayFrac);
          items.push(...shift(q.items, x, 0));
          x += q.w;
          asc = Math.max(asc, q.asc);
          desc = Math.max(desc, q.desc);
          if (cls !== undefined) prev = cls;
        });
        return { w: x, asc: Math.max(asc, b.items.length === 0 ? p * 0.7 : 0), desc, items };
      }
      case 'frac': {
        const q = b.display || displayFrac ? p : Math.max(p * 0.5, p * 0.82);
        const n = place(b.num, q, col, false);
        const d = place(b.den, q, col, false);
        const pad = p * 0.12;
        const w = Math.max(n.w, d.w) + 2 * pad;
        const a = axis(p);
        const t = b.rule ? rule(p) : 0;
        const gapN = p * 0.12;
        const nBase = -(a + t / 2 + gapN + n.desc);
        const dBase = -a + t / 2 + gapN + d.asc;
        const items = [...shift(n.items, (w - n.w) / 2, nBase), ...shift(d.items, (w - d.w) / 2, dBase)];
        if (b.rule) items.push({ k: 'rule', x: pad / 2, y: -a - t / 2, w: w - pad, h: t, ...(col ? { color: col } : {}) });
        return { w: w + p * 0.08, asc: -nBase + n.asc, desc: dBase + d.desc, items };
      }
      case 'scripts': {
        const base = place(b.base, p, col, displayFrac);
        const q = Math.max(p * 0.5, p * 0.7);
        const items = [...base.items];
        let w = base.w;
        let asc = base.asc;
        let desc = base.desc;
        const sup = b.sup ? place(b.sup, q, col, false) : undefined;
        const sub = b.sub ? place(b.sub, q, col, false) : undefined;
        const x0 = base.w + p * 0.04;
        if (sup) {
          const up = Math.max(p * 0.42, base.asc - sup.asc * 0.6);
          items.push(...shift(sup.items, x0, -up));
          asc = Math.max(asc, up + sup.asc);
          w = Math.max(w, x0 + sup.w);
        }
        if (sub) {
          const down = Math.max(p * (sup ? 0.3 : 0.2), base.desc + sub.asc * 0.3 - sub.asc * 0.5);
          items.push(...shift(sub.items, x0 + (sup && b.base.b === 'glyph' && b.base.font === 'math' ? -p * 0.04 : 0), down));
          desc = Math.max(desc, down + sub.desc);
          w = Math.max(w, x0 + sub.w);
        }
        return { w: w + p * 0.04, asc, desc, items };
      }
      case 'root': {
        const body = place(b.body, p, col, displayFrac);
        const t = rule(p);
        const clear = p * 0.12;
        const top = body.asc + clear + t;
        const bottom = body.desc;
        const hook = p * 0.55;
        const lw = Math.max(1, p * 0.06);
        const items: DrawItem[] = [];
        let x = 0;
        let asc = top + t;
        if (b.index) {
          const ix = place(b.index, Math.max(p * 0.5, p * 0.55), col, false);
          items.push(...shift(ix.items, 0, -top * 0.55));
          x = Math.max(0, ix.w - hook * 0.45);
          asc = Math.max(asc, top * 0.55 + ix.asc);
        }
        // the radical sign: a small tick, down to the bottom, up to the top bar
        items.push({ k: 'path', pts: [[x, -top * 0.45], [x + hook * 0.22, -top * 0.55], [x + hook * 0.5, bottom], [x + hook, -top]], lw, ...(col ? { color: col } : {}) });
        items.push({ k: 'rule', x: x + hook, y: -top - t / 2, w: body.w + p * 0.1, h: t, ...(col ? { color: col } : {}) });
        items.push(...shift(body.items, x + hook + p * 0.05, 0));
        return { w: x + hook + body.w + p * 0.18, asc, desc: bottom + p * 0.05, items };
      }
      case 'fence': {
        const body = place(b.body, p, col, displayFrac);
        const a = axis(p);
        // the fences are centred on the maths axis and cover the body
        const half = Math.max(body.asc - a, body.desc + a, p * 0.55) + p * 0.08;
        const top = a + half;
        const bottom = half - a;
        const fw = Math.min(p * 0.5, p * 0.28 + half * 0.08);
        const lw = Math.max(1, p * 0.065);
        const items: DrawItem[] = [];
        let x = 0;
        if (b.open) {
          items.push(...fencePath(b.open, 0, fw, -top, bottom, lw, col));
          x += fw + p * 0.06;
        }
        items.push(...shift(body.items, x, 0));
        x += body.w;
        if (b.close) {
          x += p * 0.06;
          items.push(...fencePath(b.close, x, fw, -top, bottom, lw, col));
          x += fw;
        }
        return { w: x + p * 0.04, asc: top, desc: bottom, items };
      }
      case 'bigop': {
        const isWord = /^[a-z]+$/.test(b.op);
        const opPx = isWord ? p : p * 1.35;
        const m = measure(b.op, 'upright', opPx);
        const opItem: Placed = { w: m.w, asc: isWord ? m.asc : m.asc * 0.85 + axis(p) * 0.4, desc: isWord ? m.desc : m.desc + p * 0.05, items: [{ k: 'glyph', x: 0, y: isWord ? 0 : axis(p) * 0.4, s: b.op, font: 'upright', px: opPx, ...(col ? { color: col } : {}) }] };
        const q = Math.max(p * 0.5, p * 0.7);
        const lo = b.lower ? place(b.lower, q, col, false) : undefined;
        const up = b.upper ? place(b.upper, q, col, false) : undefined;
        if (!b.limits) {
          // limits at the side (integrals)
          const items = [...opItem.items];
          let w = opItem.w;
          if (up) {
            items.push(...shift(up.items, opItem.w + p * 0.05, -opItem.asc * 0.8));
            w = Math.max(w, opItem.w + p * 0.05 + up.w);
          }
          if (lo) {
            items.push(...shift(lo.items, opItem.w - p * 0.05, opItem.desc + lo.asc * 0.6));
            w = Math.max(w, opItem.w + lo.w);
          }
          return { w: w + p * 0.1, asc: opItem.asc + (up ? up.asc * 0.6 : 0), desc: opItem.desc + (lo ? lo.desc + lo.asc * 0.6 : 0), items };
        }
        const w = Math.max(opItem.w, lo?.w ?? 0, up?.w ?? 0);
        const items = shift(opItem.items, (w - opItem.w) / 2, 0);
        let asc = opItem.asc;
        let desc = opItem.desc;
        if (up) {
          const y = -(opItem.asc + p * 0.1 + up.desc);
          items.push(...shift(up.items, (w - up.w) / 2, y));
          asc = -y + up.asc;
        }
        if (lo) {
          const y = opItem.desc + p * 0.1 + lo.asc;
          items.push(...shift(lo.items, (w - lo.w) / 2, y));
          desc = y + lo.desc;
        }
        return { w: w + p * 0.1, asc, desc, items };
      }
      case 'matrix': {
        const cells = b.rows.map((r) => r.map((c) => place(c, p, col, false)));
        const cols = Math.max(1, ...cells.map((r) => r.length));
        const colW = Array.from({ length: cols }, (_, j) => Math.max(0, ...cells.map((r) => r[j]?.w ?? 0)));
        const rowA = cells.map((r) => Math.max(p * 0.7, ...r.map((c) => c.asc)));
        const rowD = cells.map((r) => Math.max(p * 0.25, ...r.map((c) => c.desc)));
        const colGap = p * 0.9;
        const rowGap = p * 0.28;
        const items: DrawItem[] = [];
        let y = 0;
        const baselines: number[] = [];
        cells.forEach((r, i) => {
          y += rowA[i] as number;
          baselines.push(y);
          let x = 0;
          r.forEach((c, j) => {
            const a = b.align[j] ?? 'c';
            const cw = colW[j] as number;
            const dx = a === 'l' ? 0 : a === 'r' ? cw - c.w : (cw - c.w) / 2;
            items.push(...shift(c.items, x + dx, y));
            x += cw + colGap;
          });
          y += (rowD[i] as number) + rowGap;
        });
        const height = y - rowGap;
        const width = colW.reduce((s, x) => s + x, 0) + colGap * (cols - 1);
        for (const h of b.hlines) {
          const yy = h === 0 ? 0 : (baselines[h - 1] as number) + (rowD[h - 1] as number) + rowGap / 2;
          items.push({ k: 'rule', x: 0, y: yy, w: width, h: rule(p), ...(col ? { color: col } : {}) });
        }
        // centre the block on the maths axis
        const top = height / 2 + axis(p);
        return { w: width + p * 0.1, asc: top, desc: height - top, items: shift(items, p * 0.05, -top) };
      }
      case 'accent': {
        const body = place(b.body, p, col, displayFrac);
        const y = -body.asc - p * 0.08;
        const lw = Math.max(1, p * 0.055);
        const mid = body.w / 2;
        const s = p * 0.22;
        const items = [...body.items];
        const c = col ? { color: col } : {};
        if (b.kind === 'bar') items.push({ k: 'rule', x: 0, y: y - lw, w: body.w, h: lw, ...c });
        else if (b.kind === 'hat') items.push({ k: 'path', pts: [[mid - s, y], [mid, y - s * 0.8], [mid + s, y]], lw, ...c });
        else if (b.kind === 'tilde') items.push({ k: 'path', pts: [[mid - s, y - s * 0.2], [mid - s / 2, y - s * 0.6], [mid + s / 2, y - s * 0.1], [mid + s, y - s * 0.5]], lw, ...c });
        else if (b.kind === 'vec') items.push({ k: 'path', pts: [[0, y - s * 0.4], [body.w, y - s * 0.4]], lw, ...c }, { k: 'path', pts: [[body.w - s * 0.6, y - s * 0.8], [body.w, y - s * 0.4], [body.w - s * 0.6, y]], lw, ...c });
        else {
          const dots = b.kind === 'ddot' ? [mid - s * 0.5, mid + s * 0.5] : [mid];
          for (const dx of dots) items.push({ k: 'rule', x: dx - lw, y: y - s * 0.5 - lw, w: lw * 2, h: lw * 2, ...c });
        }
        return { w: body.w, asc: body.asc + p * 0.3, desc: body.desc, items };
      }
      case 'over': {
        const body = place(b.body, p, col, displayFrac);
        const t = rule(p);
        const items = [...body.items];
        if (b.kind === 'overline') items.push({ k: 'rule', x: 0, y: -body.asc - p * 0.1 - t, w: body.w, h: t, ...(col ? { color: col } : {}) });
        else items.push({ k: 'rule', x: 0, y: body.desc + p * 0.08, w: body.w, h: t, ...(col ? { color: col } : {}) });
        return { w: body.w, asc: body.asc + (b.kind === 'overline' ? p * 0.15 + t : 0), desc: body.desc + (b.kind === 'underline' ? p * 0.12 + t : 0), items };
      }
    }
  }

  const r = place(box, px, color, false);
  return { w: r.w, asc: r.asc, desc: r.desc, items: r.items };
}

/** A fence drawn as a stroked path from `top` to `bottom` (negative up), `w` wide, at `x`. */
function fencePath(ch: string, x: number, w: number, top: number, bottom: number, lw: number, color: string | undefined): DrawItem[] {
  const c = color ? { color } : {};
  const h = bottom - top;
  const mid = (top + bottom) / 2;
  const L = x + w * 0.25;
  const R = x + w * 0.75;
  switch (ch) {
    case '(': return [{ k: 'path', pts: arc(R, top, L, mid, R, bottom), lw, ...c }];
    case ')': return [{ k: 'path', pts: arc(L, top, R, mid, L, bottom), lw, ...c }];
    case '[': return [{ k: 'path', pts: [[R, top], [L, top], [L, bottom], [R, bottom]], lw, ...c }];
    case ']': return [{ k: 'path', pts: [[L, top], [R, top], [R, bottom], [L, bottom]], lw, ...c }];
    case '|': return [{ k: 'path', pts: [[x + w / 2, top], [x + w / 2, bottom]], lw, ...c }];
    case '‖': return [{ k: 'path', pts: [[x + w * 0.35, top], [x + w * 0.35, bottom]], lw, ...c }, { k: 'path', pts: [[x + w * 0.65, top], [x + w * 0.65, bottom]], lw, ...c }];
    case '⟨': return [{ k: 'path', pts: [[R, top], [L, mid], [R, bottom]], lw, ...c }];
    case '⟩': return [{ k: 'path', pts: [[L, top], [R, mid], [L, bottom]], lw, ...c }];
    case '{':
    case '}': {
      const s = ch === '{' ? 1 : -1;
      const ox = ch === '{' ? R : L;
      const ix = ch === '{' ? L : R;
      const q = h * 0.08;
      return [{
        k: 'path', lw, ...c,
        pts: [[ox, top], [ox - s * w * 0.25, top + q], [ox - s * w * 0.25, mid - q], [ix, mid], [ox - s * w * 0.25, mid + q], [ox - s * w * 0.25, bottom - q], [ox, bottom]],
      }];
    }
    default: return [];
  }
}

/** A smooth bracket from (x0, y0) through (xm, ym) to (x1, y1), as 16 points of a quadratic curve. */
function arc(x0: number, y0: number, xm: number, ym: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  // a quadratic through the three points with its control point beyond the middle
  const cx = 2 * xm - (x0 + x1) / 2;
  const cy = 2 * ym - (y0 + y1) / 2;
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const u = 1 - t;
    pts.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
  }
  return pts;
}

/* ------------------------------ texts: runs of plain words and maths ------------------------------ */

const CACHE = new Map<string, MathLayout>();
const CACHE_MAX = 2000;

/**
 * A whole text (`"Area = $\frac{1}{2}bh$"`) laid out on one line: plain runs in the text font, `$…$` runs typeset. A
 * maths run that is not in the subset is shown as its source. Results are kept for the last 2,000 texts (design 6.6).
 */
export function layoutText(s: string, px: number, measure: Measure, color?: string): MathLayout {
  const key = `${px}|${color ?? ''}|${s}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  let x = 0;
  let asc = px * 0.72;
  let desc = px * 0.22;
  const items: DrawItem[] = [];
  for (const run of splitMath(s)) {
    let l: MathLayout;
    if (run.kind === 'math') {
      const t = parseTex(run.s);
      l = t.ok ? layoutBox(t.box, px, measure, color) : plain(`$${run.s}$`, px, measure, color);
    } else l = plain(run.s, px, measure, color);
    items.push(...shift(l.items, x, 0));
    x += l.w;
    asc = Math.max(asc, l.asc);
    desc = Math.max(desc, l.desc);
  }
  const out: MathLayout = { w: x, asc, desc, items };
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(key, out);
  return out;
}

function plain(s: string, px: number, measure: Measure, color?: string): MathLayout {
  const m = measure(s, 'text', px);
  return { w: m.w, asc: m.asc, desc: m.desc, items: s ? [{ k: 'glyph', x: 0, y: 0, s, font: 'text', px, ...(color ? { color } : {}) }] : [] };
}

/** True when a text has a `$…$` part worth typesetting. */
export const hasMath = (s: string): boolean => splitMath(s).some((r) => r.kind === 'math');
