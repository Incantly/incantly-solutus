/**
 * A drawing context that writes SVG (embed-files-export design 5.1): it answers the part of the canvas 2D API the
 * painter uses, so the picture exported is the picture on the screen. Text stays text. No DOM is needed.
 */

type Matrix = readonly [number, number, number, number, number, number];

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  lineDash: number[];
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  m: Matrix;
}

const ID: Matrix = [1, 0, 0, 1, 0, 0];
const r2 = (x: number): string => (Math.round(x * 100) / 100).toString();
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mul(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** The font size in px of a CSS font text such as `13px Inter, sans-serif`. */
const fontPx = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 13);
const fontFamily = (font: string): string => font.replace(/^.*?\d+(?:\.\d+)?px\s*/, '') || 'sans-serif';
const fontWeight = (font: string): string | undefined => (/\bbold\b|\b[6-9]00\b/.test(font) ? 'bold' : undefined);
const fontStyle = (font: string): string | undefined => (/\bitalic\b/.test(font) ? 'italic' : undefined);

/** A colour and its opacity, apart (`rgba(…, 0.5)` becomes the colour and 0.5). */
function paint(css: string, alpha: number): { color: string; opacity: number } {
  const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(css);
  if (m) return { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, opacity: Number(m[4]) * alpha };
  return { color: css, opacity: alpha };
}

export class SvgContext {
  readonly width: number;
  readonly height: number;
  private s: State = { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1, lineDash: [], lineJoin: 'miter', lineCap: 'butt', m: ID };
  private stack: State[] = [];
  private path: string[] = [];
  private cur: [number, number] | undefined;
  private start: [number, number] | undefined;
  private readonly out: string[] = [];
  /** Elements written so far (the exporter caps them). */
  elements = 0;
  shadowColor = 'transparent';
  shadowBlur = 0;
  /** A canvas-like owner, for code that reads `ctx.canvas.width`. */
  readonly canvas: { width: number; height: number };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = { width, height };
  }

  /* ------------------------------ state ------------------------------ */

  get fillStyle(): string {
    return this.s.fillStyle;
  }
  set fillStyle(v: string) {
    if (typeof v === 'string') this.s.fillStyle = v;
  }
  get strokeStyle(): string {
    return this.s.strokeStyle;
  }
  set strokeStyle(v: string) {
    if (typeof v === 'string') this.s.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.s.lineWidth;
  }
  set lineWidth(v: number) {
    if (Number.isFinite(v) && v > 0) this.s.lineWidth = v;
  }
  get font(): string {
    return this.s.font;
  }
  set font(v: string) {
    this.s.font = v;
  }
  get textAlign(): CanvasTextAlign {
    return this.s.textAlign;
  }
  set textAlign(v: CanvasTextAlign) {
    this.s.textAlign = v;
  }
  get textBaseline(): CanvasTextBaseline {
    return this.s.textBaseline;
  }
  set textBaseline(v: CanvasTextBaseline) {
    this.s.textBaseline = v;
  }
  get globalAlpha(): number {
    return this.s.globalAlpha;
  }
  set globalAlpha(v: number) {
    if (Number.isFinite(v)) this.s.globalAlpha = Math.min(1, Math.max(0, v));
  }
  get lineJoin(): CanvasLineJoin {
    return this.s.lineJoin;
  }
  set lineJoin(v: CanvasLineJoin) {
    this.s.lineJoin = v;
  }
  get lineCap(): CanvasLineCap {
    return this.s.lineCap;
  }
  set lineCap(v: CanvasLineCap) {
    this.s.lineCap = v;
  }

  save(): void {
    this.stack.push({ ...this.s, lineDash: [...this.s.lineDash] });
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) this.s = s;
  }
  setLineDash(d: number[]): void {
    this.s.lineDash = Array.isArray(d) ? d.filter((x) => Number.isFinite(x) && x >= 0) : [];
  }
  getLineDash(): number[] {
    return [...this.s.lineDash];
  }
  translate(x: number, y: number): void {
    this.s.m = mul(this.s.m, [1, 0, 0, 1, x, y]);
  }
  rotate(a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.s.m = mul(this.s.m, [c, s, -s, c, 0, 0]);
  }
  scale(x: number, y: number): void {
    this.s.m = mul(this.s.m, [x, 0, 0, y, 0, 0]);
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.s.m = [a, b, c, d, e, f];
  }
  resetTransform(): void {
    this.s.m = ID;
  }

  /* ------------------------------ paths ------------------------------ */

  private pt(x: number, y: number): [number, number] {
    const m = this.s.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  beginPath(): void {
    this.path = [];
    this.cur = undefined;
    this.start = undefined;
  }
  moveTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const p = this.pt(x, y);
    this.path.push(`M${r2(p[0])} ${r2(p[1])}`);
    this.cur = p;
    this.start = p;
  }
  lineTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.cur) return this.moveTo(x, y);
    const p = this.pt(x, y);
    this.path.push(`L${r2(p[0])} ${r2(p[1])}`);
    this.cur = p;
  }
  closePath(): void {
    if (!this.cur) return;
    this.path.push('Z');
    this.cur = this.start;
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  /** Curves as short straight pieces: exact enough at export size, and right under any transform. */
  private sweep(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw: boolean): void {
    if (![cx, cy, rx, ry, a0, a1].every(Number.isFinite)) return;
    let d = a1 - a0;
    if (!ccw && d < 0) d = (d % (2 * Math.PI)) + 2 * Math.PI;
    if (ccw && d > 0) d = (d % (2 * Math.PI)) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI) d = ccw ? -2 * Math.PI : 2 * Math.PI;
    const n = Math.max(8, Math.ceil((Math.abs(d) / (2 * Math.PI)) * 72));
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (d * i) / n;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      const x = cx + ex * cr - ey * sr;
      const y = cy + ex * sr + ey * cr;
      if (i === 0 && !this.cur) this.moveTo(x, y);
      else this.lineTo(x, y);
    }
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    this.sweep(x, y, r, r, 0, a0, a1, ccw);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    this.sweep(x, y, rx, ry, rot, a0, a1, ccw);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number | number[] = 0): void {
    const k = Math.max(0, Math.min(Array.isArray(r) ? (r[0] ?? 0) : r, w / 2, h / 2));
    this.moveTo(x + k, y);
    this.lineTo(x + w - k, y);
    this.sweep(x + w - k, y + k, k, k, 0, -Math.PI / 2, 0, false);
    this.lineTo(x + w, y + h - k);
    this.sweep(x + w - k, y + h - k, k, k, 0, 0, Math.PI / 2, false);
    this.lineTo(x + k, y + h);
    this.sweep(x + k, y + h - k, k, k, 0, Math.PI / 2, Math.PI, false);
    this.lineTo(x, y + k);
    this.sweep(x + k, y + k, k, k, 0, Math.PI, Math.PI * 1.5, false);
    this.closePath();
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.cur) this.moveTo(cpx, cpy);
    const c = this.pt(cpx, cpy);
    const p = this.pt(x, y);
    this.path.push(`Q${r2(c[0])} ${r2(c[1])} ${r2(p[0])} ${r2(p[1])}`);
    this.cur = p;
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.cur) this.moveTo(c1x, c1y);
    const a = this.pt(c1x, c1y);
    const b = this.pt(c2x, c2y);
    const p = this.pt(x, y);
    this.path.push(`C${r2(a[0])} ${r2(a[1])} ${r2(b[0])} ${r2(b[1])} ${r2(p[0])} ${r2(p[1])}`);
    this.cur = p;
  }
  clip(): void {
    // the painter clips only to the canvas, which the SVG viewport already does
  }

  /* ------------------------------ painting ------------------------------ */

  private emit(el: string): void {
    this.out.push(el);
    this.elements++;
  }

  private strokeAttrs(): string {
    const p = paint(this.s.strokeStyle, this.s.globalAlpha);
    const scale = Math.hypot(this.s.m[0], this.s.m[1]) || 1;
    const dash = this.s.lineDash.length > 0 ? ` stroke-dasharray="${this.s.lineDash.map((x) => r2(x * scale)).join(' ')}"` : '';
    const join = this.s.lineJoin !== 'miter' ? ` stroke-linejoin="${this.s.lineJoin}"` : '';
    const cap = this.s.lineCap !== 'butt' ? ` stroke-linecap="${this.s.lineCap}"` : '';
    return `stroke="${esc(p.color)}" stroke-width="${r2(this.s.lineWidth * scale)}"${p.opacity < 1 ? ` stroke-opacity="${r2(p.opacity)}"` : ''}${dash}${join}${cap}`;
  }

  fill(rule?: CanvasFillRule): void {
    if (this.path.length === 0) return;
    const p = paint(this.s.fillStyle, this.s.globalAlpha);
    this.emit(`<path d="${this.path.join('')}" fill="${esc(p.color)}"${p.opacity < 1 ? ` fill-opacity="${r2(p.opacity)}"` : ''}${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}/>`);
  }
  stroke(): void {
    if (this.path.length === 0) return;
    this.emit(`<path d="${this.path.join('')}" fill="none" ${this.strokeAttrs()}/>`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const saved = this.path;
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    this.path = saved;
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    const saved = this.path;
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    this.path = saved;
  }
  clearRect(): void {
    // the export starts from an empty picture
  }

  /** Text widths without a font engine: an average glyph is about 0.56 of the font size. */
  measureText(text: string): TextMetrics {
    const px = fontPx(this.s.font);
    const width = [...String(text)].length * px * 0.56;
    return { width, actualBoundingBoxAscent: px * 0.75, actualBoundingBoxDescent: px * 0.25, fontBoundingBoxAscent: px * 0.8, fontBoundingBoxDescent: px * 0.2 } as TextMetrics;
  }

  private text(s: string, x: number, y: number, how: 'fill' | 'stroke'): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const f = this.s.font;
    const anchor = this.s.textAlign === 'center' ? 'middle' : this.s.textAlign === 'right' || this.s.textAlign === 'end' ? 'end' : 'start';
    const base = this.s.textBaseline === 'middle' ? 'central' : this.s.textBaseline === 'top' || this.s.textBaseline === 'hanging' ? 'hanging' : this.s.textBaseline === 'bottom' ? 'text-after-edge' : 'alphabetic';
    const p = paint(how === 'fill' ? this.s.fillStyle : this.s.strokeStyle, this.s.globalAlpha);
    const m = this.s.m;
    const t = m === ID || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) ? '' : ` transform="matrix(${m.map(r2).join(' ')})"`;
    const [px, py] = t === '' ? this.pt(x, y) : [x, y];
    const weight = fontWeight(f);
    const style = fontStyle(f);
    const look = how === 'fill' ? `fill="${esc(p.color)}"${p.opacity < 1 ? ` fill-opacity="${r2(p.opacity)}"` : ''}` : `fill="none" ${this.strokeAttrs()}`;
    this.emit(
      `<text x="${r2(px)}" y="${r2(py)}" font-family="${esc(fontFamily(f))}" font-size="${r2(fontPx(f))}"${weight ? ` font-weight="${weight}"` : ''}${style ? ` font-style="${style}"` : ''} text-anchor="${anchor}" dominant-baseline="${base}" ${look}${t}>${esc(String(s))}</text>`,
    );
  }
  fillText(s: string, x: number, y: number): void {
    this.text(s, x, y, 'fill');
  }
  strokeText(s: string, x: number, y: number): void {
    this.text(s, x, y, 'stroke');
  }
  drawImage(): void {
    // figures draw no bitmaps on the 2D canvas yet
  }

  /** The SVG document. */
  toString(background?: string): string {
    const bg = background ? `<rect width="100%" height="100%" fill="${esc(background)}"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">${bg}${this.out.join('')}</svg>`;
  }
}
