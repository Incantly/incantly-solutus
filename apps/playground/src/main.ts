import './styles.css';
import { mountEditorPage } from './editor-page';
import { mountScenePage } from './scene-page';

const pages: Record<string, (root: HTMLElement, params: URLSearchParams) => void> = {
  editor: mountEditorPage,
  scene: mountScenePage,
};

const params = new URLSearchParams(location.search);
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');
const page = pages[params.get('page') ?? 'editor'];
if (!page) {
  root.textContent = `Unknown page. Try one of: ${Object.keys(pages).join(', ')}`;
} else {
  page(root, params);
}
