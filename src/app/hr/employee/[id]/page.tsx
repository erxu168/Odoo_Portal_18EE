'use client';

/**
 * /hr/employee/[id] — a team member's canonical Form View. Part of the
 * Universal Record Drill-Down standard, but UNLIKE the other record types this
 * one is NOT view=any-authed: an employee record is PII / DATEV, so it is gated
 * to managers (hr.employee.manage) scoped to the person's restaurant, or the
 * person themselves (who is bounced to their self-service profile). It reuses
 * the existing EmployeeDetail + its 5 sub-editors, reproducing the HR app's edit
 * sub-navigation locally so no in-app SPA state is needed.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EmployeeDetail from '@/components/hr/EmployeeDetail';
import EmployeeForm from '@/components/hr/EmployeeForm';
import EmployeeSectionEdit, { type SectionKey } from '@/components/hr/EmployeeSectionEdit';
import EmployeeDocumentEdit from '@/components/hr/EmployeeDocumentEdit';
import EmployeeContract from '@/components/hr/EmployeeContract';
import EmployeeChecklistView from '@/components/hr/EmployeeChecklistView';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';
import { RECORD_EDIT_CAP } from '@/lib/record-links';

type Sub =
  | { kind: 'basics' }
  | { kind: 'section'; section: SectionKey }
  | { kind: 'doc'; docTypeKey: string }
  | { kind: 'contract' }
  | { kind: 'checklist'; instanceId: number };

function Wall({ msg, onBack }: { msg: string; onBack: () => void }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-8 text-center">
      <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">{msg}</p>
      <button onClick={onBack} className="mt-3 px-5 py-2.5 rounded-xl bg-green-600 text-white font-bold active:bg-green-700">Go back</button>
    </div>
  );
}

export default function EmployeeRecordPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const employeeId = /^\d+$/.test(params.id) ? parseInt(params.id, 10) : NaN;

  const [gate, setGate] = useState<'loading' | 'ok' | 'wall' | 'notfound' | 'invalid'>('loading');
  const [editMode, setEditMode] = useState(false);
  const [sub, setSub] = useState<Sub | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const back = () => (window.history.length > 1 ? router.back() : router.push('/hr'));

  useEffect(() => {
    if (!Number.isInteger(employeeId) || employeeId <= 0) { setGate('invalid'); return; }
    (async () => {
      let me: { role?: string; employee_id?: number | null; capabilities?: string[] } | null = null;
      try { const r = await fetch('/api/auth/me'); me = r.ok ? (await r.json()).user : null; } catch { /* stays gated */ }
      const caps: string[] = Array.isArray(me?.capabilities) ? me!.capabilities!
        : me?.role ? allowedActionKeysForRole(me.role as Role, {}) : [];
      const isManager = caps.includes(RECORD_EDIT_CAP.employee);

      if (!isManager) {
        // A staff member drilling into their OWN id → self-service profile
        // (never the manager DATEV API). Anyone else → access wall.
        if (me?.employee_id != null && Number(me.employee_id) === employeeId) { router.replace('/hr'); return; }
        setGate('wall'); return;
      }
      // Manager+: the company-scoped API is the true gate — confirm this record.
      try {
        const r = await fetch(`/api/hr/employee/${employeeId}`);
        if (r.status === 404) { setGate('notfound'); return; }
        if (!r.ok) { setGate('wall'); return; }   // 403 = another restaurant
        setGate('ok');
      } catch { setGate('wall'); }
    })();
  }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (gate === 'loading') return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading…</div>;
  if (gate === 'invalid' || gate === 'notfound') return <Wall msg="Team member not found" onBack={back} />;
  if (gate === 'wall') return <Wall msg="You don’t have access to this staff record" onBack={back} />;

  // Closing a sub-editor bumps refreshKey so EmployeeDetail (fetches on mount) reloads.
  const closeSub = () => { setSub(null); setRefreshKey((k) => k + 1); };
  const home = () => router.push('/');

  if (sub) {
    switch (sub.kind) {
      case 'basics': return <EmployeeForm employeeId={employeeId} onBack={closeSub} onHome={home} onSaved={() => closeSub()} />;
      case 'section': return <EmployeeSectionEdit employeeId={employeeId} section={sub.section} onBack={closeSub} onHome={home} onDone={closeSub} />;
      case 'doc': return <EmployeeDocumentEdit employeeId={employeeId} docTypeKey={sub.docTypeKey} onBack={closeSub} onHome={home} onDone={closeSub} />;
      case 'contract': return <EmployeeContract employeeId={employeeId} onBack={closeSub} onHome={home} onSaved={closeSub} />;
      case 'checklist': return <EmployeeChecklistView instanceId={sub.instanceId} onBack={closeSub} />;
    }
  }

  return (
    <EmployeeDetail
      key={refreshKey}
      employeeId={employeeId}
      onBack={back}
      onHome={home}
      onContract={() => setSub({ kind: 'contract' })}
      onDeactivated={() => router.replace('/hr')}
      editMode={editMode}
      onToggleEditMode={() => setEditMode((m) => !m)}
      onEditSection={(section) => setSub(section === 'basics' ? { kind: 'basics' } : { kind: 'section', section: section as SectionKey })}
      onEditDocument={(docTypeKey) => setSub({ kind: 'doc', docTypeKey })}
      onOpenChecklist={(instanceId) => setSub({ kind: 'checklist', instanceId })}
    />
  );
}
