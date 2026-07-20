'use client';

import React, { useState, useEffect } from 'react';
import LocationManager from '@/components/inventory/LocationManager';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import InventoryDashboard from '@/components/inventory/InventoryDashboard';
import MyLists from '@/components/inventory/MyLists';
import CountingSession from '@/components/inventory/CountingSession';
import QuickCount from '@/components/inventory/QuickCount';
import ManageTemplates from '@/components/inventory/ManageTemplates';
import ReviewSubmissions from '@/components/inventory/ReviewSubmissions';
import MoIngredients from '@/components/inventory/MoIngredients';
import ProductSettings from '@/components/inventory/ProductSettings';
import DrinksScanner from '@/components/inventory/DrinksScanner';
import DrinksEditor from '@/components/inventory/DrinksEditor';
import ConsumptionReport from '@/components/inventory/ConsumptionReport';
import GoodsReceived from '@/components/inventory/GoodsReceived';

type Screen =
  | { type: 'dashboard' }
  | { type: 'my-lists' }
  | { type: 'quick-count' }
  | { type: 'manage' }
  | { type: 'review' }
  | { type: 'mo-ingredients' }
  | { type: 'product-settings' }
  | { type: 'drinks-scanner' }
  | { type: 'drinks-editor' }
  | { type: 'locations' }
  | { type: 'consumption' }
  | { type: 'goods-received' }
  | { type: 'session'; sessionId: number };

export default function InventoryPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [userRole, setUserRole] = useState<string>('staff');
  const [capabilities, setCapabilities] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d.user?.role) setUserRole(d.user.role);
      if (Array.isArray(d.user?.capabilities)) setCapabilities(d.user.capabilities);
    }).catch(() => {});
  }, []);

  const canManage = userRole === 'manager' || userRole === 'admin';
  const can = (k: string) => capabilities.includes(k);

  function goHome() { router.push('/'); }
  function goDashboard() { setScreen({ type: 'dashboard' }); }

  if (screen.type === 'dashboard') {
    return (
      <InventoryDashboard
        userRole={userRole}
        onNavigate={(id) => setScreen({ type: id as any })}
        onHome={goHome}
      />
    );
  }

  if (screen.type === 'session') {
    return (
      <CountingSession
        sessionId={screen.sessionId}
        userRole={userRole}
        onBack={() => setScreen({ type: 'my-lists' })}
        onSubmit={() => setScreen({ type: 'my-lists' })}
      />
    );
  }

  if (screen.type === 'my-lists') {
    return (
      <MyLists
        userRole={userRole}
        onOpenSession={(id) => setScreen({ type: 'session', sessionId: id })}
        onHome={goDashboard}
      />
    );
  }

  if (screen.type === 'quick-count') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader title="Quick Count" subtitle="Search any product, enter quantity" showBack onBack={goDashboard} />
        <QuickCount userRole={userRole} />
      </div>
    );
  }

  if (screen.type === 'mo-ingredients') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader title="MO Ingredients" subtitle="All ingredients from confirmed MOs" showBack onBack={goDashboard} />
        <MoIngredients userRole={userRole} />
      </div>
    );
  }

  if (screen.type === 'goods-received') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader title="Goods received" subtitle="Log deliveries into stock" showBack onBack={goDashboard} />
        <GoodsReceived />
      </div>
    );
  }

  if (screen.type === 'manage' && can('inventory.template.manage')) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader title="Manage Lists" subtitle="Create and manage counting templates" showBack onBack={goDashboard} />
        <ManageTemplates onBack={goDashboard} />
      </div>
    );
  }

  if (screen.type === 'consumption' && can('inventory.consumption.view')) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <ConsumptionReport onBack={goDashboard} />
      </div>
    );
  }

  if (screen.type === 'product-settings' && can('inventory.productsettings.manage')) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <ProductSettings onBack={goDashboard} />
      </div>
    );
  }

  if (screen.type === 'locations' && can('inventory.location.manage')) {
    return <LocationManager onBack={goDashboard} />;
  }

  if (screen.type === 'drinks-scanner' && canManage) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader title="Drinks Scanner" subtitle="Scan to barcode What a Jerk drinks" showBack onBack={goDashboard} />
        <DrinksScanner />
      </div>
    );
  }

  if (screen.type === 'drinks-editor' && canManage) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader title="Edit Drinks" subtitle="Change a drink's name, price, tax, unit or section" showBack onBack={goDashboard} />
        <DrinksEditor onBack={goDashboard} />
      </div>
    );
  }

  if (screen.type === 'review' && can('inventory.review.approve')) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader title="Review" subtitle="Approve or reject submitted counts" showBack onBack={goDashboard} />
        <ReviewSubmissions
          onViewSession={(id) => setScreen({ type: 'session', sessionId: id })}
        />
      </div>
    );
  }

  return (
    <InventoryDashboard
      userRole={userRole}
      onNavigate={(id) => setScreen({ type: id as any })}
      onHome={goHome}
    />
  );
}
