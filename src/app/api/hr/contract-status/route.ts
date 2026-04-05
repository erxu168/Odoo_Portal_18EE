import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/hr/contract-status
 * Returns the contract status for the logged-in user.
 * - If user has employee_id: queries hr.contract for that employee
 * - If user has applicant_id: queries hr.applicant for stage info
 * Returns: { stage, contract }
 */
export async function GET() {
  try {
    const user = getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const odoo = getOdoo();

    let stage: string = 'unknown';
    let contract: { state: string; name: string; date_start: string | false; date_end: string | false } | null = null;
    let sign_url: string | null = null;

    // 1) If user has employee_id, look up hr.contract
    if (user.employee_id) {
      try {
        const contracts = await odoo.searchRead(
          'hr.contract',
          [['employee_id', '=', user.employee_id]],
          ['state', 'name', 'date_start', 'date_end'],
          { limit: 1, order: 'date_start desc' },
        );
        if (contracts && contracts.length > 0) {
          const c = contracts[0];
          contract = {
            state: c.state || 'draft',
            name: c.name || '',
            date_start: c.date_start || false,
            date_end: c.date_end || false,
          };
          // Map contract state to a readable stage name
          const stateMap: Record<string, string> = {
            draft: 'New',
            open: 'Running',
            close: 'Expired',
            cancel: 'Cancelled',
          };
          stage = stateMap[c.state] || c.state || 'unknown';

          // Look up sign.request linked to this contract or employee
          if (c.state === 'draft' || c.state === 'open') {
            try {
              const signRequests = await odoo.searchRead(
                'sign.request',
                [
                  '|',
                  ['reference', 'ilike', c.name || ''],
                  ['reference', 'ilike', user.name || ''],
                ],
                ['id', 'state', 'reference', 'access_token'],
                { limit: 1, order: 'create_date desc' },
              );
              if (signRequests && signRequests.length > 0) {
                const sr = signRequests[0];
                const odooUrl = process.env.ODOO_URL || 'http://89.167.124.0:15069';
                sign_url = `${odooUrl}/my/signature/${sr.id}`;
              }
            } catch (signErr: unknown) {
              console.warn('[contract-status] Failed to query sign.request:', signErr instanceof Error ? signErr.message : signErr);
              // sign_url stays null - non-critical
            }
          }
        } else {
          stage = 'No contract';
        }
      } catch (err: unknown) {
        // hr.contract model may not exist or access denied
        console.warn('[contract-status] Failed to query hr.contract:', err instanceof Error ? err.message : err);
        stage = 'unavailable';
      }
    }

    // 2) If user has applicant_id (and no contract found), look up hr.applicant stage
    if (!contract && user.applicant_id) {
      try {
        const applicants = await odoo.searchRead(
          'hr.applicant',
          [['id', '=', user.applicant_id]],
          ['stage_id', 'partner_name'],
          { limit: 1 },
        );
        if (applicants && applicants.length > 0) {
          const app = applicants[0];
          stage = app.stage_id ? app.stage_id[1] : 'New';
        }
      } catch (err: unknown) {
        console.warn('[contract-status] Failed to query hr.applicant:', err instanceof Error ? err.message : err);
        // Keep whatever stage was set above
      }
    }

    return NextResponse.json({ stage, contract, sign_url });
  } catch (err: unknown) {
    console.error('GET /api/hr/contract-status error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch contract status' },
      { status: 500 },
    );
  }
}
