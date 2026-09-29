import { defineConfig } from 'vitest/config';

const integration = process.env.VITEST_INTEGRATION === '1';

export default defineConfig({
  test: {
    include: integration ? ['test/**/*.int.test.ts'] : ['test/**/*.test.ts'],
    exclude: integration ? [] : ['test/**/*.int.test.ts'],
    passWithNoTests: true,
  },
});
