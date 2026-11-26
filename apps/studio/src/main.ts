/** Incantly Studio. Each feature area adds its screens here once it passes all checks. */
import { initPhysicsKernels } from '@incantly/kernel';
import { mountLanding } from './landing';
import { mountStudio } from './studio-page';
import type { AppModeId } from '@incantly/modes';

// the physics kernels (WebAssembly) compile without blocking; nothing waits for them (physics design 11.6)
void initPhysicsKernels();
const root = document.getElementById('app');
const q = new URLSearchParams(location.search);
// `?mode=geometry` opens an app; `?start` shows the app tiles first (app-modes ui 1)
const mode = q.get('mode') as AppModeId | null;
// a shared figure, a chosen app, or the mode tiles skip the landing page
const direct = mode !== null || q.has('start') || location.hash.includes('f=');
if (root) {
  const enter = (chosen?: AppModeId): void => {
    const picked = chosen ?? mode ?? undefined;
    const studio = mountStudio(root, { ...(picked ? { mode: picked } : {}), start: chosen === undefined && q.has('start'), boardDemo: q.get('board') === 'custom' });
    // a shared link (`#f=…`) opens its figure (embed-files-export ui.md 5)
    void studio.files.openLink(location.href);
  };
  if (direct) enter();
  else mountLanding(root, { onStart: enter });
}
