import type { Layer, Tone, ViewBox } from '../api/types';
import { RENDERABLE_ATTRIBUTES, type ElementKind, type SceneCommand } from '../protocol/scene-commands';
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
  classValue: string;
  transform: Transform;
}

export interface StageRecord {
  readonly id: number;
  readonly selector: string;
  readonly viewBox: ViewBox;
  readonly title: string;
  readonly description: string;
}

export const ELEMENT_LIMIT = 2000;

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
  private nextId = 1;
  private queue: SceneCommand[] = [];
  private elementCount = 0;

  get size(): number {
    return this.elementCount;
  }

  createStage(selector: string, viewBox: ViewBox, title: string, description: string): VNode {
    if (!/^#[A-Za-z][\w-]*$/.test(selector)) {
      throw new SceneApiError(`Stage selector must be an element id such as "#stage", got "${selector}"`);
    }
    if (this.stages.some((stage) => stage.selector === selector)) {
      throw new SceneApiError(`A stage already exists in ${selector}`);
    }
    const [x, y, width, height] = viewBox;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new SceneApiError('viewBox must be four finite numbers with a positive width and height');
    }
    const id = this.nextId++;
    const node = this.makeNode(id, 'stage', null, 'mid', id);
    this.nodes.set(id, node);
    const record: StageRecord = { id, selector, viewBox: [x, y, width, height], title, description };
    this.stages.push(record);
    this.queue.push({ op: 'stage', ...record });
    return node;
  }

  create(kind: ElementKind, parent: VNode, layer: Layer): VNode {
    if (this.elementCount >= ELEMENT_LIMIT) {
      throw new SceneApiError(`Scene created more than ${ELEMENT_LIMIT} elements`);
    }
    const id = this.nextId++;
    const node = this.makeNode(id, kind, parent.id, parent.kind === 'stage' ? layer : parent.layer, parent.stage);
    this.nodes.set(id, node);
    parent.children.push(id);
    this.elementCount++;
    this.queue.push({ op: 'create', id, kind, parent: parent.id, layer: node.layer });
    this.updateClass(node);
    return node;
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

  setFlags(node: VNode, flags: Partial<Pick<VNode, 'tone' | 'dashed' | 'hidden' | 'part'>>): void {
    Object.assign(node, flags);
    this.updateClass(node);
  }

  markPart(node: VNode, name: string, label: string, info: string): void {
    node.part = name;
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
      out.push({ op: 'create', id: node.id, kind: node.kind, parent: node.parent, layer: node.layer });
      if (node.classValue) out.push({ op: 'class', id: node.id, value: node.classValue });
      for (const [name, value] of node.attrs) out.push({ op: 'attr', id: node.id, name, value });
      if (node.text !== null) out.push({ op: 'text', id: node.id, value: node.text });
    }
    return out;
  }

  private updateClass(node: VNode): void {
    const classes: string[] = [];
    if (node.tone) classes.push(`inc-tone-${node.tone}`);
    if (node.dashed) classes.push('inc-dashed');
    if (node.hidden) classes.push('inc-hidden');
    if (node.part) classes.push('inc-part');
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
      classValue: '',
      transform: identity(),
    };
  }
}
