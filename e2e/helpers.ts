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
 * Shared E2E helpers.
 *
 * Wallet flows need a REAL vault, and Playwright gives every test a fresh
 * browser context — localStorage is deliberately NOT shared between tests.
 * So instead of "skip when no vault" (which silently disabled entire
 * suites), every spec creates its own throwaway wallet through the real
 * onboarding UI: deterministic, isolated, and it exercises signup on each
 * run.
 */
import { expect, type Page } from '@playwright/test';

/** Password for throwaway E2E vaults — local dev server only, never funded */
export const E2E_PASSWORD = 'TestPass123!';

/** Words in the E2E phrase (12 keeps onboarding fast) */
const PHRASE_LENGTH = 12;

/** Verification questions the onboarding quiz asks */
const VERIFY_QUESTIONS = 3;

/**
 * Complete create-wallet onboarding and land on Home (unlocked).
 *
 * Reads the phrase off the screen (the same thing a user would write down),
 * answers the verification quiz positionally, then sets the password. The
 * final assertion anchors on the Home quick-action grid.
 */
export async function createWalletAndUnlock(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('onboarding-create').click();

  // Read the recovery phrase — the same 12 words the user is told to back up
  const words: string[] = [];
  for (let i = 0; i < PHRASE_LENGTH; i++) {
    const word = await page.getByTestId(`phrase-word-${i}`).textContent();
    words.push((word ?? '').trim());
  }
  expect(words.every(Boolean)).toBe(true);

  await page.getByTestId('phrase-saved').click();

  // Answer each verification question with the word at the prompted index
  for (let q = 0; q < VERIFY_QUESTIONS; q++) {
    const prompt = await page.getByTestId(`verify-question-${q}`).textContent();
    const match = (prompt ?? '').match(/#\s*(\d+)/);
    if (!match) throw new Error(`verify question ${q} has no word position: ${prompt}`);
    const index = Number(match[1]) - 1;
    // .first() guards against a phrase with repeated words rendering the
    // same option twice — any match carries the correct word text.
    await page.getByTestId(`verify-option-${index}-${words[index]}`).first().click();
  }
  await page.getByTestId('verify-continue').click();

  await page.getByTestId('password-input').fill(E2E_PASSWORD);
  await page.getByTestId('confirm-password-input').fill(E2E_PASSWORD);
  await page.getByTestId('onboarding-submit').click();

  // Auto-unlock routes straight to Home — the Send quick action is the anchor
  await expect(page.getByTestId('action-send')).toBeVisible({ timeout: 20_000 });
}

/**
 * Unlock an existing vault through the real Unlock screen.
 * Call after a full page reload — `unlocked` is intentionally NOT persisted.
 */
export async function unlockWallet(page: Page): Promise<void> {
  await page.getByTestId('unlock-password').fill(E2E_PASSWORD);
  await page.getByTestId('unlock-submit').click();
}
