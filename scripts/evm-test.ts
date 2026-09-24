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
 * EVM send-flow integration test — runs EvmAdapter against BSC Testnet.
 *
 * Modes:
 *   MODE=generate   Print a new random test private key + address, exit.
 *   (default)       Read PRIVATE_KEY env, send a self-transfer of 0.0001 tBNB
 *                   via the real EvmAdapter (build → sign → broadcast → poll).
 *
 * Optional env:
 *   FEE_TIER   slow | normal | fast (default: fast).
 *              BSC testnet validators IGNORE floor-price txs (~0.1 gwei,
 *              what the RPC suggests) — they sit in the mempool forever.
 *              The fast tier raises the priority fee enough to get mined.
 *
 * Usage:
 *   # Step 1 — generate a test address
 *   MODE=generate pnpm tsx scripts/evm-test.ts
 *
 *   # Step 2 — go to https://faucet.bnbchain.org and paste the address,
 *   #           claim ~0.1 tBNB, wait ~1 min.
 *
 *   # Step 3 — run the send test
 *   PRIVATE_KEY=0xabc... pnpm tsx scripts/evm-test.ts
 */

import { randomBytes } from 'node:crypto';
import { EvmAdapter } from '../packages/chains/src/evm/adapter.js';
import { getChainConfig } from '../packages/chains/src/configs.js';
import { privateKeyToAccount } from 'viem/accounts';

// ── Helpers ────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array, prefix = true): string {
  const h = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `0x${h}` : h;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

function generateRandomPrivateKey(): Uint8Array {
  // Node crypto.randomBytes is CSPRNG
  const bytes = randomBytes(32);
  // Ensure it's a valid secp256k1 private key (< curve order)
  // 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
  // Simplest: clear the top bit so key < 2^255 < curve order
  bytes[0] = bytes[0] & 0x7f;
  return new Uint8Array(bytes);
}

function privateKeyToEvmAddress(pk: Uint8Array): string {
  const acc = privateKeyToAccount(bytesToHex(pk, true) as `0x${string}`);
  return acc.address;
}

async function sleep(ms: number) { await new Promise(r => setTimeout(r, ms)); }

// ── Generate mode ──────────────────────────────────────────────────

function runGenerateMode() {
  const pk = generateRandomPrivateKey();
  const addr = privateKeyToEvmAddress(pk);

  console.log('============================================');
  console.log('  NEW TEST ACCOUNT');
  console.log('============================================');
  console.log('Address:    ', addr);
  console.log('PrivateKey: ', bytesToHex(pk, true));
  console.log('');
  console.log('➡️  Go to https://faucet.bnbchain.org');
  console.log('   Paste the address above, claim ~0.1 tBNB.');
  console.log('   Wait ~1 min for it to arrive, then run:');
  console.log('');
  console.log(`   PRIVATE_KEY=${bytesToHex(pk, true)} pnpm tsx scripts/evm-test.ts`);
  console.log('');
  console.log('⚠️  This is a throw-away test key — do NOT use for real funds.');
}

// ── Send mode ──────────────────────────────────────────────────────

async function runSendMode() {
  const pkHex = process.env.PRIVATE_KEY?.trim();
  if (!pkHex) {
    console.error('❌  PRIVATE_KEY env var is required for send mode.');
    console.error('   Run MODE=generate first, or export your own key.');
    process.exit(1);
  }

  const pkBytes = hexToBytes(pkHex);
  if (pkBytes.length !== 32) {
    console.error(`❌  PRIVATE_KEY must be 32 bytes (got ${pkBytes.length})`);
    process.exit(1);
  }

  const bsc97Config = getChainConfig('bsc-97');
  if (!bsc97Config) { console.error('❌  bsc-97 config not found'); process.exit(1); }

  const adapter = new EvmAdapter(bsc97Config);
  const acc = privateKeyToAccount(bytesToHex(pkBytes, true) as `0x${string}`);
  const from = acc.address;

  console.log('============================================');
  console.log('  EVM SEND FLOW — BSC TESTNET (97)');
  console.log('============================================');
  console.log('From:       ', from);

  // ── Step 0: Check balance ────────────────────────────────────────
  console.log('\n[0/5] Checking balance...');
  const bal = BigInt(await adapter.getNativeBalance(from));
  console.log('   Balance:', bal.toString(), 'wei (', (Number(bal) / 1e18).toFixed(6), 'tBNB )');

  if (bal === 0n) {
    console.error('❌  Balance is 0 — faucet hasn\'t arrived yet?');
    console.error('   Claim from https://faucet.bnbchain.org and wait 1-2 minutes.');
    process.exit(1);
  }

  // ── Step 1: Estimate fees ───────────────────────────────────────
  console.log('\n[1/5] Estimating fees...');
  const toAmount = BigInt(100_000_000_000_000); // 0.0001 tBNB in wei

  // BSC testnet validators ignore floor-price txs and the tx sits in the
  // mempool forever, so default to the fast tier here. This replaces the
  // old GAS_PRICE_MULTIPLIER post-hoc mutation of maxFeePerGas.
  const feeTier = (process.env.FEE_TIER as 'slow' | 'normal' | 'fast') ?? 'fast';
  const intent = {
    kind: 'native-transfer' as const,
    to: from, // self-transfer for simplicity
    amountRaw: toAmount.toString(),
  };
  const buildOpts = { from, feeTier };

  const fees = await adapter.estimateFees(intent, buildOpts);
  const gasPrice = BigInt(fees.gasPrice);
  const gasLimit = BigInt(fees.gasLimit);
  const feeTotal = gasPrice * gasLimit;
  console.log('   tier     :', fees.level);
  console.log('   gasPrice :', gasPrice.toString(), 'wei');
  console.log('   gasLimit :', gasLimit.toString());
  console.log('   totalFee :', feeTotal.toString(), 'wei (', (Number(feeTotal) / 1e18).toFixed(8), 'tBNB )');

  if (bal < toAmount + feeTotal) {
    console.error('❌  Insufficient balance: need', (toAmount + feeTotal).toString(), 'have', bal.toString());
    console.error('   Top up with more tBNB first.');
    process.exit(1);
  }

  // ── Step 2: Build transaction ────────────────────────────────────
  console.log('\n[2/5] Building transaction (fill nonce, estimate gas)...');
  const rawTx = await adapter.buildTransaction(intent, buildOpts);
  if (rawTx.chainType !== 'evm') throw new Error('Expected an EVM transaction');
  console.log('   nonce        :', rawTx.nonce);
  console.log('   gasLimit     :', rawTx.gasLimit);
  console.log('   maxFeePerGas :', rawTx.maxFeePerGas);
  console.log('   chainId      :', rawTx.chainId);

  // ── Step 3: Sign ──────────────────────────────────────────────────
  console.log('\n[3/5] Signing with transient private key...');
  const signed = await adapter.signTransaction(rawTx, pkBytes);
  if (!signed.signature || signed.signature.length < 20) {
    console.error('❌  Signature looks invalid:', signed.signature);
    process.exit(1);
  }
  console.log('   ✅  Signature produced (', signed.signature.length, 'chars)');

  // ── Step 4: Broadcast ─────────────────────────────────────────────
  console.log('\n[4/5] Broadcasting to BSC Testnet...');
  const hash = await adapter.sendTransaction(signed);
  console.log('   ✅  TxHash:', hash);
  console.log('   Explorer : https://testnet.bscscan.com/tx/' + hash);

  // ── Step 5: Poll for confirmation ────────────────────────────────
  console.log('\n[5/5] Waiting for confirmation (poll every 3s)...');
  let status: 'pending' | 'confirmed' | 'failed' = 'pending';
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    status = await adapter.getTransactionStatus(hash);
    const dot = '.'.repeat(i % 3 + 1);
    process.stdout.write(`   ${status}${dot}\r`);
    if (status === 'confirmed' || status === 'failed') break;
  }
  console.log('');

  if (status === 'confirmed') {
    console.log('\n🎉  CONFIRMED on BSC Testnet!');
    console.log('    https://testnet.bscscan.com/tx/' + hash);
  } else if (status === 'failed') {
    console.log('\n💥  Transaction reverted!');
    console.log('    https://testnet.bscscan.com/tx/' + hash);
  } else {
    console.log('\n⏳  Still pending after ~2 min — check manually:');
    console.log('    https://testnet.bscscan.com/tx/' + hash);
  }

  // Final balance
  const finalBal = BigInt(await adapter.getNativeBalance(from));
  console.log('\n   Balance before:', bal.toString());
  console.log('   Balance after :', finalBal.toString());
  console.log('   Difference    :', (bal - finalBal).toString(), 'wei (includes gas)');
}

// ── Entry ─────────────────────────────────────────────────────────

const mode = process.env.MODE;
if (mode === 'generate') {
  runGenerateMode();
} else {
  runSendMode().catch(e => {
    console.error('❌  Fatal:', e.message || e);
    process.exit(1);
  });
}
