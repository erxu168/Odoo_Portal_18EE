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
