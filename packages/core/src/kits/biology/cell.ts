import type { Cell, CellKind, CellOptions, Handle, Organelle, PathHandle, Tone, Vec2 } from '../../api/types';
import { shapes } from '../../helpers/shapes';
import { SceneApiError } from '../../scene/errors';
import { fmt } from '../../scene/format';
import type { StageHandle } from '../../scene/handles';

/**
 * Cells as textbooks draw them (DG-6): an animal cell, a plant cell and a
 * bacterium, each organelle its own group so a scene can make it a part,
 * point at it or hide it. Sizes follow the cell's width; positions are fixed
 * per kind, so the same cell draws the same way every time.
 */

const KINDS: Readonly<Record<CellKind, readonly Organelle[]>> = {
  animal: ['cytoplasm', 'membrane', 'er', 'golgi', 'mitochondria', 'ribosomes', 'nucleus', 'nucleolus'],
  plant: ['wall', 'cytoplasm', 'membrane', 'vacuole', 'chloroplasts', 'er', 'golgi', 'mitochondria', 'ribosomes', 'nucleus', 'nucleolus'],
  bacterium: ['flagellum', 'wall', 'cytoplasm', 'membrane', 'nucleoid', 'plasmids', 'ribosomes'],
};

const ORGANELLES: ReadonlySet<string> = new Set(Object.values(KINDS).flat());

function fail(message: string): never {
  throw new SceneApiError(message);
}

/** A capsule centred on (cx, cy): a mitochondrion or a chloroplast. */
function capsule(cx: number, cy: number, length: number, width: number, degrees: number): string {
  const r = width / 2;
  const l = Math.max(0, length / 2 - r);
  const a = (degrees * Math.PI) / 180;
  const p = (x: number, y: number): string => `${fmt(cx + x * Math.cos(a) - y * Math.sin(a))} ${fmt(cy + x * Math.sin(a) + y * Math.cos(a))}`;
  return `M${p(-l, -r)}L${p(l, -r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${p(l, r)}L${p(-l, r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${p(-l, -r)}Z`;
}

/** The folds inside a mitochondrion. */
function cristae(cx: number, cy: number, length: number, width: number, degrees: number): string {
  const a = (degrees * Math.PI) / 180;
  const p = (x: number, y: number): string => `${fmt(cx + x * Math.cos(a) - y * Math.sin(a))} ${fmt(cy + x * Math.sin(a) + y * Math.cos(a))}`;
  const half = length / 2 - width / 2;
  const folds = 5;
  let d = `M${p(-half, 0)}`;
  for (let k = 1; k <= folds; k++) d += `L${p(-half + (2 * half * k) / folds - half / folds, (k % 2 === 0 ? -1 : 1) * width * 0.28)}`;
  return `${d}L${p(half, 0)}`;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.min(r, w / 2, h / 2);
  return `M${fmt(x + k)} ${fmt(y)}H${fmt(x + w - k)}A${fmt(k)} ${fmt(k)} 0 0 1 ${fmt(x + w)} ${fmt(y + k)}V${fmt(y + h - k)}A${fmt(k)} ${fmt(k)} 0 0 1 ${fmt(x + w - k)} ${fmt(y + h)}H${fmt(x + k)}A${fmt(k)} ${fmt(k)} 0 0 1 ${fmt(x)} ${fmt(y + h - k)}V${fmt(y + k)}A${fmt(k)} ${fmt(k)} 0 0 1 ${fmt(x + k)} ${fmt(y)}Z`;
}

/** An arc of a circle, angles in degrees (0 is right, 90 is down). */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = (from * Math.PI) / 180;
  const b = (to * Math.PI) / 180;
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M${fmt(cx + r * Math.cos(a))} ${fmt(cy + r * Math.sin(a))}A${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(cx + r * Math.cos(b))} ${fmt(cy + r * Math.sin(b))}`;
}

/** A little seeded generator, so a cell's scattered ribosomes fall the same way every time. */
function seeded(seed: number): () => number {
  let t = (Math.floor(seed * 9973) ^ 0x9e3779b9) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawCell(stage: StageHandle, x: number, y: number, options: CellOptions = {}): Cell {
  const kind = options.kind ?? 'animal';
  if (!Object.hasOwn(KINDS, kind)) fail(`biology: a cell's kind is 'animal', 'plant' or 'bacterium', not "${String(kind)}"`);
  const size = options.size ?? 300;
  if (!(typeof size === 'number' && size >= 60 && size <= 2000)) fail('biology: a cell’s size is its width, from 60 to 2000 stage units');
  const seed = options.seed ?? 1;
  if (!Number.isFinite(seed)) fail('biology: a cell’s seed is a number');
  const has = KINDS[kind];
  const wanted = options.organelles ?? has;
  if (!Array.isArray(wanted)) fail('biology: organelles is a list of names, such as ["nucleus", "mitochondria"]');
  for (const name of wanted) {
    if (!ORGANELLES.has(name)) fail(`biology: "${String(name)}" is not an organelle the kit draws; it knows ${[...ORGANELLES].join(', ')}`);
    if (!has.includes(name)) fail(`biology: a${kind === 'animal' ? 'n' : ''} ${kind} cell has no ${name}; it has ${has.join(', ')}`);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail('biology: a cell needs a finite centre');
  const drawn = has.filter((name) => wanted.includes(name));
  const root = stage.group();
  root.at(x, y);
  const groups = new Map<Organelle, Handle>();
  const anchors = new Map<Organelle, Vec2>();
  const random = seeded(seed);
  const group = (name: Organelle, at: Vec2): Handle | null => {
    if (!drawn.includes(name)) return null;
    const g = stage.group({ parent: root });
    groups.set(name, g);
    anchors.set(name, at);
    return g;
  };
  const path = (parent: Handle, d: string, tone: Tone, fill = false): PathHandle => stage.path(d, { parent, tone, ...(fill ? { fill: true } : {}) });
  const W = size;

  if (kind === 'animal') {
    const R = W / 2;
    const outline = shapes.blob(0, 0, R * 0.94, { wobble: 0.06, seed });
    const cytoplasm = group('cytoplasm', [R * 0.1, R * 0.62]);
    if (cytoplasm) path(cytoplasm, outline, 'water', true).set({ 'fill-opacity': 0.12 });
    const membrane = group('membrane', [R * 0.66, -R * 0.66]);
    if (membrane) path(membrane, outline, 'mid').set({ 'stroke-width': 3 });
    const nx = -R * 0.18;
    const ny = -R * 0.06;
    const nr = R * 0.27;
    const er = group('er', [nx + nr * 1.62, ny]);
    if (er) {
      for (const k of [0, 1, 2]) path(er, arc(nx, ny, nr * (1.3 + 0.17 * k), -70, 70), 'a').set({ 'stroke-width': 2 });
    }
    const golgi = group('golgi', [R * 0.2, R * 0.5]);
    if (golgi) {
      for (const k of [0, 1, 2, 3]) path(golgi, arc(R * 0.2, R * 0.82, R * (0.2 + 0.065 * k), -140, -40), 'c').set({ 'stroke-width': 3 });
    }
    const mito = group('mitochondria', [R * 0.5, -R * 0.38]);
    if (mito) {
      for (const [mx, my, angle] of [[R * 0.5, -R * 0.38, -30], [R * 0.6, R * 0.22, 70], [-R * 0.42, R * 0.48, 15]] as const) {
        path(mito, capsule(mx, my, R * 0.34, R * 0.15, angle), 'lit', true).set({ 'fill-opacity': 0.7 });
        path(mito, cristae(mx, my, R * 0.34, R * 0.15, angle), 'lit').set({ 'stroke-width': 1.5 });
      }
    }
    const ribosomes = group('ribosomes', [-R * 0.55, -R * 0.42]);
    if (ribosomes) {
      for (let k = 0; k < 16; k++) {
        const a = random() * 2 * Math.PI;
        const r = R * (0.45 + random() * 0.38);
        stage.circle(Math.cos(a) * r, Math.sin(a) * r, Math.max(1.5, R * 0.018), { parent: ribosomes, tone: 'hi' });
      }
      // Rough ER: ribosomes along its folds.
      for (let k = 0; k < 6; k++) {
        const a = ((-60 + 24 * k) * Math.PI) / 180;
        stage.circle(nx + Math.cos(a) * nr * 1.39, ny + Math.sin(a) * nr * 1.39, Math.max(1.5, R * 0.018), { parent: ribosomes, tone: 'hi' });
      }
    }
    const nucleus = group('nucleus', [nx - nr * 0.7, ny - nr * 0.7]);
    if (nucleus) {
      stage.circle(nx, ny, nr, { parent: nucleus, tone: 'b' }).set({ 'fill-opacity': 0.25 });
      stage.circle(nx, ny, nr, { parent: nucleus, tone: 'b', fill: false });
    }
    const nucleolus = group('nucleolus', [nx + nr * 0.18, ny + nr * 0.12]);
    if (nucleolus) stage.circle(nx + nr * 0.18, ny + nr * 0.12, nr * 0.32, { parent: nucleolus, tone: 'b' }).set({ 'fill-opacity': 0.75 });
  } else if (kind === 'plant') {
    const H = W * 0.7;
    const left = -W / 2;
    const top = -H / 2;
    const inset = Math.max(5, W * 0.025);
    const wall = group('wall', [left, 0]);
    if (wall) path(wall, roundedRect(left, top, W, H, W * 0.05), 'c').set({ 'stroke-width': 5 });
    const inner = roundedRect(left + inset, top + inset, W - 2 * inset, H - 2 * inset, W * 0.04);
    const cytoplasm = group('cytoplasm', [left + W * 0.1, top + H * 0.82]);
    if (cytoplasm) path(cytoplasm, inner, 'water', true).set({ 'fill-opacity': 0.12 });
    const membrane = group('membrane', [left + inset, top + H * 0.35]);
    if (membrane) path(membrane, inner, 'mid').set({ 'stroke-width': 2 });
    const vacuole = group('vacuole', [W * 0.05, 0]);
    if (vacuole) {
      const d = roundedRect(-W * 0.2, -H * 0.27, W * 0.5, H * 0.54, W * 0.08);
      path(vacuole, d, 'water', true).set({ 'fill-opacity': 0.3 });
      path(vacuole, d, 'water').set({ 'stroke-width': 1.5 });
    }
    const chloroplasts = group('chloroplasts', [left + W * 0.18, top + H * 0.2]);
    if (chloroplasts) {
      const spots: ReadonlyArray<readonly [number, number, number]> = [
        [left + W * 0.18, top + H * 0.2, 10],
        [left + W * 0.5, top + H * 0.15, -5],
        [left + W * 0.82, top + H * 0.25, 30],
        [left + W * 0.8, top + H * 0.82, -20],
        [left + W * 0.45, top + H * 0.86, 5],
      ];
      for (const [cx, cy, angle] of spots) {
        path(chloroplasts, capsule(cx, cy, W * 0.13, W * 0.065, angle), 'c', true).set({ 'fill-opacity': 0.75 });
        // Stacks of thylakoids, the grana.
        path(chloroplasts, cristae(cx, cy, W * 0.13, W * 0.065, angle), 'c').set({ 'stroke-width': 1.2 });
      }
    }
    const nx = left + W * 0.13;
    const ny = top + H * 0.38;
    const nr = W * 0.07;
    // The ER wraps the nucleus on the side away from the wall, turned down, clear of the chloroplast above.
    const er = group('er', [nx + nr * 1.62, ny + nr * 0.3]);
    if (er) {
      for (const k of [0, 1, 2]) path(er, arc(nx, ny, nr * (1.3 + 0.17 * k), -40, 70), 'a').set({ 'stroke-width': 1.8 });
    }
    // The Golgi's stacked sacs, below the ER, between a mitochondrion and the vacuole, in the animal cell's tone.
    const gx = left + W * 0.23;
    const gy = top + H * 0.7;
    const golgi = group('golgi', [gx, gy + W * 0.04]);
    if (golgi) {
      for (const k of [0, 1, 2, 3]) path(golgi, arc(gx, gy + W * 0.1, W * (0.035 + 0.012 * k), -140, -40), 'c').set({ 'stroke-width': 2.2 });
    }
    const mito = group('mitochondria', [left + W * 0.12, top + H * 0.62]);
    if (mito) {
      for (const [mx, my, angle] of [[left + W * 0.12, top + H * 0.62, 60], [left + W * 0.88, top + H * 0.55, -60]] as const) {
        path(mito, capsule(mx, my, W * 0.1, W * 0.045, angle), 'lit', true).set({ 'fill-opacity': 0.7 });
        path(mito, cristae(mx, my, W * 0.1, W * 0.045, angle), 'lit').set({ 'stroke-width': 1.2 });
      }
    }
    const ribosomes = group('ribosomes', [left + W * 0.3, top + H * 0.72]);
    if (ribosomes) {
      for (let k = 0; k < 12; k++) {
        const along = random();
        const edge = k % 2 === 0 ? top + H * (0.09 + random() * 0.08) : top + H * (0.83 + random() * 0.08);
        stage.circle(left + W * (0.25 + along * 0.5), edge, Math.max(1.5, W * 0.008), { parent: ribosomes, tone: 'hi' });
      }
    }
    const nucleus = group('nucleus', [nx - nr * 0.7, ny - nr * 0.7]);
    if (nucleus) {
      stage.circle(nx, ny, nr, { parent: nucleus, tone: 'b' }).set({ 'fill-opacity': 0.25 });
      stage.circle(nx, ny, nr, { parent: nucleus, tone: 'b', fill: false });
    }
    const nucleolus = group('nucleolus', [nx + nr * 0.2, ny]);
    if (nucleolus) stage.circle(nx + nr * 0.2, ny, nr * 0.35, { parent: nucleolus, tone: 'b' }).set({ 'fill-opacity': 0.75 });
  } else {
    const H = W * 0.42;
    const left = -W / 2;
    const top = -H / 2;
    const flagellum = group('flagellum', [W / 2 + W * 0.3, 0]);
    if (flagellum) {
      let d = `M${fmt(W / 2 - 2)} 0`;
      for (let k = 1; k <= 24; k++) {
        const t = k / 24;
        d += `L${fmt(W / 2 + t * W * 0.42)} ${fmt(Math.sin(t * 4 * Math.PI) * H * 0.12 * t)}`;
      }
      path(flagellum, d, 'mid').set({ 'stroke-width': 2 });
    }
    const wall = group('wall', [0, top]);
    if (wall) path(wall, roundedRect(left, top, W, H, H / 2), 'c').set({ 'stroke-width': 5 });
    const inset = Math.max(5, H * 0.07);
    const inner = roundedRect(left + inset, top + inset, W - 2 * inset, H - 2 * inset, H / 2 - inset);
    const cytoplasm = group('cytoplasm', [left + W * 0.22, top + H * 0.75]);
    if (cytoplasm) path(cytoplasm, inner, 'water', true).set({ 'fill-opacity': 0.12 });
    const membrane = group('membrane', [left + inset, 0]);
    if (membrane) path(membrane, inner, 'mid').set({ 'stroke-width': 2 });
    const nucleoid = group('nucleoid', [0, 0]);
    if (nucleoid) {
      // One long loop of DNA, folded in the middle of the cell.
      let d = '';
      for (let k = 0; k <= 96; k++) {
        const t = (k / 96) * 2 * Math.PI;
        const r = 1 + 0.25 * Math.sin(7 * t + seed);
        const px = Math.cos(t) * W * 0.17 * r;
        const py = Math.sin(t) * H * 0.22 * r;
        d += `${k === 0 ? 'M' : 'L'}${fmt(px)} ${fmt(py)}`;
      }
      path(nucleoid, `${d}Z`, 'b').set({ 'stroke-width': 1.8 });
    }
    const plasmids = group('plasmids', [left + W * 0.22, top + H * 0.32]);
    if (plasmids) {
      stage.circle(left + W * 0.22, top + H * 0.32, H * 0.08, { parent: plasmids, tone: 'b', fill: false });
      stage.circle(left + W * 0.8, top + H * 0.66, H * 0.07, { parent: plasmids, tone: 'b', fill: false });
    }
    const ribosomes = group('ribosomes', [left + W * 0.68, top + H * 0.3]);
    if (ribosomes) {
      for (let k = 0; k < 14; k++) {
        const px = left + W * (0.12 + random() * 0.76);
        const py = top + H * (0.2 + random() * 0.6);
        if (Math.hypot(px / (W * 0.2), py / (H * 0.28)) < 1.1) continue;
        stage.circle(px, py, Math.max(1.5, H * 0.025), { parent: ribosomes, tone: 'hi' });
      }
    }
  }

  let cx = x;
  let cy = y;
  const facade: Cell = {
    kind,
    organelles: Object.freeze([...drawn]),
    organelle: (name: Organelle) => {
      const g = groups.get(name);
      if (!g) fail(`biology: this ${kind} cell draws no ${String(name)}; it draws ${drawn.join(', ')}`);
      return g;
    },
    where: (name: Organelle): Vec2 => {
      const at = anchors.get(name);
      if (!at) fail(`biology: this ${kind} cell draws no ${String(name)}; it draws ${drawn.join(', ')}`);
      return [cx + at[0], cy + at[1]];
    },
    at: (nx: number, ny: number) => {
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) fail('biology: a cell needs a finite centre');
      cx = nx;
      cy = ny;
      root.at(nx, ny);
      return facade;
    },
    show: (visible = true) => {
      root.show(visible);
      return facade;
    },
    hide: () => facade.show(false),
    handle: root,
  };
  return Object.freeze(facade);
}
