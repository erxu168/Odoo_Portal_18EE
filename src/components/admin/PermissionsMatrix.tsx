'use client';
import { useEffect, useMemo, useState } from 'react';
import { PERMISSIONS_MANAGE_KEY } from '@/lib/permissions';

type Role = 'staff' | 'manager' | 'admin';
interface Action { key: string; module: string; label: string; group?: string; defaultRoles: Role[] }
const ROLES: Role[] = ['staff', 'manager', 'admin'];
const ROLE_LABEL: Record<Role, string> = { staff: 'Staff', manager: 'Manager', admin: 'Admin' };
const MODULE_LABEL: Record<string, string> = { shifts: 'Shifts', manufacturing: 'Manufacturing', purchase: 'Purchase' };

export default function PermissionsMatrix() {
  const [actions, setActions] = useState<Action[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Role[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/permissions')
      .then((r) => r.json())
      .then((d) => { setActions(d.actions || []); setOverrides(d.overrides || {}); })
      .catch(() => setError('Could not load permissions'));
  }, []);

  const byModule = useMemo(() => {
    const m: Record<string, Action[]> = {};
    for (const a of actions) (m[a.module] ??= []).push(a);
    return m;
  }, [actions]);

  function effectiveRoles(a: Action): Role[] {
    if (a.key === PERMISSIONS_MANAGE_KEY) return ['admin'];
    return overrides[a.key] ?? a.defaultRoles;
  }

  async function toggle(a: Action, role: Role) {
    if (a.key === PERMISSIONS_MANAGE_KEY) return;      // locked
    if (role === 'admin') return;                       // admin always on
    const current = effectiveRoles(a);
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    setSaving(a.key);
    setError('');
    try {
      const res = await fetch('/api/admin/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_key: a.key, allowed_roles: next }),
      });
      if (!res.ok) throw new Error('rejected');
      const d = await res.json();
      setOverrides(d.overrides || {});
    } catch {
      setError('Could not save that change');
    } finally {
      setSaving(null);
    }
  }

  async function resetModule(moduleId: string) {
    const res = await fetch('/api/admin/permissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: 'module', module: moduleId }),
    });
    if (res.ok) setOverrides((await res.json()).overrides || {});
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-[20px] font-extrabold text-gray-900 mb-1">Permissions</h1>
      <p className="text-[13px] text-gray-500 mb-4">
        Choose which role can do each action. Changes take effect the next time that person opens the page. Admins always keep access.
      </p>
      {error && <div className="mb-3 text-[13px] text-red-600">{error}</div>}

      {Object.entries(byModule).map(([moduleId, list]) => (
        <div key={moduleId} className="mb-6 rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <span className="text-[12px] font-bold uppercase tracking-wide text-gray-500">{MODULE_LABEL[moduleId] ?? moduleId}</span>
            <button onClick={() => resetModule(moduleId)} className="text-[11px] font-semibold text-gray-500 active:opacity-70">
              Reset to defaults
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-y-1 px-4 py-3">
            <div />
            <div className="flex gap-2 pb-1">
              {ROLES.map((r) => (
                <span key={r} className="w-16 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400">{ROLE_LABEL[r]}</span>
              ))}
            </div>
            {list.map((a) => {
              const roles = effectiveRoles(a);
              const locked = a.key === PERMISSIONS_MANAGE_KEY;
              return (
                <div key={a.key} className="contents">
                  <div className="flex items-center text-[13px] text-gray-800 min-w-0 pr-3">
                    <span className="truncate">{a.label}{locked && <span className="ml-1 text-[10px] text-gray-400">(admin only)</span>}</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    {ROLES.map((r) => {
                      const on = roles.includes(r);
                      const disabled = locked || r === 'admin' || saving === a.key;
                      return (
                        <button
                          key={r}
                          onClick={() => toggle(a, r)}
                          disabled={disabled}
                          aria-label={`${a.label} — ${ROLE_LABEL[r]} ${on ? 'on' : 'off'}`}
                          className={`w-16 h-9 rounded-xl border flex items-center justify-center transition-colors ${
                            on ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'
                          } ${disabled ? 'opacity-50' : 'active:bg-gray-50'}`}
                        >
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                            on ? 'bg-green-600 border-green-600' : 'border-gray-300'
                          }`}>
                            {on && <span className="text-white text-[12px] leading-none">✓</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
