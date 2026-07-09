/**
 * Signed hard-copy contract file, stored on Odoo hr.contract as
 * kw_signed_contract_pdf (Binary) + kw_signed_contract_filename (Char).
 * One file per contract; uploading replaces the previous one.
 *
 *   GET    ?contract_id=… → stream the file inline (view / download)
 *   POST   { contract_id, filename, data } → upload/replace (data = base64, data-URL ok)
 *   DELETE ?contract_id=… → remove the file
 *
 * All verbs: managers + admins only, and company-scoped — the contract must
 * belong to this employee and to a restaurant the caller is allowed to manage.
 * Same audience as the rest of the contract screen (staff never reach it).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — keeps a huge scan from clogging Odoo
const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'];

function mimeFromName(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  };
  return map[ext] || 'application/octet-stream';
}

// Verify the caller may touch this contract. Returns null when OK, or a ready
// NextResponse describing the failure.
async function guard(
  odoo: ReturnType<typeof getOdoo>,
  user: ReturnType<typeof requireRole>,
  employeeId: number,
  contractId: number,
): Promise<NextResponse | null> {
  const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
  const rows = await odoo.searchRead('hr.contract', [['id', '=', contractId]],
    ['employee_id', 'company_id'], { limit: 1, context: { active_test: false } });
  if (!rows.length) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  const cEmp = Array.isArray(rows[0].employee_id) ? rows[0].employee_id[0] : null;
  const cCompany = Array.isArray(rows[0].company_id) ? rows[0].company_id[0] : null;
  if (cEmp !== employeeId) {
    return NextResponse.json({ error: 'That contract does not belong to this employee.' }, { status: 403 });
  }
  if (allowed && (cCompany === null || !allowed.includes(cCompany))) {
    return NextResponse.json({ error: 'You can only manage contracts in your own restaurant.' }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const employeeId = parseInt(params.id, 10);
    const contractId = parseInt(req.nextUrl.searchParams.get('contract_id') || '', 10);
    if (!employeeId || !contractId) {
      return NextResponse.json({ error: 'Missing employee or contract id' }, { status: 400 });
    }

    const odoo = getOdoo();
    const denied = await guard(odoo, user, employeeId, contractId);
    if (denied) return denied;

    const recs = await odoo.read('hr.contract', [contractId],
      ['kw_signed_contract_pdf', 'kw_signed_contract_filename']);
    const data = recs?.[0]?.kw_signed_contract_pdf;
    if (!data) return NextResponse.json({ error: 'No signed contract on file yet' }, { status: 404 });

    const name = recs[0].kw_signed_contract_filename || 'signed-contract';
    const buf = Buffer.from(data, 'base64');
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': mimeFromName(name),
        'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[hr] GET contract/signed-pdf error:', err);
    return NextResponse.json({ error: 'Failed to load the signed contract' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const employeeId = parseInt(params.id, 10);
    if (!employeeId) return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });

    const body = await req.json();
    const contractId = Number(body.contract_id);
    if (!contractId) {
      return NextResponse.json({ error: 'Save the contract first, then attach the signed copy.' }, { status: 400 });
    }
    const filename = String(body.filename || '').trim();
    let data = String(body.data || '');
    data = data.replace(/^data:[^;]+;base64,/, ''); // accept data-URL or raw base64
    if (!filename || !data) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: 'Please upload a PDF or a photo (JPG, PNG).' }, { status: 400 });
    }
    if (Buffer.from(data, 'base64').length > MAX_BYTES) {
      return NextResponse.json({ error: 'That file is too large (max 20 MB). Please compress it first.' }, { status: 413 });
    }

    const odoo = getOdoo();
    const denied = await guard(odoo, user, employeeId, contractId);
    if (denied) return denied;

    await odoo.write('hr.contract', [contractId], {
      kw_signed_contract_pdf: data,
      kw_signed_contract_filename: filename,
    });
    return NextResponse.json({ success: true, filename });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[hr] POST contract/signed-pdf error:', err);
    return NextResponse.json({ error: 'Failed to upload the signed contract' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const employeeId = parseInt(params.id, 10);
    const contractId = parseInt(req.nextUrl.searchParams.get('contract_id') || '', 10);
    if (!employeeId || !contractId) {
      return NextResponse.json({ error: 'Missing employee or contract id' }, { status: 400 });
    }

    const odoo = getOdoo();
    const denied = await guard(odoo, user, employeeId, contractId);
    if (denied) return denied;

    await odoo.write('hr.contract', [contractId], {
      kw_signed_contract_pdf: false,
      kw_signed_contract_filename: false,
    });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[hr] DELETE contract/signed-pdf error:', err);
    return NextResponse.json({ error: 'Failed to remove the signed contract' }, { status: 500 });
  }
}
