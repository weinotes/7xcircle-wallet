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
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 'var(--ow-z-modal)' as unknown as number,
  padding: 'var(--ow-space-4)',
};

const contentStyle: React.CSSProperties = {
  backgroundColor: 'var(--ow-bg-secondary)',
  borderRadius: 'var(--ow-radius-lg)',
  border: '1px solid var(--ow-border)',
  boxShadow: 'var(--ow-shadow-lg)',
  maxWidth: 480,
  width: '100%',
  maxHeight: '80vh',
  overflow: 'auto',
};

const headerStyle: React.CSSProperties = {
  padding: 'var(--ow-space-4) var(--ow-space-6)',
  borderBottom: '1px solid var(--ow-border-subtle)',
  fontSize: 'var(--ow-font-size-lg)',
  fontWeight: 600,
};

const bodyStyle: React.CSSProperties = {
  padding: 'var(--ow-space-6)',
};

const footerStyle: React.CSSProperties = {
  padding: 'var(--ow-space-4) var(--ow-space-6)',
  borderTop: '1px solid var(--ow-border-subtle)',
  display: 'flex',
  gap: 'var(--ow-space-2)',
  justifyContent: 'flex-end',
};

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog rendered in a portal with real dialog semantics: Escape closes,
 * Tab is trapped inside the panel, and focus returns to the trigger on
 * unmount — the pattern the previous plain-div version was missing.
 */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog — first interactive element, else the panel.
    const panel = panelRef.current;
    const initial = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? panel)?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div style={overlayStyle} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={contentStyle}
        onClick={e => e.stopPropagation()}
      >
        {title && <div id={titleId} style={headerStyle}>{title}</div>}
        <div style={bodyStyle}>{children}</div>
        {footer && <div style={footerStyle}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
