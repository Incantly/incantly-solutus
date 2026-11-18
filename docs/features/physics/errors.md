# Physics: errors

Companion to `design.md`. Error objects use the format in `docs/features/errors/design.md` (fields `ok`, `committed`, `kind`, `code`, `phase`, `message`, `messageKey`, `params`, `line`, `col`, `endCol`, `token`, `expected`, `forms`, `hint`, `suggest`, `recovery`, `related`, `fingerprint`). The area code letter for physics is **B** (for bodies). In the kernel's code table the new kinds take the block from `C130`, after the 3D block.

Four families, as in the other areas:

1. **Errors:** the line was refused, and nothing changed (`ok: false`).
2. **Undefined values:** the line was accepted, but a body, joint, liquid or cloth has no value. It carries a `reason`, a short `detail` and maybe a `cause`.
3. **Notices:** the line or the film worked, with a fact the caller should know (a shape was split, the film runs slow).
4. **Runtime reports:** things that happen while the film plays, when no line is being applied. They are warnings in the next `draw` or `figure` result and in the player bar, never a dialog (`docs/features/animation-time/errors.md`).

---

## 1. How the reference app handles it

The reference app has no physics engine, so it has no physics errors. Hand-made bounces with `if` formulas fail silently: a ball passes through the floor at high speed, or energy grows until the figure blows up, with no message.

## 2. What we do better

- A shape that cannot be a body says why, and offers the line that works (`with solid = true`).
- A world that blows up stops only the bodies that blew up, with a reason and a hint, and the rest keep running.
- Every limit is the same on every computer and names the number.
- A slow computer gets a slower film, never a different one, and the player says so.

---

## 3. Errors (line refused)

| Code | Kind | Phase | When | Recovery | Hint and suggestion |
|---|---|---|---|---|---|
| B001 | `not_a_body_shape` (new) | typecheck | `Body(s)` where `s` has no area: a `Line`, `Ray`, `Segment`, open `Polyline`, `Curve` or function graph | `use_suggestion` | "A line has no mass. To make it solid, write `s with solid = true`." `suggest`: that line |
| B002 | `self_crossing` (new) | typecheck | `Body(p)` or `p with solid = true` where `p` is a literal polygon whose edges cross | `fix_line` | names the two edges that cross |
| B003 | `not_convex_3d` (new) | typecheck | `Body(s)` on a polyhedron with dents | `fix_line` | "Bodies in space must have no dents. Split it into convex parts and `Weld` them." |
| B004 | `bad_property_value` | typecheck | A literal property out of range: `mass = 0`, `mass = −2`, `bounce = 1.5`, `friction = −1`, `passes = 50`, `world with timestep = 1/1000`, a cloth's `stretch = 2`, `tears = 0.5`, `thickness = 1`, a wave grid's `damping = 20` (0 to 10) or `depth = 0` | `fix_line` | `expected` has the range |
| B005 | `bad_property_value` | typecheck | `world with timestep = 1/100`: not a whole number of solver steps | `fix_line` | "The step must divide 1/240 s steps evenly. Try 1/120 or 1/60." |
| B006 | `unknown_property` | resolve | `b with bounciness = 0.9` | `use_suggestion` | the closest names (`bounce`) |
| B007 | `read_only` | commit | `b with pos = (1, 2)`, `b with x = 3`, `world with time = 2` | `use_suggestion` | "The physics moves `b`. To move its start, change its shape `p`. To kick it, use `Push(b, (1, 0))`." |
| B008 | `not_a_body` (new) | typecheck | A joint or `Push` with an object that is neither a body nor a solid shape | `use_suggestion` | `suggest`: `p with solid = true`, or `Body(p, mass = 1)` |
| B009 | `same_body` (new) | typecheck | `Hinge(a, a, P)`, `Spring(b, b)` | `fix_line` | "A joint links two different bodies." |
| B010 | `mixed_dimension` (C120) | typecheck | A 2D body and a 3D body in one joint, a 2D `Push` on a `Body3`, a 3D world gravity in a 2D figure, a cloth in space pinned to a 2D body | `use_suggestion` | as in `space-3d/errors.md` S001 |
| B011 | `reserved_name` | resolve | Defining `world` or `hit` | `rewrite` | pick another name |
| B012 | `cycle` | commit | A body's shape or mass reads the body itself (`Body(Circle(b.pos, 1))`) | `rewrite` | the chain; "Forces may read `b`, but its shape may not." |
| B013 | `limit` | plan | A 1,001st body or joint, more than 2,000 liquid particles (every liquid and tap of the figure, in the plane or in space), a wave or smoke grid over 64 × 64 (`Waves(box, 65)`), a cloth over 64 × 32 points (400 for a rope), more than 4,096 cloth points in all, a second cloth with `self = true`, a 65th pin | `rewrite` | the limit and the current count, the same on every computer |
| B014 | `no_matching_form` | typecheck | Wrong argument types, as for any command | `choose_form` | the forms |
| B015 | `not_in_world` (new) | typecheck | `on b hit: …` where `b` is not a body | `fix_line` | "Only bodies hit things. Make `b` a body first." |
| B016 | `mode_forbids` | plan | A physics line in Scientific, Probability or CAS, or in an exam that forbids it | `report` | as in `app-modes` |
| B017 | `bad_argument` | typecheck | `Wheel(c, at, 0)` (radius 0), `Liquid(region, 0)`, `Pour(at, 0, speed)`, `Waves(box, 1)` (fewer than 2 a side), `Rope(a, b, −1)`, `Cloth(P, u, v, 1, 8)` (fewer than 2 points a side), a cloth with `u` and `v` along one line, as literals | `fix_line` | `expected` |
| B018 | `not_a_cloth` (new) | typecheck | `Pin(c, P)` where `c` is not a cloth | `use_suggestion` | "Pin holds a cloth. To hold a body, use `Hinge(b, wall, P)`." `suggest`: that line |
| B019 | `pin_off_cloth` (new) | typecheck | `Pin(c, P)` with `P` a literal point further than one link from every point of `c` | `fix_line` | names the nearest point of the cloth and how far it is |
| B020 | `not_burnable` (new, round 11) | typecheck | `Ignite(b)` where `b` has no `burns`, or `burns` on something that is not a body, cloth or solid shape | `use_suggestion` | "b can't burn yet. Add `b with burns = true` first." `suggest`: that line |
| B021 | `no_fire_grid` (new, round 11) | plan | `Ignite(b)` or `burns` on a thing outside every `Fire` grid | `use_suggestion` | "Nothing can burn outside a fire. Make a fire round b." `suggest`: `Fire(b.pos)` |

**Values versus text.** A polygon built from points whose edges only cross for some values is not an error. It is an undefined body (section 4). Only a literal shape that can never be valid is refused at check time.

### 3.1 Examples

**A body made from a line.**

```json
{
  "ok": false, "committed": false,
  "kind": "not_a_body_shape", "code": "B001", "phase": "typecheck",
  "message": "Body(L): L is a line, and a line has no area, so it cannot have a mass.",
  "messageKey": "physics.not_a_body_shape",
  "params": { "command": "Body", "arg": 1, "got": "Line" },
  "line": 4, "col": 10, "endCol": 11, "token": "L",
  "expected": ["Polygon", "Circle", "Ellipse", "Box", "closed Polyline"],
  "hint": "To make the line a solid floor that bodies hit, write L with solid = true.",
  "suggest": ["L with solid = true"],
  "recovery": "use_suggestion",
  "related": ["L"],
  "fingerprint": "not_a_body_shape:Body:1",
  "severity": "error"
}
```

**Moving a body by hand.**

```json
{
  "ok": false, "committed": false,
  "kind": "read_only", "code": "B007", "phase": "commit",
  "message": "b's position is set by the physics, so it cannot be written.",
  "messageKey": "physics.read_only",
  "params": { "object": "b", "property": "pos" },
  "line": 6, "col": 8, "endCol": 11, "token": "pos",
  "hint": "To move where b starts, change its shape p. To give it a kick while it moves, use Push.",
  "suggest": ["Push(b, (2, 0))"],
  "recovery": "use_suggestion",
  "related": ["b", "p"],
  "fingerprint": "read_only:b:pos",
  "severity": "error"
}
```

**A step that does not fit the solver grid.**

```json
{
  "ok": false, "committed": false,
  "kind": "bad_property_value", "code": "B005", "phase": "typecheck",
  "message": "world timestep 1/100 does not divide the solver's 1/240 s steps evenly.",
  "messageKey": "physics.bad_step",
  "params": { "got": "1/100", "solverStep": "1/240" },
  "line": 2, "col": 18, "endCol": 23, "token": "1/100",
  "expected": ["1/60", "1/80", "1/120", "1/240", "1/480"],
  "hint": "Use 1/120 (the default) or 1/240 for stiff springs.",
  "suggest": ["world with timestep = 1/120"],
  "recovery": "fix_line",
  "fingerprint": "bad_property_value:world:timestep",
  "severity": "error"
}
```

**Too many bodies.**

```json
{
  "ok": false, "committed": false,
  "kind": "limit", "code": "B013", "phase": "plan",
  "message": "A figure can have at most 1,000 bodies. This line would make 1,200.",
  "messageKey": "physics.limit_bodies",
  "params": { "what": "bodies", "limit": 1000, "count": 1200 },
  "line": 3, "col": 1, "endCol": 40,
  "hint": "Make fewer bodies, or make the still ones solid shapes instead: they cost almost nothing.",
  "recovery": "rewrite",
  "fingerprint": "limit:bodies",
  "severity": "error"
}
```

---

## 4. Undefined values (the line is accepted)

Reasons are registered in `AreaUndefReasons` (`packages/kernel/src/contracts/values.ts`).

| Reason | On | When | `detail` |
|---|---|---|---|
| `input_undefined` | body, joint, cloth, smoke | The shape, mass, an anchor, a cloth's corner or sides, or a smoke's region, grid size or source is undefined at the start | names the input |
| `self_crossing` (new) | body | The shape's edges cross at the start, for these values | names the two edges |
| `degenerate` | body, smoke | The shape (or the smoke's region) has no area (all points on a line) or a radius of 0 | "has no area" |
| `unstable_world` (new) | body, joint, liquid, smoke, cloth | A position or speed became not finite or over 1e6 | the time, and "springs too stiff for the step" or "too much force" |
| `broken` (new) | wheel | A wheel with `breaks` went over its force (a broken joint stays defined, with `j.broken` true and `j.force` 0) | the time and the force |
| `left_world` (new) | body | It left `world.range` | the time and where it left |
| `burnt` (new, round 11) | body, solid shape | It burnt away (`b.burnt` reached 1, design 9.7) | the time |
| `timeout` | body, liquid, cloth | The world is still catching up after a seek or a restart | "catching up" |

An unstable world is handled like an unstable state (`animation-time/design.md` 7.8):

1. After each step the engine checks every awake island.
2. An island with a value that is not finite, or over 1e6, stops. Its bodies and joints become undefined with `unstable_world` from that time on.
3. Other islands keep running.
4. A runtime report goes to the teacher and the learner (section 6).
5. Seeking to an earlier time shows valid values again.

### 4.1 Example (a `figure` entry)

```json
{
  "name": "b",
  "type": "Body",
  "defined": false,
  "reason": "unstable_world",
  "detail": "At t = 3.42 s the spring s pushed b too hard for the step size.",
  "cause": "s"
}
```

---

## 5. Notices (success with a fact)

| Code | Severity | When | Message |
|---|---|---|---|
| `split_shape` | info | A polygon with dents was split into convex parts | "p was split into 3 parts to make it solid." |
| `shape_approximated` | info | An ellipse, cylinder or cone uses sides for contacts | "c hits as a 24-sided shape." |
| `left_world` | info | A body or liquid particles left `world.range` | "b left the world at t = 4.1 s." / "120 drops left the world." |
| `contacts_dropped` | warning | More than 4,000 contact points in a step | "Too many touching points: 4,000 kept." |
| `checkpoints_thinned` | info | The 32 MB checkpoint cap was reached | "Seeking before t = 30 s may take longer." |
| `ground_sampled` | info | A solid curve was cut to 2,000 pieces | "f is solid between x = −50 and 50." |
| `input_undefined` | warning | A force or property formula was undefined during the film | "b's force was undefined at t = 2 s and was taken as 0." |
| `worker_unavailable` | info | The browser has no worker, so liquids and cloth run on the page | "Liquids and cloth run on the page, so the film may play slower here. It is the same film." |
| `torn` | info | Links of a cloth with `tears` broke | "net tore at t = 2.4 s: 18 links." |
| `burnt` | info | A burnable body or shape burnt away (round 11) | "log burnt away at t = 12.3 s." |
| `fire_out` | info | A fire's grid has no fuel and no flame left (round 11) | "f went out at t = 20 s." |
| `worker_crashed` | info | The physics worker stopped; the page took the world back from its start (code B112) | "The physics worker stopped, so the film goes on here on the page. It is the same film." |
| `cloth_drawn_coarse` | info | No WebGL 2, so a cloth in space is drawn from every second point, and drops from every second drop (code B114; B113 is kept for `torn`). Raised by the Space pane once, naming the first object drawn coarser | "flag is drawn coarser on this computer; it moves the same." |

---

## 6. Runtime reports (while the film plays)

| Kind | When | Where it shows | Hint |
|---|---|---|---|
| `unstable_world` | An island blew up (section 4) | player bar, the next `figure` | "Lower the spring's `k`, add `damping`, or use `world with timestep = 1/240`." |
| `physics_behind` | Steps took longer than the frame for 1 s; the film runs slower than real time | a small "slow" mark on the player bar, once | "The film is the same, only slower. Fewer awake bodies make it faster." |
| `catching_up` | The world is stepping to the current time after a seek or restart | "catching up" on the player bar | none |
| `broken` | A weld or wheel broke | the next `figure`, as a fact the teacher can say | none |
| `torn` | A cloth tore | the next `figure`, as an event the teacher can say | none |

---

## 7. Host faults

| Kind | When | What happens |
|---|---|---|
| `worker_unavailable` | No worker support | Physics runs on the page; a notice once |
| `worker_crashed` | The physics worker stopped | The page builds the world again from its start, with the same input log, and catches up; a notice once |
| `webgl_unavailable` | No WebGL 2 for the Space view | Cloth and drops in space are drawn coarser by the software painter (`design.md` 12.1); the notice `cloth_drawn_coarse` once. A lost context (`webgl_lost`) is not this fault: the software painter draws until the context is back, with no notice |

They never block a line and never change the figure.

## 8. Recovery for a model

| Got | Do |
|---|---|
| `not_a_body_shape` | Use the `suggest` line: make the shape solid instead |
| `read_only` on a body | Change the source shape, or use `Push` |
| `not_a_body` | Make the object a body or solid first, then the joint |
| `bad_property_value` | Use a value from `expected` |
| `limit` | Use fewer bodies; still things should be solid shapes, not bodies |
| `unstable_world` report | Add `damping` to springs, lower `k`, or halve the step |
| `physics_behind` | Nothing is wrong; say the film plays slower on this computer |
| `limit` on a cloth | Use fewer points: 32 × 32 looks smooth and costs half |
| `not_a_cloth` | `Pin` is for cloth; use `Hinge` for a body |
| `pin_off_cloth` | Pin at a point on the cloth, such as a corner, or use `pins = "top"` |
| `unstable_world` on a cloth | Lower `stretch` a little, or add `damping` |

## 9. Cross-links

- Error format: `docs/features/errors/design.md`.
- States and their failures: `docs/features/animation-time/errors.md`.
- 3D kinds such as `mixed_dimension`: `docs/features/space-3d/errors.md`.
- Mode refusals: `docs/features/app-modes/`.
