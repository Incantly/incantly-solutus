/** The embed demo: one figure mounted with the SDK's `createApp` (embed-files-export design 3.2). */
import { createApp } from '@incantly/sdk';

const container = document.getElementById('figure');
const out = document.getElementById('events');
if (container && out) {
  const app = await createApp({
    container,
    mode: 'classic',
    ui: { menu: true, resetButton: true },
    script: ['@title "A circle and a tangent"', '@view -5 5 -3.5 3.5', 'c = Circle((0, 0), 2)', 'P = PointOn(c, 0.6)', 'T = Tangent(P, c)', 'A = (3, 2)'].join('\n'),
  });
  (window as unknown as { app: typeof app }).app = app;
  app.on('drag', (e) => {
    out.textContent = `drag ${e.name} = ${JSON.stringify(e.value)}`;
  });
  app.on('changed', (e) => {
    if (e.source !== 'user') out.textContent = `changed ${e.objects.map((o) => o.name).join(', ')}`;
  });
}
