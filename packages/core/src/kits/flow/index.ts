import type { FlowOptions } from '../../api/types';
import type { KitModule } from '../../runtime/kits';
import { FlowKit, flowLayout } from './flow';

/**
 * The flow kit (DG-4): flowcharts and state diagrams that lay themselves out
 * in layers, with nodes that are parts a step can focus. Loaded only for
 * scenes that call inc.flow.
 */
export const kit: KitModule = {
  name: 'flow',
  calls: {
    flow: {
      layout: flowLayout,
      create: (ctx, options) => new FlowKit(ctx, options as FlowOptions),
    },
  },
};
