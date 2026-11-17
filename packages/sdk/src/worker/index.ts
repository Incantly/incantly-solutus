/** The physics worker: its protocol, its state and the page's host (docs/features/physics/design.md 9.6). */
export { PhysicsWorkerState } from './physics-worker';
export type { FromWorker, ToWorker } from './physics-worker';
export { PhysicsWorkerHost, browserPhysicsChannel } from './physics-host';
export type { PhysicsChannel } from './physics-host';
