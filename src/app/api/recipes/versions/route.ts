/**
 * GET /api/recipes/versions
 *
 * Fetches pending recipe reviews from Odoo.
 * Query params: ?status=review (default) or ?status=all
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'review';

  try {
    const odoo = getOdoo();

    const domain: any[] = [];
    if (status !== 'all') {
      domain.push(['status', '=', status]);
    }

    const versions = await odoo.searchRead(
      'krawings.recipe.version', domain,
      [
        'id', 'version', 'status', 'change_summary',
        'created_by_id', 'approved_by_id', 'approved_at',
        'rejection_reason', 'create_date',
        'product_tmpl_id', 'bom_id', 'step_ids',
      ],
      { order: 'create_date desc', limit: 50 },
    );

    const enriched = versions.map((v: any) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      change_summary: v.change_summary || '',
      created_by: v.created_by_id?.[1] || 'Unknown',
      approved_by: v.approved_by_id?.[1] || null,
      approved_at: v.approved_at || null,
      rejection_reason: v.rejection_reason || null,
      created_at: v.create_date,
      recipe_name: v.product_tmpl_id?.[1] || v.bom_id?.[1] || 'Unknown',
      recipe_type: v.product_tmpl_id ? 'cooking_guide' : 'production_guide',
      product_tmpl_id: v.product_tmpl_id?.[0] || null,
      bom_id: v.bom_id?.[0] || null,
      step_count: v.step_ids?.length || 0,
    }));

    return NextResponse.json({ versions: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe versions error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
