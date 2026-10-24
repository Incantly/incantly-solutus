import type { ChartOptions } from '../../api/types';
import type { KitModule } from '../../runtime/kits';
import { chartLayout, ChartKit } from './chart';

/**
 * The chart kit (DG-3): bar, line, area, stacked, pie, histogram, box and
 * scatter charts whose data may be live functions of the scene's parameters.
 * Loaded only for scenes that call inc.chart.
 */
export const kit: KitModule = {
  name: 'chart',
  calls: {
    chart: {
      layout: chartLayout,
      create: (ctx, options) => new ChartKit(ctx, options as ChartOptions),
    },
  },
};
