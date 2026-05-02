/**
 * GET /api/purchase/products/image?product_id=X
 * Streams the Odoo product.product.image_128 thumbnail as PNG bytes.
 * Cached at the browser for 1h to keep the guide snappy.
 */
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { searchParams } = new URL(request.url);
  const productId = parseInt(searchParams.get('product_id') || '0');
  if (!productId) return new Response('product_id required', { status: 400 });

  try {
    const odoo = getOdoo();
    const records = (await odoo.read('product.product', [productId], ['image_128'])) as { image_128?: string | false }[];
    const b64 = records?.[0]?.image_128;
    if (!b64 || typeof b64 !== 'string') return new Response('No image', { status: 404 });

    const bytes = Buffer.from(b64, 'base64');
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'Content-Length': String(bytes.length),
      },
    });
  } catch (e: any) {
    console.error('[purchase/products/image] odoo read failed', e);
    return new Response('Failed to fetch image', { status: 502 });
  }
}
