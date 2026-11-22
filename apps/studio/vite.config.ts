import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // the browser calls the server at its own origin; the dev and preview servers pass /v1 on to `npm run server`
  server: { port: 5173, strictPort: true, host: '127.0.0.1', proxy: { '/v1': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1', proxy: { '/v1': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
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
