/**
 * ux-rules.ts — plain-language and interaction rules for the Krawings Portal.
 *
 * This file was mandated by CLAUDE.md / PORTAL.md §7 but had never been created;
 * wave 0 of the design standard adds it so the contract actually exists in code.
 * It codifies the prose rules from PORTAL.md §7:
 *   - never show ERP jargon (use plain replacements);
 *   - confirmation text uses the real product name + quantity, never generic;
 *   - errors say what to DO next, never raw server text;
 *   - offline is graceful, never blocking.
 *
 * Wave 0 only creates and documents these contracts. Screens are migrated to
 * consume them as they are touched (the design-standard "ratchet"), not in a
 * sweeping rewrite.
 */

// ── Plain language: never show ERP terms ─────────────────────────────────────
// NOTE: only whole-word ERP nouns belong here. Context-sensitive verbs like
// "Confirm" are deliberately excluded — they mean different things per screen
// (that mapping lives in buildConfirmationText), and a naive replace would
// corrupt valid copy (e.g. "Confirmation" → "…orderation").
export const plainLanguageTerms: Record<string, string> = {
  'Manufacturing Order': 'Production order',
  'Work Order': 'Cooking step',
  'Bill of Materials': 'Recipe',
  BOM: 'Recipe',
  Component: 'Ingredient',
  Scrap: 'Waste / spoilage',
  'Work Center': 'Station',
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matcher, longest term first so "Bill of Materials" wins over "BOM".
const PLAIN_LANGUAGE_RE = new RegExp(
  '\\b(' +
    Object.keys(plainLanguageTerms)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|') +
    ')\\b',
  'g',
);

/** Replace known ERP terms in a string with their plain-language version (whole-word only). */
export function toPlainLanguage(value: string): string {
  return value.replace(PLAIN_LANGUAGE_RE, (m) => plainLanguageTerms[m] ?? m);
}

// ── Confirmation dialogs: real names + quantities, never generic ─────────────
export type ConfirmationAction =
  | 'finish'
  | 'start'
  | 'cancel'
  | 'scrap'
  | 'receive'
  | 'submit'
  | 'delete';

/** Is this action destructive (→ red confirm button)? */
export function isDestructiveAction(action: ConfirmationAction): boolean {
  return action === 'scrap' || action === 'cancel' || action === 'delete';
}

/**
 * Build a human confirmation sentence using the real product name and quantity.
 *   buildConfirmationText('finish', 'Bulgogi Marinade', 5, 'litres')
 *   → "You finished making 5 litres of Bulgogi Marinade. Is that correct?"
 */
export function buildConfirmationText(
  action: ConfirmationAction,
  productName: string,
  qty?: number,
  uom?: string,
): string {
  const amount = qty != null ? `${qty}${uom ? ' ' + uom : ''} of ` : '';
  const name = productName || 'this item';
  switch (action) {
    case 'finish':
      return `You finished making ${amount}${name}. Is that correct?`;
    case 'start':
      return `Start the production order for ${amount}${name}?`;
    case 'receive':
      return `Mark ${amount}${name} as received?`;
    case 'submit':
      return `Submit ${amount}${name}?`;
    case 'scrap':
      return `Record ${amount}${name} as waste / spoilage? This cannot be undone.`;
    case 'cancel':
      return `Cancel the order for ${amount}${name}? This cannot be undone.`;
    case 'delete':
      return `Delete ${amount}${name}? This cannot be undone.`;
    default:
      return `Confirm ${amount}${name}?`;
  }
}

// ── Error messages: say what to DO, never raw server text ─────────────────────
export const errorMessages: Record<string, string> = {
  // Do NOT promise the work was saved here — most modules write with a plain
  // fetch and have no offline queue. Only the `queued` message below (used after
  // a confirmed enqueue) may say "saved".
  network: 'No connection right now. Check your connection and try again.',
  timeout: 'That took too long. Check your connection and try again.',
  unauthorized: 'You are signed out. Please sign in again to continue.',
  forbidden: 'You do not have access to that. Ask a manager if you need it.',
  notFound: 'That is no longer here. Go back and refresh the list.',
  conflict: 'Someone else just changed this. Refresh to see the latest, then try again.',
  server: 'Something went wrong on our side. Try again in a moment.',
  validation: 'Please check the highlighted fields and try again.',
  generic: 'Something went wrong. Try again.',
};

/** Map an HTTP status (or a known key) to a do-next error message. */
export function errorMessageFor(statusOrKey: number | string): string {
  if (typeof statusOrKey === 'string') {
    return errorMessages[statusOrKey] ?? errorMessages.generic;
  }
  if (statusOrKey === 401) return errorMessages.unauthorized;
  if (statusOrKey === 403) return errorMessages.forbidden;
  if (statusOrKey === 404) return errorMessages.notFound;
  if (statusOrKey === 409) return errorMessages.conflict;
  if (statusOrKey === 422) return errorMessages.validation;
  if (statusOrKey >= 500) return errorMessages.server;
  return errorMessages.generic;
}

// ── Offline: graceful, never blocking ────────────────────────────────────────
export const offlineMessages = {
  // Generic banner: does NOT promise persistence — only modules with a real
  // IndexedDB write queue should use `queued` after a confirmed enqueue.
  banner: 'You are offline. Some actions may not work until you are back online.',
  queued: 'Saved. This will sync when you are back online.',
  syncing: 'Back online — syncing your changes…',
  synced: 'All changes synced.',
} as const;
