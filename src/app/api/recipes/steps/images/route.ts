/**
 * GET /api/recipes/steps/images?step_id=123
 *
 * Lazy-loads images for a single step. Called by CookMode per step.
 * Returns base64 image data only when needed.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const stepId = searchParams.get('step_id');

  if (!stepId) {
    return NextResponse.json({ error: 'step_id required' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    const images = await odoo.searchRead(
      'krawings.recipe.step.image',
      [['step_id', '=', parseInt(stepId)]],
      ['id', 'step_id', 'image', 'caption', 'sort'],
      { order: 'sort', limit: 10 },
    );

    const result = images.map((img: any) => ({
      id: img.id,
      image: img.image || '',
      caption: img.caption || '',
    }));

    return NextResponse.json({ images: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Step images GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
