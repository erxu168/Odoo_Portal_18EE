export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/product-codes
 *
 * Give products that have no barcode a house code, so their shelf label can be
 * scanned. 829 of Ethan's 880 products had none (2026-08-04), which would have
 * made a shelf label with nothing to scan on it — the whole point of the label.
 *
 * Body: { dry_run?: boolean, product_ids?: number[] }
 *   dry_run      — work out exactly what WOULD be written and return it,
 *                  touching nothing. Always offered before the real run: this
 *                  writes to live Odoo master data, not a portal setting.
 *   product_ids  — just these (the single button on a product page). Omitted =
 *                  every ACTIVE product in scope that still has no code.
 *   company_id   — which restaurant's catalogue. Omitted = everything the
 *                  caller may see, which for an unrestricted admin is every
 *                  restaurant — worth being explicit about from a screen.
 *
 * THE RULES, in order of importance:
 *  1. NEVER overwrite an existing barcode. A supplier's EAN is the real one and
 *     must win; only an empty field is filled.
 *  2. The code is KRW-<odoo product id> — unique by construction, so two
 *     managers running this at once cannot collide, and it stays stable when a
 *     product is renamed.
 *  3. A code already in use by anything else is skipped and reported, never
 *     forced. (Someone may have typed KRW-123 by hand.)
 *  4. One failure does not stop the rest, and every skip is named.
 *
 * Deliberately NOT a fake EAN-13: Krawings owns no GS1 prefix, and these labels
 * never leave the building. Verified on staging that Odoo stores, reads back and
 * finds a letter-prefixed code (the default nomenclature is non-GS1).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { isUnrestrictedAdmin } from '@/lib/inventory-access';
import { houseCode } from '@/lib/product-code';

type Skip = { product_id: number; name: string; reason: string };

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run === true;
  const explicitIds: number[] | null = Array.isArray(body.product_ids)
    ? body.product_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : null;
  const companyId: number | null = body.company_id != null ? Number(body.company_id) : null;

  try {
    const odoo = getOdoo();

    // Scope: a manager may only touch their own restaurant's products (plus
    // shared ones). An unrestricted admin sees everything.
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const domain: unknown[] = [
      ['barcode', '=', false],          // RULE 1 — only ever fill an empty field
      ['type', '=', 'consu'],
    ];
    if (explicitIds) domain.push(['id', 'in', explicitIds]);
    // A named restaurant wins; otherwise fall back to everything the caller may
    // see. Without this an unrestricted admin's bulk run reached EVERY
    // restaurant — the first dry run offered 1136 products across Ssam and WAJ
    // when the job in hand was one kitchen's shelves.
    if (companyId != null) {
      if (!isUnrestrictedAdmin(user) && !allowed.includes(companyId)) {
        return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
      }
      domain.push('|', ['company_id', '=', false], ['company_id', '=', companyId]);
    } else if (!isUnrestrictedAdmin(user) && allowed.length > 0) {
      domain.push('|', ['company_id', '=', false], ['company_id', 'in', allowed]);
    }

    // ACTIVE products only for a bulk run: an archived product is not on a shelf
    // and does not need a shelf label. Naming ids explicitly (the button on one
    // product's page) overrides that — a portal draft product is archived until
    // it is reviewed, yet it is sitting on a shelf right now.
    const targets = await odoo.searchReadAll('product.product', domain, ['id', 'name'], {
      ...(explicitIds ? { context: { active_test: false } } : {}),
    }) as { id: number; name: string }[];

    if (targets.length === 0) {
      return NextResponse.json({ dry_run: dryRun, total: 0, assigned: [], skipped: [], message: 'Every product already has a code.' });
    }

    // RULE 3 — is any proposed code already taken? One query, not N.
    const proposed = new Map<number, string>(targets.map((t) => [t.id, houseCode(t.id)]));
    const taken = await odoo.searchReadAll(
      'product.product',
      [['barcode', 'in', Array.from(proposed.values())]],
      ['id', 'barcode'],
      { context: { active_test: false } },
    ) as { id: number; barcode: string }[];
    const takenBy = new Map(taken.map((t) => [t.barcode, t.id]));

    const skipped: Skip[] = [];
    const plan: { product_id: number; name: string; code: string }[] = [];
    for (const t of targets) {
      const code = proposed.get(t.id)!;
      const owner = takenBy.get(code);
      if (owner != null && owner !== t.id) {
        skipped.push({ product_id: t.id, name: t.name, reason: `that code is already on product #${owner}` });
        continue;
      }
      plan.push({ product_id: t.id, name: t.name, code });
    }

    // THE DRY RUN. Exactly what the real run would do, having done none of it.
    if (dryRun) {
      return NextResponse.json({
        dry_run: true, total: plan.length, assigned: plan, skipped,
        scope: companyId != null ? `restaurant ${companyId}` : (isUnrestrictedAdmin(user) ? 'every restaurant' : 'your restaurants'),
      });
    }

    // Write in small batches so one bad record can't take the run down, and so
    // a slow Odoo doesn't hold hundreds of sockets open at once.
    const assigned: { product_id: number; name: string; code: string }[] = [];
    const BATCH = 20;
    for (let i = 0; i < plan.length; i += BATCH) {
      const slice = plan.slice(i, i + BATCH);
      await Promise.all(slice.map(async (p) => {
        try {
          await odoo.write('product.product', [p.product_id], { barcode: p.code });
          assigned.push(p);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          skipped.push({ product_id: p.product_id, name: p.name, reason: msg });
        }
      }));
    }

    return NextResponse.json({ dry_run: false, total: assigned.length, assigned, skipped });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[inventory] product-codes failed:', msg);
    return NextResponse.json({ error: 'Could not reach Odoo. Nothing was changed.' }, { status: 502 });
  }
}
