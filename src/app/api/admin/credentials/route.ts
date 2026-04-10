import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { parseCompanyIds } from '@/lib/db';
import type { SupplierLogin, SupplierGroup, SupplierLoginRow } from '@/types/credentials';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = getCurrentUser();
  if (!user || !hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const odoo = getOdoo();
    const allowedIds = parseCompanyIds(user.allowed_company_ids);

    // Build domain: filter by user's companies (admins see all)
    const domain: any[] = hasRole(user, 'admin')
      ? []
      : [['company_id', 'in', allowedIds]];

    const logins: SupplierLogin[] = await odoo.searchRead(
      'krawings.supplier.login',
      domain,
      ['partner_id', 'company_id', 'username', 'password', 'website_url', 'notes'],
      { limit: 500, order: 'partner_id, company_id' },
    );

    // Get unique partner IDs to fetch website field
    const partnerIds = Array.from(new Set(logins.map((l) => l.partner_id[0])));
    const partners = partnerIds.length > 0
      ? await odoo.read('res.partner', partnerIds, ['name', 'website'])
      : [];

    const partnerMap = new Map(partners.map((p: any) => [p.id, p]));

    // Group logins by supplier
    const groupMap = new Map<number, SupplierGroup>();
    for (const login of logins) {
      const pid = login.partner_id[0];
      if (!groupMap.has(pid)) {
        const partner = partnerMap.get(pid);
        groupMap.set(pid, {
          id: pid,
          name: login.partner_id[1],
          website: partner?.website || false,
          logins: [],
        });
      }
      const row: SupplierLoginRow = {
        id: login.id,
        company_id: login.company_id[0],
        company_name: login.company_id[1],
        username: login.username,
        password: login.password,
        website_url: login.website_url,
        notes: login.notes,
      };
      groupMap.get(pid)!.logins.push(row);
    }

    const suppliers = Array.from(groupMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return NextResponse.json({ suppliers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[credentials] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user || !hasRole(user, 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { partner_id, company_id, username, password, website_url, notes } = body;

    if (!partner_id || !company_id || !username || !password) {
      return NextResponse.json(
        { error: 'partner_id, company_id, username, and password are required' },
        { status: 400 },
      );
    }

    const odoo = getOdoo();
    const id = await odoo.create('krawings.supplier.login', {
      partner_id,
      company_id,
      username,
      password,
      ...(website_url ? { website_url } : {}),
      ...(notes ? { notes } : {}),
    });

    return NextResponse.json({ id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[credentials] POST error:', message);
    if (message.includes('UNIQUE') || message.includes('unique')) {
      return NextResponse.json(
        { error: 'A login already exists for this supplier and company' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
