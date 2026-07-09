import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';

/**
 * GET /api/address-autocomplete?q=...
 * Uses Photon (Komoot) for German address autocomplete.
 * Free, no API key, excellent German coverage.
 */
export async function GET(req: NextRequest) {
  try {
    requireAuth();
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';
    const postcode = searchParams.get('postcode') || '';
    const city = searchParams.get('city') || '';

    if (query.length < 3) {
      return NextResponse.json({ results: [] });
    }

    // Scope the street search to the city + postcode the user already entered
    // (much better matches than a bare street name), then restrict to Germany
    // with a bounding box + Berlin bias for ranking. Dropping the old
    // osm_tag=place:house so street-level matches are returned too.
    const qFull = [query, postcode, city].filter(Boolean).join(' ');
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(qFull)}&lang=de&limit=10` +
        `&bbox=5.87,47.27,15.04,55.06&lat=52.52&lon=13.405`,
      { headers: { 'User-Agent': 'KrawingsPortal/1.0' } }
    );

    if (!res.ok) {
      return NextResponse.json({ results: [] });
    }

    const data = await res.json();

    const seen = new Set<string>();
    const results = (data.features || [])
      .filter((f: any) => {
        const p = f.properties || {};
        // Germany only, and it must resolve to a street (either a house address
        // with `street`, or a street feature whose `name` is the street).
        return p.countrycode === 'DE' && (p.street || p.name);
      })
      .map((f: any) => {
        const p = f.properties;
        const streetName = p.street || p.name || '';
        const street = [streetName, p.housenumber].filter(Boolean).join(' ');
        const city = p.city || p.town || p.village || p.county || '';
        return {
          street,
          postcode: p.postcode || '',
          city,
          state: p.state || '',
          country: p.country || 'Deutschland',
          display: [street, p.postcode, city].filter(Boolean).join(', '),
        };
      })
      .filter((r: { display: string }) => {
        if (!r.display || seen.has(r.display)) return false;
        seen.add(r.display);
        return true;
      });

    return NextResponse.json({ results });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Address autocomplete error:', error);
    return NextResponse.json({ results: [] });
  }
}
