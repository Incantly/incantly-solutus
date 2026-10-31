import { describe, expect, it } from 'vitest';
import type { Anatomy, Animal, Inc, SkeletonSpec } from '../src/api/types';
import { kit } from '../src/kits/anatomy';
import { pieceNamed, placeFoot, readBody } from '../src/kits/anatomy/anatomy';
import { GAIT_RULES, planGait } from '../src/kits/anatomy/gait';
import { readPosture, readSkeleton } from '../src/kits/anatomy/skeleton';
import { kitsFor } from '../src/runtime/kits';
import { SceneRuntime } from '../src/runtime/runtime';
import type { VNode } from '../src/scene/graph';
import { validateSceneJs } from '../src/validation/js';

/** Bones for the tests, measured as a scene would measure them from each animal's real skeleton. */
const BONES = {
  dog: {
    size: 0.9,
    skull: { length: 0.24, depth: 0.5, snout: 0.5 },
    neck: { length: 0.2 },
    spine: { length: 0.56, flex: 0.45 },
    forelimb: { upper: 0.2, lower: 0.22, foot: 0.12 },
    hindlimb: { upper: 0.23, lower: 0.24, foot: 0.14 },
    tail: { length: 0.45, stiffness: 0.5 },
  },
  cat: {
    size: 0.5,
    skull: { length: 0.17, depth: 0.7, snout: 0.3 },
    neck: { length: 0.13 },
    spine: { length: 0.7, flex: 0.7 },
    forelimb: { upper: 0.2, lower: 0.2, foot: 0.11 },
    hindlimb: { upper: 0.24, lower: 0.26, foot: 0.15 },
    tail: { length: 0.8, stiffness: 0.35 },
  },
  horse: {
    size: 2.4,
    skull: { length: 0.26, depth: 0.38, snout: 0.65 },
    neck: { length: 0.3 },
    spine: { length: 0.44, flex: 0.15 },
    forelimb: { upper: 0.16, lower: 0.2, foot: 0.2 },
    hindlimb: { upper: 0.2, lower: 0.22, foot: 0.24 },
    tail: { length: 0.35, stiffness: 0.3 },
  },
  mouse: {
    size: 0.09,
    skull: { length: 0.3, depth: 0.6, snout: 0.5 },
    neck: { length: 0.08 },
    spine: { length: 0.62, flex: 0.8 },
    forelimb: { upper: 0.12, lower: 0.12, foot: 0.08, posture: 'plantigrade' },
    hindlimb: { upper: 0.17, lower: 0.2, foot: 0.2, posture: 'plantigrade' },
    tail: { length: 1, stiffness: 0.2 },
  },
  cheetah: {
    size: 1.3,
    skull: { length: 0.16, depth: 0.6, snout: 0.35 },
    neck: { length: 0.17 },
    spine: { length: 0.67, flex: 0.95 },
    forelimb: { upper: 0.21, lower: 0.25, foot: 0.13 },
    hindlimb: { upper: 0.25, lower: 0.3, foot: 0.17 },
    tail: { length: 0.6, stiffness: 0.6 },
    tone: 'lit',
  },
  bear: {
    size: 1.9,
    skull: { length: 0.22, depth: 0.6, snout: 0.45 },
    neck: { length: 0.16 },
    spine: { length: 0.62, flex: 0.3 },
    forelimb: { upper: 0.2, lower: 0.17, foot: 0.08 },
    hindlimb: { upper: 0.2, lower: 0.17, foot: 0.13, posture: 'plantigrade' },
    tail: { length: 0.05, stiffness: 1 },
  },
  ape: {
    size: 0.85,
    skull: { length: 0.2, depth: 0.9, snout: 0.25 },
    neck: { length: 0.07 },
    spine: { length: 0.6, flex: 0.2 },
    forelimb: { upper: 0.36, lower: 0.33, foot: 0.14, posture: 'digitigrade' },
    hindlimb: { upper: 0.28, lower: 0.26, foot: 0.16, posture: 'plantigrade' },
    tail: { length: 0 },
    modes: ['quadruped', 'bipedal'],
  },
  human: {
    size: 0.85,
    skull: { length: 0.27, depth: 0.95, snout: 0.1 },
    neck: { length: 0.08 },
    spine: { length: 0.55, flex: 0.1 },
    forelimb: { upper: 0.38, lower: 0.32, foot: 0.12 },
    hindlimb: { upper: 0.52, lower: 0.5, foot: 0.17, posture: 'plantigrade' },
    tail: { length: 0 },
    modes: ['bipedal'],
  },
  bird: {
    size: 0.3,
    skull: { length: 0.22, depth: 0.7, snout: 0.45 },
    neck: { length: 0.22 },
    spine: { length: 0.48, flex: 0.1 },
    hindlimb: { upper: 0.2, lower: 0.3, foot: 0.2 },
    tail: { length: 0.35, stiffness: 0.8 },
    modes: ['bipedal'],
    wings: true,
  },
  lizard: {
    size: 0.3,
    skull: { length: 0.22, depth: 0.45, snout: 0.5 },
    neck: { length: 0.1 },
    spine: { length: 0.68, flex: 0.5 },
    forelimb: { upper: 0.12, lower: 0.12, foot: 0.08, posture: 'plantigrade' },
    hindlimb: { upper: 0.14, lower: 0.14, foot: 0.12, posture: 'plantigrade' },
    tail: { length: 1.3, stiffness: 0.4 },
    stance: 'sprawl',
  },
} satisfies Record<string, SkeletonSpec>;


type Name = keyof typeof BONES;

function run(scene: (inc: Inc) => void, options: { reducedMotion?: boolean } = {}) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { anatomy: kit }, ...options });
  runtime.mount(scene);
  runtime.tick(0);
  return runtime;
}

function play(runtime: SceneRuntime, seconds: number, fps = 60): void {
  runtime.play();
  for (let i = 0; i < Math.round(seconds * fps); i++) runtime.tick(1 / fps);
  runtime.pause();
}

/** An animal on its own stage, with the runtime that runs it. */
function animal(spec: SkeletonSpec | Name, speed?: number) {
  let made: Animal | undefined;
  const runtime = run((inc) => {
    made = inc.anatomy('#a', { title: 'Animal' }).skeleton(typeof spec === 'string' ? BONES[spec] : spec);
    if (speed !== undefined) made.move({ speed });
  });
  return { runtime, animal: made! };
}

const error = (scene: (zoo: Anatomy) => void) => {
  const runtime = new SceneRuntime({ autoplay: false, kits: { anatomy: kit } });
  runtime.mount((inc) => scene(inc.anatomy('#a', { title: 'x' })));
  return runtime.uiState().error?.message ?? '';
};

const nodeOf = (handle: unknown) => (handle as { node: VNode }).node;
const hipOf = (name: Name) => {
  const build = readSkeleton(BONES[name]);
  return { build, hip: build.hind.foot * 0.5 + 0.9 * (build.hind.upper + build.hind.lower) };
};

describe('anatomy: skeletons', () => {
  it('grows every skeleton in the tests without an error, each a group of drawn pieces', () => {
    for (const name of Object.keys(BONES) as Name[]) {
      const { runtime, animal: a } = animal(name);
      expect(runtime.uiState().error, name).toBeNull();
      expect(nodeOf(a.handle).children.length, name).toBeGreaterThan(8);
      expect(nodeOf(a.piece('body')).attrs.get('d'), name).toMatch(/^M/);
    }
  });

  it('reads how each foot meets the ground from its bones, as fossil feet are read', () => {
    expect(readPosture(0.3, 0.27, 0.1)).toBe('plantigrade');
    expect(readPosture(0.23, 0.24, 0.14)).toBe('digitigrade');
    expect(readPosture(0.2, 0.22, 0.24)).toBe('unguligrade');
    expect(animal('dog').animal.posture).toBe('digitigrade');
    expect(animal('horse').animal.posture).toBe('unguligrade');
    expect(animal('human').animal.posture).toBe('plantigrade');
    // A posture the scene gives wins over the one the bones suggest.
    expect(animal({ ...BONES.dog, hindlimb: { upper: 0.23, lower: 0.24, foot: 0.14, posture: 'plantigrade' } }).animal.posture).toBe('plantigrade');
  });

  it('builds runners light below the knee and heavy above it', () => {
    const cheetah = readBody(readSkeleton(BONES.cheetah));
    const bear = readBody(readSkeleton(BONES.bear));
    expect(cheetah.runner).toBeGreaterThan(bear.runner);
    expect(cheetah.kneeR / cheetah.thighR).toBeLessThan(bear.kneeR / bear.thighR);
    // A runner's waist tucks up between its chest and haunch.
    expect(cheetah.waistR / Math.min(cheetah.chestR, cheetah.pelvisR)).toBeLessThan(bear.waistR / Math.min(bear.chestR, bear.pelvisR));
  });

  it('takes the bones on their own, with no example', () => {
    const { runtime, animal: a } = animal({
      size: 1.3,
      skull: { length: 0.18 },
      spine: { length: 0.75, flex: 0.9 },
      forelimb: { upper: 0.22, lower: 0.26, foot: 0.12 },
      hindlimb: { upper: 0.27, lower: 0.31, foot: 0.17 },
      tail: { length: 0.65 },
    });
    expect(runtime.uiState().error).toBeNull();
    expect(a.mode).toBe('quadruped');
    expect(a.gait).toBe('stand');
  });

  it('refuses a skeleton it cannot read, saying what is wrong', () => {
    // The kit holds no animals: a name instead of bones is refused.
    expect(error((zoo) => zoo.skeleton('unicorn' as never))).toContain('give the bones, not a name');
    expect(error((zoo) => zoo.skeleton({ size: 1 }))).toContain('needs a hindlimb');
    expect(error((zoo) => zoo.skeleton({ ...BONES.dog, spine: { length: 0.5, flex: 2 } }))).toContain('spine.flex is a number from 0 to 1');
    // Soft parts are the scene's to draw, not a list of switches.
    expect(error((zoo) => zoo.skeleton({ ...BONES.dog, hints: { ears: 'floppy' } } as never))).toContain('draw ears, coats, manes and markings yourself');
    expect(error((zoo) => zoo.skeleton({ ...BONES.dog, mane: true } as never))).toContain('a skeleton has no "mane"');
    expect(error((zoo) => zoo.skeleton({ ...BONES.mouse, modes: ['quadruped', 'bipedal'] }))).toContain('too short to walk on two legs');
    expect(error((zoo) => zoo.skeleton({ ...BONES.bird, modes: ['quadruped'] }))).toContain('no forelimbs to stand on');
    expect(error((zoo) => zoo.skeleton(BONES.dog).move({ speed: -1 }))).toContain('speed is metres a second');
    expect(error((zoo) => zoo.skeleton(BONES.dog).move({ mode: 'bipedal' }))).toContain('this skeleton moves quadruped');
    expect(error((zoo) => zoo.skeleton(BONES.human).piece('tail'))).toContain('no tail');
    expect(
      error((zoo) => {
        for (let i = 0; i < 7; i++) zoo.skeleton(BONES.mouse);
      }),
    ).toContain('at most 6 animals');
  });
});

describe('anatomy: gaits', () => {
  it('changes gait at the same dimensionless speeds whatever the size', () => {
    const dog = animal('dog').animal;
    const gaitAt = (speed: number) => {
      const { animal: a } = animal('dog', speed);
      return a.gait;
    };
    expect(dog.gait).toBe('stand');
    expect(gaitAt(1)).toBe('walk');
    expect(gaitAt(3)).toBe('trot');
    expect(gaitAt(10)).toBe('gallop');
    const { build, hip } = hipOf('horse');
    // A horse trots at speeds where a small dog would gallop: the Froude number, not the speed, decides.
    expect(planGait(build, 'quadruped', 4, hip).gait).toBe('trot');
    expect(planGait(build, 'quadruped', Math.sqrt(GAIT_RULES.trotToGallop * 9.81 * hip) * 1.1, hip).gait).toBe('gallop');
  });

  it('bounds a small, crouched body and gallops round the body with a flexible spine', () => {
    expect(animal('mouse', 1.5).animal.gait).toBe('bound');
    const cheetah = hipOf('cheetah');
    const horse = hipOf('horse');
    const rotary = planGait(cheetah.build, 'quadruped', 20, cheetah.hip);
    const transverse = planGait(horse.build, 'quadruped', 12, horse.hip);
    expect(rotary.gait).toBe('gallop');
    expect(transverse.gait).toBe('gallop');
    // Rotary: the fore feet land in the opposite order to the hind (right fore before left fore).
    expect(rotary.phases[3]).toBeLessThan(rotary.phases[1]);
    expect(transverse.phases[1]).toBeLessThan(transverse.phases[3]);
    expect(rotary.bends && transverse.bends).toBe(true);
  });

  it('takes shorter, quicker strides on shorter legs at the same Froude number', () => {
    const mouse = hipOf('mouse');
    const horse = hipOf('horse');
    const froude = 1.5;
    const at = (h: number) => Math.sqrt(froude * 9.81 * h);
    const small = planGait(mouse.build, 'quadruped', at(mouse.hip), mouse.hip);
    const large = planGait(horse.build, 'quadruped', at(horse.hip), horse.hip);
    expect(small.froude).toBeCloseTo(large.froude, 6);
    expect(small.stride).toBeLessThan(large.stride);
    expect(small.frequency).toBeGreaterThan(large.frequency * 3);
    // Stride over hip height is the same for both: dynamic similarity.
    expect(small.stride / mouse.hip).toBeCloseTo(large.stride / horse.hip, 6);
  });

  it('keeps each foot on the ground less of the stride as it speeds up, and leaves the ground at a gallop', () => {
    const { build, hip } = hipOf('dog');
    const duties = [1, 3, 6, 10].map((v) => planGait(build, 'quadruped', v, hip).duty);
    for (let i = 1; i < duties.length; i++) expect(duties[i]).toBeLessThan(duties[i - 1]!);
    expect(planGait(build, 'quadruped', 1, hip).airborne).toBe(0);
    expect(planGait(build, 'quadruped', 10, hip).airborne).toBeGreaterThan(0.1);
  });

  it('never plants a foot further than its leg can sweep, so feet never slide', () => {
    for (const name of ['dog', 'cheetah', 'horse', 'mouse'] as const) {
      const { build, hip } = hipOf(name);
      for (const speed of [0.5, 2, 5, 12, 30]) {
        const plan = planGait(build, 'quadruped', speed, hip);
        const reach = Math.min(build.hind.upper + build.hind.lower, build.fore!.upper + build.fore!.lower) * GAIT_RULES.stanceReach;
        expect(plan.stride * plan.duty, `${name} at ${speed}`).toBeLessThanOrEqual(reach + 1e-9);
      }
    }
  });

  it('moves a planted foot back exactly as fast as the ground passes', () => {
    const { build, hip } = hipOf('dog');
    const plan = planGait(build, 'quadruped', 3, hip);
    for (let leg = 0; leg < 4; leg++) {
      let ground: number | null = null;
      for (let i = 0; i <= 400; i++) {
        const p = i / 400;
        const foot = placeFoot(plan, leg, p, 0.1);
        // The ground has moved back one stride per stride; a planted foot keeps its place on it.
        const onGround = foot.x + plan.stride * p;
        if (foot.planted && foot.progress > 0.001 && foot.progress < 0.999) {
          if (ground === null) ground = onGround;
          expect(onGround, `leg ${leg} at ${p}`).toBeCloseTo(ground, 9);
        } else if (!foot.planted) {
          ground = null;
          expect(foot.lift).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('anatomy: moving and showing', () => {
  it('reads its speed from a parameter, and its readouts from the gait it moves in', () => {
    let dog: Animal | undefined;
    const runtime = run((inc) => {
      const speed = inc.param('speed', { min: 0, max: 14, value: 1 });
      dog = inc.anatomy('#a', { title: 'Dog' }).skeleton(BONES.dog);
      dog.move({ speed });
    });
    expect(dog!.gait).toBe('walk');
    expect(dog!.speed).toBe(1);
    runtime.setParam('speed', 10);
    runtime.tick(0);
    expect(dog!.gait).toBe('gallop');
    expect(dog!.stride).toBeGreaterThan(1);
    expect(dog!.frequency).toBeGreaterThan(1);
    expect(dog!.froude).toBeGreaterThan(GAIT_RULES.trotToGallop);
  });

  it('draws the same frames on every run', () => {
    const frames = () => {
      let dog: Animal | undefined;
      const runtime = run((inc) => {
        dog = inc.anatomy('#a', { title: 'Dog' }).skeleton(BONES.dog);
        dog.move({ speed: 6 });
      });
      play(runtime, 1.3);
      return [nodeOf(dog!.piece('hindlimbs')).attrs.get('d'), nodeOf(dog!.piece('body')).attrs.get('d')];
    };
    expect(frames()).toEqual(frames());
  });

  it('moves its legs while playing and holds still when paused', () => {
    let dog: Animal | undefined;
    const runtime = run((inc) => {
      dog = inc.anatomy('#a', { title: 'Dog' }).skeleton(BONES.dog);
      dog.move({ speed: 3 });
    });
    const legs = () => nodeOf(dog!.piece('hindlimbs')).attrs.get('d');
    const before = legs();
    play(runtime, 0.2);
    const after = legs();
    expect(after).not.toEqual(before);
    runtime.tick(0.5);
    expect(legs()).toEqual(after);
  });

  it('holds still under reduced motion', () => {
    let dog: Animal | undefined;
    const runtime = run(
      (inc) => {
        dog = inc.anatomy('#a', { title: 'Dog' }).skeleton(BONES.dog);
        dog.move({ speed: 3 });
      },
      { reducedMotion: true },
    );
    const before = nodeOf(dog!.piece('hindlimbs')).attrs.get('d');
    play(runtime, 0.5);
    expect(nodeOf(dog!.piece('hindlimbs')).attrs.get('d')).toEqual(before);
  });

  it('stands up on two legs at the time it is told, if its skeleton allows', () => {
    let ape: Animal | undefined;
    const runtime = run((inc) => {
      ape = inc.anatomy('#a', { title: 'Ape' }).skeleton(BONES.ape);
      ape.move({ speed: 1, mode: 'bipedal', at: 1 });
    });
    expect(ape!.mode).toBe('quadruped');
    const quadHip = ape!.hipHeight;
    play(runtime, 0.5);
    expect(ape!.mode).toBe('quadruped');
    play(runtime, 2.5);
    expect(ape!.mode).toBe('bipedal');
    expect(['walk', 'run']).toContain(ape!.gait);
    expect(ape!.hipHeight).not.toBe(quadHip);
    expect(runtime.uiState().error).toBeNull();
  });

  it('takes move every frame without slowing down', () => {
    // A generated scene called move({ speed, mode, at }) in onFrame: the mode schedule grew each frame until frames took 20 ms.
    let ape: Animal | undefined;
    const runtime = run((inc) => {
      ape = inc.anatomy('#a', { title: 'Ape' }).skeleton(BONES.ape);
      inc.onFrame((f) => ape!.move({ speed: 1, mode: 'quadruped', at: f.time }));
    });
    play(runtime, 10);
    expect((ape as unknown as { schedule: unknown[] }).schedule.length).toBeLessThanOrEqual(2);
    expect(ape!.mode).toBe('quadruped');
    expect(runtime.uiState().error).toBeNull();
  });

  it('stands up when its posture changes while paused, as any change does (PRD 21.1)', () => {
    let ape: Animal | undefined;
    const runtime = run((inc) => {
      inc.choice('posture', { options: ['On all fours', 'On two legs'] });
      const model = inc.model(({ posture }) => ({ mode: posture === 1 ? 'bipedal' : 'quadruped' }));
      ape = inc.anatomy('#a', { title: 'Ape' }).skeleton(BONES.ape);
      ape.move({ speed: 1, mode: () => model.mode as 'bipedal' | 'quadruped' });
    });
    const body = () => nodeOf(ape!.piece('body')).attrs.get('d');
    const before = body();
    const hip = ape!.hipHeight;
    runtime.setParam('posture', 1);
    for (let i = 0; i < 90; i++) runtime.tick(1 / 60);
    expect(ape!.mode).toBe('bipedal');
    expect(ape!.hipHeight).not.toBe(hip);
    expect(body()).not.toEqual(before);
    expect(runtime.time).toBe(0);
  });

  it('shows its muscles or its bones under a faded skin', () => {
    const { runtime, animal: dog } = animal('dog');
    // The skin fades as a layer: the body's opacity is set on the group it is drawn in.
    const fade = () => {
      let id: number | null = nodeOf(dog.piece('body')).parent;
      while (id !== null) {
        const node = runtime.graph.nodes.get(id)!;
        if (node.attrs.has('opacity')) return Number(node.attrs.get('opacity'));
        id = node.parent;
      }
      return 1;
    };
    const hidden = (piece: 'muscles' | 'bones') => nodeOf(dog.piece(piece)).hidden;
    expect(hidden('muscles')).toBe(true);
    expect(hidden('bones')).toBe(true);
    dog.show('bones');
    expect(hidden('bones')).toBe(false);
    expect(hidden('muscles')).toBe(true);
    expect(fade()).toBeLessThan(0.5);
    dog.show('skin');
    expect(fade()).toBe(1);
  });

  it('lets the scene draw the skin that makes a breed, on bones that move it', () => {
    let dog: Animal | undefined;
    let ear: unknown;
    let saddle: unknown;
    const runtime = run((inc) => {
      dog = inc.anatomy('#a', { title: 'Shepherd' }).skeleton(BONES.dog);
      dog.move({ speed: 3 });
      // A tall pointed ear in place of the plain one, a black saddle on the back, a longer muzzle and whiskers.
      ear = dog.skin('ear', { points: [[0, -0.05], [0.12, 0.7], [0.3, 0.02]], as: 'part', replace: true });
      saddle = dog.skin('spine', { points: [[0.1, 0.05], [0.9, 0.05], [0.8, -0.3], [0.2, -0.35]], as: 'mark' });
      dog.skin('skull', { points: [[0.6, 0.1], [1.15, -0.05], [1.1, -0.25], [0.6, -0.3]] });
      dog.skin('skull', { points: [[0.95, -0.15], [1.4, -0.05]], as: 'line' });
      dog.skin('thigh', { at: [0.4, 0], r: [0.4, 0.3], as: 'mark', tone: 'lo' });
    });
    expect(runtime.uiState().error).toBeNull();
    const d = (h: unknown) => nodeOf(h).attrs.get('d') ?? '';
    // A part has its own outline and fill; a mark only a fill.
    expect(d(ear)).toMatch(/^M.*C/);
    expect(d(saddle)).toMatch(/Z$/);
    // The plain ear is gone, and the skin moves with the animal.
    const before = [d(ear), d(saddle)];
    play(runtime, 0.3);
    expect([d(ear), d(saddle)]).not.toEqual(before);
    // Skin on a leg is drawn on the near side and the far side.
    const marks = [...runtime.graph.nodes.values()].filter((n) => n.tone === 'lo' && n.fill && (n.attrs.get('d') ?? '').length > 0);
    expect(marks.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps skin on its bone, and refuses skin it cannot draw', () => {
    expect(error((zoo) => zoo.skeleton(BONES.dog).skin('wing', { at: [0.5, 0], r: 0.2 }))).toContain('no wing');
    expect(error((zoo) => zoo.skeleton(BONES.human).skin('tail', { at: [0.5, 0], r: 0.2 }))).toContain('no tail');
    expect(error((zoo) => zoo.skeleton(BONES.dog).skin('ankle' as never, { at: [0.5, 0], r: 0.2 }))).toContain('there is no bone "ankle"');
    expect(error((zoo) => zoo.skeleton(BONES.dog).skin('skull', { points: [[0, 0], [5, 0], [0, 1]] }))).toContain('would float off');
    expect(error((zoo) => zoo.skeleton(BONES.dog).skin('skull', { points: [[0, 0], [1, 0]] }))).toContain('points is a list of 3');
    expect(error((zoo) => zoo.skeleton(BONES.dog).skin('skull', { at: [0, 0], r: 0.1, as: 'fur' as 'mark' }))).toContain('as is flesh, part, mark, line');
  });

  it('bends skin drawn along a leg round the knee, instead of cracking', async () => {
    const { onFrame } = await import('../src/kits/anatomy/anatomy');
    const knee = { points: [[0, 1], [0, 0], [1, 0]] as Array<readonly [number, number]>, flip: false };
    // At the knee, skin across the leg sits on the bisector of the two bones' sides, not on either one.
    const [x, y] = onFrame(knee, 0.5, 0.1);
    expect(x).toBeCloseTo(0.2 / Math.SQRT2, 6);
    expect(y).toBeCloseTo(0.2 / Math.SQRT2, 6);
    // Toward the end of the second bone, across has turned to its left: up from a bone running right.
    const [, end] = onFrame(knee, 1, 0.1);
    expect(end).toBeCloseTo(0.2, 6);
    expect(onFrame(knee, 0.75, 0.1)[1]).toBeGreaterThan(y);
  });

  it('names an animal or its pieces as parts', () => {
    const runtime = run((inc) => {
      const zoo = inc.anatomy('#a', { title: 'Dog' });
      const dog = zoo.skeleton(BONES.dog);
      zoo.part('Dog', dog, { label: 'Dog' });
      zoo.part('Hind legs', dog.piece('hindlimbs'));
    });
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Dog', 'Hind legs']);
  });
});

describe('anatomy: a stage of several animals, and forgiving calls', () => {
  /** How wide a path draws, from the x of its points. */
  const spanOf = (d: string | undefined) => {
    const xs = [...(d ?? '').matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => Number(m[1]));
    return Math.max(...xs) - Math.min(...xs);
  };
  const middleOf = (d: string | undefined) => {
    const xs = [...(d ?? '').matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => Number(m[1]));
    return (Math.max(...xs) + Math.min(...xs)) / 2;
  };

  it('draws every animal on a stage at one scale, side by side when the scene gives no place', () => {
    // A Shire came out smaller than an Arabian when each animal was scaled to fill its own room.
    let shire: Animal | undefined;
    let arabian: Animal | undefined;
    run((inc) => {
      const zoo = inc.anatomy('#a', { title: 'Horses', viewBox: [0, 0, 800, 400] });
      shire = zoo.skeleton({ ...BONES.horse, size: 2.1 });
      arabian = zoo.skeleton({ ...BONES.horse, size: 1.5 });
    });
    const big = nodeOf(shire!.piece('body')).attrs.get('d');
    const small = nodeOf(arabian!.piece('body')).attrs.get('d');
    expect(spanOf(big) / spanOf(small)).toBeCloseTo(2.1 / 1.5, 1);
    // Side by side: the first stands on the left half of the stage, the second on the right.
    expect(middleOf(big)).toBeLessThan(400);
    expect(middleOf(small)).toBeGreaterThan(400);
  });

  it('names a piece by its bone or an everyday word, as well as by its own name', () => {
    expect(pieceNamed('hindlimbs')).toBe('hindlimbs');
    expect(pieceNamed('front left leg')).toBe('forelimbs');
    expect(pieceNamed('forelimb left')).toBe('forelimbs');
    expect(pieceNamed('back_leg')).toBe('hindlimbs');
    expect(pieceNamed('hindleg')).toBe('hindlimbs');
    expect(pieceNamed('spine')).toBe('body');
    expect(pieceNamed('skull')).toBe('head');
    expect(pieceNamed('trunk')).toBe('head');
    expect(pieceNamed('mane')).toBe('neck');
    expect(pieceNamed('wing')).toBe('forelimbs');
    expect(pieceNamed('banana')).toBeNull();
    expect(error((zoo) => zoo.skeleton(BONES.dog).piece('banana' as never))).toContain('there is no piece "banana"');
  });

  it('lets several names for one piece each be a part a step can focus', () => {
    // An elephant named "hind left leg" and "hind right leg": both meant the hind legs, the second name replaced
    // the first on the one element, and the step that focused the first failed at mount.
    const runtime = run((inc) => {
      const zoo = inc.anatomy('#a', { title: 'Elephant' });
      const elephant = zoo.skeleton(BONES.horse);
      for (const name of ['hind left leg', 'hind right leg', 'left foot', 'hindlimbs']) zoo.part(name, elephant.piece(name));
      // The same name asked again is the same handle, so asking every frame makes nothing new.
      inc.onFrame(() => elephant.piece('hind left leg'));
      inc.steps([{ say: 'One hind leg.', focus: 'hind left leg' }, { say: 'The other.', focus: 'hind right leg' }]);
    });
    expect(runtime.uiState().error).toBeNull();
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['hind left leg', 'hind right leg', 'left foot', 'hindlimbs']);
    const size = runtime.graph.nodes.size;
    play(runtime, 0.5);
    expect(runtime.graph.nodes.size).toBe(size);
  });

  it('moves in a gait the scene asks for, and raises or lowers the neck, both live while paused', () => {
    let dog: Animal | undefined;
    const runtime = run((inc) => {
      const gait = inc.choice('gait', { options: ['walk', 'gallop'] });
      const neck = inc.param('neck', { min: -40, max: 40, value: 0 });
      dog = inc.anatomy('#a', { title: 'Dog' }).skeleton(BONES.dog);
      dog.move({ speed: 2, gait: () => (gait.value === 1 ? 'gallop' : 'walk'), neck });
    });
    expect(dog!.gait).toBe('walk');
    const head = () => nodeOf(dog!.piece('head')).attrs.get('d');
    const before = head();
    runtime.setParam('neck', 30);
    runtime.tick(0);
    expect(head()).not.toEqual(before);
    runtime.setParam('gait', 1);
    runtime.tick(0);
    expect(dog!.gait).toBe('gallop');
    expect(error((zoo) => zoo.skeleton(BONES.dog).move({ gait: 'canter' as 'walk' }))).toContain('gait is stand, walk, trot, gallop, bound, run');
    expect(error((zoo) => zoo.skeleton(BONES.dog).move({ neck: 90 }))).toContain('neck is degrees, from -60 to 60');
  });
});

describe('anatomy: validation', () => {
  it('loads the kit only for scenes that call inc.anatomy', () => {
    expect(kitsFor(['anatomy'])).toEqual(['anatomy']);
    const result = validateSceneJs("const zoo = inc.anatomy('#stage', { title: 'Dog' });\nconst dog = zoo.skeleton({ size: 0.9, hindlimb: { upper: 0.23, lower: 0.24, foot: 0.14 }, forelimb: { upper: 0.2, lower: 0.22, foot: 0.12 } });\ndog.move({ speed: 3 });\ninc.describe(() => dog.gait);");
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.info.kits).toEqual(['anatomy']);
  });

  it('refuses a skeleton made in the frame loop, where it would be made again each frame', () => {
    const result = validateSceneJs("const zoo = inc.anatomy('#stage', { title: 'Dog' });\ninc.onFrame(() => { zoo.skeleton({ size: 0.9, hindlimb: { upper: 0.23, lower: 0.24, foot: 0.14 }, forelimb: { upper: 0.2, lower: 0.22, foot: 0.12 } }); });");
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
