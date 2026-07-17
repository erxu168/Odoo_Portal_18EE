'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { PORTAL_MODULES, defaultModuleIds, parseModuleAccess } from '@/lib/modules';

/**
 * Unified People view for the Staff module.
 *
 * Employee-first: the real staff come from Odoo HR (hr.employee) via
 * /api/admin/staff-access. Each employee shows their portal-account status and,
 * when they have an account, the per-person access controls that used to live on
 * the old "Manage Staff" screen (role, company access, module access, PIN,
 * activate/deactivate, reset password). Employees with no account get an Invite
 * button. Two secondary sections cover the cases that are NOT employees:
 * pending self-registrations and non-person / other logins.
 */

interface Account {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  employee_id: number | null;
  active: number;
  allowed_company_ids: string;
  module_access: string | null;
  is_shared_device?: number;
  has_pin?: number;
  created_at: string;
  last_login: string | null;
}

interface Employee {
  employee_id: number;
  name: string;
  email: string;
  phone: string;
  department: string;
  status: 'active' | 'invited' | 'none';
  invited_at: string | null;
}

interface Company {
  id: number;
  name: string;
  warehouse_code: string | null;
}

type Tab = 'all' | 'none' | 'invited' | 'active';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: 'Has account', cls: 'bg-green-50 text-green-700' },
  invited: { label: 'Invited', cls: 'bg-amber-50 text-amber-700' },
  none: { label: 'No account', cls: 'bg-gray-100 text-gray-600' },
};

const roleColors: Record<string, string> = {
  admin: 'bg-red-50 text-red-700',
  manager: 'bg-green-50 text-green-800',
  staff: 'bg-gray-100 text-gray-600',
};

function parseCompanyIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function StaffPeople() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pending, setPending] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [expandedCompanies, setExpandedCompanies] = useState<number | null>(null);
  const [expandedModules, setExpandedModules] = useState<number | null>(null);
  const [links, setLinks] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [pendingRoles, setPendingRoles] = useState<Record<number, string>>({});

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [staffRes, usersRes, pendingRes, companiesRes] = await Promise.all([
        fetch('/api/admin/staff-access'),
        fetch('/api/admin/users'),
        fetch('/api/admin/registrations?status=pending'),
        fetch('/api/companies'),
      ]);
      if (staffRes.status === 403 || usersRes.status === 403) {
        setError('You need admin access to manage staff.');
        setLoading(false);
        return;
      }
      const staffData = await staffRes.json();
      const usersData = await usersRes.json();
      const pendingData = await pendingRes.json();
      const companiesData = await companiesRes.json();
      setEmployees(staffData.employees || []);
      setAccounts(usersData.users || []);
      setPending(pendingData.users || []);
      setCompanies(companiesData.companies || []);
    } catch {
      setError('Failed to load staff.');
    } finally {
      setLoading(false);
    }
  }

  function flash(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3500);
  }

  // Map each portal account to the employee it belongs to (if any).
  const accountByEmp = useMemo(() => {
    const m = new Map<number, Account>();
    for (const a of accounts) if (a.employee_id != null) m.set(a.employee_id, a);
    return m;
  }, [accounts]);

  // Active accounts that are NOT tied to any employee (shared devices, etc.).
  const otherAccounts = useMemo(
    () => accounts.filter((a) => a.employee_id == null && a.status === 'active'),
    [accounts],
  );

  const counts = useMemo(() => ({
    total: employees.length,
    active: employees.filter((e) => e.status === 'active').length,
    invited: employees.filter((e) => e.status === 'invited').length,
    none: employees.filter((e) => e.status === 'none').length,
  }), [employees]);

  function updateAccountLocal(id: number, patch: Partial<Account>) {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function userModuleIds(a: Account): string[] {
    return parseModuleAccess(a.module_access) ?? defaultModuleIds(a.role);
  }

  // ---- account access mutations (reuse /api/admin/users/[id]) ----
  async function patchAccount(id: number, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Update rejected'); }
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save that change');
      return false;
    }
  }

  async function changeRole(a: Account, role: string) {
    if (await patchAccount(a.id, { role })) updateAccountLocal(a.id, { role });
  }

  async function toggleCompany(a: Account, companyId: number) {
    const current = parseCompanyIds(a.allowed_company_ids);
    const updated = current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId];
    if (await patchAccount(a.id, { allowed_company_ids: updated })) {
      updateAccountLocal(a.id, { allowed_company_ids: JSON.stringify(updated) });
    }
  }

  async function assignAllCompanies(a: Account) {
    const allIds = companies.map((c) => c.id);
    if (await patchAccount(a.id, { allowed_company_ids: allIds })) {
      updateAccountLocal(a.id, { allowed_company_ids: JSON.stringify(allIds) });
    }
  }

  async function toggleModule(a: Account, moduleId: string) {
    const current = userModuleIds(a);
    const updated = current.includes(moduleId) ? current.filter((m) => m !== moduleId) : [...current, moduleId];
    if (await patchAccount(a.id, { module_access: updated })) {
      updateAccountLocal(a.id, { module_access: JSON.stringify(updated) });
    }
  }

  async function resetModules(a: Account) {
    if (await patchAccount(a.id, { module_access: null })) updateAccountLocal(a.id, { module_access: null });
  }


  async function toggleActive(a: Account) {
    if (await patchAccount(a.id, { active: !a.active })) updateAccountLocal(a.id, { active: a.active ? 0 : 1 });
  }

  async function resetPassword(a: Account) {
    const pw = window.prompt(`New password for ${a.name}:`);
    if (!pw) return;
    if (await patchAccount(a.id, { new_password: pw })) flash('Password updated.');
  }

  async function deleteAccount(a: Account) {
    const ok = window.confirm(
      `Permanently delete ${a.name}'s account (${a.email})?\n\nThis frees their email to be used again and cannot be undone. Their Odoo employee record is not affected.`,
    );
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${a.id}`, { method: 'DELETE' });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Delete failed'); }
      flash(`Deleted ${a.name}'s account — email freed.`);
      fetchAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  // ---- invite (reuse /api/admin/staff-access) ----
  async function invite(emp: Employee, action: 'invite' | 'resend') {
    if (!emp.department) {
      const ok = window.confirm(
        `${emp.name} has no restaurant (department) set in Odoo, so their invite email will just say "Krawings" instead of the restaurant name.\n\nSet their Department in Odoo first for correct branding, or send anyway?`,
      );
      if (!ok) return;
    }
    setActionLoading(emp.employee_id);
    setError(null);
    try {
      const res = await fetch('/api/admin/staff-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employee_id: emp.employee_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      if (data.share_text) setLinks((prev) => ({ ...prev, [emp.employee_id]: data.share_text }));
      if (data.email_status === 'sent') {
        // Real "it left the mail server" proof: the SMTP server's response.
        const resp = data.email_server?.response ? ` (${data.email_server.response})` : '';
        flash(`✓ ${data.message} Mail server accepted it${resp}.`);
      } else if (data.email_status === 'failed') {
        setError(`Mail server did not accept it: ${data.email_error || 'unknown error'}. Copy the link below and share it manually.`);
      } else {
        // no_address / skipped — invite still created, share the link by hand.
        flash(data.message || 'Invite link created — copy it below to share.');
      }
      fetchAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function copyLink(employeeId: number) {
    const text = links[employeeId];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(employeeId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError('Could not copy. Long-press the message to copy it manually.');
    }
  }

  // ---- pending sign-ups (reuse /api/admin/registrations) ----
  async function decide(userId: number, action: 'approve' | 'reject', role?: string) {
    setActionLoading(userId);
    setError(null);
    try {
      const res = await fetch('/api/admin/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, action, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      flash(data.message || 'Done.');
      fetchAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = employees.filter((e) => {
    if (tab !== 'all' && e.status !== tab) return false;
    if (!q) return true;
    return e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.department.toLowerCase().includes(q);
  });

  return (
    <div className="px-4 pb-24">
      {success && (
        <div className="mt-3 mb-1 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-[13px] font-semibold">
          {success}
        </div>
      )}
      {error && (
        <div className="mt-3 mb-1 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 font-semibold">Dismiss</button>
        </div>
      )}

      {/* Pending sign-ups */}
      {pending.length > 0 && (
        <div className="pt-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-600 mb-2">
            Pending sign-ups ({pending.length})
          </div>
          <div className="flex flex-col gap-3 mb-4">
            {pending.map((u) => {
              const isLoading = actionLoading === u.id;
              const selectedRole = pendingRoles[u.id] || 'staff';
              return (
                <div key={u.id} className="bg-white border border-amber-200 rounded-2xl overflow-hidden">
                  <div className="p-4">
                    <div className="text-[15px] font-bold text-gray-900">{u.name}</div>
                    <div className="text-[12px] text-gray-500 font-mono mt-0.5">{u.email}</div>
                    <div className="text-[11px] text-gray-400 font-mono mt-1">{timeAgo(u.created_at)}</div>
                  </div>
                  <div className="flex gap-2 border-t border-amber-100 p-3">
                    <select value={selectedRole}
                      onChange={(e) => setPendingRoles((prev) => ({ ...prev, [u.id]: e.target.value }))}
                      className="flex-1 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[13px] text-gray-900 outline-none">
                      <option value="staff">Staff</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={() => decide(u.id, 'approve', selectedRole)} disabled={isLoading}
                      className="flex-1 py-2.5 rounded-xl bg-green-500 text-white text-[13px] font-bold active:bg-green-600 disabled:opacity-50">
                      {isLoading ? '...' : 'Approve'}
                    </button>
                    <button onClick={() => decide(u.id, 'reject')} disabled={isLoading}
                      className="py-2.5 px-4 rounded-xl border border-red-200 text-red-600 text-[13px] font-bold active:bg-red-50 disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="pt-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search staff by name, email, department..."
          className="w-full h-11 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500"
        />
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 py-3 overflow-x-auto">
        {([
          ['all', `All (${counts.total})`],
          ['none', `No account (${counts.none})`],
          ['invited', `Invited (${counts.invited})`],
          ['active', `Active (${counts.active})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
              tab === key ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-[15px] font-semibold text-gray-900 mb-1">No staff here</div>
          <div className="text-[13px] text-gray-500">Try a different filter or search.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((emp) => {
            const account = accountByEmp.get(emp.employee_id);
            const meta = STATUS_META[emp.status];
            const isLoading = actionLoading === emp.employee_id;
            const hasLink = !!links[emp.employee_id];
            const userCompanies = account ? parseCompanyIds(account.allowed_company_ids) : [];
            const isAdmin = account?.role === 'admin';
            const companiesOpen = account ? expandedCompanies === account.id : false;
            const modulesOpen = account ? expandedModules === account.id : false;

            return (
              <div key={emp.employee_id}
                className={`bg-white border border-gray-200 rounded-2xl overflow-hidden ${account && !account.active ? 'opacity-50' : ''}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[15px] font-bold text-gray-900 truncate">{emp.name}</div>
                      <div className="text-[12px] text-gray-500 font-mono mt-0.5 truncate">{emp.email || emp.phone || 'No email or phone'}</div>
                      {emp.department ? (
                        <div className="text-[11px] text-gray-500 mt-0.5 truncate">{emp.department}</div>
                      ) : (
                        <div className="text-[11px] text-amber-600 font-semibold mt-0.5 truncate">No restaurant set in Odoo</div>
                      )}
                    </div>
                    <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-semibold whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                  </div>

                  {/* No account yet -> invite */}
                  {emp.status !== 'active' && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => invite(emp, emp.status === 'invited' ? 'resend' : 'invite')}
                        disabled={isLoading}
                        className="flex-1 h-10 rounded-xl bg-green-500 text-white text-[13px] font-bold active:bg-green-600 disabled:opacity-50 flex items-center justify-center"
                      >
                        {isLoading ? '...' : emp.status === 'invited' ? 'Resend invite' : 'Invite'}
                      </button>
                      {hasLink && (
                        <button onClick={() => copyLink(emp.employee_id)}
                          className="h-10 px-4 rounded-xl border border-gray-200 text-gray-600 text-[13px] font-semibold active:bg-gray-50">
                          {copiedId === emp.employee_id ? 'Copied!' : 'Copy link'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Has account -> access controls */}
                  {account && (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5 mt-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${roleColors[account.role] || 'bg-gray-100 text-gray-500'}`}>
                          {account.role}
                        </span>
                        {isAdmin ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold">All companies (admin)</span>
                        ) : userCompanies.length === 0 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-red-50 text-red-600 font-semibold">No companies assigned</span>
                        ) : (
                          companies.filter((c) => userCompanies.includes(c.id)).map((c) => (
                            <span key={c.id} className="text-[10px] px-2 py-0.5 rounded-md bg-green-50 text-green-700 font-semibold">
                              {c.warehouse_code || c.name}
                            </span>
                          ))
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-3 text-[12px]">
                        <select value={account.role} onChange={(e) => changeRole(account, e.target.value)}
                          className="px-2 py-1 rounded-lg border border-gray-200 text-gray-700 bg-white text-[12px]">
                          <option value="staff">Staff</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button onClick={() => setExpandedCompanies(companiesOpen ? null : account.id)}
                          className={`px-3 py-1 rounded-lg border text-[12px] font-semibold ${companiesOpen ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-600 active:bg-gray-50'}`}>
                          Companies
                        </button>
                        <button onClick={() => setExpandedModules(modulesOpen ? null : account.id)}
                          className={`px-3 py-1 rounded-lg border text-[12px] font-semibold ${modulesOpen ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-600 active:bg-gray-50'}`}>
                          Modules
                        </button>
                        <button onClick={() => resetPassword(account)}
                          className="px-3 py-1 rounded-lg border border-gray-200 text-gray-600 active:bg-gray-50 text-[12px]">
                          Reset pw
                        </button>
                        <button onClick={() => toggleActive(account)}
                          className={`px-3 py-1 rounded-lg border text-[12px] ${account.active ? 'border-red-200 text-red-600 active:bg-red-50' : 'border-green-200 text-green-600 active:bg-green-50'}`}>
                          {account.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button onClick={() => deleteAccount(account)}
                          className="px-3 py-1 rounded-lg border border-red-300 text-red-700 active:bg-red-50 text-[12px] font-semibold">
                          Delete
                        </button>
                      </div>

                      {account.last_login && (
                        <div className="text-[11px] text-gray-400 mt-2">
                          Last login: {new Date(account.last_login).toLocaleString('de-DE')}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Expanded company access */}
                {account && companiesOpen && !isAdmin && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Company access</span>
                      <button onClick={() => assignAllCompanies(account)} className="text-[11px] font-semibold text-green-700 active:opacity-70">
                        Select all
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {companies.map((c) => {
                        const checked = userCompanies.includes(c.id);
                        return (
                          <button key={c.id} onClick={() => toggleCompany(account, c.id)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                              checked ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 active:bg-gray-50'
                            }`}>
                            <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                              checked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'
                            }`}>
                              {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-gray-900">{c.name}</div>
                            </div>
                            {c.warehouse_code && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono flex-shrink-0">{c.warehouse_code}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {account && companiesOpen && isAdmin && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-blue-50">
                    <div className="text-[12px] text-blue-700">Admins automatically have access to all companies. No assignment needed.</div>
                  </div>
                )}

                {/* Expanded module access */}
                {account && modulesOpen && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        App modules {account.module_access ? '· custom' : '· role default'}
                      </span>
                      {account.module_access && (
                        <button onClick={() => resetModules(account)} className="text-[11px] font-semibold text-gray-500 active:opacity-70">
                          Reset to role default
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {PORTAL_MODULES.map((m) => {
                        const checked = userModuleIds(account).includes(m.id);
                        return (
                          <button key={m.id} onClick={() => toggleModule(account, m.id)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                              checked ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 active:bg-gray-50'
                            }`}>
                            <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                              checked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'
                            }`}>
                              {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-gray-900">{m.label}</div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono flex-shrink-0">{m.minRole}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Other / non-person logins */}
      {otherAccounts.length > 0 && (
        <div className="mt-6">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">
            Other logins ({otherAccounts.length})
          </div>
          <div className="text-[12px] text-gray-500 mb-2">
            Accounts not linked to an employee — e.g. shared devices like the kitchen tablet.
          </div>
          <div className="flex flex-col gap-2">
            {otherAccounts.map((a) => (
              <div key={a.id} className={`bg-white border border-gray-200 rounded-2xl p-4 ${!a.active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-gray-900 truncate">{a.name}</div>
                    <div className="text-[12px] text-gray-500 font-mono mt-0.5 truncate">{a.email}</div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${roleColors[a.role] || 'bg-gray-100 text-gray-500'}`}>{a.role}</span>
                </div>
                <div className="flex items-center gap-2 mt-3 text-[12px]">
                  <select value={a.role} onChange={(e) => changeRole(a, e.target.value)}
                    className="px-2 py-1 rounded-lg border border-gray-200 text-gray-700 bg-white text-[12px]">
                    <option value="staff">Staff</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button onClick={() => toggleActive(a)}
                    className={`px-3 py-1 rounded-lg border text-[12px] ${a.active ? 'border-red-200 text-red-600 active:bg-red-50' : 'border-green-200 text-green-600 active:bg-green-50'}`}>
                    {a.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  <button onClick={() => deleteAccount(a)}
                    className="px-3 py-1 rounded-lg border border-red-300 text-red-700 active:bg-red-50 text-[12px] font-semibold">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
