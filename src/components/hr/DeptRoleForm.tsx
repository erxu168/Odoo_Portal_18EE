'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

type Kind = 'department' | 'role';

interface Props {
  kind: Kind;
  recordId: number | null; // null = create
  onBack: () => void;
  onHome: () => void;
  onSaved: () => void;
}

interface CompanyOption { id: number; name: string; }
interface DeptOption { id: number; name: string; company_id: number | null; active?: boolean; }

const NOUN = { department: 'department', role: 'role' } as const;

export default function DeptRoleForm({ kind, recordId, onBack, onSaved }: Props) {
  const isNew = recordId === null;
  const noun = NOUN[kind];

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null); // roles only
  const [active, setActive] = useState(true);
  const [memberCount, setMemberCount] = useState(0);

  // Pickers: companies (scoped). Roles also need departments to pick from.
  useEffect(() => {
    fetch('/api/companies').then(r => r.json()).then(d => setCompanies(d.companies || [])).catch(() => {});
    if (kind === 'role') {
      // include_archived so a role assigned to a now-archived department still
      // shows that department in the picker (instead of silently blanking it).
      fetch('/api/hr/departments?include_archived=1').then(r => r.json()).then(d => setDepartments(d.departments || [])).catch(() => {});
    }
  }, [kind]);

  // Prefill when editing.
  useEffect(() => {
    if (isNew) return;
    const path = kind === 'department' ? '/api/hr/departments?include_archived=1' : '/api/hr/jobs?include_archived=1';
    fetch(path)
      .then(r => r.json())
      .then(d => {
        const rows = kind === 'department' ? (d.departments || []) : (d.jobs || []);
        const rec = rows.find((x: { id: number }) => x.id === recordId);
        if (rec) {
          setName(rec.name || '');
          setCompanyId(rec.company_id ?? null);
          setActive(rec.active !== false);
          setMemberCount(kind === 'department' ? (rec.total_employee || 0) : (rec.no_of_employee || 0));
          if (kind === 'role') setDepartmentId(rec.department_id ?? null);
        } else {
          setError('Could not load this ' + noun + '.');
        }
      })
      .catch(() => setError('Could not load this ' + noun + '.'))
      .finally(() => setLoading(false));
  }, [recordId, isNew, kind, noun]);

  // Only offer active departments as choices, but keep an archived one visible
  // if it is the department currently assigned to this role.
  const visibleDepts = companyId
    ? departments.filter(d => d.company_id === companyId && (d.active !== false || d.id === departmentId))
    : [];

  function handleCompanyChange(id: number | null) {
    setCompanyId(id);
    if (departmentId && !departments.some(d => d.id === departmentId && d.company_id === id)) {
      setDepartmentId(null);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) { setError('Please enter a name.'); return; }
    if (!companyId) { setError('Please choose a restaurant.'); return; }

    setSaving(true);
    try {
      const listPath = kind === 'department' ? '/api/hr/departments' : '/api/hr/jobs';
      const itemPath = kind === 'department' ? `/api/hr/department/${recordId}` : `/api/hr/job/${recordId}`;
      const payload: Record<string, unknown> = { name: name.trim(), company_id: companyId };
      if (kind === 'role') payload.department_id = departmentId || null;

      const res = isNew
        ? await fetch(listPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(itemPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  async function handleArchiveToggle() {
    if (isNew) return;
    const goingToArchive = active;
    if (goingToArchive) {
      const warn = memberCount > 0
        ? `This ${noun} has ${memberCount} ${memberCount === 1 ? 'person' : 'people'} assigned. It will be hidden but they stay assigned. Archive anyway?`
        : `Archive this ${noun}? It will be hidden from the lists. You can restore it later.`;
      if (!window.confirm(warn)) return;
    }
    setSaving(true);
    setError(null);
    try {
      const itemPath = kind === 'department' ? `/api/hr/department/${recordId}` : `/api/hr/job/${recordId}`;
      const res = await fetch(itemPath, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !goingToArchive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update.');
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update.');
      setSaving(false);
    }
  }

  const title = isNew
    ? (kind === 'department' ? 'Add department' : 'Add role')
    : (kind === 'department' ? 'Edit department' : 'Edit role');

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <AppHeader title={title} showBack onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="p-5 flex flex-col gap-4">
          {!isNew && !active && (
            <div className="px-4 py-3 bg-gray-100 border border-gray-200 rounded-xl text-gray-600 text-[var(--fs-sm)]">
              This {noun} is archived (hidden from the lists). Restore it below to use it again.
            </div>
          )}

          <Field label={kind === 'department' ? 'Department name' : 'Role name'}>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={kind === 'department' ? 'e.g. Kitchen' : 'e.g. Line Cook'}
              className="form-inp" />
          </Field>

          <Field label="Restaurant">
            <select value={companyId ?? ''} onChange={e => handleCompanyChange(e.target.value ? parseInt(e.target.value) : null)}
              className="form-inp appearance-none">
              <option value="">Choose a restaurant…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          {kind === 'role' && (
            <Field label="Department (optional)">
              <select value={departmentId ?? ''} onChange={e => setDepartmentId(e.target.value ? parseInt(e.target.value) : null)}
                disabled={!companyId} className="form-inp appearance-none disabled:opacity-50">
                <option value="">{companyId ? 'No department' : 'Pick a restaurant first'}</option>
                {visibleDepts.map(d => <option key={d.id} value={d.id}>{d.active === false ? d.name + ' (archived)' : d.name}</option>)}
              </select>
            </Field>
          )}

          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>}

          {!isNew && (
            <button
              onClick={handleArchiveToggle}
              disabled={saving}
              className={'mt-1 w-full py-3 rounded-xl font-bold text-[var(--fs-sm)] border disabled:opacity-50 ' +
                (active ? 'border-red-200 text-red-600 bg-red-50 active:bg-red-100' : 'border-green-200 text-green-700 bg-green-50 active:bg-green-100')}
            >
              {active ? `Archive this ${noun}` : `Restore this ${noun}`}
            </button>
          )}
        </div>
      )}

      {!loading && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
          <button onClick={handleSubmit} disabled={saving}
            className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90 disabled:opacity-50">
            {saving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (isNew ? `Add ${noun}` : 'Save changes')}
          </button>
        </div>
      )}

      <style jsx>{`
        .form-inp {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.75rem;
          background: #fff;
          font-size: var(--fs-base);
          outline: none;
        }
        .form-inp:focus { border-color: #16a34a; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
