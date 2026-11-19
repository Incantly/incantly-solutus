/**
 * The cloth scenes in real Chrome, with the CPU slowed 4 times (physics design 11.2, 11.6): a second of warm-up and
 * five seconds of frames of two steps each, mean, 95% and worst frame time per scene.
 *
 * Run from the repository root:
 *   PLAYWRIGHT_DIR=/path/with/node_modules/playwright node packages/kernel/bench/chrome-physics.mjs
 *     [--rate 4] [--warm 1] [--run 5] [--scenes rope,sheet32,flag,over40,self,two,wet,fire24,fire32,flagfire,pile,asleep,chain,hills,boxes3,liquid2,liquid3,waves,smoke,fire2,apply,seek300,restart] [--kernels off] [--headed]
 *
 * `--kernels off` runs the TypeScript loops instead of the WebAssembly ones (design 11.6); the line after the Chrome
 * version says whether the kernels were compiled and are running.
 *
 * Playwright is not a dependency of the repository (docs/design/libraries.md): point PLAYWRIGHT_DIR at a folder where
 * it is installed. Chrome itself is the installed one (`channel: 'chrome'`). The page is `bench/chrome/index.html`,
 * served by Vite on 127.0.0.1. Goals (design 11.2): sheet32 3 ms, flag 6 ms, over40, self, two and wet 8 ms, rope
 * 2 ms; the round 10 rows (bodies, liquids, waves, smoke, fire in the plane, one line, seek, restart) have their goals from the
 * Chrome column of design 11.2 in `plan` below. The script exits 1 when a row is over its goal.
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
// Each scene's goal (the Chrome column of design 11.2), the film seconds before and during the frames timed, and what the
// goal is compared with: the mean of all frames (default) or the mean of the slowest second.
const plan = {
  rope: { goal: 2 },
  sheet32: { goal: 3 },
  flag: { goal: 6 },
  over40: { goal: 8 },
  self: { goal: 8 },
  two: { goal: 8 },
  wet: { goal: 8 },
  fire24: { goal: 8 },
  fire32: { goal: 8 },
  flagfire: { goal: 8 },
  // round 10: the rows of the bodies, liquids, waves, smoke and fire in the plane
  pile: { goal: 6, warm: 0, run: 20, by: 'slowest' },
  asleep: { goal: 3, warm: 4, run: 3 },
  chain: { goal: 4, warm: 1, run: 10 },
  hills: { goal: 0.5, warm: 2, run: 10 },
  boxes3: { goal: 6, warm: 0, run: 10, by: 'slowest' },
  liquid2: { goal: 6 },
  liquid3: { goal: 6 },
  waves: { goal: 1 },
  smoke: { goal: 3 },
  fire2: { goal: 4 },
};
// rows that are not frames: one physics line applied, a seek in a warm 60 s film of 300 bodies, a restart of it
const special = { apply: 1, seek300: 100, restart: 1000 / 60 };
const goals = { ...Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.goal])), ...special };
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
  out(`WebAssembly kernels: ${kernels.wanted ? 'on' : 'off'}, ${kernels.compiled ? 'compiled' : 'not compiled'}, ${kernels.running ? 'running' : 'not running'}; grid in space: ${kernels.grid ? 'running' : 'not running'}${kernels.gridSimd ? ' with SIMD' : ''}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const over = [];
  for (const name of scenes) {
    const goal = goals[name];
    if (name === 'apply') {
      const r = await page.evaluate(() => window.physicsApply());
      out(`${name.padEnd(8)} median ${r.median.toFixed(3)} ms, 95% ${r.p95.toFixed(3)} ms, worst ${r.worst.toFixed(3)} ms; the flush after it ${r.flush.toFixed(1)} ms (goal ${goal} ms, median ${((100 * r.median) / goal).toFixed(0)}%)`);
      if (r.median > goal) over.push(name);
    } else if (name === 'seek300') {
      const r = await page.evaluate(() => window.physicsSeek('pile', 60));
      out(`${name.padEnd(8)} median ${r.median.toFixed(1)} ms, 95% ${r.p95.toFixed(1)} ms, worst ${r.worst.toFixed(1)} ms (goal ${goal} ms, 95% ${((100 * r.p95) / goal).toFixed(0)}%)`);
      if (r.p95 > goal) over.push(name);
    } else if (name === 'restart') {
      const r = await page.evaluate(() => window.physicsRestart('pile', 60));
      out(`${name.padEnd(8)} first frame ${r.first.toFixed(1)} ms, no driver behind after ${r.frames} frames (goal first frame ${goal.toFixed(1)} ms, within 60 frames)`);
      if (r.first > goal || r.frames >= 60) over.push(name);
    } else {
      const p = plan[name] ?? {};
      const r = await page.evaluate(([n, w, s]) => window.physicsBench(n, w, s), [name, p.warm ?? warm, p.run ?? run]);
      const value = p.by === 'slowest' ? r.slowest : r.mean;
      out(`${name.padEnd(8)} mean ${r.mean.toFixed(2)} ms, 95% ${r.p95.toFixed(2)} ms, worst ${r.worst.toFixed(2)} ms, slowest second ${r.slowest.toFixed(2)} ms (goal ${goal} ms, ${p.by === 'slowest' ? 'slowest second' : 'mean'} ${((100 * value) / goal).toFixed(0)}%)`);
      if (goal !== undefined && value > goal) over.push(name);
    }
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
