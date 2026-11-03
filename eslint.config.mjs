import tseslint from 'typescript-eslint';

export default tseslint.config(
  tseslint.configs.recommended,
  {
    ignores: [
      'agentsEye.mjs',
      'dev/**',
      'scripts/**',
      'node_modules/**',
      '.agentsEye/**',
      'docs/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-control-regex': 'off',
      'prefer-const': 'warn',
    },
  },
);
