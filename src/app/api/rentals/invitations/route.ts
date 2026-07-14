// src/app/api/rentals/invitations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      template_id, room_id,
      prospect_name, prospect_email, prospect_phone,
      proposed_start_date, proposed_kaltmiete, proposed_nebenkosten, proposed_kaution,
      contract_type,
    } = body;

    if (!template_id || !room_id || !prospect_name || !prospect_email ||
        !proposed_start_date || proposed_kaltmiete === undefined || !contract_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getRentalsDb();
    const now = berlinNow();
    const token = crypto.randomBytes(32).toString('base64url');

    // 14-day expiry
    const expires = new Date();
    expires.setDate(expires.getDate() + 14);
    const expiresAt = expires.toISOString().slice(0, 19).replace('T', ' ');

    const result = db.prepare(`
      INSERT INTO tenancy_invitations
      (template_id, room_id, prospect_name, prospect_email, prospect_phone,
       proposed_start_date, proposed_kaltmiete, proposed_nebenkosten, proposed_kaution,
       contract_type, token, status, sent_at, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?)
    `).run(
      template_id, room_id, prospect_name, prospect_email, prospect_phone ?? null,
      proposed_start_date, proposed_kaltmiete, proposed_nebenkosten ?? 0, proposed_kaution ?? 0,
      contract_type, token, now, expiresAt, now, now
    );

    const invitationId = Number(result.lastInsertRowid);
    const portalUrl = process.env.PORTAL_PUBLIC_URL || 'http://localhost:3000';
    const inviteLink = `${portalUrl}/tenant-application/${token}`;

    return NextResponse.json({
      id: invitationId,
      token,
      invite_link: inviteLink,
      expires_at: expiresAt,
    }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
