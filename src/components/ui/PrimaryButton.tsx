'use client';

import React from 'react';
import { ds } from '@/lib/design-system';

/**
 * Primary action button — the one green button per screen.
 * Owns the green-600 styling, 44px+ target, busy spinner and disabled state.
 *
 * Promoted to ui/ in wave 0 from shift-handover/common.tsx.
 */
export interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
}

export function PrimaryButton({ busy, disabled, children, className = '', ...rest }: PrimaryButtonProps) {
  return (
    <button
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${ds.btnPrimary} disabled:opacity-50 flex items-center justify-center gap-2 ${className}`}
      {...rest}
    >
      {busy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export default PrimaryButton;
