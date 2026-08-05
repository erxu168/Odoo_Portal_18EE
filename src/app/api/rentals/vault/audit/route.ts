// src/app/api/rentals/vault/audit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogForVault, getRecentAuditLog } from '@/lib/vault';
import { moduleForbidden } from '@/lib/module-access';

export async function GET(req: NextRequest) {
  const denied = moduleForbidden('rentals');
  if (denied) return denied;

  try {
    const vaultId = req.nextUrl.searchParams.get('vault_id');
    const limit = Number(req.nextUrl.searchParams.get('limit') || 100);
    const logs = vaultId ? getAuditLogForVault(Number(vaultId), limit) : getRecentAuditLog(limit);
    return NextResponse.json({ logs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
