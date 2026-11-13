/**
 * The tool strip (tools-2d ui.md 1 to 4): groups of tools with drawers, a hint line, hover halos and pending points, a
 * ghost of the result, an inline number field, and the commit of a tool's lines as one undo step. The tools themselves
 * are the table in `@incantly/ui`; this file only draws and routes input.
 */
import { Figure } from '@incantly/kernel';
import type { CommandRegistry } from '@incantly/kernel';
import { GROUPS, TOOLS, ToolSession, toolById } from '@incantly/ui';
import type { Hit, StepResult, ToolDone, ToolSpec } from '@incantly/ui';
import type { GraphTool } from './graph/graph-pane';
import { hitTest } from './graph/hit';
import { colorAt, paintItem } from './graph/paint';
import type { SceneItem } from './graph/paint';
import type { Viewport } from './graph/viewport';
import { figureHost } from './tools-host';
import type { KernelSession } from './session';

export interface ToolStrip {
  readonly element: HTMLElement;
  readonly hint: HTMLElement;
  readonly graphTool: GraphTool;
  /** The active tool's id. */
  current(): string;
  select(id: string): void;
  /** True while the show/hide tool is on: hidden objects are drawn faintly so they can be clicked. */
  showHidden(): boolean;
  /** The figure changed outside the tool: a tool with no picks starts again on the new figure. */
  figureChanged(): void;
  /** Esc, Backspace and Enter for the active tool; true when the key was used. */
  key(k: string): boolean;
  dispose(): void;
}

export interface ToolStripOptions {
  readonly session: KernelSession;
  readonly registry: CommandRegistry;
  /** The graph's element, for the inline number field. */
  readonly host: () => HTMLElement;
  /** What the graph draws now. */
  readonly items: () => readonly SceneItem[];
  readonly redraw: () => void;
  readonly say: (text: string) => void;
  /** Highlights the rows a tool wrote. */
  readonly flash: (names: readonly string[]) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

const isPt = (v: unknown): v is { x: number; y: number } => typeof v === 'object' && v !== null && typeof (v as { x: unknown }).x === 'number';

export function mountToolStrip(opts: ToolStripOptions): ToolStrip {
  const { session, registry, say } = opts;
  const element = el('div', 'tool-strip');
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', 'Tools');
  const hint = el('p', 'tool-hint');
  hint.setAttribute('aria-live', 'polite');
  const drawer = el('div', 'tool-drawer');
  drawer.hidden = true;
  drawer.setAttribute('role', 'menu');

  let currentId = 'move';
  const lastInGroup = new Map<string, string>(GROUPS.map((g) => [g.id, TOOLS.find((t) => t.group === g.id)?.id ?? 'move']));
  let tool: ToolSession | undefined;
  let refusal = '';
  let pointer: { px: number; py: number } | undefined;
  let ghosts: SceneItem[] = [];
  let ghostStep = -1;
  let scratch: Figure | undefined;
  let entry: HTMLInputElement | undefined;
  let lastClick = { px: 0, py: 0 };

  const spec = (): ToolSpec => toolById(currentId) ?? (TOOLS[0] as ToolSpec);

  const newSession = (vp?: Viewport): void => {
    const s = spec();
    tool = s.kind === 'mode' ? undefined : new ToolSession(s, figureHost(session.figure, registry, vp ? 12 / vp.ppu : 0.5));
    if (tool && vp) {
      const b = vp.box();
      tool.view = { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
    }
    scratch = undefined;
    ghosts = [];
    ghostStep = -1;
  };

  const showHint = (): void => {
    const s = spec();
    hint.replaceChildren();
    const name = el('b', '', s.label);
    const rest = tool ? tool.prompt().slice(s.label.length) : `: ${s.description}`;
    hint.append(name, document.createTextNode(rest));
    if (refusal) {
      const r = el('span', 'tool-refusal', ` ⚠ ${refusal}`);
      hint.append(r);
    } else if (tool && tool.step > 0) hint.append(el('span', 'tool-keys', '   Backspace: undo last click · Esc: leave tool'));
    hint.hidden = currentId === 'move';
  };

  /* ------------------------------ strip ------------------------------ */

  const groupButtons: HTMLButtonElement[] = [];
  const renderStrip = (): void => {
    element.replaceChildren();
    groupButtons.length = 0;
    for (const g of GROUPS) {
      const tools = TOOLS.filter((t) => t.group === g.id);
      if (tools.length === 0) continue;
      const shown = toolById(lastInGroup.get(g.id) ?? '') ?? (tools[0] as ToolSpec);
      const wrap = el('div', 'tool-group');
      const b = el('button', `strip-btn${shown.id === currentId ? ' on' : ''}`, shown.icon);
      b.type = 'button';
      b.title = `${shown.label} — ${shown.description}`;
      b.setAttribute('aria-label', `${shown.label}, group ${g.label}`);
      b.setAttribute('aria-pressed', String(shown.id === currentId));
      b.tabIndex = shown.id === currentId || (currentId === 'move' && g.id === 'move') ? 0 : -1;
      b.addEventListener('click', () => api.select(shown.id));
      b.addEventListener('keydown', (e) => {
        const i = groupButtons.indexOf(b);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const n = groupButtons[(i + (e.key === 'ArrowRight' ? 1 : groupButtons.length - 1)) % groupButtons.length];
          n?.focus();
        } else if (e.key === 'ArrowDown' && tools.length > 1) {
          e.preventDefault();
          openDrawer(g.id, wrap);
        }
      });
      groupButtons.push(b);
      wrap.append(b);
      if (tools.length > 1) {
        const more = el('button', 'strip-more', '▾');
        more.type = 'button';
        more.title = `More ${g.label.toLowerCase()} tools`;
        more.setAttribute('aria-label', `More ${g.label.toLowerCase()} tools`);
        more.setAttribute('aria-haspopup', 'menu');
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!drawer.hidden && drawer.dataset['group'] === g.id) drawer.hidden = true;
          else openDrawer(g.id, wrap);
        });
        wrap.append(more);
      }
      element.append(wrap);
    }
    element.append(drawer);
  };

  const openDrawer = (group: string, anchor: HTMLElement): void => {
    drawer.replaceChildren();
    drawer.dataset['group'] = group;
    const label = GROUPS.find((g) => g.id === group)?.label ?? '';
    drawer.append(el('p', 'drawer-title', label));
    for (const t of TOOLS.filter((x) => x.group === group)) {
      const item = el('button', `drawer-item${t.id === currentId ? ' on' : ''}`);
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.title = t.description;
      item.append(el('span', 'drawer-icon', t.icon), el('span', '', t.label));
      item.addEventListener('click', () => {
        drawer.hidden = true;
        api.select(t.id);
      });
      item.addEventListener('keydown', (e) => {
        const items = [...drawer.querySelectorAll<HTMLButtonElement>('.drawer-item')];
        const i = items.indexOf(item);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        } else if (e.key === 'Escape') {
          drawer.hidden = true;
          anchor.querySelector<HTMLButtonElement>('.strip-btn')?.focus();
        }
      });
      drawer.append(item);
    }
    drawer.style.left = `${anchor.offsetLeft}px`;
    drawer.hidden = false;
    drawer.querySelector<HTMLButtonElement>('.drawer-item')?.focus();
  };
  const closeDrawer = (e: MouseEvent): void => {
    if (!drawer.hidden && !drawer.contains(e.target as Node)) drawer.hidden = true;
  };
  document.addEventListener('click', closeDrawer);

  /* ------------------------------ input ------------------------------ */

  const hitsAt = (px: number, py: number, vp: Viewport): Hit[] => {
    const hits: Hit[] = hitTest(opts.items(), vp, px, py, 10);
    // pending points of this tool can be picked again (the first vertex closes a polygon)
    for (const p of tool?.pending() ?? []) {
      const d = Math.hypot(vp.px(p.at.x) - px, vp.py(p.at.y) - py);
      if (d <= 10) hits.unshift({ name: p.tag, type: 'Point', dist: d });
    }
    return hits;
  };

  /** Applies a finished tool: an edit, a query shown in the hint, or the lines as one undo step. */
  const commit = (done: ToolDone): void => {
    const s = spec();
    if (done.action) {
      const { op, name } = done.action;
      if (op === 'delete') {
        const r = session.delete(name);
        say(r.ok ? r.message : r.error.message);
      } else {
        const o = session.figure.get(name);
        const r = session.applyLines([`${name} with visible = ${o?.style.visible === false ? 'true' : 'false'}`], 'Show or hide', 'atomic');
        say(r.ok ? `${o?.style.visible === false ? 'Showed' : 'Hid'} ${name}.` : r.error.message);
      }
    } else if (s.kind === 'query') {
      const { figure } = Figure.fromScript(session.figure.toScript(), { commands: registry });
      const r = figure.applyBatch(done.lines, { group: 'query' });
      const v = done.results[0] ? figure.cellOf(done.results[0]) : undefined;
      refusal = '';
      const text = r.ok && v?.defined ? String(v.value) : 'no relation found';
      say(`${s.label}: ${text}.`);
      hint.textContent = `${s.label}: ${text}`;
      newSession();
      return;
    } else {
      const r = session.applyLines(done.lines, s.label, 'atomic');
      if (!r.ok) {
        refusal = `That didn't work: ${r.error.message}`;
        say(refusal);
        showHint();
        return;
      }
      const names = [...done.points, ...done.results];
      opts.flash(names);
      say(`Created ${names.join(', ')}.`);
    }
    if (!s.sticky) api.select('move');
    else newSession();
  };

  const handle = (r: StepResult): void => {
    if (!r.ok) {
      refusal = `${r.message} ${r.hint}`;
      say(refusal);
    } else {
      refusal = '';
      if ('lines' in r) commit(r);
      else if (r.cancel) {
        api.select('move');
        return;
      }
    }
    closeEntry();
    if (tool?.awaitingNumber()) openEntry();
    ghosts = [];
    showHint();
    opts.redraw();
  };

  /* ------------------------------ number field ------------------------------ */

  const closeEntry = (): void => {
    entry?.remove();
    entry = undefined;
  };
  const openEntry = (): void => {
    const slot = tool?.awaitingNumber();
    if (!slot || entry) return;
    const box = el('input', 'tool-entry');
    box.type = 'text';
    box.placeholder = slot.def !== undefined ? String(Number(slot.def.toPrecision(4))) : '';
    box.setAttribute('aria-label', slot.prompt);
    box.style.left = `${lastClick.px + 12}px`;
    box.style.top = `${lastClick.py + 12}px`;
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const r = tool?.entry(box.value);
        if (r) handle(r);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        tool?.key('Backspace');
        closeEntry();
        showHint();
        opts.redraw();
      }
    });
    opts.host().append(box);
    entry = box;
    box.focus();
  };

  /* ------------------------------ preview ------------------------------ */

  const preview = (px: number, py: number, vp: Viewport): void => {
    if (!tool) return;
    const b = vp.box();
    tool.view = { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
    const done = tool.preview({ x: vp.x(px), y: vp.y(py) }, hitsAt(px, py, vp));
    if (!done || done.action) {
      ghosts = [];
      return;
    }
    // a scratch copy of the figure per step; each preview is applied and taken back
    if (!scratch || ghostStep !== tool.step) {
      scratch = Figure.fromScript(session.figure.toScript(), { commands: registry }).figure;
      ghostStep = tool.step;
    }
    const r = scratch.applyBatch(done.lines, { group: 'preview' });
    const out: SceneItem[] = [];
    let why = '';
    if (r.ok) {
      for (const n of [...done.points, ...done.results]) {
        const o = scratch.get(n);
        if (!o) continue;
        if (!o.cell.defined) {
          if (done.results.includes(n)) why = o.cell.reason;
          continue;
        }
        out.push({ id: -1 - out.length, name: n, type: o.type, typeText: o.typeText, value: o.cell.value, color: colorAt(1), free: false, label: false, ghost: true });
      }
      scratch.undo();
    }
    ghosts = out;
    if (why && !refusal) {
      hint.dataset['why'] = why;
      const words: Record<string, string> = {
        collinear: 'These points are in a line.', coincident: 'These two points are the same point.', parallel: 'These lines are parallel; they never meet.',
        no_intersection: "These two objects don't cross.", degenerate: "These points don't make a conic.", inside: 'A point inside the circle has no tangents.',
      };
      const span = hint.querySelector('.tool-why') ?? hint.appendChild(el('span', 'tool-why'));
      span.textContent = `  ${words[why] ?? `The result would be undefined (${why.replace(/_/g, ' ')}).`}`;
    } else hint.querySelector('.tool-why')?.remove();
  };

  /* ------------------------------ the graph's side ------------------------------ */

  const graphTool: GraphTool = {
    active: () => currentId !== 'move',
    hover(px, py, vp) {
      pointer = { px, py };
      preview(px, py, vp);
    },
    click(px, py, vp) {
      lastClick = { px, py };
      if (currentId === 'zoom-in' || currentId === 'zoom-out') {
        vp.zoomAt(px, py, currentId === 'zoom-in' ? 1.5 : 1 / 1.5);
        return;
      }
      if (!tool) return;
      if (tool.step === 0) newSession(vp);
      const t = tool as ToolSession;
      const b = vp.box();
      t.view = { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
      handle(t.click({ x: vp.x(px), y: vp.y(py) }, hitsAt(px, py, vp)));
    },
    overlay(ctx, vp) {
      if (!tool) return;
      for (const g of ghosts) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([6, 4]);
        try {
          paintItem(ctx, vp, g, []);
        } catch {
          // a ghost the painter cannot draw is skipped
        }
        ctx.restore();
      }
      // pending points: hollow rings with the pick number (ui.md 2)
      const picks = tool.picks;
      tool.pending().forEach((p) => {
        const x = vp.px(p.at.x);
        const y = vp.py(p.at.y);
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#2d70b3';
        ctx.stroke();
      });
      picks.forEach((a, i) => {
        const at = a.at ?? (() => {
          const o = session.figure.get(a.text);
          return o?.cell.defined && isPt(o.cell.value) ? o.cell.value : undefined;
        })();
        if (!at) return;
        const x = vp.px(at.x) + 9;
        const y = vp.py(at.y) + 9;
        ctx.fillStyle = '#2d70b3';
        ctx.beginPath();
        ctx.arc(x, y, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y + 0.5);
      });
      // a halo on what the click would pick
      if (pointer) {
        const h = hitsAt(pointer.px, pointer.py, vp)[0];
        if (h) {
          ctx.save();
          ctx.font = '12px system-ui, sans-serif';
          ctx.fillStyle = '#1f2430';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(h.name.startsWith('{') ? 'new point' : `${h.name}`, pointer.px + 12, pointer.py - 6);
          ctx.restore();
        }
      }
    },
  };

  const api: ToolStrip = {
    element,
    hint,
    graphTool,
    current: () => currentId,
    select(id) {
      const s = toolById(id);
      if (!s) return;
      currentId = id;
      lastInGroup.set(s.group, id);
      refusal = '';
      closeEntry();
      newSession();
      renderStrip();
      showHint();
      say(`${s.label}. ${s.description}`);
      opts.redraw();
    },
    showHidden: () => currentId === 'show-hide-object',
    figureChanged() {
      if (tool && tool.step === 0) newSession();
    },
    key(k) {
      if (currentId === 'move') return false;
      if (k === 'Escape' || k === 'Backspace' || k === 'Enter') {
        if (!tool) {
          if (k === 'Escape') api.select('move');
          return k === 'Escape';
        }
        handle(tool.key(k));
        return true;
      }
      return false;
    },
    dispose() {
      document.removeEventListener('click', closeDrawer);
      closeEntry();
    },
  };
  renderStrip();
  showHint();
  return api;
}
