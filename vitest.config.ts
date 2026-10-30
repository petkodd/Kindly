import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    // Password hashing at the production work factor (N = 2^17) costs ~0.3 s
    // per hash; tests use 2^10. Ignored on the production deploy (passwordHash.ts).
    env: { AUTH_SCRYPT_N: '1024' },
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Component tests (.test.tsx) run in jsdom; repo/logic tests stay on node.
    environmentMatchGlobs: [['test/**/*.test.tsx', 'jsdom']],
  },
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
