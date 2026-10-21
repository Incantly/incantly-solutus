import type {
  Body2D,
  BodyOptions,
  DragInfo,
  Energy,
  ForceArrowOptions,
  ForceKind,
  HingeOptions,
  Joint2D,
  Live,
  Physics2DOptions,
  SpringJointOptions,
  Tank2D,
  TankOptions,
  Tone,
  Vec2,
  ViewBox,
  World2D,
} from '../../api/types';
import type { KitContext } from '../../runtime/kit';
import type { KitModule } from '../../runtime/kits';
import { SceneApiError } from '../../scene/errors';
import { nodeOf, TONES } from '../../scene/handles';
import { Painter, View } from './draw';
import { circle, polygon, toLocal, toWorld, type Shape, type V2 } from './geometry';
import {
  Body,
  finiteNumber,
  finitePoint,
  isForceKind,
  Joint,
  MAX_BODIES,
  MAX_JOINTS,
  read,
  STEP,
  Tank,
  World,
  type BodyKind,
  type BodySpec,
  type JointKind,
  type JointSpec,
} from './world';

/**
 * inc.physics2d (PH-1 to PH-8): a 2D world in metres, kilograms and seconds,
 * y up from the bottom of the stage. The scene adds bodies, joints, liquids
 * and fields; the kit steps them at a fixed rate and draws them, so the
 * scene never writes an integrator or a collision test.
 */

const DEFAULT_VIEWBOX: ViewBox = [0, 0, 600, 400];
const WALL_THICKNESS = 2;
const MAX_TANKS = 4;
const MAX_FIELDS = 8;
const MAX_ARROW_SETS = 8;
const MAX_CALLBACKS = 8;
const WALLS = ['floor', 'left', 'right', 'ceiling'] as const;

function checkViewBox(value: unknown): ViewBox {
  if (value === undefined) return DEFAULT_VIEWBOX;
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite) || value[2] <= 0 || value[3] <= 0) {
    throw new SceneApiError('inc.physics2d: viewBox must be four finite numbers [x, y, width, height] with a positive width and height');
  }
  return value as unknown as ViewBox;
}

function checkTone(value: unknown, what: string): Tone | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TONES.has(value)) throw new SceneApiError(`${what}: unknown tone "${String(value)}"`);
  return value as Tone;
}

function checkFlag(value: unknown, what: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new SceneApiError(`${what} must be true or false`);
  return value;
}

/** A live option: a value, or a function read again on restart; either is checked whenever it is read. */
function live<T>(value: unknown): Live<T> | undefined {
  return value as Live<T> | undefined;
}

function options<T extends object>(value: unknown, call: string): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SceneApiError(`${call} needs an options object`);
  return value as T;
}

function createWorld(ctx: KitContext, raw: Physics2DOptions): World2D {
  const opts = options<Physics2DOptions>(raw, 'inc.physics2d');
  const scale = opts.scale === undefined ? 50 : finiteNumber(opts.scale, 'inc.physics2d: scale', (n) => n > 0 && n <= 10_000, 'stage units per metre, above 0');
  const view = new View(ctx.stage.viewBox, scale);
  const painter = new Painter(ctx, view);
  const gravity = opts.gravity;
  if (gravity !== undefined && typeof gravity !== 'function') finiteNumber(gravity, 'inc.physics2d: gravity');
  const air = opts.air;
  if (air !== undefined && typeof air !== 'function') finiteNumber(air, 'inc.physics2d: air', (n) => n >= 0, '0 or more N per m/s');
  const restartOnChange = opts.restart === undefined ? true : checkFlag(opts.restart, 'inc.physics2d: restart');
  const world = new World({
    gravity: () => (typeof gravity === 'function' ? finiteNumber(gravity(), 'inc.physics2d: gravity') : (gravity ?? 9.8)),
    air: () => (typeof air === 'function' ? finiteNumber(air(), 'inc.physics2d: air', (n) => n >= 0, '0 or more N per m/s') : (air ?? 0)),
  });
  const bodies = new WeakMap<object, Body>();
  const hitCallbacks: Array<(a: Body2D, b: Body2D, speed: number) => void> = [];
  const touchCallbacks: Array<{ sensor: Body; callback: (body: Body2D) => void }> = [];
  let version: number | null = null;
  let sceneTimeAtStart = ctx.time();
  let warnedLag = false;
  let warnedUnstable = false;
  let arrowSets = 0;

  const restartWorld = () => {
    world.restart();
    sceneTimeAtStart = ctx.time();
  };

  /** A changed parameter starts the world again, before any scene code that reacts to it runs. */
  const sync = () => {
    const current = ctx.paramVersion();
    if (version === null) version = current;
    else if (current !== version) {
      version = current;
      if (restartOnChange) restartWorld();
    }
  };

  const bodyOf = (value: unknown, what: string): Body => {
    const body = typeof value === 'object' && value !== null ? bodies.get(value) : undefined;
    if (!body) throw new SceneApiError(`${what} needs a body made by this world`);
    return body;
  };

  // ---------------------------------------------------------------------------
  // Bodies
  // ---------------------------------------------------------------------------

  const handleFor = (body: Body, group: Body2D['handle']): Body2D => {
    const handle: Body2D = {
      get x() {
        return body.x;
      },
      get y() {
        return body.y;
      },
      get angle() {
        return (body.a * 180) / Math.PI;
      },
      get vx() {
        return body.vx;
      },
      get vy() {
        return body.vy;
      },
      get speed() {
        return Math.hypot(body.vx, body.vy);
      },
      get mass() {
        return body.m;
      },
      force(kind: ForceKind) {
        if (!isForceKind(kind)) throw new SceneApiError(`force needs a kind of force: gravity, normal, friction, tension, spring, buoyancy, drag, electric, magnetic, applied or net`);
        return body.force(kind);
      },
      place(x: number, y: number, angle?: number) {
        sync();
        const at = finitePoint([x, y], 'place');
        const turn = angle === undefined ? undefined : finiteNumber(angle, 'place: angle');
        if (!world.started) {
          body.start.at = at;
          if (turn !== undefined) body.start.angle = turn;
          body.start.velocity = [0, 0];
          body.start.spin = 0;
        }
        if (turn !== undefined) body.setAngle((turn * Math.PI) / 180);
        // The given point is the body's centre of mass.
        body.x = at[0];
        body.y = at[1];
        body.vx = body.vy = body.w = 0;
        body.bounds();
        return handle;
      },
      velocity(vx: number, vy: number) {
        sync();
        const v = finitePoint([vx, vy], 'velocity');
        if (body.fixed) return handle;
        if (!world.started) body.start.velocity = v;
        body.vx = v[0];
        body.vy = v[1];
        return handle;
      },
      push(fx: number, fy: number) {
        sync();
        const f = finitePoint([fx, fy], 'push');
        if (!world.started) body.start.push = f;
        body.push = [...f];
        return handle;
      },
      tone(name: Tone) {
        painter.tone(body, checkTone(name, 'tone') ?? 'b');
        return handle;
      },
      show(visible = true) {
        body.active = Boolean(visible);
        return handle;
      },
      hide() {
        body.active = false;
        return handle;
      },
      handle: group,
    };
    return handle;
  };

  const userBodies = () => world.bodies.filter((b) => b.spec.kind !== 'wall').length;

  const addBody = (kind: BodyKind, raw: BodyOptions, name: string, shape: () => { shape: Shape; centroid: V2 }, defaults: { tone?: Tone } = {}): Body2D => {
    sync();
    if (userBodies() >= MAX_BODIES) throw new SceneApiError(`A world holds at most ${MAX_BODIES} bodies`);
    const fixed = checkFlag(raw.fixed, `${name}: fixed`);
    const sensor = checkFlag(raw.sensor, `${name}: sensor`);
    const draggable = checkFlag(raw.draggable, `${name}: draggable`);
    const tone = checkTone(raw.tone, name) ?? defaults.tone ?? (sensor ? 'lit' : fixed ? 'mid' : 'b');
    if (raw.label !== undefined && typeof raw.label !== 'string' && typeof raw.label !== 'number') throw new SceneApiError(`${name}: label must be text or a number`);
    if (raw.at === undefined) throw new SceneApiError(`${name} needs at: its centre [x, y] in metres`);
    const spec: BodySpec = {
      kind,
      fixed,
      sensor,
      shape,
      at: live<Vec2>(raw.at)!,
      angle: live<number>(raw.angle),
      mass: live<number>(raw.mass),
      density: live<number>(raw.density),
      velocity: live<Vec2>(raw.velocity),
      spin: live<number>(raw.spin),
      friction: live<number>(raw.friction),
      bounce: live<number>(raw.bounce),
      charge: live<number>(raw.charge),
      magnet: live<number>(raw.magnet),
      name,
    };
    const body = new Body(world.newBodyId(), spec);
    body.setup();
    world.addBody(body);
    const group = painter.body(body, tone, raw.label);
    body.handle = handleFor(body, group);
    bodies.set(body.handle, body);
    if (draggable) grab(body, raw.label === undefined ? name : String(raw.label));
    if (!fixed) {
      if (body.x < 0 || body.x > view.width || body.y < 0 || body.y > view.height) {
        ctx.warn(`${name} starts at [${body.x.toFixed(2)}, ${body.y.toFixed(2)}], outside the ${view.width.toFixed(1)} m by ${view.height.toFixed(1)} m world; positions are in metres from the bottom left`);
      }
      if (body.extent * 2 > Math.max(view.width, view.height)) ctx.warn(`${name} is bigger than the stage: sizes are in metres, and the world is ${view.width.toFixed(1)} m wide`);
    }
    return body.handle;
  };

  /** Puts the point of a body the learner holds under their pointer, and stops it. */
  const moveBodyTo = (body: Body, target: V2, local: V2) => {
    const [ox, oy] = toWorld({ x: 0, y: 0, q: body.q }, local[0], local[1]);
    body.x = target[0] - ox;
    body.y = target[1] - oy;
    body.vx = body.vy = body.w = 0;
    body.bounds();
  };

  /** The learner drags a body by the point they hold, through a stiff spring, so the physics stays honest. */
  const grab = (body: Body, label: string) => {
    ctx.addDrag(
      nodeOf(body.handle.handle),
      label,
      (p: DragInfo) => {
        sync();
        const target: V2 = [p.x, p.y];
        if (!world.grip || world.grip.body !== body) {
          const local = toLocal(body, p.startX, p.startY);
          // Keyboard drags start at the shape's centre; a grip outside the body holds its centre.
          const inside = Math.hypot(local[0], local[1]) <= body.extent;
          world.grip = { body, local: inside ? local : [0, 0], target, steps: 0 };
        }
        world.grip.target = target;
        if (body.fixed) moveBodyTo(body, target, world.grip.local);
      },
      (x, y) => view.fromStage(x, y),
      () => {
        const grip = world.grip;
        if (!grip || grip.body !== body) return;
        // Paused, or a keyboard nudge that ended before any step: move it there directly.
        if (grip.steps === 0 && body.active) moveBodyTo(body, grip.target, grip.local);
        world.grip = null;
      },
    );
  };

  // ---------------------------------------------------------------------------
  // Walls
  // ---------------------------------------------------------------------------

  const walls = opts.walls === undefined ? ['floor'] : opts.walls === true ? [...WALLS] : opts.walls === false ? [] : opts.walls;
  if (!Array.isArray(walls) || walls.some((w) => !(WALLS as readonly string[]).includes(w as string))) {
    throw new SceneApiError('inc.physics2d: walls must be true, false or a list of floor, left, right and ceiling');
  }
  const wallBody = (name: string, cx: number, cy: number, w: number, h: number): Body => {
    const spec: BodySpec = {
      kind: 'wall',
      fixed: true,
      sensor: false,
      shape: () => polygon(
        [
          [-w / 2, -h / 2],
          [w / 2, -h / 2],
          [w / 2, h / 2],
          [-w / 2, h / 2],
        ],
        name,
      ),
      at: [cx, cy],
      name,
    };
    const body = new Body(world.newBodyId(), spec);
    body.setup();
    world.addBody(body);
    return body;
  };
  const { width: W, height: H } = view;
  const span = Math.max(W, H) * 4;
  const edges: Record<(typeof WALLS)[number], () => [Body, V2, V2]> = {
    floor: () => [wallBody('the floor', W / 2, -WALL_THICKNESS / 2, span, WALL_THICKNESS), [0, 0], [W, 0]],
    left: () => [wallBody('the left wall', -WALL_THICKNESS / 2, H / 2, WALL_THICKNESS, span), [0, 0], [0, H]],
    right: () => [wallBody('the right wall', W + WALL_THICKNESS / 2, H / 2, WALL_THICKNESS, span), [W, 0], [W, H]],
    ceiling: () => [wallBody('the ceiling', W / 2, H + WALL_THICKNESS / 2, span, WALL_THICKNESS), [0, H], [W, H]],
  };
  for (const name of new Set(walls as Array<(typeof WALLS)[number]>)) {
    const [body, from, to] = edges[name]();
    body.handle = handleFor(body, painter.wall(from, to));
    bodies.set(body.handle, body);
  }

  // ---------------------------------------------------------------------------
  // Joints
  // ---------------------------------------------------------------------------

  const end = (value: unknown, what: string): { body: Body | null; point: V2 } => {
    if (Array.isArray(value)) return { body: null, point: finitePoint(value, what) };
    return { body: bodyOf(value, what), point: [0, 0] };
  };

  const addJoint = (kind: JointKind, spec: Omit<JointSpec, 'kind'>, tone: Tone | undefined): Joint2D => {
    if (world.joints.length >= MAX_JOINTS) throw new SceneApiError(`A world holds at most ${MAX_JOINTS} joints`);
    const joint = new Joint({ kind, ...spec });
    joint.setup();
    world.addJoint(joint);
    const line = painter.joint(joint, tone);
    const handle: Joint2D = {
      get tension() {
        return joint.tension;
      },
      get length() {
        return joint.measure();
      },
      setLength(metres: number) {
        sync();
        joint.length = joint.setLengthTo = finiteNumber(metres, `${spec.name}: setLength`, (n) => n >= 0 && n <= 1000, 'from 0 to 1000 metres');
        return handle;
      },
      show(visible = true) {
        joint.active = Boolean(visible);
        return handle;
      },
      hide() {
        joint.active = false;
        return handle;
      },
      handle: line,
    };
    joint.handle = handle;
    return handle;
  };

  const lineJoint = (kind: 'spring' | 'rope' | 'rod', a: unknown, b: unknown, raw: SpringJointOptions | undefined) => {
    sync();
    const name = `world.${kind}`;
    const o = raw === undefined ? {} : options<SpringJointOptions>(raw, name);
    const A = end(a, `${name}: its first end`);
    const B = end(b, `${name}: its second end`);
    if (!A.body && !B.body) throw new SceneApiError(`${name} needs at least one body`);
    if (A.body && A.body === B.body) throw new SceneApiError(`${name} needs two different ends`);
    const anchor = (e: { body: Body | null; point: V2 }, local: unknown, what: string): V2 => (e.body ? (local === undefined ? [0, 0] : finitePoint(local, what)) : e.point);
    return addJoint(
      kind,
      {
        a: A.body,
        b: B.body,
        anchorA: anchor(A, o.anchorA, `${name}: anchorA`),
        anchorB: anchor(B, o.anchorB, `${name}: anchorB`),
        length: live<number>(o.length),
        stiffness: kind === 'spring' ? live<number>(o.stiffness) : undefined,
        damping: kind === 'spring' ? live<number>(o.damping) : undefined,
        name,
      },
      checkTone(o.tone, name),
    );
  };

  // ---------------------------------------------------------------------------
  // Stepping and drawing
  // ---------------------------------------------------------------------------

  ctx.simulate((dt) => {
    sync();
    world.step(dt);
    if (!world.finite()) {
      if (!warnedUnstable) ctx.warn('The physics became unstable (a value went to infinity) and started again; check masses, stiffness and forces');
      warnedUnstable = true;
      restartWorld();
      return;
    }
    const hits = world.hits.splice(0);
    const touches = world.touches.splice(0);
    for (const hit of hits) for (const callback of hitCallbacks) callback(hit.a.handle, hit.b.handle, hit.speed);
    for (const touch of touches) {
      for (const entry of touchCallbacks) if (entry.sensor === touch.sensor) entry.callback(touch.body.handle);
    }
  }, STEP);

  let lastTime = ctx.time();
  ctx.onRedraw(() => {
    sync();
    if (world.started) world.settleFrame();
    else world.showStartForces();
    // Paused (scene time stood still), the learner's hand moves the body directly.
    const now = ctx.time();
    const paused = now === lastTime;
    lastTime = now;
    const grip = world.grip;
    if (grip && paused && grip.body.active && !grip.body.fixed) moveBodyTo(grip.body, grip.target, grip.local);
    world.stepsSinceDraw = 0;
    painter.draw();
    const behind = ctx.time() - sceneTimeAtStart - world.time;
    if (behind > 0.25 && !warnedLag) {
      warnedLag = true;
      ctx.warn('The physics fell behind the frame rate and dropped time; use fewer bodies or joints');
    }
  });

  // ---------------------------------------------------------------------------
  // The world handle
  // ---------------------------------------------------------------------------

  const api: World2D = {
    ball(raw) {
      const o = options<BodyOptions & { r: Live<number> }>(raw, 'world.ball');
      if (o.r === undefined) throw new SceneApiError('world.ball needs r: its radius in metres');
      const r = live<number>(o.r);
      return addBody('ball', o, 'world.ball', () => ({ shape: circle(finiteNumber(read(r, 1), 'world.ball: r', (n) => n > 0 && n <= 1000, 'a radius above 0 metres')), centroid: [0, 0] }));
    },
    box(raw) {
      const o = options<BodyOptions & { w: Live<number>; h: Live<number> }>(raw, 'world.box');
      if (o.w === undefined || o.h === undefined) throw new SceneApiError('world.box needs w and h: its width and height in metres');
      const w = live<number>(o.w);
      const h = live<number>(o.h);
      return addBody('box', o, 'world.box', () => {
        const width = finiteNumber(read(w, 1), 'world.box: w', (n) => n > 0 && n <= 1000, 'a width above 0 metres');
        const height = finiteNumber(read(h, 1), 'world.box: h', (n) => n > 0 && n <= 1000, 'a height above 0 metres');
        return polygon(
          [
            [-width / 2, -height / 2],
            [width / 2, -height / 2],
            [width / 2, height / 2],
            [-width / 2, height / 2],
          ],
          'world.box',
        );
      });
    },
    polygon(raw) {
      const o = options<BodyOptions & { points: ReadonlyArray<Vec2> }>(raw, 'world.polygon');
      const built = polygon(o.points, 'world.polygon');
      return addBody('polygon', o, 'world.polygon', () => built);
    },
    ramp(from, to, raw) {
      const o = raw === undefined ? {} : options<{ friction?: number; tone?: Tone }>(raw, 'world.ramp');
      const a = finitePoint(from, 'world.ramp: from');
      const b = finitePoint(to, 'world.ramp: to');
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      if (Math.hypot(dx, dy) < 0.01) throw new SceneApiError('world.ramp needs two different points');
      // A wedge under the slope down to the lower end's height; a nearly flat or upright slope is a slab.
      const [low, high] = a[1] <= b[1] ? [a, b] : [b, a];
      const points: V2[] =
        Math.abs(dx * dy) / 2 > 0.005
          ? [a, b, [high[0], low[1]]]
          : (() => {
              const length = Math.hypot(dx, dy);
              const nx = (dy / length) * 0.1;
              const ny = (-dx / length) * 0.1;
              // The slab hangs below the line (or behind it, for an upright one).
              const below = ny <= 0 ? 1 : -1;
              return [a, b, [b[0] + below * nx, b[1] + below * ny], [a[0] + below * nx, a[1] + below * ny]];
            })();
      const built = polygon(points, 'world.ramp');
      return addBody(
        'ramp',
        { at: [0, 0], fixed: true, ...(o.friction !== undefined ? { friction: o.friction } : {}), ...(o.tone !== undefined ? { tone: o.tone } : {}) },
        'world.ramp',
        () => built,
      );
    },
    spring(a, b, raw) {
      return lineJoint('spring', a, b, raw);
    },
    rope(a, b, raw) {
      return lineJoint('rope', a, b, raw);
    },
    rod(a, b, raw) {
      return lineJoint('rod', a, b, raw);
    },
    hinge(body, at, raw) {
      sync();
      const o = raw === undefined ? {} : options<HingeOptions>(raw, 'world.hinge');
      const b = bodyOf(body, 'world.hinge');
      const pivot = finitePoint(at, 'world.hinge: at');
      const a = o.to === undefined ? null : bodyOf(o.to, 'world.hinge: to');
      if (a === b) throw new SceneApiError('world.hinge: to must be a different body');
      return addJoint(
        'hinge',
        {
          a,
          b,
          anchorA: a ? toLocal(a, pivot[0], pivot[1]) : pivot,
          anchorB: toLocal(b, pivot[0], pivot[1]),
          motor: live<number>(o.motor),
          torque: o.torque,
          name: 'world.hinge',
        },
        undefined,
      );
    },
    pulley(a, b, at, raw) {
      sync();
      const o = raw === undefined ? {} : options<{ r?: number; tone?: Tone }>(raw, 'world.pulley');
      const A = bodyOf(a, 'world.pulley');
      const B = bodyOf(b, 'world.pulley');
      if (A === B) throw new SceneApiError('world.pulley needs two different bodies');
      const wheel = finitePoint(at, 'world.pulley: at');
      const r = o.r === undefined ? 0.15 : finiteNumber(o.r, 'world.pulley: r', (n) => n > 0 && n <= 100, 'a radius above 0 metres');
      return addJoint('pulley', { a: A, b: B, anchorA: [0, 0], anchorB: [0, 0], wheel: { at: wheel, r }, name: 'world.pulley' }, checkTone(o.tone, 'world.pulley'));
    },
    tank(raw) {
      sync();
      const o = options<TankOptions>(raw, 'world.tank');
      if (world.tanks.length >= MAX_TANKS) throw new SceneApiError(`A world holds at most ${MAX_TANKS} tanks`);
      const x = finiteNumber(o.x, 'world.tank: x');
      const w = finiteNumber(o.w, 'world.tank: w', (n) => n > 0 && n <= 1000, 'a width above 0 metres');
      if (o.depth === undefined) throw new SceneApiError('world.tank needs depth: how deep the liquid is, in metres');
      const tank = new Tank({ x, w, depth: live<number>(o.depth)!, h: o.h, density: live<number>(o.density) });
      tank.setup();
      tank.height = o.h === undefined ? Math.max(0.2, tank.depth * 1.5) : finiteNumber(o.h, 'world.tank: h', (n) => n > 0 && n <= 1000, 'a wall height above 0 metres');
      const t = 0.1;
      tank.walls.push(
        wallBody('the tank wall', x - t / 2, tank.height / 2, t, tank.height),
        wallBody('the tank wall', x + w + t / 2, tank.height / 2, t, tank.height),
        wallBody('the tank floor', x + w / 2, -t / 2, w + 2 * t, t),
      );
      world.tanks.push(tank);
      world.updateLevels();
      const outline = painter.tank(tank, checkTone(o.tone, 'world.tank'));
      for (const wall of tank.walls) {
        wall.handle = handleFor(wall, outline);
        bodies.set(wall.handle, wall);
      }
      const handle: Tank2D = {
        get level() {
          return tank.level;
        },
        get displaced() {
          return tank.displaced;
        },
        buoyancy(body: Body2D) {
          const target = bodyOf(body, 'tank.buoyancy');
          return tank.density * world.settings.gravity() * tank.submerged(target).area;
        },
      };
      return handle;
    },
    field(force) {
      if (typeof force !== 'function') throw new SceneApiError('world.field needs a function (body) => [fx, fy] in newtons');
      if (world.fields.length >= MAX_FIELDS) throw new SceneApiError(`A world has at most ${MAX_FIELDS} fields`);
      world.fields.push((body) => {
        const result = force(body.handle);
        if (result === undefined || result === null) return;
        const [fx, fy] = finitePoint(result, 'world.field: the force it returns');
        body.apply('applied', fx, fy);
      });
    },
    forces(body, raw) {
      const target = bodyOf(body, 'world.forces');
      const o = raw === undefined ? {} : options<ForceArrowOptions>(raw, 'world.forces');
      if (arrowSets >= MAX_ARROW_SETS) throw new SceneApiError(`At most ${MAX_ARROW_SETS} bodies show their forces`);
      if (o.show !== undefined && (!Array.isArray(o.show) || o.show.length === 0 || !o.show.every(isForceKind))) {
        throw new SceneApiError('world.forces: show must list kinds of force: gravity, normal, friction, tension, spring, buoyancy, drag, electric, magnetic, applied or net');
      }
      if (o.scale !== undefined) finiteNumber(o.scale, 'world.forces: scale', (n) => n > 0, 'stage units per newton, above 0');
      checkFlag(o.components, 'world.forces: components');
      if (o.labels !== undefined) checkFlag(o.labels, 'world.forces: labels');
      arrowSets++;
      painter.forces(target, o);
    },
    onHit(callback) {
      if (typeof callback !== 'function') throw new SceneApiError('world.onHit needs a function (a, b, speed) => ...');
      if (hitCallbacks.length >= MAX_CALLBACKS) throw new SceneApiError(`At most ${MAX_CALLBACKS} onHit callbacks`);
      hitCallbacks.push(callback);
    },
    onTouch(sensor, callback) {
      const target = bodyOf(sensor, 'world.onTouch');
      if (!target.sensor) throw new SceneApiError('world.onTouch needs a body made with sensor: true');
      if (typeof callback !== 'function') throw new SceneApiError('world.onTouch needs a function (body) => ...');
      if (touchCallbacks.length >= MAX_CALLBACKS) throw new SceneApiError(`At most ${MAX_CALLBACKS} onTouch callbacks`);
      touchCallbacks.push({ sensor: target, callback });
    },
    energy(): Energy {
      return Object.freeze(world.energy());
    },
    restart() {
      sync();
      restartWorld();
    },
    toStage(p) {
      const [x, y] = finitePoint(p, 'world.toStage');
      return view.toStage(x, y);
    },
    get time() {
      return world.time;
    },
    stage: ctx.stage,
  };
  // Bodies start where their options put them; the first frame draws them there.
  painter.draw();
  return api;
}

export const kit: KitModule = {
  name: 'physics2d',
  calls: {
    physics2d: {
      layout: (raw) => ({ viewBox: checkViewBox(options<Physics2DOptions>(raw, 'inc.physics2d').viewBox) }),
      create: (ctx, raw) => createWorld(ctx, raw as Physics2DOptions),
    },
  },
};

