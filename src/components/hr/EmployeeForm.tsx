'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { useCompany } from '@/lib/company-context';

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
  // The restaurant currently selected in the header switcher.
  const { companyId: activeCompanyId, companyName: activeCompanyName } = useCompany();

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // After a normal create: show a panel offering the self-onboarding link.
  const [createdEmp, setCreatedEmp] = useState<{ id: number; name: string } | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [skill, setSkill] = useState<'' | '1' | '2' | '3'>('');

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

  // New staff default to the restaurant you are currently working in (header
  // switcher). You can still pick another restaurant you manage — a guardrail
  // warning appears below the picker when the choice differs from your active one.
  useEffect(() => {
    if (isNew && companyId === null && activeCompanyId) setCompanyId(activeCompanyId);
  }, [isNew, activeCompanyId, companyId]);

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

  async function handleSubmit(andNew: boolean) {
    setError(null);
    setJustAdded(null);
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
        ...(isNew && skill ? { skill } : {}),
      };
      const res = isNew
        ? await fetch('/api/hr/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(`/api/hr/employee/${employeeId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      // "Save & add another": stay on the form, clear the person-specific
      // fields, and keep the restaurant + department for the next entry.
      if (andNew && isNew) {
        setJustAdded(payload.name);
        setName('');
        setJobTitle('');
        setWorkEmail('');
        setMobilePhone('');
        setSaving(false);
        return;
      }
      const savedId = isNew ? data.employee?.id : employeeId;
      // New staff: stay and offer the self-onboarding link before leaving.
      if (isNew && savedId) {
        setCreatedEmp({ id: savedId as number, name: payload.name });
        setSaving(false);
        return;
      }
      onSaved(savedId as number, isNew);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  async function getInvite() {
    if (!createdEmp) return;
    setInviting(true);
    setError(null);
    try {
      const res = await fetch('/api/hr/staff-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: createdEmp.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the link.');
      setInviteLink(typeof data.link === 'string' ? data.link : null);
      setInviteMsg(
        typeof data.message === 'string'
          ? data.message
          : data.emailSent
            ? 'We also emailed the link to them.'
            : 'No email on file — copy the link and send it to them.',
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create the link.');
    } finally {
      setInviting(false);
    }
  }

  function copyLink() {
    if (inviteLink && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  if (createdEmp) {
    return (
      <div className="min-h-screen bg-gray-50 pb-28">
        <AppHeader title="Staff added" showBack onBack={() => onSaved(createdEmp.id, true)} />
        <div className="p-5 flex flex-col gap-4">
          <div className="px-4 py-5 bg-green-50 border border-green-200 rounded-2xl text-center">
            <div className="text-2xl mb-1">✓</div>
            <div className="font-bold text-gray-900">{createdEmp.name} added</div>
            <div className="text-[var(--fs-sm)] text-gray-600 mt-1">
              Send them a link so they can fill in their own details, tax info and documents.
            </div>
          </div>

          {inviteLink ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col gap-2.5">
              <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400">Onboarding link</div>
              <div className="text-[var(--fs-sm)] break-all text-gray-800 bg-gray-50 rounded-lg p-2.5">{inviteLink}</div>
              <button onClick={copyLink}
                className="w-full py-3 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-90">
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
              {inviteMsg && <div className="text-[var(--fs-xs)] text-gray-500">{inviteMsg}</div>}
            </div>
          ) : (
            <button onClick={getInvite} disabled={inviting}
              className="w-full py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90 disabled:opacity-50">
              {inviting ? 'Creating link…' : 'Send onboarding link'}
            </button>
          )}

          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>}

          <button onClick={() => onSaved(createdEmp.id, true)}
            className="w-full py-3.5 bg-white border border-gray-200 text-gray-700 font-bold text-[var(--fs-sm)] rounded-xl active:bg-gray-50">
            Done
          </button>
        </div>
      </div>
    );
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
          {justAdded && (
            <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-800 text-[var(--fs-sm)]">
              ✓ Added <b>{justAdded}</b>. Ready for the next one — the restaurant and department are kept.
            </div>
          )}
          <Field label="Full name">
            <input value={name} onChange={e => { setName(e.target.value); setJustAdded(null); }} placeholder="e.g. Maria Schmidt"
              className="form-inp" />
          </Field>

          <Field label="Restaurant">
            <select value={companyId ?? ''} onChange={e => handleCompanyChange(e.target.value ? parseInt(e.target.value) : null)}
              className="form-inp appearance-none">
              <option value="">Choose a restaurant…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {isNew && companyId !== null && activeCompanyId !== 0 && companyId !== activeCompanyId && (
              <p className="mt-1.5 text-[13px] leading-snug text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                ⚠️ This person will be added to{' '}
                <b>{companies.find(c => c.id === companyId)?.name || 'another restaurant'}</b>, not{' '}
                <b>{activeCompanyName}</b> (the restaurant you are working in now). Make sure that is correct.
              </p>
            )}
          </Field>

          <Field label="Department">
            <select value={departmentId ?? ''} onChange={e => setDepartmentId(e.target.value ? parseInt(e.target.value) : null)}
              disabled={!companyId} className="form-inp appearance-none disabled:opacity-50">
              <option value="">{companyId ? 'Choose a department…' : 'Pick a restaurant first'}</option>
              {visibleDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>

          {isNew && (
            <Field label="Skill level">
              <select value={skill} onChange={e => setSkill(e.target.value as '' | '1' | '2' | '3')}
                className="form-inp appearance-none">
                <option value="">Set later (in Planning → Roster)</option>
                <option value="1">Level 1 — can’t work alone</option>
                <option value="2">Level 2 — can hold a shift alone</option>
                <option value="3">Level 3 — trained on everything</option>
              </select>
              <span className="block text-[var(--fs-xs)] text-gray-400 mt-1">Decides which open shifts this person can pick up.</span>
            </Field>
          )}

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
          <div className="max-w-lg mx-auto flex flex-col gap-2">
            <button onClick={() => handleSubmit(false)} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90 disabled:opacity-50">
              {saving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (isNew ? 'Add staff member' : 'Save changes')}
            </button>
            {isNew && (
              <button onClick={() => handleSubmit(true)} disabled={saving}
                className="w-full py-3.5 bg-white border border-green-600 text-green-700 font-bold text-[var(--fs-sm)] rounded-xl active:bg-green-50 disabled:opacity-50">
                Save &amp; add another
              </button>
            )}
          </div>
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
