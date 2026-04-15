// src/app/api/rentals/properties/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { Property, PropertyWithStats } from '@/types/rentals';

export async function GET() {
  try {
    const db = getRentalsDb();
    const rows = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM rooms r WHERE r.property_id = p.id) AS rooms_total,
        (SELECT COUNT(*) FROM rooms r WHERE r.property_id = p.id AND r.status = 'occupied') AS rooms_occupied,
        (SELECT COALESCE(SUM(t.warmmiete), 0)
         FROM tenancies t
         JOIN rooms r ON r.id = t.room_id
         WHERE r.property_id = p.id AND t.status = 'active') AS monthly_income,
        (SELECT COALESCE(SUM(u.monthly_cost), 0)
         FROM utility_providers u
         WHERE u.property_id = p.id) AS monthly_costs
      FROM properties p
      ORDER BY p.street COLLATE NOCASE
    `).all() as (Property & {
      rooms_total: number;
      rooms_occupied: number;
      monthly_income: number;
      monthly_costs: number;
    })[];

    const results: PropertyWithStats[] = rows.map((r) => ({
      ...r,
      occupancy_pct: r.rooms_total > 0 ? Math.round((r.rooms_occupied / r.rooms_total) * 100) : 0,
    }));

    return NextResponse.json({ properties: results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      street, plz, city, floor_unit, type,
      total_size_sqm, owner, hausverwaltung,
      mietspiegel_eur_per_sqm, notes,
    } = body;

    if (!street || !plz || !city || !type) {
      return NextResponse.json(
        { error: 'street, plz, city, type are required' },
        { status: 400 }
      );
    }

    const db = getRentalsDb();
    const now = berlinNow();
    const result = db.prepare(`
      INSERT INTO properties
      (street, plz, city, floor_unit, type, total_size_sqm, owner, hausverwaltung,
       mietspiegel_eur_per_sqm, mietspiegel_updated_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      street, plz, city, floor_unit ?? null, type,
      total_size_sqm ?? null, owner ?? null, hausverwaltung ?? null,
      mietspiegel_eur_per_sqm ?? null,
      mietspiegel_eur_per_sqm ? now : null,
      notes ?? null, now, now
    );

    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
