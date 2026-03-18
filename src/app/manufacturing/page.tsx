'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import MoList from '@/components/manufacturing/MoList';
import MoDetail from '@/components/manufacturing/MoDetail';
import WoDetail from '@/components/manufacturing/WoDetail';
import BomList from '@/components/manufacturing/BomList';
import BomDetail from '@/components/manufacturing/BomDetail';
import CreateMo from '@/components/manufacturing/CreateMo';

type Screen =
  | { type: 'mo-list' }
  | { type: 'mo-detail'; moId: number }
  | { type: 'wo-detail'; moId: number; woId: number }
  | { type: 'bom-list' }
  | { type: 'bom-detail'; bomId: number }
  | { type: 'create-mo'; bomId: number };

export default function ManufacturingPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'mo-list' });
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);

  function navigate(s: Screen) {
    setScreenHistory((h) => [...h, screen]);
    setScreen(s);
  }

  function goBack() {
    setScreenHistory((h) => {
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
            onCreate={() => navigate({ type: 'bom-list' })}
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
      case 'bom-list':
        return (
          <BomList
            onSelect={(bom) => navigate({ type: 'bom-detail', bomId: bom.id })}
            onBack={goBack}
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
              setScreenHistory([]);
              setScreen({ type: 'mo-detail', moId });
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
