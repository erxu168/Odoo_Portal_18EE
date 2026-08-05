'use client';

import React from 'react';
import { sanitizeRichText, isRichText } from '@/lib/rich-text';

/**
 * Display manager-authored text — formatted or legacy plain — safely.
 *
 * The ONLY place the portal should render one of these fields. Every call site
 * that reached for `dangerouslySetInnerHTML` itself is a place where someone
 * later forgets the sanitiser; routing them all through here means the guard
 * cannot be forgotten, because there is nothing to remember.
 *
 * Two behaviours in one component, deliberately:
 *  - Formatted text is sanitised and rendered as HTML.
 *  - LEGACY plain text renders as plain text with `whitespace-pre-wrap`, so the
 *    line breaks in everything written before the editor existed survive
 *    exactly as they look today. Nothing was migrated; nothing needs to be.
 */
export default function RichText({
  value,
  className = '',
}: {
  value: string | null | undefined;
  className?: string;
}) {
  if (!value) return null;

  if (!isRichText(value)) {
    return <div className={`whitespace-pre-wrap ${className}`}>{value}</div>;
  }

  const html = sanitizeRichText(value);
  if (!html) return null;
  return (
    <div
      className={`rte-render ${className}`}
      // Safe by construction: sanitizeRichText rebuilds every tag from a strict
      // allowlist and drops all attributes except a validated href. Odoo has
      // already sanitised on save; this is the second, independent guard.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
