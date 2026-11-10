/** Incantly Studio. Each feature area adds its screens here once it passes all checks. */
import { mountStudio } from './studio-page';

const root = document.getElementById('app');
if (root) mountStudio(root);
