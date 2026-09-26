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
// MUST stay the first import: patches globalThis.Buffer before any module
// that touches Buffer at top level (spl-token via @7xcircle/chains).
import './polyfills.js';
import './setup.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import App from './App.js';
import { Landing } from './pages/Landing.js';
import './styles/globals.css';
import '@7xcircle/ui/src/tokens.css';
import './i18n/index.js';

// Two faces, one bundle: `/` is the project landing page, `/app/*` is the
// wallet itself. The split happens at MOUNT time because the wallet tree
// needs BrowserRouter basename=/app (its pages navigate with app-absolute
// paths like /send, unchanged). Landing CTAs are plain <a href="/app"> so
// the switch always reloads into the other tree.
const isAppRoute =
  window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');

/** Landing tree: `/` renders the page; any other path hard-forwards to
 * the wallet tree. A client-side <Navigate> to /app/* would loop — the
 * landing router cannot mount App, so the handoff MUST be a real reload. */
function RootRoutes() {
  const location = useLocation();
  if (location.pathname === '/app' || location.pathname.startsWith('/app/')) {
    window.location.replace(location.pathname + location.search + location.hash);
    return null;
  }
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="*" element={<Navigate to={`/app${location.pathname}`} replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={isAppRoute ? '/app' : '/'}>
      {isAppRoute ? <App /> : <RootRoutes />}
    </BrowserRouter>
  </React.StrictMode>,
);
