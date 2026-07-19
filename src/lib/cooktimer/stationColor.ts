/**
 * Station accent colours. The three seeded stations line up with the mock
 * (Grill = orange, Deep Fry & Smoker = yellow, Oven = red); managers can add
 * more later and they cycle through the rest of the palette by sort order.
 */
const PALETTE = ['#f97316', '#eab308', '#ef4444', '#38bdf8', '#a78bfa', '#22c55e', '#f43f5e', '#14b8a6'];

export function stationColor(sort: number): string {
  const i = ((sort % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[i];
}

/** Build a stationId -> colour map from the station list. */
export function stationColorMap(stations: { id: number; sort: number }[]): Record<number, string> {
  const m: Record<number, string> = {};
  for (const s of stations) m[s.id] = stationColor(s.sort);
  return m;
}
