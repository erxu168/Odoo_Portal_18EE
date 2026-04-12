// src/app/api/rentals/vault/[id]/route.ts
// Vault entry — reveal (decrypt), update, delete
// All operations log to credentials_audit. 404 if not found.
import { NextRequest, NextResponse } from 'next/server';
import { revealCredential, updateCredential, deleteCredential } from '@/lib/vault';

function ctx(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || null;
  const ua = req.headers.get('user-agent') || null;
  const userId = Number(req.headers.get('x-user-id') || 0);
  return { ip, ua, userId };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { ip, ua, userId } = ctx(req);
    const entry = revealCredential(Number(params.id), userId, ip, ua);
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { ip, ua, userId } = ctx(req);
    const ok = updateCredential(Number(params.id), body, userId, ip, ua);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ updated: 1 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { ip, ua, userId } = ctx(req);
    const ok = deleteCredential(Number(params.id), userId, ip, ua);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deleted: 1 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
