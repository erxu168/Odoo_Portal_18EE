import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { OdooClient } from '@/lib/odoo';

/**
 * GET /api/hr/applicant/status
 * Returns the recruitment pipeline status for the logged-in candidate.
 */

const STAGE_ORDER = [
  { key: 'new', label: 'Applied' },
  { key: 'screening', label: 'Screening' },
  { key: 'trial_shift', label: 'Trial Shift' },
  { key: 'hireable', label: 'Hireable' },
  { key: 'contract_proposal', label: 'Contract Proposal' },
  { key: 'contract_signed', label: 'Contract Signed' },
];

function mapStageName(name: string): string {
  const lower = name.toLowerCase().trim();
  if (lower === 'new') return 'new';
  if (lower === 'screening') return 'screening';
  if (lower === 'trial shift') return 'trial_shift';
  if (lower === 'hireable') return 'hireable';
  if (lower === 'contract proposal') return 'contract_proposal';
  if (lower === 'contract signed') return 'contract_signed';
  return lower.replace(/\s+/g, '_');
}

export async function GET() {
  try {
    const user = getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (!user.applicant_id) {
      return NextResponse.json({ error: 'Not a candidate' }, { status: 404 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    const applicants = await odoo.searchRead('hr.applicant', [
      ['id', '=', user.applicant_id],
    ], [
      'partner_name', 'email_from', 'job_id', 'department_id',
      'stage_id', 'create_date', 'priority',
    ], { limit: 1 });

    if (!applicants || applicants.length === 0) {
      return NextResponse.json({ error: 'Applicant record not found' }, { status: 404 });
    }

    const app = applicants[0];
    const stageName = app.stage_id ? app.stage_id[1] : 'New';
    const stageKey = mapStageName(stageName);

    // Find current position in pipeline
    const currentIndex = STAGE_ORDER.findIndex(s => s.key === stageKey);

    // Gate logic: determine what the candidate can access
    const canOnboard = ['contract_proposal', 'contract_signed'].includes(stageKey);
    const isHired = stageKey === 'contract_signed';

    return NextResponse.json({
      applicant_id: user.applicant_id,
      name: app.partner_name || '',
      email: app.email_from || '',
      job: app.job_id ? { id: app.job_id[0], name: app.job_id[1] } : null,
      department: app.department_id ? { id: app.department_id[0], name: app.department_id[1] } : null,
      stage: {
        key: stageKey,
        label: stageName,
        index: currentIndex >= 0 ? currentIndex : 0,
      },
      pipeline: STAGE_ORDER,
      gates: {
        can_view_status: true,
        can_onboard: canOnboard,
        is_hired: isHired,
      },
      applied_date: app.create_date || null,
    });
  } catch (err: unknown) {
    console.error('GET /api/hr/applicant/status error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch status' },
      { status: 500 },
    );
  }
}
