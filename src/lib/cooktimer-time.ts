/**
 * Cook-timer time helpers.
 *
 * Timestamps are stored as Berlin-local, OFFSET-BEARING ISO strings
 * (e.g. "2026-07-19T15:30:00+02:00"). This is deliberate:
 *   - NEVER toISOString() — that is UTC, which the portal forbids (Odoo/Berlin).
 *   - NEVER a naive Berlin string ("2026-10-25 02:30:00") — ambiguous across the
 *     DST fall-back hour, which would make a running step's remaining time an
 *     hour wrong twice a year.
 * The explicit numeric offset makes every stamp parse back to an EXACT epoch, so
 * a tablet reload/reconnect recovers the precise remaining time on a live step
 * (the spec's stated goal for server-side timekeeping).
 */

const BERLIN = 'Europe/Berlin';

/** Berlin-local, offset-bearing ISO stamp for an epoch (default: now). */
export function berlinStamp(epochMs: number = Date.now()): string {
  // Wall-clock parts in Berlin: "YYYY-MM-DD HH:MM:SS".
  const wall = new Date(epochMs).toLocaleString('sv-SE', { timeZone: BERLIN });
  const [datePart, timePart] = wall.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, s] = timePart.split(':').map(Number);
  // Offset = (that wall time interpreted as UTC) minus the real epoch. Rounds to
  // whole minutes; Berlin is always +01:00 or +02:00.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetMin = Math.round((asUtc - epochMs) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${datePart}T${timePart}${sign}${oh}:${om}`;
}

/** Parse an offset-bearing stamp back to epoch ms. Returns 0 on garbage. */
export function stampToEpoch(stamp: string | null | undefined): number {
  if (!stamp) return 0;
  const t = Date.parse(stamp);
  return Number.isFinite(t) ? t : 0;
}
