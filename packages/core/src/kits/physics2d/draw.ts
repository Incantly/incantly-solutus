import type { ForceArrowOptions, ForceKind, Handle, PathHandle, Readable, TextHandle, Tone, ViewBox } from '../../api/types';
import { shapes } from '../../helpers/shapes';
import type { KitContext } from '../../runtime/kit';
import { fmt } from '../../scene/format';
import type { V2 } from './geometry';
import { FORCE_KINDS, type Body, type Joint, type Tank } from './world';

/** Metres (y up, from the bottom-left of the view box) to stage units and back. */
export class View {
  constructor(
    readonly box: ViewBox,
    readonly scale: number,
  ) {}

  /** The world's width and height in metres. */
  get width(): number {
    return this.box[2] / this.scale;
  }

  get height(): number {
    return this.box[3] / this.scale;
  }

  toStage(x: number, y: number): V2 {
    return [this.box[0] + x * this.scale, this.box[1] + this.box[3] - y * this.scale];
  }

  fromStage(sx: number, sy: number): V2 {
    return [(sx - this.box[0]) / this.scale, (this.box[1] + this.box[3] - sy) / this.scale];
  }
}

/** Arrow colours, so each kind of force keeps its colour in every figure. */
const FORCE_TONES: Readonly<Record<ForceKind, Tone>> = {
  gravity: 'a',
  normal: 'b',
  friction: 'c',
  tension: 'hi',
  spring: 'c',
  buoyancy: 'b',
  drag: 'mid',
  electric: 'lit',
  magnetic: 'lit',
  applied: 'lit',
  net: 'hi',
};

interface BodyLook {
  readonly body: Body;
  readonly group: Handle;
  readonly shape: Handle;
  readonly spoke: Handle | null;
  readonly label: TextHandle | null;
  /** The polygon the path was drawn from, so a resized body is redrawn once. */
  drawn: unknown;
}

interface JointLook {
  readonly joint: Joint;
  readonly line: PathHandle;
  readonly pin: Handle | null;
  readonly wheel: Handle | null;
}

interface TankLook {
  readonly tank: Tank;
  readonly liquid: PathHandle;
  readonly surface: PathHandle;
}

interface ArrowItem {
  readonly kind: ForceKind;
  readonly arrow: PathHandle;
  readonly label: TextHandle | null;
  readonly parts: readonly [PathHandle, PathHandle] | null;
}

interface ArrowSet {
  readonly body: Body;
  readonly items: readonly ArrowItem[];
  readonly scale: number | null;
  /** The largest force lately, decaying, so arrows keep a steady scale through a collision's spike. */
  reference: number;
}

const spokeTone = (tone: Tone): Tone => (tone === 'lo' || tone === 'faint' ? 'hi' : 'faint');

export class Painter {
  private readonly bodies: BodyLook[] = [];
  private readonly joints: JointLook[] = [];
  private readonly tanks: TankLook[] = [];
  private readonly arrows: ArrowSet[] = [];

  constructor(
    private readonly ctx: KitContext,
    readonly view: View,
  ) {}

  private polygonPath(body: Body): string {
    if (body.shape.type !== 'poly') return '';
    const s = this.view.scale;
    return `${body.shape.verts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x * s)} ${fmt(-y * s)}`).join('')}Z`;
  }

  body(body: Body, tone: Tone, label: Readable | undefined): Handle {
    const stage = this.ctx.stage;
    const group = stage.group({ layer: 'mid' });
    let shape: Handle;
    let spoke: Handle | null = null;
    if (body.shape.type === 'circle') {
      const r = body.shape.r * this.view.scale;
      shape = stage.circle(0, 0, r, { parent: group, tone });
      // A spoke shows the ball turning.
      if (!body.sensor) spoke = stage.line(0, 0, r * 0.85, 0, { parent: group, tone: spokeTone(tone) });
    } else {
      shape = stage.path(this.polygonPath(body), { parent: group, tone, fill: true });
    }
    if (body.sensor) shape.set({ 'fill-opacity': 0.22 });
    const text = label === undefined ? null : stage.text(0, 0, label, { layer: 'labels', tone: 'hi' }).set({ 'text-anchor': 'middle', 'font-size': 13 });
    this.bodies.push({ body, group, shape, spoke, label: text, drawn: body.shape });
    return group;
  }

  tone(body: Body, tone: Tone): void {
    const look = this.bodies.find((l) => l.body === body);
    if (!look) return;
    look.shape.tone(tone);
    look.spoke?.tone(spokeTone(tone));
  }

  /** The stage's edges that are walls, as lines. */
  wall(from: V2, to: V2): Handle {
    const [x1, y1] = this.view.toStage(from[0], from[1]);
    const [x2, y2] = this.view.toStage(to[0], to[1]);
    return this.ctx.stage.path(`M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`, { layer: 'back', tone: 'mid' }).set({ 'stroke-width': 3 });
  }

  joint(joint: Joint, tone: Tone | undefined): PathHandle {
    const stage = this.ctx.stage;
    const kind = joint.kind;
    const line = stage.path('', { layer: 'back', tone: tone ?? (kind === 'rod' ? 'hi' : 'mid') });
    if (kind === 'rod') line.set({ 'stroke-width': 4 });
    let pin: Handle | null = null;
    let wheel: Handle | null = null;
    if (kind === 'hinge') pin = stage.circle(0, 0, 4, { layer: 'front', tone: tone ?? 'hi' });
    if (kind === 'pulley' && joint.spec.wheel) {
      wheel = stage.circle(0, 0, joint.spec.wheel.r * this.view.scale, { layer: 'mid', tone: tone ?? 'lo' });
      pin = stage.circle(0, 0, 3, { layer: 'front', tone: 'hi' });
    }
    this.joints.push({ joint, line, pin, wheel });
    return line;
  }

  /** Draws a tank; returns the outline of its walls. */
  tank(tank: Tank, tone: Tone | undefined): PathHandle {
    const stage = this.ctx.stage;
    const liquid = stage.path('', { layer: 'back', tone: tone ?? 'b', fill: true }).set({ 'fill-opacity': 0.28 });
    const surface = stage.path('', { layer: 'back', tone: tone ?? 'b' });
    const t = 0.1;
    const [x0, top] = this.view.toStage(tank.x0 - t, tank.height);
    const [x1, bottom] = this.view.toStage(tank.x1 + t, -t);
    const [ix0, floor] = this.view.toStage(tank.x0, 0);
    const [ix1] = this.view.toStage(tank.x1, 0);
    const d = `M${fmt(x0)} ${fmt(top)}L${fmt(x0)} ${fmt(bottom)}L${fmt(x1)} ${fmt(bottom)}L${fmt(x1)} ${fmt(top)}L${fmt(ix1)} ${fmt(top)}L${fmt(ix1)} ${fmt(floor)}L${fmt(ix0)} ${fmt(floor)}L${fmt(ix0)} ${fmt(top)}Z`;
    const walls = stage.path(d, { layer: 'mid', tone: 'mid', fill: true });
    this.tanks.push({ tank, liquid, surface });
    return walls;
  }

  forces(body: Body, options: ForceArrowOptions): void {
    const stage = this.ctx.stage;
    const kinds = options.show ?? FORCE_KINDS;
    const items = kinds.map((kind): ArrowItem => {
      const tone = FORCE_TONES[kind];
      const arrow = stage.path('', { layer: 'front', tone }).set({ 'stroke-width': kind === 'net' ? 3 : 2.5 });
      if (kind === 'net') arrow.dashed(true);
      const label = options.labels === false ? null : stage.text(0, 0, '', { layer: 'labels', tone }).set({ 'font-size': 11 });
      const parts = options.components ? ([stage.path('', { layer: 'front', tone, dashed: true }), stage.path('', { layer: 'front', tone, dashed: true })] as const) : null;
      return { kind, arrow, label, parts };
    });
    this.arrows.push({ body, items, scale: options.scale ?? null, reference: 0 });
  }

  draw(): void {
    for (const look of this.bodies) this.drawBody(look);
    for (const look of this.joints) this.drawJoint(look);
    for (const look of this.tanks) this.drawTank(look);
    for (const set of this.arrows) this.drawArrows(set);
  }

  private drawBody(look: BodyLook): void {
    const { body, group } = look;
    group.show(body.active);
    look.label?.show(body.active);
    if (!body.active) return;
    const [sx, sy] = this.view.toStage(body.x, body.y);
    group.at(sx, sy).rotate((-body.a * 180) / Math.PI);
    if (look.drawn !== body.shape) {
      look.drawn = body.shape;
      if (body.shape.type === 'circle') {
        const r = body.shape.r * this.view.scale;
        look.shape.set({ r });
        look.spoke?.set({ x2: r * 0.85 });
      } else {
        (look.shape as PathHandle).d(this.polygonPath(body));
      }
    }
    look.label?.set({ x: sx, y: sy - body.extent * this.view.scale - 8 });
  }

  private drawJoint(look: JointLook): void {
    const { joint, line } = look;
    const visible = joint.live;
    line.show(visible);
    look.pin?.show(visible);
    look.wheel?.show(visible);
    if (!visible) return;
    const [ax, ay] = this.view.toStage(...joint.anchorA());
    const [bx, by] = this.view.toStage(...joint.anchorB());
    switch (joint.kind) {
      case 'spring':
        line.d(shapes.spring(ax, ay, bx, by, { coils: 10, width: 7 }));
        break;
      case 'rope': {
        const gap = Math.hypot(bx - ax, by - ay);
        const slack = joint.length * this.view.scale - gap;
        // A slack rope hangs; a taut one is straight.
        const sag = slack > 0.5 ? Math.sqrt(slack * (slack + 2 * gap)) / 2 : 0;
        line.d(sag > 0 ? `M${fmt(ax)} ${fmt(ay)}Q${fmt((ax + bx) / 2)} ${fmt((ay + by) / 2 + sag)} ${fmt(bx)} ${fmt(by)}` : `M${fmt(ax)} ${fmt(ay)}L${fmt(bx)} ${fmt(by)}`);
        break;
      }
      case 'rod':
        line.d(`M${fmt(ax)} ${fmt(ay)}L${fmt(bx)} ${fmt(by)}`);
        break;
      case 'hinge': {
        line.d('');
        look.pin?.set({ cx: bx, cy: by });
        break;
      }
      case 'pulley': {
        const wheel = joint.spec.wheel!;
        const [cx, cy] = this.view.toStage(wheel.at[0], wheel.at[1]);
        const [gax, gay] = this.view.toStage(...joint.gA);
        const [gbx, gby] = this.view.toStage(...joint.gB);
        const r = wheel.r * this.view.scale;
        // Over the top of the wheel, from A's side to B's.
        const sweep = gax < gbx ? 1 : 0;
        line.d(`M${fmt(ax)} ${fmt(ay)}L${fmt(gax)} ${fmt(gay)}A${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(gbx)} ${fmt(gby)}L${fmt(bx)} ${fmt(by)}`);
        look.wheel?.set({ cx, cy });
        look.pin?.set({ cx, cy });
        break;
      }
    }
  }

  private drawTank(look: TankLook): void {
    const { tank } = look;
    const [x0, y0] = this.view.toStage(tank.x0, 0);
    const [x1, top] = this.view.toStage(tank.x1, Math.min(tank.level, tank.height));
    look.liquid.d(`M${fmt(x0)} ${fmt(y0)}L${fmt(x0)} ${fmt(top)}L${fmt(x1)} ${fmt(top)}L${fmt(x1)} ${fmt(y0)}Z`);
    look.surface.d(`M${fmt(x0)} ${fmt(top)}L${fmt(x1)} ${fmt(top)}`);
  }

  private drawArrows(set: ArrowSet): void {
    const { body } = set;
    const forces = set.items.map((item) => body.force(item.kind));
    const largest = Math.max(0, ...forces.map(([fx, fy]) => Math.hypot(fx, fy)));
    set.reference = Math.max(largest, set.reference * 0.97);
    const perNewton = set.scale ?? (set.reference > 0 ? 80 / set.reference : 0);
    const [sx, sy] = this.view.toStage(body.x, body.y);
    // Labels already placed this draw, so arrows that point the same way do not print over each other.
    const placed: Array<{ x: number; y: number; w: number }> = [];
    set.items.forEach((item, i) => {
      const [fx, fy] = forces[i]!;
      const size = Math.hypot(fx, fy);
      const dx = fx * perNewton;
      const dy = -fy * perNewton;
      const length = Math.hypot(dx, dy);
      const visible = body.active && length >= 2 && size > 1e-9;
      item.arrow.show(visible);
      item.label?.show(visible);
      item.parts?.[0].show(visible && Math.abs(dx) >= 2 && Math.abs(dy) >= 2);
      item.parts?.[1].show(visible && Math.abs(dx) >= 2 && Math.abs(dy) >= 2);
      if (!visible) return;
      item.arrow.d(this.ctx.path.arrow(sx, sy, dx, dy, Math.min(9, length / 3)));
      if (item.parts) {
        item.parts[0].d(this.ctx.path.arrow(sx, sy, dx, 0, Math.min(7, Math.abs(dx) / 3)));
        item.parts[1].d(this.ctx.path.arrow(sx, sy, 0, dy, Math.min(7, Math.abs(dy) / 3)));
      }
      if (item.label) {
        const ux = dx / length;
        const uy = dy / length;
        const text = `${item.kind} ${size < 100 ? size.toFixed(1) : Math.round(size)} N`;
        const anchor = Math.abs(ux) < 0.3 ? 'middle' : ux > 0 ? 'start' : 'end';
        const w = text.length * 6.2;
        const x = sx + dx + ux * 6;
        let y = sy + dy + uy * 6 + 4;
        const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
        const step = uy < 0 ? -13 : 13;
        for (let tries = 0; tries < 6 && placed.some((p) => Math.abs(p.y - y) < 12 && left < p.x + p.w && p.x < left + w); tries++) y += step;
        placed.push({ x: left, y, w });
        item.label.set({ x, y, 'text-anchor': anchor });
        item.label.text(text);
      }
    });
  }
}
