export const dynamic = 'force-dynamic';
/**
 * /api/inventory/templates
 *
 * GET  — list counting templates (filtered by location, active)
 * POST — create a new template (manager/admin only)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, createTemplate, listTemplates, updateTemplate, getTemplate, generateSessionForTemplate } from '@/lib/inventory-db';


export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('location_id');
  const active = searchParams.get('active');

  const templates = listTemplates({
    location_id: locationId ? parseInt(locationId) : undefined,
    active: active !== null ? active === 'true' : undefined,
  });

  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden \u2014 manager role required' }, { status: 403 });
  }

  const body = await request.json();
  const { name, frequency, location_id, category_ids, product_ids, assign_type, assign_id } = body;

  if (!name || !location_id) {
    return NextResponse.json({ error: 'name and location_id are required' }, { status: 400 });
  }

  const id = createTemplate({
    name,
    frequency: frequency || 'adhoc',
    location_id,
    category_ids: category_ids || [],
    product_ids: product_ids || [],
    assign_type: assign_type || null,
    assign_id: assign_id || null,
    created_by: user.id,
  });

  // Auto-generate a counting session for today
  const sessionId = generateSessionForTemplate(id);

  return NextResponse.json({ id, session_id: sessionId, message: 'Template created + session generated for today' }, { status: 201 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  updateTemplate(id, updates);
  return NextResponse.json({ message: 'Template updated' });
}
