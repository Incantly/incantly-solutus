import type { KitModule } from '../../runtime/kits';
import { createGraph, readGraphOptions } from './graph';
import { createSpace, readSpaceOptions } from './space';

/**
 * The space3d kit: inc.space3d for 3D scenes of solids, lines and labels, and
 * inc.graph3d for surfaces, curves and vectors in a data box. Loaded only for
 * scenes that call them.
 */
export const kit: KitModule = {
  name: 'space3d',
  calls: {
    space3d: {
      layout: (options) => ({ viewBox: readSpaceOptions(options).viewBox }),
      create: (ctx, options) => createSpace(ctx, options),
    },
    graph3d: {
      layout: (options) => ({ viewBox: readGraphOptions(options).viewBox }),
      create: (ctx, options) => createGraph(ctx, options),
    },
  },
};
