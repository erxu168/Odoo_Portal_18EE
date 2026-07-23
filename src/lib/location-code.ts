/**
 * Stable scannable code for a count location, derived from its id (no schema
 * change needed). The printed label carries a QR of this code; a future
 * scan-driven stock flow parses it back to the location id.
 */
const PREFIX = 'KWLOC-';

export function locationCode(id: number): string {
  return `${PREFIX}${id}`;
}

/** Parse a scanned code back to a location id, or null if it isn't one of ours. */
export function parseLocationCode(code: string): number | null {
  const m = code.trim().match(/^KWLOC-(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
}
