import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/address-autocomplete?q=...
 * Uses Photon (Komoot) for German address autocomplete.
 * Free, no API key, excellent German coverage.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') || '';

  if (query.length < 3) {
    return NextResponse.json({ results: [] });
  }

  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=de&limit=5&osm_tag=place:house&lat=52.52&lon=13.405`,
      { headers: { 'User-Agent': 'KrawingsPortal/1.0' } }
    );

    if (!res.ok) {
      return NextResponse.json({ results: [] });
    }

    const data = await res.json();

    const results = (data.features || [])
      .filter((f: any) => f.properties?.street)
      .map((f: any) => {
        const p = f.properties;
        return {
          street: [p.street, p.housenumber].filter(Boolean).join(' '),
          postcode: p.postcode || '',
          city: p.city || p.town || p.village || '',
          state: p.state || '',
          country: p.country || 'Germany',
          display: [
            [p.street, p.housenumber].filter(Boolean).join(' '),
            p.postcode,
            p.city || p.town || p.village,
          ].filter(Boolean).join(', '),
        };
      });

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Address autocomplete error:', err);
    return NextResponse.json({ results: [] });
  }
}
