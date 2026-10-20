# Core SDK contract

This file defines public behavior. Signatures may evolve during implementation, but acceptance tests must preserve the behavior described here.

## Parameters

```js
const amplitude = inc.param('amplitude', {
  min: 0.5,
  max: 4,
  step: 0.1,
  value: 2,
  unit: ''
});
```

The engine builds the labeled slider and number field. A parameter handle exposes its current value through a documented read API. Setting a parameter validates and clamps the value, marks the figure dirty, updates controls, and schedules persistence.

Every adjustable quantity is a parameter. Generated scenes do not create inputs or listeners.

## One model

```js
const model = inc.model(() => {
  const speed = launchSpeed.value;
  const radians = launchAngle.value * Math.PI / 180;
  return {
    horizontalSpeed: speed * Math.cos(radians),
    verticalSpeed: speed * Math.sin(radians)
  };
});
```

Geometry, readouts, descriptions, and explanations read the same model. Derived values are recalculated when their dependencies change and are not separately persisted.

## Frames and dirty rendering

```js
inc.onFrame(({ time, dt }) => {
  marker.at(model.x(time), model.y(time));
});
```

- The engine owns the only animation loop.
- While playing, time advances using a capped time step.
- While paused and dirty, the callback runs once with `dt = 0`.
- While paused and clean, no drawing work occurs.
- Scene code advances state only by amounts derived from `dt`.
- Off-screen and background figures pause.
- Reduced motion starts in a meaningful still state.

## Transport controls

Play/pause, restart, and speed are engine-owned. Restart restores time and scene transient state but does not silently discard persisted learner parameter values. A separate reset action restores authored defaults.

## Readouts

```js
inc.readout({
  Range: () => model.range.toFixed(1) + ' m',
  Peak: () => model.peak.toFixed(1) + ' m'
});
```

Readouts update only when their displayed text changes. Literal computed results must not be copied into strings; values derive from the model.

## Lifecycle

The engine supports mount, frame, reset, parameter-change, visibility-change, and destroy phases. All observers, engine listeners, and scheduled work are cancelled on destroy. Scene code does not attach listeners or timers.

## Determinism

Given the same scene source, SDK version, parameter values, seed, dimensions, and elapsed time, the scene produces the same model results. Random behavior uses the SDK seed source.
