import type { BiologyOptions } from '../../api/types';
import type { KitModule } from '../../runtime/kits';
import { BiologyKit, biologyLayout } from './biology';

/**
 * The biology kit (DG-6): animal, plant and bacterial cells with their
 * organelles, particles diffusing across a membrane or pumped against their
 * gradient, DNA's double helix, and flows such as blood through a vessel.
 * Loaded only for scenes that call inc.biology.
 */
export const kit: KitModule = {
  name: 'biology',
  calls: {
    biology: {
      layout: biologyLayout,
      create: (ctx, options) => new BiologyKit(ctx, options as BiologyOptions),
    },
  },
};
