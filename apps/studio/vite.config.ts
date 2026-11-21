import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    sourcemap: true,
    // the studio, the embed demo page and the notes demo page
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        embed: fileURLToPath(new URL('embed.html', import.meta.url)),
        notes: fileURLToPath(new URL('notes.html', import.meta.url)),
      },
    },
  },
});
