/**
 * Odoo's note fields are HTML, ours are plain text.
 *
 * `product.template.description` is an Html field: type "back row of the
 * cellar" into Odoo and it stores `<p>back row of the cellar</p>`. Rendering
 * that as text shows the tags; rendering it as HTML would put whatever an Odoo
 * user pasted — script included — into our page under our own origin.
 *
 * So we read it as plain text and write plain text back, and let Odoo wrap it
 * however it likes.
 */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** Plain text from an Odoo HTML field. Never returns markup. */
export function plainFromOdooHtml(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  return value
    // <br> and block ends are the only structure worth keeping as a line break
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
