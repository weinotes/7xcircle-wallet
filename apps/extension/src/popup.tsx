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
 * OpenWallet browser extension — popup entry.
 *
 * The popup reuses the web app's pages, store, i18n, and styles via the
 * `@web` alias. Unlike the web SPA (BrowserRouter), the extension popup
 * has no URL to navigate — so we mount a MemoryRouter instead.
 */

// MUST stay the first import: patches globalThis.Buffer before any module
// touches Buffer at top level (spl-token via @open-wallet/chains).
import '@web/polyfills.js';
import '@web/setup.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@web/styles/globals.css';
import '@open-wallet/ui/src/tokens.css';
import '@web/i18n/index.js';

import AppShell from './AppShell.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={['/']}>
      <AppShell />
    </MemoryRouter>
  </React.StrictMode>,
);
