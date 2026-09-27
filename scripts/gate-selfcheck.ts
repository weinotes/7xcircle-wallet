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
 * Gate self-check — verifies the guardrails themselves are still armed.
 *
 * Why: from 2026-09-01 to 2026-09-24 every push reported green while zero
 * tests ran. No workspace package defined a `test` script, so `turbo run test`
 * was a no-op, and the root vitest run passed with `--passWithNoTests`. Nothing
 * was broken — but nothing was checked either, and no mechanism existed to
 * notice. A gate that cannot fail is not a gate.
 *
 * Everything else in CI asks "is the code good?". This asks "do the checks
 * still have teeth?" and it is the only part of the pipeline that would have
 * caught that outage.
 *
 * Asserted:
 *   1. every workspace package with src/ declares a test script, or names an
 *      exemption with the reason it is covered elsewhere;
 *   2. --passWithNoTests appears nowhere;
 *   3. coverage thresholds are not below the agreed floors;
 *   4. no workflow step uses an unpinned action;
 *   5. no CI job is empty;
 *   6. the critical path stays inside coverage scope.
 *
 * It fails closed: anything it cannot parse is a failure, not a pass.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const fail: string[] = [];
const need = (ok: boolean, msg: string) => {
  if (!ok) fail.push(msg);
};

// ─── 1. every package says how it is tested ─────────────────────────

/**
 * Packages that deliberately carry no unit tests. Each entry must name what
 * covers the code instead — "no tests yet" is not an acceptable reason, which
 * is the entire point of the check. Removing a package's test script without
 * landing here (or removing the exemption without adding a script) fails.
 */
const TEST_EXEMPT: Record<string, string> = {
  'packages/ui': 'presentational components; exercised through the web e2e specs',
  'apps/web': 'UI surface; covered end-to-end by e2e/landing|onboarding|send.spec.ts',
};

const workspaceDirs = [
  ...readdirSync(join(root, 'apps')).map(d => `apps/${d}`),
  ...readdirSync(join(root, 'packages')).map(d => `packages/${d}`),
].sort();

const pkgScripts = new Map<string, Record<string, string>>();
for (const dir of workspaceDirs) {
  const pkgPath = join(root, dir, 'package.json');
  if (!existsSync(pkgPath)) continue;

  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    scripts = pkg.scripts ?? {};
  } catch (e) {
    fail.push(`${dir}/package.json is not valid JSON: ${String(e)}`);
    continue;
  }
  pkgScripts.set(dir, scripts);

  // A package with no src/ has nothing to unit-test.
  if (!existsSync(join(root, dir, 'src'))) continue;

  const hasTest = typeof scripts.test === 'string' && scripts.test.trim() !== '';
  if (!hasTest && !(dir in TEST_EXEMPT)) {
    fail.push(
      `${dir} has src/ but no "test" script — add one, or record it in TEST_EXEMPT in ` +
      `scripts/gate-selfcheck.ts with the reason it is covered elsewhere. ` +
      `(This is the exact condition that produced the 2026-09 silent test outage.)`,
    );
  }
}

// A stale exemption is its own hazard: it silently re-permits a package to
// ship untested after someone wires up tests and forgets to remove the entry.
for (const dir of Object.keys(TEST_EXEMPT)) {
  if (!pkgScripts.has(dir)) {
    fail.push(`TEST_EXEMPT lists ${dir}, which is not a workspace package — remove the stale entry`);
    continue;
  }
  if (typeof pkgScripts.get(dir)?.test === 'string') {
    fail.push(`${dir} is in TEST_EXEMPT but now has a test script — remove the exemption`);
  }
}

// ─── 2. no test suite may pass by being empty ───────────────────────

const EMPTY_SUITE_ESCAPES = ['--passWithNoTests', 'passWithNoTests: true'];

const filesToScan = [
  'package.json',
  'vitest.config.ts',
  ...workspaceDirs.map(d => `${d}/package.json`),
  ...readdirSync(join(root, '.github', 'workflows')).map(f => `.github/workflows/${f}`),
];

for (const rel of filesToScan) {
  const path = join(root, rel);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  for (const escape of EMPTY_SUITE_ESCAPES) {
    need(
      !text.includes(escape),
      `${rel} uses "${escape}" — a suite that passes with zero tests is not a gate`,
    );
  }
}

// ─── 3. coverage floors have not been lowered ───────────────────────

type Floors = { lines: number; functions: number; branches: number; statements: number };

/** Agreed floors. Keep in sync with vitest.config.ts; this file is the backstop. */
const FLOOR_GLOBAL: Floors = { lines: 78, functions: 75, branches: 78, statements: 78 };
const FLOOR_BY_GLOB: Record<string, Floors> = {
  'packages/core/src/**': { lines: 90, functions: 85, branches: 88, statements: 90 },
  'packages/shared/src/**': { lines: 90, functions: 90, branches: 86, statements: 90 },
  'packages/chains/src/**': { lines: 75, functions: 75, branches: 80, statements: 75 },
};

/**
 * Pull the `thresholds: { ... }` block out of vitest.config.ts by walking
 * braces, so a nested glob entry is not mistaken for a top-level one.
 * Returns null when the block cannot be found — the caller treats that as a
 * failure rather than assuming the floors are fine.
 */
function parseThresholds(src: string): { global: Record<string, number>; byGlob: Record<string, Record<string, number>> } | null {
  const anchor = src.indexOf('thresholds: {');
  if (anchor < 0) return null;

  const open = src.indexOf('{', anchor);
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) return null;

  const body = src.slice(open + 1, close).replace(/\/\/[^\n]*/g, '');

  const global: Record<string, number> = {};
  const byGlob: Record<string, Record<string, number>> = {};

  // Walk the body one entry at a time, tracking brace depth so glob entries
  // are attributed to their own object rather than the global one.
  let i = 0;
  let currentGlob: string | null = null;
  let currentGlobDepth = -1;
  let globValues: Record<string, number> = {};
  let nesting = 0;

  while (i < body.length) {
    const ch = body[i];
    if (ch === '{') { nesting++; i++; continue; }
    if (ch === '}') {
      if (currentGlob !== null && nesting === currentGlobDepth) {
        byGlob[currentGlob] = globValues;
        currentGlob = null;
        currentGlobDepth = -1;
        globValues = {};
      }
      nesting--;
      i++;
      continue;
    }

    const rest = body.slice(i);
    const globKey = /^\s*(['"])([^'"]+)\1\s*:\s*\{/.exec(rest);
    if (globKey) {
      currentGlob = globKey[2];
      nesting++; // the regex consumed the opening brace — account for it
      currentGlobDepth = nesting;
      i += globKey[0].length;
      continue;
    }

    const pair = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(\d+)/.exec(rest);
    if (pair) {
      if (currentGlob !== null) globValues[pair[1]] = Number(pair[2]);
      else global[pair[1]] = Number(pair[2]);
      i += pair[0].length;
      continue;
    }

    i++;
  }

  return { global, byGlob };
}

const configPath = join(root, 'vitest.config.ts');
const parsed = existsSync(configPath) ? parseThresholds(readFileSync(configPath, 'utf8')) : null;

if (!parsed) {
  fail.push('could not parse the thresholds block out of vitest.config.ts — coverage floors are unverified');
} else {
  for (const [metric, floor] of Object.entries(FLOOR_GLOBAL)) {
    const actual = parsed.global[metric];
    need(
      typeof actual === 'number' && actual >= floor,
      `global coverage threshold for ${metric} is ${actual ?? 'missing'} (floor ${floor})`,
    );
  }
  for (const [glob, floors] of Object.entries(FLOOR_BY_GLOB)) {
    const entry = parsed.byGlob[glob];
    if (!entry) {
      fail.push(`coverage threshold for "${glob}" is missing from vitest.config.ts`);
      continue;
    }
    for (const [metric, floor] of Object.entries(floors)) {
      const actual = entry[metric];
      need(
        typeof actual === 'number' && actual >= floor,
        `coverage threshold for ${metric} under "${glob}" is ${actual ?? 'missing'} (floor ${floor})`,
      );
    }
  }
}

// ─── 4 + 5. workflow hardening ──────────────────────────────────────

const SHA_PINNED = /^[0-9a-f]{40}$/;

for (const rel of readdirSync(join(root, '.github', 'workflows')).map(f => `.github/workflows/${f}`)) {
  const text = readFileSync(join(root, rel), 'utf8');

  for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) {
    const ref = match[1];
    const at = ref.lastIndexOf('@');
    const version = at >= 0 ? ref.slice(at + 1) : '';
    need(
      SHA_PINNED.test(version),
      `${rel}: "${ref}" is not pinned to a 40-char commit SHA — a tag can be moved ` +
      `underneath us by the upstream repo`,
    );
  }

  need(
    /^permissions:/m.test(text),
    `${rel}: no top-level "permissions:" block — the job would inherit the default token scope`,
  );

  // Jobs are the 2-space-indented keys under `jobs:`; each must carry steps.
  const jobsStart = text.indexOf('\njobs:');
  if (jobsStart < 0) {
    fail.push(`${rel}: no jobs: block found`);
    continue;
  }
  const jobBlocks = [...text.slice(jobsStart).matchAll(/\n {2}([a-z][\w-]*):\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n|$)/g)];
  need(jobBlocks.length > 0, `${rel}: could not locate any job definitions`);

  for (const [, jobName, body] of jobBlocks) {
    if (!/^\s*steps:/m.test(body)) {
      fail.push(`${rel}: job "${jobName}" has no steps`);
      continue;
    }
    const stepCount = (body.match(/^\s*-\s+(uses|name|run):/gm) ?? []).length;
    need(stepCount > 0, `${rel}: job "${jobName}" has an empty step list`);
  }
}

// ─── 6. the critical path stays in coverage scope ───────────────────

/** Directories holding key material and signing. Losing them from coverage
 *  would let the highest-risk code drift untested while the number stays green. */
const CRITICAL_SCOPES = ['packages/core/src', 'packages/shared/src', 'packages/chains/src'];

if (existsSync(configPath)) {
  const configSrc = readFileSync(configPath, 'utf8');
  // There are two `include: [` arrays in the file — the test-file one comes
  // first. Anchor on the coverage block so the wrong array is never read.
  const covStart = configSrc.indexOf('coverage: {');
  const includeStart = covStart >= 0 ? configSrc.indexOf('include: [', covStart) : -1;
  const includeEnd = includeStart >= 0 ? configSrc.indexOf(']', includeStart) : -1;
  const includeBlock = includeStart >= 0 && includeEnd > includeStart
    ? configSrc.slice(includeStart, includeEnd)
    : '';

  if (!includeBlock) {
    fail.push('could not read coverage.include out of vitest.config.ts');
  } else {
    for (const scope of CRITICAL_SCOPES) {
      need(
        includeBlock.includes(scope),
        `coverage.include no longer covers ${scope} — critical-path code would drift untested`,
      );
    }
  }
}

// ─── verdict ────────────────────────────────────────────────────────

if (fail.length) {
  console.error('✗ gate self-check FAILED — the guardrails are not all armed:');
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `✓ gate self-check OK (${workspaceDirs.length} workspace packages, ${Object.keys(TEST_EXEMPT).length} recorded test exemptions, coverage floors intact, workflows pinned)`,
);
