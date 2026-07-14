'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface VaultEntry {
  id: number;
  property_id: number;
  label: string;
  category: string;
  url: string | null;
  created_at: string;
}

function categoryIcon(cat: string): string {
  const map: Record<string, string> = {
    electricity: '\u26a1', gas: '\ud83d\udd25', water: '\ud83d\udca7',
    internet: '\ud83c\udf10', insurance: '\ud83d\udee1\ufe0f',
    hausverwaltung: '\ud83c\udfe2', bank: '\ud83c\udfe6', other: '\ud83d\udd11',
  };
  return map[cat] || '\ud83d\udd11';
}

export default function VaultList() {
  const router = useRouter();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<number, { username: string; password: string } | null>>({});

  useEffect(() => {
    fetch('/api/rentals/vault')
      .then(r => r.json())
      .then(data => setEntries(data.entries || []))
      .catch(err => console.error('[rentals] vault load failed:', err))
      .finally(() => setLoading(false));
  }, []);

  async function revealCredential(id: number) {
    if (revealed[id]) {
      // Toggle off
      setRevealed(prev => ({ ...prev, [id]: null }));
      return;
    }
    try {
      const res = await fetch(`/api/rentals/vault/${id}`);
      const data = await res.json();
      if (data.entry) {
        setRevealed(prev => ({ ...prev, [id]: { username: data.entry.username, password: data.entry.password } }));
      }
    } catch (err) {
      console.error('[rentals] vault reveal failed:', err);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Credential Vault"
        subtitle="Provider logins"
        showBack
        onBack={() => router.push('/rentals')}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="text-4xl mb-3">{'\ud83d\udd10'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">No credentials stored</div>
          <div className="text-[13px] text-gray-500 max-w-[220px] leading-relaxed">
            Add provider credentials from property detail pages
          </div>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-2">
          {entries.map(entry => {
            const cred = revealed[entry.id];
            return (
              <div key={entry.id} className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{categoryIcon(entry.category)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#1F2933]">{entry.label}</div>
                    <div className="text-[11px] text-gray-500 capitalize">{entry.category}</div>
                    {entry.url && <div className="text-[11px] text-blue-600 truncate">{entry.url}</div>}
                  </div>
                  <button
                    onClick={() => revealCredential(entry.id)}
                    className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200 transition-colors"
                    title={cred ? 'Hide' : 'Reveal'}
                  >
                    {cred ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                {cred && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-400">Username</span>
                      <span className="text-[12px] font-mono text-[#1F2933]">{cred.username}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-400">Password</span>
                      <span className="text-[12px] font-mono text-[#1F2933]">{cred.password}</span>
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
