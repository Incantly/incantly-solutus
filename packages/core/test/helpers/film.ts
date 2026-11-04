import { compileFilm, compileTrusted, loadKitModules, SceneRuntime, validateScene, type CompiledFilm, type FilmFixture, type FilmSceneInput } from '../../src/index';
import { compileValidated } from './compile';

/** A fixture's compiled film plus its runnable scenes, through validation like production. */
export interface FixtureFilm {
  readonly film: CompiledFilm;
  readonly scenes: readonly FilmSceneInput[];
  readonly diagnostics: readonly { readonly severity: string; readonly message: string }[];
  /** Refuels every fixture scene, as the Worker does before each step. */
  readonly refuel: () => void;
}

export async function compileFixture(fixture: FilmFixture): Promise<FixtureFilm> {
  const scenes: FilmSceneInput[] = [];
  const refuels: Array<() => void> = [];
  const sources = [];
  for (const scene of fixture.scenes) {
    const validation = validateScene({ html: scene.html, css: scene.css, js: scene.js });
    if (!validation.ok || !validation.scene) throw new Error(`Fixture scene failed validation: ${validation.diagnostics.map((d) => d.message).join('; ')}`);
    const kits = await loadKitModules(validation.scene.kits);
    const { scene: compiled, fuel } = compileValidated({ html: scene.html, css: scene.css, js: scene.js });
    refuels.push(fuel.refuel);
    const runtime = new SceneRuntime({ kits });
    fuel.refuel();
    runtime.mount(compiled);
    if (!runtime.isMounted) throw new Error(`Fixture scene failed to mount: ${runtime.errors.map((e) => e.message).join('; ')}`);
    const steps = runtime.beats();
    if (!steps) throw new Error('Fixture scene has no steps');
    sources.push({ id: scene.id, js: scene.js, steps });
    scenes.push({ id: scene.id, scene: compiled, kits });
  }
  const result = compileFilm(JSON.parse(JSON.stringify(fixture.storyboard)), sources);
  if (!result.ok || !result.film) throw new Error(`Fixture film failed to compile: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  return { film: result.film, scenes, diagnostics: result.diagnostics, refuel: () => refuels.forEach((fn) => fn()) };
}

/**
 * The same film with trusted scenes (no fuel), for controller and player
 * tests that tick thousands of frames the way the film-clock tests do.
 */
export async function trustFixture(fixture: FilmFixture): Promise<{ readonly film: CompiledFilm; readonly scenes: readonly FilmSceneInput[] }> {
  const scenes: FilmSceneInput[] = [];
  const sources = [];
  for (const scene of fixture.scenes) {
    const validation = validateScene({ html: scene.html, css: scene.css, js: scene.js });
    if (!validation.ok || !validation.scene) throw new Error(`Fixture scene failed validation: ${validation.diagnostics.map((d) => d.message).join('; ')}`);
    const kits = await loadKitModules(validation.scene.kits);
    const compiled = compileTrusted(scene.js);
    const runtime = new SceneRuntime({ kits });
    runtime.mount(compiled);
    if (!runtime.isMounted) throw new Error(`Fixture scene failed to mount: ${runtime.errors.map((e) => e.message).join('; ')}`);
    const steps = runtime.beats();
    if (!steps) throw new Error('Fixture scene has no steps');
    sources.push({ id: scene.id, js: scene.js, steps });
    scenes.push({ id: scene.id, scene: compiled, kits });
  }
  const result = compileFilm(JSON.parse(JSON.stringify(fixture.storyboard)), sources);
  if (!result.ok || !result.film) throw new Error(`Fixture film failed to compile: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  return { film: result.film, scenes };
}
