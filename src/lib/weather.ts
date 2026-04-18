/**
 * Open-Meteo weather client — free, no API key.
 *
 * Used by the Prep Planner to tag historical sales days with weather
 * and pull short-range forecasts for the upcoming horizon.
 *
 * Two endpoints we use:
 *   - archive-api.open-meteo.com    → historical daily (up to ~80 years)
 *   - api.open-meteo.com/v1/forecast → next 16 days daily
 *
 * Berlin default coordinates: 52.52 N, 13.405 E (Berlin-Mitte).
 *
 * Weather buckets (per Prep Planner algorithm doc):
 *   nice   → warm & dry (tmax >= 20, precip < 1, no snow)
 *   heat   → hot (tmax >= 28)
 *   rain   → precip >= 1 mm
 *   cold   → tmax < 5, no snow
 *   snow   → snowfall present
 *   normal → anything else
 */

export interface WeatherDaily {
  date: string;           // YYYY-MM-DD, Berlin local
  tavg: number | null;
  tmax: number | null;
  tmin: number | null;
  precip_mm: number | null;
  snow_cm: number | null;
  bucket: WeatherBucket;
}

export type WeatherBucket = 'nice' | 'heat' | 'rain' | 'cold' | 'snow' | 'normal';

export const BERLIN_COORDS = { lat: 52.52, lon: 13.405 } as const;

export function classifyWeather(d: {
  tmax: number | null;
  precip_mm: number | null;
  snow_cm: number | null;
}): WeatherBucket {
  if ((d.snow_cm ?? 0) > 0) return 'snow';
  if ((d.precip_mm ?? 0) >= 1) return 'rain';
  if ((d.tmax ?? 0) >= 28) return 'heat';
  if (d.tmax !== null && d.tmax < 5) return 'cold';
  if ((d.tmax ?? 0) >= 20 && (d.precip_mm ?? 0) < 1) return 'nice';
  return 'normal';
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Fetch historical daily weather for Berlin across a date range.
 * Dates are INCLUSIVE and must be in the past (not today/future).
 */
export async function fetchHistoricalWeather(
  startDate: string,
  endDate: string,
  coords: { lat: number; lon: number } = BERLIN_COORDS,
): Promise<WeatherDaily[]> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(coords.lat));
  url.searchParams.set('longitude', String(coords.lon));
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('daily', [
    'temperature_2m_mean',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'snowfall_sum',
  ].join(','));
  url.searchParams.set('timezone', 'Europe/Berlin');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo archive error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();

  const dates: string[] = data?.daily?.time ?? [];
  const tavg: (number | null)[] = data?.daily?.temperature_2m_mean ?? [];
  const tmax: (number | null)[] = data?.daily?.temperature_2m_max ?? [];
  const tmin: (number | null)[] = data?.daily?.temperature_2m_min ?? [];
  const precip: (number | null)[] = data?.daily?.precipitation_sum ?? [];
  const snow: (number | null)[] = data?.daily?.snowfall_sum ?? [];

  return dates.map((date, i) => {
    const day = {
      tmax: tmax[i] ?? null,
      tmin: tmin[i] ?? null,
      precip_mm: precip[i] ?? null,
      snow_cm: snow[i] ?? null,
    };
    return {
      date,
      tavg: tavg[i] ?? null,
      ...day,
      bucket: classifyWeather(day),
    };
  });
}

/**
 * Fetch short-range forecast (today + next N days) for Berlin.
 * Open-Meteo forecast supports up to 16 days.
 */
export async function fetchForecastWeather(
  days: number = 7,
  coords: { lat: number; lon: number } = BERLIN_COORDS,
): Promise<WeatherDaily[]> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(coords.lat));
  url.searchParams.set('longitude', String(coords.lon));
  url.searchParams.set('daily', [
    'temperature_2m_mean',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'snowfall_sum',
  ].join(','));
  url.searchParams.set('timezone', 'Europe/Berlin');
  url.searchParams.set('forecast_days', String(Math.max(1, Math.min(16, days))));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();

  const dates: string[] = data?.daily?.time ?? [];
  const tavg: (number | null)[] = data?.daily?.temperature_2m_mean ?? [];
  const tmax: (number | null)[] = data?.daily?.temperature_2m_max ?? [];
  const tmin: (number | null)[] = data?.daily?.temperature_2m_min ?? [];
  const precip: (number | null)[] = data?.daily?.precipitation_sum ?? [];
  const snow: (number | null)[] = data?.daily?.snowfall_sum ?? [];

  return dates.map((date, i) => {
    const day = {
      tmax: tmax[i] ?? null,
      tmin: tmin[i] ?? null,
      precip_mm: precip[i] ?? null,
      snow_cm: snow[i] ?? null,
    };
    return {
      date,
      tavg: tavg[i] ?? null,
      ...day,
      bucket: classifyWeather(day),
    };
  });
}

/**
 * Helper: generate a YYYY-MM-DD date range [start, end] inclusive.
 */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  for (let d = s; d.getTime() <= e.getTime(); d = addDays(d, 1)) {
    out.push(toISODate(d));
  }
  return out;
}
