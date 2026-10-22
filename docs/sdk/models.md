# 3D models

`space.model(name, options)` places a ready-made model in an `inc.space3d` figure: a rocket, a beaker, a car, a pulley. It is the asset library of PRD S3-9: a scene asks for a model in one call instead of building it from solids, which saves the tokens a generated scene spends and draws a model that has been checked by eye. The figure's own controls are the viewer: the learner turns and zooms it, and the scene can name, label, colour and explode its pieces.

```js
const space = inc.space3d('#stage', { title: 'Parts of a rocket' });
const apart = inc.param('apart', { min: 0, max: 1, step: 0.05, value: 0, label: 'Take it apart' });
const rocket = space.model('rocket', { parts: true, labels: true });
inc.onFrame(() => rocket.explode(apart.value));
```

## The library

Each model is 2 units at its largest side, so models sit together at a sensible scale; `size` sets that side in world units. Most stand on z = 0 and are centred on their position; the ones marked centred are centred on it in all three directions. Vehicles face +x. Pieces marked * start hidden.

| Model | Pieces | Notes |
| --- | --- | --- |
| `rocket` | nose, body, window, fins, engine, flame* | the flame hangs below the engine |
| `satellite` | body, panels, dish | centred |
| `airplane` | fuselage, wings, tail, engines | centred |
| `car` | body, cabin, wheels | |
| `cart` | body, wheels | a dynamics trolley |
| `boat` | hull, cabin | |
| `wind-turbine` | tower, nacelle, rotor | turn the rotor about x |
| `tree`, `pine` | trunk, leaves | |
| `house` | walls, roof, door, windows, chimney | the door faces +x |
| `person` | head, body, legs | a scale figure |
| `table` | top, legs | the top is 1 unit high |
| `ramp` | ramp | a 30° slope down toward +x, from z = 1.15 at x = −1 to 0 at x = 1 |
| `pulley` | wheel, axle, mount | centred on its axle; the rope runs in the groove at radius 0.6 |
| `mass` | weight, hook | |
| `magnet` | north, south | the north pole is +x |
| `compass` | case, needle | turn the needle about z; north is +x |
| `battery` | body, cap, terminal | the positive end is up |
| `bulb` | glass, filament, base | `tone: 'lit'` lights the glass |
| `flask`, `beaker`, `test-tube` | glass, liquid | the tone is the liquid's |
| `burner` | base, barrel, flame | the flame is blue; `piece('flame').tone('lit')` is a luminous one |
| `prism` | prism | an equilateral triangle in the xz plane |
| `lens`, `concave-lens` | lens | centred; the optical axis is x |
| `gear` | gear, hub | centred; turn it about z |
| `planet` | planet, axis* | centred |
| `ringed-planet` | planet, rings | centred |

## Placing and colouring

The options are those of any solid: `at`, `rotate` and `scale` place the whole model, `look: 'wire'`, `'ghost'` or `'shadow'` changes every piece, and `segments` sets the facets of every round piece. A model has two colours: `tone` sets its main colour and `trim` its second (a rocket's nose and fins, a car's wheels); a piece in a fixed colour, such as a window or a flame, keeps it. `model.tone(name)` recolours the main pieces later.

## Pieces

`model.piece(name)` is one piece, an object like any other: it moves with `at`, turns with `rotate` and `orient`, scales, recolours, hides and shows, and can be a part or a drag. A piece turns about its own origin, the point it turns about in use: a wheel about its axle, a compass needle about its pivot, a turbine's rotor about its hub. The turn its data gives it stays underneath, so `piece('wheel').rotate(0, angle, 0)` spins a pulley's wheel in place. Moving a piece carries what it holds: the rocket's window rides on its body. `model.pieces` lists the names, and an unknown name is refused with the list.

`parts: true` names every shown piece as a part, with its label (a rocket's `body` is "Fuel tank"), for the legend, highlights, steps and the description; `parts: ['nose', 'fins']` names only those. The plan's part names are then the piece names. `labels: true` (or a list) labels the pieces in the drawing: the labels stand in columns beside the model, top to bottom in the order of the pieces, each joined to its piece by a leader that ends in a dot, and they follow the pieces as the learner turns the model or the scene explodes it. The view leaves room for the columns.

`model.explode(amount)` spreads the pieces away from the model's centre, 0 together and 1 twice as far apart, for an exploded view.

## Shadows

`look: 'shadow'` draws any solid as a dark see-through layer, the same in either theme and whatever its tone: a shadow on the ground under a model, or the night half of a planet. The seasons reference scene lays an open hemisphere just inside Earth's outline, turned away from the Sun, so the terminator moves as Earth goes round its orbit:

```js
const dome = [];
for (let i = 0; i <= 8; i++) dome.push([0.59 * Math.cos((i * Math.PI) / 16), 0.59 * Math.sin((i * Math.PI) / 16)]);
const night = space.lathe(dome, { look: 'shadow', open: true });
// Each frame: at Earth, its axis turned from z onto the direction away from the Sun.
night.at(x, y, 0);
night.orient(inc.vec.rotA([-uy, ux, 0], Math.PI / 2));
```

## Models of your own

`space.model(data)` places a model described as data in the same form, glTF-style: a list of nodes, each holding at most one solid with the arguments of the call of the same name (`box`, `sphere`, `cylinder: [r, h]`, `cone: [r, h]`, `torus: [R, r]`, `plane: [w, d]`, `tube: [from, to, r]`, `lathe: [[r, z], ...]`, `mesh`), placed with `at`, `rotate` and `scale` within its parent, with `children` placed within it. A `name` makes a node a piece and `label` names it for people; `tone` is a tone or `'main'` and `'trim'` for the model's two colours, and children take their parent's tone, look and bias unless they say otherwise. `bias` moves something flat on a face, such as a door, ahead in the drawing order. Data keeps its own size unless `size` is given.

```js
const lamp = space.model({
  tone: 'c',
  nodes: [
    { name: 'base', box: [1, 1, 0.2], at: [0, 0, 0.1] },
    { name: 'post', cylinder: [0.05, 1], at: [0, 0, 0.7], tone: 'trim', children: [{ name: 'bulb', sphere: 0.15, at: [0, 0, 0.6], tone: 'lit' }] },
  ],
});
```

## Lathes

`space.lathe(profile, options)` turns a profile of `[r, z]` points about the z axis into a solid of revolution, the shape behind a vase, a flask or the volume of revolution under a curve. The profile can run either way; an end off the axis gets a flat cap, unless `open: true` leaves it open (and the inside is drawn), as for a glass; and a profile that ends where it starts makes a ring that never meets the axis, such as a washer.

```js
// The solid formed by turning y = √x about the x axis, from 0 to 4, lying along x.
const profile = [];
for (let i = 0; i <= 16; i++) profile.push([Math.sqrt(i / 4), i / 4]);
space.lathe(profile, { rotate: [0, 90, 0], tone: 'b', look: 'ghost' });
```

## Drawing order

The engine draws what is nearest last. It sorts the pieces it draws by their middles, then mends that order wherever two pieces overlap on the stage: each pair is compared where it overlaps, by the depth of its own geometry there (the plane of a face, the front of a sphere, the point along a line), and the nearer goes on top. Faces of one convex solid are ordered without looking; a face that passes through another, such as a chimney through a roof, is cut into tiles so the parts on either side sort on their own; and a line breaks where it crosses a sphere's outline, so a ring round a planet goes behind it and comes out in front. Pieces that pass through each other can still show a sliver drawn the wrong way where they meet, so models and scenes are built so that pieces meet rather than pass through: the car's wheels stand clear of its body, and the planet's axis stands out of it rather than through it.

Every ready-made model and every reviewed 3D scene is audited offline at 60 turns, all the way round from below, level and above: wherever two pieces overlap, the nearer must be drawn on top ([the offline checks](../architecture/generation-pipeline.md#offline-checks)).

## Cost

A ready-made model has at most 300 faces, about 50 to 250 drawn elements once the faces turned away are left out and large faces are cut so they sort with their neighbours, and up to a quarter more where faces that pass through each other are cut into tiles. A quick figure's budget of 400 elements holds one or two models beside a grid and a few arrows; a standard figure holds more. Mending the order costs about 0.5 to 3.5 ms a draw for a model on a laptop, more for a scene with many lines round spheres. The library adds about 8 KB to the space3d kit, which only loads for scenes that call it.
