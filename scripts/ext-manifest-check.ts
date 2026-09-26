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
 * Extension dist manifest integrity check — run in CI right after the build.
 *
 * Why: Chrome REFUSES to load an unpacked extension whose manifest declares
 * `default_locale` without a sibling `_locales/` directory. That exact bug
 * shipped unnoticed because the manual chrome://extensions smoke was always
 * deferred — the build was green while the extension could never install.
 * This script catches that class of problem mechanically.
 *
 * Checks on apps/extension/dist/manifest.json:
 *   1. valid strict JSON;
 *   2. default_locale ⇒ _locales/<locale>/messages.json exists;
 *   3. every referenced file exists (background, popup, content scripts,
 *      web-accessible resources);
 *   4. popup.html exists;
 *   5. no leftover __MSG_ placeholders if default_locale is absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const distDir = join(root, 'apps', 'extension', 'dist');
const manifestPath = join(distDir, 'manifest.json');

const fail: string[] = [];
const need = (ok: boolean, msg: string) => {
  if (!ok) fail.push(msg);
};

if (!existsSync(manifestPath)) {
  console.error(`✗ ${manifestPath} missing — did the extension build run?`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  background?: { service_worker?: string };
  action?: { default_popup?: string };
  content_scripts?: { js?: string[] }[];
  web_accessible_resources?: { resources?: string[] }[];
  default_locale?: string;
};

// 2 — default_locale ⇔ _locales
if (manifest.default_locale) {
  need(
    existsSync(join(distDir, '_locales', manifest.default_locale, 'messages.json')),
    `manifest declares default_locale "${manifest.default_locale}" but _locales/${manifest.default_locale}/messages.json is missing — Chrome will refuse to load the extension`,
  );
}

// 3 — referenced scripts/pages all present in dist
const refs: string[] = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.content_scripts ?? []).flatMap(c => c.js ?? []),
  ...(manifest.web_accessible_resources ?? []).flatMap(r => r.resources ?? []),
].filter((x): x is string => Boolean(x));
for (const ref of refs) {
  need(existsSync(join(distDir, ref)), `manifest references ${ref} but it is not in dist/`);
}

// 4/5 — placeholders
const popupPath = join(distDir, manifest.action?.default_popup ?? '__none__');
if (existsSync(popupPath)) {
  const popup = readFileSync(popupPath, 'utf8');
  need(!popup.includes('__MSG_'), 'popup.html still contains an unresolved __MSG_ placeholder');
}

if (fail.length) {
  console.error('✗ extension manifest integrity FAILED:');
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ extension dist manifest integrity OK (${refs.length} referenced files, dirname ${dirname(manifestPath)})`);
