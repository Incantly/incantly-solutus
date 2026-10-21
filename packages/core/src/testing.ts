/**
 * Helpers for the SDK's own security and browser tests. Nothing here belongs
 * in a product: these mount scenes without the validator on purpose.
 */
export { mountUnvalidated, probeUnvalidated } from './sandbox/adapter';
export { buildShell, contentSecurityPolicy, FRAME_SCOPE } from './sandbox/shell';
