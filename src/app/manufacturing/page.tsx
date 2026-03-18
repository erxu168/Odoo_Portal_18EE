'use client';

import React, { useState } from 'react';
import Dashboard from '@/components/manufacturing/Dashboard';
import MoList from '@/components/manufacturing/MoList';
import MoDetail from '@/components/manufacturing/MoDetail';
import WoDetail from '@/components/manufacturing/WoDetail';
import BomList from '@/components/manufacturing/BomList';
import BomDetail from '@/components/manufacturing/BomDetail';
import CreateMo from '@/components/manufacturing/CreateMo';

type Tab = 'home' | 'production' | 'tasks' | 'inventory' | 'settings';

type Screen =
  | { type: 'dashboard' }
  | { type: 'mo-list' }
  | { type: 'mo-detail'; moId: number }
  | { type: 'wo-detail'; moId: number; woId: number }
  | { type: 'bom-list' }
  | { type: 'bom-detail'; bomId: number }
  | { type: 'create-mo'; bomId: number }
  | { type: 'placeholder'; label: string };

function TabIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? '#4F6AF5' : '#9CA3AF';
  const icons: Record<string, React.ReactNode> = {
    home: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    production: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>,
    tasks: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    inventory: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>,
    settings: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  };
  return <>{icons[name]}</>;
}

export default function ManufacturingPage() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
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
      return h;
    });
  }

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setHistory([]);
    switch (tab) {
      case 'home': setScreen({ type: 'dashboard' }); break;
      case 'production': setScreen({ type: 'mo-list' }); break;
      case 'tasks': setScreen({ type: 'placeholder', label: 'My Tasks' }); break;
      case 'inventory': setScreen({ type: 'placeholder', label: 'Inventory' }); break;
      case 'settings': setScreen({ type: 'placeholder', label: 'Settings' }); break;
    }
  }

  function renderScreen() {
    switch (screen.type) {
      case 'dashboard':
        return <Dashboard onNavigate={navigate} onSelectTab={selectTab} />;
      case 'mo-list':
        return (
          <MoList
            onSelect={(moId) => navigate({ type: 'mo-detail', moId })}
            onCreate={() => navigate({ type: 'bom-list' })}
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
      case 'bom-list':
        return (
          <BomList
            onSelect={(bom) => navigate({ type: 'bom-detail', bomId: bom.id })}
          />
        );
      case 'bom-detail':
        return (
          <BomDetail
            bomId={screen.bomId}
            onBack={goBack}
            onCreateMo={(bomId) => navigate({ type: 'create-mo', bomId })}
          />
        );
      case 'create-mo':
        return (
          <CreateMo
            bomId={screen.bomId}
            onBack={goBack}
            onCreated={(moId) => {
              setHistory([]);
              setActiveTab('production');
              setScreen({ type: 'mo-detail', moId });
            }}
          />
        );
      case 'placeholder':
        return (
          <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-4xl mb-3">🚧</div>
              <div className="text-sm font-medium">{screen.label}</div>
              <div className="text-xs mt-1">Coming soon</div>
            </div>
          </div>
        );
    }
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'production', label: 'Production', icon: 'production' },
    { id: 'tasks', label: 'My Tasks', icon: 'tasks' },
    { id: 'inventory', label: 'Inventory', icon: 'inventory' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <div className="flex-1 overflow-y-auto pb-16">
        {renderScreen()}
      </div>
      {/* Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around items-center py-1.5 pb-[max(6px,env(safe-area-inset-bottom))] z-50 max-w-lg mx-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 min-w-[56px] transition-colors ${
              activeTab === tab.id ? 'text-indigo-500' : 'text-gray-400'
            }`}
          >
            <TabIcon name={tab.icon} active={activeTab === tab.id} />
            <span className={`text-[10px] font-semibold tracking-wide ${
              activeTab === tab.id ? 'text-indigo-500' : 'text-gray-400'
            }`}>
              {tab.label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
