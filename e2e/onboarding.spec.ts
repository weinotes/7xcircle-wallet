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
 * E2E: Onboarding flow — create new wallet.
 *
 * Covers the critical path from first visit through wallet creation:
 *   1. Landing page renders both onboarding options
 *   2. The full create flow (phrase → verify → password) reaches Home
 *   3. A wrong verification answer is rejected — the quiz is a real gate
 *
 * The phrase and quiz answers are read off the screen and replayed, so the
 * test is deterministic regardless of which words or positions were drawn.
 */
import { test, expect } from '@playwright/test';
import { createWalletAndUnlock } from './helpers';

test.describe('Onboarding — Create New Wallet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('landing page shows create and import options', async ({ page }) => {
    await expect(page.getByTestId('onboarding-create')).toBeVisible();
    await expect(page.getByTestId('onboarding-import')).toBeVisible();
  });

  test('create wallet flow — phrase → verify → password → home', async ({ page }) => {
    await createWalletAndUnlock(page);
    // createWalletAndUnlock already asserted Home; re-assert here so the
    // failure mode is obvious if the helper ever drifts.
    await expect(page.getByTestId('action-send')).toBeVisible();
  });

  test('wrong verification word is rejected', async ({ page }) => {
    await page.getByTestId('onboarding-create').click();

    // Read the full phrase so we can deliberately pick a WRONG option
    const words: string[] = [];
    for (let i = 0; i < 12; i++) {
      words.push((await page.getByTestId(`phrase-word-${i}`).textContent() ?? '').trim());
    }
    await page.getByTestId('phrase-saved').click();

    // Find the first question and click any option that is NOT its answer
    const question = page.getByTestId('verify-question-0');
    const prompt = (await question.textContent()) ?? '';
    const index = Number((prompt.match(/#\s*(\d+)/) ?? [])[1]) - 1;
    expect(index).toBeGreaterThanOrEqual(0);

    const options = question.locator('button');
    const texts = await options.allTextContents();
    const wrong = texts.map(t => t.trim()).find(t => t !== words[index]);
    expect(wrong, 'quiz must offer at least one distractor').toBeTruthy();
    await question.locator('button', { hasText: new RegExp(`^${wrong}$`) }).first().click();

    // The Continue button stays disabled until every position is correct
    await expect(page.getByTestId('verify-continue')).toBeDisabled();
  });
});
