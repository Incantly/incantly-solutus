import type { Atom, AtomOptions, Bond, BondOptions, Chemistry, ChemistryOptions, DragInfo, Handle, Molecule, MoleculeOptions, MoleculeStructure, PartOptions, PathHandle, Profile, ProfileOptions, Reaction, ReactionEnergy, ReactionOptions, ShellOptions, Shells, TextHandle, Tone, Vec2, ViewBox } from '../../api/types';
import { chem } from '../../helpers/sym';
import type { KitContext } from '../../runtime/kit';
import { SceneApiError } from '../../scene/errors';
import { fmt } from '../../scene/format';
import { nodeOf, TONES, type StageHandle } from '../../scene/handles';
import { ELEMENTS, elementTone, groundShells, labelTone } from './elements';
import {
  bondEnthalpy,
  LIBRARY_FORMULAS,
  lonePairs,
  parseFormula,
  structureFrom,
  structureOf,
  type BondKind,
  type BondOrder,
  type Structure,
} from './structures';

export const DEFAULT_CHEMISTRY_VIEWBOX: ViewBox = [0, 0, 640, 400];
/** Stage units per ångström: a C–H bond is 44 units long. */
const DEFAULT_SCALE = 40;
const MAX_ATOMS = 160;
const MAX_BONDS = 200;
const MAX_SHELL_MODELS = 6;
const MAX_PROFILES = 2;
const ORDERS: ReadonlySet<number> = new Set([1, 1.5, 2, 3]);

function fail(message: string): never {
  throw new SceneApiError(message);
}

function checkTone(tone: unknown, what: string): Tone | undefined {
  if (tone === undefined) return undefined;
  if (typeof tone !== 'string' || !TONES.has(tone)) fail(`chemistry: unknown tone "${String(tone)}" for ${what}`);
  return tone as Tone;
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`chemistry: ${what} must be a finite number`);
  return value;
}

function checkPoint(value: unknown, what: string): Vec2 {
  if (!Array.isArray(value) || value.length !== 2) fail(`chemistry: ${what} is [x, y]`);
  return [finite(value[0], what), finite(value[1], what)];
}

function checkBox(value: unknown, what: string): ViewBox {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) fail(`chemistry: ${what} is [x, y, width, height]`);
  if (!(value[2] > 0 && value[3] > 0)) fail(`chemistry: ${what} needs a positive width and height`);
  return [value[0], value[1], value[2], value[3]];
}

/** A charge as written: 1 is "+", -2 is "2−". */
function chargeText(q: number): string {
  if (q === 0) return '';
  const sign = q > 0 ? '+' : '−';
  return Math.abs(q) === 1 ? sign : `${Math.abs(q)}${sign}`;
}

/** Bond symbols for lists: H–H, O=O, N≡N. */
function bondName(a: string, b: string, order: number): string {
  const mark = order >= 3 ? '≡' : order >= 2 ? '=' : order > 1 ? '⋯' : '–';
  return `${a}${mark}${b}`;
}

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** Checks the chemistry stage's options and returns its view box (the kit's layout step). */
export function chemistryLayout(options: unknown): { readonly viewBox: ViewBox } {
  const o = options as ChemistryOptions;
  const viewBox = o.viewBox === undefined ? DEFAULT_CHEMISTRY_VIEWBOX : checkBox(o.viewBox, 'viewBox');
  if (!(viewBox[2] >= 120 && viewBox[3] >= 80)) fail('chemistry: the view box is too small; make it at least 120 by 80');
  if (o.scale !== undefined && !(typeof o.scale === 'number' && o.scale >= 10 && o.scale <= 200)) fail('chemistry: scale is stage units per ångström, from 10 to 200');
  if (o.look !== undefined && o.look !== 'balls' && o.look !== 'symbols') fail(`chemistry: look is 'balls' or 'symbols', not "${String(o.look)}"`);
  return { viewBox };
}

// ---------------------------------------------------------------------------
// Records behind the handles scenes hold
// ---------------------------------------------------------------------------

interface AtomRecord {
  readonly element: string;
  x: number;
  y: number;
  readonly r: number;
  tone: Tone;
  readonly group: Handle;
  readonly ball: Handle;
  readonly label: TextHandle;
  charge: number;
  chargeText: TextHandle | null;
  partial: '+' | '-' | null;
  partialText: TextHandle | null;
  /** Lone pairs to draw, and the dots drawing them. */
  pairs: number;
  readonly dots: Handle[];
  readonly bonds: BondRecord[];
  visible: boolean;
  /** Its neighbours moved: lone pairs and partial charges need placing again. */
  stale: boolean;
  facade: Atom | null;
}

interface BondRecord {
  readonly a: AtomRecord;
  readonly b: AtomRecord;
  order: BondOrder;
  readonly kind: BondKind;
  strength: number;
  tone: Tone | undefined;
  readonly group: Handle;
  /** Filled bars for ball-and-stick bonds, and stroked lines for written ones and dashed parts. */
  readonly bars: PathHandle[];
  readonly lines: PathHandle[];
  visible: boolean;
  stale: boolean;
  facade: Bond | null;
}

export class ChemistryKit implements Chemistry {
  readonly stage: StageHandle;
  private readonly scale: number;
  private readonly look: 'balls' | 'symbols';
  private readonly viewBox: ViewBox;
  /** Loose bonds, then loose atoms, so bonds pass behind the balls. */
  private readonly looseBonds: Handle;
  private readonly looseAtoms: Handle;
  private readonly atoms: AtomRecord[] = [];
  private readonly bonds: BondRecord[] = [];
  private readonly redraws: Array<() => void> = [];
  private shellModels = 0;
  private profiles = 0;

  constructor(
    private readonly ctx: KitContext,
    options: ChemistryOptions,
  ) {
    this.stage = ctx.stage;
    this.viewBox = chemistryLayout(options).viewBox;
    this.scale = options.scale ?? DEFAULT_SCALE;
    this.look = options.look ?? 'balls';
    this.looseBonds = this.stage.group();
    this.looseAtoms = this.stage.group();
    ctx.onRedraw(() => this.flush());
    // The measuring tool reads bond lengths and angles in ångströms.
    ctx.setMeasure({ scale: [1 / this.scale, 1 / this.scale], origin: [0, 0], unit: 'Å' });
  }

  /** Names an element or a kit object for highlighting, steps and descriptions, as stage.part does. */
  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T {
    this.stage.part(name, item as unknown as Handle, options);
    return item;
  }

  /** Stage units for a size given at the default scale. */
  private u(n: number): number {
    return (n * this.scale) / DEFAULT_SCALE;
  }

  // -------------------------------------------------------------------------
  // Atoms
  // -------------------------------------------------------------------------

  private element(symbol: unknown): string {
    if (typeof symbol !== 'string' || !ELEMENTS.has(symbol)) fail(`chemistry: "${String(symbol)}" is not an element this kit knows; write its symbol, such as O or Na`);
    return symbol;
  }

  private makeAtom(symbol: string, x: number, y: number, parent: Handle, options: AtomOptions = {}): AtomRecord {
    if (this.atoms.length >= MAX_ATOMS) fail(`chemistry: a stage draws at most ${MAX_ATOMS} atoms`);
    const data = ELEMENTS.get(symbol)!;
    const tone = checkTone(options.tone, `the ${data.name} atom`) ?? elementTone(symbol);
    const r = options.r === undefined ? this.u(9 + 10 * data.radius) : finite(options.r, 'an atom’s r');
    if (!(r > 0 && r <= 200)) fail('chemistry: an atom’s r is from 0 to 200 stage units');
    const group = this.stage.group({ parent });
    const balls = this.look === 'balls';
    const ball = this.stage.circle(0, 0, balls ? r : this.u(11), { parent: group, tone, fill: true, ...(balls ? { shade: 'sphere' as const } : {}) });
    // Written symbols keep a ball the pointer can find, but draw nothing of it.
    if (!balls) ball.set({ opacity: 0 });
    const size = balls ? r * (symbol.length > 1 ? 0.78 : 0.95) : this.u(17);
    const label = this.stage.text(0, 0, symbol, { parent: group, tone: balls ? labelTone(tone) : symbol === 'C' || symbol === 'H' ? 'hi' : tone });
    label.set({ 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Number(size.toFixed(2)) });
    const record: AtomRecord = {
      element: symbol,
      x,
      y,
      r: balls ? r : this.u(11),
      tone,
      group,
      ball,
      label,
      charge: 0,
      chargeText: null,
      partial: null,
      partialText: null,
      pairs: 0,
      dots: [],
      bonds: [],
      visible: true,
      stale: true,
      facade: null,
    };
    group.at(x, y);
    this.atoms.push(record);
    if (options.charge !== undefined) this.setCharge(record, options.charge);
    return record;
  }

  private setCharge(record: AtomRecord, value: unknown): void {
    const q = finite(value, 'a charge');
    if (!Number.isInteger(q) || Math.abs(q) > 4) fail('chemistry: a charge is a whole number from -4 to 4');
    record.charge = q;
    if (q === 0 && !record.chargeText) return;
    if (!record.chargeText) {
      record.chargeText = this.stage.text(record.r * 0.78, -record.r * 0.78, '', { parent: record.group, tone: 'hi' });
      record.chargeText.set({ 'text-anchor': 'start', 'dominant-baseline': 'central', 'font-size': Number(this.u(13).toFixed(2)) });
    }
    record.chargeText.text(chargeText(q));
  }

  private setPartial(record: AtomRecord, sign: unknown): void {
    if (sign !== null && sign !== '+' && sign !== '-') fail("chemistry: a partial charge is '+', '-' or null");
    record.partial = sign;
    record.stale = true;
    if (sign === null) {
      record.partialText?.hide();
      return;
    }
    if (!record.partialText) {
      record.partialText = this.stage.text(0, 0, '', { parent: record.group });
      record.partialText.set({ 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Number(this.u(12).toFixed(2)) });
    }
    record.partialText.text(sign === '+' ? 'δ+' : 'δ−').tone(sign === '+' ? 'b' : 'a').show();
  }

  private moveAtom(record: AtomRecord, x: number, y: number): void {
    if (record.x === x && record.y === y) return;
    record.x = x;
    record.y = y;
    record.group.at(x, y);
    record.stale = true;
    for (const bond of record.bonds) {
      bond.stale = true;
      (bond.a === record ? bond.b : bond.a).stale = true;
    }
  }

  private atomFacade(record: AtomRecord, draggable: boolean): Atom {
    if (record.facade) return record.facade;
    const facade: Atom = {
      element: record.element,
      get x() {
        return record.x;
      },
      get y() {
        return record.y;
      },
      at: (x: number, y: number) => {
        this.moveAtom(record, finite(x, 'x'), finite(y, 'y'));
        return facade;
      },
      charge: (value: number) => {
        this.setCharge(record, value);
        return facade;
      },
      partial: (sign: '+' | '-' | null) => {
        this.setPartial(record, sign);
        return facade;
      },
      tone: (name: Tone) => {
        const tone = checkTone(name, 'an atom')!;
        record.tone = tone;
        record.ball.tone(tone);
        record.label.tone(this.look === 'balls' ? labelTone(tone) : tone);
        return facade;
      },
      show: (visible = true) => {
        record.visible = visible;
        record.group.show(visible);
        for (const bond of record.bonds) bond.stale = true;
        return facade;
      },
      hide: () => facade.show(false),
      handle: record.group,
    };
    record.facade = Object.freeze(facade);
    if (draggable) {
      this.ctx.addDrag(nodeOf(record.group), `the ${ELEMENTS.get(record.element)!.name} atom`, (p: DragInfo) => {
        this.moveAtom(record, this.clampX(p.x), this.clampY(p.y));
      });
    }
    return record.facade;
  }

  private clampX(x: number): number {
    return Math.min(this.viewBox[0] + this.viewBox[2], Math.max(this.viewBox[0], x));
  }

  private clampY(y: number): number {
    return Math.min(this.viewBox[1] + this.viewBox[3], Math.max(this.viewBox[1], y));
  }

  atom(element: string, x: number, y: number, options: AtomOptions = {}): Atom {
    const symbol = this.element(element);
    const record = this.makeAtom(symbol, finite(x, 'x'), finite(y, 'y'), this.looseAtoms, options);
    const facade = this.atomFacade(record, options.draggable === true);
    this.flush();
    return facade;
  }

  // -------------------------------------------------------------------------
  // Bonds
  // -------------------------------------------------------------------------

  private makeBond(a: AtomRecord, b: AtomRecord, order: BondOrder, kind: BondKind, parent: Handle, tone?: Tone): BondRecord {
    if (this.bonds.length >= MAX_BONDS) fail(`chemistry: a stage draws at most ${MAX_BONDS} bonds`);
    if (a === b) fail('chemistry: a bond joins two different atoms');
    const record: BondRecord = { a, b, order, kind, strength: 1, tone, group: this.stage.group({ parent }), bars: [], lines: [], visible: true, stale: true, facade: null };
    a.bonds.push(record);
    b.bonds.push(record);
    a.stale = true;
    b.stale = true;
    this.bonds.push(record);
    return record;
  }

  private recordOf(atom: unknown): AtomRecord {
    const record = this.atoms.find((r) => r.facade === atom);
    if (!record) fail('chemistry: a bond joins atoms this stage drew, from chem.atom or a molecule');
    return record;
  }

  private bondFacade(record: BondRecord): Bond {
    if (record.facade) return record.facade;
    const facade: Bond = {
      a: this.atomFacade(record.a, false),
      b: this.atomFacade(record.b, false),
      order: (value: 1 | 1.5 | 2 | 3) => {
        if (!ORDERS.has(value)) fail('chemistry: a bond order is 1, 1.5, 2 or 3');
        if (record.order !== value) {
          record.order = value;
          record.stale = true;
          record.a.stale = true;
          record.b.stale = true;
        }
        return facade;
      },
      strength: (value: number) => {
        const s = Math.min(1, Math.max(0, finite(value, 'a bond’s strength')));
        if (s !== record.strength) {
          record.strength = s;
          record.stale = true;
        }
        return facade;
      },
      tone: (name: Tone) => {
        record.tone = checkTone(name, 'a bond');
        record.stale = true;
        return facade;
      },
      show: (visible = true) => {
        record.visible = visible;
        record.stale = true;
        return facade;
      },
      hide: () => facade.show(false),
      handle: record.group,
    };
    record.facade = Object.freeze(facade);
    return record.facade;
  }

  bond(a: Atom, b: Atom, options: BondOptions = {}): Bond {
    const order = options.order ?? 1;
    if (!ORDERS.has(order)) fail('chemistry: a bond order is 1, 1.5, 2 or 3');
    const kind = options.kind ?? 'covalent';
    if (kind !== 'covalent' && kind !== 'ionic' && kind !== 'hydrogen') fail(`chemistry: a bond's kind is 'covalent', 'ionic' or 'hydrogen', not "${String(kind)}"`);
    const record = this.makeBond(this.recordOf(a), this.recordOf(b), order as BondOrder, kind, this.looseBonds, checkTone(options.tone, 'a bond'));
    const facade = this.bondFacade(record);
    this.flush();
    return facade;
  }

  /** Draws a bond between where its atoms are now. */
  private drawBond(bond: BondRecord): void {
    bond.stale = false;
    const { a, b } = bond;
    const shown = bond.visible && a.visible && b.visible && bond.strength > 0.02 && bond.kind !== 'ionic';
    bond.group.show(shown);
    if (!shown) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) {
      bond.group.hide();
      return;
    }
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const balls = this.look === 'balls';
    // Written symbols leave a gap around each letter; balls hide the stick ends; a hydrogen bond runs between the surfaces.
    const trim = (atom: AtomRecord) => (bond.kind === 'hydrogen' ? atom.r + this.u(2) : balls ? atom.r * 0.5 : this.u(atom.element.length > 1 ? 12 : 9));
    const trimA = trim(a);
    const trimB = trim(b);
    if (length <= trimA + trimB) {
      bond.group.hide();
      return;
    }
    const x1 = a.x + ux * trimA;
    const y1 = a.y + uy * trimA;
    const x2 = b.x - ux * trimB;
    const y2 = b.y - uy * trimB;
    const strokes: Array<{ offset: number; dashed: boolean }> = [];
    if (bond.kind === 'hydrogen') strokes.push({ offset: 0, dashed: true });
    else {
      const gap = this.u(balls ? 5 : 4);
      if (bond.order === 1) strokes.push({ offset: 0, dashed: false });
      else if (bond.order === 1.5) strokes.push({ offset: -gap / 2, dashed: false }, { offset: gap / 2, dashed: true });
      else if (bond.order === 2) strokes.push({ offset: -gap / 2, dashed: false }, { offset: gap / 2, dashed: false });
      else strokes.push({ offset: -gap, dashed: false }, { offset: 0, dashed: false }, { offset: gap, dashed: false });
    }
    const weight = 0.35 + 0.65 * bond.strength;
    const width = this.u(3.6) * weight * (bond.order === 3 ? 0.8 : 1);
    const tone = bond.tone ?? (bond.kind === 'hydrogen' ? 'b' : balls ? 'mid' : 'hi');
    let bars = 0;
    let lines = 0;
    for (const stroke of strokes) {
      const ox = nx * stroke.offset;
      const oy = ny * stroke.offset;
      if (balls && !stroke.dashed) {
        // A filled bar, so its width scales with the stage like the balls.
        let bar = bond.bars[bars];
        if (!bar) {
          bar = this.stage.path('', { parent: bond.group, fill: true });
          bond.bars.push(bar);
        }
        bars++;
        const hx = nx * (width / 2);
        const hy = ny * (width / 2);
        bar.d(`M${fmt(x1 + ox + hx)} ${fmt(y1 + oy + hy)}L${fmt(x2 + ox + hx)} ${fmt(y2 + oy + hy)}L${fmt(x2 + ox - hx)} ${fmt(y2 + oy - hy)}L${fmt(x1 + ox - hx)} ${fmt(y1 + oy - hy)}Z`).tone(tone).show();
        continue;
      }
      let line = bond.lines[lines];
      if (!line) {
        line = this.stage.path('', { parent: bond.group });
        bond.lines.push(line);
      }
      lines++;
      line
        .d(`M${fmt(x1 + ox)} ${fmt(y1 + oy)}L${fmt(x2 + ox)} ${fmt(y2 + oy)}`)
        .set({
          'stroke-dasharray': stroke.dashed ? (bond.kind === 'hydrogen' ? '1 5' : '4 4') : 'none',
          'stroke-linecap': 'round',
          'stroke-width': Number((2 * weight).toFixed(2)),
        })
        .tone(tone)
        .show();
    }
    for (let k = bars; k < bond.bars.length; k++) bond.bars[k]!.hide();
    for (let k = lines; k < bond.lines.length; k++) bond.lines[k]!.hide();
    bond.group.set({ opacity: Number(Math.min(1, 0.15 + bond.strength).toFixed(2)) });
  }

  /** Places an atom's lone pairs and partial charge away from its bonds. */
  private dressAtom(atom: AtomRecord): void {
    atom.stale = false;
    const directions = atom.bonds
      .filter((bond) => bond.kind === 'covalent' && bond.visible && bond.strength > 0.5)
      .map((bond) => {
        const other = bond.a === atom ? bond.b : bond.a;
        return Math.atan2(other.y - atom.y, other.x - atom.x);
      })
      .filter((angle) => Number.isFinite(angle))
      .sort((p, q) => p - q);
    const pairAngles = spread(directions, atom.pairs);
    const distance = this.look === 'balls' ? atom.r + this.u(5) : this.u(12);
    const half = this.u(2.8);
    pairAngles.forEach((angle, k) => {
      const cx = Math.cos(angle) * distance;
      const cy = Math.sin(angle) * distance;
      const px = -Math.sin(angle) * half;
      const py = Math.cos(angle) * half;
      for (const [i, sign] of [[2 * k, 1], [2 * k + 1, -1]] as const) {
        let dot = atom.dots[i];
        if (!dot) {
          dot = this.stage.circle(0, 0, this.u(2), { parent: atom.group, tone: 'hi' });
          atom.dots.push(dot);
        }
        dot.set({ cx: Number((cx + px * sign).toFixed(2)), cy: Number((cy + py * sign).toFixed(2)) }).show();
      }
    });
    for (let i = pairAngles.length * 2; i < atom.dots.length; i++) atom.dots[i]!.hide();
    if (atom.partialText && atom.partial) {
      // Opposite the bonds' average direction, or above a lone atom.
      let sx = 0;
      let sy = 0;
      for (const angle of directions) {
        sx += Math.cos(angle);
        sy += Math.sin(angle);
      }
      const away = directions.length === 0 || Math.hypot(sx, sy) < 1e-6 ? -Math.PI / 2 : Math.atan2(-sy, -sx);
      const reach = atom.r + this.u(atom.pairs > 0 ? 16 : 10);
      atom.partialText.set({ x: Number((Math.cos(away) * reach).toFixed(2)), y: Number((Math.sin(away) * reach).toFixed(2)) });
    }
  }

  /** Redraws what moved since the last frame. */
  private flush(): void {
    for (const bond of this.bonds) if (bond.stale) this.drawBond(bond);
    for (const atom of this.atoms) if (atom.stale) this.dressAtom(atom);
    for (const redraw of this.redraws) redraw();
  }

  // -------------------------------------------------------------------------
  // Molecules
  // -------------------------------------------------------------------------

  private structure(formula: unknown, extra?: Readonly<Record<string, MoleculeStructure>>): { structure: Structure; name: string } {
    if (typeof formula === 'string') {
      const own = extra?.[formula] ?? extra?.[parseFormula(formula).core];
      if (own) return { structure: structureFrom(own), name: formula };
      const structure = structureOf(formula);
      if (!structure) {
        fail(
          `chemistry: the kit has no structure for ${formula}; give it as { atoms: [['C', 0, 0], ['O', 1.2, 0]], bonds: [[0, 1, 2]] } in ångströms. Formulas it knows include ${LIBRARY_FORMULAS.slice(0, 24).join(', ')}, single atoms and ions, metal salts such as NaCl and MgO, and a centre with atoms around it such as CCl4 or SF6`,
        );
      }
      return { structure, name: formula };
    }
    return { structure: structureFrom(formula as MoleculeStructure), name: 'molecule' };
  }

  /** Builds a structure's atoms and bonds into `parent`, centred on (cx, cy). */
  private build(structure: Structure, cx: number, cy: number, angle: number, parent: Handle, options: { readonly pairs?: boolean; readonly polar?: boolean; readonly charges?: boolean } = {}) {
    const bondLayer = this.stage.group({ parent });
    const atomLayer = this.stage.group({ parent });
    const cos = Math.cos((angle * Math.PI) / 180);
    const sin = Math.sin((angle * Math.PI) / 180);
    const place = (x: number, y: number): Vec2 => [cx + (x * cos - y * sin) * this.scale, cy + (x * sin + y * cos) * this.scale];
    const atoms = structure.atoms.map((atom) => {
      const [x, y] = place(atom.x, atom.y);
      const record = this.makeAtom(atom.element, x, y, atomLayer);
      if (atom.charge !== 0 && options.charges !== false) this.setCharge(record, atom.charge);
      return record;
    });
    const bonds = structure.bonds.map((bond) => this.makeBond(atoms[bond.a]!, atoms[bond.b]!, bond.order, bond.kind, bondLayer));
    if (options.pairs) {
      lonePairs(structure).forEach((n, k) => {
        atoms[k]!.pairs = n ?? 0;
      });
    }
    if (options.polar) {
      const lean = atoms.map(() => 0);
      for (const bond of structure.bonds) {
        if (bond.kind !== 'covalent') continue;
        const ea = ELEMENTS.get(structure.atoms[bond.a]!.element)!.en;
        const eb = ELEMENTS.get(structure.atoms[bond.b]!.element)!.en;
        const difference = eb - ea;
        if (Math.abs(difference) < 0.4) continue;
        lean[bond.a]! += difference;
        lean[bond.b]! -= difference;
      }
      lean.forEach((v, k) => {
        if (Math.abs(v) >= 0.4) this.setPartial(atoms[k]!, v > 0 ? '+' : '-');
      });
    }
    return { atoms, bonds };
  }

  molecule(formula: string | MoleculeStructure, options: MoleculeOptions = {}): Molecule {
    const { structure, name } = this.structure(formula);
    const [cx, cy] = options.at === undefined ? [this.viewBox[0] + this.viewBox[2] / 2, this.viewBox[1] + this.viewBox[3] / 2] : checkPoint(options.at, 'a molecule’s at');
    let angle = options.angle === undefined ? 0 : finite(options.angle, 'a molecule’s angle');
    const group = this.stage.group();
    const built = this.build(structure, cx, cy, angle, group, { pairs: options.lonePairs === true, polar: options.polar === true });
    let x = cx;
    let y = cy;
    const layout = () => {
      const cos = Math.cos((angle * Math.PI) / 180);
      const sin = Math.sin((angle * Math.PI) / 180);
      structure.atoms.forEach((atom, k) => {
        this.moveAtom(built.atoms[k]!, x + (atom.x * cos - atom.y * sin) * this.scale, y + (atom.x * sin + atom.y * cos) * this.scale);
      });
    };
    // A polyatomic ion in square brackets, with its charge at the top right, as [SO₄]²⁻ is written.
    const ion = structure.charge !== 0 && structure.atoms.length > 1;
    const ionBrackets = ion ? this.stage.path('', { parent: group, tone: 'hi' }) : null;
    const ionText = ion ? this.stage.text(0, 0, chargeText(structure.charge), { parent: group, tone: 'hi' }) : null;
    ionText?.set({ 'text-anchor': 'start', 'dominant-baseline': 'central', 'font-size': Number(this.u(15).toFixed(2)) });
    const placeIon = () => {
      if (!ionText || !ionBrackets) return;
      const room = this.u(options.lonePairs ? 10 : 5);
      const left = Math.min(...built.atoms.map((a) => a.x - a.r)) - room;
      const right = Math.max(...built.atoms.map((a) => a.x + a.r)) + room;
      const top = Math.min(...built.atoms.map((a) => a.y - a.r)) - room;
      const bottom = Math.max(...built.atoms.map((a) => a.y + a.r)) + room;
      const lip = this.u(6);
      ionBrackets.d(
        `M${fmt(left + lip)} ${fmt(top)}L${fmt(left)} ${fmt(top)}L${fmt(left)} ${fmt(bottom)}L${fmt(left + lip)} ${fmt(bottom)}` +
          `M${fmt(right - lip)} ${fmt(top)}L${fmt(right)} ${fmt(top)}L${fmt(right)} ${fmt(bottom)}L${fmt(right - lip)} ${fmt(bottom)}`,
      );
      ionText.set({ x: Number((right + this.u(3)).toFixed(2)), y: Number(top.toFixed(2)) });
    };
    placeIon();
    const atoms = Object.freeze(built.atoms.map((record) => this.atomFacade(record, false)));
    const bonds = Object.freeze(built.bonds.map((record) => this.bondFacade(record)));
    const facade: Molecule = {
      formula: name,
      atoms,
      bonds,
      get x() {
        return x;
      },
      get y() {
        return y;
      },
      get angle() {
        return angle;
      },
      at: (nx: number, ny: number) => {
        x = finite(nx, 'x');
        y = finite(ny, 'y');
        layout();
        placeIon();
        this.flush();
        return facade;
      },
      rotate: (degrees: number) => {
        angle = finite(degrees, 'an angle');
        layout();
        placeIon();
        this.flush();
        return facade;
      },
      show: (visible = true) => {
        group.show(visible);
        return facade;
      },
      hide: () => facade.show(false),
      handle: group,
    };
    Object.freeze(facade);
    if (options.draggable) {
      let origin: Vec2 | null = null;
      this.ctx.addDrag(
        nodeOf(group),
        `the ${name} molecule`,
        (p: DragInfo) => {
          origin ??= [x, y];
          facade.at(this.clampX(origin[0] + p.dx), this.clampY(origin[1] + p.dy));
        },
        undefined,
        () => {
          origin = null;
        },
      );
    }
    this.flush();
    return facade;
  }

  // -------------------------------------------------------------------------
  // Electron shells
  // -------------------------------------------------------------------------

  shells(element: string, x: number, y: number, options: ShellOptions = {}): Shells {
    if (this.shellModels >= MAX_SHELL_MODELS) fail(`chemistry: a stage draws at most ${MAX_SHELL_MODELS} shell models`);
    this.shellModels++;
    const symbol = this.element(element);
    const data = ELEMENTS.get(symbol)!;
    const tone = checkTone(options.tone, 'electrons') ?? 'b';
    const mark = options.mark ?? 'dot';
    if (mark !== 'dot' && mark !== 'cross') fail("chemistry: mark is 'dot' or 'cross'");
    const nucleus = this.u(13);
    const first = options.r === undefined ? nucleus + this.u(14) : finite(options.r, 'the first shell’s r');
    const gap = options.gap === undefined ? this.u(16) : finite(options.gap, 'the gap between shells');
    if (!(first > 0 && gap > 0)) fail('chemistry: shell sizes must be positive');
    const spin = options.spin === undefined ? 0 : finite(options.spin, 'spin');
    let cx = finite(x, 'x');
    let cy = finite(y, 'y');
    const check = (list: unknown): number[] => {
      if (!Array.isArray(list) || list.length === 0 || list.length > 7) fail('chemistry: electrons are a list of 1 to 7 shells, innermost first');
      const out = list.map((n) => {
        if (!Number.isInteger(n) || n < 0 || n > 32) fail('chemistry: a shell holds a whole number of electrons from 0 to 32');
        return n as number;
      });
      const total = out.reduce((sum, n) => sum + n, 0);
      if (total > data.z + 4) fail(`chemistry: ${data.name} has ${data.z} protons and cannot hold ${total} electrons`);
      return out;
    };
    let electrons = options.electrons === undefined ? groundShells(data.z, symbol) : check(options.electrons);
    const group = this.stage.group();
    const rings: Handle[] = [];
    const marks: Handle[] = [];
    this.stage.circle(0, 0, nucleus, { parent: group, tone: 'lit', fill: true, shade: 'sphere' });
    const coreLabel = this.stage.text(0, 0, symbol, { parent: group, tone: 'faint' });
    coreLabel.set({ 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Number(this.u(symbol.length > 1 ? 10 : 12).toFixed(2)) });
    const brackets = this.stage.path('', { parent: group, tone: 'hi' });
    const ionLabel = this.stage.text(0, 0, '', { parent: group, tone: 'hi' });
    ionLabel.set({ 'text-anchor': 'start', 'dominant-baseline': 'central', 'font-size': Number(this.u(15).toFixed(2)) });
    const radius = (k: number) => first + gap * k;
    const markSize = this.u(3.4);
    let turned = Number.NaN;
    const draw = () => {
      const turn = spin !== 0 && !this.ctx.reducedMotion() ? this.ctx.time() * spin * 2 * Math.PI : 0;
      electrons.forEach((n, k) => {
        let ring = rings[k];
        if (!ring) {
          ring = this.stage.circle(0, 0, radius(k), { parent: group, tone: 'faint', fill: false });
          rings.push(ring);
        }
        ring.set({ r: Number(radius(k).toFixed(2)) }).show();
      });
      for (let k = electrons.length; k < rings.length; k++) rings[k]!.hide();
      let used = 0;
      electrons.forEach((n, k) => {
        // Alternate shells turn opposite ways, so the picture reads as shells, not as a wheel.
        const offset = -Math.PI / 2 + (k % 2 === 0 ? turn : -turn) / (k + 1);
        for (let i = 0; i < n; i++) {
          const angle = offset + (2 * Math.PI * i) / n;
          const ex = Math.cos(angle) * radius(k);
          const ey = Math.sin(angle) * radius(k);
          let m = marks[used];
          if (!m) {
            m = mark === 'dot' ? this.stage.circle(0, 0, markSize, { parent: group, tone }) : this.stage.path('', { parent: group, tone });
            marks.push(m);
          }
          if (mark === 'dot') m.set({ cx: Number(ex.toFixed(2)), cy: Number(ey.toFixed(2)) });
          else {
            const h = markSize;
            (m as PathHandle).d(`M${fmt(ex - h)} ${fmt(ey - h)}L${fmt(ex + h)} ${fmt(ey + h)}M${fmt(ex - h)} ${fmt(ey + h)}L${fmt(ex + h)} ${fmt(ey - h)}`);
          }
          m.show();
          used++;
        }
      });
      for (let i = used; i < marks.length; i++) marks[i]!.hide();
      const charge = data.z - electrons.reduce((sum, n) => sum + n, 0);
      if (charge === 0) {
        brackets.hide();
        ionLabel.hide();
      } else {
        // An ion in square brackets with its charge outside, as in a dot-and-cross diagram.
        const outer = radius(Math.max(0, electrons.length - 1)) + this.u(8);
        const lip = this.u(6);
        brackets
          .d(
            `M${fmt(-outer + lip)} ${fmt(-outer)}L${fmt(-outer)} ${fmt(-outer)}L${fmt(-outer)} ${fmt(outer)}L${fmt(-outer + lip)} ${fmt(outer)}` +
              `M${fmt(outer - lip)} ${fmt(-outer)}L${fmt(outer)} ${fmt(-outer)}L${fmt(outer)} ${fmt(outer)}L${fmt(outer - lip)} ${fmt(outer)}`,
          )
          .show();
        ionLabel.set({ x: Number((outer + this.u(3)).toFixed(2)), y: Number((-outer).toFixed(2)) }).text(chargeText(charge)).show();
      }
    };
    group.at(cx, cy);
    draw();
    if (spin !== 0) {
      this.ctx.markTimeUse();
      this.redraws.push(() => {
        const now = this.ctx.time();
        if (now === turned) return;
        turned = now;
        draw();
      });
    }
    const facade: Shells = {
      element: symbol,
      protons: data.z,
      get electrons() {
        return Object.freeze([...electrons]);
      },
      get charge() {
        return data.z - electrons.reduce((sum, n) => sum + n, 0);
      },
      setElectrons: (perShell: readonly number[]) => {
        electrons = check(perShell);
        draw();
        return facade;
      },
      electron: (shell: number, index: number): Vec2 => {
        if (!Number.isInteger(shell) || shell < 0 || shell >= electrons.length) fail(`chemistry: shell ${String(shell)} does not exist; shells count from 0`);
        const n = electrons[shell]!;
        if (!Number.isInteger(index) || index < 0 || index >= n) fail(`chemistry: shell ${shell} holds ${n} electrons, counted from 0`);
        const turn = spin !== 0 && !this.ctx.reducedMotion() ? this.ctx.time() * spin * 2 * Math.PI : 0;
        const angle = -Math.PI / 2 + (shell % 2 === 0 ? turn : -turn) / (shell + 1) + (2 * Math.PI * index) / n;
        return [cx + Math.cos(angle) * radius(shell), cy + Math.sin(angle) * radius(shell)];
      },
      at: (nx: number, ny: number) => {
        cx = finite(nx, 'x');
        cy = finite(ny, 'y');
        group.at(cx, cy);
        return facade;
      },
      show: (visible = true) => {
        group.show(visible);
        return facade;
      },
      hide: () => facade.show(false),
      handle: group,
    };
    return Object.freeze(facade);
  }

  // -------------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------------

  reaction(equation: string, options: ReactionOptions = {}): Reaction {
    if (typeof equation !== 'string' || equation.length > 200) fail('chemistry: a reaction is an equation of up to 200 characters, such as 2H2 + O2 -> 2H2O');
    const sides = equation.split(/\s*(?:->|→|<=>|⇌|<->|=)\s*/);
    if (sides.length !== 2 || !sides[0]!.trim() || !sides[1]!.trim()) fail(`chemistry: "${equation}" needs reactants, one arrow (->) and products, such as 2H2 + O2 -> 2H2O`);
    const box = options.box === undefined ? ([this.viewBox[0] + this.u(10), this.viewBox[1] + this.u(10), this.viewBox[2] - this.u(20), this.viewBox[3] - this.u(20)] as ViewBox) : checkBox(options.box, 'a reaction’s box');
    const showEquation = options.equation !== false;
    const species = (side: string) =>
      side
        .split(/\s+\+\s+|\+(?=\s*\d*\s*[A-Z(])/)
        .map((part) => part.trim())
        .filter(Boolean)
        .flatMap((part) => {
          const match = /^(\d+)\s*(.+)$/.exec(part);
          const count = match ? Number(match[1]) : 1;
          if (!(count >= 1 && count <= 12)) fail(`chemistry: the coefficient in "${part}" must be from 1 to 12`);
          const formula = (match ? match[2]! : part).trim();
          const { structure } = this.structure(formula, options.structures);
          return Array.from({ length: count }, () => structure);
        });
    const left = species(sides[0]!);
    const right = species(sides[1]!);
    // Atoms are conserved: the same atoms of each element on both sides.
    const tally = (list: readonly Structure[]) => {
      const counts = new Map<string, number>();
      for (const s of list) for (const atom of s.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
      return counts;
    };
    const before = tally(left);
    const after = tally(right);
    for (const element of new Set([...before.keys(), ...after.keys()])) {
      const l = before.get(element) ?? 0;
      const r = after.get(element) ?? 0;
      if (l !== r) fail(`chemistry: "${equation}" is not balanced: ${l} ${element} on the left, ${r} on the right`);
    }
    const textRoom = showEquation ? this.u(34) : 0;
    const area: ViewBox = [box[0], box[1], box[2], box[3] - textRoom];
    const leftSpots = this.arrange(left, area);
    const rightSpots = this.arrange(right, area);
    const group = this.stage.group();
    const bondLayer = this.stage.group({ parent: group });
    const atomLayer = this.stage.group({ parent: group });
    // Each atom of the reactants, and where it ends up among the products.
    const starts: Array<{ element: string; x: number; y: number; charge: number }> = [];
    left.forEach((s, i) => {
      for (const atom of s.atoms) starts.push({ element: atom.element, x: leftSpots[i]![0] + atom.x * this.scale, y: leftSpots[i]![1] + atom.y * this.scale, charge: atom.charge });
    });
    const ends: Array<{ element: string; x: number; y: number; charge: number }> = [];
    right.forEach((s, i) => {
      for (const atom of s.atoms) ends.push({ element: atom.element, x: rightSpots[i]![0] + atom.x * this.scale, y: rightSpots[i]![1] + atom.y * this.scale, charge: atom.charge });
    });
    const endOf = matchAtoms(starts, ends);
    const atoms = starts.map((start) => {
      const record = this.makeAtom(start.element, start.x, start.y, atomLayer);
      if (start.charge !== 0) this.setCharge(record, start.charge);
      return record;
    });
    const atomAt = new Map<number, AtomRecord>();
    endOf.forEach((end, k) => atomAt.set(end, atoms[k]!));
    let offset = 0;
    const leftBonds: BondRecord[] = [];
    left.forEach((s) => {
      for (const bond of s.bonds) leftBonds.push(this.makeBond(atoms[offset + bond.a]!, atoms[offset + bond.b]!, bond.order, bond.kind, bondLayer));
      offset += s.atoms.length;
    });
    offset = 0;
    const rightBonds: BondRecord[] = [];
    right.forEach((s) => {
      for (const bond of s.bonds) rightBonds.push(this.makeBond(atomAt.get(offset + bond.a)!, atomAt.get(offset + bond.b)!, bond.order, bond.kind, bondLayer));
      offset += s.atoms.length;
    });
    const label = showEquation ? this.stage.text(box[0] + box[2] / 2, box[1] + box[3] - this.u(12), chem(equation), { parent: group }) : null;
    label?.set({ 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Number(this.u(17).toFixed(2)) });
    // Every bond in the reactants is broken and every bond in the products made, as the bond-energy method counts them.
    const names = (list: readonly Structure[]) => list.flatMap((s) => s.bonds.filter((b) => b.kind === 'covalent').map((b) => bondName(s.atoms[b.a]!.element, s.atoms[b.b]!.element, b.order)));
    const sum = (list: readonly Structure[]): number | null => {
      let total = 0;
      for (const s of list) {
        for (const b of s.bonds) {
          if (b.kind !== 'covalent') return null;
          const value = bondEnthalpy(s.atoms[b.a]!.element, s.atoms[b.b]!.element, b.order);
          if (value === null) return null;
          total += value;
        }
      }
      return total;
    };
    const brokenEnergy = sum(left);
    const formedEnergy = sum(right);
    const energy: ReactionEnergy | null =
      brokenEnergy === null || formedEnergy === null ? null : Object.freeze({ broken: brokenEnergy, formed: formedEnergy, change: brokenEnergy - formedEnergy });
    let progress = Number.NaN;
    const set = (value: number) => {
      const p = Math.min(1, Math.max(0, finite(value, 'a reaction’s progress')));
      if (p === progress) return;
      progress = p;
      const fade = 1 - smooth((p - 0.05) / 0.3);
      const move = smooth((p - 0.25) / 0.5);
      const form = smooth((p - 0.65) / 0.3);
      for (const bond of leftBonds) {
        bond.strength = fade;
        bond.stale = true;
      }
      for (const bond of rightBonds) {
        bond.strength = form;
        bond.stale = true;
      }
      // On the way, the freed atoms spread out from the middle of the box, so none passes through another.
      const spreadOut = this.u(34) * Math.sin(Math.PI * move);
      const midX = box[0] + box[2] / 2;
      const midY = area[1] + area[3] / 2;
      starts.forEach((start, k) => {
        const end = ends[endOf[k]!]!;
        const atom = atoms[k]!;
        const x = start.x + (end.x - start.x) * move;
        const y = start.y + (end.y - start.y) * move;
        const away = Math.hypot(x - midX, y - midY);
        const push = away > 1e-6 ? spreadOut / away : 0;
        const keepX = (v: number) => Math.min(box[0] + box[2] - atom.r, Math.max(box[0] + atom.r, v));
        const keepY = (v: number) => Math.min(area[1] + area[3] - atom.r, Math.max(area[1] + atom.r, v));
        this.moveAtom(atom, push === 0 ? x : keepX(x + (x - midX) * push), push === 0 ? y : keepY(y + (y - midY) * push));
        const charge = p < 0.5 ? start.charge : end.charge;
        if (charge !== atom.charge) this.setCharge(atom, charge);
      });
      for (const atom of atoms) atom.stale = true;
    };
    set(0);
    this.flush();
    const facade: Reaction = {
      progress: (value: number) => {
        set(value);
        this.flush();
        return facade;
      },
      broken: Object.freeze(names(left)),
      formed: Object.freeze(names(right)),
      energy,
      atoms: Object.freeze(atoms.map((record) => this.atomFacade(record, false))),
      handle: group,
    };
    return Object.freeze(facade);
  }

  /** Centres for molecules laid out in rows across a box, each as wide as it needs. */
  private arrange(list: readonly Structure[], box: ViewBox): Vec2[] {
    const gap = this.u(22);
    const sizes = list.map((s) => {
      let w = 0;
      let h = 0;
      for (const atom of s.atoms) {
        const r = this.u(9 + 10 * ELEMENTS.get(atom.element)!.radius);
        w = Math.max(w, Math.abs(atom.x) * this.scale + r);
        h = Math.max(h, Math.abs(atom.y) * this.scale + r);
      }
      return [w * 2, h * 2] as const;
    });
    const rows: number[][] = [[]];
    let width = 0;
    sizes.forEach(([w], k) => {
      const row = rows[rows.length - 1]!;
      if (row.length > 0 && width + gap + w > box[2]) {
        rows.push([k]);
        width = w;
      } else {
        row.push(k);
        width += (row.length > 1 ? gap : 0) + w;
      }
    });
    const heights = rows.map((row) => Math.max(...row.map((k) => sizes[k]![1])));
    const total = heights.reduce((s, h) => s + h, 0) + gap * (rows.length - 1);
    if (total > box[3] || rows.some((row) => row.reduce((s, k) => s + sizes[k]![0], 0) + gap * (row.length - 1) > box[2])) {
      this.ctx.warn(`chemistry: the reaction does not fit its box of ${Math.round(box[2])} by ${Math.round(box[3])}; give it a bigger box or a smaller scale`);
    }
    const spots: Vec2[] = [];
    let y = box[1] + (box[3] - total) / 2;
    rows.forEach((row, r) => {
      const rowWidth = row.reduce((s, k) => s + sizes[k]![0], 0) + gap * (row.length - 1);
      let x = box[0] + (box[2] - rowWidth) / 2;
      for (const k of row) {
        spots[k] = [x + sizes[k]![0] / 2, y + heights[r]! / 2];
        x += sizes[k]![0] + gap;
      }
      y += heights[r]! + gap;
    });
    return spots;
  }

  // -------------------------------------------------------------------------
  // Energy profiles
  // -------------------------------------------------------------------------

  profile(options: ProfileOptions): Profile {
    if (this.profiles >= MAX_PROFILES) fail(`chemistry: a stage draws at most ${MAX_PROFILES} energy profiles`);
    this.profiles++;
    if (typeof options !== 'object' || options === null) fail('chemistry: profile needs { reactants, peak, products }');
    let reactants = finite(options.reactants, 'the reactants’ energy');
    let peak = finite(options.peak, 'the peak energy');
    let products = finite(options.products, 'the products’ energy');
    let catalysed: number | null = options.catalysed === undefined ? null : finite(options.catalysed, 'the catalysed peak');
    const unit = options.unit ?? 'kJ/mol';
    if (typeof unit !== 'string' || unit.length > 16) fail('chemistry: a profile’s unit is short text, such as kJ/mol');
    const names = options.names ?? ['reactants', 'products'];
    if (!Array.isArray(names) || names.length !== 2 || names.some((n) => typeof n !== 'string' || n.length > 40)) fail('chemistry: names is two short labels, for the reactants and the products');
    const labels = options.labels !== false;
    const box = options.box === undefined ? ([this.viewBox[0] + this.u(8), this.viewBox[1] + this.u(8), this.viewBox[2] - this.u(16), this.viewBox[3] - this.u(16)] as ViewBox) : checkBox(options.box, 'a profile’s box');
    const checkShape = () => {
      if (peak < Math.max(reactants, products)) fail('chemistry: the peak must be at least as high as the reactants and the products');
      if (catalysed !== null && (catalysed < Math.max(reactants, products) || catalysed > peak)) fail('chemistry: the catalysed peak lies between the higher end and the peak');
    };
    checkShape();
    const group = this.stage.group();
    const axes = this.stage.path('', { parent: group, tone: 'mid' });
    const guides = this.stage.path('', { parent: group, tone: 'faint', dashed: true });
    const curve = this.stage.path('', { parent: group, tone: 'hi' });
    const lower = this.stage.path('', { parent: group, tone: 'c', dashed: true });
    const lowerLabel = this.stage.text(0, 0, 'with a catalyst', { parent: group, tone: 'c' });
    const energyAxis = this.stage.text(0, 0, `energy (${unit})`, { parent: group, tone: 'mid' });
    const progressAxis = this.stage.text(0, 0, 'progress of the reaction', { parent: group, tone: 'mid' });
    const leftName = this.stage.text(0, 0, names[0], { parent: group });
    const rightName = this.stage.text(0, 0, names[1], { parent: group });
    const activationArrow = this.stage.path('', { parent: group, tone: 'a' });
    const activationText = this.stage.text(0, 0, '', { parent: group, tone: 'a' });
    const changeArrow = this.stage.path('', { parent: group, tone: 'b' });
    const changeText = this.stage.text(0, 0, '', { parent: group, tone: 'b' });
    const marker = this.stage.circle(0, 0, this.u(7), { parent: group, tone: 'lit', shade: 'sphere' }).hide();
    const small = Number(this.u(12).toFixed(2));
    for (const t of [lowerLabel, energyAxis, progressAxis, leftName, rightName, activationText, changeText]) t.set({ 'font-size': small, 'dominant-baseline': 'central' });
    for (const t of [lowerLabel, progressAxis, leftName, rightName]) t.set({ 'text-anchor': 'middle' });
    energyAxis.set({ 'text-anchor': 'middle' });
    activationText.set({ 'text-anchor': 'middle' });
    changeText.set({ 'text-anchor': 'end' });
    const px = box[0] + this.u(26);
    const py = box[1] + this.u(8);
    const pw = box[2] - this.u(34);
    const ph = box[3] - this.u(34);
    const shape = (top: number) => (t: number): number => {
      if (t <= 0.2) return reactants;
      if (t <= 0.5) return reactants + (top - reactants) * (1 - Math.cos(((t - 0.2) / 0.3) * Math.PI)) / 2;
      if (t <= 0.8) return top + (products - top) * (1 - Math.cos(((t - 0.5) / 0.3) * Math.PI)) / 2;
      return products;
    };
    let markerAt: number | null = null;
    let range: Vec2 = [0, 1];
    const sx = (t: number) => px + t * pw;
    const sy = (e: number) => py + ph - ((e - range[0]) / (range[1] - range[0])) * ph;
    const arrow = (x: number, from: number, to: number) => {
      const head = this.u(6);
      const dir = to < from ? -1 : 1;
      return `M${fmt(x)} ${fmt(from)}L${fmt(x)} ${fmt(to)}M${fmt(x - head * 0.6)} ${fmt(to - dir * head)}L${fmt(x)} ${fmt(to)}L${fmt(x + head * 0.6)} ${fmt(to - dir * head)}`;
    };
    const draw = () => {
      const values = [reactants, peak, products, ...(catalysed === null ? [] : [catalysed])];
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const span = hi - lo || 1;
      range = [lo - span * 0.12, hi + span * 0.18];
      axes.d(`M${fmt(px)} ${fmt(py)}L${fmt(px)} ${fmt(py + ph)}L${fmt(px + pw)} ${fmt(py + ph)}`);
      energyAxis.set({ x: Number((box[0] + this.u(9)).toFixed(2)), y: Number((py + ph / 2).toFixed(2)) }).rotate(-90, { about: [Number((box[0] + this.u(9)).toFixed(2)), Number((py + ph / 2).toFixed(2))] });
      progressAxis.set({ x: Number((px + pw / 2).toFixed(2)), y: Number((py + ph + this.u(16)).toFixed(2)) });
      const main = shape(peak);
      curve.d(this.ctx.path.curve(main, 0, 1, 120, (t, e) => [sx(t), sy(e)]));
      if (catalysed !== null) {
        const cat = shape(catalysed);
        lower.d(this.ctx.path.curve(cat, 0.2, 0.8, 80, (t, e) => [sx(t), sy(e)])).show();
        lowerLabel.set({ x: Number(sx(0.5).toFixed(2)), y: Number((sy(catalysed) + this.u(12)).toFixed(2)) }).show();
      } else {
        lower.hide();
        lowerLabel.hide();
      }
      // Names sit above the plateaus, clear of the energy-change arrow at the far right.
      const lift = this.u(11);
      leftName.set({ x: Number(sx(0.1).toFixed(2)), y: Number((sy(reactants) - lift).toFixed(2)) });
      rightName.set({ x: Number(sx(0.86).toFixed(2)), y: Number((sy(products) - lift).toFixed(2)) });
      if (labels) {
        const ea = peak - reactants;
        const dh = products - reactants;
        guides.d(`M${fmt(sx(0.2))} ${fmt(sy(reactants))}L${fmt(sx(0.99))} ${fmt(sy(reactants))}`).show();
        activationArrow.d(arrow(sx(0.5), sy(reactants), sy(peak))).show();
        // Above the top of the hump, where the curve never is.
        activationText.set({ x: Number(sx(0.5).toFixed(2)), y: Number((sy(peak) - this.u(11)).toFixed(2)) }).text(`Eₐ = ${fmt(ea)} ${unit}`).show();
        if (Math.abs(dh) > span * 0.02) {
          // At the far right, beside the products' plateau, with its value to the left where the curve has already passed.
          changeArrow.d(arrow(sx(0.97), sy(reactants), sy(products))).show();
          changeText.set({ x: Number((sx(0.97) - this.u(6)).toFixed(2)), y: Number(((sy(reactants) + sy(products)) / 2).toFixed(2)) }).text(`ΔH = ${dh > 0 ? '+' : '−'}${fmt(Math.abs(dh))} ${unit}`).show();
        } else {
          changeArrow.hide();
          changeText.hide();
        }
      } else {
        for (const h of [guides, activationArrow, activationText, changeArrow, changeText]) h.hide();
      }
      if (markerAt === null) marker.hide();
      else marker.set({ cx: Number(sx(markerAt).toFixed(2)), cy: Number(sy(main(markerAt)).toFixed(2)) }).show();
    };
    draw();
    const facade: Profile = {
      set: (values) => {
        if (typeof values !== 'object' || values === null) fail('chemistry: profile.set takes { reactants, peak, products, catalysed }');
        const was = { reactants, peak, products, catalysed };
        if (values.reactants !== undefined) reactants = finite(values.reactants, 'the reactants’ energy');
        if (values.peak !== undefined) peak = finite(values.peak, 'the peak energy');
        if (values.products !== undefined) products = finite(values.products, 'the products’ energy');
        if (values.catalysed !== undefined) catalysed = values.catalysed === null ? null : finite(values.catalysed, 'the catalysed peak');
        try {
          checkShape();
        } catch (error) {
          ({ reactants, peak, products, catalysed } = was);
          throw error;
        }
        draw();
        return facade;
      },
      marker: (value: number | null) => {
        markerAt = value === null ? null : Math.min(1, Math.max(0, finite(value, 'the marker’s progress')));
        draw();
        return facade;
      },
      energy: (value: number) => shape(peak)(Math.min(1, Math.max(0, finite(value, 'progress')))),
      get activation() {
        return peak - reactants;
      },
      get change() {
        return products - reactants;
      },
      handle: group,
    };
    return Object.freeze(facade);
  }
}

/** Directions for `n` lone pairs in the widest gaps between bonds (radians, sorted bond directions). */
export function spread(bonds: readonly number[], n: number): number[] {
  if (n <= 0) return [];
  if (bonds.length === 0) return Array.from({ length: n }, (_, k) => (2 * Math.PI * k) / n - (n === 2 ? 0 : Math.PI / 2));
  const gaps = bonds.map((angle, k) => {
    const next = k + 1 < bonds.length ? bonds[k + 1]! : bonds[0]! + 2 * Math.PI;
    return { start: angle, size: next - angle, count: 0 };
  });
  for (let i = 0; i < n; i++) {
    let best = gaps[0]!;
    for (const gap of gaps) if (gap.size / (gap.count + 1) > best.size / (best.count + 1) + 1e-9) best = gap;
    best.count++;
  }
  return gaps.flatMap((gap) => Array.from({ length: gap.count }, (_, i) => gap.start + (gap.size * (i + 1)) / (gap.count + 1)));
}

/** Pairs each starting atom with an end atom of the same element, nearest first. */
export function matchAtoms(starts: ReadonlyArray<{ element: string; x: number; y: number }>, ends: ReadonlyArray<{ element: string; x: number; y: number }>): number[] {
  const out = starts.map(() => -1);
  const taken = ends.map(() => false);
  const pairs: Array<{ s: number; e: number; d: number }> = [];
  starts.forEach((start, s) => {
    ends.forEach((end, e) => {
      if (end.element === start.element) pairs.push({ s, e, d: Math.hypot(end.x - start.x, end.y - start.y) });
    });
  });
  pairs.sort((p, q) => p.d - q.d || p.s - q.s || p.e - q.e);
  for (const { s, e } of pairs) {
    if (out[s] !== -1 || taken[e]) continue;
    out[s] = e;
    taken[e] = true;
  }
  return out;
}
