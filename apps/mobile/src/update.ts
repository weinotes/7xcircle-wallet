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
 * Version compare for the in-app update check — pure and unit-tested so a
 * tag-format mistake ("v1.10" vs "1.9") can never ship as a fake update.
 */

/** "0.1.0" vs "v0.2.0" → strict numeric compare, tolerant of tag prefixes */
export function isNewer(remote: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(n => Number(n) || 0);
  const [ra = 0, rb = 0, rc = 0] = parse(remote);
  const [ca = 0, cb = 0, cc = 0] = parse(current);
  return ra > ca || (ra === ca && rb > cb) || (ra === ca && rb === cb && rc > cc);
}
