'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { SupplierGroup, SupplierLoginRow, CredentialFormData } from '@/types/credentials';

/* ------------------------------------------------------------------ */
/*  Supplier Login Card                                               */
/* ------------------------------------------------------------------ */
function LoginRow({
  login,
  isAdmin,
  onEdit,
  onDelete,
}: {
  login: SupplierLoginRow;
  isAdmin: boolean;
  onEdit: (login: SupplierLoginRow) => void;
  onDelete: (login: SupplierLoginRow) => void;
}) {
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    if (showPw) {
      const t = setTimeout(() => setShowPw(false), 5000);
      return () => clearTimeout(t);
    }
  }, [showPw]);

  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-[#F5F6F8] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold text-[#9CA3AF] tracking-wider uppercase">
          {login.company_name}
        </div>
        <div className="text-[15px] font-medium text-[#1A1A1A] mt-0.5">{login.username}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[14px] text-[#6B7280] font-mono select-all">
            {showPw ? login.password : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
          </span>
          <button
            onClick={() => setShowPw(!showPw)}
            className="p-1 text-[#9CA3AF] hover:text-[#F5800A] transition-colors"
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
          <button
            onClick={() => { navigator.clipboard.writeText(login.password); }}
            className="p-1 text-[#9CA3AF] hover:text-[#F5800A] transition-colors"
            aria-label="Copy password"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
          </button>
        </div>
        {login.website_url && (
          <a
            href={login.website_url as string}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-[#F5800A] font-medium mt-1 inline-block"
          >
            {login.website_url}
          </a>
        )}
        {login.notes && (
          <div className="text-[12px] text-[#9CA3AF] mt-1">{login.notes}</div>
        )}
      </div>
      {isAdmin && (
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <button
            onClick={() => onEdit(login)}
            className="p-2 text-[#9CA3AF] hover:text-[#F5800A] transition-colors"
            aria-label="Edit"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button
            onClick={() => onDelete(login)}
            className="p-2 text-[#9CA3AF] hover:text-[#EF4444] transition-colors"
            aria-label="Delete"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Supplier Card                                                     */
/* ------------------------------------------------------------------ */
function SupplierCard({
  supplier,
  isAdmin,
  onEdit,
  onDelete,
}: {
  supplier: SupplierGroup;
  isAdmin: boolean;
  onEdit: (login: SupplierLoginRow) => void;
  onDelete: (login: SupplierLoginRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-[#E8E8E8] shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 active:bg-[#F5F6F8] transition-colors"
      >
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[16px] font-semibold text-[#1A1A1A]">{supplier.name}</div>
          {supplier.website && (
            <div className="text-[12px] text-[#6B7280] truncate">{supplier.website}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-[12px] font-semibold text-[#F5800A] bg-[#FFF4E6] px-2.5 py-0.5 rounded-full">
            {supplier.logins.length}
          </span>
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-[#E8E8E8]">
          {supplier.logins.map((login) => (
            <LoginRow
              key={login.id}
              login={login}
              isAdmin={isAdmin}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                         */
/* ------------------------------------------------------------------ */
export default function CredentialsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<SupplierGroup[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingLogin, setEditingLogin] = useState<SupplierLoginRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SupplierLoginRow | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formPartnerId, setFormPartnerId] = useState<number | null>(null);
  const [formPartnerSearch, setFormPartnerSearch] = useState('');
  const [formCompanyId, setFormCompanyId] = useState<number | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Lookups for the form
  const [allSuppliers, setAllSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(null), 3000); return () => clearTimeout(t); }
  }, [success]);

  useEffect(() => {
    if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t); }
  }, [error]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [credRes, meRes] = await Promise.all([
        fetch('/api/admin/credentials'),
        fetch('/api/auth/me'),
      ]);

      if (credRes.status === 401) {
        router.push('/login');
        return;
      }

      const credData = await credRes.json();
      const meData = await meRes.json();

      setSuppliers(credData.suppliers || []);
      setIsAdmin(meData.user?.role === 'admin');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch supplier list + companies when modal opens for create
  async function fetchFormLookups() {
    try {
      const [suppRes, compRes] = await Promise.all([
        fetch('/api/purchase/suppliers'),
        fetch('/api/companies'),
      ]);
      const suppData = await suppRes.json();
      const compData = await compRes.json();
      setAllSuppliers(
        (suppData.suppliers || suppData || []).map((s: any) => ({
          id: s.id || s.odoo_partner_id,
          name: s.name,
        })),
      );
      setCompanies(
        (compData.companies || compData || []).map((c: any) => ({ id: c.id, name: c.name })),
      );
    } catch {
      setError('Failed to load form data');
    }
  }

  function openCreateModal() {
    setEditingLogin(null);
    setFormPartnerId(null);
    setFormPartnerSearch('');
    setFormCompanyId(null);
    setFormUsername('');
    setFormPassword('');
    setFormUrl('');
    setFormNotes('');
    setShowModal(true);
    fetchFormLookups();
  }

  function openEditModal(login: SupplierLoginRow) {
    // Find the supplier this login belongs to
    const supplier = suppliers.find((s) => s.logins.some((l) => l.id === login.id));
    setEditingLogin(login);
    setFormPartnerId(supplier?.id || null);
    setFormPartnerSearch(supplier?.name || '');
    setFormCompanyId(login.company_id);
    setFormUsername(login.username);
    setFormPassword(login.password);
    setFormUrl((login.website_url as string) || '');
    setFormNotes((login.notes as string) || '');
    setShowModal(true);
    fetchFormLookups();
  }

  async function handleSave() {
    if (!formPartnerId || !formCompanyId || !formUsername || !formPassword) {
      setError('Supplier, company, username, and password are required');
      return;
    }
    setSaving(true);
    try {
      const body: CredentialFormData = {
        partner_id: formPartnerId,
        company_id: formCompanyId,
        username: formUsername,
        password: formPassword,
        ...(formUrl ? { website_url: formUrl } : {}),
        ...(formNotes ? { notes: formNotes } : {}),
      };

      if (editingLogin) {
        const res = await fetch(`/api/admin/credentials/${editingLogin.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update');
        }
        setSuccess('Credential updated');
      } else {
        const res = await fetch('/api/admin/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create');
        }
        setSuccess('Credential added');
      }
      setShowModal(false);
      fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Save failed';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/credentials/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      setSuccess('Credential removed');
      setDeleteTarget(null);
      fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredFormSuppliers = allSuppliers.filter((s) =>
    s.name.toLowerCase().includes(formPartnerSearch.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-[#F5F6F8]">
      {/* Header */}
      <div className="bg-white border-b border-[#E8E8E8] px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => router.back()} className="p-2 -ml-2 text-[#6B7280]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="text-[20px] font-bold text-[#1A1A1A] tracking-tight">Supplier Logins</h1>
      </div>

      {/* Toasts */}
      {success && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-xl bg-[#DCFCE7] text-[#166534] text-[14px] font-medium">
          {success}
        </div>
      )}
      {error && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-xl bg-[#FEE2E2] text-[#991B1B] text-[14px] font-medium">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search suppliers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-[44px] pl-10 pr-4 rounded-xl bg-white border border-[#E8E8E8] text-[15px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#F5800A] focus:ring-2 focus:ring-[#F5800A]/15"
          />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-24 space-y-3">
        {loading ? (
          <div className="text-center py-12 text-[#9CA3AF] text-[15px]">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-[#9CA3AF] text-[15px]">
              {search ? 'No suppliers match your search' : 'No supplier logins saved yet'}
            </div>
          </div>
        ) : (
          filtered.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              isAdmin={isAdmin}
              onEdit={openEditModal}
              onDelete={setDeleteTarget}
            />
          ))
        )}
      </div>

      {/* FAB — Admin only */}
      {isAdmin && (
        <button
          onClick={openCreateModal}
          className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-[#F5800A] text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform z-20"
          aria-label="Add credential"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8 animate-slide-up max-h-[85vh] overflow-y-auto mb-[calc(4rem+env(safe-area-inset-bottom))]">
            <h2 className="text-[18px] font-bold text-[#1A1A1A] mb-4">
              {editingLogin ? 'Edit Credential' : 'Add Credential'}
            </h2>

            {/* Supplier picker */}
            <label className="block mb-3">
              <span className="text-[11px] font-bold text-[#9CA3AF] tracking-wider uppercase">Supplier</span>
              <input
                type="text"
                placeholder="Search supplier..."
                value={formPartnerSearch}
                onChange={(e) => { setFormPartnerSearch(e.target.value); setFormPartnerId(null); }}
                className="w-full h-[48px] mt-1 px-4 rounded-lg bg-[#F5F6F8] border border-[#E8E8E8] text-[15px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#F5800A] focus:ring-2 focus:ring-[#F5800A]/15 focus:bg-white"
              />
              {formPartnerSearch && !formPartnerId && filteredFormSuppliers.length > 0 && (
                <div className="mt-1 bg-white border border-[#E8E8E8] rounded-lg max-h-[160px] overflow-y-auto shadow-lg">
                  {filteredFormSuppliers.slice(0, 20).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setFormPartnerId(s.id); setFormPartnerSearch(s.name); }}
                      className="w-full text-left px-4 py-2.5 text-[14px] text-[#1A1A1A] hover:bg-[#FFF4E6] active:bg-[#FFF4E6] transition-colors"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </label>

            {/* Company */}
            <label className="block mb-3">
              <span className="text-[11px] font-bold text-[#9CA3AF] tracking-wider uppercase">Company</span>
              <select
                value={formCompanyId || ''}
                onChange={(e) => setFormCompanyId(parseInt(e.target.value, 10) || null)}
                className="w-full h-[48px] mt-1 px-4 rounded-lg bg-[#F5F6F8] border border-[#E8E8E8] text-[15px] text-[#1A1A1A] focus:outline-none focus:border-[#F5800A] focus:ring-2 focus:ring-[#F5800A]/15 focus:bg-white"
              >
                <option value="">Select company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            {/* Username */}
            <label className="block mb-3">
              <span className="text-[11px] font-bold text-[#9CA3AF] tracking-wider uppercase">Username</span>
              <input
                type="text"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="Username or email"
                className="w-full h-[48px] mt-1 px-4 rounded-lg bg-[#F5F6F8] border border-[#E8E8E8] text-[15px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#F5800A] focus:ring-2 focus:ring-[#F5800A]/15 focus:bg-white"
              />
            </label>

            {/* Password */}
            <label className="block mb-3">
              <span className="text-[11px] font-bold text-[#9CA3AF] tracking-wider uppercase">Password</span>
              <input
                type="text"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder="Password"
                className="w-full h-[48px] mt-1 px-4 rounded-lg bg-[#F5F6F8] border border-[#E8E8E8] text-[15px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#F5800A] focus:ring-2 focus:ring-[#F5800A]/15 focus:bg-white"
              />
            </label>

            {/* Login URL */}
            <label className="block mb-3">
              <span className="text-[11px] font-bold text-[#9CA3AF] tracking-wider uppercase">Login URL (optional)</span>
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://shop.supplier.de/login"
                className="w-full h-[48px] mt-1 px-4 rounded-lg bg-[#F5F6F8] border border-[#E8E8E8] text-[15px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#F5800A] focus:ring-2 focus:ring-[#F5800A]/15 focus:bg-white"
              />
            </label>

            {/* Notes */}
            <label className="block mb-4">
              <span className="text-[11px] font-bold text-[#9CA3AF] tracking-wider uppercase">Notes (optional)</span>
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Min order, account number, etc."
                rows={2}
                className="w-full mt-1 px-4 py-3 rounded-lg bg-[#F5F6F8] border border-[#E8E8E8] text-[15px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#F5800A] focus:ring-2 focus:ring-[#F5800A]/15 focus:bg-white resize-none"
              />
            </label>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 h-[44px] rounded-full border border-[#E8E8E8] text-[#6B7280] font-semibold text-[15px] active:scale-[0.97] transition-transform"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 h-[44px] rounded-full bg-[#F5800A] text-white font-semibold text-[15px] shadow-[0_1px_3px_rgba(245,128,10,0.30)] active:scale-[0.97] transition-transform disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingLogin ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white rounded-2xl p-5 mx-6 max-w-sm w-full">
            <h3 className="text-[16px] font-bold text-[#1A1A1A] mb-2">Remove Login</h3>
            <p className="text-[14px] text-[#6B7280] mb-5">
              Remove the login for <span className="font-semibold text-[#1A1A1A]">{deleteTarget.company_name}</span>?
              This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 h-[44px] rounded-full border border-[#E8E8E8] text-[#6B7280] font-semibold text-[15px] active:scale-[0.97] transition-transform"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="flex-1 h-[44px] rounded-full bg-[#EF4444] text-white font-semibold text-[15px] active:scale-[0.97] transition-transform disabled:opacity-50"
              >
                {saving ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
