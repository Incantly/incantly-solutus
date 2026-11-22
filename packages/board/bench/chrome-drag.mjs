/**
 * A drag in real Chrome with the CPU slowed 4 times (BR-82): a rectangle and a picture over 2,000 strokes are dragged and
 * shaken with the select tool, and the page's frames are timed. The picture's last drag is filmed with the protocol's
 * screencast, and each frame Chrome composites is checked: a whole picture has the same red pixels in every frame; a
 * frame where tiles not drawn yet still show part of it where it was (a ghost) has a wider or taller box round its red,
 * and one where part of it is missing has fewer red pixels. Before BR-82 the tiles under a moving shape were drawn again
 * a few a frame within the frame's budget, so parts of it lagged behind and seemed to fall off.
 *
 * Run from the repository root:
 *   PLAYWRIGHT_DIR=/path/with/node_modules/playwright-core node packages/board/bench/chrome-drag.mjs [--rate 4] [--shots dir] [--headed]
 *
 * Playwright is not a dependency of the repository (docs/design/libraries.md): point PLAYWRIGHT_DIR at a folder where it is
 * installed. The script exits 1 when a filmed frame has a ghost or a part missing, or the page reported an error.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const flag = (name) => process.argv.includes(`--${name}`);
const rate = Number(arg('rate', '4'));
const shots = arg('shots', '');
const dpr = Number(arg('dpr', '2'));
/** The picture's size in pixels: `wxh`. */
const [picW, picH] = arg('picture', '480x320').split('x').map(Number);
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
const pct = (a, q) => (a.length === 0 ? Number.NaN : Float64Array.from(a).sort()[Math.min(a.length - 1, Math.floor(a.length * q))]);
const mean = (a) => (a.length === 0 ? Number.NaN : a.reduce((x, y) => x + y, 0) / a.length);
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');

// ---------------------------------------------------------------------------------------------------------------
// pictures

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A 240 × 160 PNG of colour bands (red, green, blue, yellow, twice), made here so no picture file is needed. */
function bandsPng(w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = y * (w * 4 + 1) + 1 + x * 4;
      const band = Math.floor((x * 8) / w) % 4;
      raw[at] = [220, 40, 40, 250][band];
      raw[at + 1] = [60, 160, 60, 200][band];
      raw[at + 2] = [40, 80, 220, 30][band];
      raw[at + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Reads an 8-bit RGB or RGBA PNG (what Chrome sends) into its pixels. */
function readPng(buf) {
  let at = 8;
  let w = 0;
  let h = 0;
  let channels = 4;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, channels, px };
}

/** The picture's red pixels in a frame, out of the style bar: how many, the box round them, and their middle. */
function redOf(png) {
  const { w, h, channels, px } = readPng(png);
  // the style bar, top right, has a red swatch
  const bar = (x, y) => x >= 960 && y < 225;
  let n = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      if (!bar(x, y) && px[i] > 190 && px[i + 1] < 90 && px[i + 2] < 90) {
        n++;
        sx += x;
        sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  return { n, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: sx / Math.max(1, n), cy: sy / Math.max(1, n) };
}

// ---------------------------------------------------------------------------------------------------------------
// the page

/** Runs in the page before its own scripts: the time of each animation-frame callback. */
function instrument() {
  const B = { on: false, frames: [] };
  window.__d = B;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const s = performance.now();
      try {
        cb(t);
      } finally {
        if (B.on) B.frames.push(performance.now() - s);
      }
    });
}

const dataServer = await createServer({ root: path.join(here, 'chrome'), configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: await freePort(), strictPort: true, fs: { allow: [root] } } });
await dataServer.listen();
const data = await dataServer.ssrLoadModule(path.join(here, 'chrome', 'data.ts'));
const studioPort = await freePort();
const studio = await createServer({ root: path.join(root, 'apps/studio'), logLevel: 'error', server: { host: '127.0.0.1', port: studioPort, strictPort: true } });
await studio.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed') });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
  await context.addInitScript(instrument);
  const page = await context.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${studioPort}/?mode=notes`);
  await page.waitForSelector('.ib-view');
  await sleep(500);
  const cdp = await context.newCDPSession(page);
  const box = await page.locator('.ib-surface').boundingBox();
  const at = (x, y) => ({ x: box.x + x, y: box.y + y });
  const mouse = (type, x, y, down) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: type === 'mouseReleased' || !down ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const tool = (id) => page.evaluate((i) => document.querySelector(`.ib-tools [data-tool=${i}]`).click(), id);
  const shapes = () => page.evaluate(() => Number(document.querySelector('.ib-view').dataset.shapes));
  const paste = async (x, y, text, png) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y);
    await page.evaluate(
      ([t, b64]) => {
        const dt = new DataTransfer();
        if (t !== null) dt.setData('text/plain', t);
        if (b64 !== null) dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'bands.png', { type: 'image/png' }));
        document.querySelector('.ib-view').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      },
      [text, png],
    );
  };
  // 2,000 strokes under everything, so a tile takes a while to draw
  await paste(640, 400, data.copyOf(2_000, 'strokes'), null);
  await page.waitForFunction(() => Number(document.querySelector('.ib-view').dataset.shapes) >= 2000, null, { timeout: 60_000 });
  await sleep(800);
  await page.focus('.ib-surface');
  await page.keyboard.press('Escape');
  // a rectangle
  await tool('rect');
  await mouse('mouseMoved', at(300, 250).x, at(300, 250).y, false);
  await mouse('mousePressed', at(300, 250).x, at(300, 250).y, true);
  for (let i = 1; i <= 10; i++) await mouse('mouseMoved', at(300 + 22 * i, 250 + 16 * i).x, at(300 + 22 * i, 250 + 16 * i).y, true);
  await mouse('mouseReleased', at(520, 410).x, at(520, 410).y, true);
  await sleep(300);
  // a picture
  await paste(800, 330, null, bandsPng(picW, picH).toString('base64'));
  await sleep(1500);
  out(`shapes ${await shapes()}, backend ${await page.evaluate(() => document.querySelector('.ib-view').dataset.backend)}`);
  await page.keyboard.press('Escape');
  await tool('select');
  await sleep(300);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  if (shots !== '') fs.mkdirSync(shots, { recursive: true });

  /** Drags from (x, y), shaking for `seconds`; with `shoot`, a screenshot every so often. */
  const drag = async (name, x, y, seconds, shoot) => {
    const p0 = at(x, y);
    await mouse('mouseMoved', p0.x, p0.y, false);
    await mouse('mousePressed', p0.x, p0.y, true);
    await page.evaluate(() => {
      window.__d.frames.length = 0;
      window.__d.on = true;
    });
    const t0 = performance.now();
    const n = Math.floor((seconds * 1000) / 8);
    const sent = [];
    let last = { x: p0.x, y: p0.y };
    for (let i = 0; i < n; i++) {
      const due = t0 + i * 8;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
      // a shake: fast side to side and up and down, with no drift, so the picture stays on screen
      last = { x: p0.x + 120 * Math.sin(i / 6), y: p0.y + 60 * Math.sin(i / 4) };
      sent.push(mouse('mouseMoved', last.x, last.y, true));
      if (shoot && i > 0 && i % Math.floor(n / 4) === 0) {
        await Promise.all(sent.splice(0));
        await page.screenshot({ path: path.join(shots, `${name}-${i}.png`) });
      }
    }
    await Promise.all(sent);
    await mouse('mouseReleased', last.x, last.y, true);
    await sleep(200);
    const frames = await page.evaluate(() => {
      window.__d.on = false;
      return window.__d.frames.slice();
    });
    out(`${name.padEnd(8)} frames ${frames.length}, script mean ${fmt(mean(frames))} ms, 95% ${fmt(pct(frames, 0.95))} ms, worst ${fmt(Math.max(...frames))} ms`);
    await sleep(1000);
    if (shoot) await page.screenshot({ path: path.join(shots, `${name}-after.png`) });
  };
  await drag('rect', 300, 330, 3, shots !== '');
  await page.keyboard.press('Escape');
  await drag('picture', 800, 330, 3, shots !== '');
  await page.keyboard.press('Escape');

  // the picture again, filmed
  const now = redOf(await page.screenshot({ scale: 'css' }));
  const film = [];
  cdp.on('Page.screencastFrame', (f) => {
    film.push(f.data);
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 1280, maxHeight: 800 });
  await sleep(300);
  await drag('filmed', now.cx - box.x, now.cy - box.y, 3, false);
  await cdp.send('Page.stopScreencast');
  await sleep(200);
  // both the screencast and the reference are in CSS pixels
  const counts = film.map((d) => redOf(Buffer.from(d, 'base64')));
  // the picture as it was before the drag, whole and on screen
  const still = now;
  // a ghost makes the box round the red wider or taller than the picture's; a part missing leaves fewer red pixels
  const ghost = counts.filter((c) => c.w > still.w + 4 || c.h > still.h + 4).length;
  const missing = counts.filter((c) => c.n < still.n * 0.85).length;
  out(`filmed   ${counts.length} frames; whole: ${still.n} red pixels in ${still.w} x ${still.h}; frames with a ghost ${ghost}, with a part missing ${missing}`);
  if (ghost > 0 || missing > 0) failed = true;
  if (shots !== '') {
    const bad = counts.map((c, i) => (c.w > still.w + 4 || c.h > still.h + 4 || c.n < still.n * 0.85 ? i : -1)).filter((i) => i >= 0);
    for (const i of bad.slice(0, 3)) fs.writeFileSync(path.join(shots, `filmed-bad-${i}.png`), Buffer.from(film[i], 'base64'));
    out(`bad frames: ${bad.slice(0, 3).map((i) => `${i} ${JSON.stringify(counts[i])}`).join('; ')}`);
  }
  if (logs.length > 0) {
    failed = true;
    out(logs.join('\n'));
  }
} finally {
  await browser.close();
  await studio.close();
  await dataServer.close();
}
process.exit(failed ? 1 : 0);
