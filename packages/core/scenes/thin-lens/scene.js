// Thin lens: where a convex lens forms an image, traced with the three principal rays.
inc.idea('Rays from an object bend through a convex lens and meet again: where they meet is the image, set by the distance and the focal length.');

const objectDistance = inc.param('objectDistance', {
  min: 2,
  max: 30,
  step: 0.5,
  value: 20,
  label: 'Object distance',
  unit: 'cm',
});
const focalLength = inc.param('focalLength', { min: 4, max: 12, step: 0.5, value: 8, label: 'Focal length', unit: 'cm' });
const objectHeight = inc.param('objectHeight', { min: 1, max: 6, step: 0.5, value: 3, label: 'Object height', unit: 'cm' });

// 1/f = 1/do + 1/di, with di positive behind the lens. At do = f the rays leave parallel
// and there is no image, so the model says so with null rather than an infinite distance.
const model = inc.model(({ objectDistance: d, focalLength: f, objectHeight: h }) => {
  const atFocus = Math.abs(d - f) < 1e-9;
  const image = atFocus ? null : (d * f) / (d - f);
  const magnification = atFocus ? null : -image / d;
  return {
    d,
    f,
    h,
    atFocus,
    image,
    imageHeight: atFocus ? null : magnification * h,
    magnification,
    real: !atFocus && image > 0,
  };
});

const X = [-32, 32];
const Y = [-15, 15];
const BOUNDS = [X[0], Y[0], X[1] - X[0], Y[1] - Y[0]];
const LENS_HALF_HEIGHT = 12;

// An optical bench rather than a chart: no grid or numbered axes, just the principal axis.
const graph = inc.graph2d('#stage', {
  x: X,
  y: Y,
  grid: false,
  axes: false,
  title: 'Thin lens ray diagram',
  description:
    'A convex lens stands on the principal axis with a focal point on each side. An object arrow on the left sends three rays through the lens, and an image arrow shows where they meet.',
});
const stage = graph.stage;
const toScreen = (p) => [graph.toX(p.x), graph.toY(p.y)];
const point = inc.geom.point;

graph.segment(X[0], 0, X[1], 0, { tone: 'mid' });
const lens = graph.segment(0, -LENS_HALF_HEIGHT, 0, LENS_HALF_HEIGHT, { tone: 'b' });
const nearFocus = graph.point(-8, 0, { tone: 'mid', r: 4 });
const farFocus = graph.point(8, 0, { tone: 'mid', r: 4 });
const nearLabel = graph.label(-8, -2.8, 'F', { tone: 'mid' }).set({ 'text-anchor': 'middle' });
const farLabel = graph.label(8, -2.8, 'F′', { tone: 'mid' }).set({ 'text-anchor': 'middle' });
const object = graph.arrow(-20, 0, 0, 3, { tone: 'hi' });
const image = graph.arrow(0, 0, 0, 1, { tone: 'lit' });

// Each ray is one path from the object's tip to the lens and on to the edge of the graph.
// Virtual images also get dashed lines that trace the rays back to where they seem to start.
const parallelRay = stage.path('', { tone: 'a' });
const centralRay = stage.path('', { tone: 'c' });
const focalRay = stage.path('', { tone: 'mid' });
const traces = [stage.path('', { tone: 'a', dashed: true }), stage.path('', { tone: 'c', dashed: true }), stage.path('', { tone: 'mid', dashed: true })];
const focalGuide = stage.path('', { tone: 'mid', dashed: true });

stage.part('Lens', lens.handle, { label: 'Lens', info: 'A convex lens. It bends every ray towards the axis.' });
stage.part('Object', object.handle, { label: 'Object', info: 'The arrow the rays start from.' });
stage.part('Image', image.handle, { label: 'Image', info: 'Where the rays from the tip of the object meet.' });
stage.part('Parallel ray', parallelRay, { label: 'Parallel ray', info: 'Starts parallel to the axis and bends through F′.' });
stage.part('Central ray', centralRay, { label: 'Central ray', info: 'Passes straight through the centre of the lens.' });
stage.part('Focal ray', focalRay, { label: 'Focal ray', info: 'Passes through F and leaves the lens parallel to the axis.' });

/** The ray from `start` through `lensPoint`, then on through `toward` to the edge of the graph. */
const rayPath = (start, lensPoint, toward) => {
  const exit = inc.geom.clipRay(lensPoint, toward, BOUNDS);
  const points = [toScreen(start), toScreen(lensPoint)];
  if (exit) points.push(toScreen(exit.to));
  return inc.path.line(points);
};

const inRange = (x, y) => x > X[0] && x < X[1] && y > Y[0] && y < Y[1];

inc.onFrame(() => {
  const d = model.d;
  const f = model.f;
  const h = model.h;
  const tip = point(-d, h);
  const nearF = point(-f, 0);
  const farF = point(f, 0);

  nearFocus.at(-f, 0);
  farFocus.at(f, 0);
  nearLabel.set({ x: graph.toX(-f), y: graph.toY(-2.8) });
  farLabel.set({ x: graph.toX(f), y: graph.toY(-2.8) });
  object.from(-d, 0, 0, h);

  // Parallel ray: along the axis direction to the lens, then through F′.
  const p1 = point(0, h);
  parallelRay.d(rayPath(tip, p1, farF));
  // Central ray: straight through the centre.
  const p2 = point(0, 0);
  centralRay.d(rayPath(tip, p2, point(d, -h)));
  // Focal ray: on the line through F to the lens, then parallel to the axis.
  const lensLine = inc.geom.lineThrough(point(0, -1), point(0, 1));
  const p3 = inc.geom.intersect(inc.geom.lineThrough(tip, nearF), lensLine);
  focalRay.show(p3 !== null);
  if (p3 !== null) focalRay.d(rayPath(tip, p3, point(p3.x + 1, p3.y)));
  // Inside the focal length the focal ray only seems to come from F.
  focalGuide.show(d < f);
  if (d < f) focalGuide.d(inc.path.line([toScreen(nearF), toScreen(tip)]));

  const hasImage = !model.atFocus;
  const di = hasImage ? model.image : 0;
  const hi = hasImage ? model.imageHeight : 0;
  const visible = hasImage && inRange(di, hi);
  image.show(visible);
  if (visible) image.from(di, 0, 0, hi);

  const virtual = hasImage && !model.real;
  const lensPoints = [p1, p2, p3];
  for (let i = 0; i < traces.length; i++) {
    const from = lensPoints[i];
    const show = virtual && from !== null;
    traces[i].show(show);
    if (show) traces[i].d(inc.path.line([toScreen(from), toScreen(point(di, hi))]));
  }
});

inc.readout({
  'Image distance': () => (model.atFocus ? 'none' : Math.abs(model.image).toFixed(1) + (model.real ? ' cm behind' : ' cm in front')),
  Magnification: () => (model.atFocus ? 'none' : '×' + Math.abs(model.magnification).toFixed(2)),
  Image: () => (model.atFocus ? 'none: rays leave parallel' : model.real ? 'real, upside down' : 'virtual, upright'),
});

inc.explain(() => {
  if (model.atFocus) {
    return 'The object sits exactly at the focal point, so every ray leaves the lens parallel to the others and no image forms.';
  }
  const size = Math.abs(model.magnification).toFixed(2);
  if (model.real) {
    return (
      'The object is ' +
      model.d.toFixed(1) +
      ' cm from the lens, beyond its focal length of ' +
      model.f.toFixed(1) +
      ' cm, so the rays meet ' +
      model.image.toFixed(1) +
      ' cm behind it in a real, upside-down image ' +
      size +
      ' times as tall.'
    );
  }
  return (
    'The object is inside the focal length, so the rays spread apart after the lens. Traced back, they meet ' +
    Math.abs(model.image).toFixed(1) +
    ' cm in front of it, in a virtual, upright image ' +
    size +
    ' times as tall.'
  );
});

inc.describe(() => {
  const setup =
    'An object ' +
    model.h.toFixed(1) +
    ' cm tall stands ' +
    model.d.toFixed(1) +
    ' cm from a convex lens with a focal length of ' +
    model.f.toFixed(1) +
    ' cm. ';
  if (model.atFocus) return setup + 'It sits at the focal point, so the rays leave parallel and no image forms.';
  return (
    setup +
    (model.real ? 'A real, upside-down image forms ' : 'A virtual, upright image appears ') +
    Math.abs(model.image).toFixed(1) +
    (model.real ? ' cm behind the lens, ' : ' cm in front of the lens, ') +
    Math.abs(model.imageHeight).toFixed(1) +
    ' cm tall.'
  );
});

inc.steps([
  { say: 'A ray parallel to the axis bends at the lens and passes through the far focal point F′.', focus: 'Parallel ray' },
  { say: 'A ray through the centre of the lens goes straight on.', focus: 'Central ray' },
  { say: 'A ray through the near focal point F leaves the lens parallel to the axis.', focus: 'Focal ray' },
  { say: 'Where the three rays meet, the image forms. Beyond the focal length it is real and upside down.', focus: 'Image' },
  {
    say: 'Move the object inside the focal length and the rays spread apart. Traced back, they meet in a virtual, upright image.',
    focus: 'Image',
    set: { objectDistance: 5 },
  },
]);
