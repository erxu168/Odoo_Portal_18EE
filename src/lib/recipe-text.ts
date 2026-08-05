/**
 * Recipe instructions are stored in an Odoo HTML field, so plain text comes back
 * wrapped in tags (<p>…</p>) with escaped entities (& → &amp;). Use this to show
 * or edit them as clean plain text.
 */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return '';
  let t = String(input);
  // Turn block boundaries into spaces so words don't run together.
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/(p|div|li|h[1-6])>/gi, ' ');
  // Strip all remaining tags.
  t = t.replace(/<[^>]+>/g, '');
  // Decode the common HTML entities.
  t = t
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Sanitise recipe instruction HTML for rendering (bullets, bold, lists…).
 * Allows a small formatting-only tag set and strips ALL attributes, so there's
 * no room for scripts, event handlers, styles or links. Odoo already sanitises
 * the stored HTML; this is a second, render-time guard.
 */
/**
 * Recipe instruction HTML. Kept as a named re-export so every existing caller
 * is untouched, but the implementation is now the shared one in lib/rich-text —
 * two copies of a security allowlist is exactly how one of them rots.
 *
 * One behaviour change: a link the recipe editor created now RENDERS. The old
 * copy stripped every attribute, so `<a href>` lost its href and quietly became
 * plain text — the editor offered a Link button that did nothing. The shared
 * version keeps http/https/mailto links and rebuilds them with
 * rel="noopener noreferrer".
 */
import { sanitizeRichText } from './rich-text';

export function sanitizeRecipeHtml(input: string | null | undefined): string {
  // allowLinks: false keeps recipes EXACTLY as they behaved before this shared
  // helper existed. Their render containers have no link styling, so an enabled
  // link became invisible-but-tappable text that could navigate a cook out of
  // the app mid-recipe. One implementation, one deliberate difference.
  return sanitizeRichText(input, { allowLinks: false });
}

