/**
 * The page of `cross-browser.mjs` (physics design 10.2, 11.4 "Same result"): plays one of the films of `../films.ts` and
 * returns the hash of the world after every second of film, with the Rust loops on or off, and the whole state of the
 * world at one second when asked, so a difference between two browsers can be traced to its first value.
 */
import { CommandRegistry, Figure, geometry, initPhysicsKernels, physics3Of, physicsKernelsActive, physicsOf, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSpace, setExactMath, setPhysicsKernels } from '../../src/index';
import { FILMS, hashWorld } from '../films';

const compiled = await initPhysicsKernels();
// `?exact=off` plays the films on the platform's own maths in formulas (the way it was before round 10)
if (new URLSearchParams(location.search).get('exact') === 'off') setExactMath(false);

const commands = new CommandRegistry();
geometry.registerGeometry(commands);
registerNumbers(commands);
registerFunctions(commands);
registerAnimation(commands);
registerLists(commands);
registerSpace(commands);
registerPhysics(commands);

interface FilmRun {
  readonly title: string;
  /** Whether the Rust loops ran (the cloth's or the liquid's, or the grid's), told by the figure. */
  readonly kernels: boolean | undefined;
  readonly hashes: string[];
  /** The bits of the state at `snapshotAt` seconds, as pairs of 32-bit words (low, high), when asked. */
  readonly state?: number[];
}

function playFilm(index: number, seconds: number, kernels: boolean, snapshotAt = 0): FilmRun {
  const film = FILMS[index];
  if (film === undefined) throw new Error(`no film ${index}`);
  setPhysicsKernels(kernels);
  const figure = new Figure({ commands });
  for (const line of film.lines) {
    if (!figure.apply(line).ok) throw new Error(`film ${film.title}: ${line}`);
  }
  const hashes: string[] = [];
  let state: number[] | undefined;
  for (let s = 0; s < seconds; s++) {
    for (let k = 1; k <= 60; k++) figure.setClock((s * 60 + k) / 60);
    hashes.push(hashWorld(figure, film.space));
    if (snapshotAt === s + 1) {
      const d = (film.space ? physics3Of(figure) : physicsOf(figure)) as unknown as { saveState(): Float64Array };
      const a = d.saveState();
      state = Array.from(new Uint32Array(a.buffer, a.byteOffset, a.length * 2));
    }
  }
  return { title: film.title, kernels: physicsKernelsActive(figure), hashes, ...(state !== undefined ? { state } : {}) };
}

declare global {
  interface Window {
    crossFilm: typeof playFilm;
    crossInfo: { compiled: boolean; films: string[]; agent: string };
  }
}
window.crossFilm = playFilm;
window.crossInfo = { compiled, films: FILMS.map((f) => f.title), agent: navigator.userAgent };
