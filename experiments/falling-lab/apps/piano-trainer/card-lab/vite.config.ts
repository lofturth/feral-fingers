import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, '../../..'),
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [
    { find: /^react-dom\/client$/, replacement: resolve(import.meta.dirname, 'node_modules/react-dom/client.js') },
    { find: /^react\/jsx-dev-runtime$/, replacement: resolve(import.meta.dirname, 'node_modules/react/jsx-dev-runtime.js') },
    { find: /^react\/jsx-runtime$/, replacement: resolve(import.meta.dirname, 'node_modules/react/jsx-runtime.js') },
    { find: /^react$/, replacement: resolve(import.meta.dirname, 'node_modules/react/index.js') }
  ] },
  server: { hmr: false, port: 5187, strictPort: true },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input: [resolve(import.meta.dirname, 'index.html'), resolve(import.meta.dirname, '../index.html')] }
  }
});
