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
 * Vault secret envelope tests — the compat contract between old vaults
 * (bare mnemonic plaintext) and new ones (JSON envelope). Getting this
 * wrong bricks existing installs, so every branch is asserted.
 */

import { describe, it, expect } from 'vitest';
import { decodeVaultSecret, encodeVaultSecret } from './secret.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('encodeVaultSecret / decodeVaultSecret', () => {
  it('mnemonic envelope round-trips', () => {
    const s = encodeVaultSecret({ kind: 'mnemonic', mnemonic: PHRASE });
    expect(decodeVaultSecret(s)).toEqual({ kind: 'mnemonic', mnemonic: PHRASE });
  });

  it('keys envelope round-trips with nicknames', () => {
    const keys = [
      { family: 'evm' as const, privateKey: '0x' + '01'.repeat(32) },
      { family: 'solana' as const, privateKey: '11111111111111111111111111111118', nickname: 'phantom' },
    ];
    expect(decodeVaultSecret(encodeVaultSecret({ kind: 'keys', keys })))
      .toEqual({ kind: 'keys', keys });
  });

  it('legacy bare-mnemonic plaintext decodes as a mnemonic (no migration needed)', () => {
    expect(decodeVaultSecret(PHRASE)).toEqual({ kind: 'mnemonic', mnemonic: PHRASE });
    expect(decodeVaultSecret('  ' + PHRASE + '  ')).toEqual({ kind: 'mnemonic', mnemonic: PHRASE });
  });

  it('non-envelope JSON is rejected loudly, not silently mis-parsed', () => {
    expect(() => decodeVaultSecret('{"hello":"world"}')).toThrow(/unrecognized/);
  });

  it('corrupt JSON starting with { falls back to legacy interpretation', () => {
    // a legacy phrase can never START with '{' unless data is broken; the
    // fallback keeps it readable rather than throwing on old installs
    expect(decodeVaultSecret('{not json')).toEqual({ kind: 'mnemonic', mnemonic: '{not json' });
  });
});
