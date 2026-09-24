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
 * Solana send-flow integration test — runs SolanaAdapter against devnet.
 *
 * Modes:
 *   MODE=generate   Print a new random devnet mnemonic + address, exit.
 *   (default)       Read SOLANA_MNEMONIC env, airdrop 2 devnet SOL if the
 *                   balance is 0, then send a 0.001 SOL self-transfer via
 *                   the real SolanaAdapter (build → sign → send → confirm).
 *
 * Usage:
 *   MODE=generate pnpm tsx scripts/solana-test.ts
 *   SOLANA_MNEMONIC="..." pnpm tsx scripts/solana-test.ts
 */

import { deriveSolanaPrivateKey, solanaPublicKey, createMnemonic } from '../packages/core/src/keys/mnemonic.js';
import { SolanaAdapter } from '../packages/chains/src/solana/adapter.js';
import { PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { ChainConfig } from '@open-wallet/shared';

/** Devnet config (not in CHAIN_CONFIGS — mainnet-only there) */
const DEVNET_CONFIG: ChainConfig = {
  chainId: 'solana-devnet',
  name: 'Solana Devnet',
  type: 'solana',
  nativeSymbol: 'SOL',
  nativeDecimals: 9,
  rpcs: ['https://api.devnet.solana.com', 'https://mango.devnet.rpcpool.com'],
  explorer: 'https://explorer.solana.com',
  bip44Path: "m/44'/501'/0'/0'",
  icon: 'solana',
  testnet: true,
};

const SOLANA_PATH = "m/44'/501'/0'/0'";

async function sleep(ms: number) { await new Promise(r => setTimeout(r, ms)); }

async function airdrop(address: string, sol: number): Promise<boolean> {
  const conn = new Connection(DEVNET_CONFIG.rpcs[0], 'confirmed');
  try {
    const sig = await conn.requestAirdrop(new PublicKey(address), sol * LAMPORTS_PER_SOL);
    console.log('   Airdrop sig:', sig);
    return true;
  } catch (e: any) {
    console.log('   Airdrop failed:', e.message || e);
    return false;
  }
}

async function main() {
  const mode = process.env.MODE;
  if (mode === 'generate') {
    const mnemonic = createMnemonic();
    const pk = deriveSolanaPrivateKey(mnemonic, SOLANA_PATH);
    const addr = new PublicKey(solanaPublicKey(pk)).toBase58();
    console.log('============================================');
    console.log('  NEW DEVNET SOLANA ACCOUNT');
    console.log('============================================');
    console.log('Mnemonic:', mnemonic);
    console.log('Address :', addr);
    console.log('');
    console.log(`  SOLANA_MNEMONIC="${mnemonic}" pnpm tsx scripts/solana-test.ts`);
    console.log('');
    console.log('⚠️  Throw-away test mnemonic — devnet only.');
    return;
  }

  const mnemonic = process.env.SOLANA_MNEMONIC?.trim();
  if (!mnemonic) {
    console.error('❌  SOLANA_MNEMONIC env var is required (run MODE=generate first).');
    process.exit(1);
  }

  const pk = deriveSolanaPrivateKey(mnemonic, SOLANA_PATH);
  const fromPubkey = new PublicKey(solanaPublicKey(pk));
  const from = fromPubkey.toBase58();

  const adapter = new SolanaAdapter(DEVNET_CONFIG);
  const conn = new Connection(DEVNET_CONFIG.rpcs[0], 'confirmed');

  console.log('============================================');
  console.log('  SOLANA SEND FLOW — DEVNET');
  console.log('============================================');
  console.log('From:', from);

  // ── Step 0: balance + airdrop if needed ────────────────────────
  console.log('\n[0/5] Checking balance...');
  let bal = await adapter.getNativeBalance(from);
  console.log(`   Balance: ${(Number(bal) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (Number(bal) === 0) {
    console.log('   Airdropping 2 SOL (mango devnet rpc pool)...');
    await airdrop(from, 2);
    for (let i = 0; i < 10; i++) {
      await sleep(3000);
      bal = await adapter.getNativeBalance(from);
      if (Number(bal) > 0) break;
    }
    console.log(`   Balance after airdrop: ${(Number(bal) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }
  if (Number(bal) === 0) {
    console.error('❌  Airdrop did not arrive — try again or use https://faucet.solana.com');
    process.exit(1);
  }

  // ── Step 1: build ──────────────────────────────────────────────
  console.log('\n[1/5] Building transaction...');
  const feeTier = (process.env.FEE_TIER as 'slow' | 'normal' | 'fast') ?? 'normal';
  const intent = {
    kind: 'native-transfer' as const,
    to: from,                                                  // self-send
    amountRaw: Math.floor(0.001 * LAMPORTS_PER_SOL).toString(),
  };

  // Estimated fee first — this is the cheap, no-simulation path the UI uses
  const estimate = await adapter.estimateFees(intent, { from, feeTier });
  console.log(`   Estimated fee: ${estimate.totalFee} lamports (tier: ${estimate.level})`);
  console.log(`   Priority price: ${estimate.gasPrice} micro-lamports/CU`);

  const rawTx = await adapter.buildTransaction(intent, { from, feeTier });
  if (rawTx.chainType !== 'solana') throw new Error('Expected a Solana transaction');
  console.log('   chainId:', rawTx.chainId);
  console.log('   versioned:', rawTx.versioned);
  console.log('   blockhash:', rawTx.recentBlockhash);
  console.log('   valid until block height:', rawTx.lastValidBlockHeight);

  // ── Step 2: sign ───────────────────────────────────────────────
  console.log('\n[2/5] Signing with ed25519 keypair (SLIP-0010)...');
  const signed = await adapter.signTransaction(rawTx, pk);
  console.log('   ✅  Signature:', signed.signature.slice(0, 24) + '...');

  // ── Step 3: send ───────────────────────────────────────────────
  console.log('\n[3/5] Sending to devnet...');
  const hash = await adapter.sendTransaction(signed);
  console.log('   TxHash:', hash);
  console.log('   Explorer:', adapter.getExplorerTxUrl(hash));

  // ── Step 4: confirm ────────────────────────────────────────────
  console.log('\n[4/5] Waiting for confirmation (poll every 3s)...');
  let status = '';
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    // getSignatureStatus (singular) returns ONE status — the previous
    // `resp.value?.[0]` indexed it as an array, yielded undefined every
    // time, and so this loop never actually detected confirmation.
    const resp = await conn.getSignatureStatus(hash, { searchTransactionHistory: true });
    const s = resp.value;
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
      status = s.confirmationStatus;
      break;
    }
    if (s?.err) { status = 'failed'; break; }
  }
  console.log('   status:', status || 'unknown (check explorer)');

  const finalBal = await adapter.getNativeBalance(from);
  console.log(`\n   Balance before: ${(Number(bal) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`   Balance after : ${(Number(finalBal) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`   Delta         : ${((Number(finalBal) - Number(bal)) / LAMPORTS_PER_SOL).toFixed(6)} SOL (0.001 + fee)`);

  if (status) {
    console.log(`\n${status === 'failed' ? '💥  Transaction failed' : '🎉  CONFIRMED on Solana devnet!'}`);
  }
}

main().catch(e => {
  console.error('❌  Fatal:', e.message || e);
  process.exit(1);
});
