import type { DragInfo, Layer, Shade, Tone, Values, Vec2, ViewBox } from '../api/types';
import { RENDERABLE_ATTRIBUTES, type ElementKind, type SceneCommand, type StageMeasure, type StageZoom } from '../protocol/scene-commands';
import { SceneApiError, type Diagnostic } from './errors';
import { fmt, hasNonFinite } from './format';

export interface Transform {
  tx: number;
  ty: number;
  rotation: number;
  rcx: number;
  rcy: number;
  sx: number;
  sy: number;
}

export interface VNode {
  readonly id: number;
  readonly kind: ElementKind | 'stage';
  readonly parent: number | null;
  readonly layer: Layer;
  readonly stage: number;
  readonly attrs: Map<string, string>;
  readonly children: number[];
  text: string | null;
  tone: Tone | null;
  dashed: boolean;
  hidden: boolean;
  part: string | null;
  /** Filled with its tone rather than stroked (paths and polylines). */
  fill: boolean;
  shade: Shade | null;
  /** A soft halo in its own tone (FX-1). */
  glow: boolean;
  /** Kit classes: focus marks on 3D faces, ghosts. */
  extra: string;
  classValue: string;
  transform: Transform;
  /** Drag label when the learner can drag it. */
  drag: string | null;
  /** The part a shared element (a 3D face slot) belongs to now. */
  owner: string | null;
  /** For `use`: the element repeated. */
  source: number | null;
  /** Its children have been reordered at least once. */
  ordered: boolean;
}

/** How a stage answers the pointer; sent once after mount and whenever it changes. */
export interface StageInteraction {
  readonly zoom: StageZoom;
  readonly hover: boolean;
  readonly orbit: boolean;
  readonly views: readonly string[];
  readonly measure: StageMeasure | null;
}

export interface StageRecord {
  readonly id: number;
  readonly selector: string;
  readonly viewBox: ViewBox;
  readonly title: string;
  readonly description: string;
  readonly clip?: ViewBox;
}

export const ELEMENT_LIMIT = 2000;

/** What handles need from the runtime that owns their graph. */
export interface GraphServices {
  /** Lets the learner drag `node`; `toLocal` turns stage coordinates into the handle's own (a graph's data units). */
  addDrag(node: VNode, label: string, map: (p: DragInfo) => Values | void, toLocal?: (x: number, y: number) => Vec2): void;
  /** Runs after the scene's frame callbacks on every drawn frame, paused or playing. */
  onRedraw(fn: () => void): void;
  /** Moves dashes along a stroke at `speed` units per second. */
  setFlow(node: VNode, speed: number): void;
  /** Runs on every frame that moves scene time, with the step in seconds; registering one makes the scene animated. */
  onStep(fn: (dt: number) => void): void;
  /** The scene's seeded random numbers, from 0 to 1, the same on every run. */
  random(): number;
}

const identity = (): Transform => ({ tx: 0, ty: 0, rotation: 0, rcx: 0, rcy: 0, sx: 1, sy: 1 });

/** Attribute values must be plain geometry: no markup, URLs or script. */
const SAFE_VALUE = /^[\w\s.,+\-%#()]*$/;
const MAX_VALUE_LENGTH = 200_000;

/**
 * The scene's virtual SVG. It records every element the scene creates and
 * emits a command only when something actually changed.
 */
export class SceneGraph {
  readonly nodes = new Map<number, VNode>();
  readonly stages: StageRecord[] = [];
  readonly diagnostics: Diagnostic[] = [];
  /** Set by the runtime; handles of a graph without one cannot drag, follow or flow. */
  services: GraphServices | null = null;
  /** Where the scene created each element, when the runtime traces it (the probe does, to point at what is wrong). */
  trace: (() => { readonly line: number; readonly column: number } | null) | null = null;
  readonly sites = new Map<number, { readonly line: number; readonly column: number }>();
  private nextId = 1;
  private queue: SceneCommand[] = [];
  private elementCount = 0;
  private readonly interactions = new Map<number, string>();
  private readonly partInfo = new Map<number, { name: string; label: string; info: string }>();
  private readonly dots = new Map<number, string>();
  private readonly dotState = new Map<number, { stage: number; layer: 'back' | 'front'; tone: string; r: number; points: number[]; glow?: boolean; trail?: number }>();

  /** A fresh id for something drawn outside the element tree (a dots layer). */
  newId(): number {
    return this.nextId++;
  }

  get size(): number {
    return this.elementCount;
  }

  createStage(selector: string, viewBox: ViewBox, title: string, description: string, clip?: ViewBox): VNode {
    if (!/^#[A-Za-z][\w-]*$/.test(selector)) {
      throw new SceneApiError(`Stage selector must be an element id such as "#stage", got "${selector}"`);
    }
    if (this.stages.some((stage) => stage.selector === selector)) {
      throw new SceneApiError(
        `A stage already exists in ${selector}: each stage or graph needs its own element. Add one to the HTML, such as <div id="graph"></div>, and pass "#graph"; or draw on the stage you have`,
      );
    }
    const [x, y, width, height] = viewBox;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new SceneApiError('viewBox must be four finite numbers with a positive width and height');
    }
    const id = this.nextId++;
    const node = this.makeNode(id, 'stage', null, 'mid', id);
    this.nodes.set(id, node);
    const record: StageRecord = {
      id,
      selector,
      viewBox: [x, y, width, height],
      title,
      description,
      ...(clip ? { clip } : {}),
    };
    this.stages.push(record);
    this.queue.push({ op: 'stage', ...record });
    return node;
  }

  create(kind: ElementKind, parent: VNode, layer: Layer, source?: VNode): VNode {
    if (this.elementCount >= ELEMENT_LIMIT) {
      throw new SceneApiError(`Scene created more than ${ELEMENT_LIMIT} elements`);
    }
    if (kind === 'use' && (!source || source.stage !== parent.stage || source.kind === 'stage')) {
      throw new SceneApiError('A copy must repeat an element of the same stage');
    }
    const id = this.nextId++;
    const node = this.makeNode(id, kind, parent.id, parent.kind === 'stage' ? layer : parent.layer, parent.stage);
    if (source) node.source = source.id;
    this.nodes.set(id, node);
    parent.children.push(id);
    this.elementCount++;
    const site = this.trace?.();
    if (site) this.sites.set(id, site);
    this.queue.push({ op: 'create', id, kind, parent: parent.id, layer: node.layer, ...(source ? { source: source.id } : {}) });
    this.updateClass(node);
    return node;
  }

  /** Lets the learner drag an element. */
  markDrag(node: VNode, label: string): void {
    node.drag = label;
    this.queue.push({ op: 'drag', id: node.id, label });
  }

  /** How a stage answers the pointer. Sent only when it changed. */
  setInteraction(stageId: number, interaction: StageInteraction): void {
    const key = JSON.stringify(interaction);
    if (this.interactions.get(stageId) === key) return;
    this.interactions.set(stageId, key);
    this.queue.push({ op: 'interact', id: stageId, ...interaction });
  }

  /** Names the part a shared element currently belongs to (3D faces). */
  setOwner(node: VNode, part: string | null): void {
    if (node.owner === part) return;
    node.owner = part;
    this.queue.push({ op: 'owner', id: node.id, part });
  }

  /** Puts a group's children in a new order (a 3D depth sort). */
  setOrder(node: VNode, children: readonly number[]): void {
    const same = children.length === node.children.length && children.every((id, i) => node.children[i] === id);
    if (same) return;
    node.ordered = true;
    node.children.splice(0, node.children.length, ...children);
    this.queue.push({ op: 'order', id: node.id, children: [...children] });
  }

  /** Dots on a canvas sharing a stage's coordinates; points are x0, y0, x1, y1, ... */
  setDots(id: number, stage: number, layer: 'back' | 'front', tone: string, r: number, points: readonly number[], glow = false, trail = 0, restarts: readonly number[] = []): void {
    const key = `${layer}|${tone}|${r}|${glow ? 1 : 0}|${trail}|${points.join(',')}`;
    if (this.dots.get(id) === key) return;
    this.dots.set(id, key);
    const extra = { ...(glow ? { glow } : {}), ...(trail > 0 ? { trail } : {}) };
    this.dotState.set(id, { stage, layer, tone, r, points: [...points], ...extra });
    // Restarts belong to this step only: a snapshot replays where the dots are, not how they got there.
    this.queue.push({ op: 'dots', id, stage, layer, tone, r, points: [...points], ...extra, ...(restarts.length > 0 ? { restarts: [...restarts] } : {}) });
  }

  /** Sets the kit's own classes on an element (focus marks, ghosts). */
  setExtra(node: VNode, extra: string): void {
    if (node.extra === extra) return;
    node.extra = extra;
    this.updateClass(node);
  }

  setAttribute(node: VNode, name: string, value: number | string | null): void {
    if (!RENDERABLE_ATTRIBUTES.has(name)) {
      throw new SceneApiError(`Unknown attribute "${name}". Colours come from tones, not attributes.`);
    }
    let text: string | null;
    if (value === null) {
      text = null;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        this.report(node, `Attribute "${name}" received ${String(value)}`);
        return;
      }
      text = fmt(value);
    } else {
      if (value.length > MAX_VALUE_LENGTH || !SAFE_VALUE.test(value)) {
        throw new SceneApiError(`Attribute "${name}" has a value that is not plain geometry`);
      }
      if (hasNonFinite(value)) {
        this.report(node, `Attribute "${name}" contains a non-finite number`);
        return;
      }
      text = value;
    }
    const previous = node.attrs.get(name) ?? null;
    if (previous === text) return;
    if (text === null) node.attrs.delete(name);
    else node.attrs.set(name, text);
    this.queue.push({ op: 'attr', id: node.id, name, value: text });
  }

  setText(node: VNode, value: string): void {
    if (node.text === value) return;
    node.text = value;
    this.queue.push({ op: 'text', id: node.id, value });
  }

  setTransform(node: VNode, patch: Partial<Transform>): void {
    const next = { ...node.transform, ...patch };
    for (const [key, v] of Object.entries(patch)) {
      if (!Number.isFinite(v)) {
        this.report(node, `Transform "${key}" received ${String(v)}`);
        return;
      }
    }
    node.transform = next;
    const parts: string[] = [];
    if (next.tx !== 0 || next.ty !== 0) parts.push(`translate(${fmt(next.tx)} ${fmt(next.ty)})`);
    if (next.rotation !== 0) parts.push(`rotate(${fmt(next.rotation)} ${fmt(next.rcx)} ${fmt(next.rcy)})`);
    if (next.sx !== 1 || next.sy !== 1) parts.push(`scale(${fmt(next.sx)} ${fmt(next.sy)})`);
    this.setAttribute(node, 'transform', parts.length ? parts.join(' ') : null);
  }

  setFlags(node: VNode, flags: Partial<Pick<VNode, 'tone' | 'dashed' | 'hidden' | 'part' | 'fill' | 'shade' | 'glow' | 'extra'>>): void {
    Object.assign(node, flags);
    this.updateClass(node);
  }

  markPart(node: VNode, name: string, label: string, info: string): void {
    node.part = name;
    this.partInfo.set(node.id, { name, label, info });
    this.updateClass(node);
    this.queue.push({ op: 'part', id: node.id, name, label, info });
  }

  /** Removes and returns the commands produced since the last flush. */
  flush(): SceneCommand[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  /** Commands that rebuild the whole scene from scratch, e.g. for a remount. */
  snapshotCommands(): SceneCommand[] {
    const out: SceneCommand[] = [];
    for (const stage of this.stages) out.push({ op: 'stage', ...stage });
    for (const node of this.nodes.values()) {
      if (node.kind === 'stage' || node.parent === null) continue;
      out.push({ op: 'create', id: node.id, kind: node.kind, parent: node.parent, layer: node.layer, ...(node.source !== null ? { source: node.source } : {}) });
      if (node.classValue) out.push({ op: 'class', id: node.id, value: node.classValue });
      for (const [name, value] of node.attrs) out.push({ op: 'attr', id: node.id, name, value });
      if (node.text !== null) out.push({ op: 'text', id: node.id, value: node.text });
      if (node.part !== null && this.partInfo.has(node.id)) out.push({ op: 'part', id: node.id, ...this.partInfo.get(node.id)! });
      if (node.drag !== null) out.push({ op: 'drag', id: node.id, label: node.drag });
      if (node.owner !== null) out.push({ op: 'owner', id: node.id, part: node.owner });
    }
    for (const node of this.nodes.values()) {
      if (node.kind === 'g' && node.ordered) out.push({ op: 'order', id: node.id, children: [...node.children] });
    }
    for (const [id, dots] of this.dotState) out.push({ op: 'dots', id, ...dots });
    for (const [id, key] of this.interactions) out.push({ op: 'interact', id, ...(JSON.parse(key) as StageInteraction) });
    return out;
  }

  private updateClass(node: VNode): void {
    const classes: string[] = [];
    if (node.tone) classes.push(`inc-tone-${node.tone}`);
    if (node.dashed) classes.push('inc-dashed');
    if (node.hidden) classes.push('inc-hidden');
    if (node.part) classes.push('inc-part');
    if (node.fill) classes.push('inc-fill');
    if (node.shade) classes.push(`inc-shade-${node.shade}`);
    if (node.glow) classes.push('inc-glow');
    if (node.extra) classes.push(node.extra);
    const value = classes.join(' ');
    if (value === node.classValue) return;
    node.classValue = value;
    this.queue.push({ op: 'class', id: node.id, value });
  }

  private report(node: VNode, message: string): void {
    if (this.diagnostics.length < 200) this.diagnostics.push({ kind: 'non-finite', message, elementId: node.id });
  }

  private makeNode(id: number, kind: VNode['kind'], parent: number | null, layer: Layer, stage: number): VNode {
    return {
      id,
      kind,
      parent,
      layer,
      stage,
      attrs: new Map(),
      children: [],
      text: null,
      tone: null,
      dashed: false,
      hidden: false,
      part: null,
      fill: false,
      shade: null,
      glow: false,
      extra: '',
      classValue: '',
      transform: identity(),
      drag: null,
      owner: null,
      source: null,
      ordered: false,
    };
  }
}
