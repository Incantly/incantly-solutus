/**
 * The WebGL 2 painter in real Chrome, with the CPU slowed 4 times (physics design 11.1, 11.2, 12.1): the draw of a
 * 64 × 32 sheet and 2,000 drops a frame, target under 3 ms. Round 10's throttled benches reuse this script.
 *
 * Run from the repository root:
 *   PLAYWRIGHT_DIR=/path/with/node_modules/playwright node packages/sdk/bench/chrome-gl.mjs [--rate 4] [--frames 300]
 *     [--shot out.png] [--soft] [--headed] [--dpr 1]
 *
 * Playwright is not a dependency of the repository (docs/design/libraries.md): point PLAYWRIGHT_DIR at a folder where
 * it is installed. Chrome itself is the installed one (`channel: 'chrome'`). The page is `bench/gl/index.html`, served by
 * Vite on 127.0.0.1. The time is the page's main thread from the call into the painter to its return, the GPU's own
 * work overlapping the next frame, as in the studio.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
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
const frames = Number(arg('frames', '300'));
const shot = arg('shot', undefined);
const soft = flag('soft');
const out = (s) => process.stdout.write(`${s}\n`);

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'index.js') : import.meta.url);
const { chromium } = require('playwright');

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
};
const ms = (x) => `${x.toFixed(3)} ms`;

const server = await createServer({
  root: path.join(here, 'gl'),
  configFile: false,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: Number(arg('port', '5199')), strictPort: false, fs: { allow: [root] } },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5199/';
const browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed'), args: ['--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: Number(arg('dpr', '1')) });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`${url}${soft ? '?soft=1' : ''}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => 'glBench' in window, null, { timeout: 30_000 });
  const gpuInfo = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL 2';
  });
  out(`Chrome ${browser.version()}, GPU: ${gpuInfo}`);
  if (shot) {
    await page.evaluate(() => window.glBench.still(1.2));
    await page.screenshot({ path: shot });
    out(`screenshot: ${shot}`);
  }
  const run = async (r) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: r });
    const res = await page.evaluate((n) => window.glBench.bench(n), frames);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
    const full = quantile(res.full, 0.5);
    const base = quantile(res.base, 0.5);
    const draw = res.full.map((x, i) => x - (res.base[i] ?? base));
    out(`CPU ×${r}, ${res.renderer}, ${res.frames} frames: the Space view ${ms(full)} median (95% ${ms(quantile(res.full, 0.95))}); without the sheet and drops ${ms(base)}; the sheet and drops ${ms(quantile(draw, 0.5))} median, 95% ${ms(quantile(draw, 0.95))} (budget 3 ms)`);
    if (res.stats) out(`  GPU stats: ${JSON.stringify(res.stats)}`);
    return { full, base, draw: quantile(draw, 0.5), p95: quantile(draw, 0.95) };
  };
  await run(1);
  const slow = await run(rate);
  const bad = logs.filter((l) => /error/i.test(l));
  if (bad.length > 0) out(bad.slice(-10).join('\n'));
  if (!soft && rate === 4 && !(slow.p95 < 3)) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
