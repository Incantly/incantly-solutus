# v0.1 scope: teach one concept end to end

Although this is the first product milestone, it is named v0.1 because it is a proof of the full learner experience, not the full SDK catalog.

## Outcome

A learner selects a supported concept and receives a safe figure that can be manipulated while playing or paused, teaches one clear idea, and restores its state when the note is reopened.

## Supported concepts

The initial evaluation set contains exactly three reviewed concepts:

1. Sine wave: formula, amplitude, frequency, phase, and animated trace.
2. Projectile motion: speed, angle, gravity, path, range, and peak.
3. Thin-lens ray diagram: object distance, focal length, image location, and ray construction.

These cover a graph, a time-based physical model, and an explanatory diagram without requiring a general physics or 3D engine.

## Included capabilities

- Bundled shell and theme.
- Sandboxed scene execution.
- A deliberately restricted JavaScript subset.
- `inc.param`, `inc.model`, `inc.onFrame`, `inc.readout`, and `inc.steps`.
- Play, pause, restart, and speed controls built by the engine.
- Dirty redraws, including parameter changes while paused.
- Minimal responsive SVG stage and primitive builders.
- Minimal 2D plotting needed by the sine-wave and projectile examples.
- Text alternative and keyboard-operable controls.
- Static validation, a hidden probe run, and one automatic repair attempt.
- One TipTap node that stores fragments, parameter values, SDK version, and the last successful snapshot.
- Three hand-authored gold-standard scenes and generation evals for the same three concepts.

## Explicitly deferred

- General 2D physics engine.
- General 3D graphing or scene system.
- Canvas particle and fluid layers.
- Formula editing by the learner.
- Undo, redo, presets, comparison ghosts, and prediction questions.
- Multiple linked panels.
- Export to SVG, GIF, or video.
- Example retrieval, shared concept caching, and a community gallery.
- Rich and multi-view figure sizes.
- A second repair attempt.

## Constraints

- One figure contains at most three adjustable parameters.
- One figure teaches one idea.
- Generated scene code stays within the restricted syntax and SDK allow-list.
- The figure must remain correct at every declared parameter minimum, default, and maximum.
- No implementation may add a scene-specific renderer or hard-coded demo path to the host application. Missing capability is added generically to the SDK first.

## Exit decision

After the vertical slice passes its acceptance tests, choose the next investment using observed failures and learner behavior. Do not automatically proceed to the full catalog.
