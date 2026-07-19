'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import TermDashboard from '@/components/termination/TermDashboard';
import TermList from '@/components/termination/TermList';
import TermWizard from '@/components/termination/TermWizard';
import TermDetail from '@/components/termination/TermDetail';
import StartChecklistPrompt from '@/components/hr/StartChecklistPrompt';

type Screen =
  | { type: 'dashboard' }
  | { type: 'list'; mode: 'in_progress' | 'completed' }
  | { type: 'wizard' }
  | { type: 'detail'; id: number };

export default function TerminationPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <TerminationInner />
    </Suspense>
  );
}

function TerminationInner() {
  const router = useRouter();
  // Deep-link from the employee page: /termination?employee=ID starts the
  // wizard with that person pre-selected.
  const preselectId = Number(useSearchParams().get('employee')) || null;
  const [screen, setScreen] = useState<Screen>(preselectId ? { type: 'wizard' } : { type: 'dashboard' });
  const [history, setHistory] = useState<Screen[]>([]);
  // After a termination is confirmed, offer the Leaving checklist for that person.
  const [leavingPrompt, setLeavingPrompt] = useState<{ employeeId: number; terminationId: number } | null>(null);

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
            preselectEmployeeId={preselectId ?? undefined}
            onBack={goBack}
            onHome={goDashboard}
            onCreated={(id, employeeId) => {
              setHistory([{ type: 'dashboard' }]);
              setScreen({ type: 'detail', id });
              if (employeeId) setLeavingPrompt({ employeeId, terminationId: id });
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
      {leavingPrompt && (
        <StartChecklistPrompt
          employeeId={leavingPrompt.employeeId}
          fixedStage="leaving"
          terminationId={leavingPrompt.terminationId}
          onStarted={() => setLeavingPrompt(null)}
          onClose={() => setLeavingPrompt(null)}
        />
      )}
    </div>
  );
}
