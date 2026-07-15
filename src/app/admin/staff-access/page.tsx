'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface StaffRow {
  employee_id: number;
  name: string;
  email: string;
  phone: string;
  department: string;
  status: 'active' | 'invited' | 'none';
  invited_at: string | null;
}

interface Counts { total: number; active: number; invited: number; none: number; }

type Tab = 'all' | 'none' | 'invited' | 'active';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: 'Has account', cls: 'bg-green-50 text-green-700' },
  invited: { label: 'Invited', cls: 'bg-amber-50 text-amber-700' },
  none: { label: 'No account', cls: 'bg-gray-100 text-gray-600' },
};

export default function StaffAccessPage() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, active: 0, invited: 0, none: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [successTone, setSuccessTone] = useState<'success' | 'warning'>('success');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('none');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [links, setLinks] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showInviteAll, setShowInviteAll] = useState(false);
  const [invitingAll, setInvitingAll] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/staff-access');
      if (res.status === 403) { setError('You need admin access to manage staff access.'); setLoading(false); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setRows(data.employees || []);
      setCounts(data.counts || { total: 0, active: 0, invited: 0, none: 0 });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load staff.');
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(row: StaffRow, action: 'invite' | 'resend') {
    if (!row.department) {
      const ok = window.confirm(
        `${row.name} has no restaurant (department) set in Odoo, so their invite email will just say “Krawings” instead of the restaurant name.\n\nSet their Department in Odoo first for correct branding, or send anyway?`,
      );
      if (!ok) return;
    }
    const employeeId = row.employee_id;
    setActionLoading(employeeId);
    setError(null);
    try {
      const res = await fetch('/api/admin/staff-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employee_id: employeeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      if (data.share_text) setLinks((prev) => ({ ...prev, [employeeId]: data.share_text }));
      // Green only when the email actually went out; otherwise an amber warning
      // that stays put until dismissed, so the admin knows to share the link.
      const tone = data.email_status === 'sent' ? 'success' : 'warning';
      setSuccessTone(tone);
      setSuccessMsg(data.message);
      if (tone === 'success') setTimeout(() => setSuccessMsg(null), 4000);
      fetchAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleInviteAll() {
    setInvitingAll(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/staff-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite_all' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to invite all');
      const tone = data.no_email ? 'warning' : 'success';
      setSuccessTone(tone);
      setSuccessMsg(data.message);
      if (tone === 'success') setTimeout(() => setSuccessMsg(null), 5000);
      setShowInviteAll(false);
      fetchAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite all');
    } finally {
      setInvitingAll(false);
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

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (tab !== 'all' && r.status !== tab) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.department.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        supertitle="ADMIN"
        title="Staff access"
        subtitle={`${counts.active} active · ${counts.invited} invited · ${counts.none} not set up`}
        action={
          <button
            onClick={() => setShowInviteAll(true)}
            disabled={counts.none === 0}
            className="h-11 px-4 rounded-xl bg-green-600 text-white text-[13px] font-bold flex items-center justify-center active:bg-green-700 shadow-lg shadow-green-600/30 disabled:opacity-50"
          >
            Invite all
          </button>
        }
      />

      <div className="px-4 pb-24">
        {successMsg && (
          <div className={`mt-3 mb-1 px-4 py-3 rounded-xl text-[13px] font-semibold border flex items-start justify-between gap-2 ${
            successTone === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-amber-50 border-amber-300 text-amber-800'
          }`}>
            <span>{successTone === 'warning' ? '⚠ ' : ''}{successMsg}</span>
            {successTone === 'warning' && (
              <button onClick={() => setSuccessMsg(null)} className="text-amber-700 font-bold shrink-0">Dismiss</button>
            )}
          </div>
        )}
        {error && (
          <div className="mt-3 mb-1 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-500 font-semibold">Dismiss</button>
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
            ['none', `Not set up (${counts.none})`],
            ['invited', `Invited (${counts.invited})`],
            ['active', `Active (${counts.active})`],
            ['all', `All (${counts.total})`],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
                tab === key ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
              }`}
            >
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
            {filtered.map((r) => {
              const meta = STATUS_META[r.status];
              const isLoading = actionLoading === r.employee_id;
              const hasLink = !!links[r.employee_id];
              return (
                <div key={r.employee_id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-1 gap-2">
                      <div className="min-w-0">
                        <div className="text-[15px] font-bold text-gray-900 truncate">{r.name}</div>
                        <div className="text-[12px] text-gray-500 font-mono mt-0.5 truncate">{r.email || r.phone || 'No email or phone'}</div>
                        {r.department ? (
                          <div className="text-[11px] text-gray-500 mt-0.5 truncate">{r.department}</div>
                        ) : (
                          <div className="text-[11px] text-amber-600 font-semibold mt-0.5 truncate">No restaurant set — email says “Krawings”</div>
                        )}
                      </div>
                      <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-semibold whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                    </div>
                  </div>
                  {r.status !== 'active' && (
                    <div className="flex gap-2 border-t border-gray-100 p-3">
                      <button
                        onClick={() => handleInvite(r, r.status === 'invited' ? 'resend' : 'invite')}
                        disabled={isLoading}
                        className="flex-1 h-10 rounded-xl bg-green-500 text-white text-[13px] font-bold active:bg-green-600 disabled:opacity-50 flex items-center justify-center"
                      >
                        {isLoading ? '...' : r.status === 'invited' ? 'Resend invite' : 'Invite'}
                      </button>
                      {hasLink && (
                        <button
                          onClick={() => copyLink(r.employee_id)}
                          className="h-10 px-4 rounded-xl border border-gray-200 text-gray-600 text-[13px] font-semibold active:bg-gray-50"
                        >
                          {copiedId === r.employee_id ? 'Copied!' : 'Copy link'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Invite-all confirm sheet */}
      {showInviteAll && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowInviteAll(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-24"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'slideUp .25s ease-out' }}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <h3 className="text-lg font-bold text-gray-900 mb-2">Invite everyone not set up</h3>
            <p className="text-[14px] text-gray-600 mb-5">
              This will send a portal invite to the <strong>{counts.none}</strong> staff who do not have an account or a pending invite yet. Staff with an email get it automatically; for the rest you can copy their link afterwards.
            </p>
            <button
              onClick={handleInviteAll}
              disabled={invitingAll || counts.none === 0}
              className="w-full h-14 rounded-xl bg-green-600 text-white font-bold text-[14px] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {invitingAll ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                `Invite ${counts.none} staff`
              )}
            </button>
          </div>
        </div>
      )}

      <style jsx>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
