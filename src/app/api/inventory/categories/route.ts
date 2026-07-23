export const dynamic = 'force-dynamic';
/**
 * /api/inventory/categories — product.category, editable from BOTH the portal
 * and Odoo (Odoo is the shared source of truth, so an edit here shows there and
 * vice-versa).
 * GET    — list categories
 * POST   — create      { name, parent_id? }
 * PATCH  — rename       { id, name }
 * DELETE — remove       ?id=   (refused while products or sub-categories use it)
 * All writes gated by inventory.productsettings.manage.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    const categories = await odoo.searchRead(
      'product.category',
      [],
      ['id', 'name', 'complete_name'],
      { limit: 2000, order: 'complete_name' },
    );
    return NextResponse.json({ categories });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/inventory/categories  { name, parent_id? }
 *
 * Quick-create a product.category in Odoo so a manager can add a missing
 * category without leaving the product form (in-place create rule). Gated by
 * the same permission as editing product settings. Optionally nests under an
 * existing parent category. Returns the created record (id/name/complete_name).
 */
export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const parentId = Number.isInteger(body.parent_id) && body.parent_id > 0 ? body.parent_id : undefined;

  try {
    const odoo = getOdoo();
    const vals: Record<string, any> = { name };
    if (parentId) vals.parent_id = parentId;
    const id = await odoo.create('product.category', vals);
    const [created] = await odoo.searchRead(
      'product.category',
      [['id', '=', id]],
      ['id', 'name', 'complete_name'],
      { limit: 1 },
    );
    return NextResponse.json({ category: created || { id, name, complete_name: name } }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid category id is required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 });

  try {
    const odoo = getOdoo();
    await odoo.write('product.category', [id], { name });
    const [updated] = await odoo.searchRead('product.category', [['id', '=', id]], ['id', 'name', 'complete_name'], { limit: 1 });
    return NextResponse.json({ category: updated || { id, name, complete_name: name } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const idRaw = searchParams.get('id');
  if (!idRaw || !/^\d+$/.test(idRaw)) return NextResponse.json({ error: 'A valid category id is required' }, { status: 400 });
  const id = parseInt(idRaw, 10);

  try {
    const odoo = getOdoo();
    // Refuse (with a friendly count) while products — INCLUDING archived ones
    // (active_test:false) — still use it. Odoo also enforces this on the DB side
    // (categ_id is required + ON DELETE RESTRICT), so a product can never be
    // orphaned; this just turns Odoo's raw error into a helpful message.
    const usedBy = await odoo.searchRead('product.template', [['categ_id', '=', id]], ['id'], { limit: 200, context: { active_test: false } });
    if (usedBy.length > 0) {
      const n = usedBy.length >= 200 ? '200+' : String(usedBy.length);
      return NextResponse.json({ error: `Still used by ${n} product${usedBy.length === 1 ? '' : 's'} — move them to another category first.` }, { status: 409 });
    }
    // Refuse if it has sub-categories. NOTE: Odoo's product.category.parent_id is
    // ondelete='cascade', so unlinking a parent silently removes children — the
    // check must sit immediately before unlink to keep the window tiny (a fully
    // atomic guard would need an Odoo-side method, which we don't add here; this
    // matches Odoo's own UI behaviour). active_test:false so a child never hides.
    const children = await odoo.searchRead('product.category', [['parent_id', '=', id]], ['id'], { limit: 1, context: { active_test: false } });
    if (children.length > 0) {
      return NextResponse.json({ error: 'This category has sub-categories — remove or move those first.' }, { status: 409 });
    }
    await odoo.unlink('product.category', [id]);
    return NextResponse.json({ message: 'Category removed' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
