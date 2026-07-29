/**
 * Stable scannable code for a count location, derived from its id (no schema
 * change needed). The printed label carries a QR of this code; a future
 * scan-driven stock flow parses it back to the location id.
 */
const PREFIX = 'KWLOC-';

export function locationCode(id: number): string {
  return `${PREFIX}${id}`;
}

/**
 * The URL a printed sticker's QR opens: the floorplan focused on this spot.
 * Always the PRODUCTION portal (configurable), never whichever origin happened
 * to print — a sticker printed from staging must not send staff to staging.
 */
export function locationDeepLink(id: number): string {
  const base = process.env.NEXT_PUBLIC_PORTAL_BASE_URL || 'https://staff.krawings.de';
  return `${base.replace(/\/$/, '')}/inventory/floorplan?spot=${id}`;
}

/**
 * Parse a scanned code back to a location id, or null if it isn't one of ours.
 * Two sticker generations exist: classic `KWLOC-<id>` payloads and floorplan
 * deep links whose query carries `spot=<id>` — both must keep scanning.
 */
export function parseLocationCode(code: string): number | null {
  const trimmed = code.trim();
  const classic = trimmed.match(/^KWLOC-(\d+)$/i);
  if (classic) return parseInt(classic[1], 10);
  const link = trimmed.match(/^https?:\/\/[^\s]*[?&]spot=(\d+)(?:&|$)/i);
  return link ? parseInt(link[1], 10) : null;
}
