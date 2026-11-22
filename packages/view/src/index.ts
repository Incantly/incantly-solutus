/**
 * @incantly/view: our own 2D and 3D renderer, GPU interface and back-ends,
 * shared GPU context, figure scheduler, pointer and keyboard.
 *
 * `core/` runs in Node, a worker and on mobile (no DOM, timers, network or
 * `Date`). `backends/` holds the WebGL2, software, SVG and Canvas2D targets.
 * `web/` holds the browser hosts: the shared context, scheduler host and the
 * figure view. `contracts.ts` is the Kernel handoff the integrator joins up.
 */
export * from './contracts';
export * from './errors';
export * from './core/coords';
export * from './core/camera';
export * from './core/grid';
export * from './core/styles';
export * from './core/surface';
export * from './core/drawables';
export * from './core/drawable';
export * from './core/geometry';
export * from './core/hit';
export * from './core/algebra';
export * from './core/drag';
export * from './core/snap';
export * from './core/selection';
export * from './core/labels';
export * from './core/scene';
export * from './core/pick3d';
export * from './core/particles';
export * from './core/scheduler';
export * from './core/export';
export * from './core/describe';
export * from './core/budgets';
export * from './core/gpu';
export * from './core/tessellate';
export * from './backends/webgl2';
export * from './backends/software';
export * from './backends/svg';
export * from './backends/canvas2d';
export * from './web/shared-context';
export * from './web/scheduler-host';
export * from './web/figure-3d';
export * from './web/figure-view';
export * as math from './core/math/index';
export type { DrawItem as MathItem, MathLayout, Measure } from './core/math/index';
