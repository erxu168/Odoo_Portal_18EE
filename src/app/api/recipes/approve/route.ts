/**
 * POST /api/recipes/approve
 *
 * Approves or rejects a recipe version.
 * On approval, sets x_recipe_published=True on the parent product/bom.
 * Body: { version_id, action: 'approve'|'reject', reason?: string }
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager role required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { version_id, action, reason } = body;

    if (!version_id || !action) {
      return NextResponse.json({ error: 'version_id and action required' }, { status: 400 });
    }
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
    }

    const odoo = getOdoo();

    if (action === 'approve') {
      await odoo.write('krawings.recipe.version', [version_id], {
        status: 'approved',
        approved_by_id: user.odoo_uid || false,
        approved_at: new Date().toISOString().substring(0, 19).replace('T', ' '),
      });

      const [version] = await odoo.read(
        'krawings.recipe.version', [version_id],
        ['product_tmpl_id', 'bom_id'],
      );

      if (version.product_tmpl_id) {
        await odoo.write('product.template', [version.product_tmpl_id[0]], {
          x_recipe_published: true,
        });
      }
      if (version.bom_id) {
        await odoo.write('mrp.bom', [version.bom_id[0]], {
          x_recipe_published: true,
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Recipe approved and published',
      });
    } else {
      await odoo.write('krawings.recipe.version', [version_id], {
        status: 'rejected',
        rejection_reason: reason || '',
      });

      return NextResponse.json({
        success: true,
        message: 'Recipe rejected. Submitter will be notified.',
      });
    }
  } catch (err: any) {
    console.error('Recipe approve error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
