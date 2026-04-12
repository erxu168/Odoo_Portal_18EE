// src/app/api/rentals/tenants/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';

export async function GET(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const q = req.nextUrl.searchParams.get('q');
    let rows;
    if (q) {
      const like = `%${q}%`;
      rows = db.prepare(`
        SELECT * FROM tenants
        WHERE full_name LIKE ? OR email LIKE ? OR phone LIKE ?
        ORDER BY full_name COLLATE NOCASE
      `).all(like, like, like);
    } else {
      rows = db.prepare(`SELECT * FROM tenants ORDER BY full_name COLLATE NOCASE`).all();
    }
    return NextResponse.json({ tenants: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      full_name, email, phone, dob, nationality, employer, monthly_net_income,
      id_doc_path, schufa_doc_path, payslip_paths_json, emergency_contact, notes,
    } = body;

    if (!full_name) return NextResponse.json({ error: 'full_name required' }, { status: 400 });

    const db = getRentalsDb();
    const now = berlinNow();
    const result = db.prepare(`
      INSERT INTO tenants
      (full_name, email, phone, dob, nationality, employer, monthly_net_income,
       id_doc_path, schufa_doc_path, payslip_paths_json, emergency_contact, notes,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full_name, email ?? null, phone ?? null, dob ?? null, nationality ?? null,
      employer ?? null, monthly_net_income ?? null,
      id_doc_path ?? null, schufa_doc_path ?? null, payslip_paths_json ?? null,
      emergency_contact ?? null, notes ?? null, now, now
    );
    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
