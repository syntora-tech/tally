import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/coverage/**',
      '**/dist/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      'supabase/**',
      'data/**',
      // Vendored shadcn/ui sources; still type-checked by tsc.
      'apps/web/components/ui/**',
      'apps/web/hooks/use-mobile.ts',
    ],
  },
  ...nextVitals.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mjs}'],
    // Explicit React version: eslint-plugin-react's auto-detect calls an API removed in ESLint 10.
    settings: { ...config.settings, next: { rootDir: 'apps/web/' }, react: { version: '19.3' } },
  })),
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Money must never pass through JS floats.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use decimal.js for money; floats are forbidden.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'Use decimal.js for money; floats are forbidden.',
        },
        {
          object: 'Math',
          property: 'round',
          message: 'Use decimal.js rounding (ROUND_HALF_UP) instead.',
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
