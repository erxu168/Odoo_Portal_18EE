/**
 * Resolve the Odoo company that owns a POS register (pos.config).
 *
 * Shared by the public, no-login KDS endpoints (tasks / departments / staff /
 * task-complete) so the company is always derived server-side from the configId
 * — a client-sent company_id is never trusted.
 */
import { getOdoo } from '@/lib/odoo';

export async function companyIdForConfig(configId: number): Promise<number | null> {
  if (!Number.isInteger(configId) || configId <= 0) return null;
  const configs = await getOdoo().searchRead(
    'pos.config', [['id', '=', configId]], ['company_id'], { limit: 1 },
  );
  return configs.length && Array.isArray(configs[0].company_id) ? (configs[0].company_id[0] as number) : null;
}
