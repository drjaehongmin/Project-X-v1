/**
 * ESLint config for the EMR monorepo.
 *
 * The boundaries plugin enforces the import graph documented in CLAUDE.md and
 * ARCHITECTURE.md. The graph is:
 *
 *   contracts   -> (nothing)
 *   module-sdk  -> contracts
 *   shared      -> contracts
 *   services    -> contracts, shared
 *   data-client -> contracts
 *   backend     -> contracts (no frontend layers)
 *   modules/*   -> contracts, module-sdk, shared, same-module
 *   shell       -> contracts, module-sdk, shared, services, data-client, modules/* (entry only)
 *
 * Same-element imports (intra-package) are always allowed; sibling-module
 * imports and any direct module->shell or module->services imports are
 * forbidden and will fail the build. For `modules/*`, the captured `name`
 * is used to allow same-module imports while still forbidding cross-module
 * traffic.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'import', 'boundaries'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: [
          'packages/*/tsconfig.json',
          'packages/modules/*/tsconfig.json',
        ],
      },
      node: true,
    },
    'boundaries/include': ['packages/**/*'],
    'boundaries/elements': [
      { type: 'contracts',  pattern: 'packages/contracts/**/*' },
      { type: 'module-sdk', pattern: 'packages/module-sdk/**/*' },
      { type: 'shared',     pattern: 'packages/shared/**/*' },
      { type: 'services',   pattern: 'packages/services/**/*' },
      { type: 'data-client', pattern: 'packages/data-client/**/*' },
      { type: 'backend',    pattern: 'packages/backend/**/*' },
      { type: 'module',     pattern: 'packages/modules/*/**/*', capture: ['name'] },
      { type: 'shell',      pattern: 'packages/shell/**/*' },
    ],
  },
  rules: {
    // Match TypeScript's `noUnusedParameters` convention: a leading
    // underscore marks a parameter as intentionally unused (stub
    // signatures, interface conformance). Also applies to locals/vars.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    'boundaries/no-unknown': 'error',
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: [
          { from: 'contracts',  allow: ['contracts'] },
          { from: 'module-sdk', allow: ['contracts', 'module-sdk'] },
          { from: 'shared',     allow: ['contracts', 'shared'] },
          { from: 'services',   allow: ['contracts', 'shared', 'services'] },
          { from: 'data-client', allow: ['contracts', 'data-client'] },
          {
            // The backend is its own top-level area; it depends on
            // shared contract types but never on any frontend layer
            // (modules, shell, module-sdk, services, data-client).
            from: 'backend',
            allow: ['contracts', 'backend'],
          },
          {
            from: [['module', { name: '*' }]],
            allow: [
              'contracts',
              'module-sdk',
              'shared',
              ['module', { name: '${from.name}' }],
            ],
          },
          {
            // The shell imports each registered module's public entry
            // (its `src/index.ts`) by package name. Reaching into a
            // module's internals is a code-review concern, not enforced
            // here — package.json `main`/`exports` controls what is
            // resolvable, and `registered.ts` is the only file in the
            // shell that imports from a module package.
            from: 'shell',
            allow: [
              'contracts',
              'module-sdk',
              'shared',
              'services',
              'data-client',
              'shell',
              'module',
            ],
          },
        ],
      },
    ],
  },
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    '**/*.cjs',
    '**/*.config.*',
  ],
};
