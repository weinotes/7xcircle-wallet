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
 * Node globals polyfill — MUST BE THE FIRST IMPORT of any entry module.
 *
 * Two past bugs this file kills:
 *   1. ES import hoisting: writing the Buffer assignment inside main.tsx's
 *      body does nothing — the App import (→ @solana/spl-token, which calls
 *      Buffer.from at module TOP LEVEL) already ran → white screen.
 *   2. buffer@6 is CJS-UMD: a named `import { Buffer } from 'buffer'`
 *      resolves to undefined through Vite's optimize interop → the polyfill
 *      assigned undefined. Default-import the namespace and pull .Buffer.
 *
 * Keep this module dependency-free and side-effect-only.
 */

import bufferPkg from 'buffer';

const g = globalThis as Record<string, unknown>;

const BufferImpl = (bufferPkg as { Buffer?: unknown }).Buffer ?? bufferPkg;
if (typeof g.Buffer === 'undefined') {
  g.Buffer = BufferImpl;
}

// Minimal process shim for libs checking process.version / process.env
// (bip39 & co). Vite statically replaces import.meta.env for real config;
// this only satisfies `typeof process !== 'undefined'` feature probes.
if (typeof g.process === 'undefined') {
  g.process = { env: {}, version: '', browser: true };
}

export {};
