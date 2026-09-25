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

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary next step — an empty screen should never be a dead end. */
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Consistent placeholder for "nothing here yet" states (no tokens, no
 * transactions, no search results), always with room for a call to action.
 */
export function EmptyState({ icon, title, description, action, style }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--ow-space-2)',
        padding: 'var(--ow-space-8) var(--ow-space-4)',
        ...style,
      }}
    >
      {icon && (
        <div aria-hidden="true" style={{ color: 'var(--ow-text-tertiary)' }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 'var(--ow-font-size-base)', fontWeight: 600, color: 'var(--ow-text-primary)' }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-text-secondary)', maxWidth: 360 }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 'var(--ow-space-2)' }}>{action}</div>}
    </div>
  );
}
