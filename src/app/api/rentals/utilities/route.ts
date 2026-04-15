// src/app/api/rentals/utilities/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';

export async function GET(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const propertyId = req.nextUrl.searchParams.get('property_id');

    if (!propertyId) {
      return NextResponse.json({ error: 'property_id required' }, { status: 400 });
    }

    const rows = db.prepare(`
      SELECT * FROM utility_providers WHERE property_id = ? ORDER BY category, provider_name
    `).all(Number(propertyId));

    return NextResponse.json({ utilities: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { property_id, category, custom_label, provider_name, account_no, monthly_cost, frequency, due_date, notes } = body;

    if (!property_id || !category || !provider_name) {
      return NextResponse.json({ error: 'property_id, category, provider_name required' }, { status: 400 });
    }

    const validCategories = ['electricity', 'gas', 'water', 'internet', 'insurance', 'recycling', 'other'];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` }, { status: 400 });
    }

    const validFrequencies = ['monthly', 'quarterly', 'annual', 'one_time'];
    const freq = frequency || 'monthly';
    if (!validFrequencies.includes(freq)) {
      return NextResponse.json({ error: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}` }, { status: 400 });
    }

    const db = getRentalsDb();
    const now = berlinNow();

    const result = db.prepare(`
      INSERT INTO utility_providers
      (property_id, category, custom_label, provider_name, account_no, monthly_cost, frequency, due_date, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      property_id, category, custom_label ?? null, provider_name,
      account_no ?? null, monthly_cost ?? 0, freq, due_date ?? null,
      notes ?? null, now, now
    );

    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
