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
  created_at: string;
  last_login: string | null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [rejectedUsers, setRejectedUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'active' | 'rejected'>('pending');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('staff');

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [usersRes, pendingRes, rejectedRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/registrations?status=pending'),
        fetch('/api/admin/registrations?status=rejected'),
      ]);
      if (usersRes.status === 403) {
        setError('You need admin access to manage users.');
        setLoading(false);
        return;
      }
      const usersData = await usersRes.json();
      const pendingData = await pendingRes.json();
      const rejectedData = await rejectedRes.json();
      setUsers(usersData.users || []);
      setPendingUsers(pendingData.users || []);
      setRejectedUsers(rejectedData.users || []);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(userId: number, role: string) {
    if (!role) {
      setError('Please select a role before approving.');
      return;
    }
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
    } finally {
      setActionLoading(null);
    }
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
    } finally {
      setActionLoading(null);
    }
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
    } finally {
      setActionLoading(null);
    }
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
    } finally {
      setCreating(false);
    }
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
    manager: 'bg-orange-50 text-orange-700',
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

  // Track selected roles for pending users
  const [pendingRoles, setPendingRoles] = useState<Record<number, string>>({});

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
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
            className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center active:bg-orange-600 shadow-lg shadow-orange-500/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>

      {/* Tab pills */}
      <div className="flex gap-1.5 px-4 py-3">
        <button onClick={() => setTab('pending')}
          className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
            tab === 'pending' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          Pending {pendingUsers.length > 0 && <span className="ml-1 text-[11px] font-mono">{pendingUsers.length}</span>}
        </button>
        <button onClick={() => setTab('active')}
          className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
            tab === 'active' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          Active {users.length > 0 && <span className="ml-1 text-[11px] font-mono">{users.length}</span>}
        </button>
        <button onClick={() => setTab('rejected')}
          className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
            tab === 'rejected' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          Rejected {rejectedUsers.length > 0 && <span className="ml-1 text-[11px] font-mono">{rejectedUsers.length}</span>}
        </button>
      </div>

      {/* Success message */}
      {successMsg && (
        <div className="mx-4 mb-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-[13px] font-semibold">
          {successMsg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 font-semibold">Dismiss</button>
        </div>
      )}

      <div className="px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ===== PENDING TAB ===== */}
            {tab === 'pending' && (
              pendingUsers.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                    <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>
                  <div className="text-[15px] font-semibold text-gray-900 mb-1">No pending registrations</div>
                  <div className="text-[13px] text-gray-500">All caught up! New staff will appear here when they register.</div>
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
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-semibold">
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
                            className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-[13px] font-bold active:bg-emerald-600 disabled:opacity-50">
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

            {/* ===== ACTIVE TAB ===== */}
            {tab === 'active' && (
              <div className="flex flex-col gap-2">
                {users.map((u) => (
                  <div key={u.id}
                    className={`bg-white border border-gray-200 rounded-xl p-4 ${!u.active ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-[15px] font-semibold text-gray-900">{u.name}</div>
                        <div className="text-[12px] text-gray-500 mt-0.5">{u.email}</div>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${roleColors[u.role] || 'bg-gray-100 text-gray-500'}`}>
                        {u.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-[12px]">
                      <select value={u.role} onChange={(e) => handleChangeRole(u, e.target.value)}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-gray-700 bg-white text-[12px]">
                        <option value="staff">Staff</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button onClick={() => handleResetPassword(u)}
                        className="px-3 py-1 rounded-lg border border-gray-200 text-gray-600 active:bg-gray-50 text-[12px]">
                        Reset pw
                      </button>
                      <button onClick={() => toggleActive(u)}
                        className={`px-3 py-1 rounded-lg border text-[12px] ${u.active ? 'border-red-200 text-red-600 active:bg-red-50' : 'border-emerald-200 text-emerald-600 active:bg-emerald-50'}`}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                    {u.last_login && (
                      <div className="text-[11px] text-gray-400 mt-2">
                        Last login: {new Date(u.last_login).toLocaleString('de-DE')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ===== REJECTED TAB ===== */}
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
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-8"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'slideUp .25s ease-out' }}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <h3 className="text-lg font-bold text-gray-900 mb-4">New staff account</h3>
            <div className="flex flex-col gap-3">
              <input type="text" placeholder="Full name" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400" />
              <input type="email" placeholder="Email address" value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400" />
              <input type="text" placeholder="Initial password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400" />
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 focus:outline-none focus:border-orange-400">
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              <button onClick={handleCreate}
                disabled={creating || !newName || !newEmail || !newPassword}
                className="h-14 rounded-xl bg-orange-500 text-white font-bold text-[15px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-all disabled:opacity-50 mt-1 flex items-center justify-center gap-2">
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
