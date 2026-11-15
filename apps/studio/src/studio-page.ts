/**
 * The studio: a top bar, the expression list on the left, the graph on the right, and the data-analysis panel when it
 * is open. Every area built so far is registered, so its commands can be typed and seen.
 */
import { mountDataLab } from './datalab';
import { mountProbCalc } from './probcalc';
import { mountSimStrip } from './simstrip';
import type { SimStrip } from './simstrip';
import { mountToolStrip } from './tools-ui';
import type { ToolStrip } from './tools-ui';
import type { ProbCalc } from './probcalc';
import type { DataLab } from './datalab';
import { EXAMPLES } from './examples';
import { drawsOnGraph, mountExpressions } from './expressions';
import type { ExpressionList } from './expressions';
import { mountGraph } from './graph/graph-pane';
import type { GraphPane } from './graph/graph-pane';
import { sceneBounds } from './graph/paint';
import type { SceneItem } from './graph/paint';
import { studioRegistry } from './registry';
import { KernelSession } from './session';
import { tracePoints, tracedIds } from '@incantly/kernel';
import { createSelection, selectionFrom } from './selection';
import type { Selection } from './selection';
import { hitTest } from './graph/hit';

export interface StudioOptions {
  /** Frame scheduler for the clock; defaults to `requestAnimationFrame`. A test passes its own. */
  readonly raf?: (cb: (now: number) => void) => number;
  readonly caf?: (handle: number) => void;
  /** Repeating timer for the simulation strip's Run; a test passes its own. */
  readonly every?: (ms: number, fn: () => void) => () => void;
}

export interface Mounted {
  readonly session: KernelSession;
  readonly expressions: ExpressionList;
  readonly graph: GraphPane;
  readonly lab: DataLab;
  readonly calc: ProbCalc;
  readonly tools: ToolStrip;
  readonly sim: SimStrip;
  /** What is selected in the list and on the canvas (algebra-view design 3.9). */
  readonly selection: Selection;
  readonly status: HTMLElement;
  /** Replaces the figure with an example's lines. */
  loadExample(id: string): void;
  undo(): void;
  redo(): void;
  dispose(): void;
}

const KEYS: readonly (readonly [string, string])[] = [
  ['Enter', 'Apply the line; with the completion list open, accept the suggestion'],
  ['Tab', 'Accept the highlighted completion'],
  ['Up / Down', 'Move between lines'],
  ['Alt + Up / Down', 'In a call: the other forms of the command; in the new line: earlier lines'],
  ['F2', 'Select the name of a line, to rename it'],
  ['Esc', 'Undo the edit in progress'],
  ['Backspace on an empty line', 'Delete the line'],
  ['Ctrl/Cmd + Z, Shift + Ctrl/Cmd + Z', 'Undo, redo'],
  ['/', 'Go to the new-line box'],
  ['Graph: drag, wheel, arrows, + − 0', 'Pan, zoom, pan, zoom, home'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

function btn(label: string, cls: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls, title, 'aria-label': title }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function mountStudio(root: HTMLElement, opts: StudioOptions = {}): Mounted {
  const registry = studioRegistry();
  const session = new KernelSession(registry);
  const raf = opts.raf ?? ((cb: (now: number) => void): number => window.requestAnimationFrame(cb));
  const caf = opts.caf ?? ((h: number): void => window.cancelAnimationFrame(h));

  const status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const say = (text: string): void => {
    status.textContent = text;
  };

  /* ------------------------------ panes ------------------------------ */

  const holder: { expressions?: ExpressionList; tools?: ToolStrip } = {};
  const selection = createSelection();
  const fromCanvas = selectionFrom(selection, 'canvas');
  const hiddenByStyle = (o: { style: { shown: boolean } }): boolean => o.style.shown === false;
  /** A kernel colour as CSS: `{ r, g, b, a }` with channels 0 to 255 (or 0 to 1). */
  const colorCss = (c: unknown): string | undefined => {
    const o = c as { r?: number; g?: number; b?: number; a?: number };
    if (typeof o.r !== 'number' || typeof o.g !== 'number' || typeof o.b !== 'number') return undefined;
    const k = o.r <= 1 && o.g <= 1 && o.b <= 1 ? 255 : 1;
    return `rgba(${Math.round(o.r * k)}, ${Math.round(o.g * k)}, ${Math.round(o.b * k)}, ${o.a ?? 1})`;
  };
  const items = (): SceneItem[] => {
    const out: SceneItem[] = [];
    const expressions = holder.expressions;
    if (!expressions) return out;
    const traced = new Set(tracedIds(session.figure).map((x) => x as unknown as number));
    for (const o of session.figure.objects()) {
      if (!o.cell.defined) continue;
      // a text is drawn on the graph when it has a place (`with at = …`)
      if (o.type === 'Text') {
        const ext = o.style.ext as { at?: { x: number; y: number }; size?: number; anchor?: string; rotate?: number; bg?: unknown; vertical?: boolean; latex?: string };
        if (!ext.at || expressions.isHidden(o.id) || hiddenByStyle(o)) continue;
        const bg = typeof ext.bg === 'object' && ext.bg !== null ? colorCss(ext.bg) : undefined;
        out.push({ id: o.id, name: o.name, type: 'Text', typeText: 'Text', value: o.cell.value, color: expressions.colorOf(o.id), free: false, label: false,
          text: { at: ext.at, size: ext.size ?? 16, anchor: ext.anchor ?? 'sw', rotate: ext.rotate ?? 0, ...(bg ? { bg } : {}), ...(ext.vertical === true ? { vertical: true } : {}), ...(ext.latex === 'full' ? { full: true } : {}) } });
        continue;
      }
      if (expressions.isHidden(o.id)) continue;
      // hidden with `with visible = false`: left out, or drawn faintly while the show/hide tool is on
      if (hiddenByStyle(o) && !holder.tools?.showHidden()) continue;
      if (!drawsOnGraph(o.type, o.typeText, o.cell.value)) continue;
      out.push({ id: o.id, name: o.name, type: o.type, typeText: o.typeText, value: o.cell.value, color: expressions.colorOf(o.id), free: o.type === 'Point' && session.draggable(o.name), label: true, ...(hiddenByStyle(o) ? { ghost: true } : {}), ...(selection.has(o.name) ? { selected: true } : {}), ...(selection.hover() === o.name ? { hovered: true } : {}), ...(o.type === 'Particles' ? { time: session.time() } : {}), ...(traced.has(o.id as unknown as number) ? { trace: tracePoints(session.figure, o.id) as Float64Array } : {}) });
    }
    return out;
  };
  const graph = mountGraph({
    items,
    bounds: () => {
      const all = items();
      const b = sceneBounds(all);
      // data charts and fits may stretch the axes; geometry keeps one unit the same length both ways
      const data = all.some((i) => i.type === 'Chart' || i.type === 'Record' || i.type.endsWith('Distribution') || i.typeText === 'List<Point>');
      const geometry = all.some((i) => ['Circle', 'Arc', 'Polygon', 'Segment', 'Line', 'Ray', 'Vector'].includes(i.type) || i.typeText === 'List<Polygon>' || (i.value as { schema?: string } | undefined)?.schema === 'PieChart');
      return b ? { ...b, y0: data ? Math.min(b.y0, 0) : b.y0, stretch: data && !geometry } : undefined;
    },
    drag: (name, x, y, done) => {
      const r = session.dragPoint(name, x, y, done);
      if (!r.ok) say(r.error.message);
    },
    tool: () => holder.tools?.graphTool,
    // a click on an object selects it; on the background it clears the selection (design 3.9)
    pick: (px, py, vp, extend) => {
      const hit = hitTest(items(), vp, px, py, 8)[0];
      if (!hit) {
        if (!extend) fromCanvas.clear();
        return;
      }
      if (extend) fromCanvas.toggle(hit.name);
      else fromCanvas.set(hit.name);
      say(selection.names().length > 1 ? `Selected ${selection.names().join(', ')}.` : `Selected ${hit.name}.`);
    },
    hoverAt: (px, py, vp) => fromCanvas.setHover(hitTest(items(), vp, px, py, 8)[0]?.name),
  });
  const exprs = mountExpressions({ session, changed: () => graph.redraw(), say, view: () => graph.viewport.box(), selection });
  holder.expressions = exprs;
  const tools = mountToolStrip({
    session, registry, say, host: () => graph.element, items, redraw: () => graph.redraw(), flash: (names) => exprs.flash(names),
    selection: () => selection.names(),
    viewport: () => graph.viewport,
  });
  selection.onChange(() => {
    graph.redraw();
    sim.refresh();
  });
  holder.tools = tools;
  graph.element.append(tools.element, tools.hint);
  const lab = mountDataLab(session, registry, say);
  const calc = mountProbCalc(session, registry, say);
  const sim = mountSimStrip({ session, registry, say, selected: () => selection.names(), ...(opts.every ? { every: opts.every } : {}) });
  graph.element.append(sim.element);
  // the panel's Simulate section opens the strip (ui.md 6)
  calc.element.addEventListener('open-simulation', () => {
    sim.open();
    graph.element.classList.toggle('has-sim', sim.isShown());
  });

  /* ------------------------------ top bar ------------------------------ */

  const undoBtn = btn('↶', 'icon-btn', 'Undo', () => api.undo());
  const redoBtn = btn('↷', 'icon-btn', 'Redo', () => api.redo());
  const examples = el('select', { class: 'examples', 'aria-label': 'Open an example' });
  examples.append(el('option', { value: '' }, 'Examples…'));
  for (const e of EXAMPLES) examples.append(el('option', { value: e.id }, e.title));
  examples.addEventListener('change', () => {
    if (examples.value) api.loadExample(examples.value);
    examples.value = '';
  });
  const labBtn = btn('Data analysis', 'tool-btn', 'Open the data-analysis panel', () => {
    if (lab.isOpen()) lab.close();
    else {
      calc.close();
      calcBtn.classList.remove('on');
      lab.open();
    }
    labBtn.classList.toggle('on', lab.isOpen());
    // the graph changed width: show the same things in the new space
    requestAnimationFrame(() => {
      graph.paint();
      graph.fit();
    });
  });
  const calcBtn = btn('Probability', 'tool-btn', 'Open the probability calculator', () => {
    if (calc.isOpen()) calc.close();
    else {
      lab.close();
      labBtn.classList.remove('on');
      calc.open();
    }
    calcBtn.classList.toggle('on', calc.isOpen());
    requestAnimationFrame(() => {
      graph.paint();
      graph.fit();
    });
  });
  const newBtn = btn('New', 'tool-btn', 'Start a new, empty figure', () => {
    session.load('');
    graph.viewport.home();
    say('New figure.');
  });

  // script dialog: see, copy or load the figure as lines of text
  const script = el('textarea', { class: 'script-text', rows: '14', spellcheck: 'false', 'aria-label': 'Figure script' });
  const dialog = el('dialog', { class: 'script-dialog', 'aria-label': 'Figure script' });
  const report = el('p', { class: 'muted' });
  dialog.append(
    el('h2', {}, 'Figure script'),
    el('p', { class: 'muted' }, 'The figure as lines of text. Load replaces the figure and clears undo.'),
    script,
    report,
    el('div', { class: 'dialog-actions' },
      btn('Copy', 'secondary', 'Copy the script', () => void navigator.clipboard?.writeText(script.value)),
      btn('Load', 'primary', 'Load this script', () => {
        const r = session.load(script.value);
        report.textContent = r.replaced ? `${r.applied} of ${r.total} lines applied${r.errors.length ? `; ${r.errors.length} failed: ${r.errors[0]?.message ?? ''}` : ''}.` : `Nothing loaded: ${r.errors[0]?.message ?? 'no lines'}`;
        if (r.replaced) graph.fit();
      }),
      btn('Close', 'secondary', 'Close', () => dialog.close())),
  );
  const scriptBtn = btn('Script', 'tool-btn', 'See, copy or load the figure as text', () => {
    script.value = session.save();
    report.textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });

  const help = el('dialog', { class: 'script-dialog', 'aria-label': 'Keyboard' });
  const keys = el('table', { class: 'keys' });
  for (const [k, what] of KEYS) keys.append(el('tr', {}, el('th', { scope: 'row' }, k), el('td', {}, what)));
  help.append(el('h2', {}, 'Keyboard'), keys, el('div', { class: 'dialog-actions' }, btn('Close', 'secondary', 'Close', () => help.close())));
  const helpBtn = btn('?', 'icon-btn', 'Keyboard shortcuts', () => (typeof help.showModal === 'function' ? help.showModal() : help.setAttribute('open', '')));

  const top = el('header', { class: 'topbar' },
    el('div', { class: 'brand' }, el('span', { class: 'logo', 'aria-hidden': 'true' }, '∿'), el('span', { class: 'brand-name' }, 'Incantly'), el('span', { class: 'brand-sub' }, 'Studio')),
    el('div', { class: 'top-tools' }, newBtn, examples, labBtn, calcBtn, scriptBtn),
    el('div', { class: 'top-right' }, undoBtn, redoBtn, helpBtn),
  );

  /* ------------------------------ clock ------------------------------ */

  const play = btn('▶', 'icon-btn', 'Play', () => toggleClock());
  const scrub = el('input', { type: 'range', class: 'scrub', 'aria-label': 'Time', step: 'any' });
  const readout = el('output', { class: 'readout' });
  const clock = el('div', { class: 'clock', role: 'group', 'aria-label': 'Clock' }, play, scrub, readout);
  clock.hidden = true;
  let running = 0;
  const tick = (now: number): void => {
    // the kernel's player moves `t`, runs the traces and animated sliders, and starts an ended film again
    session.frame(now / 1000);
    running = raf(tick);
  };
  const toggleClock = (): void => {
    if (running) {
      caf(running);
      running = 0;
      session.pause();
      play.textContent = '▶';
      play.title = 'Play';
    } else {
      session.play();
      running = raf(tick);
      play.textContent = '❚❚';
      play.title = 'Pause';
    }
  };
  scrub.addEventListener('input', () => session.setTime(Number(scrub.value)));
  const syncClock = (): void => {
    const has = session.hasClock();
    clock.hidden = !has;
    if (!has) {
      if (running) toggleClock();
      return;
    }
    const { from, to } = session.range();
    scrub.min = String(from);
    scrub.max = String(to);
    scrub.value = String(session.time());
    readout.textContent = `t = ${session.time().toFixed(2)} s`;
  };

  /* ------------------------------ layout ------------------------------ */

  const panel = el('aside', { class: 'panel', 'aria-label': 'Expressions' },
    el('div', { class: 'panel-head' }, el('span', {}, 'Expressions'), btn('+', 'icon-btn', 'New expression', () => exprs.focusNew())),
    exprs.header,
    exprs.element,
    clock,
    el('footer', { class: 'panel-foot' }, status),
  );
  const split = el('div', { class: 'split', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the expression list', tabindex: '0' });
  const main = el('div', { class: 'workspace' }, panel, split, graph.element, lab.element, calc.element);
  root.replaceChildren(el('div', { class: 'app' }, top, main), dialog, help);

  // dragging the divider resizes the expression list
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent): void => {
      const w = Math.min(Math.max(ev.clientX, 260), window.innerWidth * 0.6);
      panel.style.width = `${w}px`;
      graph.redraw();
    };
    const up = (): void => {
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  });
  split.addEventListener('keydown', (e) => {
    const w = panel.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') panel.style.width = `${Math.max(260, w - 20)}px`;
    else if (e.key === 'ArrowRight') panel.style.width = `${w + 20}px`;
    else return;
    graph.redraw();
  });

  /* ------------------------------ wiring ------------------------------ */

  const sync = (): void => {
    // a deleted object leaves the selection; a renamed one is found by its new name on the next pick
    selection.keep((n) => session.figure.get(n) !== undefined);
    exprs.update();
    const u = session.undoState();
    undoBtn.disabled = !u.canUndo;
    redoBtn.disabled = !u.canRedo;
    undoBtn.title = u.label ? `Undo ${u.label}` : 'Undo';
    syncClock();
    tools.figureChanged();
    lab.refresh();
    calc.refresh();
    sim.refresh();
    graph.element.classList.toggle('has-sim', sim.isShown());
    graph.redraw();
  };
  const off = session.onChange(sync);
  calc.element.addEventListener('lab-closed', () => {
    calcBtn.classList.remove('on');
    requestAnimationFrame(() => {
      graph.paint();
      graph.fit();
    });
  });
  lab.element.addEventListener('lab-closed', () => {
    labBtn.classList.remove('on');
    requestAnimationFrame(() => {
      graph.paint();
      graph.fit();
    });
  });

  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(typing && (target as HTMLInputElement).value !== '')) {
      e.preventDefault();
      if (e.shiftKey) api.redo();
      else api.undo();
      return;
    }
    if (!typing && tools.keyDown(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && !typing && selection.names().length > 0) {
      selection.clear();
      return;
    }
    if (e.key === '/' && !typing) {
      e.preventDefault();
      exprs.focusNew();
    }
  };
  document.addEventListener('keydown', onKey);

  const api: Mounted = {
    session,
    expressions: exprs,
    graph,
    lab,
    calc,
    tools,
    sim,
    selection,
    status,
    loadExample(id) {
      const ex = EXAMPLES.find((e) => e.id === id);
      if (!ex) return;
      const r = session.load(ex.lines.join('\n'));
      say(r.replaced ? `${ex.title}: ${r.applied} of ${r.total} lines.${r.errors.length ? ` ${r.errors[0]?.message ?? ''}` : ''}` : `Could not open ${ex.title}.`);
      sync();
      graph.paint();
      graph.fit();
    },
    undo() {
      const r = session.undo();
      say(r.ok ? r.message : r.error.message);
    },
    redo() {
      const r = session.redo();
      say(r.ok ? r.message : r.error.message);
    },
    dispose() {
      off();
      document.removeEventListener('keydown', onKey);
      tools.dispose();
      sim.dispose();
      graph.dispose();
      if (running) caf(running);
    },
  };
  sync();
  graph.paint();
  return api;
}
