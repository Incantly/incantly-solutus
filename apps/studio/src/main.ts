/** Incantly Studio. Each feature area adds its screens here once it passes all checks. */
import { mountStudio } from './studio-page';
import type { AppModeId } from '@incantly/modes';

const root = document.getElementById('app');
const q = new URLSearchParams(location.search);
// `?mode=geometry` opens an app; `?start` shows the app tiles first (app-modes ui 1)
const mode = q.get('mode') as AppModeId | null;
if (root) mountStudio(root, { ...(mode ? { mode } : {}), start: q.has('start') });
