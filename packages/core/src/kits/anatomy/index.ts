import type { AnatomyOptions } from '../../api/types';
import type { KitModule } from '../../runtime/kits';
import { AnatomyKit, anatomyLayout } from './anatomy';

/**
 * The anatomy kit: animals grown from a skeleton. The scene gives the bones;
 * the kit reads the posture, muscles, outline, attached parts and gait from
 * them, as a reconstruction from a fossil does. Loaded only for scenes that
 * call inc.anatomy.
 */
export const kit: KitModule = {
  name: 'anatomy',
  calls: {
    anatomy: {
      layout: anatomyLayout,
      create: (ctx, options) => new AnatomyKit(ctx, options as AnatomyOptions),
    },
  },
};
