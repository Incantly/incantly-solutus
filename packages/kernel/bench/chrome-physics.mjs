/**
 * The cloth scenes in real Chrome, with the CPU slowed 4 times (physics design 11.2, 11.6): a second of warm-up and
 * five seconds of frames of two steps each, mean, 95% and worst frame time per scene.
 *
 * Run from the repository root:
 *   PLAYWRIGHT_DIR=/path/with/node_modules/playwright node packages/kernel/bench/chrome-physics.mjs
 *     [--rate 4] [--warm 1] [--run 5] [--scenes rope,sheet32,flag,over40,self,two,wet] [--kernels off] [--headed]
 *
 * `--kernels off` runs the TypeScript loops instead of the WebAssembly ones (design 11.6); the line after the Chrome
 * version says whether the kernels were compiled and are running.
 *
 * Playwright is not a dependency of the repository (docs/design/libraries.md): point PLAYWRIGHT_DIR at a folder where
 * it is installed. Chrome itself is the installed one (`channel: 'chrome'`). The page is `bench/chrome/index.html`,
 * served by Vite on 127.0.0.1. Goals (design 11.2): sheet32 3 ms, flag 6 ms, over40, self, two and wet 8 ms, rope
 * 2 ms. The script exits 1 when a mean is over its goal.
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
const warm = Number(arg('warm', '1'));
const run = Number(arg('run', '5'));
const goals = { rope: 2, sheet32: 3, flag: 6, over40: 8, self: 8, two: 8, wet: 8 };
const scenes = arg('scenes', Object.keys(goals).join(',')).split(',');
const out = (s) => process.stdout.write(`${s}\n`);

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'index.js') : import.meta.url);
const { chromium } = require('playwright');

const server = await createServer({
  root: path.join(here, 'chrome'),
  configFile: false,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: Number(arg('port', '5198')), strictPort: false, fs: { allow: [root] } },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5198/';
const browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed') });
try {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(arg('kernels', 'on') === 'off' ? `${url}?kernels=off` : url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => 'physicsBench' in window, null, { timeout: 30_000 });
  const kernels = await page.evaluate(() => window.physicsKernels);
  out(`Chrome ${browser.version()}, CPU ×${rate}, ${warm} s warm-up, ${run} s of frames (two steps each)`);
  out(`WebAssembly kernels: ${kernels.wanted ? 'on' : 'off'}, ${kernels.compiled ? 'compiled' : 'not compiled'}, ${kernels.running ? 'running' : 'not running'}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const over = [];
  for (const name of scenes) {
    const r = await page.evaluate(([n, w, s]) => window.physicsBench(n, w, s), [name, warm, run]);
    const goal = goals[name];
    out(`${name.padEnd(8)} mean ${r.mean.toFixed(2)} ms, 95% ${r.p95.toFixed(2)} ms, worst ${r.worst.toFixed(2)} ms (goal ${goal} ms, mean ${((100 * r.mean) / goal).toFixed(0)}%)`);
    if (goal !== undefined && r.mean > goal) over.push(name);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();
  const bad = logs.filter((l) => /error/i.test(l));
  if (bad.length > 0) out(bad.slice(-10).join('\n'));
  if (over.length > 0) {
    out(`over goal: ${over.join(', ')}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await server.close();
}
