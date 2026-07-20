/**
 * Staff Lifecycle Checklists — master template collection.
 * GET  /api/staffing/templates?company_id=  → list a company's checklists (admin)
 * POST /api/staffing/templates              → create a checklist (admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { createTemplate, listTemplatesWithCounts } from '@/lib/staffing-checklist-db';
import type { CreateTemplateInput } from '@/types/staffing';

export async function GET(req: NextRequest) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const companyId = Number(new URL(req.url).searchParams.get('company_id'));
    if (!companyId) return NextResponse.json({ error: 'company_id required' }, { status: 400 });
    if (!canAccessCompany(user, companyId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ templates: listTemplatesWithCounts(companyId) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET templates', err);
    return NextResponse.json({ error: 'Failed to load checklists' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const b = (await req.json()) as CreateTemplateInput;
    if (!b.company_id || !b.stage || !b.scope || !b.name?.trim()) {
      return NextResponse.json({ error: 'company_id, stage, scope and name are required' }, { status: 400 });
    }
    if (!['joining', 'promotion', 'leaving'].includes(b.stage)) {
      return NextResponse.json({ error: 'Invalid stage.' }, { status: 400 });
    }
    if (!canAccessCompany(user, b.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // Only valid stage×scope combinations — a Joining+Level row must never occupy
    // the promotion unique index, etc.
    const validCombo = b.stage === 'promotion' ? b.scope === 'level' : (b.scope === 'base' || b.scope === 'team');
    if (!validCombo) {
      return NextResponse.json({ error: 'That stage and type do not go together.' }, { status: 400 });
    }
    if (b.scope === 'team' && !b.department_id) {
      return NextResponse.json({ error: 'Pick a team for a team add-on.' }, { status: 400 });
    }
    if (b.scope === 'level' && !(b.target_level === '2' || b.target_level === '3')) {
      return NextResponse.json({ error: 'Pick a valid target level for a promotion list.' }, { status: 400 });
    }
    const id = createTemplate({
      company_id: b.company_id, stage: b.stage, scope: b.scope,
      department_id: b.scope === 'team' ? b.department_id : null,
      target_level: b.scope === 'level' ? String(b.target_level) : null,
      name: b.name.trim(),
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] POST templates', err);
    return NextResponse.json({ error: 'Failed to create checklist' }, { status: 500 });
  }
}
