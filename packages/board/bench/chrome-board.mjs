/**
 * The board in real Chrome with the CPU slowed 4 times (board design 13): the studio's Board mode driven with real
 * input through the DevTools protocol (a pen's pointer events, wheel events), the numbers read from the page.
 *
 * Run from the repository root:
 *   PLAYWRIGHT_DIR=/path/with/node_modules/playwright-core node packages/board/bench/chrome-board.mjs
 *     [--rate 4] [--rows pen,gc,pan,fit,zoom,cards,lasso,switch,open] [--stroke 10] [--md handoff/board/bench.md] [--headed]
 *
 * Playwright is not a dependency of the repository (docs/design/libraries.md): point PLAYWRIGHT_DIR at a folder where
 * it is installed. Chrome itself is the installed one (`channel: 'chrome'`). The studio is served by Vite on a free
 * port of 127.0.0.1. The boards (10,000 shapes, 2,000 strokes) are made by `chrome/data.ts` with the board's own core
 * and pasted in as a board copy; the "open a board" row uses the page `chrome/index.html`.
 *
 * What is measured, and how:
 * - A frame's script time is the time spent in the page's animation-frame callbacks plus the input handlers (pointer,
 *   wheel, paste) that ran since the previous frame, as a patched `requestAnimationFrame` and `addEventListener` see it.
 *   Browser work after the script (raster, compositing) is not in it.
 * - Pen sample to pixel is the time from a pen sample's own timestamp (every coalesced sample of a pointermove) to the
 *   end of the animation frame that draws it on the live canvas; the next frame's start is given too, as the bound by
 *   which it has been on screen.
 * - Collections are counted from a protocol trace (`v8` and `devtools.timeline`: MinorGC and MajorGC) over a stroke of
 *   `--stroke` seconds; an idle page of the same length is counted too, for what the browser does alone.
 * The script exits 1 when a row is over its goal.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const flag = (name) => process.argv.includes(`--${name}`);
const rate = Number(arg('rate', '4'));
const strokeSeconds = Number(arg('stroke', '10'));
const ALL = ['pen', 'gc', 'pan', 'fit', 'zoom', 'cards', 'lasso', 'switch', 'open'];
const rows = arg('rows', ALL.join(',')).split(',');
const out = (s) => process.stdout.write(`${s}\n`);

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'index.js') : import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  ({ chromium } = require('playwright'));
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sorted = (a) => Float64Array.from(a).sort();
const pct = (a, q) => {
  if (a.length === 0) return Number.NaN;
  const s = sorted(a);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};
const mean = (a) => (a.length === 0 ? Number.NaN : Array.from(a).reduce((x, y) => x + y, 0) / a.length);
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

/** The goals of design 13 that a screen decides (the others are Node rows). `by` is the number the goal is compared with. */
const GOALS = {
  pen: { what: 'Pen sample to pixel (sample to end of its frame), 60 Hz', goal: 16, unit: 'ms', by: 'mean' },
  penframe: { what: 'One frame while drawing a stroke (script)', goal: 2, unit: 'ms', by: 'mean' },
  gc: { what: 'Collections over a 10 s stroke', goal: 0, unit: '', by: 'count' },
  pan: { what: 'Pan, 10,000 shapes, 1:1 (script, 95th percentile)', goal: 8, unit: 'ms', by: 'p95' },
  fit: { what: 'Pan, 10,000 shapes, all in view (script, 95th percentile)', goal: 8, unit: 'ms', by: 'p95' },
  zoom: { what: 'Zoom, 10,000 shapes (script, 95th percentile)', goal: 8, unit: 'ms', by: 'p95' },
  cards: { what: 'Pan, 2,000 strokes + 3 live cards (script, 95th percentile)', goal: 8, unit: 'ms', by: 'p95' },
  lasso: { what: 'Lasso of 2,000 strokes (pointer-up handler)', goal: 4, unit: 'ms', by: 'value' },
  switch: { what: 'Switch to a page of 2,000 shapes (click to all tiles drawn)', goal: 100, unit: 'ms', by: 'value' },
  open: { what: 'Open a 1,000-shape board (call to first picture)', goal: 200, unit: 'ms', by: 'value' },
};
const results = [];
const record = (key, value, detail, extra) => {
  const g = GOALS[key];
  const ok = value <= g.goal;
  results.push({ key, what: g.what, goal: g.goal, unit: g.unit, by: g.by, value, ok, detail, extra });
  out(`${ok ? 'ok  ' : 'MISS'}  ${g.what.padEnd(62)} ${fmt(value)} ${g.unit}  (goal ${g.goal} ${g.unit}, ${g.by})  ${detail}`);
};

// ---------------------------------------------------------------------------------------------------------------
// what the page reports

/** Runs in every page before its own scripts: the frame, handler and sample recorder. */
function instrument() {
  // the garbage row reads the page with nothing of ours in it; `#plain-nocoalesced` also hides the browser's coalesced
  // events, which make garbage of their own (see the garbage row)
  if (location.hash.startsWith('#plain')) {
    if (location.hash === '#plain-nocoalesced') Object.defineProperty(PointerEvent.prototype, 'getCoalescedEvents', { value: undefined });
    return;
  }
  const B = {
    on: false,
    // one entry per animation-frame callback: the frame's time, its length, the handlers' time since the last callback
    cbT: [],
    cbStart: [],
    cbEnd: [],
    cbHandlers: [],
    bucket: 0,
    samples: [],
    handler: {},
    marks: [],
  };
  window.__b = B;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const s = performance.now();
      try {
        cb(t);
      } finally {
        if (B.on) {
          B.cbT.push(t);
          B.cbStart.push(s);
          B.cbEnd.push(performance.now());
          B.cbHandlers.push(B.bucket);
          B.bucket = 0;
        }
      }
    });
  const HOT = new Set(['pointerdown', 'pointermove', 'pointerup', 'wheel', 'paste', 'click', 'keydown']);
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (!HOT.has(type) || typeof fn !== 'function') return add.call(this, type, fn, opts);
    const timed = function (e) {
      const s = performance.now();
      try {
        return fn.call(this, e);
      } finally {
        const d = performance.now() - s;
        if (B.on) {
          B.bucket += d;
          const h = (B.handler[type] ??= { n: 0, total: 0, max: 0, last: 0 });
          h.n++;
          h.total += d;
          h.last = d;
          if (d > h.max) h.max = d;
        }
      }
    };
    return add.call(this, type, timed, opts);
  };
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!B.on) return;
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      if (list.length === 0) B.samples.push(e.timeStamp);
      else for (const c of list) B.samples.push(c.timeStamp);
    },
    true,
  );
  B.reset = () => {
    B.cbT.length = B.cbStart.length = B.cbEnd.length = B.cbHandlers.length = B.samples.length = 0;
    B.bucket = 0;
    B.handler = {};
  };
  B.take = () => ({ cbT: B.cbT.slice(), cbStart: B.cbStart.slice(), cbEnd: B.cbEnd.slice(), cbHandlers: B.cbHandlers.slice(), samples: B.samples.slice(), handler: B.handler });
}

/** The frames of a take: callbacks with one animation-frame time are one frame. */
function framesOf(t) {
  const frames = [];
  for (let i = 0; i < t.cbT.length; i++) {
    const last = frames[frames.length - 1];
    const cb = t.cbEnd[i] - t.cbStart[i];
    if (last !== undefined && last.t === t.cbT[i]) {
      last.script += cb + t.cbHandlers[i];
      last.end = t.cbEnd[i];
    } else {
      frames.push({ t: t.cbT[i], start: t.cbStart[i], end: t.cbEnd[i], script: cb + t.cbHandlers[i] });
    }
  }
  return frames;
}

/** For each sample, the time to the end of the first frame that starts after it, and to the start of the frame after that. */
function latencies(t, frames) {
  const toEnd = [];
  const toNext = [];
  let f = 0;
  for (const ts of t.samples) {
    while (f < frames.length && frames[f].start < ts) f++;
    if (f >= frames.length) break;
    toEnd.push(frames[f].end - ts);
    if (f + 1 < frames.length) toNext.push(frames[f + 1].start - ts);
  }
  return { toEnd, toNext };
}

// ---------------------------------------------------------------------------------------------------------------
// servers and the browser

const dataServer = await createServer({
  root: path.join(here, 'chrome'),
  configFile: false,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: await freePort(), strictPort: true, fs: { allow: [root] } },
});
await dataServer.listen();
const dataUrl = dataServer.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${dataServer.config.server.port}/`;
const data = await dataServer.ssrLoadModule(path.join(here, 'chrome', 'data.ts'));
const studioPort = await freePort();
const studio = await createServer({ root: path.join(root, 'apps/studio'), logLevel: 'error', server: { host: '127.0.0.1', port: studioPort, strictPort: true } });
await studio.listen();
const studioUrl = `http://127.0.0.1:${studioPort}/?mode=notes`;

const browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed'), args: flag('swiftshader') ? ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] : [] });
const logs = [];
const version = browser.version();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await context.addInitScript(instrument);
  const page = await context.newPage();
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) logs.push(`error: ${r.status()} ${r.url()}`);
  });
  const cdp = await context.newCDPSession(page);
  const throttle = (r) => cdp.send('Emulation.setCPUThrottlingRate', { rate: r });

  const openStudio = async (plain = false) => {
    await page.goto(plain ? `${studioUrl}#${plain === true ? 'plain' : plain}` : studioUrl);
    await page.waitForSelector('.ib-view');
    await sleep(500);
  };
  const info = () => page.evaluate(() => ({ ...document.querySelector('.ib-view').dataset }));
  const waitFor = async (pred, what, ms = 60_000) => {
    try {
      await page.waitForFunction(pred, null, { timeout: ms, polling: 100 });
    } catch {
      throw new Error(`timed out waiting for ${what}; the board says ${JSON.stringify(await info())}; ${logs.slice(-5).join(' | ')}`);
    }
  };
  const surface = async () => {
    const box = await page.locator('.ib-surface').boundingBox();
    return box;
  };
  const paste = async (text, x = 600, y = 400) => {
    const box = await surface();
    await page.mouse.move(box.x + x, box.y + y);
    await page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      document.querySelector('.ib-view').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
  };
  const tool = (id) => page.evaluate((i) => document.querySelector(`.ib-tools [data-tool=${i}]`).click(), id);
  /** Pastes a copy, lets the board settle, puts the selection down and takes the hand. */
  const load = async (text, shapes) => {
    await paste(text);
    await waitFor(`() => Number(document.querySelector('.ib-view').dataset.shapes) >= ${shapes}`, `${shapes} shapes`);
    await sleep(500);
    await page.focus('.ib-surface');
    await page.keyboard.press('Escape');
    await tool('hand');
    await sleep(300);
  };
  /** One CDP mouse event as a pen. */
  const pen = (type, x, y, pressure) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && pressure === 0 ? 'none' : 'left', buttons: type === 'mouseReleased' || pressure === 0 ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: pressure });
  const mouse = (type, x, y, down) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: type === 'mouseReleased' || !down ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const wheel = (x, y, dx, dy, ctrl) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers: ctrl ? 2 : 0 });
  /**
   * Calls `step(i)` every `ms` for `seconds`, on a fixed schedule (a slow call does not move the next). The calls are not
   * waited for one by one: the browser answers an input event when its frame has run, so waiting would tie the input to
   * the frames; they are all waited for at the end.
   */
  const every = async (ms, seconds, step) => {
    const t0 = performance.now();
    const n = Math.floor((seconds * 1000) / ms);
    const sent = [];
    for (let i = 0; i < n; i++) {
      const due = t0 + i * ms;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
      sent.push(step(i));
    }
    await Promise.all(sent);
  };
  /** The functions the page spent its time in, from a CPU profile of the protocol (with `--cpu`). */
  const topFunctions = (profile, n = 12) => {
    const self = new Map();
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const dt = profile.timeDeltas;
    for (let i = 0; i < profile.samples.length; i++) {
      const node = byId.get(profile.samples[i]);
      const f = node.callFrame;
      const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms ${((100 * v) / total).toFixed(0).padStart(3)}%  ${k}`);
  };
  const recorded = async (fn) => {
    await page.evaluate(() => {
      window.__b.reset();
      window.__b.on = true;
    });
    if (flag('cpu')) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    await fn();
    await sleep(120);
    if (flag('cpu')) {
      const { profile } = await cdp.send('Profiler.stop');
      out(topFunctions(profile).join('\n'));
      out('');
    }
    const t = await page.evaluate(() => {
      window.__b.on = false;
      return window.__b.take();
    });
    return t;
  };
  const stroke = async (seconds, x0, y0) => {
    // 120 pen samples a second along a wave, the pressure rising and falling
    const hz = 120;
    await pen('mouseMoved', x0, y0, 0);
    await pen('mousePressed', x0, y0, 0.5);
    await every(1000 / hz, seconds, (i) => pen('mouseMoved', x0 + ((i * 0.6) % 900), y0 + 120 * Math.sin(i / 45) + 30 * Math.sin(i / 7), 0.3 + 0.5 * Math.abs(Math.sin(i / 60))));
    await pen('mouseReleased', x0, y0, 0.5);
  };

  out(`Chrome ${version}, CPU ×${rate}, 1280 × 800 at 1:1, stroke ${strokeSeconds} s`);
  await openStudio();
  out(`backend ${(await info()).backend}`);
  await throttle(rate);

  // ---- the pen: sample to pixel, frame script time while drawing
  if (rows.includes('pen')) {
    await tool('pen');
    const box = await surface();
    // a stroke to warm the paths, then the one that is timed
    await stroke(2, box.x + 120, box.y + 300);
    await page.evaluate(() => window.__b.reset());
    const t = await recorded(() => stroke(strokeSeconds, box.x + 120, box.y + 400));
    const frames = framesOf(t);
    const lat = latencies(t, frames);
    if (flag('debug')) {
      const t0 = frames[100].start;
      out(frames.slice(100, 112).map((f) => `frame ${fmt(f.start - t0)}..${fmt(f.end - t0)} t=${fmt(f.t - t0)}`).join('\n'));
      out(`samples ${t.samples.slice(100, 124).map((x) => fmt(x - t0)).join(' ')}`);
    }
    const script = frames.map((f) => f.script);
    record('pen', mean(lat.toEnd), `mean ${fmt(mean(lat.toEnd))}, 95% ${fmt(pct(lat.toEnd, 0.95))}, worst ${fmt(Math.max(...lat.toEnd))}; to the next frame's start mean ${fmt(mean(lat.toNext))}, 95% ${fmt(pct(lat.toNext, 0.95))}; ${lat.toEnd.length} samples in ${frames.length} frames`, { mean: mean(lat.toEnd), p95: pct(lat.toEnd, 0.95), worst: Math.max(...lat.toEnd), nextMean: mean(lat.toNext), nextP95: pct(lat.toNext, 0.95) });
    record('penframe', mean(script), `mean ${fmt(mean(script))}, 95% ${fmt(pct(script, 0.95))}, worst ${fmt(Math.max(...script))}; ${frames.length} frames; handlers: ${Object.entries(t.handler).map(([k, h]) => `${k} ${fmt(h.total / h.n, 3)} ms ×${h.n}`).join(', ')}`, { mean: mean(script), p95: pct(script, 0.95), worst: Math.max(...script) });
  }

  // ---- garbage: collections over a stroke, and over an idle page
  if (rows.includes('gc')) {
    await openStudio(flag('nocoalesced') ? 'plain-nocoalesced' : true);
    await throttle(rate);
    await tool('pen');
    const box = await surface();
    await stroke(2, box.x + 120, box.y + 300);
    const trace = async (fn) => {
      const events = [];
      cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
      const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
      // start from an empty young generation, so what is counted is what the stroke makes
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('Tracing.start', { categories: 'v8,devtools.timeline,disabled-by-default-v8.gc', transferMode: 'ReportEvents' });
      await fn();
      await cdp.send('Tracing.end');
      await done;
      cdp.removeAllListeners('Tracing.dataCollected');
      return events;
    };
    const gcs = (events) => {
      const by = {};
      for (const e of events) {
        if (e.ph === 'X' || e.ph === 'B' || e.ph === 'I') {
          if (e.name === 'MinorGC' || e.name === 'MajorGC' || e.name === 'V8.GCScavenger' || e.name === 'V8.GCCompactor') by[e.name] = (by[e.name] ?? 0) + 1;
        }
      }
      return by;
    };
    const idle = gcs(await trace(() => sleep(strokeSeconds * 1000)));
    const drawn = gcs(await trace(() => stroke(strokeSeconds, box.x + 120, box.y + 400)));
    if (flag('profile')) {
      // where the page's script allocates while drawing, garbage included: the sampling heap profiler of the protocol
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 128, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await stroke(strokeSeconds, box.x + 120, box.y + 400);
      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      const by = new Map();
      const walk = (n, trail) => {
        const f = n.callFrame;
        const here = [...trail, `${f.functionName || '(anonymous)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`];
        if (n.selfSize > 0) {
          const key = here.slice(-4).reverse().join(' < ');
          by.set(key, (by.get(key) ?? 0) + n.selfSize);
        }
        for (const c of n.children) walk(c, here);
      };
      walk(profile.head, []);
      const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
      const total = [...by.values()].reduce((a, b) => a + b, 0);
      out(`allocation while drawing ${strokeSeconds} s: ${(total / 1024).toFixed(0)} KB`);
      for (const [k, v] of top) out(`  ${(v / 1024).toFixed(1).padStart(8)} KB  ${k}`);
    }
    const count = (o) => (o.MinorGC ?? 0) + (o.MajorGC ?? 0);
    record('gc', count(drawn), `drawing: ${JSON.stringify(drawn)}; idle page for the same time: ${JSON.stringify(idle)}`, { drawn, idle });
  }

  // ---- 10,000 shapes: pan at 1:1, pan with everything in view, zoom
  if (rows.some((r) => ['pan', 'fit', 'zoom'].includes(r))) {
    await openStudio();
    await throttle(1);
    const text = data.copyOf(10_000, arg('mix', 'mixed'));
    await load(text, 10_000);
    const i0 = await info();
    out(`10,000 shapes pasted: ${i0.shapes} shapes, ${i0.tiles} tiles`);
    await throttle(rate);
    const box = await surface();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const panRun = async (seconds) => {
      // a trackpad's pan: a wheel step of 14 by 6 pixels each frame, back and forth so the board stays in reach
      await every(1000 / 60, seconds, (i) => wheel(cx, cy, Math.floor(i / 120) % 2 === 0 ? 14 : -14, Math.floor(i / 120) % 2 === 0 ? 6 : -6, false));
    };
    const report = (key, t, label) => {
      const frames = framesOf(t);
      const script = frames.map((f) => f.script);
      const gaps = [];
      for (let i = 1; i < frames.length; i++) gaps.push(frames[i].start - frames[i - 1].start);
      const fps = frames.length / ((frames[frames.length - 1].start - frames[0].start) / 1000);
      record(key, pct(script, 0.95), `${label}: mean ${fmt(mean(script))}, 95% ${fmt(pct(script, 0.95))}, worst ${fmt(Math.max(...script))}; ${frames.length} frames, ${fmt(fps, 1)} frames/s, 95% of frame gaps ${fmt(pct(gaps, 0.95))} ms`, { mean: mean(script), p95: pct(script, 0.95), worst: Math.max(...script), fps });
    };
    if (rows.includes('pan')) {
      // zoom 1:1 first (the paste sits where the pointer was; go to the middle of the strokes)
      await page.evaluate(() => document.querySelector('[data-action=zoom-fit]').click());
      await sleep(300);
      await page.evaluate(() => [...document.querySelectorAll('.ib-view button')].find((b) => b.textContent === '1:1').click());
      await sleep(1500);
      await panRun(1);
      const t = await recorded(() => panRun(6));
      report('pan', t, `zoom ${(await page.evaluate(() => document.querySelector('.ib-view output')?.value))}, tiles ${(await info()).tiles}`);
    }
    if (rows.includes('fit')) {
      await page.evaluate(() => document.querySelector('[data-action=zoom-fit]').click());
      await sleep(1500);
      await panRun(1);
      const t = await recorded(() => panRun(6));
      report('fit', t, `zoom ${(await page.evaluate(() => document.querySelector('.ib-view output')?.value))}, tiles ${(await info()).tiles}`);
    }
    if (rows.includes('zoom')) {
      // a pinch: 2.4 s in 40 frames of 3.5% (a factor of 4), a pause for the tiles of the new step, then out again; three times
      await page.evaluate(() => document.querySelector('[data-action=zoom-fit]').click());
      await sleep(1500);
      const gesture = [];
      const settle = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const dir of [-1, 1]) {
          const t = await recorded(() => every(1000 / 60, 40 / 60, () => wheel(cx, cy, 0, 2 * dir, true)));
          gesture.push(...framesOf(t).map((f) => f.script));
          if (flag('debug')) out(`gesture ${dir}: ${framesOf(t).map((f) => fmt(f.script, 1)).join(' ')}`);
          const u = await recorded(() => sleep(900));
          settle.push(...framesOf(u).map((f) => f.script));
        }
      }
      const all = [...gesture, ...settle];
      record('zoom', pct(all, 0.95), `moving: ${gesture.length} frames, mean ${fmt(mean(gesture))}, 95% ${fmt(pct(gesture, 0.95))}, worst ${fmt(Math.max(...gesture))}; the tiles of the new step after it: ${settle.length} frames, mean ${fmt(mean(settle))}, 95% ${fmt(pct(settle, 0.95))}, worst ${fmt(Math.max(...settle))}`, { gesture: { mean: mean(gesture), p95: pct(gesture, 0.95), worst: Math.max(...gesture) }, settle: { mean: mean(settle), p95: pct(settle, 0.95), worst: Math.max(...settle) } });
    }
  }

  // ---- 2,000 strokes and 3 live graph cards, panning
  if (rows.includes('cards')) {
    await openStudio();
    await throttle(1);
    await load(data.copyOf(2_000, 'strokes'), 2_000);
    const scripts = ['# incantly 1\n@axes on\n@grid major\nf(x) = x^2 - 2\nA = (1, 1)\n', '# incantly 1\n@axes on\n@grid major\nf(x) = sin(x)\n', '# incantly 1\n@axes on\n@grid major\ng(x) = cos(x)\nh(x) = x/2\n'];
    const at = [[300, 250], [640, 250], [980, 250]];
    for (let i = 0; i < 3; i++) {
      await paste(scripts[i], at[i][0], at[i][1]);
      await sleep(800);
      await page.focus('.ib-surface');
      await page.keyboard.press('Escape');
    }
    await tool('hand');
    await page.evaluate(() => document.querySelector('[data-action=zoom-fit]').click());
    await sleep(2500);
    out(`cards: ${JSON.stringify(await info())}`);
    await throttle(rate);
    const box = await surface();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const run = (seconds) => every(1000 / 60, seconds, (i) => wheel(cx, cy, Math.floor(i / 60) % 2 === 0 ? 10 : -10, Math.floor(i / 60) % 2 === 0 ? 4 : -4, false));
    await run(1);
    const t = await recorded(() => run(6));
    const frames = framesOf(t);
    const script = frames.map((f) => f.script);
    const end = await info();
    record('cards', pct(script, 0.95), `mean ${fmt(mean(script))}, 95% ${fmt(pct(script, 0.95))}, worst ${fmt(Math.max(...script))}; ${frames.length} frames; cards ${end.cards}, live ${end.live}`, { mean: mean(script), p95: pct(script, 0.95), worst: Math.max(...script) });
  }

  // ---- a lasso round 2,000 strokes
  if (rows.includes('lasso')) {
    await openStudio();
    await throttle(1);
    await load(data.copyOf(2_000, 'strokes'), 2_000);
    await page.evaluate(() => document.querySelector('[data-action=zoom-fit]').click());
    await sleep(2000);
    await throttle(rate);
    await tool('lasso');
    const box = await surface();
    const loop = [];
    // a loop round the strokes, which the fit puts in the middle of the view (clear of the page bar and the toolbar)
    const L = box.x + 40;
    const R = box.x + box.width - 40;
    const T = box.y + box.height / 2 - 140;
    const Bt = box.y + box.height / 2 + 140;
    for (let k = 0; k < 12; k++) loop.push([L + ((R - L) * k) / 12, T]);
    for (let k = 0; k < 12; k++) loop.push([R, T + ((Bt - T) * k) / 12]);
    for (let k = 0; k < 12; k++) loop.push([R - ((R - L) * k) / 12, Bt]);
    for (let k = 0; k < 12; k++) loop.push([L, Bt - ((Bt - T) * k) / 12]);
    const lasso = async () => {
      await page.evaluate(() => {
        window.__b.handler = {};
      });
      await mouse('mouseMoved', loop[0][0], loop[0][1], false);
      await mouse('mousePressed', loop[0][0], loop[0][1], true);
      for (const [x, y] of loop.slice(1)) {
        await mouse('mouseMoved', x, y, true);
        await sleep(8);
      }
      await mouse('mouseMoved', loop[0][0], loop[0][1] + 3, true);
      await mouse('mouseReleased', loop[0][0], loop[0][1] + 3, true);
      await sleep(700);
    };
    if (flag('debug')) {
      await lasso();
      out(`after one lasso: ${JSON.stringify(await info())}`);
      await page.screenshot({ path: path.join(process.env.KIROCREW_SCRATCH ?? '.', 'lasso-debug.png') });
    }
    const runs = [];
    let frameAfter = 0;
    for (let run = 0; run < 5; run++) {
      const t = await recorded(lasso);
      const up = t.handler.pointerup;
      const selected = Number((await info()).selected);
      const frames = framesOf(t);
      const after = Math.max(...frames.map((f) => f.script));
      runs.push({ up: up?.max ?? Number.NaN, selected, after });
      frameAfter = after;
      await page.focus('.ib-surface');
      await page.keyboard.press('Escape');
      await sleep(200);
    }
    const best = Math.min(...runs.slice(1).map((r) => r.up));
    record('lasso', best, `best of ${runs.length - 1} (first is warm-up): ${runs.map((r) => `${fmt(r.up)} ms/${r.selected} selected`).join(', ')}; slowest frame after ${fmt(frameAfter)} ms`, { runs });
  }

  // ---- switch to a page of 2,000 shapes
  if (rows.includes('switch')) {
    await openStudio();
    await throttle(1);
    await page.evaluate(() => document.querySelector('button[title="Add a page"]').click());
    await sleep(300);
    await load(data.copyOf(2_000, 'mixed'), 2_000);
    await page.evaluate(() => document.querySelector('[data-action=zoom-fit]').click());
    await sleep(1500);
    await throttle(rate);
    const goto = async (n) => {
      // opens the page list and clicks page `n` (1 or 2) inside the page, timing from the click
      await page.evaluate(() => {
        const b = document.querySelector('.ib-pages > button[aria-haspopup=listbox]');
        if (document.querySelector('.ib-pages .ib-list').hidden) b.click();
      });
      await sleep(100);
      await page.evaluate(() => {
        window.__b.reset();
        window.__b.on = true;
      });
      const t0 = await page.evaluate((i) => {
        const btn = document.querySelectorAll('.ib-pages .ib-list button')[i - 1];
        const t = performance.now();
        btn.click();
        return t;
      }, n);
      await sleep(1200);
      if (flag('debug')) out(`after the click: ${JSON.stringify(await page.evaluate(() => ({ on: window.__b.on, n: window.__b.cbT.length, hidden: document.hidden, vis: document.visibilityState })))}`);
      const t = await page.evaluate(() => {
        window.__b.on = false;
        return window.__b.take();
      });
      const frames = framesOf(t).filter((f) => f.end >= t0);
      if (frames.length === 0) throw new Error(`the page switch drew no frame (${t.cbT.length} callbacks, t0 ${t0}, ends ${t.cbEnd.slice(0, 3)}; ${JSON.stringify(await info())})`);
      const quiet = [];
      return { first: frames[0].end - t0, firstScript: frames[0].script, last: frames[frames.length - 1].end - t0, frames: frames.length, quiet, info: await info() };
    };
    await goto(1);
    const runs = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await goto(2));
      await goto(1);
    }
    runs.shift();
    const best = runs.reduce((a, b) => (b.last < a.last ? b : a));
    record('switch', best.last, `best of ${runs.length}: ${runs.map((r) => `${fmt(r.first)} ms first frame (${fmt(r.firstScript)} script), ${fmt(r.last)} ms to the last of ${r.frames} frames`).join('; ')}; ${best.info.shapes} shapes, ${best.info.tiles} tiles`, { runs });
  }

  // ---- open a board
  if (rows.includes('open')) {
    await throttle(1);
    await page.goto(dataUrl);
    await page.waitForFunction(() => 'boardOpen' in window, null, { timeout: 60_000 });
    await throttle(rate);
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(await page.evaluate(() => window.boardOpen(1000)));
    const best = runs.slice(1).reduce((a, b) => (b.firstFrame < a.firstFrame ? b : a));
    record('open', best.firstFrame, `best of ${runs.length - 1} after a warm-up: ${runs.map((r) => `${fmt(r.created)} ms to created, ${fmt(r.firstFrame)} first frame, ${fmt(r.onScreen)} next frame`).join('; ')}; ${best.shapes} shapes, ${best.tiles} tiles, ${best.backend}`, { runs });
  }

  await throttle(1);
  await cdp.detach();
  const bad = logs.filter((l) => /error/i.test(l));
  if (bad.length > 0) out(`page errors:\n${bad.slice(-10).join('\n')}`);
} finally {
  await browser.close();
  await studio.close();
  await dataServer.close();
}

// ---------------------------------------------------------------------------------------------------------------
// the table

const over = results.filter((r) => !r.ok);
const table = [
  '| What | Goal | Measured | Compared as | Result |',
  '|---|---|---|---|---|',
  ...results.map((r) => `| ${r.what} | ${r.goal} ${r.unit} | ${fmt(r.value)} ${r.unit} | ${r.by} | ${r.ok ? 'ok' : 'over'} |`),
].join('\n');
out(`\n${table}\n`);
const mdPath = arg('md', '');
if (mdPath) {
  const body = [
    `Chrome ${version}, CPU ×${rate}, 1280 × 800 at 1:1.`,
    '',
    table,
    '',
    ...results.map((r) => `- **${r.what}:** ${r.detail}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.resolve(root, mdPath), body);
}
if (over.length > 0) {
  out(`over goal: ${over.map((r) => r.key).join(', ')}`);
  process.exitCode = 1;
}
