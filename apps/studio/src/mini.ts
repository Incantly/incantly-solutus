/** Small pictures inside result cards: the null distribution with the p-value region shaded, and an interval on a line. */

interface Dist {
  readonly spec: { pdf: (p: readonly number[], x: number) => number; quantile: (p: readonly number[], q: number) => number; discrete: boolean };
  readonly params: readonly number[];
}

const W = 280;
const H = 76;

function canvas(label: string): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const c = document.createElement('canvas');
  c.className = 'mini';
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  c.width = W * dpr;
  c.height = H * dpr;
  c.style.width = `${W}px`;
  c.style.height = `${H}px`;
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', label);
  const raw = ((): CanvasRenderingContext2D | null => {
    try {
      return c.getContext('2d');
    } catch {
      return null;
    }
  })();
  const ctx = raw && typeof raw.setTransform === 'function' ? raw : null;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, ctx };
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** The density of the statistic's distribution, the tail beyond the statistic shaded, the statistic marked. */
export function miniCurve(d: Dist, stat: number, tail: string, color: string): HTMLCanvasElement {
  const { c, ctx } = canvas(`Distribution of the statistic with the ${tail} tail beyond ${stat.toPrecision(3)} shaded`);
  if (!ctx) return c;
  let lo = d.spec.quantile(d.params, 0.001);
  let hi = d.spec.quantile(d.params, 0.999);
  lo = Math.min(lo, stat - 0.5);
  hi = Math.max(hi, stat + 0.5);
  if (lo > 0 && d.spec.quantile(d.params, 0.001) >= 0) lo = 0;
  const n = 240;
  const xs = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
  const ys = xs.map((x) => d.spec.pdf(d.params, x));
  const top = Math.max(...ys.filter(Number.isFinite)) || 1;
  const px = (x: number): number => 8 + ((x - lo) / (hi - lo)) * (W - 16);
  const py = (y: number): number => H - 14 - (Math.min(y, top) / top) * (H - 24);
  const inTail = (x: number): boolean => (tail === 'left' ? x <= stat : tail === 'right' ? x >= stat : Math.abs(x) >= Math.abs(stat));
  ctx.fillStyle = rgba(color, 0.35);
  ctx.beginPath();
  let open = false;
  xs.forEach((x, i) => {
    if (inTail(x) && Number.isFinite(ys[i] as number)) {
      if (!open) {
        ctx.moveTo(px(x), py(0));
        open = true;
      }
      ctx.lineTo(px(x), py(ys[i] as number));
    } else if (open) {
      ctx.lineTo(px(xs[i - 1] as number), py(0));
      ctx.closePath();
      open = false;
    }
  });
  if (open) {
    ctx.lineTo(px(hi), py(0));
    ctx.closePath();
  }
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  xs.forEach((x, i) => (i === 0 ? ctx.moveTo(px(x), py(ys[i] as number)) : ctx.lineTo(px(x), py(ys[i] as number))));
  ctx.stroke();
  ctx.strokeStyle = '#9aa3af';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, py(0) + 0.5);
  ctx.lineTo(W - 8, py(0) + 0.5);
  ctx.stroke();
  ctx.strokeStyle = '#1f2937';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(px(stat), 6);
  ctx.lineTo(px(stat), py(0));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#4b5563';
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(stat.toPrecision(3), Math.min(W - 20, Math.max(20, px(stat))), H - 2);
  return c;
}

/** An interval on a number line with its estimate. */
export function miniInterval(lo: number, hi: number, est: number, color: string): HTMLCanvasElement {
  const { c, ctx } = canvas(`Interval from ${lo.toPrecision(4)} to ${hi.toPrecision(4)}, estimate ${est.toPrecision(4)}`);
  if (!ctx) return c;
  const pad = (hi - lo) * 0.35 || 1;
  const a = lo - pad;
  const b = hi + pad;
  const px = (x: number): number => 10 + ((x - a) / (b - a)) * (W - 20);
  const y = 34;
  ctx.strokeStyle = '#9aa3af';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, y);
  ctx.lineTo(W - 10, y);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px(lo), y);
  ctx.lineTo(px(hi), y);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px(est), y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4b5563';
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(lo.toPrecision(4), px(lo), y + 22);
  ctx.fillText(hi.toPrecision(4), px(hi), y + 22);
  return c;
}
