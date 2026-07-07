import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Component tests (.test.tsx) run in jsdom; repo/logic tests stay on node.
    environmentMatchGlobs: [['test/**/*.test.tsx', 'jsdom']],
  },
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
