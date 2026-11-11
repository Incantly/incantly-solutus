/**
 * Renderer micro-benchmarks (performance design 6: every package has a suite).
 * Targets: hit query under 0.2 ms at 5,000 objects; grid spacing trivial;
 * scheduler tick trivial; label placement for 200 labels under 2 ms.
 */
import { bench } from 'vitest';
import type { ObjId } from '@incantly/kernel';
import { HitIndex } from '../src/core/hit';
import { chooseStep } from '../src/core/grid';
import { placeLabels } from '../src/core/labels';
import { rdpSimplify } from '../src/core/geometry';
import { SchedulerState, registerFigure, schedulerTick } from '../src/core/scheduler';

const N = 5000;
const index = new HitIndex();
for (let i = 0; i < N; i++) {
  const x = (i % 80) * 64;
  const y = Math.floor(i / 80) * 64;
  index.insert(i as ObjId, { x0: x as never, x1: (x + 60) as never, y0: y as never, y1: (y + 60) as never });
}

bench('hit query over 5,000 objects', () => {
  index.query({ x: 500 as never, y: 500 as never }, 16);
});

bench('grid spacing choice', () => {
  chooseStep(80, { k: 'unit' }, 1, null);
});

const labels = [];
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

bench('label placement, 200 labels', () => {
  placeLabels(labels, []);
});

const run = new Float32Array(2000);
for (let i = 0; i < 1000; i++) {
  run[i * 2] = i;
  run[i * 2 + 1] = Math.sin(i / 20) * 10;
}

bench('RDP simplify, 1,000 points', () => {
  rdpSimplify(run, 0.3);
});

const sched = new SchedulerState();
for (let i = 0; i < 50; i++) registerFigure(sched, `fig${i}`);
const visible = new Set(['fig1', 'fig2']);
const near = new Set(['fig1', 'fig2', 'fig3', 'fig4']);

bench('scheduler tick, 50 figures', () => {
  schedulerTick(sched, { nowMs: 100000, visible, near, scrollSettled: true, tabVisible: true });
});
