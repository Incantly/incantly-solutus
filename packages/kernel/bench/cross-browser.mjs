/**
 * The same film in Chromium, Firefox and WebKit (physics design 10.2, 11.4 "Same result"; round 10, task 10.4): seven 60 s
 * films (`films.ts`), each played with the Rust loops on and off in each browser, and the hash of the world compared after
 * every second. WebKit stands for Safari. Prints a table and exits 1 when any hash differs, with the first second of
 * difference and the first values (words of the checkpoint) that differ.
 *
 * Run from the repository root:
 *   PLAYWRIGHT_DIR=/path/with/node_modules/playwright node packages/kernel/bench/cross-browser.mjs
 *     [--browsers chromium,firefox,webkit] [--seconds 60] [--films 0,1,2,3,4,5,6]
 *     [--chromium-path P] [--firefox-path P] [--webkit-path P] [--firefox-no-sandbox]
 *
 * Playwright is not a dependency of the repository (docs/design/libraries.md). Each `--*-path` is the executable of a
 * browser build when Playwright's own lookup does not find it. `--firefox-no-sandbox` turns off the content sandbox, for a
 * computer that does not let Firefox start it. The page is `bench/chrome/cross.html`, served by Vite on 127.0.0.1.
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
const out = (s) => process.stdout.write(`${s}\n`);
const seconds = Number(arg('seconds', '60'));
const names = arg('browsers', 'chromium,firefox,webkit').split(',');

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'index.js') : import.meta.url);
const playwright = require('playwright');

const server = await createServer({
  root: path.join(here, 'chrome'),
  configFile: false,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: Number(arg('port', '5199')), strictPort: false, fs: { allow: [root] } },
});
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5199/';

/** What each browser needs to start. */
function launchOptions(name) {
  const executablePath = arg(`${name}-path`, undefined);
  const o = { headless: true, ...(executablePath ? { executablePath } : {}) };
  if (name === 'firefox' && flag('firefox-no-sandbox')) {
    o.firefoxUserPrefs = { 'security.sandbox.content.level': 0 };
    o.env = { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' };
  }
  return o;
}

/** @type {Record<string, {version: string, agent: string, compiled: boolean, films: string[], runs: Map<string, {hashes: string[], kernels: boolean | undefined}>}>} */
const results = {};
const pages = {};
const browsers = {};
try {
  for (const name of names) {
    const browser = await playwright[name].launch(launchOptions(name));
    browsers[name] = browser;
    const page = await browser.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`${base}cross.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => 'crossInfo' in window, null, { timeout: 60_000 });
    const info = await page.evaluate(() => window.crossInfo);
    pages[name] = page;
    results[name] = { version: browser.version(), agent: info.agent, compiled: info.compiled, films: info.films, runs: new Map() };
    out(`${name} ${browser.version()}: ${info.agent}; WebAssembly kernels ${info.compiled ? 'compiled' : 'not compiled'}`);
    const films = arg('films', info.films.map((_, i) => i).join(',')).split(',').map(Number);
    for (const i of films) {
      for (const kernels of [true, false]) {
        const t0 = Date.now();
        const r = await page.evaluate(([n, s, k]) => window.crossFilm(n, s, k), [i, seconds, kernels]);
        results[name].runs.set(`${i}:${kernels}`, r);
        out(`  ${name}: ${r.title}, kernels ${kernels ? 'on' : 'off'}${r.kernels === undefined ? '' : r.kernels ? ' (running)' : ' (not running)'}: ${((Date.now() - t0) / 1000).toFixed(1)} s, last hash ${r.hashes[r.hashes.length - 1]}`);
      }
    }
  }

  const firstDiff = (a, b) => a.hashes.findIndex((h, i) => h !== b.hashes[i]);
  const reference = names[0];
  const films = results[reference].films;
  const rows = [];
  let different = false;
  const traces = [];
  const kernelNote = (name) => (results[name].compiled ? '' : ' (no kernels)');
  for (let i = 0; i < films.length; i++) {
    for (const kernels of [true, false]) {
      const refRun = results[reference].runs.get(`${i}:${kernels}`);
      if (!refRun) continue;
      const cells = [];
      for (const name of names) {
        const run = results[name].runs.get(`${i}:${kernels}`);
        if (!run) {
          cells.push('-');
          continue;
        }
        if (name === reference) {
          cells.push('reference');
          continue;
        }
        const at = firstDiff(refRun, run);
        if (at < 0) cells.push('equal');
        else {
          different = true;
          cells.push(`DIFFERS at second ${at + 1}`);
          traces.push({ film: i, kernels, name, second: at + 1 });
        }
      }
      rows.push(`${films[i].padEnd(40)} ${kernels ? 'on ' : 'off'} ${cells.map((c, j) => `${names[j]}: ${c}`.padEnd(32)).join(' ')}`);
    }
  }
  // the Rust loops on against off, in each browser
  const inside = [];
  for (const name of names) {
    for (let i = 0; i < films.length; i++) {
      const on = results[name].runs.get(`${i}:true`);
      const off = results[name].runs.get(`${i}:false`);
      if (!on || !off) continue;
      const at = firstDiff(on, off);
      if (at >= 0) {
        different = true;
        inside.push(`${name}${kernelNote(name)}: ${films[i]}: kernels on and off differ at second ${at + 1}`);
      }
    }
  }
  out('');
  out(`Same film, ${seconds} s, the world hash after every second, against ${reference}:`);
  out(`${'film'.padEnd(40)} loops ${names.map((n) => n.padEnd(32)).join(' ')}`);
  for (const r of rows) out(r);
  for (const l of inside) out(l);
  if (inside.length === 0) out('Rust loops on against off, in each browser: equal in every film.');

  // where the first difference is: the words of the checkpoint that differ at the first second of difference
  for (const t of traces) {
    const a = await pages[reference].evaluate(([n, s, k, at]) => window.crossFilm(n, s, k, at).state, [t.film, t.second, t.kernels, t.second]);
    const b = await pages[t.name].evaluate(([n, s, k, at]) => window.crossFilm(n, s, k, at).state, [t.film, t.second, t.kernels, t.second]);
    if (!a || !b) continue;
    let first = -1;
    let count = 0;
    const n = Math.min(a.length, b.length);
    for (let w = 0; w < n; w += 2) {
      if (a[w] !== b[w] || a[w + 1] !== b[w + 1]) {
        if (first < 0) first = w / 2;
        count++;
      }
    }
    out(`${films[t.film]}, loops ${t.kernels ? 'on' : 'off'}, ${t.name} against ${reference} at second ${t.second}: ${count} of ${n / 2} values differ (the checkpoint has ${a.length / 2} and ${b.length / 2}); the first is value ${first}`);
  }
  if (different) {
    out('DIFFERENT: at least one hash differs');
    process.exitCode = 1;
  } else out('SAME: every hash is equal in every browser, with the Rust loops on and off');
} finally {
  for (const b of Object.values(browsers)) await b.close();
  await server.close();
}
