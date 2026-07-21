import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app.html'),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
