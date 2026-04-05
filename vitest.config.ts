import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@core': path.resolve(rootDir, 'src/core'),
      '@features': path.resolve(rootDir, 'src/features'),
      '@shared': path.resolve(rootDir, 'src/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
