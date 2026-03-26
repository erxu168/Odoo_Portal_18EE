'use client';

import React, { useState, useEffect } from 'react';

// FIX F5: Interface matches the ENRICHED versions API response (flat strings, not Odoo tuples)
interface Version {
  id: number;
  recipe_name: string;
  recipe_type: 'cooking_guide' | 'production_guide';
  product_tmpl_id: number | null;
  bom_id: number | null;
  version: number;
  status: string;
  change_summary: string;
  created_by: string;
  created_at: string;
  step_count: number;
}

interface Props {
  userRole: string;
  onReview: (version: Version) => void;
  onBack: () => void;
  onHome?: () => void;
}

export default function ApprovalList({ userRole, onReview, onBack, onHome }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/recipes/versions?status=review');
        if (res.ok) {
          const data = await res.json();
          setVersions(data.versions || []);
        }
      } catch (e) { console.error('Load error:', e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const filtered = versions.filter(v => {
    if (!search) return true;
    return v.recipe_name.toLowerCase().includes(search.toLowerCase());
  });

  const isManager = userRole === 'manager' || userRole === 'admin';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#2563EB] px-5 pt-14 pb-5 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Approvals</h1>
            <p className="text-[12px] text-zinc-400 mt-0.5">{filtered.length} pending</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-xl">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input type="text" placeholder="Search approvals..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-[14px] text-gray-900 placeholder-gray-400 outline-none bg-transparent" />
        </div>
      </div>
      <div className="px-5 pt-4 pb-8 flex-1">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">{'\u2713'}</div>
            <p className="text-[14px] text-gray-500 font-medium">No pending approvals</p>
            <p className="text-[12px] text-gray-400 mt-1">All recipe changes have been reviewed</p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {filtered.map(v => {
            const isProduct = v.recipe_type === 'cooking_guide';
            const submitter = v.created_by || 'Unknown';
            const initials = submitter.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
            return (
              <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[13px] font-bold flex-shrink-0">{initials}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900">{submitter}</div>
                    <div className="text-[11px] text-gray-500">{v.created_at ? v.created_at.substring(0, 16) : ''}</div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-800 uppercase">Pending</span>
                </div>
                <div className="mb-2">
                  <div className="text-[14px] font-bold text-gray-900">{v.recipe_name}
                    <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${isProduct ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                      {isProduct ? 'COOKING' : 'PROD'}
                    </span>
                  </div>
                  {v.change_summary && <div className="text-[12px] text-gray-600 mt-1">{v.change_summary}</div>}
                  <div className="text-[11px] text-gray-400 mt-1">{v.step_count} steps</div>
                </div>
                {isManager && (
                  <button onClick={() => onReview(v)}
                    className="w-full py-2.5 rounded-xl text-[13px] font-bold text-amber-700 bg-amber-50 border border-amber-200 active:bg-amber-100">
                    Review
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
