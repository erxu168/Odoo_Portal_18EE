/**
 * GET /api/hr/overview — the manager "needs attention" board, company-scoped.
 * Returns, for active staff the caller can see (admins: all; managers: their own
 * restaurants), who is missing mandatory documents, who has a residence permit /
 * visa / food-hygiene card expiring soon, and whose fixed-term contract ends soon.
 * Read-only; mirrors the krawings_hr_doc_reminder thresholds.
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { parseCompanyIds } from '@/lib/db';

export const dynamic = 'force-dynamic';

const REQUIRED_DOC_TAGS: Record<number, string> = {
  45: 'ID card / passport', 46: 'Tax-ID letter', 47: 'SV card',
  48: 'Rote Karte (food hygiene)', 52: 'Employment contract',
};
const EXPIRY_FIELDS: [string, string][] = [
  ['work_permit_expiration_date', 'Residence / work permit'],
  ['visa_expire', 'Visa'],
  ['kw_gesundheitszeugnis_ablauf', 'Food-hygiene card'],
];

function berlinToday(): Date {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  return new Date(s + 'T00:00:00Z');
}
function daysUntil(iso: string, today: Date): number {
  return Math.round((new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime() - today.getTime()) / 86400000);
}

export async function GET() {
  try {
    const user = requireRole('manager');
    const odoo = getOdoo();
    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);

    const [expiryLead, contractLead] = await Promise.all([
      odoo.call('ir.config_parameter', 'get_param', ['krawings_hr_doc_reminder.expiry_lead_days']),
      odoo.call('ir.config_parameter', 'get_param', ['krawings_hr_doc_reminder.contract_lead_days']),
    ]);
    const expiryDays = parseInt(String(expiryLead), 10) || 30;
    const contractDays = parseInt(String(contractLead), 10) || 45;

    const empDomain: unknown[] = [['active', '=', true]];
    if (allowed) empDomain.push(['company_id', 'in', allowed]);
    const emps = await odoo.searchRead('hr.employee', empDomain,
      ['id', 'name', 'department_id', 'work_permit_expiration_date', 'visa_expire', 'kw_gesundheitszeugnis_ablauf'],
      { limit: 1000, order: 'name asc' });
    const empIds = emps.map((e: Record<string, any>) => e.id as number);
    const today = berlinToday();
    const deptName = (e: Record<string, any>) => (Array.isArray(e.department_id) ? e.department_id[1] : '');

    // --- Missing mandatory documents ---
    const missingDocs: unknown[] = [];
    const tagIds = Object.keys(REQUIRED_DOC_TAGS).map(Number);
    if (empIds.length) {
      const docs = await odoo.searchRead('documents.document',
        [['res_model', '=', 'hr.employee'], ['res_id', 'in', empIds], ['tag_ids', 'in', tagIds], ['type', '=', 'binary']],
        ['res_id', 'tag_ids'], { limit: 5000 });
      const present: Record<number, Set<number>> = {};
      for (const d of docs) {
        const rid = d.res_id as number;
        (present[rid] ||= new Set());
        for (const t of (d.tag_ids as number[]) || []) if (tagIds.includes(t)) present[rid].add(t);
      }
      for (const e of emps) {
        const have = present[e.id as number] || new Set<number>();
        const missing = tagIds.filter((t) => !have.has(t)).map((t) => REQUIRED_DOC_TAGS[t]);
        if (missing.length) missingDocs.push({ id: e.id, name: e.name, dept: deptName(e), missing });
      }
    }

    // --- Expiring credentials ---
    const expiring: { id: number; name: string; dept: string; items: { label: string; date: string; days: number }[] }[] = [];
    for (const e of emps) {
      const items: { label: string; date: string; days: number }[] = [];
      for (const [f, label] of EXPIRY_FIELDS) {
        const v = e[f] as string | false;
        if (v) { const days = daysUntil(v, today); if (days <= expiryDays) items.push({ label, date: v, days }); }
      }
      if (items.length) expiring.push({ id: e.id as number, name: e.name as string, dept: deptName(e), items });
    }
    expiring.sort((a, b) => Math.min(...a.items.map((i) => i.days)) - Math.min(...b.items.map((i) => i.days)));

    // --- Fixed-term contracts ending ---
    const contractsEnding: { id: number | null; name: string; dept: string; date: string; days: number }[] = [];
    if (empIds.length) {
      const cutoff = new Date(today.getTime() + contractDays * 86400000).toISOString().slice(0, 10);
      const contracts = await odoo.searchRead('hr.contract',
        [['state', '=', 'open'], ['employee_id', 'in', empIds], ['date_end', '!=', false], ['date_end', '<=', cutoff]],
        ['employee_id', 'date_end'], { limit: 1000 });
      const empById: Record<number, Record<string, any>> = {};
      for (const e of emps) empById[e.id as number] = e;
      for (const c of contracts) {
        const eid = Array.isArray(c.employee_id) ? (c.employee_id[0] as number) : null;
        const e = eid ? empById[eid] : null;
        contractsEnding.push({
          id: eid,
          name: Array.isArray(c.employee_id) ? (c.employee_id[1] as string) : '',
          dept: e ? deptName(e) : '',
          date: c.date_end as string,
          days: daysUntil(c.date_end as string, today),
        });
      }
      contractsEnding.sort((a, b) => a.days - b.days);
    }

    return NextResponse.json({
      expiryDays, contractDays,
      totalStaff: emps.length,
      missingDocs, expiring, contractsEnding,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/overview error:', err);
    return NextResponse.json({ error: 'Could not load the overview' }, { status: 500 });
  }
}
