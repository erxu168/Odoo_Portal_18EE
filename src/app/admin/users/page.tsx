'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  active: number;
  created_at: string;
  last_login: string | null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('staff');

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 403) {
        setError('You need admin access to manage users.');
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
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
      fetchUsers();
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
      fetchUsers();
    } catch {}
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
    } catch {}
  }

  async function handleChangeRole(user: User, role: string) {
    try {
      await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      fetchUsers();
    } catch {}
  }

  const roleColors: Record<string, string> = {
    admin: 'bg-red-50 text-red-700',
    manager: 'bg-orange-50 text-orange-700',
    staff: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button
            onClick={() => router.push('/')}
            className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Manage Staff</h1>
            <p className="text-[12px] text-white/50 mt-0.5">{users.length} accounts</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center active:bg-orange-600 shadow-lg shadow-orange-500/30"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
          {error}
        </div>
      )}

      {/* User list */}
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {users.map((u) => (
              <div
                key={u.id}
                className={`bg-white border border-gray-200 rounded-xl p-4 ${!u.active ? 'opacity-50' : ''}`}
              >
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
                  <select
                    value={u.role}
                    onChange={(e) => handleChangeRole(u, e.target.value)}
                    className="px-2 py-1 rounded-lg border border-gray-200 text-gray-700 bg-white text-[12px]"
                  >
                    <option value="staff">Staff</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => handleResetPassword(u)}
                    className="px-3 py-1 rounded-lg border border-gray-200 text-gray-600 active:bg-gray-50 text-[12px]"
                  >
                    Reset password
                  </button>
                  <button
                    onClick={() => toggleActive(u)}
                    className={`px-3 py-1 rounded-lg border text-[12px] ${u.active ? 'border-red-200 text-red-600 active:bg-red-50' : 'border-emerald-200 text-emerald-600 active:bg-emerald-50'}`}
                  >
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
      </div>

      {/* Create user sheet */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowCreate(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-8"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'slideUp .25s ease-out' }}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <h3 className="text-lg font-bold text-gray-900 mb-4">New staff account</h3>

            <div className="flex flex-col gap-3">
              <input
                type="text" placeholder="Full name" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400"
              />
              <input
                type="email" placeholder="Email address" value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400"
              />
              <input
                type="text" placeholder="Initial password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400"
              />
              <select
                value={newRole} onChange={(e) => setNewRole(e.target.value)}
                className="h-12 px-4 rounded-xl bg-white border border-gray-200 text-[14px] text-gray-900 focus:outline-none focus:border-orange-400"
              >
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>

              <button
                onClick={handleCreate}
                disabled={creating || !newName || !newEmail || !newPassword}
                className="h-14 rounded-xl bg-orange-500 text-white font-bold text-[15px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-all disabled:opacity-50 mt-1 flex items-center justify-center gap-2"
              >
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
