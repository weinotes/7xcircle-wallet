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
import { describe, it, expect } from 'vitest';
import { isNewer } from './update';

describe('isNewer (update check)', () => {
  it('handles the v-prefix and equal versions', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false);
  });

  it('compares numerically, not lexically', () => {
    expect(isNewer('1.10.0', '1.9.0')).toBe(true);
    expect(isNewer('1.9.0', '1.10.0')).toBe(false);
    expect(isNewer('10.0.0', '2.0.0')).toBe(true);
    expect(isNewer('2.0.0', '10.0.0')).toBe(false);
  });

  it('falls through to patch and minor when majors tie', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('1.1.0', '1.0.9')).toBe(true);
  });

  it('tolerates malformed segments without crashing', () => {
    expect(isNewer('v1.x.3', '1.0.0')).toBe(true); // x→0, 3>0
    expect(isNewer('', '0.0.1')).toBe(false);
  });
});
