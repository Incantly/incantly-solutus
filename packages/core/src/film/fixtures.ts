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

export const FILM_FIXTURES: Readonly<Record<string, FilmFixture>> = {
  thirty: THIRTY_SECOND_FILM,
  sixty: SIXTY_SECOND_FILM,
};
