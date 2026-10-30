import { describe, expect, it } from 'vitest';
import type { Anatomy, Animal, ExampleSkeleton, Inc } from '../src/api/types';
import { kit } from '../src/kits/anatomy';
import { placeFoot, readBody } from '../src/kits/anatomy/anatomy';
import { GAIT_RULES, planGait } from '../src/kits/anatomy/gait';
import { EXAMPLES, readPosture, readSkeleton } from '../src/kits/anatomy/skeleton';
import { kitsFor } from '../src/runtime/kits';
import { SceneRuntime } from '../src/runtime/runtime';
import type { VNode } from '../src/scene/graph';
import { validateSceneJs } from '../src/validation/js';

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
function animal(spec: Parameters<Anatomy['skeleton']>[0], changes?: Parameters<Anatomy['skeleton']>[1], speed?: number) {
  let made: Animal | undefined;
  const runtime = run((inc) => {
    made = inc.anatomy('#a', { title: 'Animal' }).skeleton(spec, changes);
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
const hipOf = (name: ExampleSkeleton) => {
  const build = readSkeleton(name);
  return { build, hip: build.hind.foot * 0.5 + 0.9 * (build.hind.upper + build.hind.lower) };
};

describe('anatomy: skeletons', () => {
  it('grows every example skeleton without an error, each a group of drawn pieces', () => {
    for (const name of Object.keys(EXAMPLES) as ExampleSkeleton[]) {
      const { runtime, animal: a } = animal(name);
      expect(runtime.uiState().error, name).toBeNull();
      expect(nodeOf(a.handle).children.length, name).toBeGreaterThan(15);
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
    expect(animal('dog', { hindlimb: { upper: 0.23, lower: 0.24, foot: 0.14, posture: 'plantigrade' } }).animal.posture).toBe('plantigrade');
  });

  it('builds runners light below the knee and heavy above it', () => {
    const cheetah = readBody(readSkeleton('cheetah'));
    const bear = readBody(readSkeleton('bear'));
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
    expect(error((zoo) => zoo.skeleton('unicorn' as ExampleSkeleton))).toContain('there is no example skeleton "unicorn"');
    expect(error((zoo) => zoo.skeleton({ size: 1 }))).toContain('needs a hindlimb');
    expect(error((zoo) => zoo.skeleton('dog', { spine: { length: 0.5, flex: 2 } }))).toContain('spine.flex is a number from 0 to 1');
    expect(error((zoo) => zoo.skeleton('dog', { hints: { ears: 'huge' as 'small' } }))).toContain('hints.ears is');
    expect(error((zoo) => zoo.skeleton('dog', { wings: true } as never))).toContain('a skeleton has no "wings"');
    expect(error((zoo) => zoo.skeleton('mouse', { modes: ['quadruped', 'bipedal'] }))).toContain('too short to walk on two legs');
    expect(error((zoo) => zoo.skeleton('bird', { modes: ['quadruped'] }))).toContain('no forelimbs to stand on');
    expect(error((zoo) => zoo.skeleton('dog').move({ speed: -1 }))).toContain('speed is metres a second');
    expect(error((zoo) => zoo.skeleton('dog').move({ mode: 'bipedal' }))).toContain('this skeleton moves quadruped');
    expect(error((zoo) => zoo.skeleton('human').piece('tail'))).toContain('no tail');
    expect(
      error((zoo) => {
        for (let i = 0; i < 7; i++) zoo.skeleton('mouse');
      }),
    ).toContain('at most 6 animals');
  });
});

describe('anatomy: gaits', () => {
  it('changes gait at the same dimensionless speeds whatever the size', () => {
    const dog = animal('dog').animal;
    const gaitAt = (speed: number) => {
      const { animal: a } = animal('dog', undefined, speed);
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
    expect(animal('mouse', undefined, 1.5).animal.gait).toBe('bound');
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
    for (const name of ['dog', 'cheetah', 'horse', 'mouse'] as ExampleSkeleton[]) {
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
      dog = inc.anatomy('#a', { title: 'Dog' }).skeleton('dog');
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
        dog = inc.anatomy('#a', { title: 'Dog' }).skeleton('dog');
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
      dog = inc.anatomy('#a', { title: 'Dog' }).skeleton('dog');
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
        dog = inc.anatomy('#a', { title: 'Dog' }).skeleton('dog');
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
      ape = inc.anatomy('#a', { title: 'Ape' }).skeleton('ape');
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

  it('shows its muscles or its bones under a faded skin', () => {
    const { animal: dog } = animal('dog');
    const hidden = (piece: 'muscles' | 'bones') => nodeOf(dog.piece(piece)).hidden;
    expect(hidden('muscles')).toBe(true);
    expect(hidden('bones')).toBe(true);
    dog.show('bones');
    expect(hidden('bones')).toBe(false);
    expect(hidden('muscles')).toBe(true);
    expect(Number(nodeOf(dog.piece('body')).attrs.get('opacity'))).toBeLessThan(0.5);
    dog.show('skin');
    expect(Number(nodeOf(dog.piece('body')).attrs.get('opacity'))).toBe(1);
  });

  it('names an animal or its pieces as parts', () => {
    const runtime = run((inc) => {
      const zoo = inc.anatomy('#a', { title: 'Dog' });
      const dog = zoo.skeleton('dog');
      zoo.part('Dog', dog, { label: 'Dog' });
      zoo.part('Hind legs', dog.piece('hindlimbs'));
    });
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Dog', 'Hind legs']);
  });
});

describe('anatomy: validation', () => {
  it('loads the kit only for scenes that call inc.anatomy', () => {
    expect(kitsFor(['anatomy'])).toEqual(['anatomy']);
    const result = validateSceneJs("const zoo = inc.anatomy('#stage', { title: 'Dog' });\nconst dog = zoo.skeleton('dog');\ndog.move({ speed: 3 });\ninc.describe(() => dog.gait);");
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.info.kits).toEqual(['anatomy']);
  });

  it('refuses a skeleton made in the frame loop, where it would be made again each frame', () => {
    const result = validateSceneJs("const zoo = inc.anatomy('#stage', { title: 'Dog' });\ninc.onFrame(() => { zoo.skeleton('dog'); });");
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
