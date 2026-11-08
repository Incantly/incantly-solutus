import type { StoryboardSpec } from './storyboard';

/**
 * Silent film fixtures: a 30 s and a 1 min film, each one storyboard plus one
 * scene using existing kits only. No model calls: the model-side storyboard
 * lands in a later slice. Both films run through the real controller, player
 * and probe path, with estimated beat lengths.
 */

export interface FilmFixtureScene {
  readonly id: string;
  readonly cut: 'cut' | 'fade' | 'wipe' | 'push';
  readonly html: string;
  readonly css: string;
  readonly js: string;
  /** Parts the probe checks, and the step count it expects. */
  readonly probe: { readonly parts: readonly string[]; readonly steps: number };
}

export interface FilmFixture {
  readonly id: string;
  readonly storyboard: StoryboardSpec;
  readonly scenes: readonly FilmFixtureScene[];
}

const STAGE = "<div id='stage'></div>";

const THIRTY_JS = [
  "inc.idea('A pendulum swings in the same time whatever its size.');",
  "const angle = inc.param('angle', { min: 0.1, max: 1.1, step: 0.05, value: 0.5, label: 'Start angle', unit: 'rad' });",
  "const push = inc.param('push', { min: 0, max: 1, step: 0.05, value: 0, label: 'Push' });",
  "const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Pendulum', description: 'A pendulum swinging from its pivot.' });",
  "const pivot = stage.circle(300, 60, 8, { tone: 'hi' });",
  "stage.part('Pivot', pivot, { label: 'Pivot', info: 'The fixed point the pendulum hangs from.' });",
  "const rod = stage.line(300, 60, 300, 280, { tone: 'mid' });",
  "stage.part('Rod', rod, { label: 'Rod', info: 'A light, stiff rod.' });",
  "const bob = stage.circle(300, 280, 22, { tone: 'b' });",
  "stage.part('Bob', bob, { label: 'Bob', info: 'The heavy weight at the end.' });",
  "const trail = stage.polyline([[300, 280]], { tone: 'a', dashed: true });",
  "stage.part('SwingTrail', trail, { label: 'Swing', info: 'The arc the bob travels.' });",
  "const nudge = stage.path('', { tone: 'lit' });",
  'nudge.hide();',
  "stage.part('Push', nudge, { label: 'Push', info: 'A gentle push at the right moment.' });",
  'inc.onFrame(({ time }) => {',
  '  const swing = angle.value * Math.cos(time * 2.2);',
  '  const px = 300, py = 60, len = 220;',
  '  const bx = px + len * Math.sin(swing), by = py + len * Math.cos(swing);',
  '  rod.set({ x1: px, y1: py, x2: bx, y2: by });',
  '  bob.at(bx - 300, by - 280);',
  '  const pts = [];',
  '  for (let i = 0; i <= 20; i++) {',
  '    const a = -angle.value + (2 * angle.value * i) / 20;',
  '    pts.push([px + len * Math.sin(a), py + len * Math.cos(a)]);',
  '  }',
  '  trail.points(pts);',
  '  const reach = 30 + push.value * 90;',
  "  nudge.d(inc.path.arrow({ from: [430, 280], to: [430 - reach, 280] }, 12));",
  '});',
  "inc.describe(() => 'A pendulum swinging ' + angle.value.toFixed(2) + ' radians from its pivot.');",
  'inc.steps([',
  "  { say: 'A pendulum hangs from its pivot, pulled straight down by gravity.', focus: 'Pivot' },",
  "  { say: 'Pull the bob aside, let go, and watch the swing begin.', set: { angle: 0.9 }, ease: 1.2, explore: { control: 'angle', hint: 'Drag the angle slider to start wider or narrower.' } },",
  "  { say: 'It trades height for speed, moving fastest through the very bottom.', focus: 'Bob', cam: { to: 'Bob', zoom: 1.5 }, mark: [{ type: 'pulse', part: 'Bob' }] },",
  "  { say: 'Friction steals a little energy on every single passing swing.', mark: [{ type: 'dim', part: 'Bob' }] },",
  "  { say: 'A gentle push at just the right moment keeps it swinging.', show: ['Push'], mark: [{ type: 'arrow', part: 'Push' }], set: { push: 0.8 }, sfx: 'pop' },",
  "  { say: 'Every swing takes the same time, so the pendulum keeps time.', focus: 'Bob', title: { text: 'Same swing, same time', kind: 'card' }, short: 'Same time' },",
  ']);',
].join('\n');

const SIXTY_JS = [
  "inc.idea('A wave carries energy forward while the water only bobs.');",
  "const height = inc.param('height', { min: 0.5, max: 2, step: 0.1, value: 1, label: 'Height', unit: 'm' });",
  "const length = inc.param('length', { min: 4, max: 10, step: 0.5, value: 6, label: 'Length', unit: 'm' });",
  "const graph = inc.graph2d('#stage', { x: [-6, 6], y: [-5, 5], title: 'Wave', description: 'A travelling wave.', labels: { x: 'x', y: 'y' } });",
  'const wave = graph.plot((x, t) => height.value * Math.sin((x / length.value) * 2 * Math.PI - t * 2), { tone: \'b\', label: \'Wave\' });',
  "graph.stage.part('Wave', wave.handle, { label: 'Wave', info: 'Energy moving right.' });",
  'const echo = graph.plot((x, t) => 0.5 * height.value * Math.sin((x / length.value) * 2 * Math.PI - t * 2 + 1.2), { tone: \'c\', dashed: true, label: \'Echo\' });',
  'echo.hide();',
  "graph.stage.part('Echo', echo.handle, { label: 'Echo', info: 'Half the height.' });",
  "inc.describe(() => 'A wave ' + height.value.toFixed(1) + ' m tall and ' + length.value.toFixed(1) + ' m long.');",
  'inc.steps([',
  "  { say: 'A wave carries energy forward, while the water itself only bobs gently up and down in place.', focus: 'Wave' },",
  "  { say: 'Watch one floating cork as the wave passes: it rises and falls but never travels onward with it.', set: { height: 1.6 }, ease: 2 },",
  "  { say: 'Taller waves carry more energy, which is exactly why big ocean swells pack such a punch ashore.', focus: 'Wave', cam: { to: 'Wave', zoom: 1.5 }, mark: [{ type: 'pulse', part: 'Wave' }] },",
  "  { say: 'Now stretch the wave out longer, since each crest holds its shape as it rolls steadily on by.', set: { length: 8 }, mark: [{ type: 'callout', part: 'Wave' }], short: 'Longer wave' },",
  "  { say: 'Pause and predict now: what happens to the carried energy if this wave grows twice as tall?', predict: { question: 'If the wave grows twice as tall, its energy grows…', options: ['Twice', 'Four times'], answer: 1, reveal: { height: 2 }, explain: 'Energy grows with the square of height.' } },",
  "  { say: 'The answer is four times: the carried energy grows with exactly the square of the wave height itself.', set: { height: 2 }, show: ['Echo'], sfx: 'chime' },",
  "  { say: 'Notice just how short choppy waves fade away quickly, while long ocean swells travel on for miles.', set: { length: 10 }, hide: ['Echo'] },",
  "  { say: 'So always remember: a wave is pure energy on the move, just wearing the water as its costume.', focus: 'Wave', title: { text: 'Energy on the move', kind: 'card' }, short: 'Energy on the move' },",
  ']);',
].join('\n');

export const THIRTY_SECOND_FILM: FilmFixture = {
  id: 'pendulum',
  storyboard: {
    film: { id: 'pendulum', title: 'How a pendulum keeps time', version: 1, lengthTarget: 30 },
    scenes: [
      {
        id: 's1',
        idea: 'A pendulum swings in the same time whatever its size',
        kit: 'svg',
        cut: 'fade',
        beats: [
          { id: 's1b1', say: 'A pendulum hangs from its pivot, pulled straight down by gravity.', focus: 'Pivot' },
          {
            id: 's1b2',
            say: 'Pull the bob aside, let go, and watch the swing begin.',
            set: { angle: 0.9 },
            ease: 1.2,
            explore: { control: 'angle', hint: 'Drag the angle slider to start wider or narrower.' },
          },
          {
            id: 's1b3',
            say: 'It trades height for speed, moving fastest through the very bottom.',
            focus: 'Bob',
            cam: { to: 'Bob', zoom: 1.5 },
            mark: [{ type: 'pulse', part: 'Bob' }],
          },
          { id: 's1b4', say: 'Friction steals a little energy on every single passing swing.', mark: [{ type: 'dim', part: 'Bob' }] },
          {
            id: 's1b5',
            say: 'A gentle push at just the right moment keeps it swinging.',
            show: ['Push'],
            mark: [{ type: 'arrow', part: 'Push' }],
            set: { push: 0.8 },
            sfx: 'pop',
          },
          {
            id: 's1b6',
            say: 'Every swing takes the same time, so the pendulum keeps time.',
            focus: 'Bob',
            title: { text: 'Same swing, same time', kind: 'card' },
            short: 'Same time',
          },
        ],
      },
    ],
  },
  scenes: [{ id: 's1', cut: 'fade', html: STAGE, css: '', js: THIRTY_JS, probe: { parts: ['Pivot', 'Bob'], steps: 6 } }],
};

export const SIXTY_SECOND_FILM: FilmFixture = {
  id: 'wave',
  storyboard: {
    film: { id: 'wave', title: 'What a wave carries', version: 1, lengthTarget: 60 },
    scenes: [
      {
        id: 's1',
        idea: 'A wave carries energy while the water only bobs',
        kit: 'graph2d',
        cut: 'fade',
        beats: [
          { id: 's1b1', say: 'A wave carries energy forward, while the water itself only bobs gently up and down in place.', focus: 'Wave' },
          { id: 's1b2', say: 'Watch one floating cork as the wave passes: it rises and falls but never travels onward with it.', set: { height: 1.6 }, ease: 2 },
          {
            id: 's1b3',
            say: 'Taller waves carry more energy, which is exactly why big ocean swells pack such a punch ashore.',
            focus: 'Wave',
            cam: { to: 'Wave', zoom: 1.5 },
            mark: [{ type: 'pulse', part: 'Wave' }],
          },
          {
            id: 's1b4',
            say: 'Now stretch the wave out longer, since each crest holds its shape as it rolls steadily on by.',
            set: { length: 8 },
            mark: [{ type: 'callout', part: 'Wave' }],
            short: 'Longer wave',
          },
          {
            id: 's1b5',
            say: 'Pause and predict now: what happens to the carried energy if this wave grows twice as tall?',
            predict: {
              question: 'If the wave grows twice as tall, its energy grows…',
              options: ['Twice', 'Four times'],
              answer: 1,
              reveal: { height: 2 },
              explain: 'Energy grows with the square of height.',
            },
          },
          {
            id: 's1b6',
            say: 'The answer is four times: the carried energy grows with exactly the square of the wave height itself.',
            set: { height: 2 },
            show: ['Echo'],
            sfx: 'chime',
          },
          { id: 's1b7', say: 'Notice just how short choppy waves fade away quickly, while long ocean swells travel on for miles.', set: { length: 10 }, hide: ['Echo'] },
          {
            id: 's1b8',
            say: 'So always remember: a wave is pure energy on the move, just wearing the water as its costume.',
            focus: 'Wave',
            title: { text: 'Energy on the move', kind: 'card' },
            short: 'Energy on the move',
          },
        ],
      },
    ],
  },
  scenes: [{ id: 's1', cut: 'fade', html: STAGE, css: '', js: SIXTY_JS, probe: { parts: ['Wave', 'Echo'], steps: 8 } }],
};

const PYTHAGORAS_JS = [
  "inc.idea('A right triangle with squares on its sides shows that a² + b² = c², live as its legs change.');",
  "const a = inc.param('a', { min: 1, max: 8, step: 1, value: 3, label: 'Leg a' });",
  "const b = inc.param('b', { min: 1, max: 8, step: 1, value: 4, label: 'Leg b' });",
  "const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Pythagoras', description: 'A right triangle with a square on each side; the angle opposite leg a is marked θ.' });",
  "const legA = stage.line(0, 0, 0, 0, { tone: 'b' });",
  "const legB = stage.line(0, 0, 0, 0, { tone: 'b' });",
  "const hyp = stage.line(0, 0, 0, 0, { tone: 'lit' });",
  "const sqA = stage.rect(0, 0, 0, 0, { tone: 'a' });",
  "const sqB = stage.rect(0, 0, 0, 0, { tone: 'a' });",
  "const sqC = stage.path('', { tone: 'c' });",
  "const corner = stage.polyline([[280, 129], [294, 129], [294, 115]], { tone: 'mid' });",
  "const arc = stage.path('', { tone: 'c' });",
  "const labelA = stage.text(0, 0, 'a', { tone: 'mid' }).set({ 'text-anchor': 'middle' });",
  "const labelB = stage.text(0, 0, 'b', { tone: 'mid' }).set({ 'text-anchor': 'middle' });",
  "const labelC = stage.text(0, 0, 'c', { tone: 'mid' }).set({ 'text-anchor': 'middle' });",
  "const labelT = stage.text(0, 0, 'θ', { tone: 'mid' }).set({ 'text-anchor': 'middle' });",
  "stage.part('Leg a', legA, { label: 'Leg a', info: 'The upright leg; its square has area a².' });",
  "stage.part('Leg b', legB, { label: 'Leg b', info: 'The flat leg; its square has area b².' });",
  "stage.part('Hypotenuse', hyp, { label: 'Hypotenuse', info: 'Across the right angle; its square has area c².' });",
  "stage.part('Square a', sqA, { label: 'Square a', info: 'The square on leg a, with area a².' });",
  "stage.part('Square b', sqB, { label: 'Square b', info: 'The square on leg b, with area b².' });",
  "stage.part('Square c', sqC, { label: 'Square c', info: 'The square on the hypotenuse, with area c².' });",
  "stage.part('Right angle', corner, { label: 'Right angle', info: 'The square corner the legs meet at.' });",
  "stage.part('Theta', arc, { label: 'Angle θ', info: 'The angle opposite leg a.' });",
  'inc.onFrame(() => {',
  '  const X0 = 280, Y0 = 115, U = 10;',
  '  const av = a.value, bv = b.value;',
  '  const ax = X0, ay = Y0 + av * U;',
  '  const bx = X0 + bv * U, by = Y0;',
  '  const cv = Math.hypot(av, bv);',
  '  legA.set({ x1: X0, y1: Y0, x2: ax, y2: ay });',
  '  legB.set({ x1: X0, y1: Y0, x2: bx, y2: by });',
  '  hyp.set({ x1: ax, y1: ay, x2: bx, y2: by });',
  '  sqA.set({ x: X0 - av * U, y: Y0, width: av * U, height: av * U });',
  '  sqB.set({ x: X0, y: Y0 - bv * U, width: bv * U, height: bv * U });',
  '  const mx = (ax + bx) / 2, my = (ay + by) / 2;',
  '  let nx = -(by - ay), ny = bx - ax;',
  '  const nl = Math.hypot(nx, ny) || 1;',
  '  nx /= nl;',
  '  ny /= nl;',
  '  if (nx * (mx - X0) + ny * (my - Y0) < 0) { nx = -nx; ny = -ny; }',
  '  const cl = cv * U;',
  '  sqC.d(`M ${ax} ${ay} L ${bx} ${by} L ${bx + nx * cl} ${by + ny * cl} L ${ax + nx * cl} ${ay + ny * cl} Z`);',
  '  const th = Math.atan2(av, bv);',
  '  arc.d(inc.path.arc(bx, by, 26, Math.PI - th, Math.PI));',
  "  labelA.at(X0 - (av * U) / 2, Y0 + (av * U) / 2);",
  "  labelB.at(X0 + (bv * U) / 2, Y0 - (bv * U) / 2);",
  '  labelC.at(mx + (nx * cl) / 2, my + (ny * cl) / 2);',
  '  labelT.at(bx - 48 * Math.cos(th / 2), by + 48 * Math.sin(th / 2));',
  '});',
  'inc.readout({',
  "  'a²': () => `${(a.value * a.value).toFixed(1)}`,",
  "  'b²': () => `${(b.value * b.value).toFixed(1)}`,",
  "  'c²': () => { const h = Math.hypot(a.value, b.value); return `${(h * h).toFixed(1)}`; },",
  "  'θ': () => `${((Math.atan2(a.value, b.value) * 180) / Math.PI).toFixed(1)}°`,",
  '});',
  'inc.describe(() => {',
  '  const h = Math.hypot(a.value, b.value);',
  '  return `A right triangle with legs ${a.value} and ${b.value} and hypotenuse ${h.toFixed(2)}, with squares of ${(a.value * a.value).toFixed(0)}, ${(b.value * b.value).toFixed(0)} and ${(h * h).toFixed(0)} on its sides.`;',
  '});',
  'inc.steps([',
  "  { say: 'A right triangle hides a famous rule about its three sides: the squares drawn on them always balance.' },",
  "  { say: 'The two short sides are called the legs. Side a stands upright, rising straight from the square corner below.', focus: 'Leg a' },",
  "  { say: 'Side b lies flat along the ground, meeting side a exactly at the right angle to fix the base.', focus: 'Leg b', mark: [{ type: 'pulse', part: 'Leg b' }] },",
  "  { say: 'Across the corner stretches the hypotenuse, c, always the longest of the three sides, growing whenever a leg grows.', focus: 'Hypotenuse', mark: [{ type: 'pulse', part: 'Hypotenuse' }], set: { a: 5, b: 3 }, ease: 1.2 },",
  "  { say: 'Square each leg and add the two areas. That total always exactly equals the square drawn on the hypotenuse.', write: { text: 'a^2 + b^2 = c^2', math: true }, notes: ['Square each leg', 'Add the areas'] },",
  "  { say: 'Back to three, four, five again: nine plus sixteen is twenty-five, the square on five.', mark: [{ type: 'pulse', part: 'Hypotenuse' }], set: { a: 3, b: 4 }, ease: 1.2, notes: ['That equals the square on c'] },",
  "  { say: 'Now drag leg a yourself: whatever you try, the two small squares always add up to the big one.', card: { kind: 'recap', text: 'Legs squared add to the hypotenuse squared' }, explore: { control: 'a', hint: 'Drag Leg a and watch the squares and readouts follow.' } },",
  ']);',
].join('\n');

export const PYTHAGORAS_FILM: FilmFixture = {
  id: 'pythagoras',
  storyboard: {
    film: { id: 'pythagoras', title: 'Pythagoras: talk to the teacher', version: 1, lengthTarget: 60 },
    scenes: [
      {
        id: 's1',
        idea: 'A right triangle with squares on each side shows a² + b² = c²',
        kit: 'svg',
        cut: 'fade',
        beats: [
          {
            id: 's1b1',
            say: 'A right triangle hides a famous rule about its three sides: the squares drawn on them always balance.',
            card: { kind: 'section', text: 'Pythagoras and the right triangle' },
          },
          {
            id: 's1b2',
            say: 'The two short sides are called the legs. Side a stands upright, rising straight from the square corner below.',
            focus: 'Leg a',
          },
          {
            id: 's1b3',
            say: 'Side b lies flat along the ground, meeting side a exactly at the right angle to fix the base.',
            focus: 'Leg b',
            mark: [{ type: 'pulse', part: 'Leg b' }],
          },
          {
            id: 's1b4',
            say: 'Across the corner stretches the hypotenuse, c, always the longest of the three sides, growing whenever a leg grows.',
            focus: 'Hypotenuse',
            mark: [{ type: 'pulse', part: 'Hypotenuse' }],
            set: { a: 5, b: 3 },
            ease: 1.2,
          },
          {
            id: 's1b5',
            say: 'Square each leg and add the two areas. That total always exactly equals the square drawn on the hypotenuse.',
            write: { text: 'a^2 + b^2 = c^2', math: true },
            notes: ['Square each leg', 'Add the areas'],
          },
          {
            id: 's1b6',
            say: 'Back to three, four, five again: nine plus sixteen is twenty-five, the square on five.',
            mark: [{ type: 'pulse', part: 'Hypotenuse' }],
            set: { a: 3, b: 4 },
            ease: 1.2,
            notes: ['That equals the square on c'],
          },
          {
            id: 's1b7',
            say: 'Now drag leg a yourself: whatever you try, the two small squares always add up to the big one.',
            card: { kind: 'recap', text: 'Legs squared add to the hypotenuse squared' },
            explore: { control: 'a', hint: 'Drag Leg a and watch the squares and readouts follow.' },
          },
        ],
      },
    ],
  },
  scenes: [{ id: 's1', cut: 'fade', html: STAGE, css: '', js: PYTHAGORAS_JS, probe: { parts: ['Leg a', 'Leg b', 'Hypotenuse'], steps: 7 } }],
};

export const FILM_FIXTURES: Readonly<Record<string, FilmFixture>> = {
  thirty: THIRTY_SECOND_FILM,
  sixty: SIXTY_SECOND_FILM,
  pythagoras: PYTHAGORAS_FILM,
};
