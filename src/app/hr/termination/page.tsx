'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import TermDashboard from '@/components/termination/TermDashboard';
import TermList from '@/components/termination/TermList';
import TermDetail from '@/components/termination/TermDetail';
import NewTermWizard from '@/components/termination/NewTermWizard';

/**
 * Termination module — Admin only.
 * Screen state machine, same pattern as manufacturing/page.tsx.
 */
type Screen =
  | { type: 'dashboard' }
  | { type: 'list'; filter?: string }
  | { type: 'detail'; id: number }
  | { type: 'new' };

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
    if (tile === 'new') {
      navigate({ type: 'new' });
    } else if (tile === 'drafts') {
      navigate({ type: 'list', filter: 'draft' });
    } else if (tile === 'confirmed') {
      navigate({ type: 'list', filter: 'confirmed' });
    } else if (tile === 'archive') {
      navigate({ type: 'list', filter: 'archived' });
    } else if (tile.startsWith('detail:')) {
      const id = Number(tile.split(':')[1]);
      if (id) navigate({ type: 'detail', id });
    }
  }

  const Header = ({ title, subtitle }: { title: string; subtitle?: string }) => {
    const HomeIcon = () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    );
    return (
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
        <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors">
            <HomeIcon />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-white truncate">{title}</h1>
            {subtitle && <p className="text-[12px] text-white/45 mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </div>
    );
  };

  function renderScreen() {
    switch (screen.type) {
      case 'dashboard':
        return (
          <>
            <Header title="Kuendigungen" subtitle="Personalverwaltung" />
            <TermDashboard onNavigate={handleDashboardNav} />
          </>
        );
      case 'list':
        return (
          <TermList
            initialFilter={screen.filter}
            onSelect={id => navigate({ type: 'detail', id })}
            onHome={goDashboard}
          />
        );
      case 'detail':
        return (
          <TermDetail
            termId={screen.id}
            onBack={goBack}
          />
        );
      case 'new':
        return (
          <NewTermWizard
            onBack={goDashboard}
            onCreated={(id) => {
              setHistory([{ type: 'dashboard' }]);
              setScreen({ type: 'detail', id });
            }}
          />
        );
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#F6F7F9]">
      {renderScreen()}
    </div>
  );
}
