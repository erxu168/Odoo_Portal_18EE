/**
 * GET  /api/label-sizes?companyId=5
 * POST /api/label-sizes  { action: 'save_size'|'delete_size'|'set_default', ... }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/db';
import { cookies } from 'next/headers';
import {
  getSavedLabelSizes, createSavedLabelSize, deleteSavedLabelSize,
  getLabelSizePreference, setLabelSizePreference,
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

  const savedSizes = getSavedLabelSizes(companyId);
  const preference = getLabelSizePreference(user.id, companyId);

  return NextResponse.json({ savedSizes, preference });
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { action, companyId } = body;
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  switch (action) {
    case 'save_size': {
      const { name, width_mm, height_mm } = body;
      if (!name || !width_mm || !height_mm) {
        return NextResponse.json({ error: 'name, width_mm, height_mm required' }, { status: 400 });
      }
      if (name.length > 50) {
        return NextResponse.json({ error: 'Name must be 50 characters or less' }, { status: 400 });
      }
      try {
        const saved = createSavedLabelSize(name, width_mm, height_mm, companyId, user.id, user.name);
        return NextResponse.json({ saved });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return NextResponse.json({ error: 'A size with that name already exists' }, { status: 409 });
        }
        throw err;
      }
    }

    case 'delete_size': {
      const { sizeId } = body;
      if (!sizeId) return NextResponse.json({ error: 'sizeId required' }, { status: 400 });
      if (user.role === 'staff') {
        return NextResponse.json({ error: 'Only managers can delete saved sizes' }, { status: 403 });
      }
      const deleted = deleteSavedLabelSize(sizeId, companyId);
      return NextResponse.json({ deleted });
    }

    case 'set_default': {
      const { sizeType, presetId, savedSizeId, customWidthMm, customHeightMm } = body;
      if (!sizeType) return NextResponse.json({ error: 'sizeType required' }, { status: 400 });
      const pref = setLabelSizePreference(
        user.id, companyId, sizeType,
        presetId ?? null, savedSizeId ?? null,
        customWidthMm ?? null, customHeightMm ?? null
      );
      return NextResponse.json({ preference: pref });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
