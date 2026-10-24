# Graph 2D SDK contract

The 2D graph draws curves, data and annotations in data units over Cartesian axes, a number line or log scales, and lets the learner zoom, pan, trace and drag.

## Creation

```js
const graph = inc.graph2d('#stage', {
  x: [-7, 7],
  y: [-5, 5],
  title: 'A sine wave',
  labels: { x: 'time (s)', y: 'height (m)' },
  scale: { y: 'log' }, // optional: log x or y axes with decade ticks
});
```

## Curves

- `plot(f)`: y = f(x), from a formula or a function of x (and time).
- `plotX(f)`: x = f(y), from a function of y or a formula made with `{ input: 'y' }`.
- `polar(f, { from, to })`: r = f(theta), from a function of theta or a formula made with `{ input: 'theta' }`.
- `parametric(fx, fy, t0, t1)`: the point (x(t), y(t)), from two functions or two formulas made with `{ input: 't' }`; in those, t is the curve's parameter, not scene time.
- `implicit(F)`: the curve F(x, y) = 0; with `fill: true` the region where F < 0 is shaded.
- `area`, `between`, `field`, `slopes`, `scatter`, `bars`, `histogram`.

A formula's source is written over the plot, as `y = ...`, `x = ...`, `r = ...` or `(x, y) = (...)`, and an edited formula shows its new text.

```js
const a = inc.param('a', { min: 0.5, max: 2, value: 1 });
graph.polar(inc.formula('a*(1 + cos(theta))', { input: 'theta' }));
graph.parametric(inc.formula('2*cos(t)', { input: 't' }), inc.formula('sin(t)', { input: 't' }), 0, 2 * Math.PI);
```

## Marks and interaction

- Points, segments (cut to the plot area, as curves are), arrows, trails, labels, equations, brackets and dimension lines, all in data units.
- `marks` for roots and turning points, `crossings` where two curves meet, `trace` to follow a curve.
- `handle` and `drag` let the learner move what a parameter sets; `part` names an item for steps, highlights and the description.
- `reveal(fraction)` draws a curve over time; zoom and pan are the learner's, with reset.

## Formula source

When a plotted curve is defined by a mathematical expression, the authored expression is stored and displayed as the source of the curve. A renderer may compile or sample it efficiently, but it must not replace it with a fake named function.

## Correctness

The graph must break paths at discontinuities, reject non-finite ranges, cap sample counts, keep labels within the stage, and redraw immediately when a bound parameter changes while paused.
