import type { ModelData, ModelName, ModelNode, Vec2, Vec3 } from '../../api/types';
import { extrudeData, loftData } from './mesh';

/**
 * The model library (S3-9): ready-made models as data in the glTF manner, a
 * tree of nodes that each hold one solid and a placement, so a scene can
 * place a rocket or a beaker in one call instead of building it from solids.
 * Every model is 2 units at its largest side; grounded ones stand on z = 0
 * and are centred on x and y, things in space or on an axle are centred on
 * their origin. Vehicles face +x. Named nodes are pieces: each is placed so
 * an exploded view moves it the way it comes apart, and turns about the
 * point it turns about in use.
 */

/** Points on a circle in the (r, z) plane, for rounded profiles: degrees counter-clockwise from +r. */
function arc(cr: number, cz: number, radius: number, from: number, to: number, steps: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    out.push([Math.max(0, cr + radius * Math.cos(a)), cz + radius * Math.sin(a)]);
  }
  return out;
}

/** The same node turned about z by each of the angles, in degrees. */
function around(node: ModelNode, angles: readonly number[]): ModelNode[] {
  return angles.map((a) => ({ ...node, rotate: [0, 0, a] as Vec3 }));
}

/** Four copies at (±x, ±y, z). */
function corners(x: number, y: number, z: number, node: ModelNode): ModelNode[] {
  return [
    { ...node, at: [x, y, z] },
    { ...node, at: [x, -y, z] },
    { ...node, at: [-x, y, z] },
    { ...node, at: [-x, -y, z] },
  ];
}

/** A gear's outline: teeth around a root circle, in the xy plane. */
function teeth(count: number, root: number, tip: number): Vec2[] {
  const out: Vec2[] = [];
  const step = (2 * Math.PI) / count;
  for (let k = 0; k < count; k++) {
    const a = k * step;
    for (const [r, f] of [
      [root, 0],
      [tip, 0.18],
      [tip, 0.45],
      [root, 0.63],
    ] as const) {
      out.push([r * Math.cos(a + f * step), r * Math.sin(a + f * step)]);
    }
  }
  return out;
}

/** A lens profile: two curved faces meeting a thin rim, `centre` thick on the axis and `edge` thick at radius 1. */
function lensProfile(centre: number, edge: number): Vec2[] {
  const face = (r: number) => edge / 2 + ((centre - edge) / 2) * (1 - r * r);
  const radii = [0, 0.4, 0.7, 0.9, 1];
  return [...radii.map((r): Vec2 => [r, -face(r)]), ...[...radii].reverse().map((r): Vec2 => [r, face(r)])];
}

const WHEEL_Y: Vec3 = [90, 0, 0];

const ROCKET: ModelData = {
  tone: 'lo',
  trim: 'a',
  nodes: [
    {
      name: 'engine',
      label: 'Engine',
      at: [0, 0, 0.12],
      tone: 'mid',
      children: [
        { lathe: [[0.19, -0.12], [0.12, 0.12]] },
        { name: 'flame', label: 'Exhaust', tone: 'lit', hidden: true, at: [0, 0, -0.12], lathe: [[0.15, 0], [0.12, -0.18], [0.06, -0.4], [0, -0.55]] },
      ],
    },
    {
      name: 'fins',
      label: 'Fins',
      tone: 'trim',
      at: [0, 0, 0.42],
      children: around({ mesh: extrudeData([[0.2, 0.26], [0.2, -0.18], [0.47, -0.4], [0.47, -0.16]], 0.035, 'xz') }, [0, 90, 180, 270]),
    },
    {
      name: 'body',
      label: 'Fuel tank',
      at: [0, 0, 0.89],
      cylinder: [0.22, 1.3],
      children: [{ name: 'window', label: 'Window', tone: 'b', at: [0.2, 0, 0.32], sphere: 0.07 }],
    },
    {
      name: 'nose',
      label: 'Nose cone',
      tone: 'trim',
      at: [0, 0, 1.54],
      lathe: [[0.22, 0], [0.212, 0.092], [0.188, 0.184], [0.148, 0.276], [0.091, 0.368], [0, 0.46]],
    },
  ],
};

const SATELLITE: ModelData = {
  tone: 'lit',
  trim: 'b',
  nodes: [
    { name: 'body', label: 'Body', box: [0.45, 0.45, 0.55] },
    {
      name: 'panels',
      label: 'Solar panels',
      tone: 'trim',
      children: [
        { tube: [[0, 0.22, 0], [0, 0.33, 0], 0.02], tone: 'mid' },
        { tube: [[0, -0.22, 0], [0, -0.33, 0], 0.02], tone: 'mid' },
        { box: [0.38, 0.67, 0.025], at: [0, 0.665, 0] },
        { box: [0.38, 0.67, 0.025], at: [0, -0.665, 0] },
      ],
    },
    {
      name: 'dish',
      label: 'Antenna',
      tone: 'lo',
      at: [0.32, 0, 0.1],
      rotate: [0, 90, 0],
      children: [
        { lathe: [[0, 0], [0.08, 0.013], [0.15, 0.045], [0.22, 0.097]], open: true },
        { tube: [[0, 0, -0.1], [0, 0, 0], 0.025], tone: 'mid' },
        { tube: [[0, 0, 0], [0, 0, 0.2], 0.01], tone: 'mid' },
      ],
    },
  ],
};

const AIRPLANE: ModelData = {
  tone: 'lo',
  trim: 'b',
  nodes: [
    {
      name: 'fuselage',
      label: 'Fuselage',
      rotate: [0, 90, 0],
      lathe: [[0, -1], [0.05, -0.97], [0.09, -0.85], [0.12, -0.6], [0.13, -0.3], [0.13, 0.55], [0.12, 0.75], [0.09, 0.9], [0.05, 0.97], [0, 1]],
    },
    {
      name: 'wings',
      label: 'Wings',
      at: [0.05, 0, -0.03],
      mesh: extrudeData([[0.3, 0], [-0.1, -0.95], [-0.25, -0.95], [-0.05, 0], [-0.25, 0.95], [-0.1, 0.95]], 0.035, 'xy'),
    },
    {
      name: 'engines',
      label: 'Engines',
      tone: 'mid',
      at: [0.1, 0, -0.1],
      children: [
        { cylinder: [0.055, 0.26], rotate: [0, 90, 0], at: [0, 0.42, 0] },
        { cylinder: [0.055, 0.26], rotate: [0, 90, 0], at: [0, -0.42, 0] },
      ],
    },
    {
      name: 'tail',
      label: 'Tail',
      tone: 'trim',
      at: [-0.85, 0, 0],
      children: [
        { mesh: extrudeData([[0.23, 0.08], [-0.1, 0.08], [-0.15, 0.45], [-0.03, 0.45]], 0.03, 'xz') },
        { at: [0, 0, 0.05], mesh: extrudeData([[0.13, 0], [-0.05, -0.36], [-0.15, -0.36], [-0.11, 0], [-0.15, 0.36], [-0.05, 0.36]], 0.025, 'xy') },
      ],
    },
  ],
};

const CAR: ModelData = {
  tone: 'b',
  trim: 'hi',
  nodes: [
    {
      name: 'body',
      label: 'Body',
      mesh: extrudeData([[-1, 0.18], [1, 0.18], [1, 0.4], [0.92, 0.52], [-0.96, 0.54], [-1, 0.46]], 0.86, 'xz'),
      children: [
        { box: [0.02, 0.16, 0.06], at: [1, 0.3, 0.38], tone: 'lit', bias: 0.2 },
        { box: [0.02, 0.16, 0.06], at: [1, -0.3, 0.38], tone: 'lit', bias: 0.2 },
      ],
    },
    { name: 'cabin', label: 'Cabin', tone: 'lo', mesh: extrudeData([[-0.62, 0.53], [0.42, 0.53], [0.12, 0.86], [-0.48, 0.86]], 0.74, 'xz') },
    {
      name: 'wheels',
      label: 'Wheels',
      tone: 'trim',
      // Just clear of the body's sides, so no wheel passes through it.
      children: corners(0.6, 0.51, 0.2, {
        children: [
          { cylinder: [0.2, 0.15], rotate: WHEEL_Y },
          { cylinder: [0.09, 0.16], rotate: WHEEL_Y, tone: 'lo', segments: 12 },
        ],
      }),
    },
  ],
};

const CART: ModelData = {
  tone: 'c',
  trim: 'hi',
  nodes: [
    { name: 'body', label: 'Trolley', at: [0, 0, 0.34], box: [2, 0.8, 0.24] },
    { name: 'wheels', label: 'Wheels', tone: 'trim', children: corners(0.7, 0.36, 0.13, { cylinder: [0.13, 0.08], rotate: WHEEL_Y }) },
  ],
};

const DECK: Vec2[] = [[-1, -0.4], [0.25, -0.45], [0.72, -0.3], [1, 0], [0.72, 0.3], [0.25, 0.45], [-1, 0.4]];
const hullRing = (z: number, kx: number, ky: number, dx: number) => ({ z, points: DECK.map(([x, y]): Vec2 => [x * kx + dx, y * ky]) });

const BOAT: ModelData = {
  tone: 'a',
  trim: 'lo',
  nodes: [
    { name: 'hull', label: 'Hull', mesh: loftData([hullRing(0, 0.86, 0.3, -0.02), hullRing(0.2, 0.95, 0.82, -0.01), hullRing(0.42, 1, 1, 0)]) },
    { name: 'cabin', label: 'Cabin', tone: 'trim', at: [-0.3, 0, 0.56], box: [0.55, 0.46, 0.28] },
  ],
};

const WIND_TURBINE: ModelData = {
  tone: 'lo',
  trim: 'mid',
  nodes: [
    { name: 'tower', label: 'Tower', lathe: [[0.065, 0], [0.04, 1.42]] },
    { name: 'nacelle', label: 'Generator', at: [0, 0, 1.47], box: [0.32, 0.11, 0.11] },
    {
      name: 'rotor',
      label: 'Rotor',
      at: [0.2, 0, 1.47],
      children: [
        { cone: [0.06, 0.12], rotate: [0, 90, 0], tone: 'trim' },
        ...[0, 120, 240].map(
          (a): ModelNode => ({ rotate: [a, 0, 0], mesh: extrudeData([[-0.035, 0.04], [0.04, 0.04], [0.022, 0.53], [-0.004, 0.53]], 0.02, 'yz') }),
        ),
      ],
    },
  ],
};

const TREE: ModelData = {
  tone: 'c',
  trim: 'lit',
  nodes: [
    { name: 'trunk', label: 'Trunk', tone: 'trim', at: [0, 0, 0.4], cylinder: [0.09, 0.8], segments: 12 },
    {
      name: 'leaves',
      label: 'Leaves',
      at: [0, 0, 1.3],
      children: [
        { sphere: 0.52 },
        { sphere: 0.38, at: [0.3, 0.12, -0.22] },
        { sphere: 0.38, at: [-0.26, -0.16, -0.18] },
        { sphere: 0.34, at: [-0.05, 0.28, 0.26] },
        { sphere: 0.3, at: [0.14, -0.3, 0.2] },
      ],
    },
  ],
};

const PINE: ModelData = {
  tone: 'c',
  trim: 'lit',
  nodes: [
    { name: 'trunk', label: 'Trunk', tone: 'trim', at: [0, 0, 0.3], cylinder: [0.08, 0.6], segments: 12 },
    {
      name: 'leaves',
      label: 'Needles',
      at: [0, 0, 0.45],
      children: [
        { cone: [0.55, 0.8], at: [0, 0, 0.4] },
        { cone: [0.42, 0.7], at: [0, 0, 0.85] },
        { cone: [0.3, 0.6], at: [0, 0, 1.3] },
      ],
    },
  ],
};

const HOUSE: ModelData = {
  tone: 'lo',
  trim: 'a',
  nodes: [
    { name: 'walls', label: 'Walls', at: [0, 0, 0.44], box: [1.3, 1.5, 0.88] },
    { name: 'roof', label: 'Roof', tone: 'trim', at: [0, 0, 0.88], mesh: extrudeData([[-0.85, 0], [0.85, 0], [0, 0.6]], 1.45, 'yz') },
    { name: 'chimney', label: 'Chimney', tone: 'mid', at: [-0.25, 0.42, 1.36], box: [0.16, 0.16, 0.4] },
    { name: 'door', label: 'Door', tone: 'lit', bias: 0.3, at: [0.655, 0, 0.27], box: [0.02, 0.3, 0.54] },
    {
      name: 'windows',
      label: 'Windows',
      tone: 'b',
      bias: 0.3,
      children: [
        { box: [0.02, 0.26, 0.24], at: [0.655, 0.45, 0.55] },
        { box: [0.02, 0.26, 0.24], at: [0.655, -0.45, 0.55] },
        { box: [0.3, 0.02, 0.24], at: [0.25, 0.755, 0.55] },
        { box: [0.3, 0.02, 0.24], at: [-0.25, 0.755, 0.55] },
      ],
    },
  ],
};

const PERSON: ModelData = {
  tone: 'b',
  trim: 'lo',
  nodes: [
    {
      name: 'legs',
      label: 'Legs',
      tone: 'hi',
      at: [0, 0, 0.43],
      children: [
        { cylinder: [0.085, 0.86], at: [0, 0.11, 0], segments: 12 },
        { cylinder: [0.085, 0.86], at: [0, -0.11, 0], segments: 12 },
      ],
    },
    {
      name: 'body',
      label: 'Body',
      at: [0, 0, 1.2],
      children: [
        { lathe: [[0.19, -0.38], [0.22, -0.2], [0.23, 0.05], [0.22, 0.22], [0.16, 0.33], [0, 0.36]], scale: [0.62, 1, 1] },
        { tube: [[0, 0.24, 0.24], [0, 0.31, -0.3], 0.055], segments: 10 },
        { tube: [[0, -0.24, 0.24], [0, -0.31, -0.3], 0.055], segments: 10 },
        { sphere: 0.06, at: [0, 0.31, -0.33], tone: 'trim' },
        { sphere: 0.06, at: [0, -0.31, -0.33], tone: 'trim' },
      ],
    },
    {
      name: 'head',
      label: 'Head',
      tone: 'trim',
      at: [0, 0, 1.76],
      children: [{ sphere: 0.16 }, { cylinder: [0.06, 0.14], at: [0, 0, -0.18], segments: 10 }],
    },
  ],
};

const TABLE: ModelData = {
  tone: 'lo',
  trim: 'mid',
  nodes: [
    { name: 'top', label: 'Table top', at: [0, 0, 0.96], box: [2, 1.1, 0.08] },
    { name: 'legs', label: 'Legs', tone: 'trim', children: corners(0.9, 0.48, 0.46, { cylinder: [0.04, 0.92], segments: 10 }) },
  ],
};

const RAMP: ModelData = {
  tone: 'lo',
  nodes: [{ name: 'ramp', label: 'Ramp', mesh: extrudeData([[-1, 0], [1, 0], [-1, 2 * Math.tan(Math.PI / 6)]], 0.8, 'xz') }],
};

const PULLEY: ModelData = {
  tone: 'mid',
  trim: 'hi',
  nodes: [
    { name: 'wheel', label: 'Pulley wheel', rotate: WHEEL_Y, lathe: [[0, -0.11], [0.7, -0.11], [0.7, -0.07], [0.6, 0], [0.7, 0.07], [0.7, 0.11], [0, 0.11]] },
    { name: 'axle', label: 'Axle', tone: 'trim', rotate: WHEEL_Y, cylinder: [0.06, 0.4], segments: 12 },
    {
      name: 'mount',
      label: 'Mount',
      tone: 'trim',
      children: [
        { box: [0.14, 0.03, 1.02], at: [0, 0.17, 0.45] },
        { box: [0.14, 0.03, 1.02], at: [0, -0.17, 0.45] },
        { box: [0.14, 0.37, 0.09], at: [0, 0, 0.955] },
        { torus: [0.12, 0.03], rotate: WHEEL_Y, at: [0, 0, 1.15], segments: 10 },
      ],
    },
  ],
};

const MASS: ModelData = {
  tone: 'hi',
  trim: 'mid',
  nodes: [
    { name: 'weight', label: 'Mass', lathe: [[0.42, 0], [0.42, 0.9], [0.36, 1], [0.12, 1.04], [0.1, 1.06], [0.1, 1.3]] },
    { name: 'hook', label: 'Hook', tone: 'trim', at: [0, 0, 1.55], rotate: WHEEL_Y, torus: [0.2, 0.05], segments: 12 },
  ],
};

const MAGNET: ModelData = {
  tone: 'a',
  trim: 'b',
  nodes: [
    { name: 'north', label: 'North pole', at: [0.5, 0, 0.15], box: [1, 0.4, 0.3] },
    { name: 'south', label: 'South pole', tone: 'trim', at: [-0.5, 0, 0.15], box: [1, 0.4, 0.3] },
  ],
};

const COMPASS: ModelData = {
  tone: 'a',
  trim: 'lo',
  nodes: [
    { name: 'case', label: 'Case', tone: 'trim', lathe: [[0, 0], [1, 0], [1, 0.16], [0.93, 0.16], [0.93, 0.05], [0, 0.05]] },
    {
      name: 'needle',
      label: 'Needle',
      at: [0, 0, 0.1],
      children: [
        { mesh: extrudeData([[0, -0.1], [0.85, 0], [0, 0.1]], 0.03, 'xy') },
        { mesh: extrudeData([[0, -0.1], [0, 0.1], [-0.85, 0]], 0.03, 'xy'), tone: 'mid' },
        { cylinder: [0.05, 0.06], tone: 'hi', segments: 12 },
      ],
    },
  ],
};

const BATTERY: ModelData = {
  tone: 'hi',
  trim: 'lit',
  nodes: [
    { name: 'body', label: 'Cell', at: [0, 0, 0.65], cylinder: [0.36, 1.3] },
    { name: 'cap', label: 'Positive end', tone: 'trim', at: [0, 0, 1.58], cylinder: [0.36, 0.56] },
    { name: 'terminal', label: 'Positive terminal', tone: 'mid', at: [0, 0, 1.93], cylinder: [0.12, 0.14], segments: 12 },
  ],
};

const BULB: ModelData = {
  tone: 'lo',
  trim: 'lit',
  nodes: [
    {
      name: 'base',
      label: 'Screw base',
      tone: 'mid',
      children: [
        { lathe: [[0.2, 0.06], [0.22, 0.12], [0.2, 0.2], [0.22, 0.28], [0.2, 0.36], [0.22, 0.44], [0.21, 0.53]], segments: 12 },
        { cylinder: [0.09, 0.07], at: [0, 0, 0.035], tone: 'hi', segments: 12 },
      ],
    },
    {
      name: 'filament',
      label: 'Filament',
      tone: 'trim',
      at: [0, 0, 1.3],
      children: [
        { torus: [0.1, 0.014], rotate: WHEEL_Y, segments: 10 },
        { tube: [[0.05, 0, -0.76], [0.1, 0, 0], 0.008], tone: 'mid', segments: 6 },
        { tube: [[-0.05, 0, -0.76], [-0.1, 0, 0], 0.008], tone: 'mid', segments: 6 },
      ],
    },
    {
      name: 'glass',
      label: 'Glass bulb',
      look: 'ghost',
      open: true,
      lathe: [[0.2, 0.52], [0.21, 0.72], [0.3, 0.9], [0.48, 1.07], [0.57, 1.3], [0.56, 1.58], [0.46, 1.81], [0.27, 1.95], [0, 2]],
    },
  ],
};

const FLASK: ModelData = {
  tone: 'water',
  trim: 'lo',
  nodes: [
    { name: 'liquid', label: 'Liquid', lathe: [[0, 0.02], [0.59, 0.02], [0.62, 0.07], [0.6, 0.14], [0.45, 0.6]] },
    {
      name: 'glass',
      label: 'Flask',
      tone: 'trim',
      look: 'ghost',
      open: true,
      lathe: [[0, 0], [0.6, 0], [0.65, 0.05], [0.63, 0.14], [0.22, 1.25], [0.19, 1.35], [0.19, 1.9], [0.23, 1.94], [0.23, 2]],
    },
  ],
};

const BEAKER: ModelData = {
  tone: 'water',
  trim: 'lo',
  nodes: [
    { name: 'liquid', label: 'Liquid', at: [0, 0, 0.03], lathe: [[0, 0], [0.69, 0], [0.69, 0.9], [0, 0.9]] },
    {
      name: 'glass',
      label: 'Beaker',
      tone: 'trim',
      look: 'ghost',
      open: true,
      lathe: [[0, 0], [0.7, 0], [0.72, 0.03], [0.72, 1.9], [0.76, 1.96], [0.78, 2]],
      children: [0.5, 0.75, 1, 1.25, 1.5].map((z, i): ModelNode => ({ box: [0.012, i % 2 === 0 ? 0.24 : 0.12, 0.016], at: [0.725, 0, z], tone: 'mid', look: 'solid', bias: 0.1 })),
    },
  ],
};

const TEST_TUBE: ModelData = {
  tone: 'water',
  trim: 'lo',
  nodes: [
    { name: 'liquid', label: 'Liquid', at: [0, 0, 0.015], lathe: [...arc(0, 0.185, 0.185, -90, 0, 4), [0.185, 0.8]] },
    { name: 'glass', label: 'Test tube', tone: 'trim', look: 'ghost', open: true, lathe: [...arc(0, 0.2, 0.2, -90, 0, 5), [0.2, 1.93], [0.235, 1.97], [0.235, 2]] },
  ],
};

const BURNER: ModelData = {
  tone: 'mid',
  trim: 'b',
  nodes: [
    { name: 'base', label: 'Base', tone: 'hi', lathe: [[0, 0], [0.5, 0], [0.5, 0.07], [0.38, 0.13], [0.13, 0.16], [0, 0.16]] },
    {
      name: 'barrel',
      label: 'Barrel',
      at: [0, 0, 0.66],
      children: [
        { cylinder: [0.1, 1], segments: 14 },
        { cylinder: [0.13, 0.16], at: [0, 0, -0.24], tone: 'hi', segments: 14 },
        { tube: [[0.1, 0, -0.39], [0.5, 0, -0.39], 0.04], segments: 10 },
      ],
    },
    {
      name: 'flame',
      label: 'Flame',
      tone: 'trim',
      look: 'ghost',
      at: [0, 0, 1.16],
      children: [{ lathe: [[0.09, 0], [0.13, 0.2], [0.11, 0.45], [0.06, 0.7], [0, 0.84]] }, { lathe: [[0.06, 0], [0.07, 0.12], [0.04, 0.3], [0, 0.4]], look: 'solid' }],
    },
  ],
};

const PRISM: ModelData = {
  tone: 'b',
  nodes: [{ name: 'prism', label: 'Prism', look: 'ghost', mesh: extrudeData([[-0.75, 0], [0.75, 0], [0, 0.75 * Math.sqrt(3)]], 1, 'xz') }],
};

const LENS: ModelData = { tone: 'b', nodes: [{ name: 'lens', label: 'Lens', look: 'ghost', rotate: [0, 90, 0], segments: 24, lathe: lensProfile(0.36, 0.04) }] };

const CONCAVE_LENS: ModelData = { tone: 'b', nodes: [{ name: 'lens', label: 'Lens', look: 'ghost', rotate: [0, 90, 0], segments: 24, lathe: lensProfile(0.06, 0.36) }] };

const GEAR: ModelData = {
  tone: 'mid',
  trim: 'hi',
  nodes: [
    { name: 'gear', label: 'Gear', mesh: extrudeData(teeth(12, 0.8, 1), 0.24, 'xy') },
    { name: 'hub', label: 'Hub', tone: 'trim', cylinder: [0.22, 0.36] },
  ],
};

const PLANET: ModelData = {
  tone: 'b',
  trim: 'hi',
  nodes: [
    { name: 'planet', label: 'Planet', sphere: 1 },
    // The axis shows where it stands out of the planet; what would run inside it is never drawn, so nothing passes through the planet.
    {
      name: 'axis',
      label: 'Axis',
      tone: 'trim',
      hidden: true,
      segments: 8,
      children: [{ tube: [[0, 0, 1], [0, 0, 1.3], 0.02] }, { tube: [[0, 0, -1.3], [0, 0, -1], 0.02] }],
    },
  ],
};

const RINGED_PLANET: ModelData = {
  tone: 'lit',
  trim: 'lo',
  nodes: [
    { name: 'planet', label: 'Planet', sphere: 0.55 },
    { name: 'rings', label: 'Rings', tone: 'trim', segments: 32, lathe: [[0.64, -0.012], [1, -0.012], [1, 0.012], [0.64, 0.012], [0.64, -0.012]] },
  ],
};

export const MODELS: Readonly<Record<ModelName, ModelData>> = {
  rocket: ROCKET,
  satellite: SATELLITE,
  airplane: AIRPLANE,
  car: CAR,
  cart: CART,
  boat: BOAT,
  'wind-turbine': WIND_TURBINE,
  tree: TREE,
  pine: PINE,
  house: HOUSE,
  person: PERSON,
  table: TABLE,
  ramp: RAMP,
  pulley: PULLEY,
  mass: MASS,
  magnet: MAGNET,
  compass: COMPASS,
  battery: BATTERY,
  bulb: BULB,
  flask: FLASK,
  beaker: BEAKER,
  'test-tube': TEST_TUBE,
  burner: BURNER,
  prism: PRISM,
  lens: LENS,
  'concave-lens': CONCAVE_LENS,
  gear: GEAR,
  planet: PLANET,
  'ringed-planet': RINGED_PLANET,
};

export const MODEL_NAMES = Object.keys(MODELS) as ModelName[];
