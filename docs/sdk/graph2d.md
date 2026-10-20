# Graph 2D SDK contract

v0.1 implements only the graph behavior required by the sine-wave and projectile scenes. It is not intended to match a full graphing calculator.

## Creation

```js
const graph = inc.graph2d('#stage', {
  x: [-7, 7],
  y: [-5, 5],
  axes: true,
  grid: true,
  labels: { x: 'x', y: 'y' }
});
```

## Included

- Responsive Cartesian axes, ticks, grid, and labels.
- Plot `y = f(x)` from an SDK formula or a restricted pure callback.
- Plot a parametric path from `x(t)` and `y(t)`.
- Points, line segments, arrows, and a moving marker.
- A revealed path or trail controlled by scene time.
- Automatic clipping and safe handling of non-finite samples.
- Reset view and automatic fit to the authored domain.

## Deferred

- Learner zoom and pan.
- Polar, implicit, inequality, and vector-field plots.
- Trace, automatic roots and intersections, legends, and draggable handles.
- Bars, histograms, regions, logarithmic scales, and multi-axis charts.

## Formula source

When a plotted curve is defined by a mathematical expression, the authored expression is stored and displayed as the source of the curve. A renderer may compile or sample it efficiently, but it must not replace it with a fake named function.

## Correctness

The graph must break paths at discontinuities, reject non-finite ranges, cap sample counts, keep labels within the stage, and redraw immediately when a bound parameter changes while paused.
