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
import { shortenAddress } from '@7xcircle/shared';

export interface AddressDisplayProps {
  address: string;
  chainIcon?: string;
  showCopy?: boolean;
  full?: boolean;
}

export function AddressDisplay({ address, showCopy = true, full = false }: AddressDisplayProps) {
  const [copied, setCopied] = React.useState(false);
  const display = full ? address : shortenAddress(address);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available
    }
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--ow-space-2)',
        fontFamily: 'var(--ow-font-mono)',
        fontSize: 'var(--ow-font-size-sm)',
        color: 'var(--ow-text-primary)',
        backgroundColor: 'var(--ow-bg-tertiary)',
        padding: 'var(--ow-space-1) var(--ow-space-3)',
        borderRadius: 'var(--ow-radius-md)',
        border: '1px solid var(--ow-border-subtle)',
      }}
    >
      <span>{display}</span>
      {showCopy && (
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ow-text-tertiary)',
            fontSize: 'var(--ow-font-size-xs)',
          }}
        >
          {copied ? '✓' : '📋'}
        </button>
      )}
    </div>
  );
}
