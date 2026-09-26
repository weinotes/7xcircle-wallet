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
import { Spinner } from './Spinner.js';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    // Brand gradient fill with a violet halo — the Apple-keynote pill from
    // the landing page, now the app's default action. `backgroundColor`
    // stays as a no-gradient fallback for print/old engines.
    backgroundColor: 'var(--ow-accent)',
    backgroundImage: 'var(--ow-gradient-primary)',
    boxShadow: '0 6px 22px -8px var(--ow-glow-accent)',
    color: 'var(--ow-accent-fg)',
    border: 'none',
  },
  secondary: {
    backgroundColor: 'var(--ow-bg-tertiary)',
    color: 'var(--ow-text-primary)',
    border: '1px solid var(--ow-border)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--ow-text-primary)',
    border: 'none',
  },
  danger: {
    backgroundColor: 'var(--ow-error)',
    color: '#ffffff',
    border: 'none',
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: 'var(--ow-space-1) var(--ow-space-3)', fontSize: 'var(--ow-font-size-sm)' },
  md: { padding: 'var(--ow-space-2) var(--ow-space-4)', fontSize: 'var(--ow-font-size-base)' },
  lg: { padding: 'var(--ow-space-3) var(--ow-space-6)', fontSize: 'var(--ow-font-size-lg)' },
};

const baseStyles: React.CSSProperties = {
  borderRadius: 'var(--ow-radius-md)',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background-color var(--ow-duration-fast) var(--ow-ease), border-color var(--ow-duration-fast) var(--ow-ease), transform var(--ow-duration-fast) var(--ow-ease)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--ow-space-2)',
  fontFamily: 'var(--ow-font-sans)',
};

/**
 * Press feedback cannot live in inline styles; injected once alongside the
 * component so every Button (and IconButton) gets it.
 */
const SHEET_ID = 'ow-ui-button-styles';
const BUTTON_CSS = `
button.ow-button-base:focus-visible { outline: 2px solid var(--ow-accent); outline-offset: 2px; }
button.ow-button-base:active:not(:disabled) { transform: translateY(1px); filter: brightness(0.92); }
button.ow-button-base:not(:disabled):hover { filter: brightness(1.06); }
button.ow-button-base[disabled] { filter: saturate(0.5); }
`;
function ensureButtonStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(SHEET_ID)) return;
  const tag = document.createElement('style');
  tag.id = SHEET_ID;
  tag.textContent = BUTTON_CSS;
  document.head.appendChild(tag);
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  style,
  ...rest
}: ButtonProps) {
  ensureButtonStyles();
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className="ow-button-base"
      style={{
        ...baseStyles,
        ...variantStyles[variant],
        ...sizeStyles[size],
        ...style,
        opacity: disabled || loading ? 0.6 : 1,
      }}
      {...rest}
    >
      {loading && <Spinner size={size === 'lg' ? 18 : 14} />}
      {!loading && children}
    </button>
  );
}
