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
 * Landing page (`/`) vs wallet app (`/app`) mount-split tests. Guards the
 * invariant that visitors first meet the PROJECT, and the wallet lives one
 * click away — including the redirect for legacy deep links.
 */
import { test, expect } from '@playwright/test';

test.describe('Project landing page', () => {
  test('shows the pitch, the CTA and the alpha warning — not the wallet form', async ({ page }) => {
    await page.goto('/');
    // Two CTAs exist by design (hero + download card) — assert the first
    await expect(page.getByRole('link', { name: 'Launch Wallet' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /View on GitHub/ })).toBeVisible();
    await expect(page.getByText(/do not store significant funds/i)).toBeVisible();
    // The onboarding form must NOT be on the landing route
    await expect(page.getByTestId('onboarding-create')).toHaveCount(0);
  });

  test('CTA lands on the real wallet entry', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Launch Wallet' }).first().click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId('onboarding-create')).toBeVisible();
  });

  test('legacy deep links forward into /app (pre-landing URLs keep working)', async ({ page }) => {
    await page.goto('/send');
    // No vault exists in this context, so the wallet guard shows onboarding
    // — but the URL must have been rewritten under /app, not hit the landing.
    await expect(page).toHaveURL(/\/app\/send/);
    await expect(page.getByTestId('onboarding-create')).toBeVisible();
  });
});
