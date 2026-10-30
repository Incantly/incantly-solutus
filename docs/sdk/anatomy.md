# Anatomy kit: animals grown from their bones

Status: design note, not built. Nothing here is in the SDK yet, and no prompt, example or catalog entry may call `inc.anatomy` until it is implemented and registered.

`inc.anatomy` draws and moves animals from a skeleton. The scene gives the bones; the kit works out the muscles, the outline, the eyes, ears and feet, the posture and the gait, the way a palaeontologist reconstructs an animal from its fossil. It is a domain kit (DG-6): its script loads only for scenes that call it.

```js
const zoo = inc.anatomy('#stage', { title: 'Cheetah at full speed', viewBox: [0, 0, 900, 400] });
const cheetah = zoo.skeleton({
  size: 1.3,                                   // body length in metres
  skull: { length: 0.18 },
  spine: { length: 0.75, flex: 0.9 },
  forelimb: { upper: 0.22, lower: 0.26, foot: 0.12 },
  hindlimb: { upper: 0.27, lower: 0.31, foot: 0.17 },
  tail: { length: 0.65 },
});
cheetah.move({ speed: inc.param('Speed', { min: 0, max: 30, value: 20, unit: 'm/s' }) });
```

## Why

Asked for a dog running, the agent today makes something that runs well and does not look like a dog. Motion is in the SDK (timelines, tweens, physics, joints); bodies are not. The shape helpers are mostly for physics and circuits (`spring`, `gear`, `lens`, `blob`, `polygon`), so the agent invents an outline, its proportions and its leg timing from circles and paths, in the 60 to 150 lines a scene is allowed. The lines run out before the animal looks right, and the probe cannot tell a dog from a blob.

A larger token cap would buy more hand-drawn paths, still guessed, and break the 6-second scene budget (PRD 16.1). Detail has to move into the SDK, so the scene writes less and the figure shows more.

A table of species presets does not work either: there are too many animals, and what makes a mouse run differently from a cheetah is not a row of numbers but its build. So the kit holds no animals. It holds rules that read a build from bones.

## From bones to animal

```
skeleton (scene)  →  posture  →  muscles  →  skin and outline  →  attached parts  →  gait
```

Every step after the first is a rule in the kit, the same for every animal. Nothing is stored per species.

## The skeleton

The only thing a scene must write. Lengths are fractions of `size`, the body length in metres; `size` keeps the real scale, which the gait rules need.

| Field | Content |
| --- | --- |
| `size` | Body length in metres, nose to the root of the tail. |
| `skull` | `length`, and optionally `depth` and `snout` (fraction of the skull ahead of the eye). |
| `neck` | `length`, `segments`. |
| `spine` | `length`, `segments`, `flex` (0 stiff, as a horse, to 1, as a cheetah), `arch`. |
| `forelimb`, `hindlimb` | `upper`, `lower`, `foot`, `toes`; optionally `foot: { posture }` to override the posture the kit reads (below). |
| `tail` | `length`, `segments`, `stiffness`. |
| `stance` | `upright` (limbs under the body, mammals and birds) or `sprawl` (limbs out to the side, lizards). Default upright. |
| `modes` | Ways of moving the skeleton supports, such as `['quadruped', 'bipedal']` for an ape. Default from the build. |
| `hints` | Soft parts bones cannot tell (see Soft parts). |

The kit refuses a skeleton it cannot read, as the biology kit refuses an organelle a cell does not have: "a hindlimb needs upper, lower and foot", "spine flex is from 0 to 1".

### Example skeletons

`zoo.skeleton('dog', { ...overrides })` starts from a reviewed example skeleton and changes only what differs. Examples are data, not drawings, and are not needed: any skeleton works without one. They exist to cut the scene to a line or two for common animals and to give the plan call something to name. A first set: dog, cat, horse, mouse, cheetah, bear, ape, human, bird, lizard.

## Posture: read from the limb bones

How a foot meets the ground is read from the foot against the rest of the limb, as palaeontologists read it from fossil feet:

| Posture | Foot | Example |
| --- | --- | --- |
| Plantigrade | Short foot, the whole sole down | Bear, human, mouse at rest |
| Digitigrade | Longer foot, on the toes, heel raised | Dog, cat, cheetah |
| Unguligrade | Long foot, on the tip of the hoof | Horse, deer |

The ratio thresholds are starting values, tuned on the reference skeletons. Body size adds a crouch: small animals stand and run with flexed limbs, large ones on straighter limbs.

## Muscles: read from where they attach

Each bone carries the muscle groups that attach to it in real animals, sized from the bone:

| Bone | Muscle groups | Bulk follows |
| --- | --- | --- |
| Skull | Jaw and cheek | Skull depth and snout length |
| Neck | Neck | Skull size and neck length |
| Shoulder and upper forelimb | Shoulder, upper arm | Upper bone length and the posture's load |
| Pelvis and upper hindlimb | Hip, thigh | Upper bone length; heavier where the hindlimb drives |
| Lower limbs | Calf and forearm, tapering to tendon | Short and thick for diggers and climbers, thin for runners |
| Spine | Back, along the length | Spine length and flex |
| Tail | Tail base, tapering | Tail length and stiffness |

Runners come out with heavy upper limbs and thin lower ones, because long, light lower limbs are what make a runner; diggers and climbers with thick forearms. Each muscle is an ellipse or capsule in its bone's own frame, so it moves with the bone.

## Skin and outline

The outline is the smooth shell over the muscles. It is drawn without computing a silhouette: the animal is drawn twice from the same shapes, once behind with a thick stroke in the outline tone and once in front filled with the body tone. The overlapping shapes merge into one body with one clean outline, at no geometry cost per frame. Shading uses the existing tones (PRD 17.4): a lighter back, a darker belly, the far limbs a step darker than the near ones.

Muscle shapes are rebuilt only when the skeleton changes; each frame only moves bone transforms (PRD 22.6).

## Attached parts

Parts attach to landmarks on the bones and are drawn inside the same shell, so they blend in and move with their bone:

| Landmark | Part | Chosen by |
| --- | --- | --- |
| Eye socket on the skull | Eye | Skull size; forward-facing when the snout is short |
| Back of the skull | Ear | `hints.ears`, default small and rounded |
| Snout tip | Nose, mouth line | Snout length |
| Limb ends | Paw, hoof, hand, claws | Posture, and `toes` |
| Tail root | Tail | `tail` |
| Skull top, shoulders | Horns, mane, wings | `hints` |

## Soft parts

Bones cannot tell some things, and palaeontologists guess them too. A short, closed list of hints covers the common ones:

| Hint | Values |
| --- | --- |
| `ears` | small, pointed, floppy, long, none |
| `coat` | plain, spotted, striped, shaggy, scaly, feathered |
| `trunk`, `hump`, `mane`, `whiskers`, `horns` | on or off, with a size |
| `colours` | body and belly tones, from the theme |

A hint the kit does not know is refused with the list of known ones.

## Movement: read from the build

The scene says how fast; the kit works out how. Size and bones decide the gait, so a mouse and a cheetah differ without a "mouse gait" or a "cheetah gait" written anywhere.

- **Gait from speed and size.** The kit uses dimensionless speed, the Froude number v² / (g × hip height), under which animals of different sizes change gait at similar values. Starting values from the literature: walk below about 0.5, trot or run from there, gallop or bound above about 2 to 3. Tuned on the bench.
- **Which fast gait.** A flexible spine (`flex` high) gallops with a long spine swing and a phase with all feet off the ground; a small, crouched build bounds, both hind feet together; a stiff spine trots and canters.
- **Stride frequency** rises as legs get shorter, so a mouse's legs blur where a horse's stride is slow and long.
- **Time on the ground** shortens as speed rises.
- **Feet stay planted.** Each limb places its foot with two-bone inverse kinematics, so a foot in contact with the ground does not slide.
- **Modes.** A skeleton with several `modes` switches between them: `ape.move({ mode: 'bipedal', at: 4 })`. The kit moves the posture, shifts the body over the new support and changes the rhythm. A mode the skeleton cannot support is refused: "this skeleton's hindlimbs are too short to walk on two legs".

All motion is time-based (PRD 17.6), from the figure's clock, so it is the same at any frame rate and seeks correctly in film mode.

## Parts, readouts and teaching

The kit registers named parts (PRD 23.6): bones (`Femur`, `Spine`), muscle groups (`Thigh muscles`), and feet, so steps can focus on them and learners can tap them. With `zoo.skeleton(..., { show: 'bones' })` the skin fades to show the skeleton inside, and `'muscles'` shows the muscle layer, so the reconstruction itself can be taught.

Readouts come from the same model that moves the animal (the one-model rule, PRD 17.2): `cheetah.gait` (walk, trot, gallop, bound), `cheetah.stride` (metres), `cheetah.frequency` (strides per second), `cheetah.airborne` (fraction of the stride with no foot down).

## Generation

- The plan call names the `anatomy` component, so its reference is loaded only for those scenes and core.md stays under its limit (PRD 17.9).
- A scene with the kit is about 10 to 20 lines: one skeleton, one `move`, parts and steps. That is shorter than today's hand-drawn animals, so the scene call gets faster while the figure gets more detailed.
- Reviewed skeletons are retrieved by concept (PRD 25.5): a zebra starts from the reviewed horse.
- The code a learner sees is the real skeleton and the real call that drives the figure; no placeholder function stands in for it.

## Checks

The validator checks the skeleton: required bones, ranges, known hints and modes. The probe adds, offline and with no model tokens:

- Feet in contact with the ground do not slide.
- Every joint stays within its limits through a gait cycle.
- On two legs, the body's centre of mass stays over the feet.
- The gait cycle closes: the pose at the end of a stride matches the start.
- The animal stays inside the stage at every speed the parameter allows.

None of these can say the animal looks like the one asked for. That rests on the reconstruction rules, the example skeletons and human review of the reference figures, not on a model looking at pictures (no critic on the generation path).

## Limits

A first version covers animals with a backbone. Insects and crabs (skeleton outside), and octopus, jellyfish and worms (no hard skeleton) need rules of their own and come later. A stage draws at most 6 animals; an animal is at most about 60 drawn elements (bench).

## Build order

1. Skeleton reading, posture, muscles and skin, standing still: dog, horse, mouse, cheetah from skeletons alone.
2. Gaits from speed and size, foot planting, readouts.
3. Landmarks and soft-part hints.
4. Modes and two-legged balance: ape, human, bird.
5. Generation: catalog entry, reference, example skeletons, evals, and the Playground acceptance run below.
6. Later: skeletons outside the body, soft bodies.

## Acceptance

- The four skeletons in step 1 are recognised by people shown them without labels, in a small review with the team.
- Through the running Playground (AGENTS.md, Real generation acceptance), "a dog running", "a mouse running", "a cheetah at full speed" and "an ape that stands up and walks" reach Ready with a live, visibly drawn figure, within the PRD 16.1 budget; plan, scene, validation and probe times are reported against today's hand-drawn versions of the same prompts.
- Every reference figure passes the checks above at every speed its parameter allows.

## Open questions

- Whether the gait thresholds from the literature hold for drawn animals, or need tuning per build.
- How far the double-drawn outline holds up when limbs cross the body, or whether the far limbs need their own outline.
- Whether learners should be able to edit bone lengths with sliders, and watch the animal and its gait change.
