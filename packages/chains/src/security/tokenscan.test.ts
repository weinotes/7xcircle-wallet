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
 * GoPlus token-scan contract tests. Response shapes mirrored from the
 * live api.gopluslabs.io token_security payload (string-typed booleans).
 */

import { describe, it, expect } from 'vitest';
import { buildTokenSafetyUrl, parseTokenSafety } from './tokenscan.js';

const CA = '0x55d398326f99059ff775485246999027b3197955';

const payload = (addr: string, fields: Record<string, string>) => ({
  code: 1,
  result: { [addr]: fields },
});

describe('buildTokenSafetyUrl', () => {
  it('lowercases the address and keys by chain id', () => {
    const url = buildTokenSafetyUrl('56', '0x55d398326F99059fF775485246999027B3197955');
    expect(url).toBe(`https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${CA}`);
  });

  it('rejects non-EVM-format addresses', () => {
    expect(() => buildTokenSafetyUrl('56', 'TQrEqo4gDvvHQ2CPeWZRzADYYS1E8k1M7i')).toThrow(/0x EVM/);
    expect(() => buildTokenSafetyUrl('56', '0xdead')).toThrow(/0x EVM/);
  });
});

describe('parseTokenSafety', () => {
  it('clean token produces no warnings', () => {
    const s = parseTokenSafety(payload(CA, {
      is_honeypot: '0', buy_tax: '0', sell_tax: '0',
      is_proxy: '0', is_mintable: '0', transfer_pausable: '0',
      holder_count: '123456',
    }), CA);
    expect(s).not.toBeNull();
    expect(s!.warnings).toEqual([]);
    expect(s!.holders).toBe(123456);
  });

  it('honeypot + taxes aggregate into loud warnings', () => {
    const s = parseTokenSafety(payload(CA, {
      is_honeypot: '1', buy_tax: '0.25', sell_tax: '0.5',
      is_mintable: '1', is_proxy: '0', transfer_pausable: '0',
    }), CA);
    expect(s!.honeypot).toBe(true);
    expect(s!.warnings.join(' ')).toMatch(/honeypot/);
    expect(s!.warnings.join(' ')).toMatch(/buy tax \(25%\)/);
    expect(s!.warnings.join(' ')).toMatch(/sell tax \(50%\)/);
    expect(s!.warnings.join(' ')).toMatch(/mintable/);
  });

  it('case-insensitive result lookup by address', () => {
    const s = parseTokenSafety(
      payload(CA.toUpperCase().replace('0X', '0x'), { is_honeypot: '0' }),
      CA.toUpperCase().replace('0X', '0x'),
    );
    expect(s).not.toBeNull();
  });

  it('missing entry degrades to null (= no data), never "safe"', () => {
    expect(parseTokenSafety({ code: 1, result: {} }, CA)).toBeNull();
    expect(parseTokenSafety({ result: null }, CA)).toBeNull();
  });

  it('garbage tax strings do not crash the verdict', () => {
    const s = parseTokenSafety(payload(CA, { buy_tax: 'N/A', is_honeypot: '0' }), CA);
    expect(s!.buyTaxPct).toBe(0);
  });
});
