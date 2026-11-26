/**
 * The tool strip (tools-2d ui.md 1 to 4): groups of tools with drawers, a hint line, hover halos and pending points, a
 * ghost of the result, an inline number field, and the commit of a tool's lines as one undo step. The tools themselves
 * are the table in `@incantly/ui`; this file only draws and routes input.
 */
import { Figure } from '@incantly/kernel';
import type { CommandRegistry } from '@incantly/kernel';
import { GROUPS, TOOLS, ToolSession, toolById } from '@incantly/ui';
import type { Hit, StepResult, ToolDone, ToolSpec } from '@incantly/ui';
import type { GraphTool } from './graph-pane';
import { hitTest } from './hit';
import { colorAt, paintItem } from './paint';
import type { SceneItem } from './paint';
import { gridStep } from './viewport';
import type { Viewport } from './viewport';
import { figureHost } from './figure-host';

/** The figure a tool strip reads and the lines it writes. A studio session satisfies it. */
export interface ToolFigure {
  readonly figure: Figure;
  applyLines(lines: readonly string[], label: string, mode?: 'independent' | 'atomic'): { ok: true; message: string } | { ok: false; error: { message: string } };
  delete(name: string): { ok: true; message: string } | { ok: false; error: { message: string } };
}

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
  /**
   * Every key the tools answer (ui.md 2, Keyboard): Ctrl+1…9 for the groups; with a tool on, arrows move the virtual
   * cursor (Shift ×5, Alt ÷5), Enter or Space clicks there, Tab cycles what is under it; then Esc, Backspace, Enter.
   */
  keyDown(e: KeyboardEvent): boolean;
  /** The virtual cursor in screen pixels, while one is shown. */
  cursor(): { readonly px: number; readonly py: number } | undefined;
  /** Only the tools the app mode allows (app-modes design 3.1); `undefined` allows every tool. */
  setAllowed(allow: ((id: string, group: string) => boolean) | undefined): void;
  dispose(): void;
}

export interface ToolStripOptions {
  readonly session: ToolFigure;
  readonly registry: CommandRegistry;
  /** The graph's element, for the inline number field. */
  readonly host: () => HTMLElement;
  /** What the graph draws now. */
  readonly items: () => readonly SceneItem[];
  readonly redraw: () => void;
  readonly say: (text: string) => void;
  /** Highlights the rows a tool wrote. */
  readonly flash: (names: readonly string[]) => void;
  /** Objects selected before a tool starts become its first picks, in order (tools-2d design 5.4). */
  readonly selection?: () => readonly string[];
  /** The graph's viewport, for the keyboard cursor before anything is painted. */
  readonly viewport?: () => Viewport;
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
  let allowTool: ((id: string, group: string) => boolean) | undefined;
  const usable = (): readonly ToolSpec[] => (allowTool ? TOOLS.filter((t) => t.id === 'move' || (allowTool as (id: string, group: string) => boolean)(t.id, t.group)) : TOOLS);
  const lastInGroup = new Map<string, string>(GROUPS.map((g) => [g.id, TOOLS.find((t) => t.group === g.id)?.id ?? 'move']));
  let tool: ToolSession | undefined;
  let refusal = '';
  let pointer: { px: number; py: number } | undefined;
  let ghosts: SceneItem[] = [];
  let ghostStep = -1;
  let scratch: Figure | undefined;
  let entry: HTMLInputElement | undefined;
  let lastClick = { px: 0, py: 0 };
  /** The keyboard's virtual cursor (ui.md 2), the viewport it was last drawn in, and the Tab position in its hit list. */
  let vcursor: { px: number; py: number } | undefined;
  let lastVp: Viewport | undefined;
  let cycle = 0;
  /** A pending point being moved (design 7.2), and the finger position for the loupe. */
  let grabbed: string | undefined;
  let loupe: { px: number; py: number } | undefined;
  let spokenAt = 0;

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
      const tools = usable().filter((t) => t.group === g.id);
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
    for (const t of usable().filter((x) => x.group === group)) {
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
      // an undefined result is refused unless Alt was held, so that dragging can fix it later (errors.md 2, degenerate)
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
        const r = tool?.entry(box.value, { alt: e.altKey });
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

  /** Says where the virtual cursor is and what is under it, at most twice a second (ui.md 2, screen reader). */
  const speak = (vp: Viewport): void => {
    if (!vcursor) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - spokenAt < 500) return;
    spokenAt = now;
    const x = Number(vp.x(vcursor.px).toPrecision(3));
    const y = Number(vp.y(vcursor.py).toPrecision(3));
    const h = hitsAt(vcursor.px, vcursor.py, vp)[0];
    say(`At ${x}, ${y}.${h && !h.name.startsWith('{') ? ` On ${h.name}.` : ''}`);
  };

  /* ------------------------------ the graph's side ------------------------------ */

  const graphTool: GraphTool = {
    active: () => currentId !== 'move',
    hover(px, py, vp, touch) {
      pointer = { px, py };
      vcursor = undefined;
      loupe = touch ? { px, py } : undefined;
      preview(px, py, vp);
    },
    grab(px, py, vp) {
      const p = tool?.pending().find((q) => q.how === 'free' && Math.hypot(vp.px(q.at.x) - px, vp.py(q.at.y) - py) <= 10);
      grabbed = p?.tag;
      return grabbed !== undefined;
    },
    dragTo(px, py, vp) {
      if (!grabbed || !tool) return;
      tool.movePending(grabbed, { x: vp.x(px), y: vp.y(py) });
      loupe = { px, py };
      pointer = { px, py };
      ghosts = [];
    },
    release() {
      if (grabbed) say('Moved the new point.');
      grabbed = undefined;
      loupe = undefined;
    },
    click(px, py, vp, alt) {
      lastClick = { px, py };
      cycle = 0;
      if (currentId === 'zoom-in' || currentId === 'zoom-out') {
        vp.zoomAt(px, py, currentId === 'zoom-in' ? 1.5 : 1 / 1.5);
        return;
      }
      if (!tool) return;
      if (tool.step === 0) newSession(vp);
      const t = tool as ToolSession;
      const b = vp.box();
      t.view = { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
      handle(t.click({ x: vp.x(px), y: vp.y(py) }, hitsAt(px, py, vp), { alt: alt === true }));
    },
    overlay(ctx, vp) {
      lastVp = vp;
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
      // the keyboard's virtual cursor: a crosshair in a ring (ui.md 2)
      if (vcursor) {
        const { px, py } = vcursor;
        ctx.save();
        ctx.strokeStyle = '#2d70b3';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.moveTo(px - 14, py);
        ctx.lineTo(px + 14, py);
        ctx.moveTo(px, py - 14);
        ctx.lineTo(px, py + 14);
        ctx.stroke();
        ctx.restore();
      }
      // the touch loupe: what is under the finger, twice as big, above it (design 7.2)
      if (loupe && typeof ctx.drawImage === 'function') {
        const r = 46;
        const cx = loupe.px;
        const cy = Math.max(r + 6, loupe.py - 90);
        const dpr = ctx.canvas.width / Math.max(1, vp.w);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        try {
          ctx.drawImage(ctx.canvas, (loupe.px - r / 2) * dpr, (loupe.py - r / 2) * dpr, r * dpr, r * dpr, cx - r, cy - r, 2 * r, 2 * r);
        } catch {
          // a canvas that cannot copy itself shows the ring only
        }
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = '#2d70b3';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.moveTo(cx - 6, cy);
        ctx.lineTo(cx + 6, cy);
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx, cy + 6);
        ctx.stroke();
        ctx.restore();
      }
    },
  };

  const api: ToolStrip = {
    element,
    hint,
    graphTool,
    current: () => currentId,
    setAllowed(allow) {
      allowTool = allow;
      for (const g of GROUPS) {
        const first = usable().find((t) => t.group === g.id);
        const last = lastInGroup.get(g.id);
        if (first && !usable().some((t) => t.id === last)) lastInGroup.set(g.id, first.id);
      }
      if (!usable().some((t) => t.id === currentId)) api.select('move');
      else renderStrip();
      element.hidden = usable().length <= 1 && allow !== undefined && !allow('move', 'move');
    },
    select(id) {
      const s = toolById(id);
      if (!s) return;
      if (!usable().some((t) => t.id === id)) return;
      currentId = id;
      lastInGroup.set(s.group, id);
      refusal = '';
      closeEntry();
      newSession();
      const pre = opts.selection?.() ?? [];
      if (tool && pre.length > 0) handle(tool.preselect(pre));
      renderStrip();
      showHint();
      say(`${s.label}. ${s.description}`);
      opts.redraw();
    },
    showHidden: () => currentId === 'show-hide-object',
    figureChanged() {
      if (tool && tool.step === 0) newSession();
    },
    cursor: () => vcursor,
    keyDown(e) {
      // Ctrl+1…9: the first nine groups' current tools
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        const g = GROUPS.filter((x) => usable().some((t) => t.group === x.id))[Number(e.key) - 1];
        const id = g ? lastInGroup.get(g.id) : undefined;
        if (!id) return false;
        api.select(id);
        return true;
      }
      if (currentId === 'move' || !tool) return api.key(e.key);
      const vp = lastVp ?? opts.viewport?.();
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const dir = arrows[e.key];
      if (dir && vp) {
        // one grid step, Shift ×5, Alt ÷5
        const g = gridStep(vp.ppu);
        let step = g.minor * vp.ppu || 10;
        if (e.shiftKey) step *= 5;
        if (e.altKey) step /= 5;
        const at = vcursor ?? pointer ?? { px: vp.w / 2, py: vp.h / 2 };
        vcursor = { px: Math.min(vp.w, Math.max(0, at.px + dir[0] * step)), py: Math.min(vp.h, Math.max(0, at.py + dir[1] * step)) };
        pointer = vcursor;
        cycle = 0;
        preview(vcursor.px, vcursor.py, vp);
        speak(vp);
        opts.redraw();
        return true;
      }
      if (e.key === 'Tab' && vcursor && vp) {
        const hits = hitsAt(vcursor.px, vcursor.py, vp);
        if (hits.length < 2) return false;
        cycle = (cycle + (e.shiftKey ? hits.length - 1 : 1)) % hits.length;
        say(`${cycle + 1} of ${hits.length}: ${hits.map((h) => (h.name.startsWith('{') ? 'new point' : h.name)).join(', ')}`);
        return true;
      }
      if ((e.key === 'Enter' || e.key === ' ') && vcursor && vp && !tool.awaitingNumber()) {
        const hits = hitsAt(vcursor.px, vcursor.py, vp);
        const ordered = [...hits.slice(cycle), ...hits.slice(0, cycle)];
        lastClick = vcursor;
        if (tool.step === 0) newSession(vp);
        const t = tool as ToolSession;
        const b = vp.box();
        t.view = { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
        cycle = 0;
        handle(t.click({ x: vp.x(vcursor.px), y: vp.y(vcursor.py) }, ordered, { alt: e.altKey }));
        return true;
      }
      if (e.key === 'Escape' && vcursor && tool.step === 0) {
        vcursor = undefined;
        opts.redraw();
        return true;
      }
      return api.key(e.key);
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

