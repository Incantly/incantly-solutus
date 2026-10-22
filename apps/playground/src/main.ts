import './styles.css';
import { mountEditorPage } from './editor-page';
import { mountGalleryPage } from './gallery-page';
import { mountGeneratePage } from './generate-page';
import { mountGenerationsPage } from './generations-page';
import { mountNotePage } from './note-page';
import { mountAttackPage, mountComparePage, mountSandboxPage } from './sandbox-page';
import { mountScenePage } from './scene-page';
import { mountStylePage } from './style-page';

const pages: Record<string, (root: HTMLElement, params: URLSearchParams) => void> = {
  editor: mountEditorPage,
  generate: mountGeneratePage,
  generations: (root) => mountGenerationsPage(root),
  note: mountNotePage,
  scene: mountScenePage,
  sandbox: mountSandboxPage,
  compare: mountComparePage,
  attack: mountAttackPage,
  style: mountStylePage,
  gallery: mountGalleryPage,
};

const params = new URLSearchParams(location.search);
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');
const page = pages[params.get('page') ?? 'generate'];
if (!page) {
  root.textContent = `Unknown page. Try one of: ${Object.keys(pages).join(', ')}`;
} else {
  page(root, params);
}
