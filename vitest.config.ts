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
 * distributed under the License is an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run all test files across the monorepo.
    //
    // NOTE: this pattern must work from BOTH the repo root (coverage job)
    // and each package's own cwd (the turbo `test` task). Vitest resolves
    // `include` against the current root; when a package runs `vitest run`
    // from its own directory it finds this config via upward lookup but
    // keeps its own cwd as root — so a repo-root-relative pattern like
    // `packages/*/src/**` would match nothing and fail the suite with
    // "No test files found". `**/src/**` matches in both contexts.
    include: [
      '**/src/**/*.test.ts',
    ],
    // Exclude dist, node_modules, and E2E tests
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
    ],
    // PBKDF2 with 200k iterations is CPU-intensive; coverage instrumentation
    // adds overhead. 15 s prevents spurious timeouts on slow CI runners.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      // Instrument pure-logic source files. UI components (apps/web/src/pages)
      // and I/O-heavy adapters are excluded — they're tested via E2E and
      // integration probes, not unit coverage.
      include: [
        'packages/core/src/**/*.ts',
        'packages/shared/src/**/*.ts',
        'packages/chains/src/**/*.ts',
      ],
      // Exclude test files, types-only files, config, and I/O-heavy
      // chain adapters (better tested via E2E/integration) from coverage
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
        '**/types.ts',
        // Types-only interface files that don't match `types.ts`: v8 reports
        // them as 0/0, which reads as "untested" in the report even though
        // there is nothing executable in them.
        'packages/core/src/chain/adapter.ts',
        '**/config.ts',
        '**/constants.ts',
        '**/polyfills.ts',
        '**/setup.ts',
        'apps/web/src/main.tsx',
        'apps/web/src/App.tsx',
        // Chain adapters are I/O wrappers (RPC, signing, broadcast) —
        // they're tested via integration probes in scripts/ and E2E.
        // Including them here would penalise the project for not mocking
        // network calls, which is the wrong signal.
        'packages/chains/src/evm/adapter.ts',
        'packages/chains/src/solana/adapter.ts',
        'packages/chains/src/tron/adapter.ts',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
      // Minimum coverage thresholds — CI fails if below these
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
