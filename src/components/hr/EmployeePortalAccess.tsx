'use client';

import React, { useEffect, useState } from 'react';
import { PORTAL_MODULES, defaultModuleIds, parseModuleAccess } from '@/lib/modules';

/**
 * "Portal access" panel embedded in the HR employee screen (EmployeeDetail).
 * One place to: send the onboarding link, resend it, cancel a link, and — once
 * the person has an account — change their access (role, restaurants, modules,
 * PIN, active). Backed by /api/hr/employee/[id]/access (manager+, own-restaurant
 * scoped; role edits are admin-only).
 */

interface Account {
  id: number;
  name: string;
  email: string;
  role: string;
  active: number;
  allowed_company_ids: number[];
  module_access: string | null;
  has_pin: number;
  last_login: string | null;
}

interface AccessData {
  status: 'none' | 'invited' | 'active';
  account: Account | null;
  invite: { expires_at: string; created_at: string; created_by: string | null } | null;
  viewer: { role: string; is_admin: boolean; own_user_id: number };
}

interface Company {
  id: number;
  name: string;
  warehouse_code: string | null;
}

const roleColors: Record<string, string> = {
  admin: 'bg-red-50 text-red-700',
  manager: 'bg-green-50 text-green-800',
  staff: 'bg-gray-100 text-gray-600',
};

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('de-DE'); } catch { return iso; }
}

export default function EmployeePortalAccess({ employeeId }: { employeeId: number }) {
  const [data, setData] = useState<AccessData | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCompanies, setShowCompanies] = useState(false);
  const [showModules, setShowModules] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employeeId]);

  async function load() {
    setLoading(true);
    try {
      const [accRes, coRes] = await Promise.all([
        fetch(`/api/hr/employee/${employeeId}/access`),
        fetch('/api/companies'),
      ]);
      if (accRes.status === 403) { setError('You can only manage staff in your own restaurant.'); setLoading(false); return; }
      const accData = await accRes.json();
      if (!accRes.ok) throw new Error(accData.error || 'Failed to load access');
      setData(accData);
      const coData = await coRes.json().catch(() => ({}));
      setCompanies(coData.companies || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load access');
    } finally {
      setLoading(false);
    }
  }

  function flash(msg: string) { setSuccess(msg); setTimeout(() => setSuccess(null), 4000); }

  async function linkAction(action: 'invite' | 'resend' | 'revoke') {
    if (action === 'revoke' && !window.confirm('Cancel this invite link? The current link will stop working. You can send a new one afterwards.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/employee/${employeeId}/access`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Action failed');
      if (d.link) setLink(d.link); else setLink(null);
      flash(d.message || 'Done.');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally { setBusy(false); }
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    if (saving) return false;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/employee/${employeeId}/access`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Update rejected');
      if (d.account) setData((prev) => (prev ? { ...prev, account: d.account } : prev));
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save that change');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Could not copy — long-press the link to copy it.'); }
  }

  const account = data?.account || null;
  const isAdmin = data?.viewer.is_admin === true;
  const moduleIds = account ? (parseModuleAccess(account.module_access) ?? defaultModuleIds(account.role)) : [];

  async function toggleCompany(companyId: number) {
    if (!account) return;
    const cur = account.allowed_company_ids;
    const next = cur.includes(companyId) ? cur.filter((c) => c !== companyId) : [...cur, companyId];
    await patch({ allowed_company_ids: next });
  }
  async function toggleModule(moduleId: string) {
    if (!account) return;
    const next = moduleIds.includes(moduleId) ? moduleIds.filter((m) => m !== moduleId) : [...moduleIds, moduleId];
    await patch({ module_access: next });
  }
  async function setPin() {
    if (!account) return;
    const pin = window.prompt(`Set a 4-digit PIN for ${account.name} (leave empty to remove):`, '');
    if (pin === null) return;
    const trimmed = pin.trim();
    if (trimmed && !/^\d{4}$/.test(trimmed)) { setError('PIN must be exactly 4 digits'); return; }
    await patch({ pin: trimmed || null });
  }
  async function resetPassword() {
    if (!account) return;
    const pw = window.prompt(`New password for ${account.name}:`);
    if (!pw) return;
    if (await patch({ new_password: pw })) flash('Password updated.');
  }

  return (
    <div className="mx-5 mb-3">
      <div className="bg-white rounded-2xl p-4 border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[var(--fs-sm)] font-bold text-gray-400 uppercase tracking-wider">Portal access</div>
          {data && (() => {
            const off = data.status === 'active' && !!data.account && !data.account.active;
            const cls = off ? 'bg-gray-100 text-gray-500' : data.status === 'active' ? 'bg-green-50 text-green-700' : data.status === 'invited' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600';
            const label = off ? 'Login disabled' : data.status === 'active' ? 'Has login' : data.status === 'invited' ? 'Invite sent' : 'No login';
            return <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-semibold ${cls}`}>{label}</span>;
          })()}
        </div>

        {success && <div className="mb-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-[12px] font-semibold">{success}</div>}
        {error && (
          <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[12px]">
            {error} <button onClick={() => setError(null)} className="ml-1 font-semibold text-red-500">Dismiss</button>
          </div>
        )}

        {/* Copyable link surfaced right after invite/resend */}
        {link && (
          <div className="mb-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
            <div className="text-[11px] font-semibold text-gray-500 mb-1">Invite link</div>
            <div className="text-[12px] font-mono text-gray-800 break-all">{link}</div>
            <button onClick={copyLink} className="mt-2 h-9 px-4 rounded-lg bg-green-600 text-white text-[12px] font-bold active:bg-green-700">
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" /></div>
        ) : !data ? null : data.status === 'none' ? (
          <>
            <p className="text-[13px] text-gray-500 mb-3">No portal login yet. Send an onboarding link so they can set a password and sign in.</p>
            <button onClick={() => linkAction('invite')} disabled={busy}
              className="w-full h-11 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700 disabled:opacity-50">
              {busy ? '...' : 'Send invite link'}
            </button>
          </>
        ) : data.status === 'invited' ? (
          <>
            <p className="text-[13px] text-gray-500 mb-3">
              Invite sent{data.invite ? ` — expires ${fmtDate(data.invite.expires_at)}` : ''}. Resend to generate a fresh link, or cancel it to stop the current one.
            </p>
            <div className="flex gap-2">
              <button onClick={() => linkAction('resend')} disabled={busy}
                className="flex-1 h-11 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700 disabled:opacity-50">
                {busy ? '...' : 'Resend link'}
              </button>
              <button onClick={() => linkAction('revoke')} disabled={busy}
                className="h-11 px-4 rounded-xl border border-red-200 text-red-600 text-[13px] font-bold active:bg-red-50 disabled:opacity-50">
                Cancel link
              </button>
            </div>
          </>
        ) : account ? (
          <>
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[13px] font-mono text-gray-600 truncate">{account.email}</div>
                {account.last_login && <div className="text-[11px] text-gray-400 mt-0.5">Last login: {new Date(account.last_login).toLocaleString('de-DE')}</div>}
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${roleColors[account.role] || 'bg-gray-100 text-gray-500'}`}>{account.role}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3 text-[12px]">
              {isAdmin ? (
                <select value={account.role} onChange={(e) => patch({ role: e.target.value })}
                  className="px-2 py-1 rounded-lg border border-gray-200 text-gray-700 bg-white text-[12px]">
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <span className="text-[11px] text-gray-400">Role set by an admin</span>
              )}
              <button onClick={() => setShowCompanies((v) => !v)}
                className={`px-3 py-1 rounded-lg border text-[12px] font-semibold ${showCompanies ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-600 active:bg-gray-50'}`}>
                Restaurants
              </button>
              <button onClick={() => setShowModules((v) => !v)}
                className={`px-3 py-1 rounded-lg border text-[12px] font-semibold ${showModules ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-600 active:bg-gray-50'}`}>
                Modules
              </button>
              <button onClick={setPin}
                className={`px-3 py-1 rounded-lg border text-[12px] font-semibold ${account.has_pin ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-600 active:bg-gray-50'}`}>
                {account.has_pin ? 'PIN ✓' : 'Set PIN'}
              </button>
              <button onClick={resetPassword}
                className="px-3 py-1 rounded-lg border border-gray-200 text-gray-600 active:bg-gray-50 text-[12px]">
                Reset pw
              </button>
              <button onClick={() => patch({ active: !account.active })}
                className={`px-3 py-1 rounded-lg border text-[12px] ${account.active ? 'border-red-200 text-red-600 active:bg-red-50' : 'border-green-200 text-green-600 active:bg-green-50'}`}>
                {account.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>

            {showCompanies && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Restaurant access</div>
                {account.role === 'admin' ? (
                  <div className="text-[12px] text-blue-700 bg-blue-50 rounded-lg px-3 py-2">Admins have access to all restaurants.</div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {companies.map((c) => {
                      const checked = account.allowed_company_ids.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => toggleCompany(c.id)} disabled={saving}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors disabled:opacity-60 ${checked ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 active:bg-gray-50'}`}>
                          <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center ${checked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'}`}>
                            {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                          </div>
                          <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-gray-900">{c.name}</div></div>
                          {c.warehouse_code && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{c.warehouse_code}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {showModules && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">App modules {account.module_access ? '· custom' : '· role default'}</span>
                  {account.module_access && (
                    <button onClick={() => patch({ module_access: null })} className="text-[11px] font-semibold text-gray-500 active:opacity-70">Reset to default</button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {PORTAL_MODULES.map((m) => {
                    const checked = moduleIds.includes(m.id);
                    return (
                      <button key={m.id} onClick={() => toggleModule(m.id)} disabled={saving}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors disabled:opacity-60 ${checked ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 active:bg-gray-50'}`}>
                        <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center ${checked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'}`}>
                          {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                        </div>
                        <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-gray-900">{m.label}</div></div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{m.minRole}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
