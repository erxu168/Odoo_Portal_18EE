'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface Props {
  employeeId: number | null; // null = create
  onBack: () => void;
  onHome: () => void;
  onSaved: (id: number, isNew: boolean) => void;
}

interface CompanyOption { id: number; name: string; }
interface DeptOption { id: number; name: string; company_id: number | null; }

export default function EmployeeForm({ employeeId, onBack, onSaved }: Props) {
  const isNew = employeeId === null;

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');

  // Load pickers (companies scoped to the user) + departments. Departments come
  // from /api/hr/departments (not /api/hr/filters) so brand-new / empty
  // departments are still selectable when adding staff.
  useEffect(() => {
    Promise.all([
      fetch('/api/companies').then(r => r.json()).catch(() => ({})),
      fetch('/api/hr/departments').then(r => r.json()).catch(() => ({})),
    ]).then(([comp, depts]) => {
      setCompanies(comp.companies || []);
      setDepartments(depts.departments || []);
    });
  }, []);

  // Prefill when editing.
  useEffect(() => {
    if (isNew) return;
    fetch('/api/hr/employees')
      .then(r => r.json())
      .then(d => {
        const emp = (d.employees || []).find((e: { id: number }) => e.id === employeeId);
        if (emp) {
          setName(emp.name || '');
          setCompanyId(Array.isArray(emp.company_id) ? emp.company_id[0] : null);
          setDepartmentId(Array.isArray(emp.department_id) ? emp.department_id[0] : null);
          setJobTitle(emp.job_title || '');
          setWorkEmail(emp.work_email || '');
          setMobilePhone(emp.mobile_phone || '');
        }
      })
      .catch(() => setError('Could not load this employee.'))
      .finally(() => setLoading(false));
  }, [employeeId, isNew]);

  const visibleDepts = companyId ? departments.filter(d => d.company_id === companyId) : [];

  function handleCompanyChange(id: number | null) {
    setCompanyId(id);
    // Reset department if it no longer belongs to the chosen restaurant.
    if (departmentId && !departments.some(d => d.id === departmentId && d.company_id === id)) {
      setDepartmentId(null);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) { setError('Please enter a name.'); return; }
    if (!companyId) { setError('Please choose a restaurant.'); return; }
    if (!departmentId) { setError('Please choose a department.'); return; }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        company_id: companyId,
        department_id: departmentId,
        job_title: jobTitle.trim(),
        work_email: workEmail.trim(),
        mobile_phone: mobilePhone.trim(),
      };
      const res = isNew
        ? await fetch('/api/hr/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(`/api/hr/employee/${employeeId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      const savedId = isNew ? data.employee?.id : employeeId;
      onSaved(savedId as number, isNew);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <AppHeader title={isNew ? 'Add staff' : 'Edit staff'} showBack onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="p-5 flex flex-col gap-4">
          <Field label="Full name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Maria Schmidt"
              className="form-inp" />
          </Field>

          <Field label="Restaurant">
            <select value={companyId ?? ''} onChange={e => handleCompanyChange(e.target.value ? parseInt(e.target.value) : null)}
              className="form-inp appearance-none">
              <option value="">Choose a restaurant…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          <Field label="Department">
            <select value={departmentId ?? ''} onChange={e => setDepartmentId(e.target.value ? parseInt(e.target.value) : null)}
              disabled={!companyId} className="form-inp appearance-none disabled:opacity-50">
              <option value="">{companyId ? 'Choose a department…' : 'Pick a restaurant first'}</option>
              {visibleDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>

          <Field label="Job role (optional)">
            <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Kitchen Assistant"
              className="form-inp" />
          </Field>

          <Field label="Mobile phone (optional)">
            <input value={mobilePhone} onChange={e => setMobilePhone(e.target.value)} placeholder="e.g. +49 160 1234567"
              className="form-inp" inputMode="tel" />
          </Field>

          <Field label="Email (optional)">
            <input value={workEmail} onChange={e => setWorkEmail(e.target.value)} placeholder="name@example.com"
              type="email" className="form-inp" />
          </Field>

          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>}

          <p className="text-[var(--fs-xs)] text-gray-400 px-1">
            The rest (tax, bank, documents) is filled in by the employee during onboarding.
          </p>
        </div>
      )}

      {!loading && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
          <button onClick={handleSubmit} disabled={saving}
            className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90 disabled:opacity-50">
            {saving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (isNew ? 'Add staff member' : 'Save changes')}
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
