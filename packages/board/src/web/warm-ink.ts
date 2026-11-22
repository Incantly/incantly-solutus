/**
 * Warms the pen's code before the first stroke (BR-77). The stroke's arithmetic runs in the engine's first tiers until it has
 * run often enough to be optimised, and those tiers keep every intermediate number on the heap: the first few seconds of
 * drawing made a megabyte or two of garbage and one or two collections, until the optimised code took over. So once the
 * board is idle after it opens, a stroke that nobody sees is drawn through the same code: samples into a throwaway live
 * stroke, its outline grown frame by frame at the scales a screen has, the hold watch and the guess of the tail. Nothing is
 * stored or drawn, and the board's own objects are not touched. It takes a few milliseconds.
 */
import { LiveStroke } from '../core/ink/live';
import { HoldWatch } from '../core/ink/hold';
import { Predictor } from '../core/ink/predict';
import type { CameraView } from '../core/camera';
import { ReusedSample } from './input';

/** Samples in each warm stroke, and outline steps (one every second sample, as a frame takes about two). */
const SAMPLES = 900;

/**
 * Draws the throwaway strokes: with and without tilt, at the two common pixel ratios. `camera` is the board's own (only read),
 * so the code is optimised for the objects it meets when a person draws.
 */
export function warmInk(camera: CameraView): void {
  const live = new LiveStroke();
  const hold = new HoldWatch();
  const predictor = new Predictor();
  const guess = new Float64Array(3);
  const s = new ReusedSample();
  s.pointer = 1;
  s.buttons = 1;
  s.setPhase('down');
  for (let round = 0; round < 4; round++) {
    const pen = round % 2 === 0;
    const scale = round < 2 ? 1 : 2;
    s.device = pen ? 'pen' : 'mouse';
    s.x = 100;
    s.y = 100;
    s.time = 0;
    s.pressure = pen ? 0.5 : Number.NaN;
    if (!live.begin(s, camera, 'page:warm', { nib: 'pen', size: 3, color: '#000000', opacity: 1 }, pen)) continue;
    hold.begin(s.x, s.y, s.time);
    predictor.reset();
    s.setPhase('move');
    for (let i = 1; i <= SAMPLES; i++) {
      s.x = 100 + i * 0.7;
      s.y = 100 + 80 * Math.sin(i / 30) + 20 * Math.sin(i / 7);
      s.time = i * 8.3;
      if (pen) {
        s.pressure = 0.3 + 0.5 * Math.abs(Math.sin(i / 50));
        s.tiltX = 20 * Math.sin(i / 40);
        s.tiltY = 10;
      }
      s.predicted = false;
      live.add(s, camera);
      hold.move(s);
      predictor.push(s);
      for (let g = 0; g < predictor.ready; g++) {
        if (!predictor.guess(g, guess)) break;
        live.predict(s);
      }
      if (i % 2 === 0) live.rebuild(scale);
    }
    hold.cancel();
    live.cancel();
  }
}
