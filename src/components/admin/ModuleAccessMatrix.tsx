'use client';

import { useEffect, useState } from 'react';

type Role = 'staff' | 'manager' | 'admin';
const ROLES: Role[] = ['staff', 'manager', 'admin'];
const ROLE_LABEL: Record<Role, string> = { staff: 'Staff', manager: 'Manager', admin: 'Admin' };

interface ModuleRow {
  id: string;
  label: string;
  minRole: Role;
  roles: string[];
  customised: boolean;
}

/**
 * "Which apps each role gets" — the visibility half of /admin/permissions.
 *
 * Deliberately looks and behaves like PermissionsMatrix below it (same cells,
 * same locked Admin column, same Reset), because to an admin they are two
 * halves of one idea: can you OPEN it, and what can you DO inside it.
 */
export default function ModuleAccessMatrix() {
  const [rows, setRows] = useState<ModuleRow[] | null>(null);
  const [customCount, setCustomCount] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/role-modules');
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not load module access'); return; }
      setRows(data.modules || []);
      setCustomCount(data.usersWithCustomModules || 0);
    } catch {
      setError('Could not load module access');
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(row: ModuleRow, role: Role) {
    if (role === 'admin') return;             // admins always keep access
    setSaving(row.id);
    setError(null);
    const next = row.roles.includes(role)
      ? row.roles.filter((r) => r !== role)
      : [...row.roles, role];
    try {
      const res = await fetch('/api/admin/role-modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_id: row.id, allowed_roles: next }),
      });
      if (!res.ok) setError((await res.json()).error || 'Could not save');
      await load();
    } catch {
      setError('Could not save');
    } finally {
      setSaving(null);
    }
  }

  async function reset(moduleId: string) {
    setSaving(moduleId);
    try {
      await fetch('/api/admin/role-modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: moduleId }),
      });
      await load();
    } finally {
      setSaving(null);
    }
  }

  if (!rows) {
    return <div className="px-4 py-6 text-[13px] text-gray-400">Loading apps…</div>;
  }

  return (
    <div className="mb-8 rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="text-[12px] font-bold uppercase tracking-wide text-gray-500">
          Which apps each role gets
        </span>
      </div>

      <div className="px-4 pt-3">
        <p className="text-[13px] text-gray-500">
          Tick an app to give that role the tile, the menu entry and the app itself.
          Unticking hides it completely — the page refuses to open, not just the tile.
          Admins always keep access.
        </p>
        {customCount > 0 && (
          <p className="mt-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {customCount} {customCount === 1 ? 'person has' : 'people have'} their own app list set on
            Manage Staff. That personal list wins over the rule below, so they may keep an app you
            untick here.
          </p>
        )}
        {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-y-1 px-4 py-3">
        <div />
        <div className="flex gap-2 pb-1">
          {ROLES.map((r) => (
            <span key={r} className="w-16 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400">
              {ROLE_LABEL[r]}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.id} className="contents">
            <div className="flex items-center text-[13px] text-gray-800 min-w-0 pr-3">
              <span className="truncate">{row.label}</span>
              {row.customised && (
                <button
                  onClick={() => reset(row.id)}
                  className="ml-2 shrink-0 text-[11px] font-semibold text-gray-500 active:opacity-70"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="flex gap-2 items-center">
              {ROLES.map((r) => {
                const on = row.roles.includes(r);
                const disabled = r === 'admin' || saving === row.id;
                return (
                  <button
                    key={r}
                    onClick={() => toggle(row, r)}
                    disabled={disabled}
                    aria-label={`${row.label} — ${ROLE_LABEL[r]} ${on ? 'on' : 'off'}`}
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
        ))}
      </div>
    </div>
  );
}
