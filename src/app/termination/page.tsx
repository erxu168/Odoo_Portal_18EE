'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import TermDashboard from '@/components/termination/TermDashboard';
import TermList from '@/components/termination/TermList';
import TermWizard from '@/components/termination/TermWizard';
import TermDetail from '@/components/termination/TermDetail';

type Screen =
  | { type: 'dashboard' }
  | { type: 'list'; mode: 'in_progress' | 'completed' }
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
      case 'in_progress':
        navigate({ type: 'list', mode: 'in_progress' });
        break;
      case 'completed':
        navigate({ type: 'list', mode: 'completed' });
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
            <AppHeader title="Terminations" subtitle="Employee termination management" />
            <TermDashboard onNavigate={handleDashboardNav} />
          </>
        );

      case 'list':
        return (
          <TermList
            mode={screen.mode}
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
