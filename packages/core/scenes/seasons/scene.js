// Seasons: Earth's tilted axis keeps pointing the same way in space as Earth goes round the Sun.
inc.idea("Seasons come from Earth's tilted axis, which keeps pointing the same way in space as Earth circles the Sun, so each half of Earth leans toward the Sun for half the year.");

const day = inc.param('day', { min: 1, max: 365, step: 1, value: 172, label: 'Day of the year' });
const tilt = inc.param('tilt', { min: 0, max: 45, step: 0.1, value: 23.4, label: 'Tilt', unit: '°' });
const latitude = inc.param('latitude', { min: -66, max: 66, step: 1, value: 52, label: 'Latitude', unit: '°' });

const RAD = Math.PI / 180;
// Where the Sun is overhead, in radians of latitude, on a day of the year: the June solstice is day 172.
const overhead = (d, t) => Math.asin(Math.sin(t * RAD) * Math.cos((2 * Math.PI * (d - 172)) / 365.25));
// Hours of daylight at a latitude in degrees: the Sun sets at the hour angle H with cos H = −tan φ tan δ.
const daylight = (lat, dec) => (24 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat * RAD) * Math.tan(dec))));

const model = inc.model(({ day: d, tilt: t, latitude: lat }) => {
  const dec = overhead(d, t);
  return { orbit: (2 * Math.PI * (d - 172)) / 365.25, dec, hours: daylight(lat, dec), noon: 90 - Math.abs(lat - dec / RAD) };
});

// An orbit of radius 4 and an Earth of radius 0.6: not to scale, so both can be seen.
const R = 4;
const E = 0.6;
const space = inc.space3d('#stage', {
  title: 'Earth going round the Sun',
  description: 'Earth circles the Sun with its axis tilted the same way all year. A dark shell covers the night side, a dot marks where the Sun is overhead, and a ring marks the chosen latitude: the share of it in sunlight is the share of the day in daylight.',
  viewBox: [0, 0, 720, 420],
  camera: { yaw: -55, pitch: 30, scale: 58 },
});
// The orbit, open where Earth is, so it does not run across Earth's face.
const ring = (at) => {
  const points = [];
  const gap = (1.2 * E) / R;
  for (let i = 0; i <= 96; i++) {
    const a = at + gap + ((2 * Math.PI - 2 * gap) * i) / 96;
    points.push([R * Math.cos(a), R * Math.sin(a), 0]);
  }
  return points;
};
const orbit = space.line(ring(model.orbit), { tone: 'faint', dashed: true });
const sun = space.model('planet', { size: 1.6, tone: 'lit' });
// Earth's own frame: it moves round the orbit and leans by the tilt, always toward −x.
const frame = space.group();
const earth = space.model('planet', { parent: frame, size: 2 * E, tone: 'b' });
earth.piece('axis').show();
const circle = (lat) => {
  const points = [];
  for (let i = 0; i <= 48; i++) {
    const a = (2 * Math.PI * i) / 48;
    points.push([1.01 * E * Math.cos(lat * RAD) * Math.cos(a), 1.01 * E * Math.cos(lat * RAD) * Math.sin(a), 1.01 * E * Math.sin(lat * RAD)]);
  }
  return points;
};
space.line(circle(0), { parent: frame, tone: 'faint' });
const parallel = space.line(circle(latitude.value), { parent: frame, tone: 'c' });
// The night side: a shadow over the half of Earth turned away from the Sun, lying on its surface and drawn over it.
const dome = [];
for (let i = 0; i <= 8; i++) dome.push([E * Math.cos((i * Math.PI) / 16), E * Math.sin((i * Math.PI) / 16)]);
const night = space.lathe(dome, { look: 'shadow', open: true, segments: 24, bias: 0.1 * E });
const spot = space.point([R - E, 0, 0], { tone: 'lit' });
const light = space.arrow([0.9, 0, 0], [R - E - 0.15, 0, 0], { tone: 'lit' });
space.label(sun, 'Sun');
// The solstices and equinoxes, just outside the orbit.
space.label([1.2 * R, 0, 0], 'June');
space.label([0, 1.2 * R, 0], 'September');
space.label([-1.2 * R, 0, 0], 'December');
space.label([0, -1.2 * R, 0], 'March');
// Dragging Earth along its orbit moves through the year.
space.drag(
  earth,
  (p) => {
    const w = space.pick(p.x, p.y, 0);
    if (!w) return;
    const d = Math.round(172 + (Math.atan2(w[1], w[0]) * 365.25) / (2 * Math.PI));
    return { day: d < 1 ? d + 365 : d };
  },
  { label: 'Earth' },
);

space.part('Sun', sun, { label: 'Sun', info: 'Its light falls most directly where it is overhead.' });
space.part('Earth', earth, { label: 'Earth', info: 'Drag it round its orbit to move through the year.' });
space.part('Axis', earth.piece('axis'), { label: 'Axis', info: 'It keeps pointing the same way in space all year.' });
space.part('Orbit', orbit, { label: 'Orbit', info: 'One trip round takes a year.' });
space.part('Night', night, { label: 'Night side', info: 'The half of Earth turned away from the Sun.' });
space.part('Latitude', parallel, { label: 'Latitude', info: 'As Earth turns, a place goes round this ring: the share of it in sunlight is the share of the day in daylight.' });

inc.onFrame(() => {
  const ux = Math.cos(model.orbit);
  const uy = Math.sin(model.orbit);
  frame.at(R * ux, R * uy, 0);
  orbit.points(ring(model.orbit));
  frame.rotate(0, -tilt.value, 0);
  parallel.points(circle(latitude.value));
  night.at(R * ux, R * uy, 0);
  night.orient(inc.vec.rotA([-uy, ux, 0], Math.PI / 2));
  spot.at((R - E) * ux, (R - E) * uy, 0);
  light.set([0.9 * ux, 0.9 * uy, 0], [(R - E - 0.15) * ux, (R - E - 0.15) * uy, 0]);
});

const place = () => `${Math.abs(model.dec / RAD).toFixed(1)}° ${model.dec >= 0 ? 'N' : 'S'}`;
const where = () => `${Math.abs(latitude.value)}° ${latitude.value >= 0 ? 'N' : 'S'}`;
inc.readout({
  'Sun overhead at': place,
  Daylight: () => `${model.hours.toFixed(1)} h`,
  'Noon Sun height': () => `${Math.max(0, model.noon).toFixed(0)}°`,
});

inc.explain(() =>
  model.hours < 0.05
    ? `On day ${day.value} the Sun is overhead at ${place()}, so at ${where()} it never rises: the whole day is night.`
    : model.hours > 23.95
      ? `On day ${day.value} the Sun is overhead at ${place()}, so at ${where()} it never sets.`
      : `On day ${day.value} the Sun is overhead at ${place()}, so ${where()} gets ${model.hours.toFixed(1)} hours of daylight, with the Sun ${model.noon.toFixed(0)}° above the horizon at noon.`,
);

inc.describe(
  () =>
    `Earth is ${Math.round(day.value)} days into the year on its orbit round the Sun, with its axis tilted ${tilt.value.toFixed(1)}°. The Sun is overhead at ${place()}, and at ${where()} daylight lasts ${model.hours.toFixed(1)} hours.`,
);

inc.steps([
  { say: "Earth's axis leans, and keeps pointing the same way in space all the way round the orbit.", focus: 'Axis', set: { day: 172, tilt: 23.4 } },
  { say: 'In June the north leans toward the Sun: the Sun is overhead north of the equator, and northern days are long.', focus: 'Night', set: { day: 172 } },
  { say: 'At the equinoxes neither half leans toward the Sun: every latitude ring is half in sunlight, so day and night are twelve hours everywhere.', focus: 'Latitude', set: { day: 264 } },
  { say: 'In December the south leans toward the Sun, and less of a northern ring is in sunlight: northern days are short.', focus: 'Latitude', set: { day: 355 } },
  { say: 'With no tilt there would be no seasons: every day would be as long as every other.', focus: 'Axis', set: { tilt: 0 } },
]);
