'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

type Kind = 'department' | 'role';

interface Props {
  onBack: () => void;
  onHome: () => void;
  onAdd: (kind: Kind) => void;
  onEdit: (kind: Kind, id: number) => void;
}

interface CompanyOption { id: number; name: string; }

interface DeptRow {
  id: number;
  name: string;
  company_id: number | null;
  company_name: string;
  total_employee: number;
  active: boolean;
}
interface JobRow {
  id: number;
  name: string;
  company_id: number | null;
  company_name: string;
  department_name: string;
  no_of_employee: number;
  active: boolean;
}

export default function DepartmentsRoles({ onBack, onAdd, onEdit }: Props) {
  const [kind, setKind] = useState<Kind>('department');
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');

  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/companies').then(r => r.json()).then(d => setCompanies(d.companies || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, selectedCompany, showArchived]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCompany) params.set('company_id', String(selectedCompany));
      if (showArchived) params.set('include_archived', '1');
      const path = kind === 'department' ? '/api/hr/departments' : '/api/hr/jobs';
      const res = await fetch(path + '?' + params.toString());
      if (res.ok) {
        const data = await res.json();
        if (kind === 'department') setDepts(data.departments || []);
        else setJobs(data.jobs || []);
      }
    } catch {
      console.error('[hr] Failed to load departments/roles');
    } finally {
      setLoading(false);
    }
  }

  const term = search.trim().toLowerCase();
  const visibleDepts = term ? depts.filter(d => d.name.toLowerCase().includes(term)) : depts;
  const visibleJobs = term ? jobs.filter(j => j.name.toLowerCase().includes(term)) : jobs;
  const count = kind === 'department' ? visibleDepts.length : visibleJobs.length;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader title="Departments & Roles" subtitle={count + (kind === 'department' ? ' departments' : ' roles')} showBack onBack={onBack} />

      {/* Segmented control */}
      <div className="px-5 pt-4">
        <div className="flex bg-gray-100 rounded-xl p-1">
          <SegBtn label="Departments" active={kind === 'department'} onClick={() => setKind('department')} />
          <SegBtn label="Roles" active={kind === 'role'} onClick={() => setKind('role')} />
        </div>
      </div>

      {/* Company filter + show-archived */}
      <div className="px-5 pt-3 flex gap-2 items-center">
        <select
          className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-[var(--fs-sm)] font-semibold bg-white text-gray-700 outline-none focus:border-green-600 appearance-none"
          value={selectedCompany ?? ''}
          onChange={e => setSelectedCompany(e.target.value ? parseInt(e.target.value) : null)}
        >
          <option value="">All restaurants</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          onClick={() => setShowArchived(v => !v)}
          className={'whitespace-nowrap px-3 py-2.5 rounded-xl text-[var(--fs-sm)] font-bold border ' +
            (showArchived ? 'bg-green-100 text-green-700 border-green-200' : 'bg-white text-gray-500 border-gray-200')}
        >
          {showArchived ? 'Showing archived' : 'Show archived'}
        </button>
      </div>

      {/* Search */}
      <div className="px-5 pt-3">
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-[var(--fs-base)] bg-white outline-none focus:border-green-600"
            placeholder={kind === 'department' ? 'Search departments...' : 'Search roles...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="pt-3">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : count === 0 ? (
          <div className="text-center text-gray-400 mt-10 text-[var(--fs-sm)]">
            {kind === 'department' ? 'No departments yet' : 'No roles yet'}
          </div>
        ) : kind === 'department' ? (
          visibleDepts.map(d => (
            <ListCard
              key={d.id}
              name={d.name}
              sub={[d.company_name, d.total_employee + (d.total_employee === 1 ? ' person' : ' people')].filter(Boolean).join(' · ')}
              archived={!d.active}
              onClick={() => onEdit('department', d.id)}
            />
          ))
        ) : (
          visibleJobs.map(j => (
            <ListCard
              key={j.id}
              name={j.name}
              sub={[j.company_name, j.department_name, j.no_of_employee + (j.no_of_employee === 1 ? ' person' : ' people')].filter(Boolean).join(' · ')}
              archived={!j.active}
              onClick={() => onEdit('role', j.id)}
            />
          ))
        )}
      </div>

      {/* Add */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
        <button
          onClick={() => onAdd(kind)}
          className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          {kind === 'department' ? 'Add department' : 'Add role'}
        </button>
      </div>
    </div>
  );
}

function SegBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={'flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold transition-colors ' +
        (active ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500')}
    >
      {label}
    </button>
  );
}

function ListCard({ name, sub, archived, onClick }: { name: string; sub: string; archived: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full mx-5 mb-2 bg-white rounded-2xl p-4 flex items-center gap-3 border border-gray-200 text-left active:bg-gray-50"
      style={{ width: 'calc(100% - 40px)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[var(--fs-md)] font-bold text-gray-900 flex items-center gap-2">
          {name}
          {archived && (
            <span className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">Archived</span>
          )}
        </div>
        {sub && <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{sub}</div>}
      </div>
      <svg className="w-5 h-5 text-gray-300 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  );
}
