# Touching the figure

Learners can work a figure with the mouse, a finger or the keyboard: drag the object itself, follow a curve with the pointer, zoom and pan a drawing, and turn a 3D view. The SDK owns every listener; a scene only says which element drags and how the pointer maps to its parameters. Nothing here is scene-specific code, so a generated scene gets the same interaction as a reviewed one.

## The rule: a drag sets parameters

A drag never moves a shape directly. It turns the pointer into parameter values, the one model recomputes, and the figure redraws from the model like it does for a slider. So a dragged element can never disagree with its slider, readouts or formula, and every drag is checked like any other change: values are clamped to the parameter's bounds and snapped to its step, one drag is one undo step, and a value the learner left is restored when the note opens again.

```js
const angle = inc.param('angle', { min: -60, max: 60, step: 1, value: 20, unit: 'degrees' });
const bob = stage.circle(260, 220, 14, { tone: 'lit' });
stage.part('bob', bob, { label: 'The bob' });
// Where the pointer is, in stage units, becomes the angle.
stage.drag(bob, (p) => ({ angle: (Math.atan2(p.x - 260, p.y - 40) * 180) / Math.PI }), { label: 'the bob' });
inc.onFrame(() => {
  const r = (angle.value * Math.PI) / 180;
  bob.set({ cx: 260 + 180 * Math.sin(r), cy: 40 + 180 * Math.cos(r) });
});
```

The map gets `{ x, y, startX, startY, dx, dy }`: where the pointer is, where the drag started, and how far it has moved. It returns the parameters to set, or nothing to leave them.

## What can be dragged

| Where | Call | The map gets |
| --- | --- | --- |
| Any SVG stage | `stage.drag(element, map, { label })` | Stage units |
| A graph | `graph.drag(item, map, { label })` for a point, segment, arrow, curve or element | Data units |
| A graph, bound to parameters | `graph.handle({ x: 'h', y: 'k', label })`: a point that sets `h` and `k` and follows them | (no map needed) |
| A graph curve | `graph.trace(curve)`: a point that follows the pointer along the curve and shows its coordinates; drag it along | (no map needed) |
| A 3D scene | `space.drag(object, map)`, with `space.pick(x, y, z)` to turn the stage point into the world point at height `z` | Stage units |
| A physics world | `draggable: true` on a body: moved directly while paused, pulled toward the pointer by a grip while the world runs | (the body itself) |

A later drag on the same element replaces the earlier one, so a `graph.handle` can be given a map of its own, for example to keep an amplitude positive. A figure has at most 24 draggable elements.

The reviewed scenes show the pattern for each kind: the launch arrow of the projectile (`graph.drag`), the object of the thin lens, the pendulum bob and the spring block (`stage.drag`), the floating block of the buoyancy tank (a draggable body), the piston and thermometer of the gas, the resistor knob of the circuit, the point on the titration curve and the two points of the derivative's secant.

## Pointer, touch and keyboard

| Gesture | What happens |
| --- | --- |
| Press and move on a draggable element | The drag starts at once, with mouse, pen or touch; the element is captured, so the drag continues outside it |
| A tap on the background (under 6 px of movement) | Activates a zoomable stage, so the wheel and two fingers zoom it |
| Pointer over a graph with a trace | The trace point follows the pointer along its curve |
| Wheel | Scrolls the page until the learner has clicked or tapped the stage; then it zooms about the pointer. A trackpad pinch always zooms |
| Drag on the background | Pans a zoomed drawing; turns the camera of a 3D view (orbit mode) |
| Two fingers | Pinch to zoom and pan, once the stage is active; before that, the page scrolls |
| Double-click | Resets the view |
| Escape, or a press outside the stage | Hands scrolling back to the page |
| Tab | Moves to each draggable element and named part in turn |
| Arrow keys on a draggable element | Nudge it by 2.5% of the visible stage, or 10% with Shift; each nudge is a short drag, so the same map applies |

Pointer moves are sent to the scene at most once per kind per animation frame, and the scene redraws on the next frame. Draggable elements show a grab cursor and take touch gestures for themselves (`touch-action: none`); the rest of the drawing lets the page scroll until the learner activates it.

## What learners are told

The card's hint names what can be dragged: "Drag the bob or change the values below." Each draggable element is focusable, has the role of a graphics symbol described as draggable, and is named for screen readers with its label and how to move it ("The bob. Drag, or use the arrow keys, to change it"). Its parameter's slider stays the precise, fully accessible way to set the same value.

## For the scene writer

The generation rules ask for it: when moving the main object would change a parameter, make it draggable. A drag map should return only the plan's parameters; a name that is not a parameter is reported as a drag error and the figure keeps running. Keep the map simple and total: clamp or `Math.abs` where a value has a sign the model does not allow, and let the SDK clamp to the bounds.

## Zoom, pan and 3D views

Stages, graphs and 3D views zoom unless their options say `zoom: false`. A graph re-ticks its axes as the learner zooms; a plain stage zooms its view box, up to eight times. The zoom buttons (`zoombar` slot, hidden with `show: { zoom: false }`) do the same from the keyboard. 3D views orbit by default (`mode: 'orbit'`); `'iso'` keeps a fixed isometric camera and `'fixed'` keeps the camera the scene sets.

### Camera moves

A scene turns the camera with `space.view(name, move)` or `space.camera(options, move)`, on `inc.space3d` and `inc.graph3d` alike. Without a move the camera cuts; with one it eases there over `move.seconds` (up to 10) with `move.ease` (default `'inOut'`), turning the short way round:

```js
// A helix along x: side-on it is a sine wave, end-on the unit circle.
inc.onFrame(() => space.view(view.value === 1 ? 'side' : 'front', { seconds: 1.2, flat: true }));
```

- **Clock time.** A move runs in wall-clock time, playing or paused and whatever the learner's speed setting: it is the camera, not the scene. The runtime asks for frames only while a camera moves, so a still figure costs nothing again once it lands.
- **Asked every frame.** A script may ask for the same view on every frame, as above: a move to where the camera is already going keeps going instead of starting over.
- **Perspective.** `flat: true` fades perspective out on the way, so a side view of a helix is an exact sine and an end-on view an exact circle; `flat: false` fades the figure's own perspective back in.
- **The learner.** The toolbar's views and reset ease over 0.6 s. Dragging, zooming, panning or picking a view stops a move where it is, and the learner holds the camera: a scene asking again for what it last asked for, as one that asks every frame does, leaves the learner's view alone. A different ask takes the camera back, such as the learner moving the control the camera follows, and so do Reset and a step that names a view.
- **Reduced motion.** Every move, the toolbar's included, cuts.
- **Steps.** A step with `view` (and optionally `flat`) turns every 3D stage to that view over 1.2 s; going back turns to the view of the step before, and leaving the steps returns to the figure's own view.
- **Checks.** The probe lets a paused figure come to rest before and after moving each control, so a control that eases the camera passes the paused-change check and one the camera ignores still fails it. A turn costs about 1.2 ms a frame for a scene of 36 solids and a 400-point line on a laptop.

### Ranges that follow a parameter

In `inc.graph3d`, either end of a range may be a function, read on every draw: the box's `x`, `y` and `z`, a parametric surface's `u` and `v`, and a curve's `t`. A curve whose `t` range follows a parameter grows the box to hold it, and the box goes back to its own range when the curve shrinks again. Ticks follow the box, and points, lines, vectors and labels given in data units are placed again where they belong.

```js
const turns = inc.param('turns', { min: 1, max: 6, step: 0.5, value: 2, label: 'Turns' });
const g = inc.graph3d('#space', { title: 'A helix', x: [-1.5, 1.5], y: [-1.5, 1.5], z: [0, 13] });
// Four turns run past 13: the θ axis grows to hold them.
g.curve((t) => [Math.cos(t), Math.sin(t), t], { t: [0, () => turns.value * 2 * Math.PI] });
```

## Measuring

The stage toolbar has a measuring tool (VI-5, the ↔ button) wherever a stage says what its units are. With it pressed, taps place points instead of dragging or panning: two points read a distance, a third the angle at the second point between the other two, and a fourth starts again. The reading shows in a chip on the stage, read out as it changes; Escape or the button puts the tool away. The marks belong to the learner's session and are left out of snapshots and exported pictures.

Distances and angles come out in the stage's own units:

| Stage | Units |
| --- | --- |
| `inc.graph2d` | the axes' units, while both axes are linear; zooming and panning start the points again, since the data under them moved |
| `inc.physics2d` | metres |
| `inc.chemistry` | ångströms, so bond lengths and bond angles can be checked |
| `inc.svg` with `measure: { unit: 'm', per: 110 }` | the given unit, `per` stage units to one |

A plain stage, a 3D stage, a log axis or a number line offers no tool. A kit gives its stage a measure with `ctx.setMeasure` as its view changes: real coordinates are `origin + scale * x` on each axis.
