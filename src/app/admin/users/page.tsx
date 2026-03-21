'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  employee_id: number | null;
  active: number;
  allowed_company_ids: string;
  created_at: string;
  last_login: string | null;
}

interface Company {
  id: number;
  name: string;
  warehouse_code: string | null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [rejectedUsers, setRejectedUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'active' | 'rejected'>('pending');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('staff');

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [usersRes, pendingRes, rejectedRes, companiesRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/registrations?status=pending'),
        fetch('/api/admin/registrations?status=rejected'),
        fetch('/api/companies'),
      ]);
      if (usersRes.status === 403) {
        setError('You need admin access to manage users.');
        setLoading(false);
        return;
      }
      const usersData = await usersRes.json();
      const pendingData = await pendingRes.json();
      const rejectedData = await rejectedRes.json();
      const companiesData = await companiesRes.json();
      setUsers(usersData.users || []);
      setPendingUsers(pendingData.users || []);
      setRejectedUsers(rejectedData.users || []);
      setCompanies(companiesData.companies || []);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  function parseCompanyIds(raw: string | null | undefined): number[] {
    if (!raw) return [];
    try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
    catch { return []; }
  }

  async function toggleCompany(user: User, companyId: number) {
    const current = parseCompanyIds(user.allowed_company_ids);
    const updated = current.includes(companyId)
      ? current.filter(id => id !== companyId)
      : [...current, companyId];
    try {
      await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_company_ids: updated }),
      });
      setUsers(prev => prev.map(u =>
        u.id === user.id ? { ...u, allowed_company_ids: JSON.stringify(updated) } : u
      ));
    } catch { /* ignore */ }
  }

  async function assignAllCompanies(user: User) {
    const allIds = companies.map(c => c.id);
    try {
      await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_company_ids: allIds }),
      });
      setUsers(prev => prev.map(u =>
        u.id === user.id ? { ...u, allowed_company_ids: JSON.stringify(allIds) } : u
      ));
    } catch { /* ignore */ }
  }

  async function handleApprove(userId: number, role: string) {
    if (!role) { setError('Please select a role before approving.'); return; }
    setActionLoading(userId);
    setError(null);
    try {
      const res = await fetch('/api/admin/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, action: 'approve', role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccessMsg(data.message);
      setTimeout(() => setSuccessMsg(null), 3000);
      fetchAll();
    } catch (err: any) {
      setError(err.message || 'Approval failed');
    } finally { setActionLoading(null); }
  }

  async function handleReject(userId: number) {
    setActionLoading(userId);
    setError(null);
    try {
      const res = await fetch('/api/admin/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, action: 'reject' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchAll();
    } catch (err: any) {
      setError(err.message || 'Rejection failed');
    } finally { setActionLoading(null); }
  }

  async function handleClearRejection(userId: number) {
    setActionLoading(userId);
    try {
      const res = await fetch('/api/admin/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, action: 'clear_rejection' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccessMsg(data.message);
      setTimeout(() => setSuccessMsg(null), 3000);
      fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to clear rejection');
    } finally { setActionLoading(null); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, email: newEmail, password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowCreate(false);
      setNewName(''); setNewEmail(''); setNewPassword(''); setNewRole('staff');
      fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    } finally { setCreating(false); }
  }

  async function toggleActive(user: User) {
    try {
      await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !user.active }),
      });
      fetchAll();
    } catch { /* ignore */ }
  }

  async function handleResetPassword(user: User) {
    const pw = prompt(`New password for ${user.name}:`);
    if (!pw) return;
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: pw }),
      });
      if (res.ok) alert('Password updated.');
    } catch { /* ignore */ }
  }

  async function handleChangeRole(user: User, role: string) {
    try {
      await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      fetchAll();
    } catch { /* ignore */ }
  }

  const roleColors: Record<string, string> = {
    admin: 'bg-red-50 text-red-700',
    manager: 'bg-green-50 text-green-800',
    staff: 'bg-gray-100 text-gray-600',
  };

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

  const [pendingRoles, setPendingRoles] = useState<Record<number, string>>({});

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={() => router.push('/')}
            className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Manage staff</h1>
            <p className="text-[12px] text-white/50 mt-0.5">
              {pendingUsers.length > 0 ? `${pendingUsers.length} pending approval` : `${users.length} accounts`}
            </p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="w-9 h-9 rounded-xl bg-green-600 flex items-center justify-center active:bg-green-700 shadow-lg shadow-green-600/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 px-4 py-3">
        <button onClick={() => setTab('pending')}
          className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
            tab === 'pending' ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          Pending {pendingUsers.length > 0 && <span className="ml-1 text-[11px] font-mono">{pendingUsers.length}</span>}
        </button>
        <button onClick={() => setTab('active')}
          className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
            tab === 'active' ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          Active {users.length > 0 && <span className="ml-1 text-[11px] font-mono">{users.length}</span>}
        </button>
        <button onClick={() => setTab('rejected')}
          className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
            tab === 'rejected' ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          Rejected {rejectedUsers.length > 0 && <span className="ml-1 text-[11px] font-mono">{rejectedUsers.length}</span>}
        </button>
      </div>

      {successMsg && (
        <div className="mx-4 mb-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-[13px] font-semibold">
          {successMsg}
        </div>
      )}

      {error && (
        <div className="mx-4 mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 font-semibold">Dismiss</button>
        </div>
      )}

      <div className="px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* PENDING TAB */}
            {tab === 'pending' && (
              pendingUsers.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3">
                    <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>
                  <div className="text-[15px] font-semibold text-gray-900 mb-1">No pending registrations</div>
                  <div className="text-[13px] text-gray-500">All caught up!</div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {pendingUsers.map((u) => {
                    const isLoading = actionLoading === u.id;
                    const selectedRole = pendingRoles[u.id] || 'staff';
                    return (
                      <div key={u.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                        <div className="p-4">
                          <div className="flex items-start justify-between mb-1">
                            <div>
                              <div className="text-[15px] font-bold text-gray-900">{u.name}</div>
                              <div className="text-[12px] text-gray-500 font-mono mt-0.5">{u.email}</div>
                            </div>
                            <span className="text-[11px] px-2.5 py-0.5 rounded-md font-semibold bg-amber-50 text-amber-700">Pending</span>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            {u.employee_id && (
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold">
                                Employee #{u.employee_id}
                              </span>
                            )}
                            <span className="text-[11px] text-gray-400 font-mono">{timeAgo(u.created_at)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 border-t border-gray-100 p-3">
                          <select value={selectedRole}
                            onChange={(e) => setPendingRoles((prev) => ({ ...prev, [u.id]: e.target.value }))}
                            className="flex-1 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[13px] text-gray-900 outline-none">
                            <option value="staff">Staff</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button onClick={() => handleApprove(u.id, selectedRole)} disabled={isLoading}
                            className="flex-1 py-2.5 rounded-xl bg-green-500 text-white text-[13px] font-bold active:bg-green-600 disabled:opacity-50">
                            {isLoading ? '...' : 'Approve'}
                          </button>
                          <button onClick={() => handleReject(u.id)} disabled={isLoading}
                            className="py-2.5 px-4 rounded-xl border border-red-200 text-red-600 text-[13px] font-bold active:bg-red-50 disabled:opacity-50">
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* ACTIVE TAB */}
            {tab === 'active' && (
              <div className="flex flex-col gap-2">
                {users.map((u) => {
                  const userCompanies = parseCompanyIds(u.allowed_company_ids);
                  const isExpanded = expandedUser === u.id;
                  const isAdmin = u.role === 'admin';
                  return (
                    <div key={u.id}
                      className={`bg-white border border-gray-200 rounded-xl overflow-hidden ${!u.active ? 'opacity-50' : ''}`}>
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-[15px] font-semibold text-gray-900">{u.name}</div>
                            <div className="text-[12px] text-gray-500 mt-0.5">{u.email}</div>
                          </div>
                          <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${roleColors[u.role] || 'bg-gray-100 text-gray-500'}`}>
                            {u.role}
                          </span>
                        </div>

                        {/* Company access badges */}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {isAdmin ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold">All companies (admin)</span>
                          ) : userCompanies.length === 0 ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-red-50 text-red-600 font-semibold">No companies assigned</span>
                          ) : (
                            companies.filter(c => userCompanies.includes(c.id)).map(c => (
                              <span key={c.id} className="text-[10px] px-2 py-0.5 rounded-md bg-green-50 text-green-700 font-semibold">
                                {c.warehouse_code || c.name}
                              </span>
                            ))
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-3 text-[12px]">
                          <select value={u.role} onChange={(e) => handleChangeRole(u, e.target.value)}
                            className="px-2 py-1 rounded-lg border border-gray-200 text-gray-700 bg-white text-[12px]">
                            <option value="staff">Staff</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                            className={`px-3 py-1 rounded-lg border text-[12px] font-semibold ${isExpanded ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-600 active:bg-gray-50'}`}>
                            Companies
                          </button>
                          <button onClick={() => handleResetPassword(u)}
                            className="px-3 py-1 rounded-lg border border-gray-200 text-gray-600 active:bg-gray-50 text-[12px]">
                            Reset pw
                          </button>
                          <button onClick={() => toggleActive(u)}
                            className={`px-3 py-1 rounded-lg border text-[12px] ${u.active ? 'border-red-200 text-red-600 active:bg-red-50' : 'border-green-200 text-green-600 active:bg-green-50'}`}>
                            {u.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </div>

                        {u.last_login && (
                          <div className="text-[11px] text-gray-400 mt-2">
                            Last login: {new Date(u.last_login).toLocaleString('de-DE')}
                          </div>
                        )}
                      </div>

                      {/* Expanded company assignment */}
                      {isExpanded && !isAdmin && (
                        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Company access</span>
                            <button onClick={() => assignAllCompanies(u)}
                              className="text-[11px] font-semibold text-green-700 active:opacity-70">
                              Select all
                            </button>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {companies.map(c => {
                              const checked = userCompanies.includes(c.id);
                              return (
                                <button key={c.id} onClick={() => toggleCompany(u, c.id)}
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
                      {isExpanded && isAdmin && (
                        <div className="border-t border-gray-100 px-4 py-3 bg-blue-50">
                          <div className="text-[12px] text-blue-700">Admins automatically have access to all companies. No assignment needed.</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* REJECTED TAB */}
            {tab === 'rejected' && (
              rejectedUsers.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-[13px] text-gray-400">No rejected registrations</div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {rejectedUsers.map((u) => {
                    const isLoading = actionLoading === u.id;
                    return (
                      <div key={u.id} className="bg-white border border-gray-200 rounded-xl p-4">
                        <div className="flex items-start justify-between mb-1">
                          <div>
                            <div className="text-[15px] font-semibold text-gray-900">{u.name}</div>
                            <div className="text-[12px] text-gray-500 font-mono mt-0.5">{u.email}</div>
                          </div>
                          <span className="text-[11px] px-2.5 py-0.5 rounded-md font-semibold bg-red-50 text-red-700">Rejected</span>
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono mt-1">{timeAgo(u.created_at)}</div>
                        <button onClick={() => handleClearRejection(u.id)} disabled={isLoading}
                          className="mt-3 w-full py-2.5 rounded-xl border border-gray-200 text-gray-600 text-[13px] font-semibold active:bg-gray-50 disabled:opacity-50">
                          {isLoading ? '...' : 'Clear rejection (allow re-register)'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* Create user sheet */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowCreate(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-24"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'slideUp .25s ease-out' }}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <h3 className="text-lg font-bold text-gray-900 mb-4">New staff account</h3>
            <div className="flex flex-col gap-3">
              <input type="text" placeholder="Full name" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500" />
              <input type="email" placeholder="Email address" value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500" />
              <input type="text" placeholder="Initial password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500" />
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 focus:outline-none focus:border-green-500">
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              <button onClick={handleCreate}
                disabled={creating || !newName || !newEmail || !newPassword}
                className="h-14 rounded-xl bg-green-600 text-white font-bold text-[15px] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-all disabled:opacity-50 mt-1 flex items-center justify-center gap-2">
                {creating ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  'Create account'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
