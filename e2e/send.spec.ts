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
 * E2E: Send page — form rendering and validation.
 *
 * No vault is ever shared across tests (Playwright isolates browser
 * contexts, and the wallet intentionally does not persist `unlocked`), so
 * each test seeds its own wallet through onboarding, reloads to /send, and
 * unlocks through the real Unlock screen. That also gives this spec real
 * coverage of the lock → unlock round trip.
 */
import { test, expect } from '@playwright/test';
import { createWalletAndUnlock, unlockWallet } from './helpers';

test.describe('Send page', () => {
  test.beforeEach(async ({ page }) => {
    await createWalletAndUnlock(page);
    // Full reload → the wallet re-locks; unlock again via the real screen
    await page.goto('/send');
    await unlockWallet(page);
  });

  test('send page renders with recipient and amount fields', async ({ page }) => {
    await expect(page.getByTestId('send-recipient')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('send-amount')).toBeVisible();
  });

  test('invalid address shows validation error', async ({ page }) => {
    const recipient = page.getByTestId('send-recipient');
    await expect(recipient).toBeVisible({ timeout: 15_000 });
    await recipient.fill('not-a-valid-address');
    // Address validation is synchronous on the resolved `toAddress`. Match
    // the alert role, not the literal copy — the message names the chain
    // family ("Invalid EVM address") and would break on copy tweaks.
    await expect(page.getByRole('alert').filter({ hasText: /invalid/i }))
      .toBeVisible({ timeout: 5_000 });
  });
});
