import { describe, expect, it } from 'vitest';
import type { Biology, Cell, Helix, Inc, Membrane, Stream } from '../src/api/types';
import { kit } from '../src/kits/biology';
import { isKitModule, KIT_GLOBAL, type KitModule } from '../src/runtime/kits';
import { SceneRuntime } from '../src/runtime/runtime';
import { KIT_SCRIPTS } from '../src/sandbox/generated/kit-scripts';
import { SHARED_GLOBAL, SHARED_MODULES } from '../src/sandbox/kit-shared';
import type { VNode } from '../src/scene/graph';
import { validateSceneJs } from '../src/validation/js';

function run(scene: (inc: Inc) => void, biology: KitModule = kit) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { biology } });
  const mount = runtime.mount(scene);
  runtime.tick(0);
  return { runtime, mount };
}

function play(runtime: SceneRuntime, seconds: number, fps = 60): void {
  runtime.play();
  for (let i = 0; i < Math.round(seconds * fps); i++) runtime.tick(1 / fps);
  runtime.pause();
}

const all = (runtime: SceneRuntime) => [...runtime.graph.nodes.values()];
const nodeOf = (handle: unknown) => (handle as { node: VNode }).node;
const error = (scene: (bio: Biology) => void) => {
  const runtime = new SceneRuntime({ autoplay: false, kits: { biology: kit } });
  runtime.mount((inc) => scene(inc.biology('#b', { title: 'x' })));
  return runtime.uiState().error?.message ?? '';
};

describe('cells', () => {
  it('draws each kind with its own organelles, each a group a part can name', () => {
    const cells: Cell[] = [];
    const { runtime } = run((inc) => {
      const bio = inc.biology('#b', { title: 'Cells', viewBox: [0, 0, 900, 400] });
      cells.push(bio.cell(150, 200), bio.cell(450, 200, { kind: 'plant' }), bio.cell(750, 200, { kind: 'bacterium', size: 200 }));
      bio.stage.part('Nucleus', cells[0]!.organelle('nucleus'), { label: 'Nucleus', info: 'It holds the DNA.' });
      bio.stage.part('Chloroplasts', cells[1]!.organelle('chloroplasts'), { label: 'Chloroplasts' });
    });
    const [animal, plant, bacterium] = cells;
    expect(animal!.organelles).toEqual(['cytoplasm', 'membrane', 'er', 'golgi', 'mitochondria', 'ribosomes', 'nucleus', 'nucleolus']);
    expect(plant!.organelles).toContain('vacuole');
    expect(plant!.organelles).toContain('wall');
    // Plant cells have an ER and a Golgi too: twice a plant scene asked for its ER and threw.
    expect(plant!.organelles).toEqual(expect.arrayContaining(['er', 'golgi']));
    expect(nodeOf(plant!.organelle('er')).children).toHaveLength(3);
    expect(nodeOf(plant!.organelle('golgi')).children).toHaveLength(4);
    expect(bacterium!.organelles).toEqual(['flagellum', 'wall', 'cytoplasm', 'membrane', 'nucleoid', 'plasmids', 'ribosomes']);
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Nucleus', 'Chloroplasts']);
    // Three mitochondria in the animal cell, each a capsule with its folds.
    expect(nodeOf(animal!.organelle('mitochondria')).children).toHaveLength(6);
    expect(runtime.uiState().error).toBeNull();
  });

  it('names a cell or an organelle as a part through bio.part, as on the stage', () => {
    const { runtime } = run((inc) => {
      const bio = inc.biology('#b', { title: 'Cell' });
      const cell = bio.cell(320, 200);
      bio.part('Animal cell', cell);
      bio.part('Nucleus', cell.organelle('nucleus'), { info: 'It holds the DNA.' });
    });
    expect(runtime.uiState().error).toBeNull();
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Animal cell', 'Nucleus']);
  });

  it('places an organelle where the cell is, and moves with it', () => {
    let cell: Cell | null = null;
    run((inc) => {
      cell = inc.biology('#b', { title: 'Cell' }).cell(320, 200, { size: 300 });
    });
    const c = cell! as Cell;
    const [x, y] = c.where('nucleus');
    expect(x).toBeLessThan(320);
    c.at(100, 100);
    const [nx, ny] = c.where('nucleus');
    expect(nx).toBeCloseTo(x - 220, 9);
    expect(ny).toBeCloseTo(y - 100, 9);
    expect(nodeOf(c.handle).transform).toMatchObject({ tx: 100, ty: 100 });
  });

  it('draws only the organelles asked for, and the same outline for the same seed', () => {
    const outline = (seed: number) => {
      const { runtime } = run((inc) => {
        inc.biology('#b', { title: 'Cell' }).cell(320, 200, { organelles: ['membrane', 'nucleus'], seed });
      });
      return all(runtime).find((n) => n.kind === 'path')!.attrs.get('d');
    };
    expect(outline(3)).toBe(outline(3));
    expect(outline(3)).not.toBe(outline(4));
    let cell: Cell | null = null;
    run((inc) => {
      cell = inc.biology('#b', { title: 'Cell' }).cell(320, 200, { organelles: ['nucleus', 'membrane'] });
    });
    expect((cell! as Cell).organelles).toEqual(['membrane', 'nucleus']);
  });

  it('refuses organelles a cell does not have, by name', () => {
    expect(error((b) => b.cell(0, 0, { organelles: ['vacuole'] }))).toContain('an animal cell has no vacuole');
    expect(error((b) => b.cell(0, 0, { kind: 'bacterium', organelles: ['nucleus'] }))).toContain('a bacterium cell has no nucleus');
    expect(error((b) => b.cell(0, 0, { organelles: ['heart' as never] }))).toContain('"heart" is not an organelle');
    expect(error((b) => b.cell(0, 0, { kind: 'fungus' as never }))).toContain("'animal', 'plant' or 'bacterium'");
    expect(error((b) => b.cell(0, 0).organelle('chloroplasts'))).toContain('draws no chloroplasts');
  });
});

describe('membranes', () => {
  it('lets particles diffuse down their gradient through the channels, until the sides even out', () => {
    let membrane: Membrane | null = null;
    const { runtime } = run((inc) => {
      membrane = inc.biology('#b', { title: 'Diffusion' }).membrane({ particles: [120, 0], channels: 4, speed: 120 });
    });
    const m = membrane! as Membrane;
    expect([m.left, m.right, m.crossed]).toEqual([120, 0, 0]);
    play(runtime, 30);
    expect(m.right).toBeGreaterThan(30);
    expect(m.left + m.right).toBe(120);
    expect(m.crossed).toBe(m.right);
    // The counts on each side are written over the drawing.
    expect(all(runtime).filter((n) => n.kind === 'text').map((n) => n.text)).toEqual([String(m.left), String(m.right)]);
  });

  it('lets nothing through a closed membrane, and pumps particles against their gradient', () => {
    let membrane: Membrane | null = null;
    const { runtime } = run((inc) => {
      membrane = inc.biology('#b', { title: 'Transport' }).membrane({ particles: [40, 40], permeability: 0 });
    });
    const m = membrane! as Membrane;
    play(runtime, 5);
    expect([m.left, m.right]).toEqual([40, 40]);
    m.set({ pump: 4 });
    play(runtime, 5);
    expect(m.right).toBe(60);
    expect(m.crossed).toBe(20);
    m.reset(10, 0);
    expect([m.left, m.right, m.crossed]).toEqual([10, 0, 0]);
    // Counts worked out from the model are rounded to whole particles: once a diffusion scene passed 15 * 0.8.
    m.reset(15 * 0.8 + 0.4, 2.4);
    expect([m.left, m.right]).toEqual([12, 2]);
    expect(() => m.reset(-1, 0)).toThrow(/0 or more/);
    expect(() => m.set({ permeability: 2 })).toThrow(/from 0 to 1/);
  });

  it('moves the same way on every run', () => {
    const positions = () => {
      const { runtime } = run((inc) => {
        inc.biology('#b', { title: 'Same' }).membrane({ particles: [20, 20] });
      });
      play(runtime, 2);
      return JSON.stringify(runtime.graph.snapshotCommands().filter((c) => c.op === 'dots'));
    };
    expect(positions()).toBe(positions());
  });
});

describe('DNA', () => {
  it('pairs each base with its partner, and draws a rung for every pair', () => {
    let helix: Helix | null = null;
    const { runtime } = run((inc) => {
      helix = inc.biology('#b', { title: 'DNA' }).helix({ sequence: 'atgcgtacca', from: [40, 200], to: [600, 200] });
    });
    const h = helix! as Helix;
    expect(h.sequence).toBe('ATGCGTACCA');
    expect(h.partner).toBe('TACGCATGGT');
    expect(all(runtime).filter((n) => n.kind === 'line')).toHaveLength(20);
    const letters = all(runtime).filter((n) => n.kind === 'text' && !n.hidden).map((n) => n.text);
    expect(letters.length).toBeGreaterThan(4);
    expect(new Set(letters)).toEqual(new Set(['A', 'T', 'G', 'C']));
    expect(nodeOf(h.base(3)).kind).toBe('g');
    expect(() => h.base(10)).toThrow(/count from 0 to 9/);
  });

  it('unzips from the start: pulled-apart strands no longer meet in the middle', () => {
    let helix: Helix | null = null;
    const { runtime } = run((inc) => {
      helix = inc.biology('#b', { title: 'DNA' }).helix({ sequence: 'GGGGGGGGGG', from: [40, 200], to: [600, 200], perTurn: 40 });
    });
    const gapAt = (pair: number) => {
      const [a, b] = nodeOf((helix! as Helix).base(pair)).children.map((id) => runtime.graph.nodes.get(id)!);
      return Math.hypot(Number(a!.attrs.get('x2')) - Number(b!.attrs.get('x2')), Number(a!.attrs.get('y2')) - Number(b!.attrs.get('y2')));
    };
    expect(gapAt(2)).toBeLessThan(1);
    (helix! as Helix).unzip(0.5);
    expect(gapAt(2)).toBeGreaterThan(20);
    expect(gapAt(8)).toBeLessThan(1);
    expect(error((b) => b.helix({ sequence: 'ATGU', from: [0, 0], to: [100, 0] }))).toContain('A, T, G and C');
  });
});

describe('streams', () => {
  it('moves particles along the path at their speed, and carries on from where they are when it changes', () => {
    let stream: Stream | null = null;
    const { runtime } = run((inc) => {
      stream = inc.biology('#b', { title: 'Blood' }).stream([[0, 100], [400, 100]], { count: 4, speed: 50, shape: 'cell', width: 30 });
    });
    const s = stream! as Stream;
    expect(s.at(0)).toEqual([0, 100]);
    expect(s.at(1)).toEqual([100, 100]);
    play(runtime, 1);
    expect(s.at(0)[0]).toBeCloseTo(50, 6);
    s.set({ speed: 100 });
    expect(s.at(0)[0]).toBeCloseTo(50, 6);
    play(runtime, 1);
    expect(s.at(0)[0]).toBeCloseTo(150, 6);
    // Each red blood cell is a shaded disc with a dimple; the vessel has two walls and a faint inside.
    expect(all(runtime).filter((n) => n.kind === 'circle')).toHaveLength(8);
    expect(all(runtime).filter((n) => n.kind === 'path')).toHaveLength(3);
    expect(error((b) => b.stream([[0, 0]]))).toContain('2 to 200 points');
  });
});

describe('the biology kit script', () => {
  it('registers itself in the Worker and draws with the runtime’s own modules', async () => {
    const code = await KIT_SCRIPTS.biology!();
    const scope = globalThis as unknown as Record<string, unknown>;
    scope[SHARED_GLOBAL] = SHARED_MODULES;
    try {
      new Function(code)();
      const registered = (scope[KIT_GLOBAL] as Record<string, unknown>).biology;
      expect(isKitModule(registered)).toBe(true);
      const { runtime } = run((inc) => {
        const bio = inc.biology('#b', { title: 'Built' });
        bio.stage.part('Cell', bio.cell(320, 200).handle, { label: 'Cell' });
      }, registered as KitModule);
      expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Cell']);
      expect(runtime.uiState().error).toBeNull();
    } finally {
      delete scope[SHARED_GLOBAL];
      delete scope[KIT_GLOBAL];
    }
  });
});

describe('a biology scene passes the validator', () => {
  it('has no diagnostics', () => {
    const js = `
inc.idea('Particles spread from where they are crowded to where they are sparse until both sides are even.');
const channels = inc.param('open', { min: 0, max: 1, step: 0.1, value: 1, label: 'Channels open' });
const bio = inc.biology('#bio', { title: 'Diffusion across a membrane' });
const membrane = bio.membrane({ particles: [80, 10], channels: 3 });
bio.stage.part('Membrane', membrane.handle, { label: 'Membrane' });
inc.onParamChange(() => membrane.set({ permeability: channels.value }));
inc.readout({ Left: () => membrane.left, Right: () => membrane.right });
inc.describe(() => membrane.left + ' particles on the left and ' + membrane.right + ' on the right.');
inc.steps([{ say: 'Most particles start on the left.', focus: 'Membrane' }, { say: 'Close the channels and nothing crosses.', set: { open: 0 } }]);
`;
    const { diagnostics, info } = validateSceneJs(js);
    expect(diagnostics).toEqual([]);
    expect(info.kits).toEqual(['biology']);
  });
});
