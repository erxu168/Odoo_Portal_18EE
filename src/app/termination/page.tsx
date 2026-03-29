'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import TerminationDashboard from '@/components/termination/TerminationDashboard';
import TerminationList from '@/components/termination/TerminationList';
import NewTermination from '@/components/termination/NewTermination';
import TerminationDetail from '@/components/termination/TerminationDetail';
import DeliveryForm from '@/components/termination/DeliveryForm';

type Screen =
  | { type: 'dashboard' }
  | { type: 'list'; filter?: string }
  | { type: 'new' }
  | { type: 'detail'; id: number }
  | { type: 'deliver'; id: number };

export default function TerminationPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [history, setHistory] = useState<Screen[]>([]);

  function navigate(s: Screen) {
    setHistory((h) => [...h, screen]);
    setScreen(s);
  }

  function goBack() {
    setHistory((h) => {
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

  const HomeIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;

  const Header = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
      <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
      <div className="flex items-center gap-3 relative">
        <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors"><HomeIcon /></button>
        <div className="flex-1 min-w-0"><h1 className="text-[20px] font-bold text-white truncate">{title}</h1>{subtitle && <p className="text-[12px] text-white/45 mt-0.5">{subtitle}</p>}</div>
      </div>
    </div>
  );

  function renderScreen() {
    switch (screen.type) {
      case 'dashboard':
        return (
          <>
            <Header title="K\u00fcndigungen" subtitle="Termination Management" />
            <TerminationDashboard
              onNew={() => navigate({ type: 'new' })}
              onList={(filter) => navigate({ type: 'list', filter })}
              onDetail={(id) => navigate({ type: 'detail', id })}
            />
          </>
        );
      case 'list':
        return (
          <TerminationList
            filter={screen.filter}
            onSelect={(id) => navigate({ type: 'detail', id })}
            onBack={goDashboard}
            onHome={goHome}
          />
        );
      case 'new':
        return (
          <NewTermination
            onBack={goBack}
            onHome={goHome}
            onCreated={(id) => {
              setHistory([{ type: 'dashboard' }]);
              setScreen({ type: 'detail', id });
            }}
          />
        );
      case 'detail':
        return (
          <TerminationDetail
            id={screen.id}
            onBack={goBack}
            onHome={goHome}
            onDeliver={(id) => navigate({ type: 'deliver', id })}
            onRefresh={() => setScreen({ ...screen })}
          />
        );
      case 'deliver':
        return (
          <DeliveryForm
            id={screen.id}
            onBack={goBack}
            onHome={goHome}
            onDone={() => {
              setHistory([{ type: 'dashboard' }]);
              setScreen({ type: 'detail', id: screen.id });
            }}
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
