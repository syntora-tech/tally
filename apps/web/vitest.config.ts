import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const integration = process.env.VITEST_INTEGRATION === '1';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    // Integration tests need the local Supabase stack (`pnpm db:start`).
    include: integration ? ['**/*.int.test.ts'] : ['**/*.test.ts'],
    exclude: [
      'node_modules/**',
      '.next/**',
      'e2e/**',
      ...(integration ? [] : ['**/*.int.test.ts']),
    ],
    passWithNoTests: true,
    fileParallelism: !integration,
  },
});
