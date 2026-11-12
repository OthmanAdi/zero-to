import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  // Relative asset URLs, so the built site works from any folder, from a sub-path and from file://.
  base: './',
  server: { host: '127.0.0.1', port: 5180, strictPort: false },
  preview: { host: '127.0.0.1', port: 4180, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    restoreMocks: true,
  },
});
