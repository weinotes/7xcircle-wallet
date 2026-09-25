/**
 * Copyright 2026 Davey Wong <wgwcko@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Workspace-wide ESLint flat config.
 *
 * One config at the root covers every package — each package runs
 * `eslint src`, so ESLint resolves this file by walking up from the linted
 * directory. Keeping it in one place avoids eight drifting rule sets.
 *
 * Policy: correctness rules stay errors, style-leaning rules are warnings.
 * `pnpm lint` must exit 0 on the current tree, so noisy rules must not fail
 * the build. TypeScript already owns unused-symbol and undefined-name
 * checks, so the ESLint equivalents are relaxed to avoid double reporting.
 */

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Build artifacts and generated native projects are never linted.
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
    ],
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      // Wallet code touches `localStorage` and `process.env` from the same
      // source file depending on the platform bundle, so both global sets
      // are exposed rather than split per package.
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // TypeScript's compiler is authoritative here; `no-undef` only
      // produces false positives on type-only syntax.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // `catch {}` blocks are a deliberate pattern in the failover paths.
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  {
    // React apps only — rules-of-hooks is a real correctness check, the
    // dependency rule is advisory because several effects are intentionally
    // keyed on a subset of their inputs.
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // React Native exposes `__DEV__` as a bundle-time global.
    files: ['apps/mobile/**/*.{ts,tsx}'],
    languageOptions: { globals: { __DEV__: 'readonly' } },
  },
);