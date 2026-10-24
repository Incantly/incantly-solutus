import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileGalleryStore, reviewGallery } from '../gallery';

/**
 * Reviews the community gallery (GL-1, BR-13): list what learners published,
 * read it, accept or turn it down, and promote an accepted figure to a
 * reviewed scene, which then feeds the examples.
 *
 *   npm run gallery -- list [pending|accepted|rejected|promoted|all]
 *   npm run gallery -- show <id>
 *   npm run gallery -- accept <id>
 *   npm run gallery -- reject <id> [reason]
 *   npm run gallery -- promote <id> [scene-id]
 *
 *   INCANTLY_GALLERY_DIR   where the service keeps the gallery (required)
 *   INCANTLY_SCENES_DIR    the reviewed scenes (default packages/core/scenes)
 */

const dir = process.env.INCANTLY_GALLERY_DIR;
if (!dir) {
  process.stderr.write('Set INCANTLY_GALLERY_DIR to the directory the service keeps its gallery in\n');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const scenesDir = resolve(process.env.INCANTLY_SCENES_DIR ?? join(here, '../../core/scenes'));
const code = await reviewGallery(process.argv.slice(2), { store: new FileGalleryStore(dir), scenesDir, write: (line) => process.stdout.write(`${line}\n`) });
process.exit(code);
