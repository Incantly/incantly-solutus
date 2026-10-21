import * as calc from '../helpers/calc';
import * as motion from '../helpers/motion';
import * as shapes from '../helpers/shapes';
import * as sym from '../helpers/sym';
import * as units from '../helpers/units';
import * as vec from '../helpers/vec';
import * as tween from '../runtime/tween';
import * as bounds from '../scene/bounds';
import * as errors from '../scene/errors';
import * as format from '../scene/format';
import * as geometry from '../scene/geometry';
import * as handles from '../scene/handles';
import * as path from '../scene/path';

/**
 * The base Worker's modules that kit scripts use, by path under
 * packages/core/src. A kit script is built with these left out and reads
 * them from here, so a kit shares the runtime's classes (handles, errors)
 * instead of carrying copies that `instanceof` and the handle table would not
 * recognise. scripts/build-sandbox-bundles.mjs refuses a kit that imports
 * anything else from outside its own directory.
 */
export const SHARED_MODULES = Object.freeze({
  'helpers/calc': calc,
  'helpers/motion': motion,
  'helpers/shapes': shapes,
  'helpers/sym': sym,
  'helpers/units': units,
  'helpers/vec': vec,
  'runtime/tween': tween,
  'scene/bounds': bounds,
  'scene/errors': errors,
  'scene/format': format,
  'scene/geometry': geometry,
  'scene/handles': handles,
  'scene/path': path,
});

/** Where the base Worker puts SHARED_MODULES for kit scripts, until the scene registers. */
export const SHARED_GLOBAL = '__incShared';
