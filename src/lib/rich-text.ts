/**
 * rich-text.ts — the ONE render-time guard for manager-authored formatted text.
 *
 * Managers write these fields (guide step explanations, the note for staff,
 * recipe instructions); STAFF render them. So whatever is stored gets injected
 * into a page on someone else's phone, and it has to be assumed hostile even
 * when the author is trusted — a pasted snippet from a supplier's website is
 * enough.
 *
 * Two layers protect it. Odoo sanitises on save (the authority); this is the
 * second, render-time guard, so a value that predates the server rule, or
 * arrives from anywhere else, still cannot execute.
 *
 * Deliberately regex-based rather than DOM-based: this runs during server
 * rendering too, where DOMParser does not exist. It is a strict ALLOWLIST that
 * rebuilds every tag from scratch, so an unknown tag or attribute is not
 * "escaped" or "cleaned" — it simply cannot survive.
 *
 * Client-safe: no imports, no server modules.
 */

/** Formatting only. No img, no iframe, no table, no style, no script. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'code', 'a',
]);

/** The only protocols a link may use. Blocks javascript:, data:, vbscript:. */
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s"'<>]+$/i;

/**
 * Strip everything except the formatting allowlist.
 *
 * `<a>` is the single tag allowed to keep an attribute, and only `href`, and
 * only with an http/https/mailto target. Anything else about the link — target,
 * onclick, style, class — is dropped and rebuilt, so the output is fully
 * determined by this function rather than by the input.
 */
export function sanitizeRichText(
  input: string | null | undefined,
  opts: { allowLinks?: boolean } = {},
): string {
  if (!input) return '';
  const allowLinks = opts.allowLinks !== false;
  let html = String(input);

  // Remove whole elements whose CONTENT is dangerous, not just their tags —
  // stripping <script> alone would leave its body as visible text.
  html = html.replace(/<(script|style|iframe|object|embed|noscript|template)[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<(script|style|iframe|object|embed|noscript|template)\b[^>]*>/gi, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // The tag matcher consumes EVERYTHING after the tag name — `[^>]*`, not
  // `(?:\s[^>]*)?`. HTML ends a tag name at "/" as well as at whitespace, so a
  // pattern that demanded a space missed `<img/src=x onerror=…>` entirely, and
  // an unmatched tag was copied through verbatim: the guard failed OPEN.
  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  // Anchors cannot nest, so one counter drops the </a> of an opener we rejected.
  let droppedAnchors = 0;
  // Escape any "<" that is NOT part of a tag we rebuilt, so leftovers become
  // text instead of markup. This is what makes the function fail CLOSED:
  // anything unrecognised ends up inert rather than passed through.
  const escapeText = (t: string) => t.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    out += escapeText(html.slice(last, m.index));
    last = TAG_RE.lastIndex;
    const slash = m[1];
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (!ALLOWED_TAGS.has(tag)) continue;                 // dropped entirely
    if (tag !== 'a') { out += `<${slash}${tag}>`; continue; }
    if (!allowLinks) continue;                            // links off: keep the words, drop the anchor
    if (slash) {
      if (droppedAnchors > 0) { droppedAnchors--; continue; }
      out += '</a>';
      continue;
    }
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const url = (href?.[2] ?? href?.[3] ?? href?.[4] ?? '').trim();
    if (!SAFE_HREF.test(url)) { droppedAnchors++; continue; }
    out += `<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer nofollow">`;
  }
  out += escapeText(html.slice(last));
  return out.trim();
}


/**
 * Does this value carry formatting, or is it legacy plain text?
 *
 * Every explanation and note written before the editor existed is plain text
 * with real newlines. Rendering those as HTML would silently collapse every
 * line break, so callers use this to keep showing them exactly as before.
 * Nothing is migrated; old content simply stays plain.
 */
export function isRichText(value: string | null | undefined): boolean {
  if (!value) return false;
  return /<(p|br|ul|ol|li|h2|h3|strong|b|em|i|u|s|a|blockquote|code)\b[^>]*>/i.test(value);
}

/**
 * Formatted text as a single plain line — for previews, list rows and anywhere
 * a length is counted against a limit the user can see.
 */
export function richTextToPlain(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/(p|li|h2|h3|blockquote)\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Legacy plain text → formatted HTML, preserving the line breaks.
 *
 * THE migration trap in this feature. Every explanation and note written before
 * the editor existed is plain text with real newlines. Handing that string
 * straight to the editor would let HTML collapse every newline, and the first
 * save would silently flatten a guide the manager spent an afternoon writing.
 * So plain text is converted ON THE WAY IN: blank lines become paragraphs,
 * single newlines become <br>, and the text is HTML-escaped first so a stray
 * "<" or "&" in someone's note cannot become markup.
 */
export function plainTextToRichText(value: string | null | undefined): string {
  if (!value) return '';
  const escaped = String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (!paragraphs.length) return '';
  return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

/**
 * What the editor should be given for a stored value: formatted text as-is,
 * legacy plain text converted. One helper so every call site treats old content
 * the same way.
 */
export function toEditorHtml(value: string | null | undefined): string {
  if (!value) return '';
  return isRichText(value) ? String(value) : plainTextToRichText(value);
}
