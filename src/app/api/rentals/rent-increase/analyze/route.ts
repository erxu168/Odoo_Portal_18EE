// src/app/api/rentals/rent-increase/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { analyzeRentIncrease } from '@/lib/mieterhoehung';
import { moduleForbidden } from '@/lib/module-access';

export async function GET(req: NextRequest) {
  const denied = moduleForbidden('rentals');
  if (denied) return denied;

  try {
    const tenancyId = Number(req.nextUrl.searchParams.get('tenancy_id'));
    if (!tenancyId) return NextResponse.json({ error: 'tenancy_id required' }, { status: 400 });

    const analysis = analyzeRentIncrease(tenancyId);
    return NextResponse.json(analysis);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
