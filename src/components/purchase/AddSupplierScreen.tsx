'use client';

import React from 'react';

interface OdooPartnerResult {
  odoo_id: number;
  name: string;
  email: string;
  phone: string;
  already_added: boolean;
}

interface AddSupplierScreenProps {
  mode: 'odoo' | 'new';
  onModeChange: (mode: 'odoo' | 'new') => void;
  errorMsg: string;

  // Pick-from-Odoo tab
  search: string;
  results: OdooPartnerResult[];
  searching: boolean;
  saving: boolean;
  onSearchChange: (q: string) => void;
  onLinkPartner: (p: OdooPartnerResult) => void;

  // Create-new tab
  newName: string;
  newEmail: string;
  newPhone: string;
  onNewNameChange: (v: string) => void;
  onNewEmailChange: (v: string) => void;
  onNewPhoneChange: (v: string) => void;
  onCreateNew: () => void;
}

export default function AddSupplierScreen({
  mode,
  onModeChange,
  errorMsg,
  search,
  results,
  searching,
  saving,
  onSearchChange,
  onLinkPartner,
  newName,
  newEmail,
  newPhone,
  onNewNameChange,
  onNewEmailChange,
  onNewPhoneChange,
  onCreateNew,
}: AddSupplierScreenProps) {
  return (
    <div className="px-4 py-3">
      <div className="flex gap-1.5 mb-3">
        <button
          onClick={() => onModeChange('odoo')}
          className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${mode === 'odoo' ? 'bg-[#2563EB] text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
        >
          Pick from Odoo
        </button>
        <button
          onClick={() => onModeChange('new')}
          className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${mode === 'new' ? 'bg-[#2563EB] text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
        >
          Create new
        </button>
      </div>

      {errorMsg && (
        <div className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5 mb-3">{errorMsg}</div>
      )}

      {mode === 'odoo' ? (
        <>
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-blue-500 transition-colors mb-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search Odoo suppliers..."
              autoFocus
              className="flex-1 bg-transparent outline-none text-[14px] text-gray-900 placeholder-gray-400"
            />
            {search && (
              <button onClick={() => onSearchChange('')} className="text-gray-400 text-[18px]" aria-label="Clear search">&times;</button>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mb-3">
            Searches Odoo partners where <span className="font-mono">supplier_rank &gt; 0</span>. Type at least 2 characters.
          </p>

          {searching && (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
              {results.map((p) => (
                <div key={p.odoo_id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-[12px] font-bold text-blue-600 flex-shrink-0">
                    {p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[11px] text-gray-500 truncate">{p.email || p.phone || `Odoo #${p.odoo_id}`}</div>
                  </div>
                  {p.already_added ? (
                    <span className="text-[11px] font-semibold text-gray-400 px-2.5 py-1 rounded-md bg-gray-50 border border-gray-100">Already added</span>
                  ) : (
                    <button
                      onClick={() => onLinkPartner(p)}
                      disabled={saving}
                      className="h-9 px-3 rounded-lg bg-[#2563EB] text-white text-[12px] font-bold active:bg-blue-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!searching && search.trim().length >= 2 && results.length === 0 && (
            <div className="text-[12px] text-gray-500 text-center py-6">
              No suppliers found in Odoo. Switch to <span className="font-semibold">Create new</span> to add one.
            </div>
          )}
        </>
      ) : (
        <>
          <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">
            Supplier name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={newName}
            onChange={(e) => onNewNameChange(e.target.value)}
            placeholder="e.g. Metro Cash & Carry"
            className="w-full mb-3 bg-white border border-gray-200 rounded-xl px-3.5 h-11 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500"
          />
          <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Email</label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => onNewEmailChange(e.target.value)}
            placeholder="orders@supplier.com"
            className="w-full mb-3 bg-white border border-gray-200 rounded-xl px-3.5 h-11 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500"
          />
          <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Phone</label>
          <input
            type="tel"
            value={newPhone}
            onChange={(e) => onNewPhoneChange(e.target.value)}
            placeholder="+49 30 ..."
            className="w-full mb-4 bg-white border border-gray-200 rounded-xl px-3.5 h-11 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500"
          />
          <p className="text-[11px] text-gray-400 mb-4">
            A matching <span className="font-mono">res.partner</span> will be created in Odoo with{' '}
            <span className="font-mono">supplier_rank = 1</span>, then linked here.
          </p>
          <button
            onClick={onCreateNew}
            disabled={saving || !newName.trim()}
            className="w-full py-3.5 rounded-xl bg-[#2563EB] text-white text-[14px] font-bold shadow-sm active:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating in Odoo...' : 'Create supplier'}
          </button>
        </>
      )}
    </div>
  );
}
