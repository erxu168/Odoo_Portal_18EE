import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { OdooClient } from '@/lib/odoo';

/**
 * GET /api/hr/applicant/status
 * Returns the recruitment pipeline status for the logged-in candidate.
 *
 * Pipeline order and gate thresholds are derived from hr.recruitment.stage
 * (keyed by numeric stage id + sequence), not from translated stage labels,
 * so renaming a stage in Odoo cannot silently break the onboarding gate.
 */

function mapStageName(name: string): string {
  const lower = (name || '').toLowerCase().trim();
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

    const [applicants, stages] = await Promise.all([
      odoo.searchRead(
        'hr.applicant',
        [['id', '=', user.applicant_id]],
        [
          'partner_name', 'email_from', 'job_id', 'department_id',
          'stage_id', 'create_date', 'priority',
        ],
        { limit: 1 },
      ),
      odoo.searchRead(
        'hr.recruitment.stage',
        [],
        ['name', 'sequence'],
        { order: 'sequence, id', limit: 100 },
      ),
    ]);

    if (!applicants || applicants.length === 0) {
      return NextResponse.json({ error: 'Applicant record not found' }, { status: 404 });
    }

    const app = applicants[0];

    const pipeline = stages.map((s: { id: number; name: string }) => ({
      id: s.id,
      key: mapStageName(s.name),
      label: s.name,
    }));

    const applicantStageId: number | null = app.stage_id ? app.stage_id[0] : null;
    const applicantStageName: string = app.stage_id ? app.stage_id[1] : 'New';
    const currentIndex = applicantStageId
      ? pipeline.findIndex((s) => s.id === applicantStageId)
      : -1;

    const proposalIndex = pipeline.findIndex((s) => s.key === 'contract_proposal');
    const signedIndex = pipeline.findIndex((s) => s.key === 'contract_signed');

    if (proposalIndex < 0) {
      console.warn(
        '[hr/applicant/status] No hr.recruitment.stage matched "contract_proposal" by normalized name — onboarding gate will stay closed. Check Odoo stage names.',
      );
    }

    const canOnboard = proposalIndex >= 0 && currentIndex >= proposalIndex;
    const isHired = signedIndex >= 0 && currentIndex >= signedIndex;

    const currentKey = currentIndex >= 0
      ? pipeline[currentIndex].key
      : mapStageName(applicantStageName);

    return NextResponse.json({
      applicant_id: user.applicant_id,
      name: app.partner_name || '',
      email: app.email_from || '',
      job: app.job_id ? { id: app.job_id[0], name: app.job_id[1] } : null,
      department: app.department_id ? { id: app.department_id[0], name: app.department_id[1] } : null,
      stage: {
        key: currentKey,
        label: applicantStageName,
        index: currentIndex >= 0 ? currentIndex : 0,
      },
      pipeline: pipeline.map(({ key, label }) => ({ key, label })),
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
