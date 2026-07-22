'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { recordHref, RECORD_NOUN, type RecordType } from '@/lib/record-links';

/**
 * RecordLink — the app-wide standard affordance for drilling into a business
 * record's canonical page ("Universal Record Drill-Down"). Use it EVERYWHERE a
 * product / location / other record is displayed, so users can always answer
 * "where did this come from?" in one tap.
 *
 * Two variants:
 *  - "icon"   : a standalone open-record button (↗). For rows that already have
 *               a primary tap (add/remove/select) — the drill-down never hijacks it.
 *  - "inline" : renders the record's NAME as a link. For read-only contexts
 *               (reports, review, summaries) where the name itself should open it.
 *
 * Two behaviors:
 *  - navigate (default): go to the canonical page (recordHref). For read-only
 *    contexts and anywhere without unsaved state.
 *  - overlay (pass onOpen): the calling screen owns an overlay editor and keeps
 *    its transient state (e.g. a half-built list). onOpen wins over navigation.
 *
 * Permission: viewing is always allowed; `canOpen={false}` hard-disables it
 * (e.g. the record id isn't resolvable). Edit-gating happens INSIDE the target.
 */
export default function RecordLink({
  type, id, label, variant = 'icon', onOpen, canOpen = true, className = '', title,
}: {
  type: RecordType;
  id: number;
  /** Required for the inline (name-as-link) variant. */
  label?: string;
  variant?: 'icon' | 'inline';
  /** When provided, opens an in-flow overlay instead of navigating (preserves state). */
  onOpen?: (id: number) => void;
  canOpen?: boolean;
  className?: string;
  title?: string;
}) {
  const router = useRouter();
  const go = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canOpen) return;
    if (onOpen) onOpen(id);
    else router.push(recordHref(type, id));
  };
  const aria = title || `Open ${RECORD_NOUN[type]}${label ? ` — ${label}` : ''}`;

  if (variant === 'inline') {
    return (
      <a
        href={recordHref(type, id)}
        onClick={go}
        aria-label={aria}
        className={`inline-flex items-center gap-1 text-green-700 font-semibold underline decoration-green-300 underline-offset-2 active:opacity-70 ${canOpen ? '' : 'pointer-events-none opacity-60 no-underline'} ${className}`}
      >
        {label}
        <OpenIcon />
      </a>
    );
  }

  // icon variant — a discoverable, thumb-sized drill-down button
  return (
    <button
      type="button"
      onClick={go}
      disabled={!canOpen}
      aria-label={aria}
      title={aria}
      className={`w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 active:bg-green-50 active:text-green-600 disabled:opacity-30 flex-shrink-0 ${className}`}
    >
      <OpenIcon />
    </button>
  );
}

/** Odoo-style "open record" arrow (box-arrow-up-right). */
function OpenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}
