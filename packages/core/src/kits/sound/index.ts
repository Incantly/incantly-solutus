import type { KitModule } from '../../runtime/kits';
import { createSound } from './sound';

/**
 * The sound kit: tones, noise and notes that follow the model, played by the
 * page that shows the figure. Loaded only for scenes that use inc.sound.
 */
export const kit: KitModule = {
  name: 'sound',
  calls: {},
  sound: createSound,
};
