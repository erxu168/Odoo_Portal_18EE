'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PurchaseScreen } from '@/types/purchase';
import GuideList from '@/components/purchase/GuideList';
import GuideOrder from '@/components/purchase/GuideOrder';
import OrderList from '@/components/purchase/OrderList';

/**
 * /purchase — Purchase Module SPA
 *
 * Same routing pattern as /manufacturing:
 * - Screen state managed in React
 * - History stack for back navigation
 * - Components fetch their own data from API routes
 */
export default function PurchasePage() {
  const router = useRouter();
  const [screen, setScreen] = useState<PurchaseScreen>({ type: 'guide-list' });
  const [history, setHistory] = useState<PurchaseScreen[]>([]);
  const [activeTab, setActiveTab] = useState<'guides' | 'orders'>('guides');

  function navigate(s: PurchaseScreen) {
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

  function switchTab(tab: 'guides' | 'orders') {
    setActiveTab(tab);
    setHistory([]);
    if (tab === 'guides') setScreen({ type: 'guide-list' });
    else setScreen({ type: 'order-list' });
  }

  function renderScreen() {
    switch (screen.type) {
      case 'guide-list':
        return (
          <GuideList
            onSelect={(guideId, supplierId) =>
              navigate({ type: 'guide-order', guideId, supplierId })
            }
            onHome={goHome}
          />
        );
      case 'guide-order':
        return (
          <GuideOrder
            guideId={screen.guideId}
            supplierId={screen.supplierId}
            onBack={goBack}
          />
        );
      case 'order-list':
        return (
          <OrderList
            onSelect={(orderId) =>
              navigate({ type: 'order-detail', orderId })
            }
            onHome={goHome}
          />
        );
      default:
        return (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <div className="text-4xl mb-3">🚧</div>
            <div className="text-[15px] font-semibold text-gray-900 mb-1">Coming Soon</div>
            <div className="text-[13px] text-gray-500">This screen is under construction</div>
          </div>
        );
    }
  }

  // Suppress unused variable warnings
  void history;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {renderScreen()}

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex max-w-lg mx-auto h-16">
        <button
          onClick={() => switchTab('guides')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
            activeTab === 'guides'
              ? 'text-krawings-600'
              : 'text-gray-400'
          }`}
        >
          <span className="text-lg">📋</span>
          <span>Guides</span>
        </button>
        <button
          onClick={() => switchTab('orders')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
            activeTab === 'orders'
              ? 'text-krawings-600'
              : 'text-gray-400'
          }`}
        >
          <span className="text-lg">📦</span>
          <span>Orders</span>
        </button>
        <button
          onClick={goHome}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-gray-400"
        >
          <span className="text-lg">🏠</span>
          <span>Home</span>
        </button>
      </div>
    </div>
  );
}
