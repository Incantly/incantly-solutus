// Thin lens: where a convex lens forms an image, traced with the three principal rays.
inc.idea('Rays from an object bend through a convex lens and meet again: where they meet is the image, set by the distance and the focal length.');

const objectDistance = inc.param('objectDistance', { min: 2, max: 30, step: 0.5, value: 20, label: 'Object distance', unit: 'cm' });
const focalLength = inc.param('focalLength', { min: 4, max: 12, step: 0.5, value: 8, label: 'Focal length', unit: 'cm' });
const objectHeight = inc.param('objectHeight', { min: 1, max: 6, step: 0.5, value: 3, label: 'Object height', unit: 'cm' });

// 1/f = 1/do + 1/di, with di positive behind the lens. At do = f the rays leave parallel: no image.
const model = inc.model(({ objectDistance: d, focalLength: f, objectHeight: h }) => {
  const atFocus = Math.abs(d - f) < 1e-9;
  const image = atFocus ? 0 : (d * f) / (d - f);
  const m = atFocus ? 0 : -image / d;
  return { d, f, h, atFocus, image, m, imageHeight: m * h, real: !atFocus && image > 0 };
});

// An optical bench rather than a chart: no grid or numbered axes, just the principal axis.
const BOUNDS = [-32, -15, 64, 30];
const graph = inc.graph2d('#stage', {
  x: [-32, 32],
  y: [-15, 15],
  grid: false,
  axes: false,
  title: 'Thin lens ray diagram',
  description: 'A convex lens on the principal axis with a focal point on each side. Three rays from the tip of an object arrow pass through the lens, and an image arrow shows where they meet. Drag the object to move it.',
});
const stage = graph.stage;
const P = inc.geom.point;
const toStage = (p) => [graph.toX(p.x), graph.toY(p.y)];

graph.segment(-32, 0, 32, 0, { tone: 'mid' });
const lens = graph.segment(0, -12, 0, 12, { tone: 'b' });
const nearFocus = graph.point(-8, 0, { tone: 'mid', r: 4 });
const farFocus = graph.point(8, 0, { tone: 'mid', r: 4 });
const nearLabel = graph.label(-8, -2.8, 'F', { tone: 'mid' }).set({ 'text-anchor': 'middle' });
const farLabel = graph.label(8, -2.8, 'F′', { tone: 'mid' }).set({ 'text-anchor': 'middle' });
const object = graph.arrow(-20, 0, 0, 3, { tone: 'hi' });
const image = graph.arrow(0, 0, 0, 1, { tone: 'lit' });
// Each ray runs from the object's tip to the lens and on to the edge; a virtual image gets dashed traces back.
const rays = [stage.path('', { tone: 'a' }), stage.path('', { tone: 'c' }), stage.path('', { tone: 'mid' })];
const traces = [stage.path('', { tone: 'a', dashed: true }), stage.path('', { tone: 'c', dashed: true }), stage.path('', { tone: 'mid', dashed: true })];
// Inside the focal length, the focal ray only seems to come from F.
const guide = stage.path('', { tone: 'mid', dashed: true });
graph.drag(object, (p) => ({ objectDistance: -p.x, objectHeight: p.y }), { label: 'the object' });

stage.part('Lens', lens.handle, { label: 'Lens', info: 'A convex lens. It bends every ray towards the axis.' });
stage.part('Object', object.handle, { label: 'Object', info: 'The arrow the rays start from. Drag it.' });
stage.part('Image', image.handle, { label: 'Image', info: 'Where the rays from the tip of the object meet.' });
stage.part('Parallel ray', rays[0], { label: 'Parallel ray', info: 'Starts parallel to the axis and bends through F′.' });
stage.part('Central ray', rays[1], { label: 'Central ray', info: 'Passes straight through the centre of the lens.' });
stage.part('Focal ray', rays[2], { label: 'Focal ray', info: 'Passes through F and leaves the lens parallel to the axis.' });

inc.onFrame(() => {
  const { d, f, h } = model;
  const tip = P(-d, h);
  nearFocus.at(-f, 0);
  farFocus.at(f, 0);
  nearLabel.set({ x: graph.toX(-f), y: graph.toY(-2.8) });
  farLabel.set({ x: graph.toX(f), y: graph.toY(-2.8) });
  object.from(-d, 0, 0, h);
  guide.show(d < f);
  if (d < f) guide.d(inc.path.line([toStage(P(-f, 0)), toStage(tip)]));
  // Where each ray meets the lens, and a point it passes through after it. The focal ray needs d ≠ f.
  const focal = inc.geom.intersect(inc.geom.lineThrough(tip, P(-f, 0)), inc.geom.lineThrough(P(0, -1), P(0, 1)));
  const hits = [P(0, h), P(0, 0), focal];
  const after = [P(f, 0), P(d, -h), focal ? P(1, focal.y) : null];
  for (let i = 0; i < 3; i++) {
    const exit = hits[i] ? inc.geom.clipRay(hits[i], after[i], BOUNDS) : null;
    rays[i].show(hits[i] !== null);
    if (hits[i]) rays[i].d(inc.path.line([toStage(tip), toStage(hits[i]), ...(exit ? [toStage(exit.to)] : [])]));
    const virtual = !model.atFocus && !model.real && hits[i] !== null;
    traces[i].show(virtual);
    if (virtual) traces[i].d(inc.path.line([toStage(hits[i]), toStage(P(model.image, model.imageHeight))]));
  }
  const visible = !model.atFocus && Math.abs(model.image) < 32 && Math.abs(model.imageHeight) < 15;
  image.show(visible);
  if (visible) image.from(model.image, 0, 0, model.imageHeight);
});

const size = () => Math.abs(model.m).toFixed(2);
inc.readout({
  'Image distance': () => (model.atFocus ? 'none' : `${Math.abs(model.image).toFixed(1)} cm ${model.real ? 'behind' : 'in front'}`),
  Magnification: () => (model.atFocus ? 'none' : `×${size()}`),
  Image: () => (model.atFocus ? 'none: rays leave parallel' : model.real ? 'real, upside down' : 'virtual, upright'),
});

inc.explain(() => {
  if (model.atFocus) return 'The object sits exactly at the focal point, so every ray leaves the lens parallel to the others and no image forms.';
  if (model.real) return `The object is ${model.d.toFixed(1)} cm from the lens, beyond its focal length of ${model.f.toFixed(1)} cm, so the rays meet ${model.image.toFixed(1)} cm behind it in a real, upside-down image ${size()} times as tall.`;
  return `The object is inside the focal length, so the rays spread apart after the lens. Traced back, they meet ${Math.abs(model.image).toFixed(1)} cm in front of it, in a virtual, upright image ${size()} times as tall.`;
});

inc.describe(() => {
  const setup = `An object ${model.h.toFixed(1)} cm tall stands ${model.d.toFixed(1)} cm from a convex lens with a focal length of ${model.f.toFixed(1)} cm.`;
  if (model.atFocus) return `${setup} It sits at the focal point, so the rays leave parallel and no image forms.`;
  return `${setup} A ${model.real ? 'real, upside-down' : 'virtual, upright'} image forms ${Math.abs(model.image).toFixed(1)} cm ${model.real ? 'behind' : 'in front of'} the lens, ${Math.abs(model.imageHeight).toFixed(1)} cm tall.`;
});

inc.steps([
  { say: 'A ray parallel to the axis bends at the lens and passes through the far focal point F′.', focus: 'Parallel ray' },
  { say: 'A ray through the centre of the lens goes straight on.', focus: 'Central ray' },
  { say: 'A ray through the near focal point F leaves the lens parallel to the axis.', focus: 'Focal ray' },
  { say: 'Where the three rays meet, the image forms. Beyond the focal length it is real and upside down.', focus: 'Image' },
  { say: 'Move the object inside the focal length and the rays spread apart. Traced back, they meet in a virtual, upright image.', focus: 'Image', set: { objectDistance: 5 } },
]);
