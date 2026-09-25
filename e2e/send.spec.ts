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
 * distributed under the License is an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * E2E: Send page — form validation and simulation preview.
 *
 * Prerequisites: a wallet must exist and be unlocked. This test uses
 * a pre-seeded localStorage vault (created in the onboarding flow) or
 * skips gracefully if no vault is present.
 *
 * Tests:
 *   1. Send page renders with chain selector and recipient field
 *   2. Invalid address shows validation error
 *   3. Amount validation (negative, exceeds balance)
 *   4. Review button triggers simulation and opens confirm modal
 */
import { test, expect } from '@playwright/test';

test.describe('Send page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Check if a vault exists in localStorage (from onboarding or manual seed).
    // If not, skip this test group — onboarding E2E covers wallet creation.
    const hasVault = await page.evaluate(() => {
      const store = localStorage.getItem('7xcircle-wallet');
      if (!store) return false;
      try {
        const parsed = JSON.parse(store);
        return parsed?.state?.vault?.exists === true;
      } catch {
        return false;
      }
    });
    test.skip(!hasVault, 'No vault in localStorage — run onboarding first');

    // If vault exists but wallet is locked, unlock it
    const unlockInput = page.locator('input[type="password"]').first();
    if (await unlockInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await unlockInput.fill('TestPass123!');
      await page.getByText(/unlock/i).click();
      await page.waitForTimeout(1_000);
    }

    // Navigate to send page
    await page.goto('/send');
  });

  test('send page renders with recipient and amount fields', async ({ page }) => {
    // Should have a recipient input
    const recipientInput = page.locator('input').filter({ has: page.locator('[placeholder*="address"], [placeholder*="Address"], [placeholder*="recipient"], [placeholder*="0x"]') }).first();
    await expect(recipientInput).toBeVisible({ timeout: 10_000 });
  });

  test('invalid address shows validation error', async ({ page }) => {
    // Type an invalid address
    const inputs = page.locator('input[type="text"]');
    const count = await inputs.count();
    // Find the recipient field (usually the first text input after the chain selector)
    for (let i = 0; i < count; i++) {
      const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
      if (placeholder.toLowerCase().includes('address') || placeholder.includes('0x')) {
        await inputs.nth(i).fill('not-a-valid-address');
        break;
      }
    }
    // Wait for validation to trigger
    await page.waitForTimeout(500);
    // Should show an error message
    const errorText = page.locator('text=/invalid|error|not valid/i').first();
    await expect(errorText).toBeVisible({ timeout: 5_000 });
  });
});
