'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import MoList from '@/components/manufacturing/MoList';
import MoDetail from '@/components/manufacturing/MoDetail';
import WoDetail from '@/components/manufacturing/WoDetail';
import CreateMo from '@/components/manufacturing/CreateMo';

type Screen =
  | { type: 'mo-list' }
  | { type: 'mo-detail'; moId: number }
  | { type: 'wo-detail'; moId: number; woId: number }
  | { type: 'create' };

export default function ManufacturingPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'mo-list' });
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

  function goHome() {
    router.push('/');
  }

  function renderScreen() {
    switch (screen.type) {
      case 'mo-list':
        return (
          <MoList
            onSelect={(moId) => navigate({ type: 'mo-detail', moId })}
            onCreate={() => navigate({ type: 'create' })}
            onHome={goHome}
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
              setHistory([]);
              setScreen({ type: 'mo-detail', moId });
            }}
          />
        );
    }
  }

  // Suppress lint
  void history;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {renderScreen()}
    </div>
  );
}
