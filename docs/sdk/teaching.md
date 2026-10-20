# Teaching SDK contract

Incantly figures teach one idea rather than merely animate. v0.1 uses steps, model-bound explanation, and a text alternative.

## Idea sentence

Every scene declares one concise idea that appears with the figure. Examples:

- “Amplitude changes the wave's height; frequency changes how often it repeats.”
- “Horizontal speed stays constant while gravity changes vertical speed.”

## Steps

```js
inc.steps([
  {
    say: 'The horizontal part of velocity stays constant.',
    focus: 'Horizontal velocity arrow'
  },
  {
    say: 'Gravity changes only the vertical part.',
    focus: 'Vertical velocity arrow',
    set: { gravity: 14 }
  }
]);
```

The engine owns navigation, progress, keyboard behavior, parameter transitions, pausing, and restoration. Leaving step mode restores the learner's prior values.

A figure uses the number of steps needed to teach its idea—normally two to four. Three steps are not mandatory when two are clearer.

## Explanation

```js
inc.explain(() =>
  'The projectile reaches ' + model.peak.toFixed(1) +
  ' m because its upward velocity falls to zero at the top.'
);
```

Explanations derive from the model and remain correct when parameters change. They live in HTML outside the drawing.

## Text alternative

```js
inc.describe(() =>
  'A projectile launched at ' + angle.value +
  ' degrees follows a curved path and lands ' + model.range.toFixed(1) + ' metres away.'
);
```

The description is visible under a toggle, available to assistive technology, persisted with the approved scene, and suitable for printing.

## Pedagogical bounds

Each parameter provides physically or mathematically meaningful bounds and a short plan-time justification. The probe exercises all extremes. A scene whose valid slider range creates division by zero, impossible geometry, negative mass, or an undefined model does not pass.

## Deferred teaching helpers

Prediction questions, before/after comparison, scoring, adaptive sequencing, and rich step branching are deferred until the core behavior is validated with learners.
