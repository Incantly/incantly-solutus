/**
 * Renderer micro-benchmarks (performance design 6: every package has a suite).
 * Targets: hit query under 0.2 ms at 5,000 objects; grid spacing trivial;
 * scheduler tick trivial; label placement for 200 labels under 2 ms.
 *
 * Plain script on purpose: Vitest 5 has no `bench` export, and this package
 * must not add a bench runner. Each case warms up, then times a loop with
 * `performance.now()` and prints ms/op. Run it with `npx tsx` (plain `node`
 * cannot resolve this repo's extensionless imports), or execute it in place
 * with the repo's own runner, which prints the same output:
 *
 *   npx vitest bench --run packages/view/bench/view.bench.ts
 */
import type { ObjId } from '@incantly/kernel';
import { px } from '../src/core/coords';
import { HitIndex } from '../src/core/hit';
import { chooseStep } from '../src/core/grid';
import { placeLabels, type LabelInput } from '../src/core/labels';
import { rdpSimplify } from '../src/core/geometry';
import { SchedulerState, registerFigure, schedulerTick } from '../src/core/scheduler';

function measure(name: string, iterations: number, fn: () => void): void {
  for (let w = 0; w < 10; w++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = performance.now() - t0;
  const meanMs = totalMs / iterations;
  console.log(`${name}: ${meanMs.toFixed(4)} ms/op over ${iterations} iterations (${totalMs.toFixed(1)} ms total)`);
}

const N = 5000;
const index = new HitIndex();
for (let i = 0; i < N; i++) {
  const id = i as ObjId;
  const x = (i % 80) * 64;
  const y = Math.floor(i / 80) * 64;
  index.insert(id, { x0: px(x), x1: px(x + 60), y0: px(y), y1: px(y + 60) });
}

measure('hit query over 5,000 objects', 2000, () => {
  index.query({ x: px(500), y: px(500) }, 16);
});

measure('grid spacing choice', 20000, () => {
  chooseStep(80, { k: 'unit' }, 1, null);
});

const labels: LabelInput[] = [];
for (let i = 0; i < 200; i++) {
  labels.push({
    id: i as ObjId,
    anchorX: (i % 20) * 40,
    anchorY: Math.floor(i / 20) * 30,
    widthPx: 36,
    heightPx: 16,
    userDx: null,
    userDy: null,
    prevDx: null,
    prevDy: null,
    prevScore: null,
  });
}

measure('label placement, 200 labels', 50, () => {
  placeLabels(labels, []);
});

const run = new Float32Array(2000);
for (let i = 0; i < 1000; i++) {
  run[i * 2] = i;
  run[i * 2 + 1] = Math.sin(i / 20) * 10;
}

measure('RDP simplify, 1,000 points', 200, () => {
  rdpSimplify(run, 0.3);
});

const sched = new SchedulerState();
for (let i = 0; i < 50; i++) registerFigure(sched, `fig${i}`);
const visible = new Set(['fig1', 'fig2']);
const near = new Set(['fig1', 'fig2', 'fig3', 'fig4']);

measure('scheduler tick, 50 figures', 2000, () => {
  schedulerTick(sched, { nowMs: 100000, visible, near, scrollSettled: true, tabVisible: true });
});
