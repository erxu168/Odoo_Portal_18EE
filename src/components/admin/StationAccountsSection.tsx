'use client';

import React, { useEffect, useState } from 'react';
import { PORTAL_MODULES, defaultModuleIds, parseModuleAccess } from '@/lib/modules';

/**
 * Tablet sign-in accounts, on the Tablets & Devices screen.
 *
 * A department/kitchen tablet signs in with a shared "device" account
 * (portal_users.is_shared_device = 1). This section lets a manager name that
 * account and choose which app tiles the tablet shows (its module access) —
 * previously buried on the Staff/People screen. Reads GET /api/admin/users and
 * mutates via PATCH/DELETE /api/admin/users/[id] (admin only).
 *
 * Note: module access is a property of the ACCOUNT, so it applies to EVERY tablet
 * signed in with it — the copy below says so. Role is intentionally not editable
 * here (a device account is always staff-level; change it on /admin/users if ever
 * needed).
 */
interface DeviceAccount {
  id: number;
  name: string;
  email: string;
  role: string;
  active: number;
  module_access: string | null;
  is_shared_device?: number;
}

export default function StationAccountsSection() {
  const [accounts, setAccounts] = useState<DeviceAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 403) { setError('You need admin access to manage tablet accounts.'); setAccounts([]); return; }
      if (!res.ok) throw new Error('Could not load tablet accounts');
      const data = await res.json();
      setAccounts((data.users || []).filter((a: DeviceAccount) => a.is_shared_device));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
      setAccounts([]);
    }
  }

  function moduleIds(a: DeviceAccount): string[] {
    return parseModuleAccess(a.module_access) ?? defaultModuleIds(a.role);
  }
  function patchLocal(id: number, patch: Partial<DeviceAccount>) {
    setAccounts((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, ...patch } : a)) : prev));
  }
  async function patch(id: number, body: Record<string, unknown>): Promise<boolean> {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return res.ok;
    } catch { return false; } finally { setBusy(null); }
  }

  async function toggleModule(a: DeviceAccount, moduleId: string) {
    const cur = moduleIds(a);
    const next = cur.includes(moduleId) ? cur.filter((m) => m !== moduleId) : [...cur, moduleId];
    if (await patch(a.id, { module_access: next })) patchLocal(a.id, { module_access: JSON.stringify(next) });
  }
  async function resetModules(a: DeviceAccount) {
    if (await patch(a.id, { module_access: null })) patchLocal(a.id, { module_access: null });
  }
  async function saveName(a: DeviceAccount) {
    const nm = nameDraft.trim();
    if (nm && nm !== a.name && (await patch(a.id, { name: nm }))) patchLocal(a.id, { name: nm });
    setEditingName(null);
  }
  async function toggleActive(a: DeviceAccount) {
    const next = a.active ? 0 : 1;
    if (await patch(a.id, { active: next })) patchLocal(a.id, { active: next });
  }
  async function remove(a: DeviceAccount) {
    if (!confirm(`Delete the tablet account "${a.name}"? That tablet will be signed out and can no longer log in. This cannot be undone.`)) return;
    setBusy(a.id);
    try {
      const res = await fetch(`/api/admin/users/${a.id}`, { method: 'DELETE' });
      if (res.ok) setAccounts((prev) => (prev ? prev.filter((x) => x.id !== a.id) : prev));
    } finally { setBusy(null); }
  }

  return (
    <div className="mb-6">
      <h2 className="text-[15px] font-bold text-gray-900 mb-1">Tablet sign-in accounts</h2>
      <p className="text-[12px] text-gray-500 mb-3">
        The shared login each department tablet uses. Rename a tablet and choose which app tiles it shows.
        Tiles apply to every tablet signed in with the same account.
      </p>
      {error && <div className="mb-3 text-[13px] text-red-600">{error}</div>}

      {accounts === null ? (
        <div className="text-[13px] text-gray-400">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 text-[13px] text-gray-500">
          No tablet accounts yet. Provisioned tablets appear under “Shared tablets” below.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map((a) => {
            const open = expandedModules === a.id;
            return (
              <div key={a.id} className={`bg-white border border-gray-200 rounded-2xl overflow-hidden ${!a.active ? 'opacity-50' : ''}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {editingName === a.id ? (
                        <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={() => saveName(a)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveName(a); if (e.key === 'Escape') setEditingName(null); }}
                          className="w-full text-[15px] font-semibold border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-[#2563EB]" />
                      ) : (
                        <button onClick={() => { setEditingName(a.id); setNameDraft(a.name); }}
                          className="flex items-center gap-1.5 text-[15px] font-semibold text-gray-900 active:opacity-70 text-left max-w-full">
                          <span className="truncate">{a.name}</span>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 flex-shrink-0"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      )}
                      <div className="text-[12px] text-gray-500 font-mono mt-0.5 truncate">{a.email}</div>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold bg-gray-100 text-gray-500 flex-shrink-0">{a.role}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-3 text-[12px] flex-wrap">
                    <button onClick={() => setExpandedModules(open ? null : a.id)}
                      className={`px-3 py-1 rounded-lg border text-[12px] font-semibold ${open ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-600 active:bg-gray-50'}`}>
                      Modules
                    </button>
                    <button onClick={() => toggleActive(a)} disabled={busy === a.id}
                      className={`px-3 py-1 rounded-lg border text-[12px] disabled:opacity-50 ${a.active ? 'border-red-200 text-red-600 active:bg-red-50' : 'border-green-200 text-green-600 active:bg-green-50'}`}>
                      {a.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button onClick={() => remove(a)} disabled={busy === a.id}
                      className="px-3 py-1 rounded-lg border border-red-300 text-red-700 active:bg-red-50 text-[12px] font-semibold disabled:opacity-50">
                      Delete
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        App tiles this tablet shows {a.module_access ? '· custom' : '· role default'}
                      </span>
                      {a.module_access && (
                        <button onClick={() => resetModules(a)} className="text-[11px] font-semibold text-gray-500 active:opacity-70">
                          Reset to default
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {PORTAL_MODULES.map((m) => {
                        const checked = moduleIds(a).includes(m.id);
                        return (
                          <button key={m.id} onClick={() => toggleModule(a, m.id)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors ${checked ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 active:bg-gray-50'}`}>
                            <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${checked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'}`}>
                              {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                            </div>
                            <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-gray-900">{m.label}</div></div>
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
    </div>
  );
}
