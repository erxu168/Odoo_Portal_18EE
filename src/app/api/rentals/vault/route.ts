// src/app/api/rentals/vault/route.ts
// Credentials vault — list (masked) + create
// Admin role required. Role check must be enforced by middleware upstream.
import { NextRequest, NextResponse } from 'next/server';
import { createCredential, listCredentialsForProperty } from '@/lib/vault';

function getClientContext(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || null;
  const ua = req.headers.get('user-agent') || null;
  const userIdHeader = req.headers.get('x-user-id');
  const userId = userIdHeader ? Number(userIdHeader) : 0;
  return { ip, ua, userId };
}

export async function GET(req: NextRequest) {
  try {
    const propertyId = Number(req.nextUrl.searchParams.get('property_id'));
    if (!propertyId) return NextResponse.json({ error: 'property_id required' }, { status: 400 });

    const { ip, ua, userId } = getClientContext(req);
    const entries = listCredentialsForProperty(propertyId, userId, ip, ua);
    return NextResponse.json({ entries });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { property_id, label, category, url, username, password, notes } = body;

    if (!property_id || !label || !category || !username || !password) {
      return NextResponse.json(
        { error: 'property_id, label, category, username, password required' },
        { status: 400 }
      );
    }

    const { ip, ua, userId } = getClientContext(req);
    const id = createCredential(
      { property_id, label, category, url: url ?? null, username, password, notes: notes ?? null },
      userId, ip, ua
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
