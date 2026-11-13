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
    rolldownOptions: {
      input: {
        home: resolve(root, 'index.html'),
      },
      output: {
        codeSplitting: {
          groups: [
            // three.js changes only with its version, so its file stays in the browser's cache across releases.
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 20 },
            // The gallery's roadmaps: data that changes on its own schedule, fetched beside the code.
            { name: 'gallery', test: /[\\/]src[\\/]roadmap[\\/]samples[\\/][^\\/]+\.json$/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    restoreMocks: true,
  },
});
