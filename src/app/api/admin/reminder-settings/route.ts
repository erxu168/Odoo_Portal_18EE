/**
 * GET  /api/admin/reminder-settings — current HR reminder & expiry-alert switches.
 * PUT  /api/admin/reminder-settings — save them (also flips the matching Odoo
 *   scheduled actions so one toggle = fully on/off).
 *
 * Admin only. Backed by Odoo config parameters + the two crons in the
 * krawings_hr_doc_reminder module. Turning a feature "on" sets its param to True
 * AND activates its scheduled action; "off" reverses both.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export const dynamic = 'force-dynamic';

const P = {
  enabled: 'krawings_hr_doc_reminder.enabled',
  expiryEnabled: 'krawings_hr_doc_reminder.expiry_enabled',
  contractEnabled: 'krawings_hr_doc_reminder.contract_enabled',
  hrInbox: 'krawings_hr_doc_reminder.hr_fallback_email',
  leadDays: 'krawings_hr_doc_reminder.expiry_lead_days',
  contractLeadDays: 'krawings_hr_doc_reminder.contract_lead_days',
  testRecipient: 'krawings_hr_doc_reminder.test_recipient',
};
const CRON_REMINDERS = 'ir_cron_document_reminders';
const CRON_EXPIRY = 'ir_cron_expiry_alerts';
const CRON_CONTRACT = 'ir_cron_contract_end_alerts';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function adminOnly() {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  return null;
}

async function getParam(odoo: ReturnType<typeof getOdoo>, key: string): Promise<string> {
  const v = await odoo.call('ir.config_parameter', 'get_param', [key]);
  return typeof v === 'string' ? v : '';
}

// Resolve the two cron records' ids by xmlid (robust to renames/reordering).
async function cronIds(odoo: ReturnType<typeof getOdoo>): Promise<Record<string, number>> {
  const rows = await odoo.searchRead(
    'ir.model.data',
    [['module', '=', 'krawings_hr_doc_reminder'], ['name', 'in', [CRON_REMINDERS, CRON_EXPIRY, CRON_CONTRACT]]],
    ['name', 'res_id'],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.name as string] = r.res_id as number;
  return out;
}

export async function GET() {
  const gate = adminOnly();
  if (gate) return gate;
  try {
    const odoo = getOdoo();
    const [enabled, expiryEnabled, contractEnabled, hrInbox, leadDays, contractLeadDays, testRecipient] = await Promise.all([
      getParam(odoo, P.enabled), getParam(odoo, P.expiryEnabled), getParam(odoo, P.contractEnabled),
      getParam(odoo, P.hrInbox), getParam(odoo, P.leadDays), getParam(odoo, P.contractLeadDays),
      getParam(odoo, P.testRecipient),
    ]);
    return NextResponse.json({
      remindersOn: enabled === 'True',
      expiryOn: expiryEnabled === 'True',
      contractOn: contractEnabled === 'True',
      hrInbox: hrInbox || '',
      leadDays: parseInt(leadDays, 10) || 30,
      contractLeadDays: parseInt(contractLeadDays, 10) || 45,
      testRecipient: testRecipient || '',
    });
  } catch (err: unknown) {
    console.error('GET /api/admin/reminder-settings error:', err);
    return NextResponse.json({ error: 'Could not load settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const gate = adminOnly();
  if (gate) return gate;
  try {
    const body = await request.json();
    const remindersOn = !!body.remindersOn;
    const expiryOn = !!body.expiryOn;
    const contractOn = !!body.contractOn;
    const hrInbox = String(body.hrInbox || '').trim();
    const testRecipient = String(body.testRecipient || '').trim();
    const clampDays = (v: unknown, def: number) => {
      let n = parseInt(String(v), 10);
      if (!Number.isFinite(n) || n < 1) n = def;
      if (n > 365) n = 365;
      return n;
    };
    const leadDays = clampDays(body.leadDays, 30);
    const contractLeadDays = clampDays(body.contractLeadDays, 45);

    if (hrInbox && !EMAIL_RE.test(hrInbox)) {
      return NextResponse.json({ error: 'The HR inbox is not a valid email address.' }, { status: 400 });
    }
    if (testRecipient && !EMAIL_RE.test(testRecipient)) {
      return NextResponse.json({ error: 'The test address is not a valid email address.' }, { status: 400 });
    }

    const odoo = getOdoo();
    await Promise.all([
      odoo.call('ir.config_parameter', 'set_param', [P.enabled, remindersOn ? 'True' : 'False']),
      odoo.call('ir.config_parameter', 'set_param', [P.expiryEnabled, expiryOn ? 'True' : 'False']),
      odoo.call('ir.config_parameter', 'set_param', [P.contractEnabled, contractOn ? 'True' : 'False']),
      odoo.call('ir.config_parameter', 'set_param', [P.hrInbox, hrInbox]),
      odoo.call('ir.config_parameter', 'set_param', [P.leadDays, String(leadDays)]),
      odoo.call('ir.config_parameter', 'set_param', [P.contractLeadDays, String(contractLeadDays)]),
      odoo.call('ir.config_parameter', 'set_param', [P.testRecipient, testRecipient]),
    ]);

    // Keep the scheduled actions in step with the switches.
    const ids = await cronIds(odoo);
    if (ids[CRON_REMINDERS]) await odoo.write('ir.cron', [ids[CRON_REMINDERS]], { active: remindersOn });
    if (ids[CRON_EXPIRY]) await odoo.write('ir.cron', [ids[CRON_EXPIRY]], { active: expiryOn });
    if (ids[CRON_CONTRACT]) await odoo.write('ir.cron', [ids[CRON_CONTRACT]], { active: contractOn });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('PUT /api/admin/reminder-settings error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 });
  }
}
