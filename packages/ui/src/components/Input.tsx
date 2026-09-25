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

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const SHEET_ID = 'ow-ui-input-styles';
const INPUT_CSS = `
input.ow-input:focus-visible { outline: none; border-color: var(--ow-accent) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--ow-accent) 25%, transparent); }
`;
function ensureInputStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(SHEET_ID)) return;
  const tag = document.createElement('style');
  tag.id = SHEET_ID;
  tag.textContent = INPUT_CSS;
  document.head.appendChild(tag);
}

export function Input({ label, error, hint, style, id, ...rest }: InputProps) {
  ensureInputStyles();
  const inputId = id || rest.name;
  const errorId = inputId ? `${inputId}-error` : undefined;
  const hintId = inputId ? `${inputId}-hint` : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-1)' }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{
            fontSize: 'var(--ow-font-size-sm)',
            fontWeight: 500,
            color: 'var(--ow-text-secondary)',
          }}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className="ow-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, !error && hint ? hintId : null].filter(Boolean).join(' ') || undefined}
        style={{
          backgroundColor: 'var(--ow-bg-secondary)',
          color: 'var(--ow-text-primary)',
          border: `1px solid ${error ? 'var(--ow-error)' : 'var(--ow-border)'}`,
          borderRadius: 'var(--ow-radius-md)',
          padding: 'var(--ow-space-2) var(--ow-space-3)',
          fontSize: 'var(--ow-font-size-base)',
          fontFamily: 'var(--ow-font-sans)',
          outline: 'none',
          transition: 'border-color 0.15s ease',
          ...style,
        }}
        {...rest}
      />
      {error && (
        <span id={errorId} role="alert" style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-error)' }}>
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={hintId} style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}
