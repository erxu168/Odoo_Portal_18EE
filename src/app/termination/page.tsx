'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import TermDashboard from '@/components/termination/TermDashboard';
import TermList from '@/components/termination/TermList';
import TermWizard from '@/components/termination/TermWizard';
import TermDetail from '@/components/termination/TermDetail';
import type { TerminationState } from '@/types/termination';

type Screen =
  | { type: 'dashboard' }
  | { type: 'list'; filter?: TerminationState[] }
  | { type: 'wizard' }
  | { type: 'detail'; id: number };

export default function TerminationPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [history, setHistory] = useState<Screen[]>([]);

  function navigate(s: Screen) {
    setHistory(h => [...h, screen]);
    setScreen(s);
  }

  function goBack() {
    setHistory(h => {
      const prev = h[h.length - 1];
      if (prev) {
        setScreen(prev);
        return h.slice(0, -1);
      }
      setScreen({ type: 'dashboard' });
      return [];
    });
  }

  function goHome() {
    router.push('/');
  }

  function goDashboard() {
    setHistory([]);
    setScreen({ type: 'dashboard' });
  }

  function handleDashboardNav(tile: string) {
    switch (tile) {
      case 'new':
        navigate({ type: 'wizard' });
        break;
      case 'active':
        navigate({ type: 'list', filter: ['draft', 'confirmed'] });
        break;
      case 'signed':
        navigate({ type: 'list', filter: ['signed'] });
        break;
      case 'history':
        navigate({ type: 'list' });
        break;
    }
  }

  const HomeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );

  function renderScreen() {
    switch (screen.type) {
      case 'dashboard':
        return (
          <>
            <div className="bg-[#DC2626] px-5 pt-12 pb-3 rounded-b-[28px]">
              <div className="flex items-center gap-3">
                <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
                  <HomeIcon />
                </button>
                <div className="flex-1">
                  <h1 className="text-[20px] font-bold text-white">K{'\u00fc'}ndigungen</h1>
                  <p className="text-[12px] text-white/45 mt-0.5">Termination Management</p>
                </div>
              </div>
            </div>
            <TermDashboard onNavigate={handleDashboardNav} />
          </>
        );

      case 'list':
        return (
          <TermList
            filter={screen.filter}
            onSelect={id => navigate({ type: 'detail', id })}
            onHome={goDashboard}
          />
        );

      case 'wizard':
        return (
          <TermWizard
            onBack={goBack}
            onHome={goDashboard}
            onCreated={id => {
              setHistory([{ type: 'dashboard' }]);
              setScreen({ type: 'detail', id });
            }}
          />
        );

      case 'detail':
        return (
          <TermDetail
            id={screen.id}
            onBack={goBack}
            onHome={goDashboard}
          />
        );
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {renderScreen()}
    </div>
  );
}
