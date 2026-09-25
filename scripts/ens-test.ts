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
 * Live ENS resolution probe — hits a public mainnet RPC, no keys needed.
 * Run: npx tsx scripts/ens-test.ts
 */
import { resolveEnsName, isEnsName, namehash } from '../packages/chains/src/naming/ens.js';

// EIP-137 shape checks
console.log('namehash(eth) =', namehash('eth'));
console.assert(
  namehash('eth') === '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae',
  'namehash(eth) drifted from the viem/ens cross-vector',
);

// Live mainnet resolution
async function main(): Promise<void> {
  const known = await resolveEnsName('vitalik.eth');
  console.log('vitalik.eth ->', known);
  if (known?.toLowerCase() !== '0xd8da6bf26964af9d7eed9e03e53415d37aa96045') {
    console.error('FAIL: vitalik.eth did not resolve to its well-known address');
    process.exit(1);
  }

  const bogus = await resolveEnsName('this-name-cannot-exist-9x7.eth');
  console.log('bogus name ->', bogus);
  if (bogus !== null) {
    console.error('FAIL: unowned name must resolve to null');
    process.exit(1);
  }

  console.assert(isEnsName('vitalik.eth') && !isEnsName('vitalik.com'), 'isEnsName gate broken');
  console.log('OK — live ENS wire contract verified');
}

void main();
