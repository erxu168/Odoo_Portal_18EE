export const dynamic = 'force-dynamic';
/**
 * How a product NESTS: box -> pack -> piece.
 *
 * GET — this product's live levels, biggest first, plus the problems (if any)
 *       that would make the chain mis-convert, so the editor can show them.
 * PUT — replace the whole chain: { levels: [{ id?, name, to_base, countable?,
 *       allow_partial?, barcode? }] }. All levels or none.
 *
 * The arithmetic itself is src/lib/packaging.ts (pure, unit-tested). This route
 * only reads/writes; it never converts a quantity.
 *
 * Manager+ (product settings): a conversion decides what stock is WORTH, so it
 * sits behind the same gate as cost and supplier prices.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { initInventoryTables, listPackagingLevels, setPackagingLevels, toPackLevel } from '@/lib/inventory-db';
import { validateLevels, describeChain } from '@/lib/packaging';
import { canAccessCompany } from '@/lib/inventory-access';
import { getOdoo } from '@/lib/odoo';
import type { PortalUser } from '@/lib/auth';
import { moduleForbidden } from '@/lib/module-access';

/**
 * Packaging is stored GLOBALLY per Odoo product id — but global storage is not
 * global authorization. Without this, any manager could write a conversion for
 * any guessed id, including another restaurant's product or one that does not
 * exist. A product with no company is shared and open to any manager.
 */
async function productAllowed(user: PortalUser, productId: number) {
  try {
    const odoo = await getOdoo();
    const rows = await odoo.read('product.product', [productId], ['id', 'company_id']);
    if (!rows || rows.length === 0) {
      return { error: NextResponse.json({ error: 'That product does not exist.' }, { status: 404 }) };
    }
    const comp = rows[0].company_id;               // false when shared
    const companyId = Array.isArray(comp) ? comp[0] : null;
    if (companyId != null && !canAccessCompany(user, companyId)) {
      return { error: NextResponse.json({ error: 'That product belongs to another restaurant.' }, { status: 403 }) };
    }
    return { ok: true as const };
  } catch (err: unknown) {
    console.error('[packaging] product check failed:', err instanceof Error ? err.message : err);
    return { error: NextResponse.json({ error: 'Could not check that product — try again.' }, { status: 502 }) };
  }
}

function authed(write: boolean) {
  const user = requireAuth();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  // Reading the chain is needed to COUNT (the staff screen shows the steppers);
  // changing it is a manager decision.
  if (write && !roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return { error: NextResponse.json({ error: 'Manager access required' }, { status: 403 }) };
  }
  return { user };
}

function pid(params: { id: string }) {
  // The WHOLE segment must be the number: parseInt('12abc') is 12, so a
  // malformed URL would have edited a real product's conversions.
  const raw = (params?.id ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden(['inventory', 'products']);
  if (denied) return denied;

  const a = authed(false);
  if (a.error) return a.error;
  initInventoryTables();
  const productId = pid(params);
  if (!productId) return NextResponse.json({ error: 'Bad product id' }, { status: 400 });

  const guard = await productAllowed(a.user!, productId);
  if (guard.error) return guard.error;

  const { searchParams } = new URL(request.url);
  const baseWord = (searchParams.get('base_word') || '').trim();

  const rows = listPackagingLevels(productId);
  const levels = rows.map(toPackLevel);
  return NextResponse.json({
    levels: rows,
    problems: validateLevels(levels),
    chain: describeChain(levels, baseWord || 'units'),
  });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden(['inventory', 'products']);
  if (denied) return denied;

  const a = authed(true);
  if (a.error) return a.error;
  initInventoryTables();
  const productId = pid(params);
  if (!productId) return NextResponse.json({ error: 'Bad product id' }, { status: 400 });

  const guard = await productAllowed(a.user!, productId);
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.levels)) {
    return NextResponse.json({ error: 'levels[] is required' }, { status: 400 });
  }
  if (body.levels.length > 6) {
    // Three is the realistic depth (box -> pack -> piece); this is a sanity stop,
    // not a business rule.
    return NextResponse.json({ error: 'That is more packaging levels than a product can have.' }, { status: 400 });
  }

  try {
    const saved = setPackagingLevels(productId, body.levels, a.user!.id);
    const levels = saved.map(toPackLevel);
    return NextResponse.json({
      message: 'Packaging saved',
      levels: saved,
      problems: validateLevels(levels),
    });
  } catch (err: unknown) {
    // A chain that would mis-convert is a 400 with the reason, never a 500 — the
    // manager has to be able to see what is wrong and fix it.
    if (err instanceof Error && err.message.startsWith('PACKAGING_INVALID')) {
      return NextResponse.json({ error: err.message.replace('PACKAGING_INVALID: ', '') }, { status: 400 });
    }
    console.error('[packaging] save failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not save the packaging — try again.' }, { status: 500 });
  }
}
