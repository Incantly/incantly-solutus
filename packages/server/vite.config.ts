import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The server builds as one Node ES module into the ignored `dist/` (server tasks: `npm run server`). Our own packages
// are bundled in, since they ship TypeScript; everything else stays an import resolved by Node.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  ssr: { noExternal: [/^@incantly\//] },
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'main.js' } },
  },
});
