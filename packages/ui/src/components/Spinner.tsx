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

export interface SpinnerProps {
  size?: number;
  /** Accessible description of what is happening; defaults to a generic one. */
  label?: string;
  style?: React.CSSProperties;
}

/**
 * Loading indicator. Announced via role="status" so screen readers read it
 * once when it appears. Relies on the `ow-spin` keyframe from the ui package
 * animations.css.
 */
export function Spinner({ size = 16, label = 'Loading', style }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `${Math.max(2, Math.round(size / 8))}px solid currentColor`,
        borderTopColor: 'transparent',
        borderRadius: 'var(--ow-radius-full)',
        animation: 'ow-spin 0.8s linear infinite',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
