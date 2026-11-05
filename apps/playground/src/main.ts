import './styles.css';
import { mountEditorPage } from './editor-page';
import { mountGalleryPage } from './gallery-page';
import { mountGeneratePage } from './generate-page';
import { mountGenerationsPage } from './generations-page';
import { mountNotePage } from './note-page';
import { mountPlayerPage } from './player-page';
import { mountAttackPage, mountComparePage, mountSandboxPage } from './sandbox-page';
import { mountScenePage } from './scene-page';
import { mountStylePage } from './style-page';

const pages: Record<string, (root: HTMLElement, params: URLSearchParams) => void> = {
  editor: mountEditorPage,
  generate: mountGeneratePage,
  generations: mountGenerationsPage,
  note: mountNotePage,
  player: mountPlayerPage,
  scene: mountScenePage,
  sandbox: mountSandboxPage,
  compare: mountComparePage,
  attack: mountAttackPage,
  style: mountStylePage,
  gallery: mountGalleryPage,
};

/** Pages laid out as the chat app; the others keep the plain page their tests and fixtures expect. */
const CHAT_PAGES: ReadonlySet<string> = new Set(['generate', 'generations']);

const params = new URLSearchParams(location.search);
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');
const page = pages[params.get('page') ?? 'generate'];
if (!page) {
  root.textContent = `Unknown page. Try one of: ${Object.keys(pages).join(', ')}`;
} else {
  if (CHAT_PAGES.has(params.get('page') ?? 'generate')) root.dataset.layout = 'chat';
  page(root, params);
}
