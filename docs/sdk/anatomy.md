# Anatomy kit: animals grown from their bones

Status: built, first version (`packages/core/src/kits/anatomy`). Section "Not yet built" lists what the design asks for that this version does not do.

`inc.anatomy` draws and moves animals from a skeleton. The work is split in two:

- **The kit owns everything under the skin.** From the bones the scene gives, it works out the posture, the muscles and a plain body, the way a palaeontologist reconstructs an animal from its fossil, and it moves them: the gait, planted feet, standing up, and every bone's frame on every frame.
- **The scene owns the look.** It draws the skin that makes the breed or species (the head, ears, tail, coat and markings) on those bones with `animal.skin(bone, shape)`, and the kit moves that skin with the bones. A German Shepherd and a Rottweiler are the same dog skeleton with different skin.

It is a domain kit (DG-6): its script loads only for scenes that call it.

```js
const zoo = inc.anatomy('#stage', { title: 'Cheetah at full speed', viewBox: [0, 0, 900, 400] });
const cheetah = zoo.skeleton({
  size: 1.3, // body length in metres
  skull: { length: 0.18 },
  spine: { length: 0.75, flex: 0.9 },
  forelimb: { upper: 0.22, lower: 0.26, foot: 0.12 },
  hindlimb: { upper: 0.27, lower: 0.31, foot: 0.17 },
  tail: { length: 0.65 },
});
cheetah.move({ speed: inc.param('speed', { min: 0, max: 30, value: 20, unit: 'm/s' }) });
// Small rounded ears, a short muzzle with black tear marks, and spots on the back.
cheetah.skin('ear', { at: [-0.05, 0.25], r: 0.2, as: 'part', replace: true });
cheetah.skin('skull', { points: [[0.55, 0.1], [0.6, -0.3], [0.75, -0.4]], as: 'line' });
cheetah.skin('spine', { at: [0.3, -0.1], r: 0.04, as: 'mark' });
```

## Why

Asked for a dog running, the agent used to make something that ran well and did not look like a dog. Motion is in the SDK (timelines, tweens, physics, joints); bodies were not. The shape helpers are mostly for physics and circuits (`spring`, `gear`, `lens`, `blob`, `polygon`), so the agent invented an outline, its proportions and its leg timing from circles and paths, in the 60 to 150 lines a scene is allowed. The lines ran out before the animal looked right, and the probe cannot tell a dog from a blob.

A larger token cap would buy more hand-drawn paths, still guessed, and break the 6-second scene budget (PRD 16.1). Detail has to move into the SDK, so the scene writes less and the figure shows more.

A table of species presets does not work either: there are too many animals, and what makes a mouse run differently from a cheetah is not a row of numbers but its build. So the kit holds no animals. It holds rules that read a build from bones.

## From bones to animal

```
skeleton (scene)  →  posture  →  muscles  →  plain body  →  skin (scene)  →  gait
```

The scene writes the first and the fifth; every other step is a rule in the kit, the same for every animal. Nothing is stored per species.

## The skeleton

`zoo.skeleton(spec)` takes the bones, and only the bones: the kit holds no animals and refuses a name such as `'dog'`. The agent measures each bone from what it knows of the real animal's skeleton, so a mouse, a dog and a cheetah differ because their bones do. Lengths are fractions of `size`, the body length in metres from the nose to the root of the tail; `size` keeps the real scale, which the gait rules need.

| Field | Content |
| --- | --- |
| `size` | Body length in metres. Default 1. |
| `skull` | `length`; optionally `depth` (its height as a share of its length) and `snout` (the share of the skull ahead of the eye). |
| `neck` | `length`. |
| `spine` | `length`, and `flex`, from 0 (stiff, as a horse) to 1 (a cheetah): how far the back bends when running. |
| `forelimb`, `hindlimb` | `upper`, `lower`, `foot`; optionally `posture` to override the posture the kit reads (below). Leave out `forelimb` for an animal with none. |
| `tail` | `length` (0 for none) and `stiffness`, from 0 to 1. |
| `stance` | `upright` (limbs under the body) or `sprawl` (out to the side, as a lizard's). |
| `modes` | Ways of moving it supports, `quadruped` and `bipedal`; the first is how it starts. Default from the build. |
| `wings` | The forelimbs are folded wings, as a bird's. |
| `at`, `width`, `facing` | Where it stands on the stage, the room it may take across, and which way it faces. It is scaled to fit. |
| `tone`, `ground`, `show` | Body tone; whether a ground line passes under it; skin, muscles or bones. |

The kit refuses a skeleton it cannot read, with what is wrong: "a skeleton needs a hindlimb", "spine.flex is a number from 0 to 1", "give the bones, not a name".

## Posture: read from the limb bones

How a foot meets the ground is read from the foot's share of the whole limb, as palaeontologists read it from fossil feet:

| Posture | Foot's share of the limb | Example |
| --- | --- | --- |
| Plantigrade | under 0.2: the whole sole down | Bear, human |
| Digitigrade | 0.2 to 0.3: on the toes, heel raised | Dog, cat, cheetah |
| Unguligrade | over 0.3: on the tip of the hoof | Horse, deer |

A limb's `posture` overrides it, as a mouse's long but flat-set hind foot needs. Body size sets the crouch: a standing leg is extended 0.95 + 0.12 log₁₀(size) of its reach, so a mouse stands at about 82% and a horse at 97%.

## Muscles: read from the bones

Each muscle group is sized from the bone it sits on:

| Bone | Muscle | Rule |
| --- | --- | --- |
| Upper hindlimb | Thigh and haunch | 0.3 × thigh bone, capped at 0.08 × body length, heavier where the hindlimbs are longer than the forelimbs (they drive) |
| Lower limbs | Calf, forearm | Thinner for runners (long shin for the thigh); thicker forearms for short-forearmed diggers and climbers |
| Upper forelimb | Shoulder | 0.3 × upper arm, capped at 0.07 × body length |
| Spine | Chest and haunch depth | From the spine's length and the shoulder and thigh muscle |
| Waist | Between chest and haunch | Tucks up in runners |
| Skull, neck | Jaw, neck | From the skull's depth and the neck's length |

Each muscle is an ellipse or a tapering capsule in its bone's own frame, so it moves with the bone. A long, slender bone, such as a human thigh, does not carry a horse's muscle: that is why the caps are there.

## The plain body

From the muscles the kit draws a plain body: a deep chest and rounded haunch with a waist between, a neck, a round cranium with a snout, a small ear, an eye, a nose and a mouth line, legs with paws (or hooves on unguligrade feet), and a tail. Every shape belongs to a bone, so a scene can replace it.

Outlines are strokes drawn behind the fills: where shapes overlap, the fills cover the strokes between them, so the body has one clean outline whatever is joined to it. The drawing is in layers, back to front: the far legs (lighter), the body with its neck, head and tail, the near hind leg, the near foreleg, the ears and the face. A dark body (tone `hi`) is outlined in `mid`, so its near legs still stand out from it.

## Skin the scene draws

`animal.skin(bone, shape)` draws a piece of skin on a bone. The kit moves it with that bone on every frame.

**Bones.** `spine`, `neck`, `skull`, `ear`, `tail`, `wing`; on the legs `thigh`, `shin`, `hindfoot` and `upperArm`, `forearm`, `forefoot`, or a whole leg as one chain, `hindleg` and `foreleg`. A chain bends at the knee and ankle, so skin drawn down a whole leg bends with it. `ear` sits at the back of the skull and points the way the skull does. Skin on a leg is drawn on the near and the far side.

**Coordinates.** Every point is `[along, across]`, in lengths of that bone (or chain). `along` runs from 0 at the bone's start (the hip end of the spine, the back of the skull, the top of a leg, the root of the tail) to 1 at its end. `across` is up for the spine, neck, skull, ear, wing and tail, and forward for the legs. Where a frame bends (the spine at a gallop, a leg at the knee, a curling tail), `across` turns with it, blending at each joint, so the skin bends rather than cracks.

**Shapes.** `points` (3 to 48, a smooth closed curve by default, or straight with `smooth: false`), or an ellipse `at` a point with radius `r` or `[along, across]` radii. A point more than 3 bone lengths from its bone is refused: it would float off.

**Kinds** (`as`):

| Kind | What it is | Example |
| --- | --- | --- |
| `flesh` (default) | Joins the body: its tone, one outline round both | A longer muzzle, a broad skull, a bushy tail, a hump |
| `part` | Sits over the body with its own outline | Ears, a collar, horns, a mane |
| `mark` | Paints the skin, with no outline. On legs and tails it is held inside the skin's width | A saddle, spots, stripes, tan points, an eye |
| `line` | An open stroke | Whiskers, a mouth, fur |

`tone` defaults to the body's tone for flesh and parts, and `hi` for marks and lines. `replace: true` removes the kit's own skin on that bone first; replacing the `skull` takes its eye, nose and mouth too, so the scene draws its own face, and replacing a chain (`hindleg`) replaces each bone in it. An animal carries at most 40 pieces of skin.

```js
// A German Shepherd: tall pointed ears, a long black muzzle, a black saddle and a bushy tail.
const dog = zoo.skeleton({ ...dogBones, tone: 'lit' });
dog.skin('ear', { points: [[-0.2, -0.05], [-0.08, 0.6], [0.1, -0.02]], as: 'part', replace: true });
dog.skin('skull', { points: [[0.55, 0.08], [1.18, -0.04], [1.12, -0.24], [0.55, -0.3]] });
dog.skin('skull', { points: [[0.7, 0.06], [1.18, -0.04], [1.12, -0.24], [0.7, -0.28]], as: 'mark' });
dog.skin('spine', { points: [[0.02, 0.07], [0.85, 0.07], [0.72, -0.2], [0.12, -0.24]], as: 'mark' });
dog.skin('tail', { points: [[0.05, 0.06], [0.55, 0.12], [1.05, 0], [0.55, -0.13], [0.05, -0.07]] });
```

## Movement: read from the build

`animal.move({ speed, mode, at })`. The scene says how fast, in metres a second: a number, a parameter or a function of the model. The kit works out how, so a mouse and a cheetah differ without a "mouse gait" or a "cheetah gait" written anywhere. The rules (`GAIT_RULES` in `kits/anatomy/gait.ts`) are starting values from studies of animal gaits, to be tuned on the bench.

- **Gait from the Froude number**, v² / (g × hip height), under which animals of every size change gait at similar values: walk below 0.5, then trot, then gallop from 2.5. Two legs walk, then run.
- **Which fast gait.** A body shorter than 0.3 m bounds from a Froude number of 1, hind feet together. A flexible spine (`flex` 0.6 or more) gallops round the body (rotary, as a cheetah or dog); a stiffer one gallops in the same order front and back (transverse, as a horse). At a gallop or bound the back bends and stretches with the stride.
- **Stride length** is 2.3 × hip height × Froude^0.3 (dynamic similarity), and the stride rate is speed over stride, so a mouse's legs blur where a horse's stride is slow and long.
- **Time on the ground** shortens as speed rises.
- **Feet stay planted.** A planted foot sweeps back exactly as fast as the ground passes. A foot may sweep at most 1.1 × its leg's reach, so at speeds where it could not, the foot lifts sooner; past what the shortest stance (12% of the stride) can cover, strides grow no longer, only quicker. The legs reach their feet with two-bone inverse kinematics: knees forward, elbows back.
- **Modes.** `ape.move({ mode: 'bipedal', at: 4 })` stands it up at 4 s over 1.2 s, and `mode` may be a function of the model, such as a posture choice; the change runs whether the figure plays or is paused (PRD 21.1): the body pitches until it balances over the hips (a heavy tail holds it level, no tail stands it up), and the forelimbs hang and swing as arms. A mode the skeleton cannot support is refused: "this skeleton's hindlimbs are too short to walk on two legs".

The stride advances in fixed steps of 1/60 s while the figure plays, so a run draws the same frames every time, and holds still when paused or under reduced motion.

## Parts, readouts and teaching

`animal.piece(name)` returns a piece to name as a part with `zoo.part`, or to highlight: `body`, `head`, `neck`, `tail`, `forelimbs`, `hindlimbs`, `muscles`, `bones`. `zoo.part('Dog', dog)` names the whole animal. `animal.show('muscles')` or `'bones'` fades the skin to show the layer under it, so the reconstruction itself can be taught.

Readouts come from the same model that moves the animal (PRD 17.2): `gait` (stand, walk, trot, gallop, bound, run), `mode`, `speed`, `stride` (metres), `frequency` (strides a second), `duty` (share of the stride a foot is down), `airborne` (share with no foot down), `froude`, `hipHeight`, `posture`.

## Generation

- The catalog lists the `anatomy` capability, so the plan names it and the scene prompt loads its types only for those scenes (PRD 17.9).
- A scene with the kit is about 10 to 30 lines: a skeleton, a `move`, the skin that makes the animal, parts and steps. The plain body means the scene only draws what makes its animal different, which keeps the scene call short (PRD 16.1).
- The reviewed scenes `animal-gaits` (a dog walking, trotting and galloping, with its muscles and bones), `ape-upright` (an ape on its knuckles and on two legs) and `dog-breeds` (a German Shepherd and a Rottweiler on one skeleton, told apart only by skin) are retrieved as examples by concept (PRD 25.5). Each names only its own animal, so a mouse or a cheetah prompt goes to the model.

## Checks

The validator loads the kit only for scenes that call `inc.anatomy`, and refuses `skeleton` inside the frame loop. The unit tests (`packages/core/test/kits-anatomy.test.ts`) check ten skeletons measured from real animals (dog, cat, horse, mouse, cheetah, bear, ape, human, bird, lizard; test data, not part of the SDK), posture reading, gait changes by Froude number, rotary and transverse gallops, dynamic similarity of strides, that a planted foot keeps its place on the ground, that feet never have to sweep past their reach, determinism, reduced motion, modes, layers and parts, and skin: parts, marks, lines and replaced defaults move with their bones, limb skin is drawn on both sides, skin bends round a joint, and skin that would float off is refused.

## Limits

Animals with a backbone. A stage draws at most 6 animals. Speeds up to 40 m/s. About 30 drawn elements an animal before its skin, and at most 40 pieces of skin, each part 2 elements (4 on a leg) and each mark or line 1 (2 on a leg).

## Not yet built

- Probe checks in the generation probe for joint limits, two-legged balance and a closed gait cycle; the unit tests cover the gait maths, the probe does not yet check generated scenes for them.
- Marks are held inside the skin only on legs and tails; on the spine, neck and skull the scene keeps them inside.
- A two-legged hop.
- Animals without a backbone like ours: insects and crabs (skeleton outside), octopus, jellyfish and worms (no hard skeleton).
- Two-legged bodies are rougher than four-legged ones: a human or bird skeleton reads as a figure, not a portrait.

## Open questions

- Whether the gait thresholds from the literature hold for drawn animals, or need tuning per build.
- Whether learners should be able to edit bone lengths with sliders, and watch the animal and its gait change.
