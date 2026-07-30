'use client';

import { useEffect, useRef } from 'react';
import { useCompany } from '@/lib/company-context';

/**
 * Company-change SUBSCRIBER for module screens — renders NOTHING.
 *
 * Ethan's call (2026-07-31): the portal has exactly ONE company switcher, the
 * top bar's `CompanySelector`. Module headers used to embed a second visible
 * pill here; two pickers for the same choice (with differently-truncated
 * labels) read as a bug, so the visible pill is gone.
 *
 * The component itself stays, because dozens of screens rely on its second
 * job: `onSwitched` fires whenever the SHARED selection (kw_company_id via
 * useCompany) changes — from the top bar or anywhere else — so each screen
 * reloads its data for the new restaurant. Existing call sites
 * (`action={<CompanyPill onSwitched={reload} />}`) keep working unchanged;
 * the AppHeader action slot simply renders empty.
 */
export interface CompanyPillProps {
  onSwitched?: (companyId: number) => void;
}

export function CompanyPill({ onSwitched }: CompanyPillProps) {
  const { companyId } = useCompany();
  const prevRef = useRef<number | null>(null);
  const cbRef = useRef(onSwitched);
  cbRef.current = onSwitched;

  useEffect(() => {
    if (companyId == null) return;
    // First observation is the initial value, not a switch.
    if (prevRef.current == null) { prevRef.current = companyId; return; }
    if (prevRef.current !== companyId) {
      prevRef.current = companyId;
      cbRef.current?.(companyId);
    }
  }, [companyId]);

  return null;
}

export default CompanyPill;
