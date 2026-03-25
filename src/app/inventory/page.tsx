'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import InventoryDashboard from '@/components/inventory/InventoryDashboard';
import MyLists from '@/components/inventory/MyLists';
import CountingSession from '@/components/inventory/CountingSession';
import QuickCount from '@/components/inventory/QuickCount';
import ManageTemplates from '@/components/inventory/ManageTemplates';
import ReviewSubmissions from '@/components/inventory/ReviewSubmissions';

type Screen =
  | { type: 'dashboard' }
  | { type: 'my-lists' }
  | { type: 'quick-count' }
  | { type: 'manage' }
  | { type: 'review' }
  | { type: 'session'; sessionId: number };

export default function InventoryPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [userRole, setUserRole] = useState<string>('staff');

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d.user?.role) setUserRole(d.user.role);
    }).catch(() => {});
  }, []);

  const canManage = userRole === 'manager' || userRole === 'admin';

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
        <div className="bg-[#2563EB] px-5 pt-14 pb-5 relative overflow-hidden rounded-b-[28px]">
          <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(22,163,74,0.08)_0%,transparent_70%)]" />
          <div className="flex items-center gap-3 relative">
            <button onClick={goDashboard} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <div className="flex-1">
              <h1 className="text-[20px] font-bold text-white">Quick Count</h1>
              <p className="text-[12px] text-white/50 mt-0.5">Search any product, enter quantity</p>
            </div>
            <button onClick={goHome}
              className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
            </button>
          </div>
        </div>
        <QuickCount userRole={userRole} />
      </div>
    );
  }

  if (screen.type === 'manage' && canManage) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#2563EB] px-5 pt-14 pb-5 relative overflow-hidden rounded-b-[28px]">
          <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(22,163,74,0.08)_0%,transparent_70%)]" />
          <div className="flex items-center gap-3 relative">
            <button onClick={goDashboard} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <div className="flex-1">
              <h1 className="text-[20px] font-bold text-white">Manage Lists</h1>
              <p className="text-[12px] text-white/50 mt-0.5">Create and manage counting templates</p>
            </div>
            <button onClick={goHome}
              className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
            </button>
          </div>
        </div>
        <ManageTemplates onBack={goDashboard} />
      </div>
    );
  }

  if (screen.type === 'review' && canManage) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#2563EB] px-5 pt-14 pb-5 relative overflow-hidden rounded-b-[28px]">
          <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(22,163,74,0.08)_0%,transparent_70%)]" />
          <div className="flex items-center gap-3 relative">
            <button onClick={goDashboard} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <div className="flex-1">
              <h1 className="text-[20px] font-bold text-white">Review</h1>
              <p className="text-[12px] text-white/50 mt-0.5">Approve or reject submitted counts</p>
            </div>
            <button onClick={goHome}
              className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
            </button>
          </div>
        </div>
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
