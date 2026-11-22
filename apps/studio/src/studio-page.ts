/**
 * The studio: a top bar, the expression list on the left, the graph on the right, and the data-analysis panel when it
 * is open. Every area built so far is registered, so its commands can be typed and seen.
 */
import type { AppModeId, StorageLike } from '@incantly/modes';
import { createBoard } from '@incantly/board';
import type { BoardView } from '@incantly/board';
import { mountAppModes } from './modes/app';
import { mountSoundUi } from './sound-ui';
import type { SoundUi } from './sound-ui';
import type { SoundEngine } from '@incantly/audio';
import { mountScientific } from './modes/scientific';
import { mountKeyboard } from './modes/keyboard';
import { customBoardOptions, studioBoardOptions } from './board-options';
import { boardAgentOption, connectBoardAgent } from './board-agent';
import { probeServer } from './server';
import { mountExamScreens } from './modes/exam-ui';
import type { ScientificView } from './modes/scientific';
import type { MathKeyboard } from './modes/keyboard';
import type { ExamScreens } from './modes/exam-ui';
import type { AppModes } from './modes/app';
import { mountDataLab } from './datalab';
import { mountCasPanel } from './caspanel';
import { mountSheet } from './sheet/grid';
import type { SheetPanel } from './sheet/grid';
import { loadCasEngine } from './registry';
import type { CasPanel } from './caspanel';
import { mountProbCalc } from './probcalc';
import { mountSimStrip } from './simstrip';
import type { SimStrip } from './simstrip';
import { mountToolStrip } from './tools-ui';
import { contactsItem, physicsMarks, symDrawing } from '@incantly/sdk/screen';
import type { ToolStrip } from './tools-ui';
import type { ProbCalc } from './probcalc';
import type { DataLab } from './datalab';
import { EXAMPLES, examplesFor } from './examples';
import { drawsOnGraph, mountExpressions } from './expressions';
import type { ExpressionList } from './expressions';
import { mountGraph, mountSpace } from '@incantly/sdk/screen';
import type { SpacePane } from '@incantly/sdk/screen';
import type { GraphPane } from '@incantly/sdk/screen';
import { sceneBounds } from '@incantly/sdk/screen';
import type { SceneItem } from '@incantly/sdk/screen';
import { studioRegistry } from './registry';
import { KernelSession } from './session';
import { physicsKernelsActive, tracePoints, tracedIds, worldDriverOf } from '@incantly/kernel';
import { createSelection, selectionFrom } from './selection';
import type { Selection } from './selection';
import { hitTest } from '@incantly/sdk/screen';
import { mountFileMenu } from './files-ui';
import type { FileMenu } from './files-ui';

export interface StudioOptions {
  /** Frame scheduler for the clock; defaults to `requestAnimationFrame`. A test passes its own. */
  readonly raf?: (cb: (now: number) => void) => number;
  readonly caf?: (handle: number) => void;
  /** Repeating timer for the simulation strip's Run; a test passes its own. */
  readonly every?: (ms: number, fn: () => void) => () => void;
  /** The app mode to open in (app-modes design 3.2). Default `classic`: everything. */
  readonly mode?: AppModeId;
  /** Show the start screen with the mode tiles. */
  readonly start?: boolean;
  /** Storage for user settings; `localStorage` by default, `null` for none. */
  readonly storage?: StorageLike | null;
  /** Monotonic clock for exams; `performance.now` by default. */
  readonly now?: () => number;
  /** The sound engine; a test passes its own. */
  readonly soundEngine?: () => Promise<SoundEngine>;
  /** Asks for full screen at the exam start; a test passes its own. */
  readonly requestFullscreen?: () => Promise<boolean>;
  /** Show the Board app as the customised demo (renamed tool, another icon, toolbar on the left, a key removed). */
  readonly boardDemo?: boolean;
}

export interface Mounted {
  readonly session: KernelSession;
  readonly expressions: ExpressionList;
  readonly graph: GraphPane;
  readonly lab: DataLab;
  readonly calc: ProbCalc;
  readonly cas: CasPanel;
  /** The spreadsheet view (spreadsheet ui). */
  readonly sheet: SheetPanel;
  readonly tools: ToolStrip;
  readonly sim: SimStrip;
  /** What is selected in the list and on the canvas (algebra-view design 3.9). */
  readonly selection: Selection;
  readonly status: HTMLElement;
  /** The app mode, its settings and languages (app-modes). */
  readonly modes: AppModes;
  /** The scientific calculator's rows. */
  readonly scientific: ScientificView;
  /** The on-screen maths keyboard. */
  readonly keyboard: MathKeyboard;
  /** Exam mode screens. */
  readonly exam: ExamScreens;
  /** The speaker button and the sound feed. */
  readonly sound: SoundUi;
  /** Replaces the figure with an example's lines. */
  /** Open, save, export and share (embed-files-export ui.md 2 to 5). */
  readonly files: FileMenu;
  /** The Space view of the 3D app (.kiro/specs/space-3d R4.5). */
  readonly space: SpacePane;
  /** The board of the Board (notes) app: the view is made when the app first shows it. */
  readonly board: { readonly element: HTMLElement; view(): BoardView | undefined };
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

  const space3Ref: { current?: SpacePane } = {};
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
        out.push({ id: o.id, name: o.name, type: 'Text', typeText: 'Text', value: o.cell.value, color: expressions.colorOf(o.id, o), free: false, label: false,
          text: { at: ext.at, size: ext.size ?? 16, anchor: ext.anchor ?? 'sw', rotate: ext.rotate ?? 0, ...(bg ? { bg } : {}), ...(ext.vertical === true ? { vertical: true } : {}), ...(ext.latex === 'full' ? { full: true } : {}) } });
        continue;
      }
      if (expressions.isHidden(o.id)) continue;
      // hidden with `with visible = false`: left out, or drawn faintly while the show/hide tool is on
      if (hiddenByStyle(o) && !holder.tools?.showHidden()) continue;
      // a symbolic row with its show switch on (cas ui.md 4, 7)
      if ((o.style.ext as { plot?: unknown }).plot === true) {
        const d = symDrawing(o.cell.value);
        const base = { id: o.id, name: o.name, typeText: o.typeText, color: expressions.colorOf(o.id, o), free: false, label: false, ...(selection.has(o.name) ? { selected: true } : {}), ...(selection.hover() === o.name ? { hovered: true } : {}) };
        if (d?.kind === 'curve') out.push({ ...base, type: 'Function', value: d.fn, holes: d.holes });
        else if (d?.kind === 'relation') out.push({ ...base, type: 'Relation', value: d.value });
        else if (d?.kind === 'axis') out.push({ ...base, type: 'SymAxis', value: d });
        else if (d?.kind === 'points') out.push({ ...base, type: 'List', typeText: 'List<Point>', value: d.pts });
        continue;
      }
      if (!drawsOnGraph(o.type, o.typeText, o.cell.value)) continue;
      out.push({ id: o.id, name: o.name, type: o.type, typeText: o.typeText, value: o.cell.value, color: expressions.colorOf(o.id, o), free: o.type === 'Point' && session.draggable(o.name), label: true, ...physicsMarks(session.figure, o), ...(hiddenByStyle(o) ? { ghost: true } : {}), ...(selection.has(o.name) ? { selected: true } : {}), ...(selection.hover() === o.name ? { hovered: true } : {}), ...(o.type === 'Particles' ? { time: session.time() } : {}), ...(traced.has(o.id as unknown as number) ? { trace: tracePoints(session.figure, o.id) as Float64Array } : {}) });
    }
    const contacts = contactsItem(session.figure);
    if (contacts) out.push(contacts);
    return out;
  };
  const modeRef: { current?: AppModes } = {};
  const graph = mountGraph({
    items,
    style: () => modeRef.current?.frameStyle,
    bounds: () => {
      // the figure's own `@view x0 x1 y0 y1` wins over zoom to fit (it is how a film frames itself)
      const v = /^@view\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$/m.exec(session.save());
      if (v) {
        const [x0, x1, y0, y1] = v.slice(1, 5).map(Number) as [number, number, number, number];
        if (x0 < x1 && y0 < y1) return { x0, x1, y0, y1 };
      }
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
    clickable: (id) => {
      const o = session.figure.get(id as never);
      return o !== undefined && session.clickable(o.name);
    },
    activate: (id) => {
      const o = session.figure.get(id as never);
      if (!o) return;
      const r = session.click(o.name);
      say(r.ok ? `Clicked ${o.name}.` : r.error.message);
    },
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
  const exprs = mountExpressions({ session, changed: () => graph.redraw(), say, view: () => graph.viewport.box(), selection, autoSliders: () => modeRef.current?.mode.defaults.autoSliders ?? true });
  holder.expressions = exprs;
  const tools = mountToolStrip({
    session, registry, say, host: () => graph.element, items, redraw: () => graph.redraw(), flash: (names) => exprs.flash(names),
    selection: () => selection.names(),
    viewport: () => graph.viewport,
  });
  selection.onChange(() => {
    graph.redraw();
    space3Ref.current?.redraw();
    sim.refresh();
  });
  holder.tools = tools;
  graph.element.append(tools.element, tools.hint);
  const lab = mountDataLab(session, registry, say, () => modeRef.current?.frameStyle);
  const calc = mountProbCalc(session, registry, say, () => modeRef.current?.frameStyle);
  const cas = mountCasPanel(session, say);
  const sheet = mountSheet({ session, say, pick: (n) => selection.set(n) });
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
  /** The menu lists the examples made for the app in use (.kiro/specs/mode-examples R1). */
  const fillExamples = (mode: AppModeId, title: (m: AppModeId) => string): void => {
    examples.replaceChildren(el('option', { value: '' }, 'Examples…'));
    const groups = examplesFor(mode);
    for (const g of groups) {
      const into = groups.length > 1 ? el('optgroup', { label: title(g.group) }) : examples;
      for (const e of g.examples) into.append(el('option', { value: e.id }, e.title));
      if (into !== examples) examples.append(into);
    }
    examples.hidden = groups.length === 0;
  };
  examples.addEventListener('change', () => {
    if (examples.value) api.loadExample(examples.value);
    examples.value = '';
  });
  /** One side panel at a time: opening one closes the others. */
  const closeOthers = (keep: 'lab' | 'calc' | 'cas' | 'sheet'): void => {
    if (keep !== 'lab' && lab.isOpen()) lab.close();
    if (keep !== 'calc' && calc.isOpen()) calc.close();
    if (keep !== 'cas' && cas.isOpen()) cas.close();
    if (keep !== 'sheet' && sheet.isOpen()) sheet.close();
    labBtn.classList.toggle('on', lab.isOpen());
    calcBtn.classList.toggle('on', calc.isOpen());
    casBtn.classList.toggle('on', cas.isOpen());
    sheetBtn.classList.toggle('on', sheet.isOpen());
  };
  const openSheet = (): void => {
    closeOthers('sheet');
    sheet.open();
    sheetBtn.classList.add('on');
    requestAnimationFrame(() => {
      graph.paint();
      graph.fit();
    });
  };
  const sheetBtn = btn('Sheet', 'tool-btn', 'Open the spreadsheet: cells are objects', () => {
    if (sheet.isOpen()) {
      sheet.close();
      sheetBtn.classList.remove('on');
      requestAnimationFrame(() => {
        graph.paint();
        graph.fit();
      });
    } else openSheet();
  });
  const casBtn = btn('CAS', 'tool-btn', 'Open the CAS view: algebra row by row', () => {
    if (cas.isOpen()) cas.close();
    else {
      closeOthers('cas');
      cas.open();
      // the engine loads with the view, so the first button press does not wait
      void loadCasEngine();
    }
    casBtn.classList.toggle('on', cas.isOpen());
    requestAnimationFrame(() => {
      graph.paint();
      graph.fit();
    });
  });
  const labBtn = btn('Data analysis', 'tool-btn', 'Open the data-analysis panel', () => {
    if (lab.isOpen()) lab.close();
    else {
      closeOthers('lab');
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
      closeOthers('calc');
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

  const files: FileMenu = mountFileMenu({
    session, graph, say, status,
    expressions: () => holder.expressions,
    mode: () => modeRef.current?.mode.id ?? opts.mode ?? 'classic',
    setMode: (m) => void modeRef.current?.setMode(m, { force: true }),
    size3: () => space3Ref.current?.size(),
  });
  const topTools = el('div', { class: 'top-tools' }, newBtn, files.element, examples, sheetBtn, labBtn, calcBtn, casBtn, scriptBtn);
  const topRight = el('div', { class: 'top-right' }, undoBtn, redoBtn, helpBtn);
  const top = el('header', { class: 'topbar' },
    el('div', { class: 'brand' }, el('span', { class: 'logo', 'aria-hidden': 'true' }, '∿'), el('span', { class: 'brand-name' }, 'Incantly'), el('span', { class: 'brand-sub' }, 'Studio')),
    topTools,
    topRight,
  );

  /* ------------------------------ clock ------------------------------ */

  const play = btn('▶', 'icon-btn', 'Play', () => toggleClock());
  const scrub = el('input', { type: 'range', class: 'scrub', 'aria-label': 'Time', step: 'any' });
  const readout = el('output', { class: 'readout' });
  const perf = el('output', { class: 'perf', 'aria-label': 'Physics speed', title: 'Work per frame, bodies awake, touching points' });
  perf.hidden = true;
  let frameAvg = 0;
  const clock = el('div', { class: 'clock', role: 'group', 'aria-label': 'Clock' }, play, scrub, readout, perf);
  clock.hidden = true;
  let running = 0;
  // physics ui.md 2: when a frame's work goes over its share (6 ms), the film plays slower; the steps never change
  let filmNow = 0;
  let lastNow: number | undefined;
  let pace = 1;
  let mark = '';
  const tick = (now: number): void => {
    const dt = lastNow === undefined ? 0 : Math.max(0, now - lastNow);
    lastNow = now;
    filmNow += dt * pace;
    const t0 = performance.now();
    // the kernel's player moves `t`, runs the traces and animated sliders, and starts an ended film again
    session.frame(filmNow / 1000);
    const cost = performance.now() - t0;
    pace = cost > 6 ? Math.max(0.25, pace * 0.9) : Math.min(1, pace * 1.05);
    const nextMark = session.figure.driversNeedFrames() ? ' · catching up' : pace < 0.95 ? ' · slow' : '';
    if (nextMark !== mark) {
      mark = nextMark;
      clock.title = mark === ' · slow' ? 'This computer is busy. The film is the same, only slower.' : mark === ' · catching up' ? 'The physics is catching up with the time bar.' : '';
    }
    readout.textContent = `t = ${session.time().toFixed(2)} s${mark}`;
    // the physics row of physics ui.md 12: frame time, awake bodies, touching points (in the plane or in space)
    const pd = worldDriverOf(session.figure);
    const w = pd.world;
    perf.hidden = !w && !pd.remote;
    if (w || pd.remote) {
      frameAvg = frameAvg * 0.9 + cost * 0.1;
      // drops when there are any (physics ui.md 12); a world in the worker reports its own counts
      const r = pd.remoteInfo;
      const awake = w ? w.awakeCount() : r.awake;
      const contacts = w ? w.contactCount : r.contacts;
      const drops = w ? (pd.fluid?.ps.n ?? 0) : r.drops;
      const where = pd.remote ? ' · in a worker' : '';
      // which loops the cloth and liquid solvers run: Rust (WebAssembly) or TypeScript, the same film (design 11.6)
      const rust = w ? physicsKernelsActive(session.figure) : r.kernels;
      const loops = rust === undefined ? '' : rust ? ' · Rust' : ' · TypeScript';
      // and cloth points when there are any (round 9)
      const points = w ? (pd.cloth?.n ?? 0) : (r.cloth ?? 0);
      const dropsText = (w ? pd.fluid !== undefined : r.drops > 0 || points === 0) ? ` · ${drops} drops` : '';
      perf.textContent = `${frameAvg.toFixed(1)} ms · ${awake} awake · ${contacts} contacts${dropsText}${points > 0 ? ` · ${points} cloth points` : ''}${loops}${where}`;
      // over 6 ms on the page, or 8 ms when the world is in the worker, the readout turns amber (ui.md 12)
      perf.classList.toggle('busy', frameAvg > (pd.remote ? 8 : 6));
    }
    // a spinning camera changes no object, so the Space view is told each frame
    if (!space3Ref.current?.element.hidden) space3Ref.current?.redraw();
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
      lastNow = undefined;
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
  // the Space view: camera gestures write lines as the learner, drags move points in space (.kiro/specs/space-3d R4)
  const space3 = mountSpace({
    figure: () => session.figure,
    scene: () => ({ hidden: (o) => exprs.isHidden(o.id), selected: new Set(selection.names()) }),
    write: (line) => {
      const r = session.applyLines([line], 'view', 'independent', 'learner');
      if (!r.ok) say(r.error.message);
    },
    drag: (name, p, done) => {
      const r = session.dragPoint(name, p.x, p.y, done, p.z);
      return r.ok ? undefined : r.error.message;
    },
    draggable: (name) => session.draggable(name),
    // the arrow keys drive a car in space: they move the sliders its pedals read (physics ui.md 9)
    slide: (name, value, done) => {
      const r = session.slide(name, value, done);
      if (!r.ok) say(r.error.message);
      else sync();
    },
    select: (name) => (name ? fromCanvas.set(name) : fromCanvas.clear()),
    say,
    // no WebGL 2: cloth and drops are drawn coarser, said once (physics errors.md 5, 7)
    notice: (n) => say(n.message),
  });
  space3.element.hidden = true;
  space3Ref.current = space3;
  // the board of the Board app (design of the board, round 2): made on first show, so other apps never open a GPU context for it
  const boardHost = el('section', { class: 'board-host', 'aria-label': 'Board' });
  boardHost.hidden = true;
  const boardRef: { current?: BoardView } = {};
  const boardPane = {
    open: (): void => {
      boardHost.hidden = false;
      if (boardRef.current === undefined) {
        const made = createBoard({
          container: boardHost,
          onError: (e) => say(e.message),
          // the scripted stand-in, labelled "no AI"; where the server answers, `connectBoardAgent` swaps it for the server's
          agent: boardAgentOption(),
          ...studioBoardOptions(() => modeRef.current?.i18n),
          // `?board=custom`: the customised board of the demo
          ...(opts.boardDemo === true ? customBoardOptions : {}),
        });
        if (made.ok && made.value.view !== undefined) {
          const view = made.value.view;
          boardRef.current = view;
          void probeServer().then((health) => connectBoardAgent(view, health));
        } else say(made.ok ? 'The board could not be shown.' : made.message);
      } else {
        boardRef.current.resize();
      }
    },
    close: (): void => {
      boardHost.hidden = true;
    },
    isOpen: (): boolean => !boardHost.hidden,
  };
  const main = el('div', { class: 'workspace' }, panel, split, graph.element, space3.element, sheet.element, lab.element, calc.element, cas.element, boardHost);
  const appEl = el('div', { class: 'app' }, top, main);
  root.replaceChildren(appEl, dialog, help, ...files.dialogs);

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
    cas.refresh();
    sheet.refresh();
    sciHolder.current?.refresh();
    soundHolder.current?.refresh();
    sim.refresh();
    graph.element.classList.toggle('has-sim', sim.isShown());
    graph.redraw();
    space3.redraw();
  };
  const off = session.onChange(sync);
  calc.element.addEventListener('lab-closed', () => {
    calcBtn.classList.remove('on');
    requestAnimationFrame(() => {
      graph.paint();
      graph.fit();
    });
  });
  sheet.element.addEventListener('lab-closed', () => {
    sheetBtn.classList.remove('on');
    requestAnimationFrame(() => {
      graph.paint();
      graph.fit();
    });
  });
  cas.element.addEventListener('lab-closed', () => {
    casBtn.classList.remove('on');
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
    // the board answers its own keys (tools, undo, Space for the hand)
    if (target !== null && boardHost.contains(target)) return;
    const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(typing && (target as HTMLInputElement).value !== '')) {
      e.preventDefault();
      if (e.shiftKey) api.redo();
      else api.undo();
      return;
    }
    if (files.keyDown(e)) {
      e.preventDefault();
      return;
    }
    // arrow keys give a selected body a small push, Shift five times as much (physics ui.md 4)
    const pushDir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const dir = pushDir[e.key];
    if (!typing && dir) {
      const bodies = selection.names().filter((n) => session.figure.get(n.replace(/\[\d+\]$/, ''))?.type === 'Body');
      if (bodies.length > 0) {
        e.preventDefault();
        const k = e.shiftKey ? 5 : 1;
        const r = session.applyLines(bodies.map((n) => `Push(${n}, (${dir[0] * k}, ${dir[1] * k}))`), 'push', 'independent', 'learner');
        say(r.ok ? `Pushed ${bodies.join(', ')}.` : r.error.message);
        return;
      }
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

  const relayout = (): void => {
    requestAnimationFrame?.(() => {
      graph.paint();
      graph.fit();
    });
  };
  const storage = opts.storage !== undefined ? opts.storage : (() => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  })();
  const sciHolder: { current?: ScientificView } = {};
  const soundHolder: { current?: SoundUi } = {};
  const examHolder: { current?: ExamScreens } = {};
  const modes = mountAppModes({
    app: appEl,
    session,
    tools,
    panes: { algebra: panel, split, graphics: graph.element, space: space3.element },
    views: {
      datalab: { open: () => lab.open(), close: () => lab.close(), isOpen: () => lab.isOpen(), button: labBtn },
      distribution: { open: () => calc.open(), close: () => calc.close(), isOpen: () => calc.isOpen(), button: calcBtn },
      cas: { open: () => {
        cas.open();
        void loadCasEngine();
      }, close: () => cas.close(), isOpen: () => cas.isOpen(), button: casBtn },
      sheet: { open: () => openSheet(), close: () => sheet.close(), isOpen: () => sheet.isOpen(), button: sheetBtn },
      results: { open: () => sciHolder.current?.open(), close: () => sciHolder.current?.close(), isOpen: () => sciHolder.current?.isOpen() ?? false },
      board: boardPane,
    },
    canSwitch: () => {
      const st = examHolder.current?.controller()?.state;
      return st === 'active' || st === 'finished' ? 'The app cannot change during an exam.' : undefined;
    },
    buttons: { script: scriptBtn, examples, newFigure: newBtn },
    topTools,
    topRight,
    say,
    relayout,
    setRounding: (r) => exprs.setPrefs({ format: { ...exprs.prefs().format, decimals: r.mode === 'decimals' ? r.digits : exprs.prefs().format.decimals, significant: r.mode === 'sig' ? r.digits : null } }),
    storage,
  }, opts.mode ?? 'classic');
  modeRef.current = modes;
  const scientific = mountScientific(session, modes.settings, modes.i18n, say);
  sciHolder.current = scientific;
  main.append(scientific.element);
  const keyboard = mountKeyboard({ i18n: modes.i18n, catalogue: modes.catalogue, mode: modes.mode, onLayout: relayout });
  keyboard.setDefaultTarget(root.querySelector<HTMLInputElement>('.expr-new .expr-input') ?? undefined);
  keyboard.onToggle((what) => (what === 'exact' ? scientific.toggleExact() : scientific.toggleAngle()));
  appEl.append(keyboard.element);
  topRight.prepend(keyboard.toggleButton);
  const sessionStore = (() => {
    try {
      return opts.storage === null ? null : typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
      return null;
    }
  })();
  const exam = mountExamScreens({
    session, settings: modes.settings, i18n: modes.i18n, catalogue: modes.catalogue, mode: modes.mode, say,
    narrowed: (m) => {
      modes.setNarrowed(m);
      keyboard.setMode(m ?? modes.mode);
    },
    session_storage: sessionStore,
    ...(opts.every ? { every: opts.every } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.requestFullscreen ? { requestFullscreen: opts.requestFullscreen } : {}),
  });
  examHolder.current = exam;
  const sound = mountSoundUi({ session, say, ...(opts.soundEngine ? { engine: opts.soundEngine } : {}), raf, caf });
  soundHolder.current = sound;
  (graph.element.querySelector('.graph-controls') ?? graph.element).append(sound.button);
  sound.setVolume(modes.settings.get<number>('masterVolume') / 100);
  modes.settings.onChange('masterVolume', (_id, v) => sound.setVolume(Number(v) / 100));
  // "Start with sound on" (sound ui): the browser still needs a gesture, so the first click anywhere turns it on
  const firstGesture = (): void => {
    document.removeEventListener('pointerdown', firstGesture, true);
    if (modes.settings.get<boolean>('soundOnStart') && !sound.isOn() && !sound.button.hidden) void sound.enable();
  };
  document.addEventListener('pointerdown', firstGesture, true);
  sound.refresh();
  topRight.prepend(exam.button);
  appEl.prepend(exam.banner);
  appEl.append(exam.awayNotice, exam.startDialog, exam.finishDialog);
  const sciShown = (): void => {
    const sci = modes.mode.views.initial.includes('results');
    if (sci) scientific.open();
    else scientific.close();
    keyboard.setDefaultTarget(sci ? scientific.input : (root.querySelector<HTMLInputElement>('.expr-new .expr-input') ?? undefined));
    // the scientific keyboard is always shown (ui 2)
    if (sci) keyboard.open();
  };
  const titleOf = (id: AppModeId): string => modes.i18n.t(`mode.${id}.title`);
  fillExamples(modes.mode.id, titleOf);
  modes.onChange((m) => {
    fillExamples(m.id, titleOf);
    keyboard.setMode(m);
    exam.setMode(m);
    sciShown();
    placeClock();
  });
  /** The play bar sits under the list; with no list (geometry) it floats on the graph, so films can still play. */
  const foot = panel.querySelector('.panel-foot');
  const placeClock = (): void => {
    if (panel.hidden && !graph.element.hidden) {
      clock.classList.add('clock-float');
      graph.element.append(clock);
    } else if (clock.parentElement !== panel) {
      clock.classList.remove('clock-float');
      panel.insertBefore(clock, foot);
    }
  };
  sciShown();
  placeClock();
  if (opts.start) modes.showStart();

  const api: Mounted = {
    files,
    space: space3,
    board: { element: boardHost, view: () => boardRef.current },
    modes,
    scientific,
    keyboard,
    exam,
    sound,
    session,
    expressions: exprs,
    graph,
    lab,
    calc,
    cas,
    sheet,
    tools,
    sim,
    selection,
    status,
    loadExample(id) {
      const ex = EXAMPLES.find((e) => e.id === id);
      if (!ex) return;
      const r = session.load(ex.lines.join('\n'));
      say(r.replaced ? `${ex.title}: ${r.applied} of ${r.total} lines.${r.errors.length ? ` ${r.errors[0]?.message ?? ''}` : ''}` : `Could not open ${ex.title}.`);
      // a figure with a sheet opens it, where the app has one (spreadsheet ui 1)
      if (session.figure.directive('sheet') && !sheetBtn.hidden && !sheet.isOpen()) openSheet();
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
      sound.dispose();
      document.removeEventListener('pointerdown', firstGesture, true);
      exam.dispose();
      keyboard.dispose();
      modes.dispose();
      off();
      document.removeEventListener('keydown', onKey);
      tools.dispose();
      sim.dispose();
      graph.dispose();
      boardRef.current?.dispose();
      if (running) caf(running);
    },
  };
  sync();
  graph.paint();
  return api;
}
