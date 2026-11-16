/** The embed demo: one figure mounted with the SDK's `createApp` (embed-files-export design 3.2). */
import { createApp } from '@incantly/sdk';

const container = document.getElementById('figure');
const out = document.getElementById('events');
// `embed.html?3d` shows a figure in space: a cube cut by a plane (.kiro/specs/space-3d R3)
const in3d = new URLSearchParams(location.search).has('3d');
const FLAT = ['@title "A circle and a tangent"', '@view -5 5 -3.5 3.5', 'c = Circle((0, 0), 2)', 'P = PointOn(c, 0.6)', 'T = Tangent(P, c)', 'A = (3, 2)'];
const SPACE = [
  '@title "A cube cut by a plane"', 'A = (0, 0, 0)', 'B = (3, 0, 0)', 'C = (0, 1, 0)', 'k = Cube(A, B, C)',
  'p = Plane((1.5, 1.5, 1.5), Vector(1, 1, 1))', 'cut = Intersect(p, k)', 'cut with color = red', 'P = (4, 3, 2)',
];
if (container && out) {
  const app = await createApp({
    container,
    mode: in3d ? 'graphing3d' : 'classic',
    ui: { menu: true, resetButton: true },
    script: (in3d ? SPACE : FLAT).join('\n'),
  });
  (window as unknown as { app: typeof app }).app = app;
  app.on('drag', (e) => {
    out.textContent = `drag ${e.name} = ${JSON.stringify(e.value)}`;
  });
  app.on('changed', (e) => {
    if (e.source !== 'user') out.textContent = `changed ${e.objects.map((o) => o.name).join(', ')}`;
  });
}
