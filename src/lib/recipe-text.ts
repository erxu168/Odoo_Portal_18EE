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
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3']);
export function sanitizeRecipeHtml(input: string | null | undefined): string {
  if (!input) return '';
  let html = String(input);
  html = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  // Rebuild each tag with no attributes; drop tags not in the allowlist.
  html = html.replace(/<(\/?)([a-zA-Z0-9]+)(?:\s[^>]*)?>/g, (_m, slash, tag) => {
    return ALLOWED_TAGS.has(tag.toLowerCase()) ? `<${slash}${tag.toLowerCase()}>` : '';
  });
  return html.trim();
}
