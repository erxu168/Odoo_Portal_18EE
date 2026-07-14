// src/app/api/rentals/tenancies/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow, berlinToday } from '@/lib/rentals-db';

export async function GET(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const status = req.nextUrl.searchParams.get('status');
    const q = req.nextUrl.searchParams.get('q');

    let sql = `
      SELECT t.*,
        tn.full_name AS tenant_name, tn.email AS tenant_email,
        r.room_code, r.room_name, r.size_sqm,
        p.id AS property_id, p.street, p.plz, p.city
      FROM tenancies t
      JOIN tenants tn ON tn.id = t.tenant_id
      JOIN rooms r ON r.id = t.room_id
      JOIN properties p ON p.id = r.property_id
    `;
    const where: string[] = [];
    const params: unknown[] = [];
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (q) { where.push('(tn.full_name LIKE ? OR p.street LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY t.start_date DESC`;

    const rows = db.prepare(sql).all(...params);
    return NextResponse.json({ tenancies: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      room_id, tenant_id, contract_type, start_date, end_date,
      kaltmiete, nebenkosten, kaution, contract_pdf_path, notes,
      staffel_steps, // optional: array of {effective_date, new_kaltmiete}
    } = body;

    if (!room_id || !tenant_id || !contract_type || !start_date || kaltmiete === undefined) {
      return NextResponse.json(
        { error: 'room_id, tenant_id, contract_type, start_date, kaltmiete required' },
        { status: 400 }
      );
    }

    const db = getRentalsDb();
    const now = berlinNow();
    const warmmiete = Number(kaltmiete) + Number(nebenkosten ?? 0);

    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO tenancies
        (room_id, tenant_id, contract_type, start_date, end_date,
         kaltmiete, nebenkosten, warmmiete, kaution, kaution_received,
         status, contract_pdf_path, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?)
      `).run(
        room_id, tenant_id, contract_type, start_date, end_date ?? null,
        kaltmiete, nebenkosten ?? 0, warmmiete, kaution ?? 0,
        contract_pdf_path ?? null, notes ?? null, now, now
      );
      const tenancyId = Number(result.lastInsertRowid);

      // Mark room occupied
      db.prepare(`UPDATE rooms SET status = 'occupied', updated_at = ? WHERE id = ?`).run(now, room_id);

      // Pre-create Staffelmiete rent steps if provided
      if (contract_type === 'staffel' && Array.isArray(staffel_steps)) {
        const stmt = db.prepare(`
          INSERT INTO tenancy_rent_steps
          (tenancy_id, effective_date, new_kaltmiete, type, reason, applied, created_at)
          VALUES (?, ?, ?, 'staffel', ?, 0, ?)
        `);
        for (const step of staffel_steps) {
          stmt.run(tenancyId, step.effective_date, step.new_kaltmiete, step.reason ?? null, now);
        }
      }

      return tenancyId;
    });

    const tenancyId = tx();
    return NextResponse.json({ id: tenancyId }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
