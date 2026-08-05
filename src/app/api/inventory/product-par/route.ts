/**
 * Par levels — how much of a product this restaurant wants to hold.
 *
 * The SINGLE source of truth. The purchase order guide reads from here rather
 * than keeping its own number, because a product carrying two different pars in
 * two screens is a question nobody can answer.
 *
 * Scoped per company: WAJ and Ssam hold different volumes of the same thing.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { isUnrestrictedAdmin, canAccessCompany } from '@/lib/inventory-access';
import { initInventoryTables, getProductPar, setProductPar } from '@/lib/inventory-db';
import { moduleForbidden } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

/** A manager may only read or write par for a restaurant they belong to. */
function companyOr403(user: Parameters<typeof isUnrestrictedAdmin>[0], raw: string | null) {
  const companyId = raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return { error: NextResponse.json({ error: 'A restaurant is required' }, { status: 400 }) };
  }
  // isUnrestrictedAdmin, not "admin with an empty list": parseCompanyIds returns
  // [] for malformed JSON too, so the naive check would treat a corrupted
  // restriction as no restriction and hand over another restaurant's data.
  if (!isUnrestrictedAdmin(user) && !canAccessCompany(user, companyId)) {
    return { error: NextResponse.json({ error: 'That restaurant is not yours' }, { status: 403 }) };
  }
  return { companyId };
}

export async function GET(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const scoped = companyOr403(user, searchParams.get('company_id'));
  if ('error' in scoped) return scoped.error;

  const idsRaw = searchParams.get('ids');
  const ids = idsRaw
    ? idsRaw.split(',').map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0)
    : undefined;

  return NextResponse.json({ par: getProductPar(scoped.companyId, ids) });
}

export async function PUT(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Same capability as the rest of product setup — par is a setting, not a count.
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  initInventoryTables();

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const scoped = companyOr403(user, String(body.company_id ?? ''));
  if ('error' in scoped) return scoped.error;

  const productId = Number(body.product_id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'A product is required' }, { status: 400 });
  }

  // '' and null both mean "no par". 0 is a real value — "let it run to nothing".
  const num = (v: unknown) => (v === '' || v == null ? null : Number(v));

  try {
    setProductPar(productId, scoped.companyId, num(body.par_min), num(body.par_max), user.id);
    return NextResponse.json({ ok: true, par: getProductPar(scoped.companyId, [productId])[0] ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not save';
    if (msg.startsWith('PAR_INVALID')) {
      return NextResponse.json({ error: msg.replace('PAR_INVALID: ', '') }, { status: 400 });
    }
    console.error('[product-par PUT]', msg);
    return NextResponse.json({ error: 'Could not save the par level' }, { status: 500 });
  }
}
