'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import MoList from '@/components/manufacturing/MoList';
import MoDetail from '@/components/manufacturing/MoDetail';
import WoDetail from '@/components/manufacturing/WoDetail';
import CreateMo from '@/components/manufacturing/CreateMo';
import MfgDashboard from '@/components/manufacturing/MfgDashboard';
import PickList from '@/components/manufacturing/PickList';
import BomList from '@/components/manufacturing/BomList';
import BomDetail from '@/components/manufacturing/BomDetail';

type Screen =
  | { type: 'dashboard' }
  | { type: 'mo-list'; mode: 'production' | 'completed' }
  | { type: 'mo-detail'; moId: number }
  | { type: 'wo-detail'; moId: number; woId: number }
  | { type: 'create' }
  | { type: 'pick-list' }
  | { type: 'bom-list' }
  | { type: 'bom-detail'; bomId: number };

export default function ManufacturingPage() {
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

  function handleDashboardNav(tile: string) {
    if (tile === 'orders') navigate({ type: 'mo-list', mode: 'production' });
    else if (tile === 'create') navigate({ type: 'create' });
    else if (tile === 'recipes') navigate({ type: 'bom-list' });
    else if (tile === 'completed') navigate({ type: 'mo-list', mode: 'completed' });
    else if (tile === 'pick-list') navigate({ type: 'pick-list' });
  }

  const HomeIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;

  const Header = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div className="bg-[#1A1F2E] px-5 pt-12 pb-3 relative overflow-hidden">
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
            <Header title="Manufacturing" subtitle="Manufacturing & recipes" />
            <MfgDashboard onNavigate={handleDashboardNav} />
          </>
        );
      case 'mo-list':
        return (
          <MoList
            mode={screen.mode}
            onSelect={(moId) => navigate({ type: 'mo-detail', moId })}
            onCreate={() => navigate({ type: 'create' })}
            onHome={goDashboard}
          />
        );
      case 'mo-detail':
        return (
          <MoDetail
            moId={screen.moId}
            onBack={goBack}
            onOpenWo={(woId) => navigate({ type: 'wo-detail', moId: screen.moId, woId })}
          />
        );
      case 'wo-detail':
        return (
          <WoDetail
            moId={screen.moId}
            woId={screen.woId}
            onBack={goBack}
            onDone={goBack}
          />
        );
      case 'create':
        return (
          <CreateMo
            onBack={goBack}
            onCreated={(moId) => {
              setHistory([{ type: 'dashboard' }, { type: 'mo-list', mode: 'production' }]);
              setScreen({ type: 'mo-detail', moId });
            }}
          />
        );
      case 'pick-list':
        return (
          <PickList onBack={goDashboard} onHome={goHome} />
        );
      case 'bom-list':
        return (
          <BomList
            onSelect={(bom) => navigate({ type: 'bom-detail', bomId: bom.id })}
            onBack={goDashboard}
          />
        );
      case 'bom-detail':
        return (
          <BomDetail
            bomId={screen.bomId}
            onBack={goBack}
            onCreateMo={() => navigate({ type: 'create' })}
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
