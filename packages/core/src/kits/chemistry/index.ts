import type { ChemistryOptions } from '../../api/types';
import type { KitModule } from '../../runtime/kits';
import { ChemistryKit, chemistryLayout } from './chemistry';

/**
 * The chemistry kit (DG-6): atoms, bonds and molecules drawn from their
 * formulas with real bond lengths and angles, electron shells, reactions
 * acted out by their atoms, and energy profiles. Loaded only for scenes that
 * call inc.chemistry.
 */
export const kit: KitModule = {
  name: 'chemistry',
  calls: {
    chemistry: {
      layout: chemistryLayout,
      create: (ctx, options) => new ChemistryKit(ctx, options as ChemistryOptions),
    },
  },
};
