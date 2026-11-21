/** Incantly Studio. Each feature area adds its screens here once it passes all checks. */
import { initPhysicsKernels } from '@incantly/kernel';
import { mountStudio } from './studio-page';
import type { AppModeId } from '@incantly/modes';

// the physics kernels (WebAssembly) compile without blocking; nothing waits for them (physics design 11.6)
void initPhysicsKernels();
const root = document.getElementById('app');
const q = new URLSearchParams(location.search);
// `?mode=geometry` opens an app; `?start` shows the app tiles first (app-modes ui 1)
const mode = q.get('mode') as AppModeId | null;
if (root) {
  const studio = mountStudio(root, { ...(mode ? { mode } : {}), start: q.has('start'), boardDemo: q.get('board') === 'custom' });
  // a shared link (`#f=…`) opens its figure (embed-files-export ui.md 5)
  void studio.files.openLink(location.href);
}
