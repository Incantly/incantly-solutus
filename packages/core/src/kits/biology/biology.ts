import type {
  Biology,
  BiologyOptions,
  Cell,
  CellOptions,
  Dots,
  Helix,
  HelixOptions,
  Membrane,
  MembraneOptions,
  Stream,
  StreamOptions,
  Tone,
  Vec2,
  ViewBox,
} from '../../api/types';
import type { KitContext } from '../../runtime/kit';
import { SceneApiError } from '../../scene/errors';
import { fmt } from '../../scene/format';
import { TONES, type StageHandle } from '../../scene/handles';
import { drawCell } from './cell';

export const DEFAULT_BIOLOGY_VIEWBOX: ViewBox = [0, 0, 640, 400];
const MAX_PARTICLES = 400;
const MAX_BASES = 48;
const MAX_STREAM = 60;
const MAX_CELLS = 8;
/** The fixed step membrane particles move in, seconds. */
const STEP = 1 / 60;

function fail(message: string): never {
  throw new SceneApiError(message);
}

function checkTone(tone: unknown, what: string): Tone | undefined {
  if (tone === undefined) return undefined;
  if (typeof tone !== 'string' || !TONES.has(tone)) fail(`biology: unknown tone "${String(tone)}" for ${what}`);
  return tone as Tone;
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`biology: ${what} must be a finite number`);
  return value;
}

function checkPoint(value: unknown, what: string): Vec2 {
  if (!Array.isArray(value) || value.length !== 2) fail(`biology: ${what} is [x, y]`);
  return [finite(value[0], what), finite(value[1], what)];
}

function checkBox(value: unknown, what: string): ViewBox {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) fail(`biology: ${what} is [x, y, width, height]`);
  if (!(value[2] > 0 && value[3] > 0)) fail(`biology: ${what} needs a positive width and height`);
  return [value[0], value[1], value[2], value[3]];
}

/** Checks the biology stage's options and returns its view box (the kit's layout step). */
export function biologyLayout(options: unknown): { readonly viewBox: ViewBox } {
  const o = options as BiologyOptions;
  const viewBox = o.viewBox === undefined ? DEFAULT_BIOLOGY_VIEWBOX : checkBox(o.viewBox, 'viewBox');
  if (!(viewBox[2] >= 120 && viewBox[3] >= 80)) fail('biology: the view box is too small; make it at least 120 by 80');
  return { viewBox };
}

/** A seeded generator (mulberry32), so a membrane's particles move the same way on every run. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** The base each base pairs with. */
const PAIR: Readonly<Record<string, string>> = { A: 'T', T: 'A', G: 'C', C: 'G' };
/** Each base in its own tone. */
const BASE_TONE: Readonly<Record<string, Tone>> = { A: 'a', T: 'lit', G: 'c', C: 'b' };

interface Particle {
  x: number;
  y: number;
  angle: number;
}

export class BiologyKit implements Biology {
  readonly stage: StageHandle;
  private readonly viewBox: ViewBox;
  private cells = 0;
  private membranes = 0;

  constructor(
    private readonly ctx: KitContext,
    options: BiologyOptions,
  ) {
    this.stage = ctx.stage;
    this.viewBox = biologyLayout(options).viewBox;
  }

  cell(x: number, y: number, options?: CellOptions): Cell {
    if (this.cells >= MAX_CELLS) fail(`biology: a stage draws at most ${MAX_CELLS} cells`);
    this.cells++;
    return drawCell(this.stage, finite(x, 'x'), finite(y, 'y'), options);
  }

  // -------------------------------------------------------------------------
  // Membranes: diffusion through channels, and active transport
  // -------------------------------------------------------------------------

  membrane(options: MembraneOptions): Membrane {
    if (this.membranes >= 2) fail('biology: a stage draws at most 2 membranes');
    this.membranes++;
    if (typeof options !== 'object' || options === null) fail('biology: membrane needs { particles: [left, right] }');
    const box = options.box === undefined ? this.viewBox : checkBox(options.box, 'a membrane’s box');
    // Counts worked out from the model, such as a concentration times a volume, are rounded to whole particles.
    const counts = (value: unknown): [number, number] => {
      if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
        fail('biology: particles is [left, right], two numbers of particles, 0 or more');
      }
      const [left, right] = [Math.round(value[0] as number), Math.round(value[1] as number)];
      if (left + right > MAX_PARTICLES) fail(`biology: a membrane holds at most ${MAX_PARTICLES} particles`);
      return [left, right];
    };
    let [startLeft, startRight] = counts(options.particles);
    const channels = options.channels ?? 3;
    if (!Number.isInteger(channels) || channels < 0 || channels > 8) fail('biology: channels is a whole number from 0 to 8');
    let permeability = options.permeability ?? 1;
    let pump = options.pump ?? 0;
    let speed = options.speed ?? 60;
    const check = () => {
      if (!(Number.isFinite(permeability) && permeability >= 0 && permeability <= 1)) fail('biology: permeability is from 0 to 1');
      if (!(Number.isFinite(pump) && pump >= 0 && pump <= 50)) fail('biology: pump is particles a second, from 0 to 50');
      if (!(Number.isFinite(speed) && speed >= 0 && speed <= 400)) fail('biology: speed is from 0 to 400 stage units a second');
    };
    check();
    const tone = checkTone(options.tone, 'the particles') ?? 'lit';
    const [bx, by, bw, bh] = box;
    const mid = bx + bw / 2;
    const thick = Math.max(8, Math.min(18, bw * 0.03));
    const radius = Math.max(2.5, Math.min(5, Math.min(bw, bh) * 0.012));
    // Channels sit evenly down the membrane; a particle crosses only where one is.
    const gap = Math.max(radius * 5, bh * 0.07);
    const openings = Array.from({ length: channels }, (_, k) => by + (bh * (k + 1)) / (channels + 1));
    const pumpY = by + bh - Math.max(gap, bh * 0.08);
    const group = this.stage.group();
    this.stage.rect(bx, by, bw, bh, { parent: group, tone: 'faint', fill: false });
    const wall = this.stage.path('', { parent: group, tone: 'lo', fill: true });
    const proteins = this.stage.path('', { parent: group, tone: 'b', fill: true });
    const pumpShape = this.stage.path('', { parent: group, tone: 'lit', fill: true });
    const leftLabel = this.stage.text(bx + bw / 4, by + 16, '', { parent: group, tone: 'hi' });
    const rightLabel = this.stage.text(bx + (3 * bw) / 4, by + 16, '', { parent: group, tone: 'hi' });
    for (const t of [leftLabel, rightLabel]) t.set({ 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 16 });
    // The membrane between its channels, as a band; each channel a protein with a pore through it.
    let band = '';
    let from = by;
    const cuts = channels === 0 ? [] : openings;
    for (const y of cuts) {
      band += `M${fmt(mid - thick / 2)} ${fmt(from)}H${fmt(mid + thick / 2)}V${fmt(y - gap / 2)}H${fmt(mid - thick / 2)}Z`;
      from = y + gap / 2;
    }
    band += `M${fmt(mid - thick / 2)} ${fmt(from)}H${fmt(mid + thick / 2)}V${fmt(by + bh)}H${fmt(mid - thick / 2)}Z`;
    wall.d(band);
    let pores = '';
    for (const y of cuts) {
      const w = thick * 0.9;
      pores += `M${fmt(mid - thick / 2 - w)} ${fmt(y - gap / 2 - 3)}h${fmt(w)}v${fmt(gap + 6)}h${fmt(-w)}Z`;
      pores += `M${fmt(mid + thick / 2)} ${fmt(y - gap / 2 - 3)}h${fmt(w)}v${fmt(gap + 6)}h${fmt(-w)}Z`;
    }
    proteins.d(pores);
    const random = seeded(7919);
    let particles: Particle[] = [];
    let crossed = 0;
    let owed = 0;
    const scatter = (left: number, right: number) => {
      particles = [];
      const place = (n: number, x0: number, x1: number) => {
        for (let k = 0; k < n; k++) {
          particles.push({ x: x0 + radius + random() * (x1 - x0 - 2 * radius), y: by + radius + random() * (bh - 2 * radius), angle: random() * 2 * Math.PI });
        }
      };
      place(left, bx, mid - thick / 2);
      place(right, mid + thick / 2, bx + bw);
      crossed = 0;
      owed = 0;
    };
    scatter(startLeft, startRight);
    const inChannel = (y: number) => channels === 0 || openings.some((o) => Math.abs(y - o) <= gap / 2 - radius * 0.5);
    const step = (dt: number) => {
      for (const p of particles) {
        // Each particle runs straight for a while and drifts off course a little at random, as molecules in a fluid do.
        p.angle += (random() - 0.5) * 0.5;
        let nx = p.x + Math.cos(p.angle) * speed * dt;
        let ny = p.y + Math.sin(p.angle) * speed * dt;
        if (nx < bx + radius || nx > bx + bw - radius) {
          p.angle = Math.PI - p.angle;
          nx = Math.min(bx + bw - radius, Math.max(bx + radius, nx));
        }
        if (ny < by + radius || ny > by + bh - radius) {
          p.angle = -p.angle;
          ny = Math.min(by + bh - radius, Math.max(by + radius, ny));
        }
        const wasLeft = p.x < mid;
        const nowLeft = nx < mid;
        const touching = Math.abs(nx - mid) < thick / 2 + radius;
        if (touching || wasLeft !== nowLeft) {
          if (inChannel(ny) && (wasLeft !== nowLeft ? random() < permeability : true)) {
            if (wasLeft !== nowLeft) crossed += wasLeft ? 1 : -1;
          } else {
            // Turned back by the membrane.
            p.angle = Math.PI - p.angle;
            nx = wasLeft ? Math.min(nx, mid - thick / 2 - radius) : Math.max(nx, mid + thick / 2 + radius);
          }
        }
        p.x = nx;
        p.y = ny;
      }
      // Active transport: the pump carries particles from the left to the right, whichever side has more.
      owed += pump * dt;
      while (owed >= 1 - 1e-9) {
        owed -= 1;
        let best: Particle | null = null;
        for (const p of particles) if (p.x < mid && (!best || Math.hypot(p.x - mid, p.y - pumpY) < Math.hypot(best.x - mid, best.y - pumpY))) best = p;
        if (!best) {
          owed = 0;
          break;
        }
        best.x = mid + thick / 2 + radius + 2;
        best.y = pumpY;
        best.angle = 0;
        crossed++;
      }
    };
    this.ctx.simulate(step, STEP);
    // Behind the drawing, so the counts and the membrane read over the particles.
    const dots: Dots = this.stage.dots({ tone, r: radius, layer: 'back' });
    const sides = () => {
      let left = 0;
      for (const p of particles) if (p.x < mid) left++;
      return [left, particles.length - left] as const;
    };
    const draw = () => {
      dots.set(particles.map((p) => [p.x, p.y] as Vec2));
      const [left, right] = sides();
      leftLabel.text(String(left));
      rightLabel.text(String(right));
      // The channels look as open as they are, and the pump shows while it works.
      proteins.set({ opacity: Number((0.3 + 0.7 * permeability).toFixed(2)) });
      if (pump > 0) {
        const w = thick * 1.5;
        pumpShape
          .d(`M${fmt(mid - w)} ${fmt(pumpY - gap * 0.6)}h${fmt(2 * w)}v${fmt(gap * 1.2)}h${fmt(-2 * w)}Z`)
          .set({ opacity: Number(Math.min(1, 0.45 + pump / 20).toFixed(2)) })
          .show();
      } else pumpShape.hide();
    };
    draw();
    this.ctx.onRedraw(draw);
    const facade: Membrane = {
      get left() {
        return sides()[0];
      },
      get right() {
        return sides()[1];
      },
      get crossed() {
        return crossed;
      },
      set: (values) => {
        if (typeof values !== 'object' || values === null) fail('biology: membrane.set takes { permeability, pump, speed }');
        const was = { permeability, pump, speed };
        if (values.permeability !== undefined) permeability = finite(values.permeability, 'permeability');
        if (values.pump !== undefined) pump = finite(values.pump, 'pump');
        if (values.speed !== undefined) speed = finite(values.speed, 'speed');
        try {
          check();
        } catch (error) {
          ({ permeability, pump, speed } = was);
          throw error;
        }
        draw();
        return facade;
      },
      reset: (left: number, right: number) => {
        [startLeft, startRight] = counts([left, right]);
        scatter(startLeft, startRight);
        draw();
        return facade;
      },
      handle: group,
    };
    return Object.freeze(facade);
  }

  // -------------------------------------------------------------------------
  // DNA
  // -------------------------------------------------------------------------

  helix(options: HelixOptions): Helix {
    if (typeof options !== 'object' || options === null) fail('biology: helix needs { sequence, from, to }');
    const sequence = String(options.sequence ?? '').toUpperCase();
    if (!/^[ATGC]+$/.test(sequence)) fail('biology: a sequence is the letters A, T, G and C, such as "ATGCGTACGT"');
    if (sequence.length > MAX_BASES) fail(`biology: a helix draws at most ${MAX_BASES} base pairs`);
    const partner = [...sequence].map((b) => PAIR[b]!).join('');
    const start = checkPoint(options.from, 'a helix’s from');
    const end = checkPoint(options.to, 'a helix’s to');
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 20) fail('biology: a helix’s ends must be at least 20 units apart');
    const radius = options.radius === undefined ? 34 : finite(options.radius, 'a helix’s radius');
    if (!(radius > 2 && radius <= 300)) fail('biology: a helix’s radius is from 2 to 300');
    const perTurn = options.perTurn === undefined ? 10 : finite(options.perTurn, 'perTurn');
    if (!(perTurn >= 2 && perTurn <= 40)) fail('biology: perTurn is from 2 to 40 base pairs');
    const letters = options.letters !== false;
    const spin = options.spin === undefined ? 0 : finite(options.spin, 'spin');
    const n = sequence.length;
    const ux = (end[0] - start[0]) / length;
    const uy = (end[1] - start[1]) / length;
    const vx = -uy;
    const vy = ux;
    const group = this.stage.group();
    const rungs = this.stage.group({ parent: group });
    const strandA = this.stage.path('', { parent: group, tone: 'mid' });
    const strandB = this.stage.path('', { parent: group, tone: 'mid' });
    strandA.set({ 'stroke-width': 3.5 });
    strandB.set({ 'stroke-width': 3.5 });
    const pairs = [...sequence].map((base, i) => {
      const g = this.stage.group({ parent: rungs });
      const halfA = this.stage.line(0, 0, 0, 0, { parent: g, tone: BASE_TONE[base]! });
      const halfB = this.stage.line(0, 0, 0, 0, { parent: g, tone: BASE_TONE[partner[i]!]! });
      halfA.set({ 'stroke-width': 4, 'stroke-linecap': 'butt' });
      halfB.set({ 'stroke-width': 4, 'stroke-linecap': 'butt' });
      const textA = letters ? this.stage.text(0, 0, base, { parent: g, tone: BASE_TONE[base]! }) : null;
      const textB = letters ? this.stage.text(0, 0, partner[i]!, { parent: g, tone: BASE_TONE[partner[i]!]! }) : null;
      for (const t of [textA, textB]) t?.set({ 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 11 });
      return { g, halfA, halfB, textA, textB };
    });
    let open = 0;
    let drawnAt = Number.NaN;
    const spacing = length / n;
    const draw = () => {
      const turn = spin !== 0 && !this.ctx.reducedMotion() ? this.ctx.time() * spin * 2 * Math.PI : 0;
      drawnAt = this.ctx.time();
      const opened = open * n;
      // How far apart the strands are pulled at a point along the helix, easing in near the fork.
      const apart = (t: number) => Math.max(0, Math.min(1, opened - t + 0.5)) * radius * 1.1;
      const point = (t: number, side: 1 | -1): Vec2 => {
        const phase = (2 * Math.PI * t) / perTurn + turn + (side === 1 ? 0 : Math.PI);
        const offset = radius * Math.sin(phase) + side * apart(t);
        const along = (t + 0.5) * spacing;
        return [start[0] + ux * along + vx * offset, start[1] + uy * along + vy * offset];
      };
      const samples = Math.min(400, n * 8);
      for (const [handle, side] of [[strandA, 1], [strandB, -1]] as const) {
        let d = '';
        for (let k = 0; k <= samples; k++) {
          const t = -0.5 + (k / samples) * n;
          const [px, py] = point(t, side);
          d += `${k === 0 ? 'M' : 'L'}${fmt(px)} ${fmt(py)}`;
        }
        handle.d(d);
      }
      pairs.forEach((pair, i) => {
        const a = point(i, 1);
        const b = point(i, -1);
        const separated = apart(i) > radius * 0.05;
        // Joined, the halves meet in the middle; pulled apart, each base sticks out from its own strand.
        const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dx = span > 1e-6 ? (b[0] - a[0]) / span : vx;
        const dy = span > 1e-6 ? (b[1] - a[1]) / span : vy;
        const reach = separated ? radius * 0.75 : span / 2;
        const ma: Vec2 = [a[0] + dx * reach, a[1] + dy * reach];
        const mb: Vec2 = [b[0] - dx * reach, b[1] - dy * reach];
        pair.halfA.set({ x1: a[0], y1: a[1], x2: ma[0], y2: ma[1] });
        pair.halfB.set({ x1: b[0], y1: b[1], x2: mb[0], y2: mb[1] });
        // Letters only where the pair faces the viewer enough to read.
        const facing = Math.abs(Math.sin((2 * Math.PI * i) / perTurn + turn)) > 0.55 || separated;
        for (const [text, from, to] of [[pair.textA, a, ma], [pair.textB, b, mb]] as const) {
          if (!text) continue;
          // Beside its half of the rung, along the helix, so the letter is not drawn over the line.
          text.set({ x: Number(((from[0] + to[0]) / 2 + ux * 8).toFixed(2)), y: Number(((from[1] + to[1]) / 2 + uy * 8).toFixed(2)) }).show(facing);
        }
      });
    };
    draw();
    if (spin !== 0) {
      this.ctx.markTimeUse();
      this.ctx.onRedraw(() => {
        if (this.ctx.time() !== drawnAt) draw();
      });
    }
    const facade: Helix = {
      sequence,
      partner,
      unzip: (fraction: number) => {
        const f = Math.min(1, Math.max(0, finite(fraction, 'the unzipped fraction')));
        if (f !== open) {
          open = f;
          draw();
        }
        return facade;
      },
      base: (index: number) => {
        if (!Number.isInteger(index) || index < 0 || index >= n) fail(`biology: base ${String(index)} does not exist; bases count from 0 to ${n - 1}`);
        return pairs[index]!.g;
      },
      handle: group,
    };
    return Object.freeze(facade);
  }

  // -------------------------------------------------------------------------
  // Flows
  // -------------------------------------------------------------------------

  stream(points: ReadonlyArray<Vec2>, options: StreamOptions = {}): Stream {
    if (!Array.isArray(points) || points.length < 2 || points.length > 200) fail('biology: a stream follows 2 to 200 points');
    const path = points.map((p, k) => checkPoint(p, `point ${k}`));
    const count = options.count ?? 12;
    if (!Number.isInteger(count) || count < 1 || count > MAX_STREAM) fail(`biology: a stream has 1 to ${MAX_STREAM} particles`);
    let speed = options.speed === undefined ? 40 : finite(options.speed, 'speed');
    const shape = options.shape ?? 'dot';
    if (shape !== 'dot' && shape !== 'cell') fail("biology: a stream's shape is 'dot' or 'cell'");
    const size = options.size === undefined ? 5 : finite(options.size, 'size');
    if (!(size > 0 && size <= 40)) fail('biology: a stream particle’s size is from 0 to 40');
    const tone = checkTone(options.tone, 'a stream') ?? (shape === 'cell' ? 'a' : 'lit');
    const width = options.width === undefined ? 0 : finite(options.width, 'width');
    if (!(width >= 0 && width <= 200)) fail('biology: a vessel’s width is from 0 to 200');
    // Distance along the path at each point.
    const lengths = [0];
    for (let k = 1; k < path.length; k++) lengths.push(lengths[k - 1]! + Math.hypot(path[k]![0] - path[k - 1]![0], path[k]![1] - path[k - 1]![1]));
    const total = lengths[lengths.length - 1]!;
    if (total < 1) fail('biology: a stream’s path must have some length');
    const along = (s: number): { at: Vec2; dir: Vec2 } => {
      let k = 1;
      while (k < lengths.length - 1 && lengths[k]! < s) k++;
      const a = path[k - 1]!;
      const b = path[k]!;
      const seg = lengths[k]! - lengths[k - 1]! || 1;
      const t = Math.min(1, Math.max(0, (s - lengths[k - 1]!) / seg));
      return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] };
    };
    const group = this.stage.group();
    if (width > 0) {
      // The vessel: its walls either side of the path, and the space between filled faintly.
      const side = (sign: 1 | -1) =>
        path.map((p, k): Vec2 => {
          const a = path[Math.max(0, k - 1)]!;
          const b = path[Math.min(path.length - 1, k + 1)]!;
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return [p[0] - ((b[1] - a[1]) / l) * (width / 2) * sign, p[1] + ((b[0] - a[0]) / l) * (width / 2) * sign];
        });
      const left = side(1);
      const right = side(-1);
      const line = (list: readonly Vec2[]) => list.map((p, k) => `${k === 0 ? 'M' : 'L'}${fmt(p[0])} ${fmt(p[1])}`).join('');
      this.stage.path(`${line(left)}${line([...right].reverse()).replace(/^M/, 'L')}Z`, { parent: group, tone, fill: true }).set({ 'fill-opacity': 0.1 });
      this.stage.path(line(left), { parent: group, tone }).set({ 'stroke-width': 2 });
      this.stage.path(line(right), { parent: group, tone }).set({ 'stroke-width': 2 });
    }
    const bodies = Array.from({ length: count }, () => {
      const g = this.stage.group({ parent: group });
      this.stage.circle(0, 0, size, { parent: g, tone, ...(shape === 'cell' ? { shade: 'sphere' as const } : {}) });
      // A red blood cell's dimple.
      if (shape === 'cell') this.stage.circle(0, 0, size * 0.45, { parent: g, tone }).set({ 'fill-opacity': 0.55 });
      return g;
    });
    // Distance travelled so far, built up frame by frame so a change of speed carries on from where the particles are.
    let travel = 0;
    let drawnAt = Number.NaN;
    const position = (index: number): Vec2 => {
      const s = (index / count) * total + travel;
      return along(((s % total) + total) % total).at;
    };
    const draw = () => {
      const now = this.ctx.time();
      if (Number.isFinite(drawnAt)) {
        if (now < drawnAt) travel = 0;
        else if (!this.ctx.reducedMotion()) travel += (now - drawnAt) * speed;
      }
      drawnAt = now;
      bodies.forEach((g, k) => {
        const [px, py] = position(k);
        g.at(px, py);
      });
    };
    draw();
    this.ctx.markTimeUse();
    this.ctx.onRedraw(() => {
      if (this.ctx.time() !== drawnAt) draw();
    });
    const facade: Stream = {
      set: (values) => {
        if (typeof values !== 'object' || values === null) fail('biology: stream.set takes { speed }');
        if (values.speed !== undefined) speed = finite(values.speed, 'speed');
        draw();
        return facade;
      },
      at: (index: number): Vec2 => {
        if (!Number.isInteger(index) || index < 0 || index >= count) fail(`biology: particle ${String(index)} does not exist; they count from 0 to ${count - 1}`);
        return position(index);
      },
      handle: group,
    };
    return Object.freeze(facade);
  }
}

