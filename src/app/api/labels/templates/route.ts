/**
 * GET  /api/labels/templates?companyId=5
 * POST /api/labels/templates  { action: 'save'|'delete', companyId, ... }
 *
 * Stores Custom Label presets (product name + qty + uom + label count).
 * Dates are intentionally NOT stored — always re-entered at print time.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/db';
import { cookies } from 'next/headers';
import {
  getCustomLabelTemplates,
  upsertCustomLabelTemplate,
  deleteCustomLabelTemplate,
} from '@/lib/labeling-db';

async function getUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('kw_session')?.value;
  if (!token) return null;
  return getSessionUser(token);
}

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = Number(req.nextUrl.searchParams.get('companyId'));
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  const templates = getCustomLabelTemplates(companyId);
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { action, companyId } = body;
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  switch (action) {
    case 'save': {
      const { productName, qty, uom, labelCount } = body;
      const trimmed = typeof productName === 'string' ? productName.trim() : '';
      if (!trimmed) return NextResponse.json({ error: 'productName required' }, { status: 400 });
      if (trimmed.length > 100) {
        return NextResponse.json({ error: 'Product name must be 100 characters or less' }, { status: 400 });
      }
      const template = upsertCustomLabelTemplate(
        trimmed,
        typeof qty === 'number' && Number.isFinite(qty) ? qty : null,
        typeof uom === 'string' && uom ? uom : null,
        typeof labelCount === 'number' && Number.isFinite(labelCount) ? labelCount : null,
        companyId,
        user.id,
        user.name,
      );
      return NextResponse.json({ template });
    }

    case 'delete': {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const deleted = deleteCustomLabelTemplate(id, companyId);
      return NextResponse.json({ deleted });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
