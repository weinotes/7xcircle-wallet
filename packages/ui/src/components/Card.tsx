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
import * as React from 'react';

/**
 * Interactive states cannot live in inline styles. This sheet is injected
 * once next to the components that rely on it; the apps also import
 * tokens.css, so the variables are always in scope.
 */
const SHEET_ID = 'ow-ui-interactive-styles';
const INTERACTIVE_CSS = `
.ow-hoverable { transition: background-color var(--ow-duration-fast) var(--ow-ease), border-color var(--ow-duration-fast) var(--ow-ease); }
.ow-hoverable:hover { background-color: var(--ow-bg-hover); }
.ow-listrow {
  display: flex; align-items: center; justify-content: space-between; gap: var(--ow-space-3);
  width: 100%; text-align: start; font: inherit; color: inherit;
  background-color: var(--ow-bg-tertiary); border: 1px solid var(--ow-border-subtle);
  border-radius: var(--ow-radius-md); padding: 10px 12px; cursor: pointer;
}
.ow-listrow:hover { background-color: var(--ow-bg-hover); border-color: var(--ow-border); }
button.ow-iconbutton {
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--ow-text-secondary);
  border: 1px solid transparent; border-radius: var(--ow-radius-md);
  padding: var(--ow-space-2); cursor: pointer;
  transition: background-color var(--ow-duration-fast) var(--ow-ease), color var(--ow-duration-fast) var(--ow-ease);
}
button.ow-iconbutton:hover:not(:disabled) { background-color: var(--ow-bg-hover); color: var(--ow-text-primary); }
button.ow-iconbutton:active:not(:disabled) { transform: scale(0.94); }
button.ow-iconbutton:disabled { opacity: 0.5; cursor: not-allowed; }
button.ow-button-base:active:not(:disabled) { transform: translateY(1px); }
`;

function ensureInteractiveStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SHEET_ID)) return;
  const tag = document.createElement('style');
  tag.id = SHEET_ID;
  tag.textContent = INTERACTIVE_CSS;
  document.head.appendChild(tag);
}

// ── Card ────────────────────────────────────────────────────────────────

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Centered content (balance heroes) vs. left-aligned list containers. */
  centered?: boolean;
  padded?: boolean;
}

/** The raised container used across every page — one definition, no more copy-pasted style objects. */
export function Card({ centered, padded = true, style, children, ...rest }: CardProps) {
  ensureInteractiveStyles();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ow-space-2)',
        backgroundColor: 'var(--ow-bg-secondary)',
        border: '1px solid var(--ow-border)',
        borderRadius: 'var(--ow-radius-xl)',
        padding: padded ? 'var(--ow-space-4) var(--ow-space-5)' : 0,
        textAlign: centered ? 'center' : undefined,
        alignItems: centered ? 'center' : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// ── ListRow ─────────────────────────────────────────────────────────────

export interface ListRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Avatar slot — token symbol badge, direction arrow, etc. */
  start?: React.ReactNode;
  /** Right-aligned trailing block (amount + secondary line). */
  end?: React.ReactNode;
}

/**
 * A full-width, keyboard-operable list item (asset row, tx row…). Renders a
 * real <button>, so Enter/Space and focus rings come for free — unlike the
 * <div onClick> pattern it replaces.
 */
export function ListRow({ start, end, children, style, ...rest }: ListRowProps) {
  ensureInteractiveStyles();
  return (
    <button type="button" className="ow-listrow ow-hoverable" style={style} {...rest}>
      {start && <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>{start}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {end && <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>{end}</span>}
    </button>
  );
}

// ── IconButton ──────────────────────────────────────────────────────────

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon-only control without a name is invisible to AT. */
  'aria-label': string;
  size?: number;
}

/** Ghost-styled icon-only control (refresh, close, settings…). */
export function IconButton({ 'aria-label': ariaLabel, size = 16, children, ...rest }: IconButtonProps) {
  ensureInteractiveStyles();
  return (
    <button type="button" className="ow-iconbutton" aria-label={ariaLabel} {...rest}>
      {typeof children === 'string' ? children : null}
      <span aria-hidden="true" style={{ display: 'inline-flex', width: size, height: size }}>
        {typeof children === 'string' ? null : children}
      </span>
    </button>
  );
}
