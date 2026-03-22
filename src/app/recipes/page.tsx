'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RecipeDashboard from '@/components/recipes/RecipeDashboard';

type Screen =
  | { type: 'dashboard' }
  | { type: 'cooking-guide' }
  | { type: 'production-guide' }
  | { type: 'record' }
  | { type: 'edit' }
  | { type: 'approvals' }
  | { type: 'stats' };

export default function RecipesPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [userRole, setUserRole] = useState<string>('staff');

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d.user?.role) setUserRole(d.user.role);
    }).catch(() => {});
  }, []);

  function goHome() { router.push('/'); }
  function goDashboard() { setScreen({ type: 'dashboard' }); }

  // For now, all screens show the dashboard with a coming-soon banner
  // Sub-screens will be built as separate components
  if (screen.type !== 'dashboard') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
          <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(22,163,74,0.08)_0%,transparent_70%)]" />
          <div className="flex items-center gap-3 relative">
            <button onClick={goDashboard} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <div className="flex-1">
              <h1 className="text-[20px] font-bold text-white capitalize">{screen.type.replace('-', ' ')}</h1>
              <p className="text-[12px] text-white/50 mt-0.5">Recipe Guide</p>
            </div>
            <button onClick={goHome}
              className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="text-5xl mb-4">\ud83d\udee0\ufe0f</div>
            <h2 className="text-lg font-bold text-gray-800 mb-2 capitalize">{screen.type.replace('-', ' ')}</h2>
            <p className="text-sm text-gray-500 mb-6">This screen is connected to the backend and ready for UI development.</p>
            <button onClick={goDashboard} className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl active:bg-green-700">
              Back to Recipe Guide
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <RecipeDashboard
      userRole={userRole}
      onNavigate={(id) => setScreen({ type: id as Screen['type'] })}
      onHome={goHome}
    />
  );
}
