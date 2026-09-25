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
import { useEffect } from 'react';
import { useWalletStore } from '../store/wallet.js';

/**
 * Reflect the store's theme onto `:root[data-theme]`, which is the hook the
 * design tokens in @open-wallet/ui/tokens.css switch on. Without this the
 * Settings theme toggle updates Zustand but nothing repaints.
 *
 * Shared by the web SPA and the extension popup shell.
 */
export function useThemeSync(): void {
  const theme = useWalletStore(s => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
